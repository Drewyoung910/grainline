# Production Database Credential Separation

Status: implementation under final review on
`codex/rls-runtime-env-separation-20260719`; not active in production.
SavedSearch Phase B is live and its accepted mode-`0600` postflight is pinned by
SHA-256 in the separation operator.

## Security Goal

Production application Functions receive only the pooled
`grainline_app_runtime` `DATABASE_URL`. They must not receive `DIRECT_URL`,
`MIGRATION_DB_ROLE`, grant-audit URLs, or an owner/admin database URL under a
different name. Owner migrations run from a manually approved GitHub
`Production` environment against an exact clean `main` commit.

The workstation owner credential lives only in the dedicated ignored private
file `/Users/drewyoung/grainline/.env.migration-owner.local`. The operator may
read legacy `.env.local` only to bootstrap `repair-local` when the dedicated
file is absent; once created, the dedicated file is the sole local source of
truth. This prevents application/tooling refreshes of `.env.local` from
silently replacing the reviewed migration credential.

Normal application traffic already uses the restricted runtime role and is
subject to grants and RLS. This release closes the separate environment-
exfiltration path: arbitrary runtime code that could read a valid
`neondb_owner` credential could otherwise open its own BYPASSRLS connection.

## Implemented Release Contract

- `vercel.json` no longer runs migrations. Its build command runs
  `guard:runtime-db-env` before the ordinary build.
- The runtime guard rejects `DIRECT_URL`, `MIGRATION_DB_ROLE`,
  `GRANT_AUDIT_DATABASE_URL`, `*_ADMIN_DATABASE_URL`, and
  `*_PROOF_DIRECT_URL`, including empty defined variables. It also rejects any
  PostgreSQL URL under a key other than `DATABASE_URL`, closing simple
  alias-name evasions. Production must contain the exact reviewed pooled
  endpoint and `grainline_app_runtime` identity.
- Automatic Vercel deployment from `main` is disabled. Preview deployment
  remains available, but the same privileged-key/value guard applies there.
- `.github/workflows/production-migrations.yml` is manual-only, serializes all
  production migration runs, grants only `contents: read`, and references the
  protected GitHub `Production` environment.
- The workflow uses only environment-scoped
  `PRODUCTION_MIGRATION_DIRECT_URL`. It never falls back to repository-wide
  `DIRECT_URL` or `DATABASE_URL`. The environment variable
  `PRODUCTION_MIGRATION_DIRECT_URL_SHA256` must match the injected URL before
  any connection.
- The owner secret is step-scoped only to database preflight, migration deploy,
  migration status, and the final grant audit. Checkout, setup-node, dependency
  installation, and Prisma client generation do not receive it.
- The migration preflight requires a typed confirmation, exact 40-character
  manually dispatched `main` commit, clean checkout, direct production owner
  endpoint, exact PostgreSQL 16 owner/runtime role and membership posture,
  SavedSearch `ENABLE` plus `FORCE` with three policies, and zero incomplete
  Prisma migrations. `DATABASE_URL` is forbidden in the owner-only job.

## Verified Starting State

Read-only inventory reverified on 2026-07-21:

- Vercel has exactly two privileged database records, both Sensitive and
  Production-only: `DIRECT_URL.updatedAt=1784661836916` and
  `MIGRATION_DB_ROLE.updatedAt=1784476084417`. There are no privileged Preview
  or Development records.
- Runtime Sensitive Production metadata remains
  `DATABASE_URL.updatedAt=1784476074964` and
  `RUNTIME_DB_ROLE.updatedAt=1784476081207`. Sensitive values cannot be read
  back outside builds/runtime.
- The public GitHub repository has stale repository-wide `DIRECT_URL` and
  `DATABASE_URL` secrets last updated 2026-04-28. No workflow in the reviewed
  release references them.
- GitHub `Production` has one required reviewer, `Drewyoung910` (user id
  234014962), `prevent_self_review=false`, and one selected branch policy:
  `main` (policy id 55079962). Its environment secret and variable inventories
  are empty before the separation rotation.
