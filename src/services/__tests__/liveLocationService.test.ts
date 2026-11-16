import { beforeEach, expect, test, vi } from 'vitest';
import { deferred } from '../../../tests/fixtures';
const m = vi.hoisted(() => ({ permission: vi.fn(), watch: vi.fn(), ping: vi.fn(), remove: vi.fn(), channel: vi.fn() }));
vi.mock('expo-location', () => ({ requestForegroundPermissionsAsync: m.permission, watchPositionAsync: m.watch, Accuracy: { High: 6 } }));
vi.mock('../rideDataService', () => ({ insertLocationPing: m.ping }));
vi.mock('../supabaseClient', () => ({ requireSupabase: () => ({}), supabase: { channel: (...x: unknown[]) => m.channel(...x), removeChannel: (...x: unknown[]) => m.remove(...x) } }));
import { startLocationSharing, subscribeToLocationFixes, releaseLocationChannel } from '../liveLocationService';
let send: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks(); m.permission.mockResolvedValue({ status: 'granted' }); m.ping.mockResolvedValue(undefined); m.remove.mockResolvedValue(undefined);
  send = vi.fn();
  m.channel.mockImplementation(() => { const ch: any = { send, on: () => ch, subscribe: (cb: (s: string) => void) => { cb('SUBSCRIBED'); return ch; } }; return ch; });
});
test('Pack and Ride release only their own ownership; final release and repeated cleanup are safe', async () => {
  const first = subscribeToLocationFixes('owners', () => {});
  const second = subscribeToLocationFixes('owners', () => {});
  first(); await releaseLocationChannel('owners');
  expect(m.remove).not.toHaveBeenCalled();
  second(); await releaseLocationChannel('owners');
  expect(m.remove).toHaveBeenCalledTimes(1);
  first(); second(); await releaseLocationChannel('owners');
  expect(m.remove).toHaveBeenCalledTimes(1);
});
test('obsolete delayed watcher stops immediately without publishing or stale errors', async () => {
  const pending = deferred<{ remove: () => void }>(); const remove = vi.fn(); const onError = vi.fn();
  let current = true; let fix!: (loc: any) => void;
  m.watch.mockImplementation((_options, cb) => { fix = cb; return pending.promise; });
  const sharing = startLocationSharing('late', 'user', onError, () => current);
  await Promise.resolve(); await Promise.resolve();
  current = false;
  fix({ coords: { latitude: 1, longitude: 2 }, timestamp: Date.now() });
  pending.resolve({ remove });
  expect(await sharing).toBeNull();
  expect(remove).toHaveBeenCalledOnce(); expect(send).not.toHaveBeenCalled(); expect(m.ping).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
});
test('permission denial and rejected setup leave no watcher or channel', async () => {
  const onError = vi.fn(); m.permission.mockResolvedValueOnce({ status: 'denied' });
  expect(await startLocationSharing('denied', 'user', onError)).toBeNull();
  expect(m.channel).not.toHaveBeenCalled(); expect(m.watch).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledOnce();
  m.watch.mockRejectedValueOnce(new Error('GPS unavailable'));
  expect(await startLocationSharing('rejected', 'user', onError)).toBeNull();
  expect(m.remove).toHaveBeenCalledOnce();
});
test('two mounted publishers share one watcher; the final stop releases it', async () => {
  const remove = vi.fn(); m.watch.mockResolvedValue({ remove });
  const [a, b] = await Promise.all([startLocationSharing('shared', 'user'), startLocationSharing('shared', 'user')]);
  expect(m.watch).toHaveBeenCalledOnce();
  await a!.stop(); expect(remove).not.toHaveBeenCalled();
  await b!.stop(); await b!.stop(); expect(remove).toHaveBeenCalledOnce(); expect(m.remove).toHaveBeenCalledOnce();
});
