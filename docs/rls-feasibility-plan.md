# Grainline RLS Feasibility Plan

Last updated: 2026-07-18

Grainline's production control plane is application-layer authorization through Clerk middleware, route handlers, server actions, shared visibility helpers, and ownership predicates. `SavedSearch` is the approved first production RLS table, but RLS remains defense in depth rather than a replacement for those checks. A broad rollout with Prisma and pooled Neon connections can break legitimate traffic or create false confidence if runtime roles still own tables or bypass policies.

Execution tracking for the least-privilege runtime role, grant audit, request
context proof, and first table prototypes lives in
`docs/db-defense-in-depth-plan.md`.

## Decision

Do not enable broad or untested RLS directly on production tables. `SavedSearch`
may be activated only after its staging context, locality, role-separation,
exact-policy, route-fixture, and rollback gates pass. Expand to another table
only after its request context and admin/cron/webhook bypass model is proven.

Current staging result (2026-07-17): the isolated runtime/migration role split,
explicit grant provisioning, grant audit, migration-status checks, region
selection, and pooled context isolation checks pass. The latest provider-owned
Vercel runtime run failed only the performance/adoption thresholds, with 10
performance issues: wrapped p95 was approximately 96--100 ms versus a 39--40 ms
autocommit baseline, average connection hold was approximately 93--96 ms versus
37--40 ms, and the Prisma burst result was approximately 199 ms versus 78 ms.
The durable ledger correctly blocked slot 2 because slot 1 did not pass. This is
failed evidence, not promotion evidence, and rerunning the unchanged workload is
not a remedy. The earlier workstation artifact
`context-gate-failed-pre-pool-fix.json` also remains diagnostic-only,
pre-pool-fix evidence. Before another counted run, use the corrected harness:
keep the raw control pool at 16 so the 16-request burst is not capped, run the
Prisma path through the application's explicit 10-connection pool, and mark
Prisma acquisition timing unavailable rather than zero. Also measure a
representative SavedSearch route/SLO; do not lower thresholds after observing
the result. Two consecutive
passing production-runtime runs on the same reviewed commit SHA and
configuration plus independent Git-deployment attestation remain required.
The corrected gate now includes a persistent synthetic one-statement
`SECURITY INVOKER` candidate and compares it with a true one-statement
autocommit baseline through the application-sized Prisma pool. That result is
transport/performance evidence only. The separate real-table gate must still
prove the exact SavedSearch RPCs and policies on isolated staging.

## Current Scope Boundary

This rollout pass is **Bucket A: SavedSearch only**. It includes the
least-privilege runtime role, SavedSearch context adoption, staging policy proof,
production phase A, and a separately approved phase-B `FORCE` decision. Stop
before designing or implementing Bucket B. `Notification` is Bucket B and must
be handled in a separate pass; the later table sequence below is retained only
as future architecture, not authorization to widen this rollout. SavedSearch
rollout phase B (`FORCE`) is still part of Bucket A; it is not Bucket B.

## Required Architecture

- **Migration owner role**: owns tables and runs migrations. Not used by the web runtime.
- **Runtime app role**: used by Prisma in normal web requests. Must not own tables and must not have `BYPASSRLS`.
- **Bypass/service role**: explicit, narrowly held role for migrations, controlled admin maintenance, and emergency repair. Do not use it for normal app traffic.
- **Request context**: every RLS-protected operation must establish
  transaction-local `app.user_id` in the same database unit before protected
  SQL executes. Multi-statement units use an explicit Prisma transaction whose
  first statement is `set_config('app.user_id', $userId, true)`. The reviewed
  SavedSearch list/read and delete-one operations instead use narrow
  one-statement `SECURITY INVOKER` functions that set and verify the same local
  context before their owner-filtered SQL. The context value must be the
  server-resolved authenticated local `User.id`, not a request body, query
  string, route param, or other client-supplied value. The `true` flag is
  required so context is transaction-local and does not leak through the pool.
  The SavedSearch RPC `p_user_id` is still asserted by application code rather
  than authenticated independently by PostgreSQL. An AST allowlist must pin
  each helper callsite and its first-argument identity expression; parameter
  shape validation inside the RPC is not a substitute for this trust boundary.
  A holder of the runtime role that can issue arbitrary SQL can assert another
  syntactically valid user id through the RPC or GUC. When reviewed code
  supplies the correct authenticated id, this prototype catches omitted or
  incorrect query ownership predicates and fails closed on absent context; it
  does not catch a wrong asserted id or provide identity isolation after
  runtime-credential compromise or SQL injection.
