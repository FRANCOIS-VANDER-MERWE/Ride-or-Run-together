# One-session-per-user implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement task by task. Use subagents only if explicitly requested. Track steps with checkboxes.

**Goal:** Enforce the user's confirmed rule: each user may be joined to only one session at a time. Prevent a second join from putting the app into conflicting session states.

**Architecture:** Make Supabase enforce exclusive current participation, then make create/join/invite/leave UI follow that committed state. Keep historical participant rows. Retain targeted refresh and resource cleanup fixes needed for a valid leave-A-then-join-B transition; do not build support for simultaneous memberships.

**Tech stack:** Expo SDK 58, React 19.3.0, React Native 0.88.0, TypeScript, Supabase/Postgres, expo-location.

**Spec:** The user clarified: "the users are supposed to join only 1 session at a time" and reproduced glitches by letting the demo user join more than two sessions. This supersedes the previous plan's incorrect assumption that multiple current memberships were intentional. The exact visible glitch and platform remain unspecified. No separate approved design exists; implementation defaults below are explicitly identified.

## Status and boundaries

- Planning originally changed this Markdown file only. Execution is now recorded in `../reports/2026-11-15-single-current-session-verification.md`; app code, dev test tooling, migration artifacts, and the two audited terminal memberships have since been updated.
- The code findings are from static inspection, not a running app or deployed Supabase inspection.
- A later request to execute this plan authorizes implementation in that chat. Writing the plan does not start implementation now.
- Do not ask again whether multiple current memberships are allowed. The user has answered: they are not.
- Default interaction chosen for this plan: block a second join and tell the user to leave the current session first. Automatic leave-and-switch was not requested and must not be introduced silently.
- Existing duplicate memberships require reconciliation before the database constraint can be installed. Preserve records and obtain the survivor choice for affected real/demo data rather than guessing which ride the user meant to keep.

## Required behavior

1. A user has at most one current participant row across all sessions. Both hosts and guests count.
2. Current participant statuses are exactly `joined`, `riding`, and `paused`. Historical statuses are `finished`, `left`, and `dropped`. These values exist in the current enum. Pending invitations are not participation.
3. Joining a lobby or scheduled session consumes the same one-session slot as an ongoing ride. Do not reinterpret this as "one riding session, plus unlimited joined sessions."
4. If joined to A, attempts to join B, accept B's invitation, or create/host B must fail without changing A, accepting the invitation, or creating partial B records.
5. Repeating a join to A is idempotent. It must not reset a riding/paused status, downgrade a host to guest, or erase existing timestamps/bike data unintentionally.
6. To move from A to B, successfully leave/end A first, then join B. A failed leave preserves A. A failed B join leaves the user in no session; it does not resurrect A.
7. Host membership occupies the same slot. Initial implementation requires a host to end/cancel their session before joining or hosting another. Ownership transfer is outside scope.
8. Completing/cancelling a session releases all current participant slots in the same database transaction. Map completion to `finished` and cancellation to `left`, preserving historical timestamps and rows. These terminal-status mappings are implementation defaults, not additional user statements.
9. `activeSession` is the local view of the user's one current membership. A local storage ID, room selection, or "Make Active" button cannot create or legitimize membership.
10. Old rooms, departed sessions, completed sessions, and other users' sessions cannot become active via cached UI state. History remains readable where currently permitted, without starting live activity.
11. Leaving, ending, sign-out, and account change invalidate obsolete async results and stop old location/audio activity. A delayed A response cannot overwrite B after a legitimate transition.
12. Session-specific markers, route, queue, and stats must not mix across sequential sessions. Same-session tab switching must keep ride progress. Do not invent durable history or multi-session stats caching.

## Constraints

