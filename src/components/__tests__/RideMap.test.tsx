import React from 'react';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, expect, test, vi } from 'vitest';
vi.mock('react-native-svg', () => ({ default: 'Svg', Polyline: 'Polyline' }));
import RideMap, { type RideMapProps } from '../RideMap';

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