- **Staff context**: staff/admin access needs either explicit `app.role` transaction context or separate audited bypass helpers. Do not silently grant all employees broad RLS bypass in normal user flows.
- **Provider context**: webhooks, cron jobs, and provider callbacks need explicit service-path decisions; do not make them rely on arbitrary end-user context.
- **Grant hygiene**: every future migration that creates tables, sequences, or
  `grainline_*` functions must grant the runtime role the minimum required
  table/sequence privileges and `EXECUTE` on functions that constraints,
  defaults, or app queries invoke. Current source inventory is 58 model tables,
  20 enum types, 3 custom `grainline_*` functions, 1 source-derived extension
  (`pg_trgm`), and 0 sequences. Function and enum access may be covered by
  Postgres `PUBLIC` defaults today, but that is a public-default dependency to
  verify against the live DB, not a substitute for an explicit grant audit.
  Trusted extension functions may be bootstrap/admin-owned even when
  `CREATE EXTENSION` runs as the migration role, so the audit must fail if
  runtime `EXECUTE` is missing and the declared migration role cannot grant it.
  Add a CI or staging grant audit before swapping production runtime credentials
  to a non-owner role.
- **Forced policy proof**: behavior probes must authenticate as the exact
  non-owner runtime role so owner bypass cannot produce a false green. The
  `SavedSearch` production rollout deliberately separates `ENABLE ROW LEVEL
  SECURITY` from `FORCE ROW LEVEL SECURITY`: phase A uses explicit `NO FORCE`.
  Elapsed time alone does not drain callable owner-backed deployments. Before
  phase B, disable superseded deployments or rotate/revoke their owner runtime
  credentials, prove with `pg_stat_activity` that owner-backed application
  sessions are gone, choose and test an owner/maintenance strategy for the table
  owner once `FORCE` applies, and retain a tested database-first rollback.

## Hard Gates

- Prove request context isolation against the actual production-like connection
  topology: Prisma with `@prisma/adapter-pg`, the app `pg` pool, and the Neon
  pooled `DATABASE_URL`. A direct `DIRECT_URL` test is not sufficient.
- Laptop/workstation runs must use
  `RLS_CONTEXT_GATE_LOCALITY_CONFIRM=diagnostic-only`; they are useful for
  correctness and troubleshooting but are never promotion evidence. Owner-only
  prepare/rollback is a separate non-counted setup run. The two counted runs are
  identical repeat-mode calls from one Git-integrated Vercel Preview, against
  the exact reviewed Neon endpoint id, database name, and region. Provider
  variables make an artifact a runtime candidate only; the gate never
  self-asserts acceptance. Independently attest the Vercel deployment's Git
  source/ref/SHA/id and match it to both artifacts before promotion.
- The Preview runner is repeat-only and must not receive an admin URL. Its
  temporary opaque run id is backed by a staging ledger that permits exactly
  two sequential slots: slot 2 is blocked until slot 1 is durably passed, and
  neither slot can be replayed. Remove all temporary runner secrets and staging
  URL configuration immediately after capture.
- The prior Preview gate trigger secret appeared in captured tool/session output
  and must be treated as exposed. Rotate it before any further run, delete local
  temporary files containing it after retaining sanitized evidence, and verify
  the old value no longer works. The internal Preview runner is temporary test
  infrastructure and must never be merged or enabled as a production feature.
