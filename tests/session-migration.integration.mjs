import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ids, sql, applyMigration } from './local-session-db.mjs';

assert.equal(process.env.SESSION_TEST_DISPOSABLE, 'local', 'Migration rehearsal requires SESSION_TEST_DISPOSABLE=local and the isolated Docker fixture.');
test('preflight, explicit survivor reconciliation and rollback preserve history', () => {
  const rollback = readFileSync('supabase/rollback/202611150001_single_current_session.sql', 'utf8');
  if (sql("select to_regclass('public.session_participants_one_current_per_user')") !== '') sql(rollback);
  sql('TRUNCATE public.ride_sessions CASCADE;');
  const [h1, h2, user, , h3] = ids;
  const hosts = [h1, h2, h3];
  const sessions = hosts.map((host, i) => sql(`insert into public.ride_sessions(host_id,title,status,visibility) values('${host}','${'ABC'[i]}','lobby','public') returning session_id`).split('\n')[0]);
  for (let i = 0; i < 3; i++) {
    sql(`insert into public.session_participants(session_id,user_id,role) values('${sessions[i]}','${hosts[i]}','host'),('${sessions[i]}','${user}','guest')`);
    const count = sql(`select count(*) from public.session_participants where user_id='${user}' and status in ('joined','riding','paused')`);
    assert.equal(count, String(i + 1));
    console.log(`Old-schema join ${'ABC'[i]}: ${count} current memberships`);
  }
  const snapshot = () => sql('select jsonb_agg(to_jsonb(p) order by session_id,user_id) from public.session_participants p');
  const before = snapshot();
  assert.throws(() => applyMigration(), /single_current_session preflight failed/);
  assert.equal(snapshot(), before);
  assert.equal(sql("select to_regclass('public.session_participants_one_current_per_user')"), '');
  const reconcile = readFileSync('supabase/diagnostics/reconcile_current_sessions.sql', 'utf8');
  assert.throws(() => sql(reconcile), /Unresolved duplicate/);
  assert.equal(snapshot(), before);
  // Only this disposable fixture has an explicit survivor: A. No heuristic.
  const extraHost = sql(`insert into public.ride_sessions(host_id,title,status) values('${h1}','Extra hosted ride','lobby') returning session_id`).split('\n')[0];
  sql(`insert into public.session_participants(session_id,user_id,role) values('${extraHost}','${h1}','host')`);
  const choices = `insert into session_survivors values('${user}','${sessions[0]}'),('${h1}','${sessions[0]}');`;
  assert.throws(() => sql(reconcile.replace('-- REVIEWED_MAPPING_INSERTS', choices)), /Conflicting host/);
  sql(reconcile.replace('-- REVIEWED_MAPPING_INSERTS', `${choices} insert into session_terminations values('${extraHost}','cancelled');`));
  assert.equal(sql(`select status from public.session_participants where session_id='${extraHost}' and user_id='${h1}'`), 'left');
  applyMigration();
  assert.equal(sql(`select count(*) from public.session_participants where user_id='${user}'`), '3');
  assert.equal(sql(`select count(*) from public.session_participants where user_id='${user}' and status='left'`), '2');
  const reconciled = snapshot();
  sql(rollback);
  assert.equal(snapshot(), reconciled);
  assert.equal(sql("select to_regclass('public.session_participants_one_current_per_user')"), '');
  // A missing host and a stale terminal membership are independent preflight errors.
  sql(`update public.ride_sessions set status='completed' where session_id='${sessions[0]}'`);
  assert.throws(() => applyMigration(), /terminal_current/);
  sql(`update public.session_participants set status='finished',finished_at=now() where session_id='${sessions[0]}' and status in ('joined','riding','paused')`);
  sql(`delete from public.session_participants where session_id='${sessions[1]}' and user_id='${h2}'`);
  assert.throws(() => applyMigration(), /missing_current_host/);
  sql(`insert into public.session_participants(session_id,user_id,role) values('${sessions[1]}','${h2}','host')`);
  applyMigration();
  console.log('Preflight rejected duplicates, terminal-current rows, and missing hosts; rollback retained participant history.');
});
