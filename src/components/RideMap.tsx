import React, { useRef, useState } from 'react';
import { Image, Platform, Pressable, Text, View, type LayoutChangeEvent, type GestureResponderEvent } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM, TILE_SIZE, clampZoom, getVisibleTiles, panCenter, project, type LatLng } from './rideMapGeometry';
import { tileUrl, TILE_ATTRIBUTION_LABEL } from './mapTiles';

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

export default function RideMap({ followCenter, myPos, riders, routeLine, trail, isActive, onRecenter, onTileError }: RideMapProps): React.JSX.Element {
  const [mapSize, setMapSize] = useState({ w: 0, h: 300 });
  const [manualCenter, setManualCenter] = useState<LatLng | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const dragAnchor = useRef<{ center: LatLng; zoom: number; x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const mouseButtons = useRef(0);
  const tileErrorRef = useRef(false);
  const mapCenter = manualCenter ?? followCenter;
  const tiles = mapCenter ? getVisibleTiles(mapCenter, mapSize, zoom) : [];
  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setMapSize({ w: width, h: height });
  };
  const segments = (line: ReadonlyArray<LatLng>): string[] => {
    if (!mapCenter || mapSize.w <= 0) return [];
    const result: string[] = [];
    let points: string[] = [];
    let lastX: number | undefined;
    for (const point of line) {
      const p = project(point, mapCenter, mapSize, zoom);
      if (lastX !== undefined && Math.abs(p.x - lastX) > TILE_SIZE * 2 ** zoom / 2) {
        if (points.length > 1) result.push(points.join(' '));
        points = [];
      }
      points.push(`${p.x},${p.y}`);
      lastX = p.x;
    }
    if (points.length > 1) result.push(points.join(' '));
    return result;
  };
  const clearDrag = () => { dragAnchor.current = null; dragging.current = false; };
  const singlePointer = (e: GestureResponderEvent) => {
    const native = e.nativeEvent as typeof e.nativeEvent & { buttons?: number; type?: string };
    // React Native Web strips buttons from responder events; mouse handlers retain it.
    const buttons = native.buttons ?? (native.type?.startsWith('mouse') ? mouseButtons.current : undefined);
    if (native.touches.length !== 1 || (buttons !== undefined && (buttons & 1) === 0)) {
      clearDrag();
      return false;
    }
    return true;
  };
  const beginDrag = (e: GestureResponderEvent) => {
    clearDrag();
    if (singlePointer(e) && mapCenter) {
      dragAnchor.current = { center: mapCenter, zoom, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
    }
    return false;
  };
  const shouldPan = (e: GestureResponderEvent) => {
    if (!singlePointer(e) || !dragAnchor.current) return false;
    return Math.abs(e.nativeEvent.pageX - dragAnchor.current.x) > 8 || Math.abs(e.nativeEvent.pageY - dragAnchor.current.y) > 8;
  };
  const moveDrag = (e: GestureResponderEvent) => {
    if (!singlePointer(e) || !dragAnchor.current || (!dragging.current && !shouldPan(e))) return;
    dragging.current = true;
    const anchor = dragAnchor.current!;
    setManualCenter(panCenter(anchor.center, { x: e.nativeEvent.pageX - anchor.x, y: e.nativeEvent.pageY - anchor.y }, anchor.zoom));
  };
  const webMouseHandlers = Platform.OS === 'web' ? {
    onMouseDown: (e: React.MouseEvent) => { mouseButtons.current = e.nativeEvent.buttons; },
    onMouseMove: (e: React.MouseEvent) => {
      mouseButtons.current = e.nativeEvent.buttons;
      if ((mouseButtons.current & 1) === 0) clearDrag();
    },
    onMouseUp: () => { mouseButtons.current = 0; clearDrag(); },
  } : {};
  const changeZoom = (delta: number) => { clearDrag(); setZoom(value => clampZoom(value + delta)); };
  const recenter = () => {
    if (!myPos) return;
    clearDrag(); setManualCenter(null); onRecenter();
  };

  return (
    <View
      testID="ride-map"
      className="mx-4 overflow-hidden rounded-2xl border border-line bg-panel"
      style={{ height: 300 }}
      onLayout={handleLayout}
    >
      {mapCenter ? (
        <>
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
            {tiles.map(t => (
              <Image
                key={t.key}
                source={{ uri: tileUrl(zoom, t.column, t.row) }}
                onError={() => {
                  if (!tileErrorRef.current) {
                    tileErrorRef.current = true;
                    onTileError();
                  }
                }}
                style={{ position: 'absolute', left: t.left, top: t.top, width: TILE_SIZE, height: TILE_SIZE }}
              />
            ))}
            {mapSize.w > 0 && (
              <Svg width={mapSize.w} height={mapSize.h} style={{ position: 'absolute', left: 0, top: 0 }}>
                {segments(routeLine).map((points, index) => (
                  <Polyline key={`route/${index}`} points={points} fill="none" stroke="#34D399" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {segments(trail).map((points, index) => (
                  <Polyline key={`trail/${index}`} points={points} fill="none" stroke="#D4FF00" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
                ))}
              </Svg>
            )}
            {mapSize.w > 0 && riders.map(r => {
              const s = project(r.fix, mapCenter, mapSize, zoom);
              if (s.x < -20 || s.y < -20 || s.x > mapSize.w + 20 || s.y > mapSize.h + 20) return null;
              return (
                <View key={r.userId} className="absolute h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-accent" style={{ left: s.x - 14, top: s.y - 14 }}>
                  <Text className="text-[10px] font-bold text-ink">{initials(r.name)}</Text>
                </View>
              );
            })}
            {mapSize.w > 0 && myPos && (() => {
              const s = project(myPos, mapCenter, mapSize, zoom);
              return (
                <View className="absolute h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#D4FF00]" style={{ left: s.x - 14, top: s.y - 14 }}>
                  <Text className="text-[10px] font-bold text-ink">YOU</Text>
                </View>
              );
            })()}
          </View>
          <View
            testID="ride-map-pan-surface"
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, ...(Platform.OS === 'web' ? { touchAction: 'none', userSelect: 'none' } as const : {}) }}
            {...webMouseHandlers}
            onStartShouldSetResponder={beginDrag}
            onMoveShouldSetResponder={shouldPan}
            onResponderGrant={moveDrag}
            onResponderMove={moveDrag}
            onResponderStart={e => { if (!singlePointer(e)) clearDrag(); }}
            onResponderEnd={clearDrag}
            onResponderRelease={clearDrag}
            onResponderTerminate={clearDrag}
            onResponderTerminationRequest={() => false}
            onResponderReject={clearDrag}
          />
          <View className="absolute right-2 top-2 gap-1">
            {[
              { label: 'Zoom in', text: '+', disabled: zoom === MAX_ZOOM, press: () => changeZoom(1) },
              { label: 'Zoom out', text: '−', disabled: zoom === MIN_ZOOM, press: () => changeZoom(-1) },
              { label: 'Recenter on me', text: '◎', disabled: !myPos, press: recenter },
            ].map(control => (
              <Pressable
                key={control.label}
                accessibilityRole="button"
                accessibilityLabel={control.label}
                accessibilityState={{ disabled: control.disabled }}
                disabled={control.disabled}
                onPress={control.press}
                className="items-center justify-center rounded-xl border border-line bg-panel"
                style={{ width: 44, height: 44, opacity: control.disabled ? 0.4 : 1 }}
              >
                <Text className="text-[24px] font-bold text-fog">{control.text}</Text>
              </Pressable>
            ))}
          </View>
          {routeLine.length > 0 && (
            <Pressable
              className="absolute bottom-2 left-2 rounded-full bg-panel px-2.5 py-1.5"
              accessibilityLabel="Go to route"
              accessibilityRole="button"
              style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}
              onPress={() => { clearDrag(); setManualCenter(routeLine[0]); }}
            >
              <Text className="text-[11px] font-bold text-fog">Go to route</Text>
            </Pressable>
          )}
          <Text pointerEvents="none" className="absolute bottom-1 right-2 font-mono text-[9px] text-black/60">{TILE_ATTRIBUTION_LABEL}</Text>
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