- Prove both unset `app.user_id` and explicitly empty `app.user_id` return zero
  protected rows.
- Prove transaction-local context does not leak after `prisma.$transaction`
  completes or after the pool reuses a connection for another user.
- If a protected query runs under a serializable retry helper, set
  `app.user_id` as the first statement inside each retried transaction callback.
  Do not set context once outside a retry loop, and do not pair serializable
  retry with weaker transaction isolation.
- Do not run parallel Prisma queries inside an interactive transaction used for
  RLS context. Queries that currently use `Promise.all` must be serialized or
  redesigned when wrapped in the context helper.
- Prove the wrapper's performance characteristics, not only its isolation
  semantics. Measure protected-read p95/p99 latency, interactive-transaction
  `timeout`/`maxWait` behavior, connection-hold time, and pool saturation under
  realistic staging concurrency before widening the wrapper to hot paths such as
  notification reads.
- Prove a one-statement function candidate separately against a true
  one-statement autocommit baseline at target and burst concurrency. Keep the
  synthetic function across both provider-runtime repeats so the exact same
  catalog object is measured, then run the owner-only teardown and verify it is
  absent after retaining both artifacts. This candidate proof does not replace
  the real SavedSearch migration/policy/behavior gate.
- Measure the same Prisma pool shape the application will deploy. The failed
  provider deployment created its Prisma probe with the target concurrency of
  8, while the reviewed app pool is now explicitly 10. The corrected harness
  deliberately keeps a separate raw control pool of 16 so the configured
  16-request burst is not capped, but runs Prisma through the app-sized pool and
  records both values. Prisma does not expose trustworthy connection-acquisition
  timing here; do not record a synthetic zero as proof that acquisition wait
  passed. State the metric as unavailable and use the explicit 16-request queue,
  timeout, error, and route-specific evidence for the promotion decision.
- Retain the gate's warmed, checked-out sequential `SELECT 1` query-RTT proxy as
  locality context. It is diagnostic metadata only: do not subtract it from,
  normalize, discount, or otherwise change the existing latency and
  connection-hold thresholds.
- Use `npm run audit:rls-context` as the generic wrapped-versus-unwrapped
  connection and latency baseline. Do not create a second generic benchmark,
  but do run route- and table-specific staging smoke tests against realistic
  `SavedSearch` data before promoting its policy.
- Stop the RLS rollout if any of these proofs are flaky under the pooler.

## Prototype Sequence

1. **SavedSearch**: owner column is direct (`SavedSearch.userId`). Prototype
   current-user `SELECT`/`INSERT`/`DELETE` first as the lowest-risk real-table
   adoption proof, including the existing account-deletion transaction.
2. **Notification**: owner column is direct (`Notification.userId`) for user
   reads and mark-read updates, but notification creation/deletion is not
   owner-symmetric. Prototype user-scoped `SELECT`/`UPDATE` only after choosing
   and testing service/cross-user `INSERT` and cleanup `DELETE` behavior.
3. **Cart + CartItem**: `Cart.userId` is direct; `CartItem` depends on the parent cart. This tests parent-join policies.
4. **SavedBlogPost**: direct owner row, similar to SavedSearch. Prototype after
   Cart once account-deletion cleanup, account-export reads, account feed reads,
   homepage/blog saved-state reads, and blog save/unsave routes are wrapped.
5. **Favorite + Follow + Block**: do not group these with simple owner tables.
   Favorite and Follow have public aggregate/fanout semantics, and Block is
   bidirectional. They need separate product/read-design work before any RLS
   prototype.
6. **Conversation + Message**: participant policies (`userAId`/`userBId`) and staff-reported-thread exceptions. Requires careful staff bypass design.
7. **Order + OrderItem + OrderPaymentEvent + OrderShippingRateQuote**: buyer access plus seller access through listing ownership. Higher risk because checkout, refunds, labels, tax records, and support all depend on these rows.
8. **Case + CaseMessage**: buyer/seller participant access plus staff/admin case handling. High risk; do after messages and orders.

