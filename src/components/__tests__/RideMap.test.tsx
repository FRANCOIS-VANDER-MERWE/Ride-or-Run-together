import React from 'react';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, expect, test, vi } from 'vitest';
vi.mock('react-native-svg', () => ({ default: 'Svg', Polyline: 'Polyline' }));
import RideMap, { type RideMapProps } from '../RideMap';
import { panCenter, project, getVisibleTiles, type LatLng } from '../rideMapGeometry';
import { tileUrl } from '../mapTiles';

let root: ReactTestRenderer;
const origin = { lat: 0, lng: 0 };
const line = [origin, { lat: 0.001, lng: 0.001 }];
const defaults = (): RideMapProps => ({ followCenter: origin, myPos: origin, riders: [{ userId: 'rider', name: 'Rider', fix: origin }], routeLine: line, trail: line, isActive: true, onRecenter: vi.fn(), onTileError: vi.fn() });
const text = (n: ReactTestInstance | string): string => typeof n === 'string' ? n : n.children.map(text).join('');
const images = () => root.root.findAllByType('Image' as any);
const layout = async (width = 512, height = 300) => {
  await act(async () => root.root.findByProps({ testID: 'ride-map' }).props.onLayout({ nativeEvent: { layout: { width, height } } }));
};
const mount = async (props = defaults(), key = 'A') => {
  await act(async () => { root = create(<RideMap key={key} {...props} />); });
};
afterEach(async () => { if (root) await act(async () => root.unmount()); });

test('renders existing layers', async () => {
  await mount(); await layout();
  expect(images().length).toBeGreaterThan(0);
  expect(images().every(i => i.props.source.uri.includes('/16/'))).toBe(true);
  expect(root.root.findAllByType('Polyline' as any)).toHaveLength(2);
  expect(text(root.root)).toContain('RI');
  expect(text(root.root)).toContain('YOU');
  expect(text(root.root)).toContain('© OpenStreetMap');
  expect(root.root.findByProps({ testID: 'ride-map' }).props.style.height).toBe(300);
});
test.each([true, false])('keeps placeholders (active=%s)', async isActive => {
  await mount({ ...defaults(), followCenter: null, myPos: null, riders: [], routeLine: [], isActive });
  await layout();
  expect(text(root.root)).toBe(isActive ? 'Waiting for GPS fixes. The map fills in as riders share their location.' : 'The map goes live when the host starts the session.');
  expect(images()).toHaveLength(0);
  expect(root.root.findAllByProps({ accessibilityLabel: 'Zoom in' })).toHaveLength(0);
});
test('waits for positive width', async () => {
  await mount(); await layout(0);
  expect(images()).toHaveLength(0);
  expect(root.root.findAllByType('Polyline' as any)).toHaveLength(0);
  await layout(); expect(images().length).toBeGreaterThan(0);
});
test('reports tile error once', async () => {
  const props = defaults(); await mount(props); await layout();
  await act(async () => { images()[0].props.onError(); images()[1].props.onError(); });
  expect(props.onTileError).toHaveBeenCalledOnce();
});

const surface = () => root.root.findByProps({ testID: 'ride-map-pan-surface' });
const button = (label: string) => root.root.findByProps({ accessibilityLabel: label });
const press = async (label: string, times = 1) => {
  await act(async () => { for (let i = 0; i < times; i++) button(label).props.onPress(); });
};
const event = (x: number, y = 0, count = 1, buttons?: number): any => ({ nativeEvent: { pageX: x, pageY: y, touches: Array.from({ length: count }, () => ({ pageX: x, pageY: y })), ...(buttons === undefined ? {} : { buttons }) } });
const drag = async (x: number, y = 0) => {
  await act(async () => { surface().props.onStartShouldSetResponder(event(0)); });
  expect(surface().props.onMoveShouldSetResponder(event(x, y))).toBe(true);
  await act(async () => surface().props.onResponderGrant(event(x, y)));
  await act(async () => surface().props.onResponderMove(event(x, y)));
  await act(async () => surface().props.onResponderRelease(event(x, y)));
};
const update = async (props: RideMapProps, key = 'A') => {
  await act(async () => root.update(<RideMap key={key} {...props} />));
};
const marker = (label: string) => root.root.findAllByType('Text' as any).find(n => text(n) === label)!.parent!;
const expectViewport = (camera: LatLng, zoom: number, props: RideMapProps, size = { w: 512, h: 300 }) => {
  const tiles = getVisibleTiles(camera, size, zoom);
  expect(images().map(i => i.props.source.uri)).toEqual(tiles.map(t => tileUrl(zoom, t.column, t.row)));
  images().forEach((image, index) => {
    expect(image.props.style.left).toBeCloseTo(tiles[index].left, 6);
    expect(image.props.style.top).toBeCloseTo(tiles[index].top, 6);
  });
  const lines = root.root.findAllByType('Polyline' as any);
  [props.routeLine, props.trail].forEach((line, index) => {
    const expected = line.map(p => { const point = project(p, camera, size, zoom); return `${point.x},${point.y}`; }).join(' ');
    expect(lines[index].props.points).toBe(expected);
  });
  if (props.myPos) {
    const expected = project(props.myPos, camera, size, zoom);
    expect(marker('YOU').props.style.left).toBeCloseTo(expected.x - 14);
    expect(marker('YOU').props.style.top).toBeCloseTo(expected.y - 14);
  }
};

