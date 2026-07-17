# Grainline DB Defense-In-Depth Plan

Last updated: 2026-07-17

This is the execution tracker for database-layer hardening. It complements
`docs/rls-feasibility-plan.md`, which remains the design source of truth for
RLS staging and table ordering.

## Objective

Reduce database blast radius without destabilizing launch-critical flows. The
near-term target is a least-privilege runtime database role followed by a gated
first production RLS table on the low-blast-radius `SavedSearch` model.

## Non-Goals

- Do not enable broad production RLS before launch.
- Do not enable RLS on `Order`, `Message`, `Conversation`, `Case`,
  `SellerProfile`, `Listing`, `BlogPost`, or `Review` until the runtime role,
  request context, bypass model, and rollback are proven.
- Do not treat RLS as a replacement for route/server-action authorization.
  App-layer ownership and visibility checks remain required.
- Do not point normal app traffic at the migration owner role once
  least-privilege staging is proven.
- Do not begin Bucket B in this pass. Bucket A is `SavedSearch` only, through its
  production activation and explicit phase-B decision. `Notification` and every
  later-table design remain a separate pass even if their future ordering stays
  documented below. SavedSearch rollout phase B (`FORCE`) remains Bucket A and
  must not be confused with Bucket B.

## Phase 0 - Baseline

Status: staging baseline completed on 2026-07-16; production remains unchanged.

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

Baseline recorded 2026-07-16:

- `main` CI run `29527670942` passed for commit `4edb0faa`.
- Existing dirty/untracked audit and agent files were preserved.
- Local `.env` and `.env.local` use a pooled `DATABASE_URL` and matching direct
  `DIRECT_URL`, but both authenticate as the same Neon owner identity. Endpoint
  shape is separated; runtime/migration identity is not.
- Vercel metadata has production `DATABASE_URL`/`DIRECT_URL` and development
  `DATABASE_URL`, but no preview `DATABASE_URL` or `DIRECT_URL`. No dedicated
  staging target is configured or provable from current metadata.
- No database connection or production credential change was made during this
  baseline. Live table/schema ownership, role attributes, memberships, and
  default privileges remain unverified.
- A fresh child branch named `rls-staging-20260716` now provides the isolated
  staging target. Its 58 application tables plus `_prisma_migrations` are owned
  by the branch's existing direct migration owner, and its pre-canary baseline
  had zero RLS-enabled public tables. Production URLs and roles were not changed.

## Phase 1 - Least-Privilege Runtime Role

Status: completed on the isolated staging branch only; production role and
credential changes have not started.

Purpose: reduce blast radius even before RLS. A leaked runtime connection or
future SQL injection should not own tables, bypass RLS, run migrations, or alter
schema.

Target roles:

- migration owner (the logical target name is `grainline_migration_owner`; the
  current reviewed Neon staging and production owner is `neondb_owner`)
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
  - 58 Prisma model tables need runtime table DML grants;
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

- Manual live grant audit against the current reviewed staging branch:
  `GRANT_AUDIT_DATABASE_URL="$DIRECT_URL" RUNTIME_DB_ROLE=grainline_app_runtime MIGRATION_DB_ROLE=neondb_owner npm run audit:db-grants`
  Run this from the same environment/secret set that will run migrations so the
  audit connection proves the actual `DIRECT_URL` role. A separate admin or
  auditor URL can inspect state, but it does not prove deploy-time migration
  provenance unless a second explicit `DIRECT_URL` identity check is run.
- Reviewed staging role/grant provisioning:
  `psql "$DIRECT_URL" -v runtime_role=grainline_app_runtime -v migration_role=neondb_owner -f scripts/provision-runtime-db-role.sql`
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

Staging result recorded 2026-07-16:

- `grainline_app_runtime` was created through SQL, not the Neon role API, and
  verified as non-superuser, `NOBYPASSRLS`, unable to create roles/databases,
  and membership-free.