- Read current root/nested `AGENTS.md` instructions. When `graphify-out/graph.json` exists, run `graphify query "<question>"` before source searches/reads, use scoped locations, and include that rule in any authorized code-exploration agent prompt.
- Preserve unrelated work. At inspection time `AGENTS.md` was modified; `.codex/`, `docs/`, and `graphify-out/` were untracked. Recheck before edits; stage only scoped files if commits are requested.
- Preserve mounted tabs in `src/App.tsx`; do not cure stale state by discarding ongoing ride state on tab switches.
- Enforce the invariant in the database. A disabled button, localStorage, client preflight query, or non-transactional "check then insert" is insufficient across devices and requests.
- Preserve history. Do not delete duplicate participant rows or use `UNIQUE(user_id)` across all historical participation.
- Do not change music providers, redesign navigation, introduce a global state library, or add runtime dependencies.
- Use existing test tooling where available. Any necessary component test tooling must be dev-only and match installed React.
- SQL changes and a migration are now in scope for the future implementation. Do not apply them or reconcile data in a live deployment during this planning chat.
- After product code changes run `graphify update .`. Document schema rollout/rollback and validate locally before any deployment.
- Do not log credentials or precise GPS coordinates. Do not point destructive integration fixtures at a production project.

## Source map and confirmed mechanisms

Line numbers are investigation-time pointers. Recheck source before editing.

| File | What to inspect/change |
| --- | --- |
| `schema.sql:101-107, 381-393, 562-563` | Participant status enum and composite `(session_id,user_id)` primary key. That key prevents duplicate rows within A, but allows the same user to join A, B, and C. |
| `supabase/rls_policies.sql:26-32, 174-208` | Membership helper checks row existence. Direct session/participant inserts and updates are allowed by current policies; enforcement must cover these paths, not only new RPC callers. |
| `src/services/sessionsService.ts:33-84` | Creation currently writes session, host participant, and playback state in separate requests. New exclusivity failure could leave a partial session unless creation becomes atomic. |
| `src/services/sessionsService.ts:101-123, 189-232` | Listing includes departed rows. Join unconditionally upserts guest/joined. Status updates can reactivate participation and must obey exclusivity too. |
| `src/services/sessionsService.ts:157-171, 269-281` | Ending a session currently does not release participants; invitation acceptance currently precedes the join. Both need atomic lifecycle handling. |
| `src/session/ActiveSessionContext.tsx:54-87` | Refresh depends on the entire session object and replaces it. Startup restoration/refresh can apply obsolete selections; storage uses a global key. |
| `src/components/ComplicationsView.tsx:136-138` | Calling refresh whenever its callback identity changes can repeatedly fetch after successful refreshes. |
| `src/components/PackDeck.tsx:196-364, 418-432, 527-535, 590-599, 1217-1221` | Action/room races, join/leave, arbitrary activation, premature leave cleanup, and invitation UI. Cover create/start/end controls too. |
| `src/components/ComplicationsView.tsx:204-370` | Unscoped playback responses, marker merging, session stats, and GPS handles resolving after cleanup. |
| `src/services/liveLocationService.ts:47-81, 88-187` | Shared channel removal can disrupt another mounted consumer; sharing setup has delayed handles. |
| `src/components/MusicSyncDeck.tsx:235-340` | Async playback following can act after membership ends without rechecking ownership after awaits. |
| `src/services/database.types.ts` | Keep database types/RPC declarations aligned with migration and services. |
| `package.json` | `npm run typecheck` runs `tsc --noEmit`; no test runner was declared at inspection time. |

## Task 1: Reproduce, specify the database invariant, and audit duplicates

**Files:** Existing sources above; add `supabase/migrations/202611150001_single_current_session.sql`, `supabase/diagnostics/current_session_conflicts.sql`, and `tests/session-membership.integration.mjs` in the tasks below. Reuse a different existing migration/test convention if current repository instructions require it; record the final paths here.

