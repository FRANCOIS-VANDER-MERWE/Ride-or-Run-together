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
      path: lineStringGeoJson(input.coords),
      start_point: pointGeoJson(first.lat, first.lng),
      end_point: pointGeoJson(last.lat, last.lng),
      is_loop: input.isLoop ?? false,
      distance_m: Math.round(input.distanceM),
      est_duration_s: input.estDurationS ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(`[Supabase] createRoute: ${error.message}`);
  return data;
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
    if (!latest.has(row.user_id)) latest.set(row.user_id, row);
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
