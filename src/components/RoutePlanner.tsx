/**
 * Route planner, directions style. Pick a start (A) and a destination
 * (B) by searching for a place or tapping the map, add waypoints in
 * between, and the planner asks a bicycle routing engine for real
 * road routes: up to three alternatives, the first tagged
 * Recommended, each with its estimated ride time and distance. The
 * chosen alternative's road geometry is what gets saved, so the line
 * on everyone's ride map follows actual streets. If the router is
 * unreachable, it falls back to a straight line through the points
 * with a time estimate at an average riding pace, labeled as such.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import * as Location from 'expo-location';

export interface PlannedRoute {
  name: string;
  coords: { lat: number; lng: number }[];
  distanceM: number;
  estDurationS?: number;
  isLoop: boolean;
}

interface Pt {
  lat: number;
  lng: number;
  label?: string;
}

interface RouteAlt {
  coords: Pt[];
  distanceM: number;
  durationS: number;
  summary: string;
}

interface PlaceResult {
  name: string;
  detail: string;
  lat: number;
  lng: number;
}

type Target = 'start' | 'end' | 'waypoint';

const TILE = 256;
const MAP_H = 320;
const FALLBACK_CENTER: Pt = { lat: 33.9519, lng: -83.3576 }; // UGA, Athens GA
const AVG_PACE_MPS = 6.25; // ~14 mph, for the straight-line estimate

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
function xToLng(x: number, z: number): number {
  return (x / worldSize(z)) * 360 - 180;
}
function yToLat(y: number, z: number): number {
  const n = Math.PI * (1 - (2 * y) / worldSize(z));
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}
function haversineM(a: Pt, b: Pt): number {
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
function formatMi(m: number): string {
  return (m / 1609.34).toFixed(1);
}
function formatDuration(totalS: number): string {
  const mins = Math.round(totalS / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} hr ${mins % 60} min`;
}
function shortCoords(p: Pt): string {
  return `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
}

export default function RoutePlanner({
  onSave,
  onCancel,
}: {
  onSave: (route: PlannedRoute) => Promise<void>;
  onCancel: () => void;
}) {
  const [start, setStart] = useState<Pt | null>(null);
  const [end, setEnd] = useState<Pt | null>(null);
  const [waypoints, setWaypoints] = useState<Pt[]>([]);
  const [active, setActive] = useState<Target>('start');
  const [alternatives, setAlternatives] = useState<RouteAlt[]>([]);
  const [selectedAlt, setSelectedAlt] = useState(0);
  const [routing, setRouting] = useState(false);
  const [routeNote, setRouteNote] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [name, setName] = useState('');
  const [center, setCenter] = useState<Pt>(FALLBACK_CENTER);
  const [zoom, setZoom] = useState(14);
  const [size, setSize] = useState({ w: 0, h: MAP_H });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const chain = useMemo(
    () => (start && end ? [start, ...waypoints, end] : []),
    [start, end, waypoints]
  );

  const fitTo = (coords: Pt[]) => {
    const { w, h } = sizeRef.current;
    if (coords.length === 0 || w === 0) return;
    for (let z = 17; z >= 10; z--) {
      const xs = coords.map((p) => lngToX(p.lng, z));
      const ys = coords.map((p) => latToY(p.lat, z));
      const spanX = Math.max(...xs) - Math.min(...xs);
      const spanY = Math.max(...ys) - Math.min(...ys);
      if (spanX <= w - 48 && spanY <= h - 48) {
        const midX = (Math.max(...xs) + Math.min(...xs)) / 2;
        const midY = (Math.max(...ys) + Math.min(...ys)) / 2;
        setZoom(z);
        setCenter({ lat: yToLat(midY, z), lng: xToLng(midX, z) });
        return;
      }
    }
    setZoom(10);
    setCenter(coords[0]);
  };

  // Start centered on the rider if a quick fix is available.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const fix = await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
        ]);
        if (live && fix) {
          setCenter({ lat: fix.coords.latitude, lng: fix.coords.longitude });
        }
      } catch {
        // Fallback center stays.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Road routing, debounced, whenever the point chain changes.
  useEffect(() => {
    if (!start || !end) {
      setAlternatives([]);
      setRouteNote(null);
      return;
    }
    setRouting(true);
    const timer = setTimeout(async () => {
      try {
        const coordStr = chain.map((p) => `${p.lng},${p.lat}`).join(';');
        const res = await fetch(
          `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${coordStr}?alternatives=3&overview=full&geometries=geojson`
        );
        const json = (await res.json()) as {
          code?: string;
          routes?: {
            distance: number;
            duration: number;
            geometry: { coordinates: [number, number][] };
            legs?: { summary?: string }[];
          }[];
        };
        if (json.code !== 'Ok' || !json.routes || json.routes.length === 0) {
          throw new Error('No route found.');
        }
        const alts: RouteAlt[] = json.routes.map((r) => ({
          coords: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
          distanceM: r.distance,
          durationS: r.duration,
          summary:
            r.legs
              ?.map((l) => l.summary)
              .filter(Boolean)
              .join(', ') ?? '',
        }));
        setAlternatives(alts);
        setSelectedAlt(0);
        setRouteNote(null);
        fitTo(alts[0].coords);
      } catch {
        setAlternatives([]);
        setRouteNote(
          'Road routing is unavailable right now, so this is a straight-line estimate.'
        );
      } finally {
        setRouting(false);
      }
    }, 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, waypoints]);

  const tiles = useMemo(() => {
    if (size.w === 0) return [];
    const cx = lngToX(center.lng, zoom);
    const cy = latToY(center.lat, zoom);
    const x0 = Math.floor((cx - size.w / 2) / TILE);
    const x1 = Math.floor((cx + size.w / 2) / TILE);
    const y0 = Math.floor((cy - size.h / 2) / TILE);
    const y1 = Math.floor((cy + size.h / 2) / TILE);
    const max = 2 ** zoom;
    const out: { key: string; uri: string; left: number; top: number }[] = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (y < 0 || y >= max) continue;
        const tx = ((x % max) + max) % max;
        out.push({
          key: `${zoom}/${tx}/${y}`,
          uri: `https://tile.openstreetmap.org/${zoom}/${tx}/${y}.png`,
          left: x * TILE - (cx - size.w / 2),
          top: y * TILE - (cy - size.h / 2),
        });
      }
    }
    return out;
  }, [center, zoom, size]);

  const project = (p: Pt) => ({
    x: lngToX(p.lng, zoom) - lngToX(center.lng, zoom) + size.w / 2,
    y: latToY(p.lat, zoom) - latToY(center.lat, zoom) + size.h / 2,
  });
  const toPoints = (line: Pt[]): string =>
    line
      .map((p) => {
        const s = project(p);
        return `${s.x},${s.y}`;
      })
      .join(' ');

  const assignPoint = (pt: Pt) => {
    if (active === 'start') {
      setStart(pt);
      setActive('end');
    } else if (active === 'end') {
      setEnd(pt);
      setActive('waypoint');
    } else {
      setWaypoints((prev) => [...prev, pt]);
    }
    setCenter(pt);
  };

  const pressStartRef = useRef<{ x: number; y: number } | null>(null);

  const placeAt = (locationX: number, locationY: number) => {
    const wx = lngToX(center.lng, zoom) - size.w / 2 + locationX;
    const wy = latToY(center.lat, zoom) - size.h / 2 + locationY;
    assignPoint({ lat: yToLat(wy, zoom), lng: xToLng(wx, zoom) });
  };

  const handlePressGrant = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    pressStartRef.current =
      typeof locationX === 'number' && typeof locationY === 'number'
        ? { x: locationX, y: locationY }
        : null;
  };

  const placeAtRef = useRef(placeAt);
  placeAtRef.current = placeAt;
  const overlayRef = useRef<any>(null);
  const lastResponderPlaceRef = useRef(0);

  // Web fallback: a plain DOM click listener on the overlay, using the
  // offsetX and offsetY the browser reports for the click. Skipped when
  // the responder path just placed a point, so the two never double up.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = overlayRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const onClick = (ev: MouseEvent) => {
      if (Date.now() - lastResponderPlaceRef.current < 350) return;
      placeAtRef.current(ev.offsetX, ev.offsetY);
    };
    node.addEventListener('click', onClick);
    return () => node.removeEventListener('click', onClick);
  }, []);

  const handlePressRelease = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    const startAt = pressStartRef.current;
    pressStartRef.current = null;
    if (typeof locationX !== 'number' || typeof locationY !== 'number') return;
    // A press that moved is a scroll or drag, not a tap.
    if (
      startAt &&
      (Math.abs(locationX - startAt.x) > 8 ||
        Math.abs(locationY - startAt.y) > 8)
    ) {
      return;
    }
    lastResponderPlaceRef.current = Date.now();
    placeAt(locationX, locationY);
  };

  const runSearch = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`
      );
      const json = (await res.json()) as {
        display_name: string;
        lat: string;
        lon: string;
      }[];
      setResults(
        json.map((r) => {
          const parts = r.display_name.split(',');
          return {
            name: parts[0]?.trim() ?? r.display_name,
            detail: parts.slice(1, 3).join(',').trim(),
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lon),
          };
        })
      );
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const useMyLocation = async () => {
    try {
      const fix = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      assignPoint({
        lat: fix.coords.latitude,
        lng: fix.coords.longitude,
        label: 'My location',
      });
    } catch {
      setError('Could not get your location.');
    }
  };

  const chosen = alternatives[selectedAlt] ?? null;
  const straightDistanceM = useMemo(() => {
    let total = 0;
    for (let i = 1; i < chain.length; i++) total += haversineM(chain[i - 1], chain[i]);
    return total;
  }, [chain]);
  const displayDistanceM = chosen ? chosen.distanceM : straightDistanceM;
  const displayDurationS = chosen
    ? chosen.durationS
    : straightDistanceM / AVG_PACE_MPS;
  const isLoop =
    start !== null && end !== null && haversineM(start, end) <= 25;

  const handleSave = async () => {
    if (!start || !end || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name:
          name.trim() ||
          (start.label && end.label
            ? `${start.label} to ${end.label}`
            : 'Untitled route'),
        coords: chosen ? chosen.coords : chain,
        distanceM: displayDistanceM,
        estDurationS: Math.round(displayDurationS),
        isLoop,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the route.');
      setSaving(false);
    }
  };

  const renderRow = (opts: {
    color: string;
    letter: string;
    title: string;
    pt: Pt | null;
    isActive: boolean;
    onPress: () => void;
    onClear?: () => void;
  }) => (
    <Pressable
      className={`flex-row items-center gap-2.5 rounded-[10px] border px-2.5 py-2 ${opts.isActive ? 'border-accent bg-panel' : 'border-line'}`}
      onPress={opts.onPress}
    >
      <View
        className="h-5 w-5 items-center justify-center rounded-full"
        style={{ backgroundColor: opts.color }}
      >
        <Text className="text-[10px] font-extrabold text-white">{opts.letter}</Text>
      </View>
      <View className="shrink flex-1">
        <Text className="text-[13px] font-semibold text-fog" numberOfLines={1}>
          {opts.pt ? (opts.pt.label ?? shortCoords(opts.pt)) : opts.title}
        </Text>
        {opts.pt && (
          <Text className="text-[11px] text-muted" numberOfLines={1}>
            {opts.title} · {shortCoords(opts.pt)}
          </Text>
        )}
      </View>
      {opts.pt && opts.onClear ? (
        <Pressable
          className="h-6 w-6 items-center justify-center rounded-full border border-line"
          onPress={(e) => {
            e.stopPropagation();
            opts.onClear?.();
          }}
        >
          <Text className="text-[12px] font-bold text-muted">×</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );

  const activeLabel =
    active === 'start'
      ? 'the start'
      : active === 'end'
        ? 'the destination'
        : 'a waypoint';

  return (
    <View className="gap-2 pt-1">
      <View className="gap-1.5 rounded-xl border border-line bg-ink p-2">
        {renderRow({
          color: '#34D399',
          letter: 'A',
          title: 'Choose start',
          pt: start,
          isActive: active === 'start',
          onPress: () => {
            setActive('start');
            if (start) setCenter(start);
          },
          onClear: () => {
            setStart(null);
            setActive('start');
          },
        })}
        {waypoints.map((wp, i) =>
          renderRow({
            color: '#8A93A6',
            letter: `${i + 1}`,
            title: `Waypoint ${i + 1}`,
            pt: wp,
            isActive: false,
            onPress: () => setCenter(wp),
            onClear: () =>
              setWaypoints((prev) => prev.filter((_, j) => j !== i)),
          })
        )}
        {renderRow({
          color: '#F87171',
          letter: 'B',
          title: 'Choose destination',
          pt: end,
          isActive: active === 'end' || active === 'waypoint',
          onPress: () => {
            setActive(end ? 'waypoint' : 'end');
            if (end) setCenter(end);
          },
          onClear: () => {
            setEnd(null);
            setActive('end');
          },
        })}
        <View className="flex-row flex-wrap gap-2 px-0.5 pb-0.5 pt-1">
          <Pressable
            className={`rounded-full border px-2.5 py-[5px] ${active === 'waypoint' ? 'border-accent bg-accent' : 'border-line'}`}
            onPress={() => setActive('waypoint')}
          >
            <Text className={`text-[12px] font-bold ${active === 'waypoint' ? 'text-ink' : 'text-fog'}`}>
              + Add waypoints by tapping
            </Text>
          </Pressable>
          <Pressable
            className="rounded-full border border-line px-2.5 py-[5px]"
            onPress={() => void useMyLocation()}
          >
            <Text className="text-[12px] font-bold text-fog">Use my location</Text>
          </Pressable>
          {start && end && (
            <Pressable
              className="rounded-full border border-line px-2.5 py-[5px]"
              onPress={() => {
                setStart(end);
                setEnd(start);
                setWaypoints((prev) => [...prev].reverse());
              }}
            >
              <Text className="text-[12px] font-bold text-fog">Swap A and B</Text>
            </Pressable>
          )}
        </View>
      </View>

      <TextInput
        className="rounded-[10px] border border-line bg-ink px-3 py-2.5 text-[14px] text-fog"
        value={query}
        onChangeText={setQuery}
        placeholder={`Search for ${activeLabel}`}
        placeholderTextColor="#8A93A6"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={() => void runSearch()}
      />
      {results.length > 0 && (
        <View className="gap-1">
          {results.map((r, i) => (
            <Pressable
              key={`${r.lat}-${r.lng}-${i}`}
              className="rounded-[10px] border border-line bg-panel px-3 py-2"
              onPress={() => {
                assignPoint({ lat: r.lat, lng: r.lng, label: r.name });
                setResults([]);
                setQuery('');
              }}
            >
              <Text className="text-[13px] font-semibold text-fog" numberOfLines={1}>
                {r.name}
              </Text>
              {r.detail ? (
                <Text className="text-[11px] text-muted" numberOfLines={1}>
                  {r.detail}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      )}
      {searching && (
        <Text className="text-[12px] text-muted">Searching places...</Text>
      )}

      <View
        className="overflow-hidden rounded-xl border border-line bg-panel"
        style={{ height: MAP_H }}
        onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: MAP_H })}
      >
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
          width={size.w}
          height={size.h}
          style={{ position: 'absolute', left: 0, top: 0 }}
        >
          {alternatives.map((alt, i) =>
            i !== selectedAlt && alt.coords.length > 1 ? (
              <Polyline
                key={`alt-${i}`}
                points={toPoints(alt.coords)}
                fill="none"
                stroke="#8A93A6"
                strokeWidth={3}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={0.75}
              />
            ) : null
          )}
          {chosen && chosen.coords.length > 1 && (
            <Polyline
              points={toPoints(chosen.coords)}
              fill="none"
              stroke="#34D399"
              strokeWidth={4}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {!chosen && chain.length > 1 && (
            <Polyline
              points={toPoints(chain)}
              fill="none"
              stroke="#34D399"
              strokeWidth={3}
              strokeDasharray="6 5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
        </Svg>
        {start &&
          (() => {
            const s = project(start);
            return (
              <View
                className="absolute h-6 w-6 items-center justify-center rounded-full border-2 border-white"
                style={{ left: s.x - 12, top: s.y - 12, backgroundColor: '#34D399' }}
              >
                <Text className="text-[10px] font-extrabold text-white">A</Text>
              </View>
            );
          })()}
        {waypoints.map((wp, i) => {
          const s = project(wp);
          return (
            <View
              key={`wp-${i}`}
              className="absolute h-5 w-5 items-center justify-center rounded-full border border-white bg-[#8A93A6]"
              style={{ left: s.x - 10, top: s.y - 10 }}
            >
              <Text className="text-[9px] font-bold text-white">{i + 1}</Text>
            </View>
          );
        })}
        {end &&
          (() => {
            const s = project(end);
            return (
              <View
                className="absolute h-6 w-6 items-center justify-center rounded-full border-2 border-white"
                style={{ left: s.x - 12, top: s.y - 12, backgroundColor: '#F87171' }}
              >
                <Text className="text-[10px] font-extrabold text-white">B</Text>
              </View>
            );
          })()}
        <View
          ref={overlayRef}
          className="absolute inset-0"
          onStartShouldSetResponder={() => true}
          onResponderGrant={handlePressGrant}
          onResponderRelease={handlePressRelease}
        />
        <View className="absolute right-2 top-2 gap-1.5">
          <Pressable
            className="h-8 w-8 items-center justify-center rounded-full bg-panel"
            onPress={() => setZoom((z) => Math.min(18, z + 1))}
          >
            <Text className="text-[16px] font-bold text-fog">+</Text>
          </Pressable>
          <Pressable
            className="h-8 w-8 items-center justify-center rounded-full bg-panel"
            onPress={() => setZoom((z) => Math.max(10, z - 1))}
          >
            <Text className="text-[16px] font-bold text-fog">−</Text>
          </Pressable>
          {chain.length > 1 && (
            <Pressable
              className="h-8 items-center justify-center rounded-full bg-panel px-2"
              onPress={() => fitTo(chosen ? chosen.coords : chain)}
            >
              <Text className="text-[11px] font-bold text-fog">Fit</Text>
            </Pressable>
          )}
        </View>
        <Text className="absolute bottom-1 right-2 font-mono text-[9px] text-black/60">
          © OpenStreetMap
        </Text>
      </View>

      <Text className="text-[12px] text-muted">
        {active === 'waypoint'
          ? 'Tap the map to add waypoints, or pick the destination row to move B.'
          : `Tap the map or search to set ${activeLabel}.`}
      </Text>

      {start && end && (
        <View className="gap-1.5">
          {routing && (
            <Text className="text-[12px] text-muted">Finding road routes...</Text>
          )}
          {alternatives.map((alt, i) => (
            <Pressable
              key={`card-${i}`}
              className={`gap-0.5 rounded-[10px] border p-2.5 ${i === selectedAlt ? 'border-accent bg-panel' : 'border-line'}`}
              onPress={() => {
                setSelectedAlt(i);
                fitTo(alt.coords);
              }}
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-[14px] font-bold text-fog">
                  {formatMi(alt.distanceM)} mi · {formatDuration(alt.durationS)}
                </Text>
                {i === 0 && (
                  <Text className="text-[10px] font-extrabold tracking-[1px] text-accent">
                    RECOMMENDED
                  </Text>
                )}
              </View>
              {alt.summary ? (
                <Text className="text-[12px] text-muted" numberOfLines={1}>
                  via {alt.summary}
                </Text>
              ) : null}
            </Pressable>
          ))}
          {alternatives.length === 0 && !routing && (
            <Text className="text-[14px] text-fog">
              {formatMi(displayDistanceM)} mi · about{' '}
              {formatDuration(displayDurationS)}
            </Text>
          )}
          {routeNote ? (
            <Text className="font-mono text-[11px] leading-4 text-warn">
              {routeNote}
            </Text>
          ) : null}
        </View>
      )}

      <TextInput
        className="rounded-[10px] border border-line bg-ink px-3 py-2.5 text-[14px] text-fog"
        value={name}
        onChangeText={setName}
        placeholder="Route name (optional)"
        placeholderTextColor="#8A93A6"
      />
      {error ? (
        <Text className="font-mono text-[11px] leading-4 text-warn">{error}</Text>
      ) : null}
      <View className="flex-row gap-2">
        <Pressable
          className={`flex-1 items-center rounded-[10px] bg-accent py-[10px] ${!start || !end || saving ? 'opacity-50' : ''}`}
          onPress={() => void handleSave()}
          disabled={!start || !end || saving}
        >
          <Text className="text-[13px] font-extrabold text-ink">
            {saving ? 'Saving...' : 'Save and attach route'}
          </Text>
        </Pressable>
        <Pressable
          className="items-center rounded-[10px] border border-line px-4 py-[10px]"
          onPress={onCancel}
          disabled={saving}
        >
          <Text className="text-[13px] font-bold text-fog">Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}