- `main` is not branch-protected. The environment intentionally uses the
  selected-branch policy rather than “protected branches only.”
- Accepted Phase B postflight:
  `/Users/drewyoung/grainline-rollout-evidence/saved-search-phase-b-production-postflight-20260721.json`,
  SHA-256
  `768096b53662ec9e8deaf8a3a63e6021ad755464f48b4b01c02fb339f1c78ea4`.
- The first candidate preflight on 2026-07-21 failed closed after provider
  metadata and before database/canary acceptance because the mode-`0600` local
  `DIRECT_URL` had been replaced at 20:24:24 UTC with an already rejected
  credential. Neon role metadata remained at the reviewed
  `2026-07-21T19:16:14.000Z`; a read-only reveal comparison proved the stored
  current password differed, authenticated, and retained the exact production
  catalog. The failed sanitized artifact is
  `runtime-db-separation-preflight-candidate-20260721.json`. Do not treat it as
  passing evidence.
- Candidate `4d8a62ef77317b8581fa82a5b3e63727ab875fa8` then passed both
  bounded local repair and the complete read-only preflight. Their private
  evidence SHA-256 values are respectively
  `5726012929d33624731724891048b710b62454ace5596da366a2178614e0d7bc`
  and
  `a448fed32a235baced10d307a7d7133e690049c3db7f419774e84935796ee407`.
- The legacy `.env.local` was subsequently replaced with the rejected URL a
  second time at 20:41:08 UTC. The exact writer was not proved; do not assign a
  cause. The durable fix is architectural: separation now stores and reads the
  owner URL from the dedicated mode-`0600`
  `.env.migration-owner.local`, which is covered by `.gitignore`, rather than
  treating the application environment file as the migration-credential store.
- The first fast-forward of this candidate to `main` created no Vercel
  deployment; the latest production deployment remained accepted Phase B
  `dpl_6nVQx5HBmurzH9iU1vwQLjA6gy2N`. GitHub CI run `29866387075`
  failed before its database setup because CI still requested the historical
  `release-0` artifact while `main` correctly contains all four Phase-B
  migrations. The successor changes only that CI contract to
  `phase-b-reviewed`; do not treat the failed run as a product/test failure or
  as a passing release gate.
- Replacement CI run `29866888011` passed that Phase-B artifact guard, then
  failed closed while replaying the sealed Phase-B migration because the
  ephemeral CI bootstrap still created the policy role as `NOLOGIN`. The
  PostgreSQL service log proved the first error was the migration's exact
  runtime-role attribute check. The CI-only bootstrap now creates a
  passwordless, membership-free `LOGIN NOINHERIT` role so fresh-database
  replay matches the current production posture; no sealed migration was
  edited.
- Exact-commit CI run `29867876111` then applied all 148 migrations, including
  sealed Phase B, and converged migration status successfully. It failed at the
  separate final grant audit because the workflow omitted the audit tool's
  existing explicit `--allow-loopback-ci` transport flag for the ephemeral
  localhost `sslmode=disable` service. The workflow now supplies that narrow
  flag; remote and guarded production audits still require exact
  `sslmode=verify-full` and cannot combine the two modes.
- Exact-commit CI run `29868020406` then passed all live PostgreSQL replay,
  migration-status, grant-audit, typecheck, and lint gates. Its test step found
  two previously hidden fixture defects: a global-default-privilege assertion
  expected a required scoped grant to be missing even though the fixture kept
  it, and one recovery test omitted the local-writer mock. The audit correctly
  reports the unsafe global scope without inventing a missing scoped grant;
  every operator unit test must mock all credential persistence.
- Exact-commit CI run `29869954334` confirmed the credential-writer mock fix,
  then exposed one more stale live-audit test string: the audit deliberately
  distinguishes runtime-role grants from PUBLIC grants on untracked tables,
  while the test still expected the old combined wording. The assertion now
  requires the precise runtime-role finding; audit behavior is unchanged.