## Candidate Table Matrix

| Table | Current app-layer owner model | RLS difficulty | Prototype decision |
|---|---|---:|---|
| `Notification` | `userId` | Low for reads; asymmetric writes | Second prototype after service-write design |
| `SavedSearch` | `userId` | Low | First real-table prototype |
| `Cart` | `userId` | Low | After direct-owner prototype |
| `CartItem` | Parent `Cart.userId` | Medium | Requires parent policy test |
| `Favorite` | `userId`; public listing favorite counts and ranking use cross-user aggregates | High | Defer until public aggregate/count design exists |
| `SavedBlogPost` | `userId` | Low | Candidate after cart |
| `Follow` | `followerId`; public follower counts and follower fanout read cross-user rows | High | Defer until public count/fanout design exists |
| `Block` | `blockerId` for writes; reads need `blockerId = me OR blockedId = me` | Medium | Bidirectional policy plus system fanout bypass required |
| `Conversation` | `userAId` or `userBId`; staff-reported-thread exception | High | Design after prototype |
| `Message` | Parent conversation participant; sender/recipient checks | High | Design after conversation |
| `Order` | `buyerId` or seller owns an order item listing | High | Do not prototype first |
| `OrderItem` | Parent order buyer or listing seller owner | High | Do not prototype first |
| `OrderPaymentEvent` | Parent order buyer/seller; staff/admin | High | Do not prototype first |
| `OrderShippingRateQuote` | Parent order buyer/seller; seller label flow | High | Do not prototype first |
| `Case` | `buyerId` or `sellerId`; staff/admin | High | Do not prototype first |
| `CaseMessage` | Parent case participant; staff/admin | High | Do not prototype first |
| `UserReport` | `reporterId`/`reportedId`; admin resolution | High | Admin workflow design first |
| `AdminAuditLog` | Admin-only | High | Do not RLS until admin bypass model is mature |

## Required Tests Before Any RLS Migration

- A direct database test connects through the runtime-role `DATABASE_URL`, not
  the migration owner, and proves the runtime role cannot read another user's
  protected row without `app.user_id`.
- A direct database test proves `set_config(..., true)` is transaction-local and does not leak to the next query/pooled connection.
- App route tests keep passing with the RLS helper wrapper enabled.
- Admin/cron/webhook tests prove their bypass path is explicit and audited.
- Rollback test proves RLS can be disabled or policy changes reverted quickly without data loss.
- Rollback test also proves that `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`
  leaves the app's transaction-local `set_config` wrapper harmless, so a bad
  policy can be mitigated at the database layer before an app redeploy.
- A grant-audit test proves the runtime role has required privileges for every
  table, sequence, and `grainline_*` function used by the app, and no ownership
  or `BYPASSRLS`.
- Route-level happy-path tests prove protected reads still return the current
  user's rows. DB-denial tests alone are insufficient because missing context
  wrappers can fail closed silently.
- The first real-table staging proof must seed a non-customer user with a known
  `SavedSearch` row and require that exact row id through every protected read
  surface. An HTTP 200 with an empty collection is a failure when the fixture
  exists. The cleanup proof must delete the synthetic row under the same trusted
  target-user context and verify it is gone. Record only bounded synthetic ids
  and counts; do not add a production bypass solely for observability.
- Staging load/smoke tests prove the interactive-transaction wrapper does not
  turn slow protected reads into transaction timeouts or saturate the pooled
  connection budget before ordinary app traffic does.

## Notification Prototype Edge Cases

`Notification` is the second prototype table, and it is not a simple
`userId = app.user_id` table for every verb.

- `createNotification()` writes rows for recipients, not necessarily for the
  actor. It is called from follow/favorite/case/message/follower-fanout flows,
  admin flows, Stripe webhooks, and cron/system paths.
