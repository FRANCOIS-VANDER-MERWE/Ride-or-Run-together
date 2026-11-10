/**
 * Routes, live location pings, and per-rider session metrics.
 * PostGIS geography columns are written and read as GeoJSON.
 */
import { requireSupabase } from './supabaseClient';
import type {
  GeoJsonLineString,
  GeoJsonPoint,
  LocationPingRow,
  RideMetricsRow,
  RouteRow,
} from './database.types';

export function pointGeoJson(lat: number, lng: number): GeoJsonPoint {
  return { type: 'Point', coordinates: [lng, lat] };
}

export function lineStringGeoJson(
  coords: { lat: number; lng: number }[]
): GeoJsonLineString {
  return {
    type: 'LineString',
    coordinates: coords.map((c) => [c.lng, c.lat] as [number, number]),
  };
}

export interface CreateRouteInput {
  name: string;
  description?: string;
  coords: { lat: number; lng: number }[];
  distanceM: number;
  estDurationS?: number;
  isLoop?: boolean;
}

/**
 * Spatial values go in as EWKT strings, not GeoJSON objects. A GeoJSON
 * Point object inserts fine through the API (location_pings proves
 * it), but a GeoJSON LineString object comes back with
 * 'parse error - invalid geometry'. EWKT is the native input format
 * for geography columns, and reads still come back as GeoJSON, so
 * nothing downstream changes.
 */
function pointEwkt(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

function lineStringEwkt(coords: { lat: number; lng: number }[]): string {
  const deduped = coords.filter(
    (c, i) =>
      i === 0 || c.lat !== coords[i - 1].lat || c.lng !== coords[i - 1].lng
  );
  if (deduped.length < 2) {
    throw new Error(
      'Those points are all in the same spot. Spread them out along the route.'
    );
  }
  const body = deduped.map((c) => `${c.lng} ${c.lat}`).join(',');
  return `SRID=4326;LINESTRING(${body})`;
}

export async function createRoute(
  userId: string,
  input: CreateRouteInput
): Promise<RouteRow> {
  if (input.coords.length < 2) {
    throw new Error('A route needs at least two points.');
  }
  const db = requireSupabase();
  const first = input.coords[0];
  const last = input.coords[input.coords.length - 1];
  const { data, error } = await db
    .from('routes')
    .insert({
      created_by: userId,
      name: input.name,
      description: input.description ?? null,
      path: lineStringEwkt(input.coords) as unknown as GeoJsonLineString,
      start_point: pointEwkt(
        first.lat,
        first.lng
      ) as unknown as GeoJsonPoint,
      end_point: pointEwkt(last.lat, last.lng) as unknown as GeoJsonPoint,
      is_loop: input.isLoop ?? false,
      distance_m: Math.round(input.distanceM),
      est_duration_s: input.estDurationS ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(`[Supabase] createRoute: ${error.message}`);
  return data;
}

/**
 * Spatial reads can arrive in several wire formats depending on the
 * API path: a GeoJSON object, a GeoJSON string, WKT or EWKT text, or
 * hex-encoded WKB (the geography type's raw form, which is what this
 * project actually sends back). Decode all of them into the GeoJSON
 * shapes the app types expect. Failures name the format sample so a
 * bad shape is diagnosable from the error alone.
 */
function wkbCoords(hex: string, wantType: 1 | 2): [number, number][] {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  const view = new DataView(bytes.buffer);
  const little = view.getUint8(0) === 1;
  let offset = 1;
  const rawType = view.getUint32(offset, little);
  offset += 4;
  const baseType = rawType & 0xff;
  if (baseType !== wantType) {
    throw new Error(`WKB type ${baseType}, expected ${wantType}.`);
  }
  if (rawType & 0x20000000) offset += 4; // SRID flag
  const readPoint = (): [number, number] => {
    const lng = view.getFloat64(offset, little);
    const lat = view.getFloat64(offset + 8, little);
    offset += 16;
    return [lng, lat];
  };
  if (wantType === 1) return [readPoint()];
  const count = view.getUint32(offset, little);
  offset += 4;
  const coords: [number, number][] = [];
  for (let i = 0; i < count; i++) coords.push(readPoint());
  return coords;
}

function decodeSpatial(value: unknown, wantType: 1 | 2): [number, number][] {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.startsWith('{')) {
      return decodeSpatial(JSON.parse(text) as unknown, wantType);
    }
    const wkt = text.match(/(POINT|LINESTRING)\s*\(([^)]*)\)/i);
    if (wkt) {
      return wkt[2].split(',').map((pair) => {
        const [lng, lat] = pair.trim().split(/\s+/).map(Number);
        return [lng, lat] as [number, number];
      });
    }
    if (/^[0-9a-fA-F]+$/.test(text) && text.length % 2 === 0) {
      return wkbCoords(text, wantType);
    }
    throw new Error(
      `Unreadable spatial value (starts with "${text.slice(0, 24)}").`
    );
  }
  const geo = value as { coordinates?: unknown };
  if (geo && Array.isArray(geo.coordinates)) {
    if (wantType === 1) {
      return [geo.coordinates as [number, number]];
    }
    return geo.coordinates as [number, number][];
  }
  throw new Error(
    `Unreadable spatial value (starts with "${JSON.stringify(value)?.slice(0, 24) ?? 'null'}").`
  );
}