- Exact-commit CI run `29870266091` passed every database, typecheck, lint,
  and test gate, including all 1,790 tests, then stopped at the independent npm
  security gate on newly published high-severity transitive advisories. The
  remediation aligns `prisma`, `@prisma/client`, and `@prisma/adapter-pg` at
  7.9.0, removes obsolete vulnerable Hono overrides no longer required by
  Prisma 7.9, and resolves patched `brace-expansion`, `fast-uri`, `js-yaml`,
  and `linkify-it` versions through the lockfile. Do not suppress or lower the
  audit gate; a fresh exact-commit CI run must still build successfully.
- Exact-commit CI run `29870881784` then proved the Prisma 7.9 lockfile installs,
  generates, replays all migrations, passes the production-style grant/RLS
  audit, typechecks, lints, and passes 1,789 of 1,790 tests. Its only failure
  was the deliberate dependency-hygiene pin still expecting Prisma 7.8. The
  reviewed pin now expects 7.9; audit and build correctly remained skipped
  until a new exact-commit run can exercise them.
- Exact-commit CI run `29871126969` passed the complete gate: clean install,
  Prisma generation, all 148 migrations, production-style grant/RLS audit,
  typecheck, lint, all 1,790 tests, high-severity dependency audit, and the
  production build.
- The first post-CI `repair-local` attempt failed before reading Vercel state
  because the mutable npx cache had advanced its Vercel CLI from the reviewed
  56.3.2 to 56.4.1. Evidence
  `runtime-db-separation-local-repair-0b0bb01d-20260721.json` records
  `sourceVerified=true`, `phaseBPostflightVerified=true`, and every provider,
  database, and mutation flag false. The installed 56.4.1 package matched the
  npm registry SHA-512 integrity; the operator now pins both that version and
  integrity and must pass a new exact-commit CI run before retrying.
- Exact-commit CI run `29871768209` passed the complete gate after that pin.
  Local repair, read-only preflight, Vercel privileged-variable removal, and
  the one-time Neon owner reset then passed on `b7c95fd0`. Reset evidence is
  acceptance-eligible and proves new authentication, superseded-password
  rejection, protected GitHub digest agreement, zero other owner sessions,
  Vercel runtime-only state, and private recovery-state removal. Repository-wide
  `DIRECT_URL` and `DATABASE_URL` secrets were then deleted after proving no
  workflow referenced them. Protected Production Migrations run `29872336361`
  passed its exact-source/credential guard, migration deploy/status, and final
  grant/RLS audit.
- Unpromoted Production-target Vercel deployment
  `dpl_79GeXVVS6KiPMUywKACzwsUtavrz` failed closed in
  `guard:runtime-db-env`; public aliases remained on the accepted Phase B
  deployment. The guard previously suppressed the specific assertion, so it
  now emits only a bounded diagnostic code (never a value or raw error) before
  a second staged deployment is attempted.
- The second unpromoted deployment
  `dpl_22NLv2sy7DH1ccfHYyhePz3n76mg` failed with the bounded code
  `PRIVILEGED_DATABASE_KEYS` even though a fresh Vercel API inventory still
  reported no privileged project records. The guard now prints only the
  matched key names for the two key-list failure classes; values remain
  suppressed. A new exact-commit CI run and staged deployment are required to
  identify and remove the residual injection source.

## Activation Sequence

Keep this as a separate release; do not combine it with Notification policy
activation.

1. Require the pinned healthy Phase B postflight.
2. Merge the reviewed separation commit to `main`. Its Vercel Git policy must
   suppress an automatic production deployment. Verify no new production
   deployment was created.
3. Re-read GitHub `Production` protection and its empty pre-rotation
   secret/variable inventory.
4. If and only if the local owner URL is rejected while the pinned Neon role
   timestamp and all pre-removal provider state remain exact, run
   `repair-local`. It uses the idempotent reveal endpoint, proves the revealed
   credential and catalog/canary, and writes only the dedicated private local
   owner file. Once that file exists, later operator modes ignore the legacy
   application `.env.local` value.
