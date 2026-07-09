# Grainline DB Defense-In-Depth Plan

Last updated: 2026-07-07

This is the execution tracker for database-layer hardening. It complements
`docs/rls-feasibility-plan.md`, which remains the design source of truth for
RLS staging and table ordering.

## Objective

Reduce database blast radius without destabilizing launch-critical flows. The
near-term target is a least-privilege runtime database role, followed by a
staging-only RLS prototype on low-blast-radius direct-owner tables.

## Non-Goals

- Do not enable broad production RLS before launch.
- Do not enable RLS on `Order`, `Message`, `Conversation`, `Case`,
  `SellerProfile`, `Listing`, `BlogPost`, or `Review` until the runtime role,
  request context, bypass model, and rollback are proven.
- Do not treat RLS as a replacement for route/server-action authorization.
  App-layer ownership and visibility checks remain required.
- Do not point normal app traffic at the migration owner role once
  least-privilege staging is proven.

## Phase 0 - Baseline

Status: not started.

Required before any role or policy change:

- Confirm `main` CI is green.
- Preserve unstaged raw audit imports and local agent files.
- Confirm production/staging connection topology:
  - `DATABASE_URL` uses the Neon pooled endpoint.
  - `DIRECT_URL` uses the direct endpoint for migrations only.
  - `DIRECT_URL` authenticates as the declared migration owner role; a direct
    URL for a different owner role invalidates default-privilege evidence even
    if existing objects were reassigned later.
  - Prisma runtime uses `@prisma/adapter-pg` and the app `pg` pool.
- Record current database roles:
  - table/schema owner;
  - runtime role currently used by `DATABASE_URL`;
  - migration role currently used by `DIRECT_URL`;
  - any Neon/Vercel preview/staging role differences.
- Decide staging target:
  - preferred: Neon branch or staging database with production-like pooler;
  - do not use only a local direct Postgres connection for the hard-gate proof.

Evidence to retain:

- CI run id.
- Staging database/branch name.
- Sanitized role names and privilege summary.
- Confirmation that no production credentials were changed.

## Phase 1 - Least-Privilege Runtime Role

Status: not started.

Purpose: reduce blast radius even before RLS. A leaked runtime connection or
future SQL injection should not own tables, bypass RLS, run migrations, or alter
schema.

Target roles:

- `grainline_migration_owner`
  - owns schema/tables;
  - used by `DIRECT_URL`;
  - runs migrations, restore drills, and controlled maintenance.
- `grainline_app_runtime`
  - used by `DATABASE_URL`;
  - does not own tables;
  - does not have `BYPASSRLS`;
  - has only app-required table, sequence, and function privileges.
- Optional future `grainline_service_bypass`
  - explicit maintenance/bypass role;
  - not used by normal app traffic;
  - only introduced after a concrete service-path need is proven.

Staging implementation checklist:

- Create the runtime role on staging.
- Grant minimum required privileges:
  - schema `USAGE`;
  - table `SELECT`, `INSERT`, `UPDATE`, `DELETE` where runtime paths need them;
  - sequence `USAGE`/`SELECT` where applicable;
  - `EXECUTE` on `grainline_*` functions used by constraints, defaults, or app
    queries.
- Keep role/grant/default-privilege setup in a reviewed, version-controlled SQL
  or migration artifact before production promotion. Manual staging setup can be
  used to prove the shape, but production role changes should not depend on
  untracked dashboard or ad hoc shell state.
- The current reviewed staging SQL template is
  `scripts/provision-runtime-db-role.sql`. It expects the runtime role to
  already exist with a password managed outside git, must be run while connected
  as the declared `DIRECT_URL` migration owner, grants only the explicit
  source-derived app-object inventory, revokes runtime access to
  `_prisma_migrations` when present, and sets migration-owner default privileges
  for future tables/sequences. It also grants runtime `EXECUTE` on functions
  owned by the `pg_trgm` extension because public search/autocomplete SQL calls
  `similarity()` and the `%` operator. PostgreSQL trusted-extension functions
  may still be owned by a bootstrap/admin role even when the extension is
  created by the migration role, so the script grants only extension functions
  the migration role can grant and otherwise verifies runtime `EXECUTE` is
  already present, normally through PostgreSQL's `PUBLIC` function default.
