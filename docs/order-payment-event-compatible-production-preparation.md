# OrderPaymentEvent compatible production preparation

Status: isolated guarded-runner candidate. The five compatible migrations are
merged and proven in disposable PostgreSQL, but this workflow has not been
merged, dispatched, production-applied or deployed. `OrderPaymentEvent` RLS
remains off and its predecessor runtime CRUD remains intact.

## Purpose

This release installs only the database authority required by the already
merged compatible application:

1. `20260824010000_prepare_order_refund_claim_generation`, SHA-256
   `2e08ec8c8c5c8d1c6aa85f59e3d914ad8f5b401100d5e79241f3043b2a52854b`;
2. `20260824020000_prepare_order_refund_record_authority`, SHA-256
   `e1cd79da8f6a0a22668cb612c6f7d579b7af1caf431f917d69771e6b0742d505`;
3. `20260824030000_prepare_order_payment_signed_authority`, SHA-256
   `176ad2c17301dd1d6bd9a1c0e190e8d44b15463ec830f9a67eb43ec3070396f2`;
4. `20260824040000_prepare_order_refund_reconciliation_authority`, SHA-256
   `cfd5d2827eb234fb9c1b7f990b63c3e6bcc2db0dd80038cfcfd163c81314d3d7`;
5. `20260824050000_prepare_order_refund_inactive_seller_recovery`, SHA-256
   `e37d5ea925af5f4b82f90b1f1bcdeb9b14f5a4b34da7c228bdc94f8bfbbb9598`.

These migrations are additive/compatible and ordered. They preserve the old
application contract at every prefix. They do not enable or FORCE
`OrderPaymentEvent` RLS and do not revoke its predecessor table privileges.
The fourth migration creates the separate private
`OrderRefundReconciliation` evidence table as policyless ENABLE plus FORCE,
with no direct ordinary-runtime/PUBLIC CRUD.

## Exact release bindings

`.github/workflows/order-payment-event-compatible-production.yml` runs only on
manual `main`, inside the protected Production environment and the shared
`production-database-migrations` concurrency group. It requires:

- the exact 40-character workflow commit;
- a successful push-triggered full CI run for that exact main commit;
- a successful fresh `Order Payment Shipping Legacy Inspection` run for that
  exact commit; and
- exact confirmation
  `apply-reviewed-order-payment-event-compatible-authority`.

The fresh inspection must retain zero `OrderPaymentEvent` rows and zero values
for every payment/refund/dispute/replay/source/currency/amount defect family.
The independent Order-label privacy classification may remain one
privacy-redacted and zero unexplained; it is not repaired by this release.

## Restart states

The engine-read-only scope verifier accepts only these exact applied prefixes:

1. `predecessor` — none of the five rows exists;
2. `claim-prepared`;
3. `record-prepared`;
4. `signed-prepared`;
5. `reconciliation-prepared`; or
6. `prepared` — all five exact rows are applied.

Each applied row must have its sealed checksum, one applied step, a completion
timestamp and no rollback timestamp. Duplicate, failed, checksum-drifted,
unknown or non-prefix target state fails closed. The workflow also refuses to
run if any migration directory sorts after the fifth reviewed migration. This
prevents a later unrelated migration from riding the same `migrate deploy`.

The verifier checks the catalog, not only the ledger:

- `OrderPaymentEvent` remains owner-controlled, policyless RLS-off, with exact
  predecessor runtime CRUD and no PUBLIC/column/unreviewed ACL;
- the seven refund-claim columns appear only after the first migration;
- typed signed-event time appears only after the third migration;
- `OrderRefundReconciliation` appears only after the fourth migration and is
  policyless FORCE with zero direct runtime/PUBLIC CRUD; and
- every reviewed function has the exact migration-derived body, owner,
  `SECURITY DEFINER` posture where required, pinned `pg_catalog` search path and
  exact PUBLIC/runtime EXECUTE boundary. The final migration's two replaced
  function bodies are compared against the final bytes, not merely their names.

The verifier runs inside an engine-attested `REPEATABLE READ READ ONLY`
transaction. CI runs the same catalog reader against PostgreSQL 16 after the
five promoted migrations and runtime-grant convergence.

## Execution and failure behavior

After the preflight returns one accepted prefix, `prisma migrate deploy`
continues only the missing reviewed suffix. The workflow then converges the
reviewed runtime grants, verifies migration status, runs the global grant/RLS
audit and requires the exact `prepared` read-only scope.

If a migration fails, do not resolve or edit its ledger row generically. Inspect
the exact failed row and database catalog, preserve old-app compatibility, and
add a separately reviewed recovery only if the accepted-prefix verifier cannot
classify the state. The workflow is intentionally safe to rerun from any
successfully committed prefix.

Guarded run `32791937150` failed closed before `prisma migrate deploy` because
the workflow referenced a nonexistent predecessor-verifier package script. The
owner/role guard passed, but no migration, grant convergence or post-application
step ran. The corrected runner calls the existing byte-sealed
`audit:rls-seller-payout-event-force-release` command, and its workflow contract
now proves that every referenced release verifier exists in `package.json`.

## Explicit non-authority

This runner does not:

- deploy application code or call Stripe;
- change Vercel/provider variables or credentials;
- enable or FORCE `OrderPaymentEvent` RLS;
- revoke `OrderPaymentEvent` predecessor CRUD;
- activate participant projections or drain old deployments;
- mutate an Order, refund, payment event or reconciliation row; or
- bundle `Order`, `OrderItem` or `OrderShippingRateQuote` RLS.

After an accepted production preparation, deploy the converted compatible app
separately and prove the signed webhook, seller refund, blocked-checkout, staff
Case, delivery/outbox and reconciliation paths. Remaining invariants,
actor-safe projections, aggregate conversions, predecessor drain, Phase A and
FORCE remain later independent gates.
