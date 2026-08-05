# Stripe webhook maintenance-authority candidate

Status: isolated stacked candidate only. This branch is not merged, deployed or
applied to production. It depends on the exact Order/payment/shipping
compatibility preparation in draft PR #160 and the compatible application
conversion in draft PR #161.

## Exact release boundary

- migration: `20260805040000_prepare_stripe_webhook_maintenance_authority`
- migration SHA-256:
  `407707e05a803cded0036c301141fb665c3a0f1b25b114a78f9188b0e52c62d8`
- migration-tree SHA-256:
  `09453990d08bd8b95c49b05e198fea42ae0145fbb566a8ea77f31af001c72212`
- guarded phase: `stripe-webhook-maintenance-authority-reviewed`

This is compatible preparation, not RLS activation. It creates exactly three
fixed `SECURITY DEFINER` functions, revokes `PUBLIC`, grants their exact
signatures to `grainline_app_runtime`, and leaves all StripeWebhookEvent table
grants and RLS posture unchanged. No row data is rewritten by the migration.

## Fixed authority

`grainline_stripe_webhook_prune_batch(integer)` derives a 90-day cutoff from
the PostgreSQL UTC clock, clamps the batch to 1,000 and deletes only processed
rows in stable `(processedAt,id)` order under `FOR UPDATE SKIP LOCKED`. The
caller supplies neither IDs nor a cutoff.

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

Before StripeWebhookEvent RLS or table-grant revocation, the stacked preparation
and application candidates must merge and deploy in order, production webhook
destinations and legacy stock restoration must be proven, and old deployment
overlap must drain. Order, OrderItem, CheckoutStockReservation, payment and
shipping functions remain separate later authority groups; this candidate does
not claim their completion.
