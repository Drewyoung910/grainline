# Case compatible database preparation release

Status: candidate package only. No production migration, deployment, merge,
Case-family RLS activation, or FORCE release is authorized by this document.

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
- a production-migration workflow authorization;
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

## Required release order

1. Review and merge this compatible database package only.
2. Separately authorize and apply only its exact committed migrations.
3. Run the compatible database postflight and confirm Case-family RLS remains
   off, fixed functions have exact ACLs, private ledgers remain inaccessible,
   and the existing application still has its predecessor grants.
4. Package, review, merge and deploy the compatible application conversion
   from the accepted conversion branch.
5. Run authenticated Case route smoke against the converted deployment.
6. Promote and apply the invariant/read-mode convergence preparation under its
   own review.
7. Finish DirectUpload cleanup credential, activation and pooled-runtime
   postflight gates.
8. Re-run the aggregate-only Case legacy inspection, then activate
   `Case`, `CaseMessage`, and `CaseMessageAttachment`.
9. Apply FORCE only as a later, separately authorized release after activation
   postflight.

Orders, payments and shipping remain a separate RLS group. Case functions that
validate Order and payment evidence do not claim those source tables are
already RLS-protected.

## Production boundary at packaging time

- Case-family RLS: off.
- DirectUpload RLS: off.
- Case compatible application conversion: isolated, not deployed.
- Production migration workflow: still authorized only through the existing
  DirectUpload legacy-repair boundary.
- Production and persistent staging: unchanged by package construction and
  disposable proof.