- A naive `INSERT WITH CHECK (userId = current_setting('app.user_id', true))`
  would block legitimate cross-user and zero-user-context notification creation
  and can turn notification fanout into 500s.
- Notification cleanup also includes cross-user/system deletes, including
  account-deletion sensitive-text cleanup and notification pruning.
- The first `Notification` policy design should therefore protect user reads and
  mark-read updates with owner-scoped `SELECT`/`UPDATE`, while choosing one of
  these explicit write strategies:
  - permissive runtime `INSERT`/system `DELETE` policies, with app-layer
    authorization remaining the control for notification creation and cleanup;
  - or a dedicated service/bypass helper used by every cross-user writer and
    cleanup path.
- The owner-scoped `UPDATE` policy must include both `USING` and `WITH CHECK`
  predicates on `userId = app.user_id`; `USING` controls which rows can be
  updated, while `WITH CHECK` prevents a buggy update from reassigning a
  notification to another user.
- If the prototype starts with permissive runtime `INSERT`, do not later tighten
  `INSERT` to owner-scoped without also auditing `createNotification()` error
  handling. RLS-denied inserts raise a permission error (`42501`), not the
  `P2002` unique-conflict path that notification dedup currently treats as
  non-fatal.
- Before enabling the policy, inventory and wrap all notification read/update
  paths, including `/api/notifications`, `/api/notifications/read-all`,
  `/api/notifications/[id]/read`, dashboard notification pages, notification
  bell data sources, message-thread auto-mark-read updates, seller manual-stock
  low-stock notification dedupe reads, and account export reads.
- The manual-stock low-stock dedupe read is authenticated-seller user context:
  the stock route first proves `seller.userId = me.id`. Webhook/cron/admin
  low-stock and other notification creation paths remain service/write-path
  decisions through `createNotification()`, not user-context read wrappers.
- Existing read paths that use parallel `findMany`/`count` queries must be
  serialized or otherwise adapted inside the transaction-local context helper.

## SavedSearch Prototype Edge Cases

`SavedSearch` is the first real-table prototype, but its cap and writes still
need retry/context discipline.

- `SELECT`, `INSERT`, and `DELETE` can be owner-scoped to `app.user_id`.
- Release 0 retains the general runtime CRUD grant while RLS is absent. Phase A
  must narrow `SavedSearch` to exactly `SELECT`/`INSERT`/`DELETE` with no
  effective or direct `UPDATE`; there is no current update path or update
  policy. The Phase-A provisioning SQL re-revokes `UPDATE` after its bulk table
  grant so reruns preserve that exact posture, while other tracked tables and
  future table defaults remain CRUD.
- The saved-search cap must continue to run in the same transaction as the
  insert.
- If serializable retry is used, the RLS context must be set inside each retry
  transaction before count/read/write work.
- Duplicate lookup, cap count, and create stay in one
  `withSerializableDbUserContext` unit. Account-deletion cleanup stays in its
  existing outer branded context transaction.
- List/read and delete-one are centralized in `savedSearchOwnerAccess.ts` and
  use only parameterized tagged `$queryRaw` calls to
  `public.grainline_saved_search_list(text, integer, text)` and
  `public.grainline_saved_search_delete_one(text, text)`. The functions remain
  ordinary non-leakproof PL/pgSQL, `SECURITY INVOKER`, `VOLATILE`, `PARALLEL
  UNSAFE`, `search_path=pg_catalog`, explicitly owner-filtered, and executable
  only by the non-owner runtime role. The static guard permits those function
  names only in the centralized helper and rejects unsafe raw escape hatches.