- Source-derived grant inventory as of this plan update:
  - 56 Prisma model tables need runtime table DML grants;
  - 20 Prisma enum types need runtime `USAGE`, currently covered only if live
    DB type privileges still match Postgres defaults or explicit grants exist;
  - 1 custom `grainline_*` function is used by the `User` notification
    preference check constraint: `grainline_notification_preferences_valid`;
  - 1 source-derived extension is required by runtime search SQL: `pg_trgm`.
    Provisioning grants runtime `EXECUTE` on that extension's functions
    explicitly so a future `PUBLIC` function lockdown does not break
    suggestions/search where the migration role has grant option, while
    preserving the current `PUBLIC` default dependency for bootstrap-owned
    trusted-extension functions. The live audit fails if runtime `EXECUTE` is
    missing and the declared migration role cannot grant it, so standalone audit
    runs do not pass a database topology that the standard provisioning SQL
    cannot repair.
  - 0 source-derived sequences exist today. The two `Int @id @default(1)` fields
    are fixed singleton rows, not autoincrement/serial sequences.
- Treat function/type accessibility through `PUBLIC` defaults as a dependency,
  not as proof. Current source migrations do not revoke from `PUBLIC`, but the
  live grant audit must fail if current function/type access is missing.
  Future function/type default-privilege requirements are added only when source
  migrations revoke `PUBLIC` through `ALTER DEFAULT PRIVILEGES`, not for an
  object-level revoke on one existing function or type.
- Add default privileges for the exact migration role authenticated by
  `DIRECT_URL`, not whichever role runs a one-off SQL shell:
  - future tables: `SELECT`, `INSERT`, `UPDATE`, `DELETE`;
  - future sequences: `USAGE`, `SELECT`;
  - future functions: `EXECUTE` only if `PUBLIC` function defaults are revoked;
  - future types: `USAGE` only if `PUBLIC` type defaults are revoked.
- Explicitly verify the runtime role:
  - is not the same role as the migration owner;
  - is audited through a connection whose `current_user` and `session_user`
    both equal the declared migration owner role;
  - uses tracked app objects owned by the migration role authenticated by
    `DIRECT_URL`;
  - does not own application tables;
  - does not have `BYPASSRLS`;
  - does not have database-level `CREATE`;
  - cannot run DDL/migrations;
  - cannot alter RLS policies;
  - cannot drop tables, functions, or schemas;
  - cannot create objects in `public` or currently untracked non-public schemas.
- Point staging `DATABASE_URL` at the runtime role.
- Keep staging `DIRECT_URL` on the migration owner role.

Verification checklist:

- Manual live grant audit against staging:
  `GRANT_AUDIT_DATABASE_URL="$DIRECT_URL" RUNTIME_DB_ROLE=grainline_app_runtime MIGRATION_DB_ROLE=grainline_migration_owner npm run audit:db-grants`
  Run this from the same environment/secret set that will run migrations so the
  audit connection proves the actual `DIRECT_URL` role. A separate admin or
  auditor URL can inspect state, but it does not prove deploy-time migration
  provenance unless a second explicit `DIRECT_URL` identity check is run.
- Reviewed staging role/grant provisioning:
  `psql "$DIRECT_URL" -v runtime_role=grainline_app_runtime -v migration_role=grainline_migration_owner -f scripts/provision-runtime-db-role.sql`
  Run the grant audit after this script; do not use successful script execution
  alone as proof because live ownership, role membership, and untracked-object
  state still need catalog verification.
- `npx prisma validate`
- `npx prisma generate`
- `npx prisma migrate status` through `DIRECT_URL`
- `npx tsc --noEmit`
- `npm run lint`
- `npm test`
- Production-like smoke tests against staging:
  - sign-up/sign-in/sign-out;
  - public browse/listing/seller pages;
  - notification reads and mark-read;
  - saved-search create/list/delete;
  - cart and checkout creation;
  - Stripe webhook order creation in test mode;
  - refunds and case resolution in test mode;
  - account export and account deletion;
  - cron routes, including retention/prune jobs;
  - upload presign/verify and cleanup;
  - admin PIN-gated routes;
  - email outbox enqueue/drain.

Rollback:

- Repoint staging `DATABASE_URL` to the previous known-good role.
- No schema rollback should be needed for least-privilege role testing.
- Do not promote role changes to production until staging verification is
  boring and repeatable.

