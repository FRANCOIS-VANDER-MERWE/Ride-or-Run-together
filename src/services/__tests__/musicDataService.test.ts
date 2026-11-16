import { expect, test, vi } from 'vitest';
import { deferred } from '../../../tests/fixtures';
const m = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../supabaseClient', () => ({ requireSupabase: () => m }));
import { publishNowPlaying } from '../musicDataService';
test('a delayed track lookup after leaving A cannot mutate A queue or playback', async () => {
  const pending = deferred<any>(); let current = true;
  const query: any = { select: () => query, eq: () => query, maybeSingle: () => pending.promise };
  m.from.mockImplementation(table => { if (table !== 'tracks') throw new Error('Obsolete session write/read'); return query; });
  const publish = publishNowPlaying('A', 'user', { provider: 'apple_music', providerTrackId: 'song', title: 'Song', artist: 'Artist' }, () => current);
  current = false;
  pending.resolve({ error: null, data: { track_id: 'track', provider: 'apple_music', provider_track_id: 'song', title: 'Song', artist: 'Artist', album: null, duration_ms: null, artwork_url: null } });
  await expect(publish).resolves.toBeUndefined();
  expect(m.from.mock.calls.map(([table]) => table)).toEqual(['tracks']);
});