- These RPCs do not authenticate `p_user_id` themselves. The AST guard pins the
  reviewed calls outside the helper exactly:
  `src/app/account/page.tsx`,
  `src/app/account/saved-searches/page.tsx`,
  `src/app/dashboard/page.tsx`, and
  `src/app/api/search/saved/route.ts` pass `me.id`;
  `src/app/api/account/export/route.ts` passes its server-resolved `user.id`;
  and `src/app/api/cron/ops-health/route.ts` passes only the strict
  nonce-paired synthetic-canary `userId`. It inventories direct named-import
  aliases and direct namespace calls, while local rebinding, computed namespace
  access, re-export, dynamic import, and CommonJS `require` fail review. Any new
  callsite or changed first argument requires review rather than inheriting
  trust.
- This allowlist is a source-regression guard, not a database identity
  primitive. Arbitrary SQL under the runtime role can call the RPC or set the
  GUC with another valid id; Phase A therefore does not close the compromised
  runtime-principal/SQL-injection threat.
- The list RPC explicitly selects the reviewed 16 columns in forward migration
  `20260717025000_harden_saved_search_owner_rpc_projection` in PostgreSQL
  physical `attnum` order, and the TypeScript helper reconstructs the same
  reviewed fields as an explicit application projection after runtime
  validation. The live audit compares the exact raw `pg_proc.prosrc` UTF-8
  SHA-256 for both owner RPCs with the source-derived inventory; unreadable
  source or body drift fails closed.
- Saved-search reads are not only in API routes. The dashboard server component,
  account pages, account export, and the retained canary all use the same
  one-statement helper path before RLS is enabled.
- Account deletion deletes saved searches as privacy cleanup. Its large atomic
  unit must use `withDbUserContext(targetUserId, async (tx) => ..., {
  timeout: 30000, maxWait: 10000 })` as the outer transaction and keep all work
  on that branded context client. Never nest another context transaction inside
  it. Otherwise a user-scoped `DELETE` policy can silently leave saved-search
  query/location data behind.
- Before phase A, the static direct-access guard must reject direct or aliased
  Prisma `savedSearch` delegates, including `createManyAndReturn` and
  `updateManyAndReturn`, literal relation reads such as
  `include`/`select: { savedSearches: ... }`, all `Prisma.raw`, and new
  unreviewed `$queryRawUnsafe`/`$executeRawUnsafe` escape hatches. Its literal
  raw-SQL guard must cover `TRUNCATE`, `MERGE`, and `COPY`. This is not
  whole-program data-flow proof for indirectly assembled relation objects, so
  clean-checkout review of changed raw/query-construction code remains required.
  Keep an explicit test that account deletion retains
  `{ timeout: 30000, maxWait: 10000 }`. These are must-fix preactivation gaps,
  not deferred Bucket-B work.
- Release 0 must apply
  `20260717024500_add_saved_search_owner_rpcs` and then
  `20260717025000_harden_saved_search_owner_rpc_projection` before RPC-calling
  app code becomes live while RLS is still off. Because Vercel's production build
  runs `prisma migrate deploy`, that release artifact must exclude the later
  phase-A RLS migration. The fail-closed production deploy guard accepts
  `SAVED_SEARCH_RLS_DEPLOY_PHASE=release-0` only for that RPC-only artifact.
  `phase-a-reviewed` is explicit human promotion authorization after all
  staging and rollback gates pass, not a way to deploy the combined working
  branch early. Both values are temporary and must be removed/reset after the
  intended release; the guard must be reviewed or retired before any later
  migration. Phase A and phase B remain separate releases. A
  12-hour wait never substitutes for disabling superseded callable deployments,
  rotating/revoking old owner credentials, and retaining `pg_stat_activity`
  drain evidence.

## Cart + CartItem Prototype Edge Cases

`Cart` is direct-owner, but `CartItem` is owned through its parent cart. This is
the first parent-join policy and must be reviewed separately before
implementation.

- `CartItem` policies need a parent `Cart.userId = app.user_id` predicate; the
  table has no direct `userId`.
- Enable `Cart` and `CartItem` policies together in staging, and test the
  parent-join policy with the final `Cart` policy enabled.