test('zoom in and out', async () => {
  await mount(); await layout();
  await press('Zoom in'); expect(images()[0].props.source.uri).toContain('/17/');
  await press('Zoom out'); expect(images()[0].props.source.uri).toContain('/16/');
  await press('Zoom in', 12); expect(images()[0].props.source.uri).toContain('/18/');
  expect(button('Zoom in').props.disabled).toBe(true);
  expect(button('Zoom in').props.accessibilityState.disabled).toBe(true);
  await press('Zoom out', 20); expect(images()[0].props.source.uri).toContain('/10/');
  expect(button('Zoom out').props.disabled).toBe(true);
  expect(button('Zoom out').props.accessibilityState.disabled).toBe(true);
});
test.each([0, 179.999])('uses one viewport for every layer (longitude=%s)', async lng => {
  const camera = { lat: 0, lng };
  const points = [camera, { lat: 0.001, lng: lng === 0 ? 0.001 : -179.999 }];
  const props = { ...defaults(), followCenter: camera, myPos: camera, riders: [{ userId: 'rider', name: 'Rider', fix: points[1] }], routeLine: points, trail: points };
  await mount(props); await layout(); await drag(32, 20);
  const manual = panCenter(camera, { x: 32, y: 20 }, 16);
  expectViewport(manual, 16, props);
  const rider = project(points[1], manual, { w: 512, h: 300 }, 16);
  expect(marker('RI').props.style.left).toBeCloseTo(rider.x - 14);
  await press('Zoom in'); expectViewport(manual, 17, props);
});
test('drag threshold and direction', async () => {
  await mount(); await layout();
  expect(surface().props.onStartShouldSetResponder(event(0))).toBe(false);
  expect(surface().props.onMoveShouldSetResponder(event(8, 8))).toBe(false);
  expect(surface().props.onMoveShouldSetResponder(event(9))).toBe(true);
  expect(surface().props.onMoveShouldSetResponder(event(0, 9))).toBe(true);
  await drag(256);
  expect(marker('YOU').props.style.left).toBeCloseTo(498);
  const camera = panCenter(origin, { x: 256, y: 0 }, 16);
  expect(camera.lng).toBeCloseTo(-360 / 65536);
  expectViewport(camera, 16, defaults());
});
test('camera survives live updates', async () => {
  let props = defaults(); await mount(props); await layout(); await drag(32);
  const camera = panCenter(origin, { x: 32, y: 0 }, 16);
  props = { ...props, myPos: { lat: 0.002, lng: 0.002 }, followCenter: { lat: 0.002, lng: 0.002 } };
  await update(props); expectViewport(camera, 16, props);
  props = { ...props, routeLine: [{ lat: 1, lng: 1 }, { lat: 1.001, lng: 1.001 }], followCenter: { lat: 1, lng: 1 } };
  await update(props); expectViewport(camera, 16, props);
});
test('recenter resumes follow', async () => {
  let props = defaults(); await mount(props); await layout(); await drag(32);
  await press('Recenter on me'); expect(props.onRecenter).toHaveBeenCalledOnce();
  props = { ...props, followCenter: props.myPos };
  await update(props); expectViewport(origin, 16, props);
  props = { ...props, followCenter: { lat: 0.002, lng: 0.002 }, myPos: { lat: 0.002, lng: 0.002 } };
  await update(props); expectViewport(props.followCenter!, 16, props);
  props = { ...props, myPos: null }; await update(props);
  expect(button('Recenter on me').props.disabled).toBe(true);
  expect(button('Recenter on me').props.accessibilityState.disabled).toBe(true);
});
test('route action suspends follow', async () => {
  const start = { lat: 0.001, lng: 0.001 };
  let props = { ...defaults(), routeLine: [start, { lat: 0.002, lng: 0.002 }] };
  await mount(props); await layout(); await press('Zoom in'); await press('Go to route');
  props = { ...props, followCenter: { lat: 0.003, lng: 0.003 }, myPos: { lat: 0.003, lng: 0.003 } };
  await update(props); expectViewport(start, 17, props);
  await press('Recenter on me'); await update({ ...props, followCenter: props.myPos });
  expectViewport(props.myPos!, 17, props);
});
test('controls and interruption', async () => {
  const props = defaults(); await mount(props); await layout();
  expect(button('Zoom in').parent).not.toBe(surface());
  await drag(32);
  let camera = panCenter(origin, { x: 32, y: 0 }, 16);
  surface().props.onStartShouldSetResponder(event(0));
  await act(async () => surface().props.onResponderGrant(event(16)));
  camera = panCenter(camera, { x: 16, y: 0 }, 16);
  await act(async () => surface().props.onResponderTerminate(event(16)));
  await act(async () => surface().props.onResponderMove(event(200)));
  expectViewport(camera, 16, props);
  await drag(16); camera = panCenter(camera, { x: 16, y: 0 }, 16);
  surface().props.onStartShouldSetResponder(event(0));
  await act(async () => surface().props.onResponderStart(event(0, 0, 2)));
  expect(surface().props.onMoveShouldSetResponder(event(50, 0, 2))).toBe(false);
  await act(async () => surface().props.onResponderMove(event(50, 0, 1)));
  expectViewport(camera, 16, props);
  surface().props.onStartShouldSetResponder(event(0, 0, 1, 0));
  expect(surface().props.onMoveShouldSetResponder(event(50, 0, 1, 0))).toBe(false);
  surface().props.onStartShouldSetResponder(event(0, 0, 1, 2));
  expect(surface().props.onMoveShouldSetResponder(event(50, 0, 1, 2))).toBe(false);
  surface().props.onStartShouldSetResponder(event(0, 0, 1, 1));
  await act(async () => surface().props.onResponderMove(event(50, 0, 1, 0)));
  expectViewport(camera, 16, props);
});
test('layout and activity lifetime', async () => {
  const props = defaults(); await mount(props); await layout(); await drag(32); await press('Zoom in');
  const camera = panCenter(origin, { x: 32, y: 0 }, 16);
  await layout(320); expectViewport(camera, 17, props, { w: 320, h: 300 });
  await layout(0); await update(props); expectViewport(camera, 17, props, { w: 320, h: 300 });
  await update(props, 'B'); await layout(); expectViewport(origin, 16, props);
});
test('splits lines at the opposite longitude seam', async () => {
  const props = { ...defaults(), routeLine: [{ lat: 0, lng: 179.999 }, { lat: 0, lng: -179.999 }], trail: [] };
  await mount(props); await layout();
  expect(root.root.findAllByType('Polyline' as any)).toHaveLength(0);
});

test('an acquired drag can return through the initial threshold', async () => {
  await mount(); await layout();
  surface().props.onStartShouldSetResponder(event(0));
  await act(async () => surface().props.onResponderGrant(event(32)));
  await act(async () => surface().props.onResponderMove(event(0)));
  expect(marker('YOU').props.style.left).toBeCloseTo(242);
});

test('web mouse handlers retain primary-button state for normalized responder events', async () => {
  await mount(); await layout();
  const mouse = (x: number) => ({ nativeEvent: { ...event(x).nativeEvent, type: 'mousemove' } });
  surface().props.onMouseDown({ nativeEvent: { buttons: 1 } });
  surface().props.onStartShouldSetResponder(mouse(0));
  expect(surface().props.onMoveShouldSetResponder(mouse(32))).toBe(true);
  await act(async () => surface().props.onResponderGrant(mouse(32)));
  surface().props.onMouseMove({ nativeEvent: { buttons: 0 } });
  await act(async () => surface().props.onResponderMove(mouse(64)));
  expect(marker('YOU').props.style.left).toBeCloseTo(274);
});
