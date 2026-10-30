# Private-table compatible preparation release

## Purpose

Use `.github/workflows/private-table-preparation-production.yml` for reviewed,
additive private-table authority preparations. The workflow installs the fixed
database functions and columns that compatible application code needs. It does
not deploy the application, enable or force RLS, revoke table access, delete a
column, or change row data.

Each catalogued release names one byte-sealed migration. The current catalog
covers SupportRequest, StockNotification, Favorite, Follow, ReviewVote and
MakerVerification preparations. A reviewed batch id may name an exact ordered
list of those immutable releases; it cannot supply migration names dynamically.
`owner_social_verification_v1` is sealed to Favorite, Follow, ReviewVote and
MakerVerification in migration order.

## Required order

1. Review the exact preparation migration, its catalog entry, full-chain proof,
   and compatible application diff in a pull request.
2. Merge the reviewed pull request or the complete reviewed batch without
   deploying the converted application.
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

The workflow admits only a release or fixed batch in
`scripts/private-table-preparation-catalog.mjs`. It verifies every migration
hash before opening the owner connection and requires the selected ordered
migrations to be the entire pending set. It executes each self-contained
migration transaction directly with `psql`, then records those exact reviewed
bytes with Prisma's documented `migrate resolve --applied` path. If any SQL
transaction committed but its ledger write did not, a rerun recognizes only
that migration's complete byte-matched catalog, skips its SQL replay and
finishes the missing ledger record. It then continues later migrations in the
same sealed batch. Partial catalog state, an unreviewed zero-step row, reordered
batch members, an unrelated pending migration or any byte mismatch fails
closed. Already applied and recorded members skip both writes and repeat the
exact catalog and global-grant checks.

Adding a new release requires a new immutable catalog entry and focused tests.
Do not loosen an existing entry to fit changed SQL. Create a new migration and
release id instead.
