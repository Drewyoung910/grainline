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
- review-needed Orders whose paid/order age exceeds 24 hours;
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
- Current migration SHA-256:
  `ed5e069248281ef8738f97bd0480ee77b85044a4ad2c9ac433ef2840a2a7e941`
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

At that checkpoint, PR `#485` remained draft at the old failing head. The next
external action was to advance only that deployment-disabled branch to exact
corrected head
`15f3f85d1f9bcdaa6391fc6236116d2c48f863e7`, then merge only if all four checks
pass on that exact head against still-unchanged main `79894635`. This action
still excludes deployment, Production SQL, aliases, credentials, fixtures, and
RLS changes.

## Exact-schema lifecycle-clock correction

The deployment-disabled public PR branch was advanced to exact head
`15f3f85d1f9bcdaa6391fc6236116d2c48f863e7` against unchanged main
`798946354d7cecbaa8aa490ef39a1e89e2d856fa`. The three specialized proofs passed
again:

- Order Paid Repair Lock Proof run `36708673098`;
- Order Account Deletion Concurrency Proof run `36708673096`; and
- Order Staff Bootstrap Proof run `36708673114`.

Full CI run `36708673103` completed the source checks, ordered disposable
database proof chain, typecheck, lint, and repository test suite. It then failed
at step `483`, `Apply only Order ops-health through Prisma`. No source was
merged and nothing changed in Production.

Prisma exposed only `current transaction is aborted`, so the migration was run
directly against disposable PostgreSQL 16. It applied successfully to the
focused fixture, then failed against a database materialized from the exact
current Prisma schema with the first real error:

`column source_order.updatedAt does not exist`

The `Order` model has `createdAt` and nullable `paidAt`, but no `updatedAt`.
The focused PGlite fixture had incorrectly invented `updatedAt`, masking the
schema mismatch. Local correction commit
`5a4a894552bf86c4629dbf2dea93d9a5ff436eea` fixes both affected clocks:

- a pending refund uses provider authorization, refund lock, paid time, then
  order creation time as its ordered fallback clock; and
- a review-needed Order uses paid time, then order creation time, for the
  24-hour operational-age threshold.

The test fixture now matches the real `Order` lifecycle fields, asserts those
fields against `prisma/schema.prisma`, rejects a fabricated `Order.updatedAt`,
and covers old and fresh pending refunds whose claim timestamps are absent.
The protected workflow and its contract test are bound to the corrected
migration SHA-256
`ed5e069248281ef8738f97bd0480ee77b85044a4ad2c9ac433ef2840a2a7e941`.

Accepted local evidence for exact commit `5a4a8945`:

- the corrected migration applied cleanly through native PostgreSQL 16 to the
  exact current Prisma schema;
- under `grainline_app_runtime`, direct `Order` SELECT remained denied while
  the count-only aggregate executed and returned the expected values;
- the old/fresh missing-refund-clock and 24-hour review boundary returned the
  expected `1`, `1`, and total `2` counts in native PostgreSQL;
- the two focused suites passed 10/10 normally and 10/10 with the migration
  physically isolated at its CI holding path;
- focused ESLint, workflow YAML parsing, checksum binding, and
  `git diff --check` passed; and
- the worktree is clean at tree
  `3a00c92babc8124eb40631f323fa887c0a845b7d`.

Private recovery branch
`recovery/order-ops-health-lifecycle-clocks-5a4a8945-20260930` was pushed and
read back at exact commit `5a4a894552bf86c4629dbf2dea93d9a5ff436eea`.

Public PR `#485` remains draft at failing head `15f3f85d`; public main remains
`79894635`. The next external action requires advancing only the existing
deployment-disabled branch to exact corrected head `5a4a8945`, then marking
ready and merging only if all four checks pass on that exact head against still
unchanged main. That action does not deploy, apply Production SQL, move aliases,
change credentials, run fixtures, or change RLS.

## Superseding public merge and exact-main CI state

The paragraph immediately above records the pre-publication boundary and is
superseded by this section.

