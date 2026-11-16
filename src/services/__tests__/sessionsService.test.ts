import { beforeEach, expect, test, vi } from 'vitest';
import { ride } from '../../../tests/fixtures';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../supabaseClient', () => ({ requireSupabase: () => mocks }));
import * as sessions from '../sessionsService';
const conflict = { code: '23505', message: 'duplicate key value violates unique constraint "session_participants_one_current_per_user"', details: '' };
beforeEach(() => { vi.clearAllMocks(); });
test.each(['join', 'create', 'accept'] as const)('%s maps the named database membership conflict without partial client writes', async action => {
  mocks.rpc.mockResolvedValue({ data: null, error: conflict });
  mocks.from.mockImplementation(() => { throw new Error('Nontransactional write attempted'); });
  const work = action === 'join' ? sessions.joinSession('B', 'user') : action === 'create'
    ? sessions.createSession('user', { title: 'B' })
    : sessions.respondToInvite({ invite_id: 'i', session_id: 'B', invited_by: 'host', invitee_id: 'user', status: 'pending', created_at: '', responded_at: null }, 'accepted');
  await expect(work).rejects.toThrow('You are already in a session. Leave your current session before joining another.');
  expect(mocks.from).not.toHaveBeenCalled();
});
test('unrelated unique violation stays an unrelated backend error', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { ...conflict, message: 'duplicate title', details: 'ride_sessions_title_key' } });
  await expect(sessions.joinSession('B', 'user')).rejects.toThrow('duplicate title');
});
test('current membership query excludes history and rejects duplicates', async () => {
  const filters: unknown[] = [];
  const query: any = { select: () => query, eq: (...x: unknown[]) => { filters.push(x); return query; }, in: (...x: unknown[]) => { filters.push(x); return query; }, not: (...x: unknown[]) => { filters.push(x); return query; }, then: (f: any) => Promise.resolve({ data: [{ joined_at: 'one', session: ride('A') }, { joined_at: 'two', session: ride('B') }], error: null }).then(f) };
  mocks.from.mockReturnValue(query);
  await expect(sessions.fetchCurrentSession('user')).rejects.toThrow(/multiple current/i);
  expect(filters).toContainEqual(['status', ['joined', 'riding', 'paused']]);
});
test('a corrupt current row on a terminal parent fails closed', async () => {
  const query: any = { select: () => query, eq: () => query, in: () => query, not: () => query,
    then: (f: any) => Promise.resolve({ data: [{ joined_at: 'one', session: { ...ride('A'), status: 'completed' } }], error: null }).then(f) };
  mocks.from.mockReturnValue(query);
  await expect(sessions.fetchCurrentSession('user')).rejects.toThrow(/ended session/i);
});
