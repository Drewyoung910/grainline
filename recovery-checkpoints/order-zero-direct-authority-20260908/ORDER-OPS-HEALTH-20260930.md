# Order operations-health source checkpoint

Date: 2026-09-30

This is a sanitized recovery checkpoint. It contains no credentials, database
URLs, session values, provider keys, or row identifiers. It records completed
source preparation only and does not authorize publication, merge, deployment,
Production migration, credential changes, or RLS changes.

## Why this change exists

Independent source review confirmed the operational gap tracked as Claude issue
`#121`: several actionable Order money and fulfillment states were recoverable
but absent from the hourly operations-health alarm. The new source adds one
count-only database authority and wires it into the existing hourly health
route. It also exposes the already-authorized review-needed queue count in the
PIN-protected staff navigation.

The prepared thresholds follow the existing worker schedules:

- refund claims pending longer than 30 minutes;
- label clawbacks in manual review or overdue by more than 30 minutes;
- review-needed Orders unchanged for more than 24 hours;
- checkout reservations beyond the two-hour grace plus the 30-minute repair
  schedule, or with stale repair claims/errors;
- payout failures updated in the last 24 hours.

## Exact source binding

- Isolated worktree: `/private/tmp/grainline-order-ops-health-20260930`
- Branch: `codex/order-ops-health-20260930`
- Exact base: `798946354d7cecbaa8aa490ef39a1e89e2d856fa`
- Exact prepared commit: `bff8df06ea0a94d0381fa8085a81fa3ae3566fc5`
- Commit subject: `Add Order operations health coverage`
- Migration: `20260930033000_order_ops_health_summary`
- Migration SHA-256:
  `7fa34097c631dcfeb88d531a597b3a39b38b9afdf248c7717e450ab8cffb48b7`
- Private recovery branch:
  `recovery/order-ops-health-bff8df06-20260930`
- Private remote readback matched the exact prepared commit.

## Prepared files

- `.github/workflows/ci.yml`
- `.github/workflows/order-ops-health-production.yml`
- `docs/runbook.md`
- `prisma/migrations/20260930033000_order_ops_health_summary/migration.sql`
- `src/app/admin/layout.tsx`
- `src/app/api/cron/ops-health/route.ts`
- `src/components/AdminMobileNav.tsx`
- `src/lib/orderOpsHealth.ts`
- `src/lib/orderOpsHealthState.ts`
- `tests/order-ops-health-production-workflow.test.mjs`
- `tests/order-ops-health.test.mjs`

## Security and production boundaries

- The migration creates exactly one `SECURITY DEFINER`, count-only aggregate.
- Its `search_path` is fixed to `pg_catalog`; every table reference is schema
  qualified.
- PUBLIC and ordinary runtime do not receive direct table authority.
- Only `grainline_app_runtime` receives EXECUTE on the aggregate.
- The function returns counts only, with no order, user, payment, or provider
  identifiers.
- The protected workflow serializes in `production-database-migrations`, binds
  to exact main and an exact successful main push CI run, verifies the migration
  checksum and predecessor, rejects unrelated pending migrations, applies only
  this migration, and proves the three source tables' RLS/grant/policy posture
  is unchanged.
- The staff badge executes only after staff-role and admin-PIN verification and
  uses the existing separately authenticated staff read client.
- No Production SQL, deployment, alias, credential, fixture, or RLS mutation
  occurred while preparing this checkpoint.

## Focused validation accepted

- `node --test tests/order-ops-health.test.mjs tests/order-ops-health-production-workflow.test.mjs tests/post-launch-ui-followups.test.mjs`
  passed 55 tests.
- The PGlite semantic proof showed ordinary runtime cannot read the three
  source tables but can execute the count-only aggregate, including under a
  non-UTC session timezone.
- Focused ESLint passed for all changed application and test files.
- `npx tsc --noEmit --pretty false` passed.
- `npx prisma validate` passed before the final UI-only badge edit; the schema
  and migration were unchanged afterward.
- YAML parsing passed for CI and the protected Production workflow.
- `git diff --check` passed before commit, and the committed range remains
  whitespace-clean.

## Exact next release sequence

1. Re-read public `main`; it must still equal the exact base above before a
   public source PR is opened.
2. Publish the exact prepared commit to a deployment-disabled public branch and
   open a draft PR only after explicit approval.
3. Mark ready and merge only if every exact-head check passes and both PR head
   and main base remain unchanged.
4. Require a successful merged-main push CI run on the resulting exact main.
5. Separately approve and dispatch the protected
   `order-ops-health-production.yml` workflow for migration `33000`.
6. Only after the database function exists, build and deploy the exact merged
   app source and verify the hourly `/api/cron/ops-health` route.

Do not deploy the application route before migration `33000` is accepted: the
route intentionally fails closed if the fixed aggregate is unavailable. Do not
repeat the completed Core Order FORCE, child runtime-lock, blocked-pair, or
smoke proofs unless a specific source or production-state change invalidates
them.

## Public PR #485 and CI-isolation correction

The exact initial source commit was published to deployment-disabled branch
`codex/order-ops-health-20260930` and opened as draft PR `#485` against unchanged
main `798946354d7cecbaa8aa490ef39a1e89e2d856fa`. The three specialized Order
checks passed on head `bff8df06ea0a94d0381fa8085a81fa3ae3566fc5`.

Full CI run `36704937043` reached the general 4,942-test suite after its new
source package and preceding database stages passed. Exactly two tests failed:
both new ops-health source tests opened migration `33000` only at its repository
path after CI had intentionally moved that migration to
`$RUNNER_TEMP/order-ops-health`. This was a CI source-location contract error;
the application, migration semantics, production workflow, and three
specialized database proofs did not fail. Nothing merged or changed Production.

Correction commit `15f3f85d1f9bcdaa6391fc6236116d2c48f863e7`:

- records the exact isolated migration path in `GITHUB_ENV`;
- lets both tests resolve the reviewed source from that explicit path, the
  normal repository path, or the one exact runner holding path; and
- positively asserts the path binding in the workflow contract test.

The two tests passed 10/10 in a normal checkout and again 10/10 while the
migration directory was physically isolated exactly as CI isolates it. Focused
ESLint, workflow YAML parsing, and `git diff --check` passed. Migration bytes
remain unchanged at SHA-256
`7fa34097c631dcfeb88d531a597b3a39b38b9afdf248c7717e450ab8cffb48b7`.
The corrected head is privately backed up and remotely read back at
`recovery/order-ops-health-ci-isolation-15f3f85d-20260930`.

PR `#485` remains draft at the old failing head. The next external action is to
advance only that deployment-disabled branch to exact corrected head
`15f3f85d1f9bcdaa6391fc6236116d2c48f863e7`, then merge only if all four checks
pass on that exact head against still-unchanged main `79894635`. This action
still excludes deployment, Production SQL, aliases, credentials, fixtures, and
RLS changes.