## Phase 2 - Grant Hygiene Automation

Status: not started.

Purpose: prevent future migrations from silently breaking runtime traffic after
the app moves to a non-owner role.

Implementation goals:

- `scripts/audit-runtime-db-grants.mjs` derives the source grant inventory and
  connects as an auditor/owner to check that the runtime role has required
  privileges on:
  - all app tables;
  - all app sequences;
  - all `grainline_*` functions used by constraints/defaults/app queries.
- The audit also checks enum type `USAGE`, runtime role ownership/bypass
  mistakes, and default privileges for future tables/sequences/functions/types
  created by the migration role. It also checks that source-derived extensions,
  currently `pg_trgm`, exist and that the runtime role can execute their
  extension-owned functions plus the app-used `similarity()` function and `%`
  operator backing function. For extension functions that are not grantable by
  the declared migration role, the audit allows current runtime `EXECUTE`
  through PostgreSQL's `PUBLIC` default but fails if that runtime access is
  missing. A future function-lockdown pass for bootstrap-owned extension
  functions therefore needs an explicitly reviewed admin-owned provisioning step.
- The audit fails if the runtime role and migration role are the same role, if
  the audit connection does not authenticate as the declared migration role, if
  tracked app objects are not owned by the declared migration role, if the
  runtime role has database-level `CREATE`, or if it has `CREATE` on `public` or
  currently untracked non-public schemas. This keeps the audit focused on the
  declared least-privilege ownership model instead of only checking current
  table DML.
- The audit fails if a tracked public app table has RLS policies but does not
  have both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. A policy
  without table-level RLS enabled is inert, and missing `FORCE` can hide owner
  bypass behavior in migration-owner tests.
- Function/type default-privilege checks are conditional on source migrations
  revoking `PUBLIC` through `ALTER DEFAULT PRIVILEGES` for functions or types;
  object-level revokes on existing functions/types do not imply a future default
  requirement. Current live function/type privileges are still checked directly
  through `has_function_privilege()` and `has_type_privilege()`.
- Untracked public tables, such as `_prisma_migrations`, may exist. The audit
  does not fail on existence alone, but it fails if the runtime role can access
  or owns an untracked public table.
- Non-public schemas are not part of the current Prisma app-object inventory.
  Extension/schema `USAGE` can be legitimate, so the audit does not fail on
  non-public `USAGE` alone. It does fail non-public schema `CREATE`; if a future
  app-owned schema is added, extend the inventory before granting runtime access
  there.
- The runtime role should not inherit privileges through role memberships. The
  audit fails any `pg_auth_members` membership so table/function checks are not
  accidentally satisfied by a broad parent role.
- The manual audit client uses bounded connection/query/statement timeouts so a
  broken staging endpoint fails the check instead of hanging indefinitely.
- Fail if the runtime role:
  - owns app tables;
  - has `BYPASSRLS`;
  - lacks expected table/sequence/function privileges.
- Add migration authoring guidance:
  - new tables/sequences/functions require corresponding grants;
  - new non-model public tables inherit runtime table DML from migration-role
    default privileges, so add them to the audit inventory or explicitly
    `REVOKE` runtime access in the same migration;
  - raw SQL migrations must include grant review;
  - role/grant/default-privilege setup should be checked in as a reviewed SQL or
    migration artifact before production promotion;
  - local owner-role success is not enough.

Verification:

- `tests/db-grant-inventory.test.mjs` keeps the static inventory and audit
  script contract aligned with schema/migration drift.
- In GitHub Actions, `tests/db-grant-inventory.test.mjs` also runs the live
  `auditLiveDatabase()` SQL path against synthetic Postgres roles/databases so
  catalog-query regressions fail CI without needing staging secrets.
- Run the real-environment grant audit in CI only after a suitable CI role model
  exists, or keep the real staging/production check manual until CI can
  represent owner/runtime separation.

## Phase 3 - Request Context Proof

Status: staging gate tooling and dormant helper added; live staging proof not run.

Purpose: prove the core RLS mechanism under the actual runtime topology before
enabling policies.

Current reviewed staging harness:

