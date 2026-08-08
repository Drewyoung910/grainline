# Stripe webhook maintenance-authority candidate

Status: isolated stacked candidate only. This branch is not merged, deployed or
applied to production. It depends on the exact Order/payment/shipping
compatibility preparation in draft PR #160 and the compatible application
conversion in draft PR #161.

## Exact release boundary

- migration: `20260805040000_prepare_stripe_webhook_maintenance_authority`
- migration SHA-256:
  `0c34cc94f6a602e8f686487277b422f3ba4e89a1f2c50b9b3b673cb63d259df5`
- migration-tree SHA-256:
  `551be631510a20c58eae7b1e84f84d23890d5c2e82b0d1332c7f9f266744f22d`
- guarded phase: `stripe-webhook-maintenance-authority-reviewed`
- draft PR: `#162`
- green implementation head: `8a6b2e7899f2b568ccce710f9c4f04c96c2a8d62`
- green exact-head CI: `30975260896`

This is compatible preparation, not RLS activation. It creates exactly three
fixed `SECURITY DEFINER` functions, revokes `PUBLIC`, grants their exact
signatures to `grainline_app_runtime`, and leaves all StripeWebhookEvent table
grants and RLS posture unchanged. No row data is rewritten by the migration.

## Fixed authority

`grainline_stripe_webhook_prune_batch(integer)` derives a 90-day cutoff from
the PostgreSQL UTC clock, clamps the batch to 1,000 and deletes only processed
rows in stable `(processedAt,id)` order under `FOR UPDATE SKIP LOCKED`. The
caller supplies neither IDs nor a cutoff. It deliberately retains the finite
legacy `checkout.session.stock_restored` claim class indefinitely: deleting
those dedup rows would permit a buyer-held old Checkout Session to replay a
second inventory restoration after the general retention window.

`grainline_stripe_webhook_health_summary()` returns only four aggregate counts
over a fixed two-minute stale-lease window. It cannot expose event IDs, event
types, errors or provider payloads.

`grainline_legacy_stock_restore_claim(text)` accepts only canonical Stripe
Checkout session IDs, derives the `checkout-stock-restore:` identity and fixed
event type inside PostgreSQL, takes the same transaction-scoped checkout lock,
and atomically returns first-claim versus replay. A collision with another type
or an unfinished row fails closed.

The application routes pruning, ops-health aggregation and the legacy stock
restore dedup operation through these functions. Ordinary application source
no longer performs direct StripeWebhookEvent maintenance reads, inserts or
deletes. Predecessor table grants deliberately remain during mixed-deployment
coexistence and must not be described as revoked until a later activation.

## Verification and remaining gates

The candidate is byte-pinned by its release verifier and deploy guard. Its
loopback-only PostgreSQL proof validates exact function ownership, search path,
grants, pruning boundaries, fixed health counts, canonical replay identity,
invalid collision rejection, advisory-lock waiting and complete rollback with
zero residue. CI runs the verifier, special-form regression test and disposable
PostgreSQL proof.

Initial exact-head CI run `30974931167` stopped before the new proof because the
historical lease proof counted every function whose name began with
`grainline_stripe_webhook_`. The successor migration correctly increased that
prefix count from three to five. The historical proof now identifies only its
three exact lease function signatures with `oidvectortypes(proargtypes)`, so it
continues to prove its own boundary without treating reviewed successor
functions as drift. No production state was involved in the failed run.

Follow-up exact-head CI run `30975112231` passed that historical proof and then
stopped when the new PostgreSQL proof re-ran the complete deployment-tree guard
after CI had intentionally isolated the Case FORCE migration for later rollback
proofs. The release verifier remains the pre-isolation whole-tree gate. The
engine proof now invokes a separately named byte verifier for only its exact
maintenance migration, then proves the promoted functions from PostgreSQL's
catalog. This avoids treating CI's temporary proof workspace as a deployable
tree without weakening either boundary. Production was not involved.

Run `30975260896` then passed the prior exact release/tree verifiers, the historical
lease proof, the new 14-check maintenance catalog/behavior/concurrency proof,
the pooled-runtime compatibility proofs, all global RLS/grant audits,
TypeScript, lint, the full test suite, dependency audit and production build.
That run proves the implementation head above; the release remains a draft
stacked candidate and was not merged, deployed, migrated or applied to any
provider or production state.

The later Extra-High activation review correctly superseded that exact
maintenance migration byte by excluding permanent legacy stock-restore dedup
claims from general 90-day pruning. Deleting one of those rows could permit an
old buyer-held Checkout Session to restore inventory a second time. Fresh
exact-head CI is therefore required before this candidate can move.

Before StripeWebhookEvent RLS or table-grant revocation, the stacked preparation
and application candidates must merge and deploy in order, production webhook
destinations and legacy stock restoration must be proven, and old deployment
overlap must drain. Order, OrderItem, CheckoutStockReservation, payment and
shipping functions remain separate later authority groups; this candidate does
not claim their completion.
