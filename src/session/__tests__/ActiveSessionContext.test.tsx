import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { ride, deferred } from '../../../tests/fixtures';
const mocks = vi.hoisted(() => ({ user: { id: 'user' } as { id: string } | null, fetch: vi.fn() }));
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../services/supabaseClient', () => ({ isSupabaseConfigured: true, supabase: null, subscribeToTableChanges: () => null, unsubscribeChannel: async () => {} }));
vi.mock('../../services/sessionsService', () => ({ fetchCurrentSession: (...args: unknown[]) => mocks.fetch(...args), fetchSession: (...args: unknown[]) => mocks.fetch(...args) }));
import { ActiveSessionProvider, useActiveSession } from '../ActiveSessionContext';
let value: ReturnType<typeof useActiveSession>;
function Probe() { value = useActiveSession(); return null; }
let root: ReactTestRenderer;
const mount = async () => { await act(async () => { root = create(<ActiveSessionProvider><Probe /></ActiveSessionProvider>); }); };
beforeEach(() => { mocks.user = { id: 'user' }; mocks.fetch.mockReset().mockResolvedValue(ride('A')); });
afterEach(async () => { if (root) await act(async () => root.unmount()); });
test('startup uses committed membership; refresh callback settles and stays stable', async () => {
  await mount();
  expect(value.activeSession?.session_id).toBe('A');
  const refresh = value.refreshActiveSession;
  await act(async () => { await refresh(); });
  expect(value.refreshActiveSession).toBe(refresh);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});
test('clear invalidates a pending A refresh; a later valid B wins', async () => {
  await mount();
  const late = deferred<ReturnType<typeof ride>>();
  mocks.fetch.mockReturnValueOnce(late.promise);
  let pending!: Promise<void>;
  await act(async () => { pending = value.refreshActiveSession(); });
  await act(async () => value.setActiveSession(null));
  mocks.fetch.mockResolvedValueOnce(ride('B'));
  await act(async () => value.refreshActiveSession());
  await act(async () => { late.resolve(ride('A')); await pending; });
  expect(value.activeSession?.session_id).toBe('B');
});
test('foreign cached selection cannot activate an unjoined room', async () => {
  mocks.fetch.mockResolvedValue(null);
  await mount();
  await act(async () => value.setActiveSession(ride('foreign')));
  expect(value.activeSession).toBeNull();
});
test('account change and sign-out invalidate pending membership and errors fail closed', async () => {
  await mount();
  const late = deferred<ReturnType<typeof ride>>();
  mocks.fetch.mockReturnValueOnce(late.promise);
  let pending!: Promise<void>;
  await act(async () => { pending = value.refreshActiveSession(); });
  mocks.user = { id: 'other' }; mocks.fetch.mockResolvedValueOnce(ride('B'));
  await act(async () => root.update(<ActiveSessionProvider><Probe /></ActiveSessionProvider>));
  await act(async () => { late.resolve(ride('A')); await pending; });
  expect(value.activeSession?.session_id).toBe('B');
  mocks.fetch.mockRejectedValueOnce(new Error('multiple current memberships'));
  await act(async () => value.refreshActiveSession());
  expect(value.activeSession).toBeNull();
  mocks.user = null;
  await act(async () => root.update(<ActiveSessionProvider><Probe /></ActiveSessionProvider>));
  expect(value.activeSession).toBeNull();
});
test('an obsolete account callback cannot invalidate the new account refresh', async () => {
  await mount();
  const oldRefresh = value.refreshActiveSession;
  const next = deferred<ReturnType<typeof ride>>();
  mocks.user = { id: 'other' }; mocks.fetch.mockReturnValueOnce(next.promise);
  await act(async () => root.update(<ActiveSessionProvider><Probe /></ActiveSessionProvider>));
  mocks.fetch.mockResolvedValueOnce(ride('A'));
  await act(async () => oldRefresh());
  await act(async () => next.resolve(ride('B')));
  expect(value.activeSession?.session_id).toBe('B');
});
