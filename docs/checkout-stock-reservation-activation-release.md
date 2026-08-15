# CheckoutStockReservation policyless activation release

Status: merged activation release with isolated production wiring in progress.
The exact reviewed Phase-A migration is on main and passed exact-main
CI/disposable PostgreSQL. It is wired to the guarded Production Migrations
workflow only on a separate unmerged branch. Production RLS and grants are
unchanged.

Date: 2026-08-15

Prerequisite activation-refresh PR #217 merged as exact main
`865a2de0d5a5e1225e85da9bdb431df9f030e90f`; exact-main CI
`31868509324` passed. Its Vercel run was Preview-only and failed at the
intentional missing-Preview-database boundary; no Production deployment was
created.

Activation release PR #218 subsequently merged exact reviewed head
`1dbab12dfe52867f1df5ca8689db2e3f0ae89933` as main
`5817dea6725f7f2eb7fde3da1f546aa75dd449b1`; exact-main CI run
`31892857440` passed. The separate production-wiring design is retained in
`docs/checkout-stock-reservation-activation-production-wiring.md`.

## Exact release boundary

- migration: `20260815060000_enable_checkout_stock_reservation_rls`
- activation draft SHA-256:
  `4581b79d759b8c8e3e6be9e34471514c4f4be4f93fe73887b4469ac18420bae1`
- promoted migration SHA-256:
  `7940be1969c89c8bbf5818164a56afb7e8bf7925bd8a26231d8ac865fac7c519`
- migration-tree SHA-256:
  `b014ea6ccc6ec6107e06897269ed607e6a8930c770fea3914e4b6b8b42b502f3`
- database-first rollback SHA-256:
  `4ff20bc7eaeb8def9c8c9ef83dad204afd146a4d75c01363b91cbfdf5d1c75d1`
- guarded phase: `checkout-stock-reservation-activation-reviewed`
- protected table: exactly `public."CheckoutStockReservation"`
- predecessor catalog: 18 runtime / 7 private functions
- activated catalog: 16 runtime / 9 private functions
- policies: zero
- FORCE: deliberately off until a separate posture-only release
- direct ordinary-runtime/PUBLIC table and column authority after activation:
  zero
- row-data mutations in the activation: zero

The staging verifier reconstructs the migration from the byte-pinned draft and
refuses any mismatch. The release verifier independently pins the complete
migration prefix, rollback bytes, Prisma config, middleware shape and exact
phase ordering.

## Authority decision

This table is an internal checkout service ledger rather than participant-owned
data. Buyer or seller policies would expose reservation payloads, Stripe
session identifiers, repair state and checkout locks without safely authorizing
webhook or repair operations. Phase A therefore has no row policies and no
direct runtime table access. The application reaches the ledger only through
the reviewed source-consistent fixed operations.

The migration first verifies the exact live 25-function predecessor, table
owner, restricted runtime role, zero-policy/RLS-off posture, direct compatible
CRUD, data invariants, constraints, indexes and trigger. It then enables RLS,
keeps FORCE off, revokes all table/column authority, and revokes runtime
execution from only the two unused legacy creation functions. Those functions
remain installed for database-first rollback, while deployable application
source is guarded from calling them.

## CI proof boundary

CI must verify and temporarily isolate this migration before replaying every
historical release. After the source-consistency predecessor is applied and
audited, CI restores the activation migration, re-runs the disposable
activation/rollback/tamper suite, deploys the exact migration to PostgreSQL,
converges grants, checks migration status and the global grant/RLS inventory,
then connects through a direct `grainline_app_runtime` login inside an
engine-attested repeatable-read read-only transaction. That final proof must
show:

- exact restricted runtime identity;
- policyless ENABLE with FORCE off;
- zero runtime/PUBLIC table or column authority;
- the exact 16-runtime/9-private source and ACL catalog;
- direct table reads denied with SQLSTATE `42501`;
- the fixed export succeeds;
- private-helper execution is denied;
- a fixed write reaches SQLSTATE `25006` at the read-only fence;
- zero persisted proof residue.

## Remaining release sequence

1. Complete exact-head CI and review of the isolated production wiring.
2. Merge the wiring without dispatching it.
3. Separately dispatch only the exact same-main-CI-bound activation release.
4. Apply Phase A, converge grants, verify migration/global audit, and run the
   separate pooled-runtime production postflight.
5. Prepare and execute FORCE as its own posture-only migration.

No step in this document authorizes a production migration, deployment,
cleanup, provider mutation or FORCE activation.
