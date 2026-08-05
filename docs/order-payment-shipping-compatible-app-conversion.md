# Order, Payment, and Shipping Compatible Application Conversion

Status: isolated stacked candidate; not merged, deployed, or applied to
production.

Date: 2026-08-05

## Exact predecessor and release boundary

This candidate is stacked on the verified compatible-preparation head
`2b624afe219bc982dd0945284895326ee6893a1e` from draft PR `#160`. That
predecessor contains migration
`20260805012000_prepare_order_payment_shipping_compatibility`, whose SHA-256 is
`29f56fa82b68c743e0d081324c5caa9795f0dd0d43e8d0ed42acd28311ef03d3`.

The application candidate must not deploy until that exact preparation
migration, or a separately reviewed byte-identical successor, is live and its
pooled-runtime production postflight passes. The preparation intentionally
retains the predecessor table grants and RLS posture so old and new app
instances can coexist during deployment.

This is the first application checkpoint for the two capabilities installed by
the preparation migration. It is not the complete Order/OrderItem/payment/
shipping authority conversion and does not authorize RLS, grant revocation,
`NOT NULL` convergence, cleanup or a provider mutation.

## Generation-bound Stripe event lifecycle

Both signed Stripe entry points now call the three prepared fixed functions:

- `grainline_stripe_webhook_begin(event_id,event_type)` returns the database-
  issued action and claim generation;
- `grainline_stripe_webhook_complete(event_id,claim_generation)` finalizes only
  the exact current generation; and
- `grainline_stripe_webhook_fail(event_id,claim_generation,sanitized_error)`
  releases only the exact current generation.

The application accepts exactly one typed result row. A `process` result must
have a positive generation. A superseded completion fails closed and therefore
cannot return webhook success from a stale worker. A superseded failure is a
safe terminal result because the stale worker must not clear the newer lease.
Existing processed predecessor rows may legitimately return generation zero;
they never reach a finalizer.

Stripe signature verification remains the ingress trust boundary. The fixed
database functions protect row lifecycle, replay identity, type immutability
and stale-worker finalization; they do not independently authenticate a Stripe
payload.

The legacy `checkout-stock-restore:<session>` dedup path uses the same prepared
begin/complete lifecycle inside its already-held checkout-session advisory lock
and the surrounding stock-restore transaction. The claim, completion and stock
update therefore commit or roll back together. The catalogued dedicated
`grainline_legacy_stock_restore_claim` operation remains an explicit later
activation prerequisite before direct `StripeWebhookEvent` grants are revoked;
the current reuse is compatibility-only and is not represented as completion
of operation 36.

## Durable seller-key dual write

The paid checkout webhook now derives exactly one complete seller profile ID
from the resolved paid-checkout source, locks the referenced seller rows during
finalization, and writes the key explicitly to:

- cart-checkout `Order.sellerProfileId`;
- every cart-checkout `OrderItem.sellerProfileId`;
- single-listing `Order.sellerProfileId`; and
- the nested single-listing `OrderItem.sellerProfileId`.

Missing, blank or mixed seller identities fail before Order creation. The
database trigger derives every item key again from the current Listing inside
the transaction, and the composite foreign keys remain the final authority: an
ownership change or caller mismatch is rejected even if the resolved checkout
state was stale. Historical display fields continue to come from
`listingSnapshot`; the durable seller key is an authorization/join key, not
mutable catalog display data.

## Coexistence and rollback

Old app instances may continue their predecessor direct webhook-event writes
while the preparation table grants remain in place. New instances require the
prepared functions and seller columns. Therefore the allowed order is:

1. merge and apply compatible preparation;
2. pass the pooled-runtime preparation postflight;
3. deploy this compatible application candidate;
4. prove both webhook destinations, checkout finalization and stock restore;
5. drain old deployment overlap; and only then
6. prepare the remaining fixed operations, revoke predecessor table authority,
   converge seller keys to `NOT NULL`, and activate RLS in reviewed boundaries.

Rolling back this application candidate is safe while the predecessor grants
and nullable columns remain. Removing the preparation migration underneath a
mixed or converted app deployment is forbidden.

## Verification contract

The candidate must keep all of the following green:

- focused app-conversion, Stripe route, event-state, checkout-finalization and
  stock-reservation tests;
- pure result-parser tests for invalid row count, invalid action/generation,
  generation-zero processing, superseded completion and superseded failure;
- TypeScript and lint;
- the complete local test suite;
- the disposable PostgreSQL preparation/lease/invariant proofs inherited from
  PR `#160`; and
- a production build in exact-head CI.

No test, commit or CI result on this branch changes production state.