function normalizeLineString(value: unknown): GeoJsonLineString {
  return { type: 'LineString', coordinates: decodeSpatial(value, 2) };
}

function normalizePoint(value: unknown): GeoJsonPoint {
  return { type: 'Point', coordinates: decodeSpatial(value, 1)[0] };
}

export async function fetchRoute(routeId: string): Promise<RouteRow | null> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('routes')
    .select('*')
    .eq('route_id', routeId)
    .maybeSingle();
  if (error) throw new Error(`[Supabase] fetchRoute: ${error.message}`);
  if (!data) return null;
  return { ...data, path: normalizeLineString(data.path) };
}

export async function fetchRoutes(limit = 50): Promise<RouteRow[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('routes')
    .select('*')
    .is('deleted_at', null)
    .order('times_ridden', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`[Supabase] fetchRoutes: ${error.message}`);
  return data ?? [];
}

export interface LocationPingInput {
  lat: number;
  lng: number;
  altitudeM?: number;
  accuracyM?: number;
  speedMps?: number;
  headingDeg?: number;
}

/** One GPS fix. High-frequency: callers should batch or throttle. */
export async function insertLocationPing(
  sessionId: string,
  userId: string,
  ping: LocationPingInput
): Promise<void> {
  const db = requireSupabase();
  const { error } = await db.from('location_pings').insert({
    session_id: sessionId,
    user_id: userId,
    recorded_at: new Date().toISOString(),
    location: pointGeoJson(ping.lat, ping.lng),
    altitude_m: ping.altitudeM ?? null,
    accuracy_m: ping.accuracyM ?? null,
    speed_mps: ping.speedMps ?? null,
    heading_deg: ping.headingDeg ?? null,
  });
  if (error) throw new Error(`[Supabase] insertLocationPing: ${error.message}`);
}

export async function insertLocationPings(
  sessionId: string,
  userId: string,
  pings: (LocationPingInput & { recordedAt: string })[]
): Promise<void> {
  if (pings.length === 0) return;
  const db = requireSupabase();
  const { error } = await db.from('location_pings').insert(
    pings.map((p) => ({
      session_id: sessionId,
      user_id: userId,
      recorded_at: p.recordedAt,
      location: pointGeoJson(p.lat, p.lng),
      altitude_m: p.altitudeM ?? null,
      accuracy_m: p.accuracyM ?? null,
      speed_mps: p.speedMps ?? null,
      heading_deg: p.headingDeg ?? null,
    }))
  );
  if (error) throw new Error(`[Supabase] insertLocationPings: ${error.message}`);
}

/**
 * Latest ping per participant in a session: one page of recent pings,
 * reduced client-side. For the live map, prefer Realtime broadcast of
 * fixes (joinPackRealtimeSession) and use this for catch-up.
 */
export async function fetchLatestPings(
  sessionId: string
): Promise<Map<string, LocationPingRow>> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('location_pings')
    .select('*')
    .eq('session_id', sessionId)
    .order('recorded_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(`[Supabase] fetchLatestPings: ${error.message}`);
  const latest = new Map<string, LocationPingRow>();
  for (const row of data ?? []) {
    if (latest.has(row.user_id)) continue;
    try {
      latest.set(row.user_id, {
        ...row,
        location: normalizePoint(row.location),
      });
    } catch {
      // Skip a ping whose location cannot be decoded.
    }
  }
  return latest;
}

export async function upsertRideMetrics(
  metrics: Omit<RideMetricsRow, 'computed_at' | 'recorded_path'> & {
    recordedPath?: GeoJsonLineString | null;
  }
): Promise<void> {
  const db = requireSupabase();
  const { recordedPath, ...rest } = metrics;
  const { error } = await db.from('ride_metrics').upsert(
    { ...rest, recorded_path: recordedPath ?? null },
    { onConflict: 'session_id,user_id' }
  );
  if (error) throw new Error(`[Supabase] upsertRideMetrics: ${error.message}`);
}

export async function fetchSessionMetrics(
  sessionId: string
): Promise<RideMetricsRow[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('ride_metrics')
    .select('*')
    .eq('session_id', sessionId);
  if (error) {
    throw new Error(`[Supabase] fetchSessionMetrics: ${error.message}`);
  }
  return data ?? [];
}
