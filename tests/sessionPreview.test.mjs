import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findSampleSession, createHostPreview } from '../src/data/sessionPreview.ts';

test('sample lookup normalizes whitespace and case', () => {
  assert.equal(findSampleSession('  run123  ')?.name, 'Coastal Tempo Run');
  assert.equal(findSampleSession('ride12')?.mode, 'ride');
});

test('unknown, empty and inherited property names are not sample sessions', () => {
  for (const code of ['', '   ', 'UNKNOWN', 'constructor', '__proto__', 'toString']) {
    assert.equal(findSampleSession(code), undefined);
  }
});

test('full and ended fixtures cannot be mistaken for available samples', () => {
  assert.equal(findSampleSession('FULL12')?.status, 'full');
  assert.equal(findSampleSession('ENDED1')?.status, 'ended');
  assert.equal(findSampleSession('RUN123')?.status, 'available');
});

test('host preview rejects blank or oversized names and trims valid names', () => {
  for (const name of ['', '   ', 'a'.repeat(41)]) {
    assert.equal(createHostPreview(name, 'run'), undefined);
  }
  assert.equal(createHostPreview('  Saturday run  ', 'run')?.name, 'Saturday run');
  assert.equal(createHostPreview('a'.repeat(40), 'ride')?.name.length, 40);
});

test('host previews have no remote participants and mode-specific units', () => {
  const run = createHostPreview('Run', 'run');
  const ride = createHostPreview('Ride', 'ride');
  assert.equal(run?.participantCount, 0);
  assert.equal(ride?.participantCount, 0);
  assert.equal(run?.target, '9:00 min/mi');
  assert.equal(ride?.target, '14 mph');
  assert.equal(findSampleSession('RUN123')?.participantCount, 2);
});
