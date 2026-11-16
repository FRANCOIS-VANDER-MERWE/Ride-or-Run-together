/**
 * Complications view: the handlebar screen. One glanceable view for
 * the ride itself, built for a phone mounted on the bars and set up
 * before rolling:
 *
 * - Your live stats up top: speed (big), elapsed time, distance,
 *   average speed, all from this phone's GPS.
 * - A real map (OpenStreetMap tiles) with the session's planned route
 *   drawn on it, your ridden trail, and a marker per rider at their
 *   latest live fix.
 * - A rider strip with everyone's current speed.
 * - The pack's music at the bottom: what is playing and one big
 *   play/pause target. Changing songs still happens in the Music tab.
 *
 * Location sharing to the pack starts automatically while the
 * session is active, so setup stays in the Pack tab where it belongs.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import RideMap from './RideMap';
import type { LatLng } from './rideMapGeometry';
import * as Location from 'expo-location';
import { Music2, Pause, Play } from 'lucide-react-native';
import { runSessionAudio } from '../music/sessionAudio';
import { useAuth } from '../auth/AuthProvider';
import { useActiveSession } from '../session/ActiveSessionContext';
import { fetchParticipants } from '../services/sessionsService';
import { fetchProfile } from '../services/profilesService';
import { fetchLatestPings, fetchRoute } from '../services/rideDataService';
import {
  startLocationSharing,
  subscribeToLocationFixes,
  type LiveFix,
  type LocationSharingHandle,
} from '../services/liveLocationService';
import {
  fetchPlaybackState,
  fetchSessionQueueWithTracks,
  updatePlaybackState,
  type QueueEntry,
} from '../services/musicDataService';
import {
  subscribeToTableChanges,
  supabase,
} from '../services/supabaseClient';
import { appleMusicProvider } from '../music/providers/AppleMusicProvider';
import type { SessionPlaybackStateRow } from '../services/database.types';
export type ShellTab = 'ride' | 'pack' | 'music';

const MPS_TO_MPH = 2.23694;

function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function mph(mps: number | null | undefined): number | null {
  if (mps === null || mps === undefined || mps < 0) return null;
  return mps * MPS_TO_MPH;
}
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return hh > 0 ? `${p(hh)}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}
export default function ComplicationsView({
  onNavigate,
}: {
  onNavigate: (tab: ShellTab) => void;
}) {
  const auth = useAuth();
  const myId = auth.user?.id ?? null;
  const { activeSession, participationKey, membershipError } = useActiveSession();
  const sessionId = activeSession?.session_id ?? null;
  const isActive = activeSession?.status === 'active';
  const activityKey = participationKey ?? (sessionId && myId ? `${myId}:${sessionId}` : null);
  const activityRef = useRef(activityKey);
  activityRef.current = activityKey;
  const ownerRef = useRef({ key: activityKey, live: true });
  if (ownerRef.current.key !== activityKey) ownerRef.current = { key: activityKey, live: true };
  const activity = ownerRef.current;
  const playbackRequestRef = useRef(0);
  const intervalStartedRef = useRef(Date.now());

  const [names, setNames] = useState<Record<string, string>>({});
  const [fixes, setFixes] = useState<Record<string, LiveFix>>({});
  const [myPos, setMyPos] = useState<LatLng | null>(null);
  const [mySpeed, setMySpeed] = useState<number | null>(null);
  const [trail, setTrail] = useState<LatLng[]>([]);
  const [distanceM, setDistanceM] = useState(0);
  const [routeLine, setRouteLine] = useState<LatLng[]>([]);
  const [routeName, setRouteName] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [center, setCenter] = useState<LatLng | null>(null);
  const [gpsNote, setGpsNote] = useState<string | null>(null);
  const [tileError, setTileError] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [playback, setPlayback] =
    useState<SessionPlaybackStateRow | null>(null);
  const [nowPlaying, setNowPlaying] = useState<QueueEntry | null>(null);

  const lastPosRef = useRef<LatLng | null>(null);
  // --- session data: names, route, playback ---
  useEffect(() => {
    activity.live = true;
    setNames({}); setFixes({}); setMyPos(null); setMySpeed(null); setTrail([]);
    setDistanceM(0); setRouteLine([]); setRouteName(null); setRouteError(null);
    setCenter(null); setGpsNote(null); setTileError(false);
    setPlayback(null); setNowPlaying(null); lastPosRef.current = null;
    intervalStartedRef.current = Date.now(); setNow(Date.now());
    return () => { activity.live = false; ++playbackRequestRef.current; };
  }, [activityKey]);

  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    (async () => {
      try {
        const riders = await fetchParticipants(sessionId);
        const map: Record<string, string> = {};
        for (const r of riders) {
          if (!['joined', 'riding', 'paused'].includes(r.status)) continue;
          const profile = await fetchProfile(r.user_id);
          if (!live || !activity.live || activityRef.current !== activityKey) return;
          map[r.user_id] = profile?.username ?? r.user_id.slice(0, 8);
        }
        if (live && activity.live && activityRef.current === activityKey) setNames(map);
      } catch {
        // names are cosmetic here
      }
    })();
    return () => {
      live = false;
    };
  }, [sessionId, activityKey]);

  useEffect(() => {
    if (!activeSession?.route_id) {
      setRouteLine([]);
      setRouteName(null);
      setRouteError(null);
      return;
    }
    let live = true;
    setRouteLine([]); setRouteName(null); setRouteError(null);
    void fetchRoute(activeSession.route_id)
      .then((route) => {
        if (!live || !activity.live || activityRef.current !== activityKey) return;
        if (!route) {
          setRouteError('The attached route could not be found.');
          return;
        }
        const line = route.path.coordinates.map(([lng, lat]) => ({
          lat,
          lng,
        }));
        setRouteLine(line);
        setRouteName(
          `${route.name} · ${(route.distance_m / 1609.34).toFixed(1)} mi`
        );
        setRouteError(null);
        // With no GPS fix yet, frame the route start so the line is on
        // screen instead of waiting off-map somewhere across town.
        if (!lastPosRef.current && line.length > 0) {
          setCenter(line[0]);
        }
      })
      .catch((err: unknown) => {
        if (live && activity.live && activityRef.current === activityKey) {
          setRouteError(
            err instanceof Error ? err.message : 'Route failed to load.'
          );
        }
      });
    return () => {
      live = false;
    };
  }, [activeSession?.route_id, activityKey]);

  const refreshPlayback = useCallback(async () => {
    if (!sessionId) return;
    const request = ++playbackRequestRef.current;
    try {
      const [entries, state] = await Promise.all([
        fetchSessionQueueWithTracks(sessionId),
        fetchPlaybackState(sessionId),
      ]);
      if (!activity.live || activityRef.current !== activityKey || request !== playbackRequestRef.current) return;
      setPlayback(state);
      setNowPlaying(
        entries.find((e) => e.item.queue_item_id === state?.current_item_id) ??
          null
      );
    } catch {
      // music line is best effort on this screen
    }
  }, [sessionId, activityKey]);

  useEffect(() => {
    void refreshPlayback();
    if (!sessionId) return;
    const ch = subscribeToTableChanges('session_playback_state', {
      sessionId,
      onChange: () => void refreshPlayback(),
    });
    return () => {
      if (ch && supabase) void supabase.removeChannel(ch);
    };
  }, [sessionId, refreshPlayback]);

  // --- pack fixes: catch-up pings, then the live broadcast ---
  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    void fetchLatestPings(sessionId)
      .then((latest) => {
        if (!live || !activity.live || activityRef.current !== activityKey) return;
        setFixes((prev) => {
          const next = { ...prev };
          for (const [userId, ping] of latest) {
            if (userId === myId) continue;
            next[userId] = {
              userId,
              lat: ping.location.coordinates[1],
              lng: ping.location.coordinates[0],
              speedMps: ping.speed_mps,
              headingDeg: ping.heading_deg,
              recordedAt: ping.recorded_at,
            };
          }
          return next;
        });
      })
      .catch(() => {});
    const unsubscribe = subscribeToLocationFixes(sessionId, (fix) => {
      if (!live || !activity.live || activityRef.current !== activityKey) return;
      setFixes((prev) => ({ ...prev, [fix.userId]: fix }));
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [sessionId, myId, activityKey]);

  // --- own GPS: stats, trail, and sharing to the pack ---
  useEffect(() => {
    if (!sessionId || !myId) return;
    let live = true;
    let poll: ReturnType<typeof setInterval> | null = null;
    let watcher: Location.LocationSubscription | null = null;
    const applyFix = (loc: Location.LocationObject) => {
      if (!live || !activity.live || activityRef.current !== activityKey) return;
      const pos = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      setMyPos(pos);
      setMySpeed(loc.coords.speed ?? null);
      setCenter((c) => {
        if (!c) return pos;
        return haversineM(c, pos) > 60 ? pos : c;
      });
      const last = lastPosRef.current;
      if (last) {
        const seg = haversineM(last, pos);
        if (seg >= 3 && seg <= 200) {
          setDistanceM((d) => d + seg);
          setTrail((t) => [...t.slice(-499), pos]);
        }
      } else {
        setTrail([pos]);
      }
      lastPosRef.current = pos;
    };
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (!live || !activity.live || activityRef.current !== activityKey) return;
        if (status !== 'granted') {
          setGpsNote(
            'Location permission is off, so your stats and pack position cannot update.'
          );
          return;
        }
        // One-shot first fix: the map centers immediately instead of
        // waiting on the watcher, whose first delivery can be slow.
        try {
          // Raced against a timeout: on desktop browsers a one-shot fix
          // can hang indefinitely when the OS blocks location at the
          // system level even though the site prompt was allowed.
          const first = await Promise.race([
            Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
          ]);
          if (first) applyFix(first);
        } catch {
          // The watcher or poll below will keep trying.
        }
        if (!live || !activity.live || activityRef.current !== activityKey) return;
        try {
          const handle = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.Balanced,
              distanceInterval: 3,
              timeInterval: 1000,
            },
            applyFix
          );
          if (!live || !activity.live || activityRef.current !== activityKey) handle.remove();
          else watcher = handle;
        } catch {
          if (!live || !activity.live || activityRef.current !== activityKey) return;
          // Some web environments reject watchers; poll instead.
          poll = setInterval(() => {
            void Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            })
              .then(applyFix)
              .catch(() => {});
          }, 4000);
        }
      } catch (err) {
        if (live && activity.live && activityRef.current === activityKey) {
          setGpsNote(
            err instanceof Error ? `GPS error: ${err.message}` : 'GPS unavailable on this device.'
          );
        }
      }
    })();
    return () => {
      live = false;
      if (poll) clearInterval(poll);
      watcher?.remove();
    };
  }, [sessionId, myId, activityKey]);

  useEffect(() => {
    if (!isActive || !sessionId || !myId) return;
    let live = true;
    let handle: LocationSharingHandle | null = null;
    const valid = () => live && activity.live && activityRef.current === activityKey;
    void startLocationSharing(sessionId, myId, reason => { if (valid()) setGpsNote(reason); }, valid).then(created => {
      if (!valid()) { void created?.stop(); return; }
      handle = created;
    }).catch(err => { if (valid()) setGpsNote(err instanceof Error ? err.message : 'GPS unavailable.'); });
    return () => { live = false; void handle?.stop(); };
  }, [isActive, sessionId, myId, activityKey]);

  // --- elapsed clock ---
  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isActive]);

  const startedAt = activeSession?.started_at ?? activeSession?.created_at;
  const elapsedMs =
    isActive && startedAt ? Math.max(0, now - Math.max(new Date(startedAt).getTime(), intervalStartedRef.current)) : 0;
  const distanceMi = distanceM / 1609.34;
  const avgMph =
    elapsedMs > 60000 ? distanceMi / (elapsedMs / 3600000) : mph(mySpeed);
  const mySpeedMph = mph(mySpeed);

  const riders = useMemo(() => {
    const list = Object.values(fixes).map((fix) => ({
      userId: fix.userId,
      name: names[fix.userId] ?? fix.userId.slice(0, 8),
      speed: mph(fix.speedMps),
      fix,
    }));
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [fixes, names]);

  const mapCenter: LatLng | null =
    center ?? myPos ?? riders[0]?.fix ?? routeLine[0] ?? null;

  const handleToggleMusic = async () => {
    if (!sessionId) return;
    const next = !(playback?.is_playing ?? false);
    try {
      await runSessionAudio(() => activity.live && activityRef.current === activityKey, async () => {
        if (next) await appleMusicProvider.resume();
        else await appleMusicProvider.pause();
      });
    } catch {
      // This phone may not be the one playing; the shared flag below
      // is what the playing phone follows.
    }
    if (!activity.live || activityRef.current !== activityKey) return;
    await updatePlaybackState(sessionId, { is_playing: next }).catch(() => {});
    void refreshPlayback();
  };

  if (!activeSession) {
    return (
      <View className="flex-1 items-center justify-center bg-ink px-6">
        <Text className="text-center text-[20px] font-semibold text-fog">
          {membershipError ?? 'No active session'}
        </Text>
        <Text className="mt-2 text-center text-[14px] leading-5 text-muted">
          Set up the ride in the Pack tab first. Once a session is active,
          this screen shows your speed, the pack on the map, and the music.
        </Text>
        <Pressable
          className="mt-5 rounded-xl bg-accent px-5 py-3"
          onPress={() => onNavigate('pack')}
        >
          <Text className="text-[14px] font-semibold text-ink">Open Pack</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-ink">
      <View className="flex-row items-center justify-between px-5 pb-1 pt-4">
        <Text className="shrink text-[16px] font-semibold text-fog" numberOfLines={1}>
          {activeSession.title}
        </Text>
        <Text
          className={`font-mono text-[11px] tracking-[1.5px] ${isActive ? 'text-accent' : 'text-muted'}`}
        >
          {isActive ? '● LIVE' : activeSession.status.toUpperCase()}
        </Text>
      </View>

      {activeSession.route_id ? (
        <Text
          className={`px-5 pb-1 font-mono text-[11px] ${routeError ? 'text-warn' : 'text-muted'}`}
          numberOfLines={1}
        >
          {routeError
            ? `Route problem: ${routeError}`
            : routeName
              ? `Route: ${routeName}`
              : 'Loading route...'}
        </Text>
      ) : null}

      <View className="flex-row items-end justify-between px-5 pb-2">
        <View>
          <Text className="text-[64px] font-extrabold leading-[64px] text-fog">
            {mySpeedMph !== null ? mySpeedMph.toFixed(0) : '--'}
          </Text>
          <Text className="font-mono text-[11px] tracking-[2px] text-muted">
            MPH · YOUR SPEED
          </Text>
        </View>
        <View className="items-end gap-1 pb-1">
          <Text className="font-mono text-[20px] text-fog">
            {formatElapsed(elapsedMs)}
          </Text>
          <Text className="font-mono text-[11px] text-muted">
            {distanceMi.toFixed(2)} MI · AVG{' '}
            {avgMph !== null ? avgMph.toFixed(1) : '--'}
          </Text>
        </View>
      </View>

      <RideMap
        key={activityKey}
        followCenter={mapCenter}
        myPos={myPos}
        riders={riders}
        routeLine={routeLine}
        trail={trail}
        isActive={isActive}
        onRecenter={() => { if (myPos) setCenter(myPos); }}
        onTileError={() => setTileError(true)}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 px-4 py-3"
      >
        <View className="rounded-full border border-line bg-panel px-3 py-1.5">
          <Text className="font-mono text-[12px] text-fog">
            You · {mySpeedMph !== null ? `${mySpeedMph.toFixed(1)} mph` : '--'}
          </Text>
        </View>
        {riders.map((r) => (
          <View
            key={r.userId}
            className="rounded-full border border-line bg-panel px-3 py-1.5"
          >
            <Text className="font-mono text-[12px] text-fog">
              {r.name} · {r.speed !== null ? `${r.speed.toFixed(1)} mph` : '--'}
            </Text>
          </View>
        ))}
        {riders.length === 0 && (
          <Text className="py-1.5 font-mono text-[12px] text-muted">
            No rider fixes yet
          </Text>
        )}
      </ScrollView>

      {gpsNote ? (
        <Text className="px-5 pb-1 font-mono text-[11px] leading-4 text-warn">
          {gpsNote}
        </Text>
      ) : null}
      {tileError ? (
        <Text className="px-5 pb-1 font-mono text-[11px] leading-4 text-warn">
          Map tiles failed to load. Check the connection and reload.
        </Text>
      ) : null}

      <Pressable
        className="mx-4 mb-4 flex-row items-center gap-3 rounded-2xl border border-line bg-panel p-3"
        onPress={() => onNavigate('music')}
      >
        {nowPlaying?.track?.artwork_url ? (
          <Image
            source={{ uri: nowPlaying.track.artwork_url }}
            className="h-11 w-11 rounded-lg"
          />
        ) : (
          <View className="h-11 w-11 items-center justify-center rounded-lg bg-panel2">
            <Music2 size={18} color="#8A93A6" />
          </View>
        )}
        <View className="flex-1 gap-0.5">
          <Text className="text-[14px] font-semibold text-fog" numberOfLines={1}>
            {nowPlaying?.track?.title ?? 'Nothing playing'}
          </Text>
          <Text className="text-[12px] text-muted" numberOfLines={1}>
            {nowPlaying
              ? `${nowPlaying.track?.artist ?? ''} · tap to change`
              : 'Tap to open Music'}
          </Text>
        </View>
        <Pressable
          className="h-12 w-12 items-center justify-center rounded-full bg-[#D4FF00]"
          onPress={(e) => {
            e.stopPropagation();
            void handleToggleMusic();
          }}
          disabled={!nowPlaying}
        >
          {playback?.is_playing ? (
            <Pause size={20} color="#0A0C10" />
          ) : (
            <Play size={20} color="#0A0C10" />
          )}
        </Pressable>
      </Pressable>
    </View>
  );
}
