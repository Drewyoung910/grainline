# CheckoutStockReservation compatible authority release

Status: isolated CI candidate; production-inert.

This release packages the reviewed CheckoutStockReservation fixed-operation
authority without activating reservation RLS or removing predecessor table
access. It is the database-first half of a deployment-compatible cutover: the
current application can continue using direct reservation CRUD while the later
application release uses the fixed functions.

## Exact candidate

- migration: `20260810190000_prepare_checkout_stock_reservation_authority`
- migration SHA-256:
  `89a0772a7ac03e768dbb60d771973eb2511c68851beb860a7067aabe2485efc8`
- reviewed draft SHA-256:
  `08c3bd9c5861041b4194f46134e72c8a509fdd2bf28356ccc5c5f1c20dc7b9f3`
- migration-prefix SHA-256:
  `f6acf39fedac8e7b5b30d6fa38f73a0cafc43dffa6aed892f4c270325076debb`
- guarded phase: `checkout-stock-reservation-authority-reviewed`
- fixed runtime surface: 15 reservation operations plus the source-bound
  three-argument Stripe webhook begin overload
- private surface: reservation item validator, normalization trigger,
  stock-restoration helper, and Stripe source binder

## Compatibility boundary

The migration adds `StripeWebhookEvent.sourceObjectId`, five reservation repair
fields, scalar validation constraints, private trigger-enforced item-shape
validation, an active-lock uniqueness index, a repair-claim index, and the
fixed functions. It does not enable or FORCE
CheckoutStockReservation RLS, create reservation policies, revoke predecessor
reservation table/column privileges, deploy application code, clean data, or
change Stripe, Vercel, Neon, Redis, or other provider state.

The migration itself refuses to run until the separate StripeWebhookEvent FORCE
release is already present: the event ledger must have ENABLE plus FORCE, zero
policies, no ordinary-runtime table authority, the reviewed owner, and a
LOGIN/NOINHERIT/NOBYPASSRLS runtime role with only the reviewed non-effective
Neon bootstrap membership. It also pins the predecessor two-argument webhook
begin function body and ACL, rejects PUBLIC/column authority, drains other
owner sessions, and takes bounded advisory/table locks. CheckoutStockReservation
must still be the clean
predecessor with RLS/FORCE off, zero policies, broad runtime CRUD, none of the
new fields, and no three-argument webhook-begin overload. This prevents one
dispatch from silently collapsing two independently reviewed production
boundaries.

CI moves the candidate migration out of the tree while it proves all earlier
compatibility, activation, FORCE, rollback, and grant contracts. Only after the
StripeWebhookEvent FORCE proof succeeds does CI restore and apply this exact
migration, converge the fixed grants, audit the global catalog, and run the
disposable reservation authority proof.

The production migration workflow remains intentionally unwired at this
checkpoint. Consequently, merging or testing this branch cannot make the
guarded production runner apply the reservation migration. Wiring that runner,
merging, dispatching, deploying the compatible app, draining predecessor app
versions, enabling reservation RLS, and applying FORCE are all later separate
boundaries.

## Required pre-production gates

1. Complete CI, including exact-tree verification, real PostgreSQL migration
   application, grant convergence, global catalog audit, and authority proof.
2. Independently review the promoted SQL/function catalog at Extra High.
3. Apply the already-merged StripeWebhookEvent FORCE release separately and
   accept its actual pooled-runtime production postflight.
4. Rerun the aggregate-only reservation legacy inspection. The accepted
   2026-08-05 inspection found zero reservation rows, but it is historical and
   cannot prove the later production predecessor is still clean.
5. Only then wire and separately authorize this exact compatible preparation
   in the guarded production workflow.
6. Deploy and smoke the fixed-operation application, drain predecessor
   versions, prove zero direct reservation access, then prepare policyless
   ENABLE and later FORCE as distinct releases.

No item in this document authorizes a production mutation.
