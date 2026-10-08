# User RLS Release

Last updated: 2026-10-08

## Current Production State

The `User` table has accepted policyless Phase A in Production. Row Level
Security is enabled, `FORCE ROW LEVEL SECURITY` is not yet enabled, there are
zero policies, and the runtime, staff, and `PUBLIC` roles have zero direct
table or column authority. The application reaches the table only through the
reviewed fixed-function catalog.

Phase A is bound to:

- exact main `c9b02dfa530d3ca86b0ea7efd6f2f8e9e3b5233c`;
- first-attempt merged-main CI `37743008603`;
- cross-domain convergence run `37747092440`;
- complete pre-ENABLE catalog inspection `37747428986`;
- guarded ENABLE run `37747980060`;
- migration `20261008010000_enable_user_rls` with SHA-256
  `628f1cbb966cde1cb7f05f48ea0c5b890dce074d8f77536b3a67117c0141146f`.

The accepted postflight retained all 150 reviewed User readers as
security-definer functions and confirmed zero runtime/staff/`PUBLIC` direct
grants. The sanitized ENABLE evidence artifact digest is
`f2f6f4caba3c3dbec3df2847366c34c21f96f15f4837a42d88728baf6de0a208`.

## FORCE Candidate

The next release is a distinct source and Production boundary. The candidate
migration is `20261008020000_force_user_rls`, SHA-256
`d6e9e9afca641f527c4c120806c5af219d6b4f08936def91d16c348cff2480c3`.
It requires the exact accepted Phase A predecessor and changes only the User
table's FORCE flag. It creates no policy, mutates no application row, and
changes no grant.

The candidate carries the complete 53-function authority catalog, the exact
accepted migration ledger, the 150-reader security mode invariant, User table
constraints, indexes and triggers, and the accepted cross-domain convergence
invariant. CI holds the FORCE migration while the historical User chain is
replayed, proves Phase A first, stages the exact accepted ENABLE ledger, and
then applies FORCE in disposable PostgreSQL.

The guarded Production workflow requires an exact current-main commit, a
successful first-attempt main CI run, the accepted successful first-attempt
ENABLE run, and the typed confirmation `force-reviewed-user-rls`. It supports
only an exact Phase A predecessor or an exact restart-safe FORCE state. After
the one allowed migration deploy, it verifies the FORCE ledger, reconverges
the runtime role, checks the policyless forced catalog, audits global grants,
and retains sanitized evidence.

## Release Boundary

The FORCE source candidate is not a Production mutation. It must be reviewed,
merged on an unchanged base, and pass exact-main CI before any FORCE dispatch.
Production FORCE requires separate explicit approval bound to that exact main
commit, CI run, and the accepted ENABLE predecessor run. A failed preflight or
postflight is a release failure and must not be described as accepted FORCE.