- [x] Recheck status and graph, inspect all callers of creation/join/invite/status changes, and record baseline `npm run typecheck` results.
- [ ] Reproduce the demo flow in a disposable local/test database: join A, B, and C as one user. Record participant rows and active UI identity after each request; record the visible symptom if available.
- [x] Add a read-only SQL audit listing each user's current rows, parent session status, host/guest role, and timestamps. Report duplicate current rows and current rows attached to terminal sessions separately.
- [x] Define a non-destructive reconciliation mapping of affected user to retained session. Never choose the survivor from this machine's localStorage alone. For disposable test fixtures, explicitly retain A; for real/demo data, request the intended survivor before applying changes.
- [x] Record how extra guest rows become `left`. For conflicting host-owned sessions, resolve ownership/session termination explicitly; do not silently demote a host or leave an open session without its host.
- [x] Make the migration fail with a useful preflight report if unresolved conflicts remain. No automatic "keep newest" cleanup.

## Task 2: Enforce exclusivity and atomic lifecycle operations in Supabase

**Files:** Migration above, `tests/session-membership.integration.mjs`; update schema/type sources according to repository conventions. Add narrowly scoped RPC functions where atomic multi-table writes are needed.

**Invariant:** Add a named partial unique index on `session_participants(user_id)` with predicate `status IN ('joined', 'riding', 'paused')`. Historical rows remain unrestricted. The index is the concurrent-write backstop, including direct table writes and updates.

**Interfaces:** Keep service-level `createSession`, `joinSession`, `respondToInvite`, `setSessionStatus`, and `setMyParticipantStatus` callable by their current consumers. Implement atomic database operations behind them where required. RPCs must use the authenticated identity rather than trusting a supplied user ID; preserve current access checks and use a fixed search path for any security-definer code.

- [x] Establish a test command using Node's built-in runner and installed Supabase client: `node --test tests/session-membership.integration.mjs`. Require an explicitly configured disposable test project; fail clearly when missing, rather than silently reporting a skipped suite as passing.
- [x] Write failing database tests: A then B rejects B; parallel A/B joins via separate clients authenticated as the same user yield exactly one winner; direct INSERT and UPDATE from historical to current cannot bypass the rule; another user can join B normally.
- [x] Add tests for same-A retries preserving role/status/timestamps, all three current statuses blocking B, and all three historical statuses releasing the slot.
- [x] Add transactional tests: blocked create leaves no session/playback/host rows; blocked invite acceptance leaves invite pending; leave then B succeeds; end/cancel releases every participant; completed/cancelled sessions reject new participation.
- [x] Add join-versus-end/cancel race coverage. Prevent a terminal session from acquiring a late current participant after its cleanup. Validate/lock parent session state consistently with lifecycle updates.
- [x] Run tests and confirm the old implementation fails them. Apply only the reviewed conflict reconciliation in the disposable database, then install the unique index and required atomic lifecycle functions/triggers.
- [x] Implement creation and invitation acceptance transactionally. Preserve authentication, authorization, visibility, and host role. Ensure direct allowed table paths cannot evade membership exclusivity or terminal-session cleanup.
- [x] Make completion/cancellation finalize all current participants atomically. Guard reopening a terminal session so it cannot silently recreate conflicting membership.
- [x] Return a stable, recognizable membership-conflict result for services to map into user-facing copy. Do not classify every unique violation as this conflict; match the named index/error details.
- [x] Run integration tests against the migrated database, including concurrent requests. Verify cross-user access remains denied and no partial writes remain after failures.
- [x] Document rollout order, preflight, data backup/reconciliation, and rollback. Rollback removes new enforcement/functions compatibly without deleting participation history or pretending reconciliation is automatically reversible.

## Task 3: Make every app entry point obey the same rule

**Files:** `src/services/sessionsService.ts`, `src/services/database.types.ts`, `src/components/PackDeck.tsx`, `src/session/ActiveSessionContext.tsx`; add focused tests at `src/services/__tests__/sessionsService.test.ts` and `src/session/__tests__/ActiveSessionContext.test.tsx` using the smallest compatible local setup.