5. Run `preflight-only` from the exact clean `main` commit.
6. Run `remove-vercel`. It removes only Production `DIRECT_URL` and
   `MIGRATION_DB_ROLE`, can converge an interrupted partial removal, and
   requires unchanged runtime record timestamps plus a fresh all-environment
   inventory with no privileged database key. Existing deployments retain
   their build-time environment until the next step invalidates that password.
7. Run `reset`. It uses the pinned Neon control-plane reset for the exact
   project, primary/default production branch, read-write endpoint, and owner
   role. Before any provider read or mutation it reserves and fsyncs 64 KiB for
   the private evidence artifact. Before the non-idempotent POST it writes the
   prior URL and pre-reset role timestamp to a dedicated mode-`0600` recovery
   file. After a valid response it stores the returned credential locally and
   in protected GitHub before waiting for provider operations, then proves new
   authentication, prior `28P01` rejection, unchanged role/RLS posture, zero
   owner sessions, GitHub digest agreement, and continued Vercel runtime-only
   state. It stages and fsyncs the sanitized success evidence before deleting
   recovery state, then atomically publishes the evidence.
8. If reset or placement is ambiguous, run `recover`. It never calls reset. A
   still-accepted prior credential plus unchanged role timestamp proves reset
   did not complete and clears only recovery state. If the role timestamp or
   partial placement changed while the prior password still accepts, recovery
   reveals the currently stored password: the old password causes local state
   to be restored and partial protected GitHub secret/variable placement to be
   removed; a different current password is converged and both old rejection
   and new acceptance are retried through Neon's documented overlap window. A
   rejected prior credential plus advanced role timestamp also uses the
   idempotent reveal endpoint to converge local/GitHub/database state.
9. The completed reset invalidates the owner credential embedded in the Phase B
   deployment and every superseded deployment. Vercel variable deletion alone
   is not sufficient.
10. After confirming no workflow references them, delete stale repository-wide
   GitHub `DIRECT_URL` and `DATABASE_URL`; keep the replacement only in the
   protected environment.
11. Manually dispatch `Production Migrations` from `main`, paste the exact
    `main` SHA, type `run-reviewed-production-migrations-from-main`, approve the
    environment job, and retain the green run/final audit evidence.
12. Explicitly deploy that same clean commit with Vercel. The build must pass
    with only the exact runtime database identity.
13. Postflight must re-prove deployment source/aliases, Vercel env isolation,
    migration/grant/RLS catalog state, runtime no-context denial, ops-health,
    cron/webhook health, and live read-only routes.
14. Only then resume Notification staging/activation.

## Operator Commands

Use the exact clean `main` checkout and a distinct evidence filename for every
mode. Replace `<exact-main-sha>` below.

Read-only preflight:

```sh
RUNTIME_DB_SEPARATION_MODE=preflight-only \
RUNTIME_DB_SEPARATION_CONFIRM=rotate-owner-into-protected-github-after-vercel-removal \
RUNTIME_DB_SEPARATION_RELEASE_COMMIT=<exact-main-sha> \
RUNTIME_DB_SEPARATION_EVIDENCE_PATH=/Users/drewyoung/grainline-rollout-evidence/runtime-db-separation-preflight.json \
npm run ops:separate-db-credential
```

Bounded local repair, only after a failed preflight proves the local owner URL
is rejected and provider/catalog state is otherwise exact. This creates or
replaces only `.env.migration-owner.local`:

```sh
RUNTIME_DB_SEPARATION_MODE=repair-local \
RUNTIME_DB_SEPARATION_CONFIRM=rotate-owner-into-protected-github-after-vercel-removal \
RUNTIME_DB_SEPARATION_RELEASE_COMMIT=<exact-main-sha> \
RUNTIME_DB_SEPARATION_EVIDENCE_PATH=/Users/drewyoung/grainline-rollout-evidence/runtime-db-separation-local-repair.json \
npm run ops:separate-db-credential
```

