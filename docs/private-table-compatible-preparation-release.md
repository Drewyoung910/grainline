# Private-table compatible preparation release

## Purpose

Use `.github/workflows/private-table-preparation-production.yml` for reviewed,
additive private-table authority preparations. The workflow installs the fixed
database functions and columns that compatible application code needs. It does
not deploy the application, enable or force RLS, revoke table access, delete a
column, or change row data.

The first catalogued release is `support_request_v1`, which applies only
`20261023010000_prepare_support_request_authorities`.

## Required order

1. Review the exact preparation migration, its catalog entry, full-chain proof,
   and compatible application diff in a pull request.
2. Merge the reviewed pull request without deploying the converted application.
3. Wait for CI and every exact-main push proof required by the workflow to pass.
4. Dispatch **Private Table Preparation Production** for that exact main commit.
5. Confirm the sanitized postflight artifact records `state: applied`, the exact
   function catalog, unchanged table grants/RLS posture, and no row data.
6. Deploy the compatible application and prove that no direct base-table caller
   remains.
7. Prepare policyless ENABLE and FORCE as later, separately reviewed releases.

The Production request must name the workflow, exact commit, migration, and
expected effect. Drew's one-word approval authorizes that named operation.

## Fail-closed and restart behavior

The workflow admits only a release in
`scripts/private-table-preparation-catalog.mjs`. It verifies the migration hash
before opening the owner connection, requires its migration to be the entire
pending set, applies with Prisma, then compares preflight and postflight table
posture. If the migration was already applied, it skips the write and repeats
the exact catalog and global-grant checks.

Adding a new release requires a new immutable catalog entry and focused tests.
Do not loosen an existing entry to fit changed SQL. Create a new migration and
release id instead.
