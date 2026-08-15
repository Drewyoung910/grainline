# CheckoutStockReservation policyless activation plan

Status: refreshed Phase-A design is now promoted into an isolated byte-pinned
migration release and exercised only in CI/disposable PostgreSQL. Production
still has RLS off and compatible direct runtime CRUD. The guarded production
workflow remains pinned to the source-consistency predecessor; this release
does not authorize a production migration, deployment, RLS/grant change,
cleanup or provider mutation.

Date: 2026-08-15

## Decision

`CheckoutStockReservation` is an owner-operated service ledger, not a table
that buyers, sellers or staff should query directly. Phase A therefore uses:

- `ENABLE ROW LEVEL SECURITY`, without `FORCE`;
- zero policies;
- zero ordinary-runtime or PUBLIC table/column privileges;
- runtime `EXECUTE` only on the exact 16 reviewed operations, including both
  database-derived source-consistent creation statements;
- nine owner-private functions: the seven trigger, validation, restoration,
  source-binding and source-witness helpers plus the two retired legacy
  creation functions.

This is intentionally different from recipient-owned tables such as
Notification. Buyer or seller row policies would expose internal checkout
locks, payload hashes, repair state and Stripe session identifiers while still
failing to authorize cross-user webhook and repair operations safely.

## Exact predecessor gates

The activation draft refuses to run unless all of these remain exact:

1. The reviewed owner holds the table and no other owner sessions remain in
   the database.
2. `grainline_app_runtime` is LOGIN, NOINHERIT, non-privileged and NOBYPASSRLS,
   with only the proven non-effective Neon bootstrap membership.
3. RLS and FORCE are off, there are zero policies, compatible runtime CRUD is
   still present, and PUBLIC/runtime column ACLs are absent.
4. The five non-primary validated checks, exact nine-index definitions and the
   sole reviewed normalization trigger exist; extra or name-only catalog
   lookalikes are rejected.
5. Every row satisfies the lifecycle, actor, item, restoration and repair
   invariants enforced by the normalization trigger.
6. The complete 25-function source-consistent catalog has exact signatures,
   owner, language, security mode, search path, volatility, parallel safety,
   source MD5 and runtime/PUBLIC ACLs.

The migration uses bounded statement and lock timeouts, one advisory
transaction lock and an ACCESS EXCLUSIVE table lock. A conflicting operation
therefore fails and can be retried instead of partially changing authority.

## Completed compatibility gates

The prerequisites are now evidence-backed rather than prospective:

- compatible authority migration and pooled-runtime proof passed;
- the source-consistency successor is live with the exact 18-runtime/7-private
  catalog;
- two fresh provider slots passed without weaker performance thresholds;
- the compatible application is deployed;
- authenticated production checkout smoke passed and cleaned its fixtures;
- the only current-credential predecessor deployment was removed, and every
  older embedded runtime password is proven rejected.

The exact evidence is retained in
`docs/checkout-stock-reservation-source-consistency-release.md`,
`docs/checkout-stock-reservation-app-deployment-audit.md`,
`docs/checkout-stock-reservation-production-smoke.md`, and
`docs/checkout-stock-reservation-predecessor-drain.md`.

## Compatibility and rollback

Phase A removes direct table authority, so rollback remains database-first:
disable RLS and restore only SELECT, INSERT, UPDATE and DELETE to the runtime
role before rolling the application back. It deliberately does not restore
EXECUTE on the two retired creation functions; the accepted rollback
application already uses their source-consistent successors. Runtime-role
provisioning accepts exactly two stable states:

- clean compatible predecessor: RLS and FORCE off, zero policies;
- policyless activated state: RLS on, zero policies, FORCE either off or later
  on.

It refuses partial posture and revokes the broad table grant again inside the
provisioning transaction whenever activation is present.

## Proof and remaining release sequence

1. Complete exact-head CI and review of the promoted Phase-A migration release;
   CI applies it only to disposable PostgreSQL and proves activation, denial,
   fixed operations, rollback, restoration and tamper cases.
2. Merge that release without changing production.
3. Separately wire only that exact migration to the guarded production
   workflow.
4. Apply Phase A, converge grants, verify migration/global audit, then run the
   separate actual pooled-runtime read-only/direct-denial postflight.
5. Prepare and execute FORCE as a separate posture-only release.

No activation step is wired to the production migration workflow at this
checkpoint. Exact promoted-release details live in
`docs/checkout-stock-reservation-activation-release.md`.

## Read-only candidate package

The candidate builder
`scripts/build-checkout-stock-reservation-activation-candidate.mjs` pins the
activation draft, rollback draft and all promoted function sources; constructs
the proposed migration only in memory; and rejects policies, FORCE, row
mutations, function changes or grant expansion. It exposes only `--verify` and
cannot create a Prisma migration directory or execute a database change.

Current pins:

- activation draft SHA-256:
  `4581b79d759b8c8e3e6be9e34471514c4f4be4f93fe73887b4469ac18420bae1`;
- rollback draft SHA-256:
  `4ff20bc7eaeb8def9c8c9ef83dad204afd146a4d75c01363b91cbfdf5d1c75d1`;
- deterministic proposed migration SHA-256:
  `7940be1969c89c8bbf5818164a56afb7e8bf7925bd8a26231d8ac865fac7c519`.

The exact candidate is promoted at
`prisma/migrations/20260815060000_enable_checkout_stock_reservation_rls`.
The read-only builder itself remains unable to create files or execute a
database change; the separate staging verifier performs only deterministic
promotion and comparison.

## Proof shape

Disposable PostgreSQL executes the full boundary from the exact current
source-consistent predecessor: policyless ENABLE, direct runtime denial,
successful fixed-operation read, private-helper denial, and database-first
rollback restoring only compatible CRUD. Fail-closed tamper cases prove no
partial activation on explicit column ACLs, invalid lifecycle rows, extra
triggers, same-named index or constraint lookalikes, and leaked private-helper
EXECUTE.

The production postflight scaffold accepts only the reviewed pooled production
runtime identity, rejects owner or aliased database URLs, binds exact main-CI
and migration run IDs plus a clean release commit, and runs in an
engine-attested repeatable-read read-only transaction. It checks the exact
policyless table posture and 25-function source/owner/language/mode/ACL catalog,
proves direct table and private-helper denial, proves fixed export execution and
reaches the read-only fence through a fixed write operation. Its secret-free
evidence is fresh-create mode 0600. The scaffold is not wired to a production
workflow and has not connected to production.
