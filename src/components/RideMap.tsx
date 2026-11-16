import React, { useRef, useState } from 'react';
import { Image, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { DEFAULT_ZOOM, TILE_SIZE, getVisibleTiles, project, type LatLng } from './rideMapGeometry';

export interface RideMapProps {
  followCenter: LatLng | null;
  myPos: LatLng | null;
  riders: ReadonlyArray<{ userId: string; name: string; fix: LatLng }>;
  routeLine: ReadonlyArray<LatLng>;
  trail: ReadonlyArray<LatLng>;
  isActive: boolean;
  onRecenter: () => void;
  onTileError: () => void;
}

function initials(name: string): string {
  return name.replace('@', '').slice(0, 2).toUpperCase() || '?';
}

export default function RideMap({ followCenter, myPos, riders, routeLine, trail, isActive, onTileError }: RideMapProps): React.JSX.Element {
  const [mapSize, setMapSize] = useState({ w: 0, h: 300 });
  const [manualCenter, setManualCenter] = useState<LatLng | null>(null);
  const tileErrorRef = useRef(false);
  const mapCenter = manualCenter ?? followCenter;
  const tiles = mapCenter ? getVisibleTiles(mapCenter, mapSize, DEFAULT_ZOOM) : [];
  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setMapSize({ w: width, h: height });
  };
  const toPoints = (line: ReadonlyArray<LatLng>): string => mapCenter
    ? line.map(p => { const s = project(p, mapCenter, mapSize, DEFAULT_ZOOM); return `${s.x},${s.y}`; }).join(' ')
    : '';
  return (
      <View
        testID="ride-map"
        className="mx-4 overflow-hidden rounded-2xl border border-line bg-panel"
        style={{ height: 300 }}
        onLayout={(e) =>
          handleLayout(e)
        }
      >
        {mapCenter ? (
          <>
            {tiles.map((t) => (
              <Image
                key={t.key}
                source={{ uri: `https://tile.openstreetmap.org/${DEFAULT_ZOOM}/${t.column}/${t.row}.png` }}
                onError={() => {
                  if (!tileErrorRef.current) {
                    tileErrorRef.current = true;
                    onTileError();
                  }
                }}
                style={{
                  position: 'absolute',
                  left: t.left,
                  top: t.top,
                  width: TILE_SIZE,
                  height: TILE_SIZE,
                }}
              />
            ))}
            {mapSize.w > 0 && <Svg
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
            </Svg>}
            {mapSize.w > 0 && riders.map((r) => {
              const s = project(
                { lat: r.fix.lat, lng: r.fix.lng },
                mapCenter,
                mapSize,
                DEFAULT_ZOOM
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
            {mapSize.w > 0 && myPos &&
              (() => {
                const s = project(myPos, mapCenter, mapSize, DEFAULT_ZOOM);
                return (
                  <View
                    className="absolute h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#D4FF00]"
                    style={{ left: s.x - 14, top: s.y - 14 }}
                  >
                    <Text className="text-[10px] font-bold text-ink">YOU</Text>
                  </View>
                );
              })()}
            {routeLine.length > 0 && (
              <Pressable
                className="absolute bottom-2 left-2 rounded-full bg-panel px-2.5 py-1.5"
                accessibilityLabel="Go to route"
                onPress={() => setManualCenter(routeLine[0])}
              >
                <Text className="text-[11px] font-bold text-fog">Go to route</Text>
              </Pressable>
            )}
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

  );
}