- Stripe webhook cart finalization directly deletes paid cart items. Missing
  buyer context or bypass would leave already-purchased items in the cart after
  payment.
- Admin listing removal and seller/listing soft-delete cleanup remove a listing
  from all users' carts and need an explicit service/admin cleanup path.
- Checkout stock restoration can read cart items from webhook/session metadata
  and needs context or bypass so reserved stock repair does not silently
  under-restore.
- Account deletion deletes `Cart` and relies on cascading `CartItem` deletion.
  Test the cascade with both policies enabled instead of assuming the RLS
  interaction.

## SavedBlogPost Prototype Edge Cases

`SavedBlogPost` remains a direct-owner candidate, but its read surface is larger
than `SavedSearch` because saved-state is rendered on several server-component
blog surfaces.

- No public saved-post aggregate exists today. The only saved-blog-post count is
  scoped to the current user's account saved page. If a public "people saved
  this post" count is added later, reassess this table before applying an
  owner-only `SELECT` policy.
- Server-component saved-state reads must be wrapped before enabling RLS:
  homepage blog cards, `/blog`, `/blog/author/[slug]`, and `/blog/[slug]`.
  Missing context would not expose another user's rows, but it would fail closed
  and render bookmarks as unsaved.
- API/read-write paths to wrap include `GET/POST/DELETE /api/blog/[slug]/save`,
  `/api/account/feed`, `/api/account/export`, and `/account/saved`.
- `/api/account/feed` currently builds saved listing and saved blog-post state
  with parallel Prisma queries. If this is moved inside an interactive
  transaction-local context helper, serialize those lookups or redesign the
  helper path so the context is set before each protected query.
- Account deletion deletes saved blog posts as privacy cleanup. That transaction
  must set target-user context or use an explicit cleanup bypass, or an
  owner-scoped `DELETE` policy can leave saved-post history behind.

## Favorite, Follow, And Block Edge Cases

Do not treat these as ordinary `userId = app.user_id` tables.

- `Favorite` has private owner reads, such as saved-items pages, but public and
  seller-facing aggregate reads count all users' favorites for listings.
  Browse ranking, seller dashboards, seller analytics, homepage/top-saved
  surfaces, and quality-score style metrics can all depend on cross-user
  favorite counts. Owner-only `SELECT` RLS would silently zero or skew those
  counts unless favorite counts are first denormalized into separate maintained
  counters or served through an explicit aggregate/bypass design.
- `Follow` has private owner reads, but public follower counts are intentional
  product state and follower fanout reads all followers of a seller for listing
  and blog notifications. Owner-only `SELECT` RLS would collapse follower counts
  to at most the current viewer and break fanout unless counts/fanout move to a
  deliberate aggregate/service path.
- `Block` is bidirectional by design. Current block filtering needs rows where
  `blockerId = app.user_id` and rows where `blockedId = app.user_id`. An
  owner-only `blockerId` policy would let a user miss rows created by someone
  who blocked them and can become a content-safety regression. A future policy
  needs bidirectional reads plus explicit system/service bypass for fanout paths
  that exclude reciprocal blocks without an end-user context.
- `SavedBlogPost` should remain separate from these tables. It is the cleaner
  direct-owner candidate after SavedSearch/Cart, subject to the saved-state
  read inventory, account export, and account-deletion cleanup caveats above.

## Non-Goals For Launch

- Do not enable RLS on public discovery tables (`Listing`, `SellerProfile`, `BlogPost`, `Review`) before a separate public/private visibility design. Those tables intentionally mix public marketplace reads with owner/staff/private states.
- Do not use RLS as a replacement for route/action ownership checks. App-layer authorization remains required because RLS cannot express all product-state rules cleanly.
- Do not use the migration/table-owner role for normal Prisma runtime queries. Table owners can bypass RLS unless `FORCE ROW LEVEL SECURITY` is used, which has its own migration and operational risks.
