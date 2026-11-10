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
import Svg, { Polyline } from 'react-native-svg';
import * as Location from 'expo-location';
import { Music2, Pause, Play } from 'lucide-react-native';
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

const ZOOM = 16;
const TILE = 256;
const MPS_TO_MPH = 2.23694;

interface LatLng {
  lat: number;
  lng: number;
}

function worldSize(z: number): number {
  return TILE * 2 ** z;
}
function lngToX(lng: number, z: number): number {
  return ((lng + 180) / 360) * worldSize(z);
}
function latToY(lat: number, z: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldSize(z);
}
function project(p: LatLng, center: LatLng, w: number, h: number) {
  return {
    x: lngToX(p.lng, ZOOM) - lngToX(center.lng, ZOOM) + w / 2,
    y: latToY(p.lat, ZOOM) - latToY(center.lat, ZOOM) + h / 2,
  };
}
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
function initials(name: string): string {
  return name.replace('@', '').slice(0, 2).toUpperCase() || '?';
}

export default function ComplicationsView({
  onNavigate,
}: {
  onNavigate: (tab: ShellTab) => void;
}) {
  const auth = useAuth();
  const myId = auth.user?.id ?? null;
  const { activeSession, refreshActiveSession } = useActiveSession();
  const sessionId = activeSession?.session_id ?? null;
  const isActive = activeSession?.status === 'active';

  const [names, setNames] = useState<Record<string, string>>({});
  const [fixes, setFixes] = useState<Record<string, LiveFix>>({});
  const [myPos, setMyPos] = useState<LatLng | null>(null);
  const [mySpeed, setMySpeed] = useState<number | null>(null);
  const [trail, setTrail] = useState<LatLng[]>([]);
  const [distanceM, setDistanceM] = useState(0);
  const [routeLine, setRouteLine] = useState<LatLng[]>([]);
  const [center, setCenter] = useState<LatLng | null>(null);
  const [mapSize, setMapSize] = useState({ w: 0, h: 300 });
  const [gpsNote, setGpsNote] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [playback, setPlayback] =
    useState<SessionPlaybackStateRow | null>(null);
  const [nowPlaying, setNowPlaying] = useState<QueueEntry | null>(null);

  const lastPosRef = useRef<LatLng | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const shareRef = useRef<LocationSharingHandle | null>(null);
  const shareSessionRef = useRef<string | null>(null);

  // --- session data: names, route, playback ---
  useEffect(() => {
    void refreshActiveSession();
  }, [refreshActiveSession]);

  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    (async () => {
      try {
        const riders = await fetchParticipants(sessionId);
        const map: Record<string, string> = {};
        for (const r of riders) {
          if (r.status === 'left') continue;
          const profile = await fetchProfile(r.user_id);
          map[r.user_id] = profile?.username ?? r.user_id.slice(0, 8);
        }
        if (live) setNames(map);
      } catch {
        // names are cosmetic here
      }
    })();
    return () => {
      live = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!activeSession?.route_id) {
      setRouteLine([]);
      return;
    }
    let live = true;
    void fetchRoute(activeSession.route_id)
      .then((route) => {
        if (!live || !route) return;
        setRouteLine(
          route.path.coordinates.map(([lng, lat]) => ({ lat, lng }))
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [activeSession?.route_id]);

  const refreshPlayback = useCallback(async () => {
    if (!sessionId) return;
    try {
      const [entries, state] = await Promise.all([
        fetchSessionQueueWithTracks(sessionId),
        fetchPlaybackState(sessionId),
      ]);
      setPlayback(state);
      setNowPlaying(
        entries.find((e) => e.item.queue_item_id === state?.current_item_id) ??
          null
      );
    } catch {
      // music line is best effort on this screen
    }
  }, [sessionId]);

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
        if (!live) return;
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
      setFixes((prev) => ({ ...prev, [fix.userId]: fix }));
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [sessionId, myId]);

  // --- own GPS: stats, trail, and sharing to the pack ---
  useEffect(() => {
    if (!sessionId || !myId) return;
    let live = true;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (!live) return;
      if (status !== 'granted') {
        setGpsNote('Location permission is off, so your stats and pack position cannot update.');
        return;
      }
      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 3,
          timeInterval: 1000,
        },
        (loc) => {
          const pos = {
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
          };
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
        }
      );
    })();
    return () => {
      live = false;
      watchRef.current?.remove();
      watchRef.current = null;
    };
  }, [sessionId, myId]);

  useEffect(() => {
    if (!isActive || !sessionId || !myId) return;
    if (shareSessionRef.current === sessionId) return;
    shareSessionRef.current = sessionId;
    void startLocationSharing(sessionId, myId, (reason) => setGpsNote(reason)).then(
      (handle) => {
        shareRef.current = handle;
      }
    );
    return () => {
      if (shareSessionRef.current === sessionId) {
        shareSessionRef.current = null;
        void shareRef.current?.stop();
        shareRef.current = null;
      }
    };
  }, [isActive, sessionId, myId]);

  // --- elapsed clock ---
  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isActive]);

  const startedAt = activeSession?.started_at ?? activeSession?.created_at;
  const elapsedMs =
    isActive && startedAt ? now - new Date(startedAt).getTime() : 0;
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

  const tiles = useMemo(() => {
    if (!mapCenter || mapSize.w === 0) return [];
    const cx = lngToX(mapCenter.lng, ZOOM);
    const cy = latToY(mapCenter.lat, ZOOM);
    const x0 = Math.floor((cx - mapSize.w / 2) / TILE);
    const x1 = Math.floor((cx + mapSize.w / 2) / TILE);
    const y0 = Math.floor((cy - mapSize.h / 2) / TILE);
    const y1 = Math.floor((cy + mapSize.h / 2) / TILE);
    const max = 2 ** ZOOM;
    const out: { key: string; uri: string; left: number; top: number }[] = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (y < 0 || y >= max) continue;
        const tx = ((x % max) + max) % max;
        out.push({
          key: `${ZOOM}/${tx}/${y}`,
          uri: `https://tile.openstreetmap.org/${ZOOM}/${tx}/${y}.png`,
          left: x * TILE - (cx - mapSize.w / 2),
          top: y * TILE - (cy - mapSize.h / 2),
        });
      }
    }
    return out;
  }, [mapCenter, mapSize]);

  const toPoints = (line: LatLng[]): string => {
    if (!mapCenter || mapSize.w === 0) return '';
    return line
      .map((p) => {
        const s = project(p, mapCenter, mapSize.w, mapSize.h);
        return `${s.x},${s.y}`;
      })
      .join(' ');
  };

  const handleToggleMusic = async () => {
    if (!sessionId) return;
    const next = !(playback?.is_playing ?? false);
    try {
      if (next) await appleMusicProvider.resume();
      else await appleMusicProvider.pause();
    } catch {
      // This phone may not be the one playing; the shared flag below
      // is what the playing phone follows.
    }
    await updatePlaybackState(sessionId, { is_playing: next }).catch(() => {});
    void refreshPlayback();
  };

  if (!activeSession) {
    return (
      <View className="flex-1 items-center justify-center bg-ink px-6">
        <Text className="text-center text-[20px] font-semibold text-fog">
          No active session
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

      <View
        className="mx-4 overflow-hidden rounded-2xl border border-line bg-panel"
        style={{ height: 300 }}
        onLayout={(e) =>
          setMapSize({ w: e.nativeEvent.layout.width, h: 300 })
        }
      >
        {mapCenter ? (
          <>
            {tiles.map((t) => (
              <Image
                key={t.key}
                source={{ uri: t.uri }}
                style={{
                  position: 'absolute',
                  left: t.left,
                  top: t.top,
                  width: TILE,
                  height: TILE,
                }}
              />
            ))}
            <Svg
              width={mapSize.w}
              height={mapSize.h}
              style={{ position: 'absolute', left: 0, top: 0 }}
            >
              {routeLine.length > 1 && (
                <Polyline
                  points={toPoints(routeLine)}
                  fill="none"
                  stroke="#34D399"
                  strokeWidth={4}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {trail.length > 1 && (
                <Polyline
                  points={toPoints(trail)}
                  fill="none"
                  stroke="#D4FF00"
                  strokeWidth={3}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={0.85}
                />
              )}
            </Svg>
            {riders.map((r) => {
              const s = project(
                { lat: r.fix.lat, lng: r.fix.lng },
                mapCenter,
                mapSize.w,
                mapSize.h
              );
              if (s.x < -20 || s.y < -20 || s.x > mapSize.w + 20 || s.y > mapSize.h + 20)
                return null;
              return (
                <View
                  key={r.userId}
                  className="absolute h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-accent"
                  style={{ left: s.x - 14, top: s.y - 14 }}
                >
                  <Text className="text-[10px] font-bold text-ink">
                    {initials(r.name)}
                  </Text>
                </View>
              );
            })}
            {myPos &&
              (() => {
                const s = project(myPos, mapCenter, mapSize.w, mapSize.h);
                return (
                  <View
                    className="absolute h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#D4FF00]"
                    style={{ left: s.x - 14, top: s.y - 14 }}
                  >
                    <Text className="text-[10px] font-bold text-ink">YOU</Text>
                  </View>
                );
              })()}
            <Text className="absolute bottom-1 right-2 font-mono text-[9px] text-black/60">
              © OpenStreetMap
            </Text>
          </>
        ) : (
          <View className="flex-1 items-center justify-center px-6">
            <Text className="text-center text-[13px] leading-5 text-muted">
              {isActive
                ? 'Waiting for GPS fixes. The map fills in as riders share their location.'
                : 'The map goes live when the host starts the session.'}
            </Text>
          </View>
        )}
      </View>

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
