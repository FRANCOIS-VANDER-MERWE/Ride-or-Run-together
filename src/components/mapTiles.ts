/**
 * The one place that knows where map tiles come from: Esri World
 * Street Map. Both map components (RideMap, RoutePlanner) build tile
 * URLs through here, so changing providers is a one-file edit.
 *
 * Migrated off tile.openstreetmap.org on Nov 16, 2026: the OSM tile
 * CDN is blocked on mobile. Esri serves real tiles with no API key.
 * Note the URL order: Esri paths are tile/{z}/{y}/{x}, not the more
 * common {z}/{x}/{y}.
 *
 * Full source attribution for World Street Map: Esri, HERE, Garmin,
 * USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China
 * (Hong Kong), Esri (Thailand), NGCC, (c) OpenStreetMap contributors,
 * and the GIS User Community. The on-map label uses the short form.
 */
export const TILE_ATTRIBUTION_LABEL = 'Esri, © OpenStreetMap contributors';

export function tileUrl(z: number, x: number, y: number): string {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`;
}
