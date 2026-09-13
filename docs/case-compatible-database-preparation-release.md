# Case compatible database preparation release

Status: completed production-compatible database and application boundary.
The protected database preparation and compatible application are live.
Case-family RLS, read-mode convergence, ENABLE and FORCE remain separate later
releases.

## Purpose

This package separates the coexistence-safe database prerequisites for the
Case-family authority conversion from the application conversion and from RLS
activation. It lets the currently deployed application and the converted
application coexist while the fixed operations are installed.

The package contains:

- the additive Prisma schema for the private Case authority ledgers;
- exactly 16 compatible migrations, ending at
  `20260729061000_prepare_case_account_deletion_authority`;
- the reviewed runtime-role convergence and grant-audit updates;
- loopback-only PostgreSQL authority proofs for every Case operation;
- draft-only invariant, read-mode, ENABLE, rollback, FORCE and FORCE-rollback
  SQL used by the disposable proof; and
- migration-tree, grant-inventory and package-boundary guards.

The package does not contain:

- converted Case application routes or libraries;
- a promoted Case invariant migration;
- a promoted Case read-mode migration;
- a promoted Case ENABLE or FORCE migration;
- an executed production-migration workflow;
- a production deployment instruction; or
- a DirectUpload activation or cleanup credential.

The four private replay/claim ledgers created by these migrations are born
ENABLE plus FORCE with zero policies and no runtime or PUBLIC table access.
The three user-data tables `Case`, `CaseMessage`, and
`CaseMessageAttachment` remain RLS-off with their compatible predecessor
grants until the later, separately authorized activation.

## Accepted source evidence

The authority and activation design was accepted at exact head
`b9f2e40c530c06787afee1cb776010f853f5f7d4` by GitHub Actions run
`30504119117`, job `90750043124`. PostgreSQL 16 passed the complete 54-check
invariant, policyless ENABLE, direct-denial, fixed-function, FORCE and rollback
sequence with zero persistent residue. The documentation-only successor
`e58f10e099151a26174d72687ebfa81437d3449a` passed run `30504377236`, job
`90750822034`, including every predecessor authority proof, migration status,
grant/RLS audit, TypeScript, lint, the complete repository suite, dependency
audit and production build.

Those runs prove the reviewed source design. This isolated package must still
pass fresh exact-head CI because its purpose is to prove that the compatible
database subset is independently releasable while the current application
remains unchanged.

## Pooled-runtime postflight contract

Run `npm run ops:case-compatible-db-postflight` only from the exact clean
release commit after its main CI and guarded migration runs have succeeded.
Supply:

- `DATABASE_URL`: the reviewed pooled production
  `grainline_app_runtime` URL;
- `CASE_COMPATIBLE_DB_RELEASE_COMMIT`: the exact 40-character migrated main
  commit;
- `CASE_COMPATIBLE_DB_MAIN_CI_RUN_ID`: the successful exact-head main CI run;
- `CASE_COMPATIBLE_DB_MIGRATION_RUN_ID`: the successful guarded migration run;
- `CASE_COMPATIBLE_DB_POSTFLIGHT_CONFIRM`:
  `verify-production-case-compatible-database-read-only`; and
- `CASE_COMPATIBLE_DB_POSTFLIGHT_EVIDENCE_PATH`: a fresh path whose basename is
  `case-compatible-database-production-postflight-<release commit>.json`.

The operator rejects owner/migration URLs, alternate PostgreSQL URL variables,
unreviewed TLS/session options, a dirty or wrong checkout, reused evidence
paths, and the wrong production runtime identity. PostgreSQL itself must report
`transaction_read_only=on` before any catalog or denial check. Evidence is
sanitized, created once with mode `0600`, and contains no connection string.

## Required release order

1. Review and merge this compatible database package only.
2. Review the stacked operator that advances the guarded production workflow
   only through `case-account-deletion-authority-reviewed`.
3. Separately authorize and apply only its exact committed migrations.
4. Run the pooled-runtime compatible database postflight and confirm
   `transaction_read_only=on`, Case-family RLS remains
   off, fixed functions have exact ACLs, private ledgers remain inaccessible,
   and the existing application still has its predecessor grants.
5. Package, review, merge and deploy the compatible application conversion
   from the accepted conversion branch.
6. Run authenticated Case route smoke against the converted deployment.
7. Promote and apply the invariant/read-mode convergence preparation under its
   own review.
8. Finish DirectUpload cleanup credential, activation and pooled-runtime
   postflight gates.
9. Re-run the aggregate-only Case legacy inspection, then activate
   `Case`, `CaseMessage`, and `CaseMessageAttachment`.
10. Apply FORCE only as a later, separately authorized release after activation
   postflight.

Orders, payments and shipping remain a separate RLS group. Case functions that
validate Order and payment evidence do not claim those source tables are
already RLS-protected.

## Current production boundary

- Case-family RLS: off.
- DirectUpload RLS: off.
- Compatible database preparation: live at exact main
  `4728f673fdf0a11d38aaac384f3d9afe2cf86117` through protected migration run
  `30511805499`.
- Compatible application conversion: live at exact merge
  `f2f6861b177a47d22ed304714372584b79a0a0b0` through Vercel deployment
  `dpl_Gvsge8MWYW8DfDRSom34YPwsY8rH`.
- Case evidence: disabled because
  `CASE_EVIDENCE_ATTACHMENTS_ENABLED` remains absent.
- Next release: the invariant-only package documented in
  `docs/case-invariant-production-release.md`; no read-mode, ENABLE or FORCE
  SQL is included in that release.