- The direct branch owner `neondb_owner` remains the declared staging migration
  owner; the pooled URL authenticates only as `grainline_app_runtime`.
- `scripts/provision-runtime-db-role.sql` completed with the explicit 58-table,
  20-enum, custom-function, and `pg_trgm` grants after its psql guard was fixed
  to return exactly one row to each `\gset`.
- Prisma reported all 144 repository migrations applied. No production secret,
  role, grant, or policy was changed.

Rollback:

- Repoint staging `DATABASE_URL` to the previous known-good role.
- No schema rollback should be needed for least-privilege role testing.
- Do not promote role changes to production until staging verification is
  boring and repeatable.

## Phase 2 - Grant Hygiene Automation

Status: repository tooling and CI/static validation implemented; the live
staging grant audit passed on 2026-07-16 for `grainline_app_runtime` with 58
tables, 20 enums, 1 `grainline_*` function, 1 extension, and 0 sequences.

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
- The audit fails if a tracked public app table has RLS policies without
  `ENABLE ROW LEVEL SECURITY`, or has RLS enabled with zero policies. Its
  `FORCE ROW LEVEL SECURITY` expectation is
  rollout-phase specific. `SavedSearch` phase A intentionally requires
  `NO FORCE`; all behavior proof authenticates as the non-owner runtime role.
  Phase B changes the exact audit expectation to `FORCE` in a separate commit
  and migration only after superseded deployments/credentials are disabled,
  `pg_stat_activity` proves the owner-backed app-session drain, and the
  owner/maintenance strategy is tested.
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
- The fresh-database GitHub Actions job first creates a tightly guarded
  membership-free `NOLOGIN` policy target so fail-closed migrations can run,
  then applies every migration. After migration it runs the same
  `scripts/provision-runtime-db-role.sql` used for staging/production, verifies
  migration status, and runs `audit:db-grants` as the CI migration owner against
  the final catalog. Provisioning converges that ephemeral role to the audited
  production posture (`LOGIN NOINHERIT`) and revokes inherited default DML from
  `_prisma_migrations`; the CI role has no password and the database/service are
  destroyed with the job.

## Phase 3 - Request Context Proof

Status: staging context/performance gate tooling, the shared helper, and local
SavedSearch adoption are implemented. The latest provider-owned Vercel runtime
slot 1 preserved correctness and isolation but failed 10 performance/adoption
thresholds. Wrapped p95 was approximately 96--100 ms versus a 39--40 ms
autocommit baseline; average connection hold was approximately 93--96 ms versus
37--40 ms; and the Prisma burst result was approximately 199 ms versus 78 ms.
The durable ledger correctly blocked slot 2. The run is failed evidence and does
not authorize context deployment or a real-table policy. That deployment
created its Prisma probe with the target concurrency of 8; the reviewed app pool
is now explicitly 10, while the raw control pool remains 16 so the 16-request
burst is not capped. Reliable Prisma connection-acquisition timing is currently
unavailable rather than proven zero. Use the corrected harness, which records
raw-pool 16 and Prisma-pool 10 separately, add a representative SavedSearch
route/SLO measurement, and rerun without retroactively weakening the
thresholds. Two consecutive passing provider-runtime runs from the corrected,
reviewed commit are still required. The prior workstation artifact
`context-gate-failed-pre-pool-fix.json` remains failed, pre-pool-fix,
diagnostic-only evidence and cannot satisfy either pass.

Performance-path investigation (2026-07-17): a one-statement CTE that attempted
to call `set_config` and then read the protected canary failed closed because it
returned zero rows; PostgreSQL did not provide an execution-order guarantee that
made the RLS predicate see the side effect. Do not use that pattern. A temporary
`SECURITY INVOKER` function in the isolated synthetic schema did set local
context, return exactly the correct user A/B row, and reset context at statement
completion. It was dropped and a catalog check confirmed no probe function
remained. The laptop timing was diagnostic and inconclusive at burst, so this is
an architecture candidate only—not authorization to add a production function,
change policy scope, or waive the provider-runtime gate. Any function path needs
separate privilege, ownership, search-path, caller-identity, operation-shape,
rollback, and provider-runtime performance review.

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
  concurrency measurements, a warmed checked-out sequential `SELECT 1` query-RTT
  proxy, and the latency / connection-hold thresholds below.