Remove only the two reviewed Vercel records:

```sh
RUNTIME_DB_SEPARATION_MODE=remove-vercel \
RUNTIME_DB_SEPARATION_CONFIRM=rotate-owner-into-protected-github-after-vercel-removal \
RUNTIME_DB_SEPARATION_RELEASE_COMMIT=<exact-main-sha> \
RUNTIME_DB_SEPARATION_EVIDENCE_PATH=/Users/drewyoung/grainline-rollout-evidence/runtime-db-separation-vercel-removal.json \
npm run ops:separate-db-credential
```

Perform the one reset:

```sh
RUNTIME_DB_SEPARATION_MODE=reset \
RUNTIME_DB_SEPARATION_CONFIRM=rotate-owner-into-protected-github-after-vercel-removal \
RUNTIME_DB_SEPARATION_RELEASE_COMMIT=<exact-main-sha> \
RUNTIME_DB_SEPARATION_EVIDENCE_PATH=/Users/drewyoung/grainline-rollout-evidence/runtime-db-separation-reset.json \
npm run ops:separate-db-credential
```

Recovery only while the private prior-owner file exists:

```sh
RUNTIME_DB_SEPARATION_MODE=recover \
RUNTIME_DB_SEPARATION_CONFIRM=rotate-owner-into-protected-github-after-vercel-removal \
RUNTIME_DB_SEPARATION_RELEASE_COMMIT=<exact-main-sha> \
RUNTIME_DB_SEPARATION_EVIDENCE_PATH=/Users/drewyoung/grainline-rollout-evidence/runtime-db-separation-recovery.json \
npm run ops:separate-db-credential
```

Every artifact must be mode `0600`, `status=passed`, and `issueCount=0`.
Preflight/local-repair/removal and a proven “reset not completed” recovery
intentionally have `acceptanceEligible=false`. A completed reset or reveal recovery must have
`acceptanceEligible=true`, every named terminal check true, and
`ownerSessionCount=0`.

The operator reserves `<evidence>.pending` before it begins. A normal run
atomically renames that private file to the requested evidence path. If a
process interruption leaves only `.pending`, do not delete it or rerun `reset`.
When it contains a completed artifact and recovery state is already absent, an
exact rerun publishes it without provider work. Otherwise retain it and run
`recover` with a new evidence filename while the private prior-owner file
exists.

## Failure And Rollback

- If GitHub environment protection drifts, stop before storing a secret.
- If Vercel removal is partial, rerun only `remove-vercel`; do not reset until
  the runtime-only inventory passes.
- Once `neonPasswordResetAttempted=true`, never run `reset` again while the
  private prior-owner recovery file or an unfinished `.pending` evidence file
  exists. Use `recover` with a distinct evidence filename.
- If GitHub placement is ambiguous after reset, `recover` re-upserts the same
  revealed current password and digest; it does not rotate again. If Neon still
  stores and accepts the prior password, recovery restores that local URL and
  removes any partially placed protected GitHub secret and digest instead.
- If the migration workflow fails, keep the current app live and reconcile the
  owner-only migration path before deploying application code.
- If the runtime-only deployment regresses, the previous deployment still uses
  unchanged runtime `DATABASE_URL`; its embedded owner credential is already
  invalid. Roll back application code without restoring any owner variable to
  Vercel.

## Primary References

- Vercel variables affect builds and Functions, and changes apply only to new
  deployments: <https://vercel.com/docs/environment-variables>
- Vercel CLI environment removal:
  <https://vercel.com/docs/cli/env>
- Vercel `git.deploymentEnabled`:
  <https://vercel.com/docs/project-configuration/git-configuration>
- GitHub protected environments and secrets:
  <https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments>
- Neon reset and reveal endpoints:
  <https://api-docs.neon.tech/reference/resetprojectbranchrolepassword>
  and
  <https://api-docs.neon.tech/reference/getprojectbranchrolepassword>
