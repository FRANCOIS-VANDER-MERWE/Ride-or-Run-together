# Single current session rollout

The invariant is one `joined`, `riding`, or `paused` participant row per user, including hosts. Invitations do not reserve a slot. Historical rows remain unrestricted. There is no automatic switching.

## Artifacts and order

1. Back up the database and save the output of `diagnostics/current_session_conflicts.sql` privately. Run the audit as an administrator: an app user's RLS-visible result is not a global audit.
2. Pause session writes and prevent old app versions from creating/joining sessions during rollout. Prepare the updated app before this maintenance window.
3. For each conflicting user, obtain the retained session explicitly. Copy `diagnostics/reconcile_current_sessions.sql` and fill `session_survivors`. Conflicting hosted sessions also need explicit entries in `session_terminations`. The script refuses unresolved conflicts, invalid survivors, or open sessions without a current host. Extra guest rows become `left`; completed parents finalize current rows as `finished`; cancelled parents finalize them as `left`. Rows and existing terminal timestamps are retained. A genuinely new participation interval resets that row's interval timestamps; no separate interval-history table is introduced.
4. Apply the reviewed reconciliation transaction. Rerun the audit. A previously completed/cancelled parent cannot be a retained live session; those rows need terminal cleanup, not a survivor guess.
5. Apply `migrations/202611150001_single_current_session.sql` as the database owner. For a fresh database, first install the base `../schema.sql` and `rls_policies.sql`. The migration locks the lifecycle tables, performs preflight, builds the named partial unique index, adds RPCs/triggers, and commits together. Lock contention fails after 10 seconds; investigate and retry during the maintenance window. Do not use `CREATE INDEX CONCURRENTLY` outside this transaction without redesigning the rollout.
6. Deploy/activate the updated app, verify the demo flow with two independent clients, then reopen writes. Do not run the base `rls_policies.sql` over the migrated database afterward; it contains the old live-write policies. Future policy changes must preserve the current-membership checks in this migration.

Old clients are **not** compatible with the new create flow: direct session insertion now initializes the host and playback state. Old clients then try to insert those rows again. The maintenance/version gate is required; a database-only deployment is not a complete rollout.

## Database contract

- `session_participants_one_current_per_user` is a partial unique index on `user_id` for exactly the three current statuses. Direct inserts and historical reactivation cannot bypass it.
- `create_session(jsonb)` derives its host from `auth.uid()`. Session, host participation, and playback state are one transaction, including direct allowed session inserts.
- `join_session(uuid, uuid default null)` derives its participant from `auth.uid()`, checks existing visibility rules, locks the parent, and preserves current same-session retries. It does not downgrade host/riding/paused state or clear bike/timestamps on retries.
- `respond_to_session_invite(uuid, invite_status)` and direct invitation updates join and accept together. Failure leaves the invitation pending. New invitations must be pending.
- `set_session_status(uuid, session_status)` requires the host. Direct terminal updates also finalize all current participants and stop the shared playback flag atomically. Terminal sessions cannot reopen or change terminal mapping.
- `set_participant_status(uuid, participant_status)` operates on the authenticated participant. Hosts cannot release participation while their parent remains open. Guests can finish, leave, or drop. Explicit joins and intentional direct-write reactivation reserve the same unique slot and begin a new interval. The status RPC rejects a historical-to-current transition, so a stale GPS status update cannot implicitly rejoin a departed interval.
- Trigger functions have a fixed search path and are not callable by app roles. App RPCs are executable by `authenticated`, not `anon`/`PUBLIC`. Existing session visibility remains unchanged. Historical membership still permits the existing history reads; live queue/playback/location writes require current membership.
- Lifecycle operations lock the parent before admitting participation. Direct concurrent SQL updates can receive a PostgreSQL deadlock/transaction error; retry the complete failed transaction. An aborted transaction must never be treated as a successful leave or join.

## Local verification

Requires Docker and Node 22.17 or a compatible newer Node runtime. This fixture creates only `pacelock-session-test-db`, `pacelock-session-test-api`, and the `pacelock-session-test` network. It never loads `.env` or accepts a cloud URL.

```powershell
node tests/local-session-db.mjs setup
$env:SESSION_TEST_DISPOSABLE = 'local'
$env:SESSION_TEST_URL = 'http://127.0.0.1:55431'
node --test tests/session-migration.integration.mjs
node --test tests/session-membership.integration.mjs
npm test
npm run typecheck
```

The migration test starts from the old schema behavior, reproduces A/B/C duplicates, verifies preflight failure and explicit guest/host reconciliation, rehearses rollback, and leaves the migration installed. The membership test requires that migrated fixture. Running membership tests without the explicit local environment fails, rather than reporting skipped tests as passing. Run these two database files sequentially: both own/reset the same isolated fixture.

Setup refuses an existing named fixture. To reuse a stopped fixture:

```powershell
docker start pacelock-session-test-db pacelock-session-test-api
```

The local fixture uses real PostgreSQL 17, PostGIS, PostgREST, RLS, and independently signed test JWT identities through the installed Supabase client. It emulates `auth.uid()`; it does not run Supabase Auth, Realtime, or native location/audio. Test JWT keys are local fixtures, never deployment credentials.

## Rollback

Keep session writes closed. Restore the previous app while clients remain gated; run `rollback/202611150001_single_current_session.sql` as the database owner; verify the prior API contract, then reopen writes. The rollback removes only the new index/triggers/RPCs/helper and restores the prior affected write policies. It leaves session and participant rows intact.

Reconciliation is not automatically reversible. Rejoining previously released rows can recreate the original conflict and can contradict rides that have since occurred. Use the saved audit/backup and an explicit reviewed decision for any data restoration. Never delete historical rows to make an index install.

## Operational limits

Membership restoration, polling, Realtime notifications, and foreground refresh use committed participation. Remote release is detected by Realtime when available, with a 15-second foreground polling fallback and refresh on foreground entry. An offline or suspended device cannot learn remote changes immediately. Already dispatched HTTP, broadcast, or native audio operations cannot be recalled. Client generation checks prevent obsolete continuations; serialized audio cleanup drains issued commands before a new session controls the player. Public Realtime broadcast transport is not upgraded to server-authorized private channels by this change.

Before production rollout, verify full Supabase Auth/Realtime configuration, native GPS permissions/background behavior, MusicKit/preview playback, two actual devices, and channel/watcher counts over repeated transitions. Local database success does not establish those properties or deploy this migration.
