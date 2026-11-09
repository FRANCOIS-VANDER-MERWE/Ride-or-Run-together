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

/** Tears down the shared location channel for a session, if any. */
export async function releaseLocationChannel(
  sessionId: string
): Promise<void> {
  const entry = channels.get(sessionId);
  if (!entry) return;
  channels.delete(sessionId);
  if (supabase) await supabase.removeChannel(entry.channel);
}

/**
 * Starts watching device GPS for one session. Resolves to null when
 * permission is denied or GPS is unavailable; onError explains why.
 */
export async function startLocationSharing(
  sessionId: string,
  userId: string,
  onError?: (reason: string) => void
): Promise<LocationSharingHandle | null> {
  try {
    requireSupabase();
  } catch (err) {
    onError?.(err instanceof Error ? err.message : 'Supabase unavailable.');
    return null;
  }
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      onError?.('Location permission was not granted.');
      return null;
    }
  } catch (err) {
    onError?.(
      err instanceof Error ? err.message : 'Location permission failed.'
    );
    return null;
  }

  const entry = ensureLocationChannel(sessionId);
  if (!entry) {
    onError?.('Supabase is not configured.');
    return null;
  }

  let lastInsertAt = 0;
  let insertErrorReported = false;
  const subscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: 4000,
      distanceInterval: 5,
    },
    (loc) => {
      const fix: LiveFix = {
        userId,
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        speedMps: loc.coords.speed ?? null,
        headingDeg: loc.coords.heading ?? null,
        recordedAt: new Date(loc.timestamp).toISOString(),
      };
      if (entry.ready) {
        void entry.channel.send({
          type: 'broadcast',
          event: 'location',
          payload: fix,
        });
      }
      const now = Date.now();
      if (now - lastInsertAt >= DB_INSERT_INTERVAL_MS) {
        lastInsertAt = now;
        void insertLocationPing(sessionId, userId, {
          lat: fix.lat,
          lng: fix.lng,
          altitudeM: loc.coords.altitude ?? undefined,
          accuracyM: loc.coords.accuracy ?? undefined,
          speedMps: fix.speedMps ?? undefined,
          headingDeg: fix.headingDeg ?? undefined,
        }).catch((err) => {
          if (!insertErrorReported) {
            insertErrorReported = true;
            onError?.(
              err instanceof Error
                ? err.message
                : 'Failed to save a location ping.'
            );
          }
        });
      }
    }
  );

  return {
    stop: async () => {
      subscription.remove();
    },
  };
}

/**
 * Registers a handler for other riders' live fixes in a session.
 * Returns an unsubscribe function for just this handler. Use
 * releaseLocationChannel when leaving the session view entirely.
 */
export function subscribeToLocationFixes(
  sessionId: string,
  onFix: (fix: LiveFix) => void
): () => void {
  const entry = ensureLocationChannel(sessionId);
  if (!entry) return () => undefined;
  entry.handlers.add(onFix);
  return () => {
    entry.handlers.delete(onFix);
  };
}
