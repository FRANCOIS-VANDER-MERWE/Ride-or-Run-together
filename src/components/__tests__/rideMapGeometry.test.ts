import { expect, test } from 'vitest';
import { clampZoom, getVisibleTiles, panCenter, project } from '../rideMapGeometry';

const center = { lat: 0, lng: 0 };
const size = { w: 512, h: 300 };

test('projection centers the camera and scales displacement with zoom', () => {
  expect(project(center, center, size, 16)).toEqual({ x: 256, y: 150 });
  const point = { lat: 0.001, lng: 0.001 };
  const a = project(point, center, size, 15);
  const b = project(point, center, size, 16);
  expect(b.x - 256).toBeCloseTo(2 * (a.x - 256));
  expect(b.y - 150).toBeCloseTo(2 * (a.y - 150));
});
test('drag direction matches the pointer', () => {
  expect(panCenter(center, { x: 256, y: 0 }, 10).lng).toBeCloseTo(-360 / 1024);
  expect(panCenter(center, { x: 0, y: 256 }, 10).lat).toBeGreaterThan(0);
});
test('zoom is rounded, bounded, and defaults on nonfinite input', () => {
  for (const [input, expected] of [[9, 10], [19, 18], [16.4, 16], [NaN, 16], [Infinity, 16]]) {
    expect(clampZoom(input)).toBe(expected);
  }
});
test('zero drag preserves center', () => {
  const point = { lat: 33.95, lng: -83.35 };
  const result = panCenter(point, { x: 0, y: 0 }, 16);
  expect(result.lat).toBeCloseTo(point.lat, 9);
  expect(result.lng).toBeCloseTo(point.lng, 9);
});
test('pan followed by inverse pan returns center', () => {
  const point = { lat: 33.95, lng: 179.999 };
  const result = panCenter(panCenter(point, { x: 200, y: -123 }, 16), { x: -200, y: 123 }, 16);
  expect(result.lat).toBeCloseTo(point.lat, 9);
  expect(result.lng).toBeCloseTo(point.lng, 9);
});
test('polar projection and pan remain finite', () => {
  for (const lat of [-90, 90]) {
    const point = project({ lat, lng: 540 }, center, size, 16);
    const camera = panCenter({ lat, lng: 540 }, { x: 100, y: 1e9 }, 16);
    expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    expect(Math.abs(camera.lat)).toBeLessThanOrEqual(85.05112878);
    expect(camera.lng).toBeGreaterThanOrEqual(-180);
    expect(camera.lng).toBeLessThan(180);
  }
});
test('point across antimeridian stays near center', () => {
  expect(Math.abs(project({ lat: 0, lng: -179.999 }, { lat: 0, lng: 179.999 }, size, 10).x - 256)).toBeLessThan(2);
});
test('tiles ignore empty layouts and wrap columns without duplicating keys', () => {
  expect(getVisibleTiles(center, { w: 0, h: 300 }, 16)).toEqual([]);
  expect(getVisibleTiles(center, { w: 512, h: -1 }, 16)).toEqual([]);
  for (const lat of [-90, 90]) {
    const tiles = getVisibleTiles({ lat, lng: 179.999 }, { w: 300000, h: 300 }, 10);
    expect(tiles.length).toBeGreaterThan(0);
    expect(new Set(tiles.map(t => t.key)).size).toBe(tiles.length);
    for (const tile of tiles) {
      expect(tile.column).toBeGreaterThanOrEqual(0);
      expect(tile.column).toBeLessThan(1024);
      expect(tile.row).toBeGreaterThanOrEqual(0);
      expect(tile.row).toBeLessThan(1024);
      expect(Number.isFinite(tile.left) && Number.isFinite(tile.top)).toBe(true);
    }
  }
});
