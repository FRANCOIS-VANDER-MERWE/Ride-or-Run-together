/**
 * Live location for an active ride session.
 *
 * Two paths, deliberately:
 * - Durable: fixes are inserted into location_pings (throttled to one
 *   per 5 seconds) through rideDataService, so a rider who opens the
 *   session late can catch up with fetchLatestPings.
 * - Live: every fix is also broadcast on the session's Realtime
 *   channel (event "location"), the low-latency path the map renders
 *   from. Broadcasts are fire-and-forget and are not stored.
 *
 * Channel ownership: publishing and subscribing for one session share
 * a single Realtime channel per client, managed by the registry at
 * the bottom of this file. supabase-js dedupes channels by topic and
 * a channel can only be subscribed once, so creating two channels for
 * the same session in one client (one to send, one to listen) breaks.
 * The registry creates the channel once, fans broadcasts out to local
 * handlers, and releaseLocationChannel tears it down when the last
 * consumer leaves.
 */
import * as Location from 'expo-location';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { insertLocationPing } from './rideDataService';
import { requireSupabase, supabase } from './supabaseClient';

export interface LiveFix {
  userId: string;
  lat: number;
  lng: number;
  speedMps: number | null;
  headingDeg: number | null;
  recordedAt: string;
}

export interface LocationSharingHandle {
  stop: () => Promise<void>;
}

const DB_INSERT_INTERVAL_MS = 5000;

interface ChannelEntry {
  channel: RealtimeChannel;
  ready: boolean;
  publishers: number;
  handlers: Set<(fix: LiveFix) => void>;
}

const channels = new Map<string, ChannelEntry>();

function ensureLocationChannel(sessionId: string): ChannelEntry | null {
  if (!supabase) return null;
  const existing = channels.get(sessionId);
  if (existing) return existing;
  const channel = supabase.channel(`pack-location:${sessionId}`, {
    config: { broadcast: { self: false, ack: false } },
  });
  const entry: ChannelEntry = {
    channel,
    ready: false,
    publishers: 0,
    handlers: new Set(),
  };
  channel.on('broadcast', { event: 'location' }, (message) => {
    const payload = (message as { payload?: LiveFix }).payload;
    if (payload && typeof payload.lat === 'number') {
      for (const handler of entry.handlers) handler(payload);
    }
  });
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') entry.ready = true;
  });
  channels.set(sessionId, entry);
  return entry;
}

/** Releases an idle channel; mounted subscribers/publishers retain ownership. */
export async function releaseLocationChannel(
  sessionId: string
): Promise<void> {
  const entry = channels.get(sessionId);
  if (!entry || entry.handlers.size || entry.publishers) return;
  channels.delete(sessionId);
  if (supabase) await supabase.removeChannel(entry.channel);
}

/**
 * Starts watching device GPS for one session. Resolves to null when
 * permission is denied or GPS is unavailable; onError explains why.
 */
interface SharingOwner {
  isCurrent: () => boolean;
  onError?: (reason: string) => void;
}
interface Publisher {
  owners: Set<SharingOwner>;
  ready: Promise<boolean>;
  stop: () => void;
}
const publishers = new Map<string, Publisher>();

export async function startLocationSharing(
  sessionId: string,
  userId: string,
  onError?: (reason: string) => void,
  isCurrent: () => boolean = () => true
): Promise<LocationSharingHandle | null> {
  const key = `${sessionId}:${userId}`;
  const owner = { isCurrent, onError };
  let publisher = publishers.get(key);
  if (!publisher) {
    const owners = new Set<SharingOwner>();
    const hasOwner = () => [...owners].some(o => o.isCurrent());
    const report = (reason: string) => { for (const o of owners) if (o.isCurrent()) o.onError?.(reason); };
    let watcher: Location.LocationSubscription | null = null;
    let entry: ChannelEntry | null = null;
    let stopped = false;
    const created: Publisher = {
      owners,
      ready: Promise.resolve(false),
      stop: () => {
        if (stopped) return;
        stopped = true;
        watcher?.remove();
        if (entry) { --entry.publishers; void releaseLocationChannel(sessionId); }
        if (publishers.get(key) === created) publishers.delete(key);
      },
    };
    publisher = created;
    publishers.set(key, created);
    owners.add(owner);
    created.ready = (async () => {
      try {
        requireSupabase();
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (!hasOwner()) return false;
        if (status !== 'granted') { report('Location permission was not granted.'); return false; }
        entry = ensureLocationChannel(sessionId);
        if (!entry) { report('Supabase is not configured.'); return false; }
        ++entry.publishers;
        let lastInsertAt = 0;
        let insertErrorReported = false;
        watcher = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 5 }, loc => {
          if (stopped || !hasOwner() || !entry) return;
          const fix: LiveFix = {
            userId, lat: loc.coords.latitude, lng: loc.coords.longitude,
            speedMps: loc.coords.speed ?? null, headingDeg: loc.coords.heading ?? null,
            recordedAt: new Date(loc.timestamp).toISOString(),
          };
          if (entry.ready) void entry.channel.send({ type: 'broadcast', event: 'location', payload: fix }).catch(() => {});
          const now = Date.now();
          if (now - lastInsertAt >= DB_INSERT_INTERVAL_MS) {
            lastInsertAt = now;
            void insertLocationPing(sessionId, userId, {
              lat: fix.lat, lng: fix.lng, altitudeM: loc.coords.altitude ?? undefined,
              accuracyM: loc.coords.accuracy ?? undefined, speedMps: fix.speedMps ?? undefined, headingDeg: fix.headingDeg ?? undefined,
            }).catch(err => {
              if (!stopped && hasOwner() && !insertErrorReported) {
                insertErrorReported = true;
                report(err instanceof Error ? err.message : 'Failed to save a location ping.');
              }
            });
          }
        });
        if (!hasOwner()) { created.stop(); return false; }
        return true;
      } catch (err) {
        report(err instanceof Error ? err.message : 'Location setup failed.');
        return false;
      } finally {
        if (!watcher || !hasOwner()) created.stop();
      }
    })();
  } else publisher.owners.add(owner);
  const currentPublisher = publisher;
  const ready = await currentPublisher.ready;
  if (!ready || !isCurrent()) {
    currentPublisher.owners.delete(owner);
    if (![...currentPublisher.owners].some(o => o.isCurrent())) currentPublisher.stop();
    return null;
  }
  let released = false;
  return { stop: async () => {
    if (released) return;
    released = true;
    currentPublisher.owners.delete(owner);
    if (![...currentPublisher.owners].some(o => o.isCurrent())) currentPublisher.stop();
  } };
}

/**
 * Registers a handler for other riders' live fixes in a session.
 * Returns an unsubscribe function for just this handler. The shared
 * channel is released automatically after the final owner leaves.
 */
export function subscribeToLocationFixes(
  sessionId: string,
  onFix: (fix: LiveFix) => void
): () => void {
  const entry = ensureLocationChannel(sessionId);
  if (!entry) return () => undefined;
  // Each subscription owns a distinct handler, even if callbacks are identical.
  const handler = (fix: LiveFix) => onFix(fix);
  entry.handlers.add(handler);
  return () => {
    entry.handlers.delete(handler);
    void releaseLocationChannel(sessionId);
  };
}
