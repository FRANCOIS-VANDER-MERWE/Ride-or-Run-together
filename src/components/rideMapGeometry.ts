export interface LatLng { lat: number; lng: number }
export interface MapSize { w: number; h: number }
export interface ScreenPoint { x: number; y: number }
export interface MapTile { key: string; column: number; row: number; left: number; top: number }

export const TILE_SIZE = 256;
export const DEFAULT_ZOOM = 16;
export const MIN_ZOOM = 10;
export const MAX_ZOOM = 18;
const MAX_LAT = 85.05112878;
const wrap = (value: number, modulus: number) => ((value % modulus) + modulus) % modulus;
const latitude = (lat: number) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
const longitude = (lng: number) => wrap(lng + 180, 360) - 180;

export function clampZoom(zoom: number): number {
  return Number.isFinite(zoom) ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom))) : DEFAULT_ZOOM;
}

function worldPoint(point: LatLng, zoom: number): ScreenPoint {
  const world = TILE_SIZE * 2 ** zoom;
  const s = Math.sin(latitude(point.lat) * Math.PI / 180);
  return {
    x: (longitude(point.lng) + 180) / 360 * world,
    y: Math.max(0, Math.min(world, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world)),
  };
}

export function project(point: LatLng, center: LatLng, size: MapSize, zoom: number): ScreenPoint {
  const p = worldPoint(point, zoom);
  const c = worldPoint(center, zoom);
  const world = TILE_SIZE * 2 ** zoom;
  return { x: wrap(p.x - c.x + world / 2, world) - world / 2 + size.w / 2, y: p.y - c.y + size.h / 2 };
}

export function panCenter(center: LatLng, delta: ScreenPoint, zoom: number): LatLng {
  const c = worldPoint(center, zoom);
  const world = TILE_SIZE * 2 ** zoom;
  const y = Math.max(0, Math.min(world, c.y - delta.y));
  return {
    lat: latitude(180 / Math.PI * Math.atan(Math.sinh(Math.PI * (1 - 2 * y / world)))),
    lng: longitude((c.x - delta.x) / world * 360 - 180),
  };
}

export function getVisibleTiles(center: LatLng, size: MapSize, zoom: number): MapTile[] {
  if (size.w <= 0 || size.h <= 0) return [];
  const c = worldPoint(center, zoom);
  const left = c.x - size.w / 2;
  const top = c.y - size.h / 2;
  const count = 2 ** zoom;
  const tiles: MapTile[] = [];
  for (let x = Math.floor(left / TILE_SIZE); x <= Math.floor((left + size.w) / TILE_SIZE); x++) {
    for (let y = Math.max(0, Math.floor(top / TILE_SIZE)); y <= Math.min(count - 1, Math.floor((top + size.h) / TILE_SIZE)); y++) {
      tiles.push({ key: `${zoom}/${x}/${y}`, column: wrap(x, count), row: y, left: x * TILE_SIZE - left, top: y * TILE_SIZE - top });
    }
  }
  return tiles;
}