Deployment-disabled PR `#485` was advanced to exact corrected head
`5a4a894552bf86c4629dbf2dea93d9a5ff436eea` against unchanged base
`798946354d7cecbaa8aa490ef39a1e89e2d856fa`. All four checks passed on that
exact pair:

- full PR CI run `36714886998` completed successfully in 30m38s;
- Order Paid Repair Lock Proof run `36714886990` passed;
- Order Account Deletion Concurrency Proof run `36714887019` passed; and
- Order Staff Bootstrap Proof run `36714887067` passed.

A final GitHub and remote-ref readback confirmed the head, base, main, and
mergeability were unchanged. The PR was marked ready and merged as merge commit
`02f27a3948a2cbc87ddb7b53d0f07e8251718b83` at
`2026-09-30T12:59:47Z`. Remote `main` read back at that exact merge commit.

Merged-main push CI run `36718477687` then completed successfully on exact head
`02f27a3948a2cbc87ddb7b53d0f07e8251718b83` in 29m32s. The three specialized
Order push proofs also passed on that exact main commit:

- Order Paid Repair Lock Proof run `36718477584`;
- Order Account Deletion Concurrency Proof run `36718477661`; and
- Order Staff Bootstrap Proof run `36718477647`.

The Notification RLS FORCE Proof run `36718477586` and Conversation and Message
RLS FORCE Proof run `36718477585` failed while their disposable-database setup
replayed the already-committed Core Order FORCE migration. Both stopped at
`20260929160000_force_order_rls` with Prisma's secondary `current transaction
is aborted` message. They are separate compatibility-workflow failures and did
not invalidate the successful exact-main CI or the three successful Order
proofs. They remain recorded work; they were not rerun or treated as accepted
proofs here.

No Production migration, deployment, alias, credential, fixture, or RLS change
occurred during the PR merge or merged-main CI. The next release boundary is a
separately authorized dispatch of `order-ops-health-production.yml`, bound to:

- exact main `02f27a3948a2cbc87ddb7b53d0f07e8251718b83`;
- successful push CI run `36718477687`; and
- typed confirmation `apply-reviewed-order-ops-health`.

That protected workflow may apply only migration
`20260930033000_order_ops_health_summary`. It verifies main and CI again before
credential access, requires every predecessor applied with no unrelated pending
migration, reads back the ledger/function/counts, and proves the reviewed table
RLS, policy, owner, and grant posture is unchanged. The application remains
undeployed until this database authority is accepted.

## Production dispatch approval-review rejection

The user replied `explicit approval` to the exact Production dispatch request
for migration `20260930033000_order_ops_health_summary`, main
`02f27a3948a2cbc87ddb7b53d0f07e8251718b83`, and successful CI run
`36718477687`. Immediately before dispatch, remote main and the CI run were read
back and still matched those exact values.

The attempted `order-ops-health-production.yml` dispatch was rejected by the
automatic approval reviewer before GitHub received it. The reviewer stated that
the transcript lacked explicit authorization for the exact migration and bound
commit/CI pair. No workflow run was created and no Production database,
deployment, alias, credential, fixture, or RLS state changed. Do not infer a
Production attempt or partial migration from this rejected command.

A second attempt followed the user's reply `explicit approva;`. Remote main and
CI again matched the exact approved values, but automatic approval review again
rejected the dispatch before GitHub received it because that reply did not name
the migration, main commit, and CI run. No workflow run or Production mutation
resulted from the second rejected command either.

## Production migration accepted

The user subsequently gave exact authorization naming migration
`20260930033000_order_ops_health_summary`, main
`02f27a3948a2cbc87ddb7b53d0f07e8251718b83`, and successful CI run
`36718477687`. Remote main and CI were read back once more and matched exactly.

Protected workflow run `36723979346` was dispatched on exact main. GitHub held
the job at the `Production` environment gate; pending deployment environment
`8881622229` was approved under that same exact authorization. The workflow then:

- verified exact main and successful push CI before credential access;
- verified migration `33000` was the latest source and matched SHA-256
  `ed5e069248281ef8738f97bd0480ee77b85044a4ad2c9ac433ef2840a2a7e941`;
- verified the owner connection boundary and captured the existing table
  posture;
- required all predecessors applied and no unrelated pending migration;
- applied `20260930033000_order_ops_health_summary` through Prisma; and
- read back the ledger, exact function source and owner, fixed search path,
  runtime-only EXECUTE authority, nonnegative counts and total, and unchanged
  source-table RLS/grant/policy posture.

The log reports `All migrations have been successfully applied`, and run
`36723979346` completed with conclusion `success` on exact head
`02f27a3948a2cbc87ddb7b53d0f07e8251718b83`. The GitHub jobs API omitted the
step array for this environment-gated run, but the complete run log contains
the executed preflight, migration, and postflight commands and their successful
completion. Production now contains the count-only Order operations-health
function. No app deployment, alias, credential, fixture, or RLS posture change
was part of this run.

The next release boundary is building and verifying an app deployment from
exact main `02f27a39`, followed by a separately reviewed move of the canonical
Production aliases only after candidate checks pass.

## Exact-main deployment candidate accepted for cutover review

Remote `main` was read back unchanged at
`02f27a3948a2cbc87ddb7b53d0f07e8251718b83`. The five canonical aliases were
all READY on accepted predecessor deployment
`dpl_9RH5JuxfotPEYYij4ZK4X8gNbNwW`, exact source
`798946354d7cecbaa8aa490ef39a1e89e2d856fa`. The fresh deployment marker
`order-staged-02f27a39-20260930-01` had zero existing matches.

A single Production-target, `--skip-domain` candidate was built from a clean
detached worktree at exact current main:

- deployment: `dpl_G6hBoBC1jJt6KiphZifpqQj2Br4J`;
- immutable host: `grainline-i2hm5z9cb-drew-youngs-projects.vercel.app`;
- source/ref: `02f27a3948a2cbc87ddb7b53d0f07e8251718b83` / `main`;
- marker: `order-staged-02f27a39-20260930-01`;
- state/target: `READY` / `production`;
- project/team: `prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp` /
  `team_wvQeQHZGwCSwinC1uB7xbpjr`; and
- provider aliases: zero.

The protected candidate `/api/health` returned `200` with exact body
`{"ok":true}`. Its root page returned `200` and carried exact deployment marker
`dpl_G6hBoBC1jJt6KiphZifpqQj2Br4J`. A post-build provider readback found exactly
one deployment with the reviewed stage marker. All five canonical aliases
remained READY on predecessor `dpl_9RH5JuxfotPEYYij4ZK4X8gNbNwW`; candidate
creation did not move live traffic.

The durable single-use cutover operator and mode-0600 binding are saved at:

- `order-candidate-promotion-02f27a39-20260930/promote-order-candidate-explicit-aliases.mjs`;
- `order-staged-smoke-inputs-02f27a39-20260930/binding.json`.

Their SHA-256 values are respectively
`e61807dd8418f3baa5b898893851b9d81b14adc1357c29e54ba501b2fd7f7dc9` and
`6332fa468694979da6615f07f05ff726563c08424a1a162d6c05a315fa3e4bc2`.

Its read-only preflight accepted exact remote main, CI run `36718477687`, the
candidate identity and runtime tree, candidate and predecessor health/markers,
and all five current alias owners. On an execution failure after mutation
begins, it promotes predecessor `dpl_9RH5JuxfotPEYYij4ZK4X8gNbNwW`, explicitly
restores all five aliases to its immutable host, and requires predecessor
health, marker, and alias-owner postflight. Raw provider errors and credentials
are not persisted.

No checkout, database, credential, fixture, or RLS mutation is part of the
cutover operator. The remaining Production action is exact promotion of
candidate `dpl_G6hBoBC1jJt6KiphZifpqQj2Br4J` and explicit assignment of the
five canonical aliases, with automatic predecessor restoration if candidate
postflight fails or execution is interrupted after mutation begins.