- `scripts/rls-context-acceptance-gate.mjs` is the executable canary for this
  phase. It uses synthetic non-customer canary rows in the
  `grainline_rls_canary.context_canary` table, a fail-closed policy based on
  `NULLIF(current_setting('app.user_id', true), '')`, transaction-local
  `set_config('app.user_id', $1, true)`, the Prisma adapter transaction path
  used by the app, raw `pg` prepared-statement probes, connection recycle
  probes, an admin-URL-gated rollback/no-op probe that temporarily disables RLS
  on the synthetic canary and restores `ENABLE`/`FORCE ROW LEVEL SECURITY`,
  transaction-wrapped and autocommit baseline measurements, target and burst
  concurrency measurements, and the latency / connection-hold thresholds below.
- The script is staging-only evidence. Passing it does not enable RLS, does not
  replace route-level happy-path tests, and does not prove hot-path performance
  for tables that are not in the synthetic canary. It proves read/context
  isolation for the synthetic canary only; per-table write-policy behavior, such
  as asymmetric Notification `INSERT`/`DELETE`, still needs migration-level
  tests before a real table policy is enabled.
- To create or refresh the canary table/policy in staging:
  `RLS_CONTEXT_GATE_CONFIRM=staging-only RLS_CONTEXT_GATE_PREPARE=1 RLS_CONTEXT_GATE_ADMIN_DATABASE_URL="$DIRECT_URL" RLS_CONTEXT_GATE_DATABASE_URL="<pooled runtime-role URL>" RLS_CONTEXT_GATE_RUNTIME_ROLE=grainline_app_runtime npm run audit:rls-context`
- To run against an already prepared staging canary:
  `RLS_CONTEXT_GATE_CONFIRM=staging-only RLS_CONTEXT_GATE_DATABASE_URL="<pooled runtime-role URL>" RLS_CONTEXT_GATE_RUNTIME_ROLE=grainline_app_runtime npm run audit:rls-context`
- To rerun the rollback/no-op proof without refreshing canary rows, add
  `RLS_CONTEXT_GATE_ROLLBACK_PROBE=1 RLS_CONTEXT_GATE_ADMIN_DATABASE_URL="$DIRECT_URL"`.
- Do not point this gate at production. Use a production-like Neon branch or
  staging database with the same pooled runtime-role shape as production.

Required helper contract:

- Use `src/lib/dbUserContext.ts` for future RLS-wrapped app reads/writes after
  the staging gate passes. The helper is intentionally dormant until a
  table-specific prototype wraps its route/server-component paths.
- Open an explicit Prisma transaction.
- Run `set_config('app.user_id', $userId, true)` as the first statement inside
  the transaction.
- Pass the exact local `User.id`; the helper rejects empty, whitespace-padded,
  overlong, or non-id-shaped values instead of trimming/canonicalizing them.
- Use the transaction client for every protected query.
- Do not run parallel Prisma queries inside that interactive transaction.
- If combined with serializable retry, set context inside each retried
  transaction callback, not outside the retry loop, and keep the transaction at
  `Serializable` isolation so the retry can actually observe serialization
  failures.
- Keep service/admin/cron/webhook bypass work explicit; do not use the
  end-user helper as a generic system bypass.

Hard-gate tests:

- Runtime-role connection through pooled `DATABASE_URL`, not `DIRECT_URL`.
- `app.user_id` is available inside the transaction.
- `app.user_id` is gone after transaction completion.
- pooled connection reuse does not leak one user's context into the next query.
- unset `app.user_id` returns zero protected rows once RLS is enabled.
- explicitly empty `app.user_id` returns zero protected rows once RLS is enabled.
- serializable retry re-runs `set_config` on every retry attempt.
- route-level happy paths still return current-user rows.
- rollback proof: disabling RLS at the database layer leaves the app's
  transaction-local `set_config` wrapper as a harmless no-op, so an urgent policy
  incident can be mitigated without waiting for an app redeploy.
- Measure protected-read latency under the wrapper, including p95/p99 for hot
  paths such as notification reads, and choose explicit interactive-transaction
  `timeout`/`maxWait` values before widening usage.
- Measure connection-hold time and pool saturation under realistic staging
  concurrency; every protected read adds transaction setup and must not lower
  the pool's saturation point enough to affect launch-critical traffic.

### Staging Pooling/Context-Isolation Acceptance Spec

