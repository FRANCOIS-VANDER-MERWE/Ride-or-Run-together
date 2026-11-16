// Disposable PostgreSQL/PostGIS + PostgREST only. Never loads the app's .env.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
export const container = 'pacelock-session-test-db';
export const secret = 'pacelock-local-test-only-secret-at-least-32-characters';
export const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
export function token(sub, role = 'authenticated') {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function command(args, input) {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'Docker failed');
  return r.stdout.trim();
}
export function sql(input) {
  return command(['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], input);
}
export function applyMigration() {
  sql(readFileSync('supabase/migrations/202611150001_single_current_session.sql', 'utf8'));
  sql("NOTIFY pgrst, 'reload schema';");
}
export async function setup() {
  // Names are fixed and task-specific; never remove or reuse a foreign container.
  const existing = command(['ps', '-a', '--filter', `name=^/${container}$`, '--format', '{{.Names}}']);
  if (existing) throw new Error(`${container} already exists. Use it, or explicitly remove this disposable fixture before setup.`);
  command(['network', 'create', 'pacelock-session-test']);
  command(['run', '-d', '--name', container, '--network', 'pacelock-session-test', '-e', 'POSTGRES_PASSWORD=local-test-only', 'postgis/postgis:17-3.5']);
  for (let n = 0; n < 60; n++) {
    try { sql('select 1'); break; } catch (e) { if (n === 59) throw e; await new Promise(r => setTimeout(r, 500)); }
  }
  sql(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
    $$;`);
  sql(`CREATE SCHEMA extensions; CREATE EXTENSION citext; CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE PUBLICATION supabase_realtime; GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;`);
  const dump = readFileSync('schema.sql', 'utf8');
  sql(dump.slice(dump.indexOf('CREATE TYPE "public"."friendship_status"'), dump.indexOf('ALTER PUBLICATION')));
  sql(`GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;`);
  sql(readFileSync('supabase/rls_policies.sql', 'utf8'));
  sql(ids.map((id, i) => `INSERT INTO auth.users VALUES ('${id}'); INSERT INTO public.profiles(user_id,username) VALUES ('${id}','session_test_${i}');`).join('\n'));
  command(['run', '-d', '--name', 'pacelock-session-test-api', '--network', 'pacelock-session-test', '-p', '127.0.0.1:55431:3000',
    '-e', `PGRST_DB_URI=postgres://postgres:local-test-only@${container}:5432/postgres`, '-e', 'PGRST_DB_ANON_ROLE=anon',
    '-e', `PGRST_JWT_SECRET=${secret}`, 'postgrest/postgrest:v13.0.7']);
  console.log('Disposable REST endpoint: http://127.0.0.1:55431. Auth/Reatime/native are not emulated.');
}
if (process.argv[1]?.endsWith('local-session-db.mjs')) {
  if (process.argv[2] === 'setup') await setup();
  else if (process.argv[2] === 'migrate') applyMigration();
  else throw new Error('Usage: node tests/local-session-db.mjs setup|migrate');
}