- The script targets a staging database. Passing it does not enable RLS, does not
  replace route-level happy-path tests, and does not prove hot-path performance
  for tables that are not in the synthetic canary. It proves read/context
  isolation for the synthetic canary only; per-table write-policy behavior, such
  as asymmetric Notification `INSERT`/`DELETE`, still needs migration-level
  tests before a real table policy is enabled.
- Create or refresh the canary with one owner-only local `diagnostic-only`
  setup invocation. Supply `RLS_CONTEXT_GATE_PREPARE=1`, the direct admin URL,
  pooled runtime URL, and exact reviewed staging endpoint id
  (`ep-bold-recipe-aavx4plv`), database (`neondb`), and region
  (`westus3.azure`). Setup creates the canary plus durable two-slot run ledger,
  proves disable/restore, and is explicitly non-counted. Invoke it through
  `npm run audit:rls-context`.
- Run the two counted, otherwise-identical repeats through the repeat-only
  Git-integrated Vercel Preview route. Slot 2 is not claimable until slot 1 is
  durably passed, and either slot is permanently non-replayable for that opaque
  run id. The route never receives the admin URL.
- The gate trigger secret used for the prior Preview was exposed in captured
  tool/session output. Rotate it before any further run, remove local temporary
  files that contain it after retaining sanitized artifacts, and prove the old
  value is rejected. The Preview route/ledger are isolated acceptance-test
  infrastructure; do not merge or enable the runner in production.
- Laptop/workstation runs must use `diagnostic-only`. Their artifacts are marked
  `diagnostic_passed` or `diagnostic_failed` and are never acceptance-eligible.
  Promotion evidence must use `production-runtime` inside provider-owned Vercel;
  do not synthesize Vercel system variables on a workstation. Provider-owned
  `VERCEL_REGION` must match the reviewed expected execution region, and the
  region identity parsed from the Neon pooled hostname must match the reviewed
  expected database region.
- Runtime evidence is candidate evidence only. The gate always emits
  `acceptanceEligible=false`; retain independent Vercel deployment
  source/ref/SHA/id attestation and require it to match both artifacts before
  promotion. Ordinary environment variables and CLI deployments are not
  sufficient provenance.
- The gate defaults its pool size to at least the configured burst concurrency
  and rejects an explicit `RLS_CONTEXT_GATE_POOL_SIZE` below
  `RLS_CONTEXT_GATE_BURST_CONCURRENCY`; otherwise the claimed 2x burst would be
  silently capped by the client pool.
- The gate's raw pool-size check proves its own requested burst is not silently
  capped; it is a control, not the application pool. The corrected Prisma probe
  must use and record the actual application pool topology (currently 10) while
  receiving the configured 16-request burst. Until the Prisma adapter exposes a
  defensible acquisition-wait measurement, record that metric as unavailable and
  rely on explicit queue/timeout/pool-pressure probes; never convert unavailable
  timing into a passing zero.
- To rerun the non-counted rollback/no-op setup proof without refreshing canary rows, add
  `RLS_CONTEXT_GATE_ROLLBACK_PROBE=1 RLS_CONTEXT_GATE_ADMIN_DATABASE_URL="$DIRECT_URL"`.
- To retain a durable sanitized JSON evidence artifact, add
  `RLS_CONTEXT_GATE_EVIDENCE_PATH="rls-context-gate-evidence.json"`. The
  artifact records commit/CI metadata when available, sanitized database host,
  runtime role, canary table/policy names, run configuration, reports, and
  issues. It is written with mode `0600` and intentionally does not include
  database URLs or credentials.
