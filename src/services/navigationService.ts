/**
 * Turn-by-turn navigation data for a planned route.
 *
 * The route planner already routes through the FOSSGIS OSRM bike
 * endpoint; this service asks that same endpoint for the maneuver
 * steps (steps=true) along a saved route's geometry, so every route
 * already in the database can be navigated without storing anything
 * new. The saved geometry is sampled into via points and re-routed:
 * the returned steps and geometry come from the same response, so
 * the instructions always match the line on the map.
 */
import type { LatLng } from '../components/rideMapGeometry';

export interface NavStep {
  instruction: string;
  roadName: string;
  /** Length of this step in meters (distance until the NEXT maneuver). */
  distanceM: number;
  /** Where this step's maneuver happens. */
  location: LatLng;
  type: string;
  modifier?: string;
}

export interface NavigationRoute {
  steps: NavStep[];
  geometry: LatLng[];
  distanceM: number;
  durationS: number;
}

const ROUTER_URL =
  'https://routing.openstreetmap.de/routed-bike/route/v1/driving';

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

/**
 * Reduce a route geometry to via points for the routing request:
 * the start, a point about every `spacingM` meters, and the end.
 * Too many via points slow the request down; too few let the router
 * wander onto different roads than the saved line.
 */
export function sampleViaPoints(
  coords: LatLng[],
  spacingM = 250,
  maxPoints = 20
): LatLng[] {
  if (coords.length <= 2) return [...coords];
  let spacing = spacingM;
  for (let attempt = 0; attempt < 6; attempt++) {
    const out: LatLng[] = [coords[0]];
    let since = 0;
    for (let i = 1; i < coords.length; i++) {
      since += haversineM(coords[i - 1], coords[i]);
      if (since >= spacing && i < coords.length - 1) {
        out.push(coords[i]);
        since = 0;
      }
    }
    out.push(coords[coords.length - 1]);
    if (out.length <= maxPoints) return out;
    spacing *= 2;
  }
  // Extremely long route: even the doubled spacing overflows, so fall
  // back to an even stride across the geometry.
  const stride = Math.ceil(coords.length / maxPoints);
  const out: LatLng[] = [];
  for (let i = 0; i < coords.length; i += stride) out.push(coords[i]);
  if (out[out.length - 1] !== coords[coords.length - 1]) {
    out.push(coords[coords.length - 1]);
  }
  return out;
}

/** Turn one OSRM maneuver into a rider-readable instruction. */
export function buildInstruction(
  type: string,
  modifier: string | undefined,
  name: string,
  exit?: number
): string {
  const onto = name ? ` onto ${name}` : '';
  const mod = modifier ?? '';
  if (mod === 'uturn') return 'Make a U-turn';
  switch (type) {
    case 'depart':
      return name ? `Head out on ${name}` : 'Head out';
    case 'arrive':
      return 'Arrive at your destination';
    case 'turn':
      if (!mod || mod === 'straight') {
        return name ? `Continue onto ${name}` : 'Continue straight';
      }
      return `Turn ${mod}${onto}`;
    case 'end of road':
      return `At the end of the road, turn ${mod || 'left'}${onto}`;
    case 'continue':
    case 'new name':
      return name ? `Continue on ${name}` : 'Continue straight';
    case 'roundabout':
    case 'rotary': {
      const take = exit ? `, take exit ${exit}` : '';
      return `At the roundabout${take}${onto}`;
    }
    case 'fork':
      return `Keep ${mod || 'straight'}${onto}`;
    case 'merge':
      return name ? `Merge onto ${name}` : 'Merge';
    case 'on ramp':
    case 'off ramp':
      return name ? `Take the ramp onto ${name}` : 'Take the ramp';
    default:
      return name ? `Continue onto ${name}` : 'Continue';
  }
}

interface OsrmStep {
  distance: number;
  name?: string;
  maneuver: {
    type: string;
    modifier?: string;
    location: [number, number];
    exit?: number;
  };
}

/** Flatten an OSRM route response's legs into one step list. */
export function flattenSteps(json: unknown): NavStep[] {
  const root = json as {
    routes?: { legs?: { steps?: OsrmStep[] }[] }[];
  };
  const legs = root.routes?.[0]?.legs ?? [];
  const out: NavStep[] = [];
  for (const leg of legs) {
    for (const step of leg.steps ?? []) {
      const [lng, lat] = step.maneuver.location;
      out.push({
        instruction: buildInstruction(
          step.maneuver.type,
          step.maneuver.modifier,
          step.name ?? '',
          step.maneuver.exit
        ),
        roadName: step.name ?? '',
        distanceM: step.distance,
        location: { lat, lng },
        type: step.maneuver.type,
        modifier: step.maneuver.modifier,
      });
    }
  }
  return out;
}

/** Route a geometry and return its turn-by-turn steps. */
export async function fetchNavigation(
  coords: LatLng[]
): Promise<NavigationRoute> {
  if (coords.length < 2) {
    throw new Error('This route has no path to navigate.');
  }
  const via = sampleViaPoints(coords);
  const coordStr = via.map((p) => `${p.lng},${p.lat}`).join(';');
  const response = await fetch(
    `${ROUTER_URL}/${coordStr}?overview=full&geometries=geojson&steps=true`
  );
  if (!response.ok) {
    throw new Error(`Directions request failed (${response.status}).`);
  }
  const json = (await response.json()) as {
    code?: string;
    message?: string;
    routes?: {
      distance: number;
      duration: number;
      geometry: { coordinates: [number, number][] };
    }[];
  };
  if (json.code !== 'Ok' || !json.routes?.[0]) {
    throw new Error(json.message ?? 'Directions came back empty.');
  }
  const route = json.routes[0];
  return {
    steps: flattenSteps(json),
    geometry: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
    distanceM: route.distance,
    durationS: route.duration,
  };
}

/** Shortest distance from a point to a polyline, in meters. */
export function distanceToRouteM(pos: LatLng, line: LatLng[]): number {
  if (line.length === 0) return Infinity;
  const kx = 111320 * Math.cos((pos.lat * Math.PI) / 180);
  const ky = 110540;
  const px = pos.lng * kx;
  const py = pos.lat * ky;
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const ax = line[i].lng * kx;
    const ay = line[i].lat * ky;
    const bx = i + 1 < line.length ? line[i + 1].lng * kx : ax;
    const by = i + 1 < line.length ? line[i + 1].lat * ky : ay;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t =
      lenSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best) best = d;
  }
  return best;
}

/** Rider-friendly distance: feet for turns coming up, miles beyond. */
export function formatNavDistance(m: number): string {
  if (m < 160) {
    const ft = Math.round((m * 3.28084) / 10) * 10;
    return `${ft} ft`;
  }
  const mi = m / 1609.34;
  return `${mi < 1 ? mi.toFixed(2) : mi.toFixed(1)} mi`;
}