Run this proof against a staging or preview Neon branch that uses the same
connection shape as production: Prisma with `@prisma/adapter-pg`, the app `pg`
pool, and pooled runtime-role `DATABASE_URL`. A local direct Postgres test or a
`DIRECT_URL` migration-owner test is useful for development, but it is not
acceptance evidence for RLS rollout.

Evidence to record with the run:

- commit SHA and CI run id for the app under test;
- staging database or branch name;
- sanitized migration/runtime role names and confirmation that the runtime role
  is the role behind pooled `DATABASE_URL`;
- Prisma transaction `timeout` and `maxWait`, app `pg` pool size, Neon pool
  settings, Prisma adapter/`pg` package versions, target concurrency, burst
  concurrency, sample size, warmup count, and any connection turnover/recycling
  setting used by the staging harness;
- prototype table/policy names and whether `FORCE ROW LEVEL SECURITY` is
  enabled in staging;
- autocommit baseline, transaction baseline, and wrapped latency/connection
  metrics, plus any failed request ids or Sentry event ids.

Correctness pass/fail conditions:

- Unwrapped runtime-role reads with unset `app.user_id` return zero protected
  rows for each prototype table.
- Inside the wrapper, the first statement is
  `set_config('app.user_id', $userId, true)`, and
  `current_setting('app.user_id', true)` equals the expected user id before the
  first protected query runs.
- User A context returns only User A rows; User B context returns only User B
  rows; neither context can observe the other's protected rows.
- After commit and after rollback, a borrowed pooled connection returns null or
  empty `current_setting('app.user_id', true)`, and protected reads return zero
  rows until a new transaction-local context is set.
- Explicitly empty `app.user_id` via `set_config('app.user_id', '', true)`
  returns zero protected rows and must not match nullable, missing, or empty
  owner ids.
- Concurrent transactions for at least two distinct users run repeatedly through
  the pooled `DATABASE_URL` without cross-user row visibility or context
  leakage.
- The same cross-user isolation checks pass while the staging harness forces or
  observes pooled connection turnover between users, such as a low `pg` pool
  `maxUses`, short idle lifetime, or documented Neon pool turnover event. Do not
  infer turnover safety only from steady-state connection reuse.
- Serializable retry tests force at least one retry and prove
  `set_config('app.user_id', ..., true)` ran inside every retried transaction
  callback before any protected query.
- Any helper path that uses RLS context must keep protected queries on the
  transaction client and must reject or avoid `Promise.all`/parallel Prisma
  queries inside the interactive transaction.
- Sustained wrapped reads through pooled `DATABASE_URL` produce no
  prepared-statement, cached-plan, or transaction-pool protocol errors, including
  errors shaped like "prepared statement already exists", "prepared statement
  does not exist", or "cached plan must not change result type".
- Route-level happy paths for the prototype tables still return the current
  user's rows. DB denial tests alone are not enough because a missing wrapper can
  fail closed silently.
- Rollback proof shows that disabling RLS at the database layer leaves the
  transaction-local context wrapper harmless and keeps route-level happy paths
  passing.

Performance and pool-safety stop conditions:

- Compare each wrapped protected-read path with the same path's unwrapped
  autocommit staging baseline and its transaction-wrapped unset-context
  baseline under the same data volume, pool settings, and concurrency. The
  transaction baseline isolates context-setting overhead; the autocommit
  baseline captures the adoption cost of moving current app reads into
  interactive transactions.
- Use enough warm requests for stable p95/p99 measurements; the default minimum
  is 500 measured requests per path after warmup unless the path is too rare to
  exercise safely, in which case record the smaller sample and do not widen RLS
  to hot paths from that evidence alone.
- Run both target launch concurrency and a 2x burst. If no launch target exists
  yet, choose and record a conservative staging target before the run rather than
  retrofitting thresholds after seeing results.
- Stop widening RLS if wrapped protected-read p95 latency is more than 2x
  baseline or increases by more than 100ms, whichever fails first.
- Stop widening RLS if wrapped protected-read p99 latency is more than 3x
  baseline or increases by more than 250ms, whichever fails first.
- Stop widening RLS if any normal protected happy path hits Prisma interactive
  transaction `timeout` or `maxWait`, or returns a transaction-closed error such
  as `P2028`.
