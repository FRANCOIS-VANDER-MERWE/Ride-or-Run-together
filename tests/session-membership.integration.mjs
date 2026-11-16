import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { ids, token, sql } from './local-session-db.mjs';

// This suite can delete fixtures. It must never consume EXPO_PUBLIC_* or a cloud URL.
assert.equal(process.env.SESSION_TEST_DISPOSABLE, 'local', 'Set SESSION_TEST_DISPOSABLE=local for the isolated Docker fixture.');
assert.equal(process.env.SESSION_TEST_URL, 'http://127.0.0.1:55431', 'SESSION_TEST_URL must target the isolated local fixture.');
const client = (id, role) => createClient(process.env.SESSION_TEST_URL, token(id, role), {
  global: {
    headers: { Authorization: `Bearer ${token(id, role)}` },
    // Standalone PostgREST has no Supabase gateway's /rest/v1 prefix.
    fetch: (url, init) => fetch(String(url).replace('/rest/v1/', '/'), init),
  },
  auth: { persistSession: false, autoRefreshToken: false },
});
const [hostA, hostB, guest, other, hostC] = ids;
const admin = client(guest, 'service_role');
const db = client(guest);
const ok = r => { assert.ifError(r.error); return r.data; };
const create = async (user, title = 'Test ride') => ok(await client(user).rpc('create_session', { p_input: { title, visibility: 'public' } }));
const join = (session, user = guest, c = client(user)) => c.rpc('join_session', { p_session_id: session.session_id });
const rows = async user => ok(await admin.from('session_participants').select('*').eq('user_id', user).in('status', ['joined', 'riding', 'paused']));
const status = (session, value) => client(session.host_id).rpc('set_session_status', { p_session_id: session.session_id, p_status: value });
let A, B;
beforeEach(async () => {
  sql('TRUNCATE public.ride_sessions CASCADE;');
  A = await create(hostA, 'A'); B = await create(hostB, 'B');
});
test('A blocks B and C, preserves A; another user can join B', async () => {
  ok(await join(A));
  const C = await create(hostC, 'C');
  for (const session of [B, C]) assert.match((await join(session)).error?.message ?? '', /session_participants_one_current_per_user/);
  assert.equal((await rows(guest))[0].session_id, A.session_id);
  ok(await join(B, other));
});
test('parallel joins by separate clients have exactly one winner', async () => {
  const results = await Promise.all([join(A, guest, client(guest)), join(B, guest, client(guest))]);
  assert.equal(results.filter(r => !r.error).length, 1);
  assert.equal((await rows(guest)).length, 1);
});
test('direct insert and historical reactivation cannot bypass exclusivity', async () => {
  ok(await db.from('session_participants').insert({ session_id: B.session_id, user_id: guest, status: 'left' }));
  ok(await join(A));
  assert.equal((await db.from('session_participants').update({ status: 'paused' }).eq('session_id', B.session_id).eq('user_id', guest)).error?.code, '23505');
  const C = await create(hostC);
  assert.equal((await db.from('session_participants').insert({ session_id: C.session_id, user_id: guest })).error?.code, '23505');
});
test('same-session retries preserve host, status, timestamps and bike', async () => {
  const firstHost = ok(await join(A, hostA));
  assert.equal(firstHost.role, 'host');
  const bike = randomUUID();
  ok(await admin.from('user_bikes').insert({ bike_id: bike, user_id: guest, name: 'test bike' }));
  ok(await db.rpc('join_session', { p_session_id: A.session_id, p_bike_id: bike }));
  ok(await db.rpc('set_participant_status', { p_session_id: A.session_id, p_status: 'riding' }));
  const original = (await rows(guest))[0];
  assert.deepEqual(ok(await join(A)), original);
});
test('every current status blocks; every historical status releases', async () => {
  for (const current of ['joined', 'riding', 'paused']) {
    ok(await join(A));
    ok(await db.rpc('set_participant_status', { p_session_id: A.session_id, p_status: current }));
    assert.ok((await join(B)).error);
    ok(await db.rpc('set_participant_status', { p_session_id: A.session_id, p_status: 'left' }));
  }
  for (const past of ['finished', 'left', 'dropped']) {
    ok(await join(A));
    ok(await db.rpc('set_participant_status', { p_session_id: A.session_id, p_status: past }));
    ok(await join(B));
    ok(await db.rpc('set_participant_status', { p_session_id: B.session_id, p_status: 'left' }));
  }
});
test('blocked creation rolls back session, host and playback; hosts cannot leave open rides', async () => {
  ok(await join(A));
  assert.ok((await db.rpc('create_session', { p_input: { title: 'Must roll back', visibility: 'public' } })).error);
  assert.equal(ok(await admin.from('ride_sessions').select('*').eq('host_id', guest)).length, 0);
  assert.equal(ok(await admin.from('session_playback_state').select('*')).length, 2);
  assert.ok((await client(hostA).rpc('set_participant_status', { p_session_id: A.session_id, p_status: 'left' })).error);
});
test('blocked direct invite acceptance stays pending; leaving then accepting succeeds', async () => {
  const invite = ok(await client(hostB).from('session_invites').insert({ session_id: B.session_id, invited_by: hostB, invitee_id: guest }).select().single());
  ok(await join(A));
  assert.ok((await db.from('session_invites').update({ status: 'accepted' }).eq('invite_id', invite.invite_id)).error);
  assert.equal(ok(await db.from('session_invites').select().eq('invite_id', invite.invite_id).single()).status, 'pending');
  assert.ok((await db.rpc('respond_to_session_invite', { p_invite_id: invite.invite_id, p_response: 'accepted' })).error);
  ok(await db.rpc('set_participant_status', { p_session_id: A.session_id, p_status: 'left' }));
  ok(await db.rpc('respond_to_session_invite', { p_invite_id: invite.invite_id, p_response: 'accepted' }));
  assert.equal((await rows(guest))[0].session_id, B.session_id);
});
test('end/cancel finalizes all rows and rejects late participation and reopening', async () => {
  for (const [session, terminal, past] of [[A, 'completed', 'finished'], [B, 'cancelled', 'left']]) {
    ok(await join(session));
    ok(await status(session, terminal));
    assert.equal(ok(await admin.from('session_participants').select().eq('session_id', session.session_id)).every(p => p.status === past), true);
    assert.ok((await join(session, other)).error);
    assert.ok((await status(session, 'lobby')).error);
  }
  assert.equal((await rows(guest)).length, 0);
});
test('join-versus-terminal races never leave current rows on terminal parents', async () => {
  for (let n = 0; n < 12; n++) {
    const session = await create(hostC);
    await Promise.all([join(session), status(session, n % 2 ? 'cancelled' : 'completed')]);
    const parent = ok(await admin.from('ride_sessions').select().eq('session_id', session.session_id).single());
    assert.ok(['completed', 'cancelled'].includes(parent.status));
    assert.equal(ok(await admin.from('session_participants').select().eq('session_id', session.session_id).in('status', ['joined', 'riding', 'paused'])).length, 0);
  }
});
test('foreign session mutations, participant identity spoofing and private joins fail', async () => {
  assert.ok((await db.rpc('set_session_status', { p_session_id: A.session_id, p_status: 'completed' })).error);
  const privateSession = ok(await client(hostC).rpc('create_session', { p_input: { title: 'Private' } }));
  assert.ok((await join(privateSession)).error);
  assert.ok((await db.from('session_participants').insert({ session_id: A.session_id, user_id: other })).error);
  ok(await join(A));
  assert.ok((await db.from('session_participants').update({ role: 'host' }).eq('session_id', A.session_id).eq('user_id', guest)).error);
});
test('mixed simultaneous join/create/invite requests reserve exactly one slot', async () => {
  const invite = ok(await client(hostB).from('session_invites').insert({ session_id: B.session_id, invited_by: hostB, invitee_id: guest }).select().single());
  const results = await Promise.all([
    join(A),
    client(guest).rpc('create_session', { p_input: { title: 'Parallel create', visibility: 'public' } }),
    client(guest).rpc('respond_to_session_invite', { p_invite_id: invite.invite_id, p_response: 'accepted' }),
  ]);
  assert.equal(results.filter(r => !r.error).length, 1);
  assert.equal((await rows(guest)).length, 1);
  const owned = ok(await admin.from('ride_sessions').select().eq('host_id', guest));
  assert.equal(owned.length, results[1].error ? 0 : 1);
  const savedInvite = ok(await db.from('session_invites').select().eq('invite_id', invite.invite_id).single());
  assert.equal(savedInvite.status, results[2].error ? 'pending' : 'accepted');
});
test('direct creation and terminal status updates obey host reservation and cleanup', async () => {
  assert.ok((await client(hostA).from('ride_sessions').insert({ host_id: hostA, title: 'Blocked direct create' })).error);
  assert.ok((await join(B, hostA)).error);
  ok(await join(A));
  ok(await client(hostA).from('ride_sessions').update({ status: 'cancelled' }).eq('session_id', A.session_id));
  assert.equal((await rows(guest)).length, 0);
  assert.equal((await rows(hostA)).length, 0);
  ok(await join(B, hostA));
});
test('embedded current-membership snapshot excludes history and terminal parents', async () => {
  ok(await join(A));
  const query = () => db.from('session_participants').select('joined_at, session:ride_sessions!inner(*)').eq('user_id', guest).in('status', ['joined', 'riding', 'paused']).not('session.status', 'in', '(completed,cancelled)');
  assert.equal(ok(await query())[0].session.session_id, A.session_id);
  ok(await status(A, 'completed'));
  assert.equal(ok(await query()).length, 0);
});
test('a terminal host cannot recreate live playback state', async () => {
  ok(await status(A, 'completed'));
  ok(await admin.from('session_playback_state').delete().eq('session_id', A.session_id));
  assert.ok((await client(hostA).from('session_playback_state').insert({ session_id: A.session_id, dj_user_id: hostA, is_playing: true })).error);
});
test('a host cannot insert an already accepted invitation on someone else behalf', async () => {
  assert.ok((await client(hostB).from('session_invites').insert({ session_id: B.session_id, invited_by: hostB, invitee_id: guest, status: 'accepted' })).error);
});
test('historical status reactivation starts a new interval without stale terminal timestamps', async () => {
  ok(await join(A));
  ok(await db.rpc('set_participant_status', { p_session_id: A.session_id, p_status: 'left' }));
  const old = ok(await admin.from('session_participants').select().eq('session_id', A.session_id).eq('user_id', guest).single());
  ok(await db.from('session_participants').update({ status: 'joined' }).eq('session_id', A.session_id).eq('user_id', guest));
  const current = (await rows(guest))[0];
  assert.notEqual(current.joined_at, old.joined_at);
  assert.equal(current.left_at, null);
  assert.equal(current.finished_at, null);
});
test('a stale live-activity status request cannot resurrect released membership', async () => {
  ok(await join(A));
  ok(await db.rpc('set_participant_status', { p_session_id: A.session_id, p_status: 'left' }));
  assert.ok((await db.rpc('set_participant_status', { p_session_id: A.session_id, p_status: 'riding' })).error);
  assert.equal((await rows(guest)).length, 0);
  ok(await join(A));
  assert.equal((await rows(guest))[0].status, 'joined');
});