- Do not point this gate at production. Use a production-like Neon branch or
  staging database with the same pooled runtime-role shape as production.
- `RLS_CONTEXT_GATE_PREPARE=1` leaves the synthetic schema, table, policy,
  run-claim ledger, and canary rows in staging. The rollback probe
  temporarily disables RLS and restores `ENABLE`/`FORCE ROW LEVEL SECURITY`; it
  is not canary cleanup.
- Treat the gate's autocommit, transaction, and wrapped target/2x-burst reports
  as the generic connection/performance baseline. The query-RTT proxy is
  locality diagnostics only; never subtract it from, normalize, discount, or
  otherwise change the unchanged acceptance thresholds. Require two consecutive
  runs on the same commit/config: specifically, repeat-mode production-runtime
  slots from the same reviewed deployment SHA with identical gate, pool,
  concurrency, timeout, package, and locality configuration. Retain both
  candidate artifacts and external deployment attestation. Real-table
  route/data-shape smoke remains required.

Required helper contract:

- `src/lib/dbUserContext.ts` now wraps the local SavedSearch prototype paths.
  Do not deploy those context-wrapped paths or adopt the helper on additional
  tables until the production-like pooled staging gate passes twice.
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
pool, and pooled runtime-role `DATABASE_URL`. Acceptance measurements must be
executed in the provider-owned Vercel runtime in the selected reviewed function
region, while the Neon hostname-derived region identity matches the reviewed
database region. A laptop run, local direct Postgres test, or `DIRECT_URL`
migration-owner test is useful for development, but it is diagnostic-only and
not acceptance evidence for RLS rollout.

Evidence to record with the run:

- provider-owned Vercel commit SHA and deployment id for the app under test;
- path to the retained sanitized JSON evidence artifact from
  `RLS_CONTEXT_GATE_EVIDENCE_PATH`;
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
- expected and observed Vercel execution region, expected and hostname-derived
  Neon database region, locality confirmation mode, and the warmed checked-out
  25-query `SELECT 1` RTT proxy. The proxy is explanatory metadata only and does
  not alter pass/fail thresholds.

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
  production-runtime runs on the same reviewed commit SHA and identical
  configuration do not produce the same pass/fail result.
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

## Phase 4 - SavedSearch RLS Prototype

Status: owner-access centralization, branded context clients, direct-access
guards, context wiring, the exact phase-A policy migration, drift audit, and
bounded direct acceptance gate are implemented locally. They are not deployed.
Live staging validation and production activation are still gated.

Purpose: use the simplest owner-symmetric table as the first real-table proof
after the role, grant, and pooled-context gates pass.

Staging policy shape, using the fail-closed predicate
`"userId" = NULLIF(current_setting('app.user_id', true), '')`:

- `SELECT`: command-specific policy with `USING`.
- `INSERT`: command-specific policy with `WITH CHECK`.
- `DELETE`: command-specific policy with `USING`.
- `UPDATE`: do not add unless a future route supports updates.
- Stage and production phase A use exact SELECT/INSERT/DELETE policies plus
  explicit `NO FORCE ROW LEVEL SECURITY` followed by `ENABLE ROW LEVEL
  SECURITY`. Test only through the non-owner runtime role. A 12-hour wait is not
  proof that old deployments are no longer callable. Before phase B, disable
  superseded deployments or rotate/revoke their owner runtime credentials, then
  retain `pg_stat_activity` evidence that owner-backed application sessions are
  gone. Also decide and test how migrations, controlled maintenance, restore
  drills, and emergency repair will access `SavedSearch` after `FORCE`, because
  the current owner is not named in runtime-only policies. Phase B may add
  `FORCE` only in a separate reviewed migration/release after those proofs.

Implementation constraints:

- Saved-search cap checks must remain in the same transaction as insert.
- If serializable retry is used, context must be set inside each retry attempt.
- Forged `userId` must still be ignored/rejected by app-layer code.
- Owner-access helpers must receive the context transaction client explicitly;
  do not retain a global Prisma default that can silently omit context.
