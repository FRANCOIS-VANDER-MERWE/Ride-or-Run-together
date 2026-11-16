import { expect, test } from 'vitest';
import {
  buildInstruction,
  distanceToRouteM,
  flattenSteps,
  formatNavDistance,
  sampleViaPoints,
} from '../navigationService';
import type { LatLng } from '../../components/rideMapGeometry';

test('buildInstruction reads like a rider expects', () => {
  expect(buildInstruction('depart', 'right', 'Branch Street')).toBe(
    'Head out on Branch Street'
  );
  expect(buildInstruction('turn', 'left', 'Herring Street')).toBe(
    'Turn left onto Herring Street'
  );
  expect(buildInstruction('turn', 'sharp right', '')).toBe('Turn sharp right');
  expect(buildInstruction('end of road', 'right', 'South Peter Street')).toBe(
    'At the end of the road, turn right onto South Peter Street'
  );
  expect(buildInstruction('roundabout', undefined, 'Main Street', 2)).toBe(
    'At the roundabout, take exit 2 onto Main Street'
  );
  expect(buildInstruction('turn', 'uturn', 'Main Street')).toBe(
    'Make a U-turn'
  );
  expect(buildInstruction('arrive', undefined, '')).toBe(
    'Arrive at your destination'
  );
  expect(buildInstruction('turn', 'straight', '')).toBe('Continue straight');
});

test('flattenSteps flips OSRM [lng, lat] locations into LatLng', () => {
  const steps = flattenSteps({
    routes: [
      {
        legs: [
          {
            steps: [
              {
                distance: 310.2,
                name: 'Branch Street',
                maneuver: {
                  type: 'depart',
                  modifier: 'right',
                  location: [-83.3576, 33.9519],
                },
              },
              {
                distance: 0,
                name: '',
                maneuver: { type: 'arrive', location: [-83.376, 33.9575] },
              },
            ],
          },
        ],
      },
    ],
  });
  expect(steps).toHaveLength(2);
  expect(steps[0].location).toEqual({ lat: 33.9519, lng: -83.3576 });
  expect(steps[0].instruction).toBe('Head out on Branch Street');
  expect(steps[1].type).toBe('arrive');
});

test('sampleViaPoints keeps the ends and spaces the middle', () => {
  // About 111 m per step east along the equator, 11 points, ~1.1 km.
  const line: LatLng[] = Array.from({ length: 11 }, (_, i) => ({
    lat: 0,
    lng: i * 0.001,
  }));
  const via = sampleViaPoints(line, 250);
  expect(via[0]).toEqual(line[0]);
  expect(via[via.length - 1]).toEqual(line[line.length - 1]);
  expect(via.length).toBeGreaterThanOrEqual(3);
  expect(via.length).toBeLessThanOrEqual(6);
  const capped = sampleViaPoints(line, 10, 4);
  expect(capped.length).toBeLessThanOrEqual(5);
  expect(capped[0]).toEqual(line[0]);
});

test('distanceToRouteM measures off-line distance', () => {
  const line: LatLng[] = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.01 },
  ];
  expect(distanceToRouteM({ lat: 0, lng: 0.005 }, line)).toBeLessThan(1);
  // 0.001 degrees of latitude is about 111 m north of the line.
  const off = distanceToRouteM({ lat: 0.001, lng: 0.005 }, line);
  expect(off).toBeGreaterThan(100);
  expect(off).toBeLessThan(125);
});

test('formatNavDistance uses feet up close and miles beyond', () => {
  expect(formatNavDistance(100)).toBe('330 ft');
  expect(formatNavDistance(1000)).toBe('0.62 mi');
  expect(formatNavDistance(3000)).toBe('1.9 mi');
});