**Interfaces:** Preserve public service signatures where feasible. Add `fetchCurrentSession(userId: string): Promise<RideSessionRow | null>` if no equivalent exists. It queries current participation and a nonterminal parent session; it must report inconsistent multiple matches rather than arbitrarily returning the first. Keep `activeSession`, `setActiveSession`, and `refreshActiveSession` context shape unless every caller is updated together.

- [x] Write failing tests for Discover join B, invite acceptance B, and create/host B while joined to A. Assert A remains unchanged and the UI shows a useful conflict without partial success.
- [x] Map the backend conflict to: `You are already in a session. Leave your current session before joining another.` Explain host end/cancel requirements in the host flow.
- [x] Disable incompatible join/create/accept actions while current membership is known, with visible explanatory text and a path to the current session. Also handle server rejection when local state is stale. Keep same-session retry/open usable.
- [x] Remove or restrict arbitrary "Make this my active session" activation. History/room viewing must not select a session without current membership or start live publishing.
- [x] Use committed membership as the source of truth at startup, refresh, and after lifecycle mutations. Ignore stale/foreign cached IDs; report unresolved duplicate memberships without starting competing activity.
- [x] Write deferred-fetch tests: successful refresh settles without repeating indefinitely; a leave/clear/account change invalidates the old response; after valid leave A then join B, a late A response cannot restore A.
- [x] Make refresh triggering stable, handle rejected requests, and scope persistence to the authenticated user. Do not use localStorage as the exclusivity mechanism.
- [x] Test failed leave preserving the room/current session. Close and clear only after confirmed membership release; host termination and remote completion must also refresh membership. A stale second device must recover when it discovers that its membership ended.
- [x] Guard rapid repeated actions while retaining database enforcement. Keep departed/historical rows out of joined-member actions without deleting history or building a new history feature.
- [x] Run focused tests and `npm run typecheck`.

## Task 4: Clean up sequential-session state and live activity

**Files:** `src/components/PackDeck.tsx`, `src/components/ComplicationsView.tsx`, `src/components/MusicSyncDeck.tsx`, `src/services/liveLocationService.ts`; add focused tests at `src/components/__tests__/sessionLifecycle.test.tsx` and `src/services/__tests__/liveLocationService.test.ts`.

**Scope:** These checks cover valid leave/end-A-then-join-B transitions and recovery from pre-existing invalid state. They must not preserve or add simultaneous current membership support.

- [x] Write failing tests where A's room/queue/GPS/music request resolves after A was left and B joined. Assert no A state, subscription, location publish, or audio command is applied under B.
- [x] Include account change, rejected GPS setup, permission denial, and close-before-load-completes. Late-created obsolete GPS handles must stop immediately and cannot overwrite B's handles.
- [x] Verify old markers/route/queue/stats clear at the session boundary. Keep ongoing A progress across tab changes. For a new participation interval, start fresh live stats while preserving any existing recorded history; resuming old stats is outside this fix.
- [x] Verify Pack and Ride consumers of the same allowed session do not tear down each other's location channel. Release the final owner cleanly and make repeated cleanup harmless; use the smallest ownership mechanism that passes the tests.
- [x] Apply session/user generation checks after awaits and before subscription installation, state updates, error callbacks, and audio side effects. Fix stale work rather than unmounting all tabs.
- [x] Verify only the current session can own location publishing/shared music, including when its tab is hidden. Remote membership release must invalidate old activity on refresh/subscription notification.
- [x] Run focused tests and `npm run typecheck`.

## Task 5: Verify the demo regression and rollout readiness