- Account deletion is one large atomic unit. Use
  `withDbUserContext(targetUserId, async (tx) => ..., { timeout: 30000, maxWait:
  10000 })` as its outer transaction and keep cleanup on that branded client.
  Never nest another context transaction inside account deletion.
- Existing outer page/export `Promise.all` calls may invoke a separately wrapped
  SavedSearch operation, but no protected queries may run in parallel inside the
  same context transaction.
- Before phase A, require the direct-access guard and its tests to reject direct
  or aliased Prisma `savedSearch` delegates, Prisma
  `createManyAndReturn`/`updateManyAndReturn`, literal relation
  `include`/`select: { savedSearches: ... }` access, raw
  `TRUNCATE`/`MERGE`/`COPY`, all `Prisma.raw`, and every new unreviewed
  `$queryRawUnsafe`/`$executeRawUnsafe` escape hatch. The static guard is not
  whole-program data-flow proof for indirectly assembled relation objects, so
  clean-checkout review of changed raw/query-construction code remains required.
  Keep a test that the account-deletion outer context transaction retains its
  `timeout: 30000` and `maxWait: 10000`. None of these gaps may be deferred to
  Bucket B.

Read/delete paths to wrap before enabling:

- `GET/POST/DELETE /api/search/saved`.
- Account overview and saved-search page reads/actions.
- Dashboard server-component saved-search reads and delete action.
- Account export saved-search reads.
- Account-deletion saved-search cleanup, including self-deletion, Clerk webhook,
  and deferred side-effect entry points.

Regression and silent-denial tests:

- direct DB: user A cannot read/delete user B saved searches.
- direct DB: missing/empty context returns zero rows.
- route: list returns the exact known synthetic row for the current user; an
  empty 200 response fails when that fixture exists.
- route: create writes only current user's `userId`.
- route: delete cannot delete another user's row.
- account/dashboard/export: each surface returns the exact current-user fixture.
- account deletion: cleanup removes the synthetic target user's row under self,
  provider, and deferred deletion paths, then verifies zero remaining rows under
  the same trusted context.
- cap behavior still works under context/retry.
- Log only bounded synthetic ids/counts in retained staging evidence. Do not add
  a production owner/bypass query solely to detect silent denial.

Rollback:

- Database first: `ALTER TABLE public."SavedSearch" DISABLE ROW LEVEL SECURITY`,
  then roll back the app only if necessary. Prove wrapped happy paths still work
  with `set_config` as a harmless no-op.
- Remove or widen policies only through a reviewed forward migration.
- Keep app-layer owner predicates in place throughout.

## Phase 5 - Notification RLS Prototype

Status: Bucket B, explicitly paused for a separate pass. Owner read/update
centralization and a direct-access guard exist, but service write/delete model,
context wiring, policies, and staging validation are not authorized by the
current SavedSearch rollout.

Purpose: protect user notification reads and mark-read updates after the first
direct-owner table proves the context adoption pattern, while preserving
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
- seller manual-stock low-stock notification dedupe reads
- account export notification reads

The manual-stock low-stock dedupe read is an authenticated-seller user context
path because the stock route proves `seller.userId = me.id` before the read.
Webhook/cron/admin low-stock and other notification creation paths stay in the
service/write-path inventory through `createNotification()`.

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

Keep production unchanged while resolving the Phase 3 performance-only failure:
align the harness and application pool topology, make unavailable acquisition
timing explicit, and measure the real SavedSearch route/SLO. Then run the Phase
3 gate twice on the same commit/configuration before adopting context
transactions in production. Complete only Bucket A (`SavedSearch`), including
the preactivation static-guard gaps, exact staging policy proof, canary sequence,
and production drain/maintenance proofs. Stop before Bucket B/`Notification`
design. Production runtime-role or policy changes require the promotion gate and
explicit rollout approval.