- Stop widening RLS if connection acquisition wait is above 100ms at p95 or
  above 250ms at p99 at target concurrency, or if burst traffic causes queued
  requests, pool exhaustion, or timeout errors that the baseline path did not
  show.
- Stop widening RLS if average connection-hold time for protected reads is more
  than 2x baseline or p99 hold time exceeds 50% of the configured interactive
  transaction timeout.
- Stop widening RLS if protected happy-path error rate exceeds 0.1% in the
  measured run, if any authorization mismatch appears, or if two consecutive
  runs on the same commit/config do not produce the same pass/fail result.
- Stop widening RLS if prepared-statement, cached-plan, protocol, or
  connection-recycle errors appear under wrapped pooled load, even when the same
  path passes against a direct or single-connection database.

If this acceptance spec fails, keep app-layer authorization plus the
least-privilege runtime role as the active database defense. Fix the root cause
and rerun the full staging gate before adding new RLS-protected tables or
wrapping hotter paths.

Post-rollout drift monitoring:

- Once any RLS-protected path reaches production, rerun the staging gate after
  changing Neon pool settings, Prisma, `@prisma/adapter-pg`, `pg`, transaction
  timeout/maxWait values, runtime role grants, or RLS policies.
- Consider a sampled production invariant for RLS-wrapped reads that verifies
  returned row owners match the active request context before response rendering.
  Capture only bounded internal ids or hashes; do not log row payloads or raw
  user PII.
- Consider a scheduled synthetic canary using non-customer rows on the
  low-blast-radius prototype table to re-run the two-user isolation proof
  through the pooled runtime role. Treat any canary mismatch as an incident and
  disable or narrow the affected RLS rollout while investigating.

Stop condition:

- If any context proof is flaky under the Neon pooler plus Prisma adapter/pool,
  stop RLS work and keep app-layer authorization plus least-privilege role as
  the active DB defense.

## Phase 4 - Notification RLS Prototype

Status: not started.

Purpose: protect user notification reads and mark-read updates while preserving
legitimate cross-user/system notification creation and cleanup.

Policy shape:

- `SELECT`: owner-scoped to `Notification.userId = app.user_id`.
- `UPDATE`: owner-scoped with both `USING` and `WITH CHECK` on
  `Notification.userId = app.user_id`.
- `INSERT`: do not naively owner-scope. Choose one explicit strategy:
  - permissive runtime insert, with app-layer authorization remaining the
    notification creation control; or
  - service/bypass helper used by every cross-user writer.
- `DELETE`: do not naively owner-scope. Account deletion and prune flows need a
  system cleanup design.
- Use `FORCE ROW LEVEL SECURITY` in staging prototype migrations to avoid
  owner-role false-green tests.

Read/update paths to inventory and wrap before enabling:

- `/api/notifications`
- `/api/notifications/read-all`
- `/api/notifications/[id]/read`
- dashboard notification page reads
- notification bell data sources
- message-thread auto-mark-read updates
- low-stock notification dedupe reads
- account export notification reads

Writer/cleanup paths to inventory before choosing `INSERT`/`DELETE` policy:

- `createNotification()`;
- follow/favorite/listing/case/message/follower fanout paths;
- admin notification paths;
- Stripe webhook notification paths;
- cron/system notification paths;
- account-deletion notification cleanup;
- notification prune cron.

Regression tests:

- direct DB: user A cannot select user B notifications.
- direct DB: missing/empty context returns zero rows.
- route: user sees own notifications.
- route: user cannot mark another user's notification read.
- route: read-all only marks own notifications.
- fanout/webhook/cron notification creation still works under the chosen write
  strategy.
- cleanup/prune still works under the chosen delete strategy.
- if `INSERT` is ever tightened, `createNotification()` handles RLS `42501`
  deliberately instead of treating it like the current `P2002` dedup path.

Rollback:

- Disable RLS on `Notification`.
- Remove/widen only the prototype policies through a forward migration.
- Keep app-layer notification ownership predicates in place throughout.

## Phase 5 - SavedSearch RLS Prototype

Status: not started.

Purpose: validate a simpler direct-owner table after Notification proves the
context helper and role model.

Policy shape:

- `SELECT`: `SavedSearch.userId = app.user_id`.
- `INSERT`: `SavedSearch.userId = app.user_id`.
- `DELETE`: `SavedSearch.userId = app.user_id`.
- `UPDATE`: add only if a future route supports updates.

