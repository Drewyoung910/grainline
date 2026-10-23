# Private-table policyless ENABLE release

## Purpose

Use `.github/workflows/private-table-enable-production.yml` only after a
catalogued private-table preparation and its compatible application are live.
The workflow applies one reviewed policyless `ENABLE ROW LEVEL SECURITY`
migration, keeps `NO FORCE`, and revokes direct runtime, staff, and `PUBLIC`
table authority. It does not deploy application code, FORCE RLS, drop columns,
rewrite rows, or change an external provider.

The first catalogued release is `support_request_v1`, which admits only
`20261023020000_enable_support_request_rls` at SHA-256
`370698b0617fbb5eb2d4d04d7acef43141628f8a8d3a6e672d4b1ef973493b61`.

## Required order

1. Review the sealed migration, reusable catalog/inspector, global grant-audit
   integration, full-chain PostgreSQL behavior proof, and rollback shape.
2. Merge without dispatching the Production workflow.
3. Require green exact-main CI and every exact-main push proof named by the
   workflow.
4. Confirm the accepted preparation run and exact compatible deployment are
   ancestors of the ENABLE commit and that the deployment marker is live.
5. Dispatch **Private Table ENABLE Production** with the exact release id,
   main commit, CI run, preparation run, compatible app commit, deployment id,
   and confirmation string.
6. Retain the sanitized postflight artifact and confirm migration status plus
   the global runtime-grant audit.
7. Exercise the existing application smoke path before preparing a separate
   FORCE-only release.

The Production request must name the workflow, exact commit, migration,
compatible deployment, and expected effect. Drew's one-word approval authorizes
that named operation.

## Fail-closed and restart behavior

The workflow verifies the exact main/CI pair and all required push workflows,
the successful protected preparation job, ancestry, and the live deployment
marker before opening the owner connection. It then requires either the exact
predecessor posture or the already-enabled posture, allows only its reviewed
migration to be pending, applies at most once, and reads back RLS flags,
table/column ACLs, function owners, function bodies, `SECURITY DEFINER`,
`search_path`, and EXECUTE grants. Evidence contains no row data and is written
mode `0600`.

If the migration is already applied, the workflow skips the write and reruns
the complete postflight. Rollback is database-first: restore the exact inspected
predecessor table grants and disable RLS before rolling application code back.
FORCE must remain a later, separately reviewed posture-only release.