- [x] Run database integration tests, component/service tests, and `npm run typecheck`. Record exact commands/results and pre-existing failures.
- [x] Run `graphify update .` after product edits and inspect generated changes. Do not discard a large generated graph diff as churn.
- [ ] Start the app with `npx expo start`. With a reconciled demo user, join A and attempt B and C through every entry point. Both attempts must fail cleanly; A remains the sole current membership and live session.
- [ ] Repeat using two devices/browser clients for the same account, including simultaneous join/create/invite requests. Exactly one current row may survive; losing clients must show the committed result.
- [ ] Verify guest leave, host end/cancel, participant finish/drop, new join after release, leave failure, same-session retries, app restart, account switching, and remote termination. Historical rows must not block the next join.
- [ ] Check request/channel/watcher counts settle across repeated valid transitions. No refresh loop, stale subscriptions, old-session broadcasts, or mixed-session display may remain.
- [x] Verify migration preflight rejects unresolved duplicates. Test reconciliation and rollback in a disposable database. Prepare a reviewable deployment artifact; do not treat local migration success as live deployment.
- [x] Review the scoped diff and update this plan's checkboxes. Report what was reproduced/fixed, migration state, and which device/audio/backend checks were unavailable. Commit only scoped files if requested.

## Execution notes (2026-11-15)

- Local evidence: 28 client tests, 17 database tests, migration/rollback rehearsal, typecheck, and Android Metro bundle passed. The knowledge graph was updated. Full commands, rulings, and limits are in the verification report.
- Task 1 reproduction: the disposable old database accepted A/B/C as 1/2/3 current rows. The original on-device UI glitch and active identity after each old request were unavailable, so that combined manual checklist item remains open.
- Real account audit: two current rows were attached to completed sessions, with no open membership/hosted session. Both were finalized as `finished` using the existing parent end timestamps. Other participant fields and all rows were preserved. No live survivor was selected. This was an account-scoped audit, not an administrator-wide audit.
- Ruling: current membership queries inspect all current rows and validate parent state rather than filtering terminal parents out before checking consistency. This exposes corrupt legacy rows and fails closed.
- Ruling: preserve the existing history list as read-only snapshots. Room viewing does not select active membership, subscribe to live state, publish GPS, or enable membership controls.
- Ruling: remove active-ID persistence; restore from Supabase. No global cache key can select a room. Membership status RPCs cannot resurrect historical intervals through stale GPS activity; explicit join remains required.
- Hosted follow-up: an existing DBeaver admin connection was verified against the app project. A private backup was exported; 12 additional terminal-current rows were finalized and the migration installed atomically. All 21 original participant rows and both valid Nov 12 memberships were preserved. Authenticated create, second-session rejection, same-session retry, and completion cleanup passed. See the updated verification report.
- Unchecked Task 5 items require actual device/full Supabase verification. Metro started and Android bundling passed; web bundling hit the unchanged SQLite WASM asset configuration issue. No two-device, native GPS/audio, or real Realtime validation is claimed. No commits were requested or created.

## Completion conditions

- A database constraint prevents more than one current participant row per user under concurrent/direct writes.
- Create, join, invitation acceptance, and participant status reactivation all respect exclusivity without partial records or false success.
- Completed/cancelled sessions and released participants free the slot; departed rows remain historical.
- The demo user can no longer join B or C while joined to A. The app remains stable and explains why the action was blocked.
- Active identity follows current committed membership; cached/history sessions cannot bypass it.
- Valid sequential participation cannot leak data, location activity, audio commands, or obsolete responses across sessions.
- Existing duplicates have a reviewed reconciliation path; unresolved data is explicitly reported rather than silently discarded.
- Regression tests/typecheck pass, with deployment and native-device limits stated plainly.

## Suggested prompt for the next chat

> Read `docs/superpowers/plans/2026-11-15-multiple-session-lifecycle.md` and execute it task by task. The confirmed product rule is one joined session per user at a time, including hosts. Block a second join/create/invite acceptance until the current participation is released; do not implement multi-session membership or automatic switching. Enforce this atomically in Supabase, reconcile existing duplicates without deleting history, then align UI and lifecycle cleanup. Preserve unrelated work and finish with regression/migration evidence and explicit device/backend limits.