Implementation constraints:

- Saved-search cap checks must remain in the same transaction as insert.
- If serializable retry is used, context must be set inside each retry attempt.
- Forged `userId` must still be ignored/rejected by app-layer code.
- Account deletion deletes saved searches inside the anonymization transaction.
  That transaction must either set `app.user_id` to the target deleted user as
  its first statement or use an explicit cleanup bypass. Otherwise a
  user-scoped `DELETE` policy can silently leave saved-search query/location
  data behind during self-deletion, Clerk webhook deletion, or admin-triggered
  deletion.

Read/delete paths to inventory and wrap before enabling:

- `GET /api/search/saved` list reads.
- `DELETE /api/search/saved` deletes.
- Dashboard server-component saved-search reads.
- Dashboard `deleteSavedSearch` server action.
- Account export saved-search reads. These currently run in a broader export
  `Promise.all`, so the saved-search read should be wrapped individually or the
  export query shape must avoid parallel work inside a single RLS-context
  transaction.
- Account-deletion saved-search cleanup.

Regression tests:

- direct DB: user A cannot read/delete user B saved searches.
- route: list returns only own saved searches.
- route: create writes only current user's `userId`.
- route: delete cannot delete another user's row.
- dashboard: saved-search section still renders current-user rows.
- account export: saved-search rows still export for the current user.
- account deletion: saved-search cleanup removes the deleted user's rows under
  self-deletion and provider/admin deletion paths.
- cap behavior still works under context/retry.

## Phase 6 - Expansion Decision

Status: deferred.

Move beyond `Notification` and `SavedSearch` only when:

- least-privilege runtime role passes staging smoke;
- grant audit exists and is maintainable;
- context helper is proven under the production-like pooler;
- route-level happy-path tests exist for protected reads;
- rollback has been tested;
- CI is green;
- launch-critical legal/provider/runtime evidence is not being delayed.

Candidate next tables:

- `Cart`
- `CartItem`
- `SavedBlogPost`

### Cart + CartItem Parent-Join Notes

`Cart` is direct-owner (`Cart.userId`), but `CartItem` is owned only through
`CartItem.cartId -> Cart.userId`. This is the first parent-join RLS design and
must get a separate review before implementation.

Policy shape:

- `Cart`: owner-scoped to `Cart.userId = app.user_id`.
- `CartItem`: parent-join scoped through the owning cart, for example
  `EXISTS (SELECT 1 FROM "Cart" WHERE "Cart".id = "CartItem"."cartId" AND
  "Cart"."userId" = app.user_id)`.
- Enable `Cart` and `CartItem` policies together in staging so half-enabled
  behavior does not hide context or parent-policy mistakes.
- Do not copy the parent-join pattern onto unbounded hot tables without a
  separate query-plan review. Cart item counts are already bounded, which keeps
  this prototype lower risk.

System/cross-user paths that need explicit context or bypass:

- Stripe webhook cart finalization directly deletes purchased `CartItem` rows
  after order creation. Missing buyer context or bypass would leave paid items
  in the buyer's cart and can create duplicate checkout confusion.
- Admin listing removal deletes `CartItem` rows for the removed listing across
  all users' carts. This cannot use ordinary owner context.
- Seller/listing soft-delete cleanup deletes `CartItem` rows for the listing
  across all users' carts. This needs an explicit service/admin cleanup design.
- Checkout stock restoration can read `CartItem` rows from session metadata
  during webhook/expiry repair. Missing context or bypass can under-restore
  reserved stock.
- Account deletion deletes the user's `Cart`; `CartItem` cleanup relies on the
  `onDelete: Cascade` relation. Test the cascade with both `Cart` and
  `CartItem` RLS enabled instead of assuming Postgres referential actions behave
  as desired under the final policies.

Read/write paths to inventory and wrap before enabling:

- `GET /api/cart`
- `POST /api/cart/add`
- `POST /api/cart/update`
- shipping quote cart reads
- cart checkout/resume reads
- Stripe webhook cart reads and finalization deletes
- account export cart reads
- account deletion cart cleanup
- admin/listing cleanup paths

Regression tests:

