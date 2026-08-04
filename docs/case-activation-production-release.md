# Case-family policyless RLS activation release

Prepared and accepted 2026-08-04. The release was reviewed on isolated branch
`agent/case-rls-activation-release-20260804`, merged from exact head
`6bfcfda88193cd1ecbe316c3d665321c7d965887` as main commit
`a9abaec057ab80a455a81503080bcd3b9027c4be`, and promoted through the protected
production workflow described below.

## Production acceptance

- Exact-main CI run `30937766824` passed the migration-tree, authority,
  concurrency, rollback, grant, TypeScript, lint, full test, dependency-audit
  and production-build gates.
- Protected Production Migrations run `30939836526` (job `92095126727`) passed
  the live owner-role, credential, membership, Phase-B and migration-ledger
  preflight; applied only `20260804160000_enable_case_rls`; reported the full
  migration tree applied; and passed the final runtime grant/RLS audit.
- The real pooled `grainline_app_runtime` postflight then passed in an
  engine-attested `REPEATABLE READ READ ONLY` transaction. It proved RLS
  enabled without FORCE on `Case`, `CaseMessage` and
  `CaseMessageAttachment`, zero policies, zero direct runtime table or column
  authority, the exact 27-function runtime partition, three private helpers,
  direct-read SQLSTATE `42501`, and fail-closed invalid-actor reads. The
  postflight rolled back and changed no production state.
- Sanitized mode-`0600` evidence is retained outside the runtime repository as
  `case-activation-production-postflight-a9abaec057ab80a455a81503080bcd3b9027c4be.json`
  with SHA-256
  `117590a50316ff0efb783c490e95aa31014221a4b93e4372f5f6995c5a15ee15`.

The first local postflight invocation exited before importing the operator or
contacting PostgreSQL because the disposable worktree dependency link did not
contain `pg`. The evidence path remained fresh. The link was replaced with an
exact-lockfile `pg@8.20.0` dependency tree and the unchanged postflight passed.
This was a local operator setup failure, not a database or RLS failure.

Case evidence remains disabled. FORCE, deployment, cleanup scheduling,
provider variables and token state were unchanged and remain separate release
boundaries.

## Exact release unit

- Migration: `20260804160000_enable_case_rls`
- Reviewed draft SHA-256:
  `99ddbca8ede5144e7f3d7482bc8c0360b7b4acf4ca0e69ebd6836fa715e5f8ab`
- Promoted migration SHA-256:
  `df2469781d766612b3d7de97f989cbbf5f37d569d382a79bd51e66a3553ff19f`
- Complete 188-migration tree SHA-256:
  `644201c5cf602eb8be253fa90e62749cb5276a54f691e37bf5b44d3e5ddfed18`
- Guard phase: `case-activation-reviewed`

The transaction acts on exactly `Case`, `CaseMessage`, and
`CaseMessageAttachment`. It enables RLS, explicitly leaves FORCE off, creates
no policy, creates or replaces no function, changes no row data, and revokes
all direct table and column authority from `PUBLIC` and
`grainline_app_runtime`. All permitted application behavior continues through
the 27 purpose-bound functions already live and proved during the compatible
authority releases.

## Accepted predecessor evidence

- The aggregate-only protected inspection in run `30413133843` found zero
  Cases, zero CaseMessages, zero CaseMessageAttachments, and zero anomaly
  counts. No cleanup or backfill is required.
- The compatible database and application releases are live. Invariant
  migration `20260730010000_enforce_case_message_invariants` and read-mode
  migration `20260730020000_converge_case_read_modes` are live and retained in
  their production release records.
- DirectUpload policyless FORCE activation completed in recovery run
  `30877508811`. Exact-main CI `30881395864` and restricted-role postflight run
  `30924905247` accepted the pooled-runtime and cleanup-role boundaries in
  PostgreSQL-attested read-only transactions. Case evidence remains disabled.

## Proof and workflow ordering

The release verifier reconstructs the migration from the byte-pinned draft,
pins the full migration tree, and also pins the separate rollback and FORCE
drafts. CI physically removes the Case activation migration before the first
Prisma deploy. It then:

1. applies and proves the compatible tree and DirectUpload predecessor;
2. runs every Case authority/concurrency proof and the rollback-only invariant,
   activation, FORCE, and rollback harness while Case RLS is still off;
3. runs the compatible pooled-runtime postflight;
4. restores and applies only the exact promoted Case activation migration;
5. reconverges runtime grants, verifies migration status, and runs the global
   grant/RLS audit; and
6. runs a second rollback-only PostgreSQL proof against the promoted catalog,
   asserting policyless ENABLE without FORCE or direct table/column grants and
   SQLSTATE `42501` for SELECT, INSERT, UPDATE, and DELETE on all three tables.

The guarded production workflow validates the same exact bytes and tree before
Prisma deploy. It does not deploy application code or change provider state.

## Prepared production acceptance

`npm run ops:case-activation-postflight` is the separate read-only acceptance
operator for the exact clean main release after the guarded migration run. It
accepts only the reviewed pooled `grainline_app_runtime` production identity,
rejects owner and aliased PostgreSQL credentials, binds the exact release
commit plus successful main-CI and migration run ids, and starts an
engine-attested `REPEATABLE READ READ ONLY` transaction before catalog work.

The operator proves policyless ENABLE without FORCE on all three Case-family
tables, zero direct runtime table or column authority, the complete 27-function
runtime partition, private-helper denial, invalid-actor recipient denial, and
SQLSTATE `42501` for a direct read of each protected table. It always rolls
back, writes a fresh sanitized mode-`0600` JSON evidence file containing no
connection string, and makes no production mutation. Its exact confirmation
is `verify-production-case-policyless-activation-read-only`. This postflight
is not evidence that activation is already live; it must run only after the
guarded production migration succeeds.

## Separate later boundaries

The reviewed activation rollback remains a draft at SHA-256
`3aa35aaaa3e02583965fc1ae5fd7301b2caeba797deb9b8e807309a51b2db8b0`.
The posture-only FORCE candidate remains a separate draft at SHA-256
`2620be10dba8e1c9074742f925e7f146ce2a8f4acaea4b6a6dd88e0a0b92b4d9`,
with rollback SHA-256
`dc6ead925a61509465925d880f6338d0494ab583b9c38dda012f0eeea6e0a59d`.

This activation did not bundle FORCE, Case-evidence enablement, DirectUpload
cleanup scheduling, token retirement, provider-variable changes, application
deployment, or the later Order/payment/shipping RLS group. The next Case-family
database boundary is the separately reviewed posture-only FORCE release.
