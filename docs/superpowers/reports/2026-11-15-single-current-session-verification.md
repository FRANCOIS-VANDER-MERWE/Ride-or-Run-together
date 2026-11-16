# Single current session implementation evidence

Branch: `codex/single-current-session`, based on `a545a85`. The hosted SQL migration was deployed after the initial local verification, as recorded below. The existing `AGENTS.md` modification and untracked `.codex/`, other `docs/`, and `graphify-out/` content were preserved.

## Results

- Baseline `npm run typecheck`: passed.
- Old isolated schema: one fixture user had 1, 2, then 3 current participant rows after A/B/C joins. This reproduced the database defect; the original visible device glitch was not reproduced.
- `npm test`: 28 client/service/component tests passed across six files. Coverage includes named conflict mapping for create/join/accept, authoritative restoration, stale account callbacks, refresh stability, failed leave, read-only history, delayed room/channel/queue/playback/GPS results, permission/setup errors, shared location ownership, audio ordering, and fresh statistics across participation intervals. Same-session renders preserve progress.
- `SESSION_TEST_DISPOSABLE=local SESSION_TEST_URL=http://127.0.0.1:55431 node --test tests/session-membership.integration.mjs`: 17 tests passed on the isolated migrated PostgreSQL/PostGIS/PostgREST fixture. Concurrent separate-client and mixed join/create/invite operations have one winner. Direct inserts/updates, host reservation, retry preservation, status release/reactivation, terminal races, access checks, and rollback of partial failures are covered.
- `SESSION_TEST_DISPOSABLE=local node --test tests/session-migration.integration.mjs`: one migration rehearsal passed. Preflight rejects duplicates, terminal-current rows, and missing hosts. Empty/insufficient reconciliation choices fail. Explicit fixture survivor A preserves B/C as `left`; a conflicting hosted fixture requires explicit cancellation. Rollback preserves participant records and their reconciled timestamps.
- `npm run typecheck`: passed after implementation.
- `graphify update .`: AST rebuild completed with 627 nodes, 1251 edges, and 32 communities. Generated files were retained; label-refresh/no-symbol warnings are not SQL validation.
- `npx expo start --port 8093 --offline`: Metro started. Android bundle request returned HTTP 200. Web bundle failed resolving `expo-sqlite/web/wa-sqlite/wa-sqlite.wasm`; the asset exists, but unchanged Metro configuration does not declare WASM asset handling. No web configuration change was included.

Tests were written and observed failing before the relevant fixes. Additional review regressions caught obsolete account callbacks, terminal playback insertion, already-accepted invitation insertion, reactivation timestamps, stale activity resurrecting a released membership, and delayed channel cleanup clearing the next room. These were fixed and rerun. A corrupt current membership attached to a terminal parent now fails closed instead of being silently hidden by the membership query.

## Real account reconciliation

The user supplied an app login after the local implementation. A read-only authenticated audit found two current rows for that account, both on already completed parent sessions, and no open hosted session. No live session could be retained. The two rows were finalized as `finished`, using their parents' existing `ended_at` values for missing `finished_at`. All other participant columns were compared before/after and preserved. A subsequent query found zero current rows for the account. No rows were deleted, and no password or token was persisted in artifacts.

The initial cleanup was scoped to that account. A follow-up used an existing DBeaver administrator connection, verified to match the app's Supabase project. The global audit found 12 additional current rows attached to completed parents; the two valid memberships in the open “Nov 12” session required no changes.

A private lifecycle backup was exported and parsed successfully: 21 participant rows, 13 session metadata rows (excluding precise meetup coordinates), two invitations, 13 playback rows, and the affected policies. Terminal cleanup and the reviewed migration were applied in one transaction, with identity, expected-count, survivor, and field-preservation assertions. After commit, all 21 original participant rows remained; duplicate users and terminal-current rows both numbered zero. Both valid current memberships remained unchanged. The deployed migration SHA-256 was `3DABEBEF79997965CCD7DBEF8A93C549D140DCF6DDBB9219E07D648EFA150960`.

Authenticated hosted API verification then confirmed creation with host/playback initialization, rejection of a second create/join through a separate client, same-session retry preservation, and terminal cleanup. The dedicated verification session was completed and retained as history. This fixed the missing `public.create_session(p_input)` error. Deployment was performed manually through DBeaver; do not assume Supabase CLI migration history was registered.

## Review and limits

The plan explicitly restricted subagents to an explicit user request, so final review was an author self-review, not an independent reviewer. No multi-session membership, automatic switching, ownership transfer, music-provider change, navigation redesign, or runtime dependency was added. Existing mounted-tab behavior remains intact. The test renderer is pinned to installed React 19.3.0; test dependencies are dev-only.

Actual two-device behavior, Realtime delivery, native GPS/background permissions, MusicKit/preview audio, and Auth flows beyond password sign-in remain validation work. The local fixture tests PostgreSQL/RLS through PostgREST, not those services. Remote release can remain unknown until notification/polling/foreground refresh succeeds. Issued network/native commands cannot be recalled; audio is drained before the next session's commands. Production broadcast authorization was not redesigned.

`npm install` reported 10 dependency advisories (1 low, 6 moderate, 3 high). No unrelated audit upgrade was applied. The hosted SQL deployment and API checks above are verified; a completed device demo is not claimed. Browser UI verification stopped because Computer Use could not determine Chrome’s current URL safely.

The temporary Metro server and local Docker fixtures were stopped after verification. Fixture data remains available for an explicit restart; no unrelated Docker containers were stopped.