- direct DB: user A cannot read or mutate user B's cart or cart items.
- route: cart read/add/update still works for the current user.
- route: shipping quote still sees the current user's cart.
- webhook: paid cart items are cleared after order creation.
- webhook/expiry repair: stock restoration still finds restorable cart items.
- admin/listing cleanup removes a listing from all relevant carts through the
  chosen bypass/service path.
- account deletion: deleting a cart under target-user context cascades cart
  item deletion with both `Cart` and `CartItem` RLS enabled.

### Favorite, Follow, Block, And SavedBlogPost Notes

`SavedBlogPost` is the clean owner-row candidate in this group. `Favorite`,
`Follow`, and `Block` need separate design and should not be enabled by copying
the SavedSearch/SavedBlogPost owner-policy pattern.

SavedBlogPost:

- Direct owner row through `SavedBlogPost.userId`.
- Candidate after Cart/CartItem if account export, account feed/homepage save
  state, blog index/author/detail saved-state reads, account saved-post pages,
  blog save/unsave routes, and account-deletion cleanup are wrapped or
  explicitly bypassed.
- No public saved-post aggregate exists today; the only saved-blog-post count is
  current-user scoped on `/account/saved`. If public blog saved counts are added,
  revisit this candidate before applying owner-only `SELECT` RLS.
- Missing wrapper context on server-rendered blog saved-state reads would fail
  closed and render bookmarks as unsaved, so route-level happy-path tests must
  cover homepage/blog index/blog author/blog detail saved buttons.
- `/api/account/feed` currently builds saved listing and saved blog-post state
  with parallel Prisma queries; do not move that pattern unchanged into an
  interactive transaction-local context helper.

Favorite:

- Owner reads exist for saved listings, but many product surfaces count
  cross-user favorites for a listing.
- Public/seller aggregate examples include browse ranking, homepage/top-saved
  surfaces, seller dashboards, inventory, seller analytics, and quality-score
  style metrics.
- Owner-only `SELECT` RLS would silently zero or skew those counts under seller
  or anonymous contexts.
- Defer Favorite RLS until public favorite counts are denormalized into
  maintained counters or served through an explicit aggregate/bypass design.

Follow:

- Owner reads exist for "am I following this seller?", but follower count is
  public product state and follower fanout reads all followers of a seller.
- Owner-only `SELECT` RLS would reduce follower counts to at most the current
  viewer and break listing/blog follower notification fanout.
- Defer Follow RLS until public follower counts and follower fanout have an
  explicit aggregate/service design.

Block:

- Block reads are bidirectional: current-user filtering needs rows where the
  current user is the blocker and rows where the current user is blocked.
- An owner-only `blockerId = app.user_id` policy can miss rows created by users
  who blocked the current user, weakening block-based content filtering.
- A future Block policy needs bidirectional read predicates
  (`blockerId = app.user_id OR blockedId = app.user_id`) plus a system/service
  bypass for fanout paths that need reciprocal block exclusion without an
  ordinary viewer context.

Regression tests before any Favorite/Follow/Block RLS prototype:

- favorite counts stay correct on browse, seller dashboard/inventory, seller
  analytics, homepage/top-saved, and account saved-items surfaces.
- follower counts stay correct on seller profile/shop and follow API responses.
- listing/blog follower fanout still reaches all eligible followers and excludes
  blocked relationships.
- block filtering still excludes both users blocked by me and users who blocked
  me.
- system fanout paths have an explicit bypass or service context.

High-risk tables requiring separate design and likely second review:

- `Conversation`
- `Message`
- `Order`
- `OrderItem`
- `OrderPaymentEvent`
- `OrderShippingRateQuote`
- `Case`
- `CaseMessage`
- `SellerProfile`
- `Listing`
- `AdminAuditLog`

## Production Promotion Gate

Do not promote runtime role changes or RLS policies to production unless all are
true:

- staging uses the same connection topology as production;
- direct DB denial tests pass through the runtime role;
- route happy-path tests pass;
- cron, webhook, admin, account deletion, refund, and retention paths pass;
- rollback has been executed successfully on staging;
- security evidence and launch checklist work is not blocked by the rollout;
- latest `main` CI is green.

## Current Recommendation

Start with Phase 0 and Phase 1 only. Treat least-privilege runtime role
validation as the immediate high-return work. Treat RLS as a staging prototype
until the request-context and grant-hygiene gates are proven.
