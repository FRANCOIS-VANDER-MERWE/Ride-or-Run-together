/**
 * Route planner: tap points on a real map to draw the pack's shared
 * route. Used from the Pack tab's session detail during ride setup.
 * Saving creates a reusable route (name, path, distance) and the
 * caller attaches it to the session; every rider's Complications map
 * then draws the same line.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
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
  isLoop: boolean;
}

const ZOOM = 16;
const TILE = 256;
const MAP_H = 260;
const FALLBACK_CENTER = { lat: 33.9519, lng: -83.3576 }; // UGA, Athens GA

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
function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
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

export default function RoutePlanner({
  onSave,
  onCancel,
}: {
  onSave: (route: PlannedRoute) => Promise<void>;
  onCancel: () => void;
}) {
  const [points, setPoints] = useState<{ lat: number; lng: number }[]>([]);
  const [name, setName] = useState('');
  const [center, setCenter] = useState(FALLBACK_CENTER);
  const [size, setSize] = useState({ w: 0, h: MAP_H });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tappedRef = useRef(false);

  // Center on the rider if we can get a fix quickly; taps win.
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
        if (live && fix && !tappedRef.current) {
          setCenter({ lat: fix.coords.latitude, lng: fix.coords.longitude });
        }
      } catch {
        // Fallback center stays; planning still works.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const tiles = useMemo(() => {
    if (size.w === 0) return [];
    const cx = lngToX(center.lng, ZOOM);
    const cy = latToY(center.lat, ZOOM);
    const x0 = Math.floor((cx - size.w / 2) / TILE);
    const x1 = Math.floor((cx + size.w / 2) / TILE);
    const y0 = Math.floor((cy - size.h / 2) / TILE);
    const y1 = Math.floor((cy + size.h / 2) / TILE);
    const max = 2 ** ZOOM;
    const out: { key: string; uri: string; left: number; top: number }[] = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (y < 0 || y >= max) continue;
        const tx = ((x % max) + max) % max;
        out.push({
          key: `${ZOOM}/${tx}/${y}`,
          uri: `https://tile.openstreetmap.org/${ZOOM}/${tx}/${y}.png`,
          left: x * TILE - (cx - size.w / 2),
          top: y * TILE - (cy - size.h / 2),
        });
      }
    }
    return out;
  }, [center, size]);

  const project = (p: { lat: number; lng: number }) => ({
    x: lngToX(p.lng, ZOOM) - lngToX(center.lng, ZOOM) + size.w / 2,
    y: latToY(p.lat, ZOOM) - latToY(center.lat, ZOOM) + size.h / 2,
  });

  const handleTap = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    if (locationX === undefined || locationY === undefined) return;
    tappedRef.current = true;
    const wx = lngToX(center.lng, ZOOM) - size.w / 2 + locationX;
    const wy = latToY(center.lat, ZOOM) - size.h / 2 + locationY;
    setPoints((prev) => [...prev, { lat: yToLat(wy, ZOOM), lng: xToLng(wx, ZOOM) }]);
  };

  const distanceM = useMemo(() => {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1], points[i]);
    return total;
  }, [points]);

  const isLoop =
    points.length > 2 &&
    haversineM(points[0], points[points.length - 1]) <= 25;

  const handleSave = async () => {
    if (points.length < 2 || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim() || 'Untitled route',
        coords: points,
        distanceM,
        isLoop,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the route.');
      setSaving(false);
    }
  };

  return (
    <View className="gap-2 pt-1">
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
          {points.length > 1 && (
            <Polyline
              points={points
                .map((p) => {
                  const s = project(p);
                  return `${s.x},${s.y}`;
                })
                .join(' ')}
              fill="none"
              stroke="#34D399"
              strokeWidth={4}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
        </Svg>
        {points.map((p, i) => {
          const s = project(p);
          return (
            <View
              key={i}
              className="absolute h-5 w-5 items-center justify-center rounded-full border border-white bg-accent"
              style={{ left: s.x - 10, top: s.y - 10 }}
            >
              <Text className="text-[10px] font-bold text-ink">{i + 1}</Text>
            </View>
          );
        })}
        <Pressable
          className="absolute inset-0"
          onPress={handleTap}
        />
        <Text className="absolute bottom-1 right-2 font-mono text-[9px] text-black/60">
          © OpenStreetMap
        </Text>
      </View>
      <Text className="text-[12px] text-muted">
        Tap the map to drop points along the route.{' '}
        {points.length} point{points.length === 1 ? '' : 's'} ·{' '}
        {(distanceM / 1609.34).toFixed(2)} mi{isLoop ? ' · loop' : ''}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Pressable
          className="rounded-full border border-line px-2.5 py-[5px]"
          onPress={() => setPoints((p) => p.slice(0, -1))}
          disabled={points.length === 0}
        >
          <Text className="text-[12px] font-bold text-fog">Undo point</Text>
        </Pressable>
        <Pressable
          className="rounded-full border border-line px-2.5 py-[5px]"
          onPress={() => setPoints([])}
          disabled={points.length === 0}
        >
          <Text className="text-[12px] font-bold text-fog">Clear</Text>
        </Pressable>
      </View>
      <TextInput
        className="rounded-[10px] border border-line bg-ink px-3 py-2.5 text-[14px] text-fog"
        value={name}
        onChangeText={setName}
        placeholder="Route name, e.g. Milledge loop"
        placeholderTextColor="#8A93A6"
      />
      {error ? (
        <Text className="font-mono text-[11px] leading-4 text-warn">{error}</Text>
      ) : null}
      <View className="flex-row gap-2">
        <Pressable
          className={`flex-1 items-center rounded-[10px] bg-accent py-[10px] ${points.length < 2 || saving ? 'opacity-50' : ''}`}
          onPress={() => void handleSave()}
          disabled={points.length < 2 || saving}
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
