import React from 'react';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { ride, deferred } from '../../../tests/fixtures';
const m = vi.hoisted(() => ({ session: null as any, key: 'user:A:1', user: 'user', change: null as any, queue: vi.fn(), state: vi.fn(), latest: vi.fn(), permission: vi.fn(), watch: vi.fn(), share: vi.fn(), provider: { capabilities: { canPlay: true, canSeek: true, requiresPremium: false, requiresExternalApp: false, playbackNote: 'test playback' }, canUseMusicKit: () => false, getAuthState: vi.fn(), getSnapshot: vi.fn(), onTrackEnded: vi.fn(), playTrack: vi.fn(), pause: vi.fn(), resume: vi.fn() } }));
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: m.user } }) }));
vi.mock('../../session/ActiveSessionContext', () => ({ useActiveSession: () => ({ activeSession: m.session, refreshActiveSession: async () => {}, participationKey: m.session ? m.key : null }) }));
vi.mock('../../services/sessionsService', () => ({ fetchParticipants: async () => [] }));
vi.mock('../../services/profilesService', () => ({ fetchProfile: async () => null }));
vi.mock('../../services/rideDataService', () => ({ fetchLatestPings: () => m.latest(), fetchRoute: async () => null }));
vi.mock('../../services/musicDataService', () => ({ fetchSessionQueueWithTracks: (...x: unknown[]) => m.queue(...x), fetchPlaybackState: (...x: unknown[]) => m.state(...x), publishNowPlaying: vi.fn(), updatePlaybackState: vi.fn() }));
vi.mock('../../services/liveLocationService', () => ({ startLocationSharing: (...x: unknown[]) => m.share(...x), subscribeToLocationFixes: () => () => {} }));
vi.mock('../../services/supabaseClient', () => ({ subscribeToTableChanges: (_table: unknown, options: any) => { m.change = options.onChange; return null; }, supabase: null }));
vi.mock('expo-location', () => ({ requestForegroundPermissionsAsync: () => m.permission(), getCurrentPositionAsync: async () => null, watchPositionAsync: (...x: unknown[]) => m.watch(...x), Accuracy: { Balanced: 3 } }));
vi.mock('react-native-svg', () => ({ default: 'Svg', Polyline: 'Polyline' }));
vi.mock('lucide-react-native', () => ({ Music2: 'Music2', Pause: 'Pause', Play: 'Play', AlertTriangle: 'AlertTriangle', CheckCircle2: 'CheckCircle2', RefreshCw: 'RefreshCw', SkipBack: 'SkipBack', SkipForward: 'SkipForward' }));
vi.mock('../../music/providers/AppleMusicProvider', () => ({ appleMusicProvider: m.provider }));
import ComplicationsView from '../ComplicationsView';
import MusicSyncDeck from '../MusicSyncDeck';
let root: ReactTestRenderer;
const text = (n: ReactTestInstance | string): string => typeof n === 'string' ? n : n.children.map(text).join('');
const queueRow = (title: string) => ({ item: { queue_item_id: title }, track: { provider: 'apple_music', provider_track_id: title, title, artist: 'Artist' } });
const playback = (title: string) => ({ session_id: title === 'A song' ? 'A' : 'B', current_item_id: title, dj_user_id: 'other', is_playing: true, position_updated_at: new Date().toISOString() });
beforeEach(() => {
  vi.clearAllMocks(); m.session = { ...ride('A'), status: 'active' }; m.key = 'user:A:1'; m.user = 'user';
  m.permission.mockResolvedValue({ status: 'denied' }); m.queue.mockResolvedValue([]); m.state.mockResolvedValue(null); m.latest.mockResolvedValue(new Map());
  m.share.mockResolvedValue(null); m.watch.mockResolvedValue({ remove() {} });
  m.provider.getAuthState.mockResolvedValue({ isConnected: true, isPremiumOrSubscribed: null, userDisplayName: null, expiresAtMs: null }); m.provider.getSnapshot.mockResolvedValue(null);
  m.provider.onTrackEnded.mockReturnValue(() => {}); m.provider.playTrack.mockResolvedValue(undefined); m.provider.pause.mockResolvedValue(undefined);
});
afterEach(async () => { if (root) await act(async () => root.unmount()); });
test('late A playback cannot replace B playback', async () => {
  const late = deferred<any>(); m.state.mockReturnValueOnce(late.promise);
  await act(async () => { root = create(<ComplicationsView onNavigate={() => {}} />); });
  m.session = { ...ride('B'), status: 'active' }; m.key = 'user:B:1'; m.queue.mockResolvedValue([queueRow('B song')]); m.state.mockResolvedValue(playback('B song'));
  await act(async () => root.update(<ComplicationsView onNavigate={() => {}} />));
  await act(async () => late.resolve(playback('A song')));
  expect(text(root.root)).toContain('B song');
});
test('late obsolete GPS handles stop and cannot overwrite B cleanup', async () => {
  const late = deferred<any>(); const stopA = vi.fn(); const stopB = vi.fn();
  m.share.mockReturnValueOnce(late.promise).mockResolvedValue({ stop: stopB });
  await act(async () => { root = create(<ComplicationsView onNavigate={() => {}} />); });
  m.session = { ...ride('B'), status: 'active' }; m.key = 'user:B:1';
  await act(async () => root.update(<ComplicationsView onNavigate={() => {}} />));
  await act(async () => late.resolve({ stop: stopA }));
  expect(stopA).toHaveBeenCalledOnce(); expect(stopB).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  expect(stopB).toHaveBeenCalledOnce();
});
test('old own GPS watcher resolving after account change is removed immediately', async () => {
  const late = deferred<any>(); const remove = vi.fn(); m.permission.mockResolvedValue({ status: 'granted' }); m.watch.mockReturnValueOnce(late.promise);
  await act(async () => { root = create(<ComplicationsView onNavigate={() => {}} />); });
  m.user = 'other'; m.session = null;
  await act(async () => root.update(<ComplicationsView onNavigate={() => {}} />));
  await act(async () => late.resolve({ remove }));
  expect(remove).toHaveBeenCalledOnce();
});
test('music queue response after membership release issues no audio command', async () => {
  const late = deferred<any[]>(); m.queue.mockReturnValue(late.promise);
  await act(async () => { root = create(<MusicSyncDeck />); });
  await act(async () => { m.change({ new: playback('A song') }); });
  m.session = null;
  await act(async () => root.update(<MusicSyncDeck />));
  await act(async () => late.resolve([queueRow('A song')]));
  expect(m.provider.playTrack).not.toHaveBeenCalled();
});
test('a pending A audio command drains and stops before B starts', async () => {
  const late = deferred<void>(); const events: string[] = [];
  m.provider.playTrack.mockImplementation(async (track: any) => {
    events.push(track.title);
    if (track.title === 'A song') { await late.promise; events.push('A finished'); }
  });
  m.provider.pause.mockImplementation(async () => { events.push('pause'); });
  m.queue.mockResolvedValue([queueRow('A song')]);
  await act(async () => { root = create(<MusicSyncDeck />); });
  await act(async () => { m.change({ new: playback('A song') }); });
  m.session = { ...ride('B'), status: 'active' }; m.key = 'user:B:1'; m.queue.mockResolvedValue([queueRow('B song')]);
  await act(async () => root.update(<MusicSyncDeck />));
  await act(async () => { m.change({ new: playback('B song') }); });
  await act(async () => late.resolve());
  expect(events).toEqual(['A song', 'A finished', 'pause', 'B song']);
});
test('same-session renders preserve progress; a new participation interval starts fresh', async () => {
  let applyFix!: (fix: any) => void;
  m.permission.mockResolvedValue({ status: 'granted' });
  m.watch.mockImplementation(async (_options, cb) => { applyFix = cb; return { remove() {} }; });
  await act(async () => { root = create(<ComplicationsView onNavigate={() => {}} />); });
  const fix = (latitude: number) => ({ coords: { latitude, longitude: 0, speed: 4 }, timestamp: Date.now() });
  await act(async () => { applyFix(fix(0)); applyFix(fix(0.001)); });
  expect(text(root.root)).toContain('0.07 MI');
  await act(async () => root.update(<ComplicationsView onNavigate={() => {}} />));
  expect(text(root.root)).toContain('0.07 MI');
  expect(m.watch).toHaveBeenCalledOnce();
  m.key = 'user:A:2';
  await act(async () => root.update(<ComplicationsView onNavigate={() => {}} />));
  expect(text(root.root)).toContain('0.00 MI');
  expect(m.watch).toHaveBeenCalledTimes(2);
});
