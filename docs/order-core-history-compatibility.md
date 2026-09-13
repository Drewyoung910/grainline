# Core Order historical-authority compatibility

Status: isolated compatible-application candidate. This package contains no
database migration, policy, grant, deployment, provider, credential or
production-state change.

Audited base: `c4e861a30c993909703e3f47876fd56c95b11af6`

Prepared: 2026-08-31

## Purpose

The core Order audit found that historical order pages and several seller
authorization checks still depended on the current `Listing` row. That is the
wrong boundary for retained transactions: a later title, image, processing
time, seller-profile or catalog-visibility change must not rewrite who owns an
Order or what the parties bought.

This candidate makes two compatible corrections before any Order RLS
activation:

1. seller authority is derived from the checkout-bound
   `Order.sellerProfileId`; and
2. historical item presentation is derived from the checkout-time
   `OrderItem.listingSnapshot`.

The current Listing remains optional catalog context only. Buyer and seller
detail pages consult its current status solely to decide whether the retained
historical title should link to a currently active listing. It does not decide
Order ownership and supplies no historical title, image, seller name or
processing estimate.

## Snapshot contract

`readHistoricalOrderItemSnapshot()` is the one application reader for retained
item facts. It accepts only bounded fields, rejects malformed required values
and returns a generic safe representation for predecessor/null snapshots:

- title: `Purchased item`;
- seller: `Maker`;
- image: none; and
- price: the immutable `OrderItem.priceCents` column.

It never falls back to mutable Listing content. A safe generic historical row
is preferable to silently rewriting a receipt from the live catalog.

Both paid webhook creation paths now add listing type and processing/ship
timing to new snapshots. The development-only Order fixture also writes the
durable Order and item seller keys plus the complete modern snapshot. Existing
snapshots remain readable; missing new timing fields render without an
invented processing estimate.

## Converted consumers

Historical snapshot rendering:

- checkout success receipts, including multi-seller receipt groups;
- buyer account overview and both buyer order lists;
- buyer Order detail;
- seller sales list and seller Order detail; and
- staff Order list and detail;
- recent-sales analytics titles; and
- retryable post-payment notifications and transactional emails.

Durable seller/buyer predicates:

- buyer and seller detail lookups bind the actor in the query;
- seller order lists, counts, recent-sales analytics and account export;
- fulfillment, label and seller-refund authorization preflights;
- account deletion and ban lifecycle paths;
- report target visibility;
- verification sales totals and seller analytics; and
- review eligibility returns the checkout-bound OrderItem seller; and
- retryable webhook seller identity and first-sale counting.

These are compatible reductions in authority and joins. Direct Order access
still exists and remains pinned by `tests/order-core-pre-rls-audit.test.mjs`;
the fixed database projection/write conversion is the next phase.

## Explicitly not solved here

- No production snapshot inspection or cleanup is authorized.
- No legacy row is rewritten.
- Account export continues to include shipping-rate quote rows because its
  existing tested export contract requires a separate privacy/product
  decision. That boundary is handled with `OrderShippingRateQuote`, not hidden
  inside this compatibility patch.
- Current active-listing links remain optional catalog reads.
- Staff projections, public aggregates, maintenance jobs and every Order write
  family still need named fixed database operations.
- `Order.sellerProfileId` and `OrderItem.sellerProfileId` remain nullable until
  a fresh aggregate-only production inspection proves the convergence input.
- Order RLS remains off. Policyless ENABLE and FORCE remain distinct later
  production releases.

## Next gates

1. Merge and deploy this compatible application through the normal source and
   predecessor-overlap checks.
2. Run an aggregate-only inspection of snapshot shape and durable seller-key
   completeness; stop on any unclassified row.
3. Prepare and prove the seller-key `NOT NULL` convergence separately.
4. Build actor-specific Order list/detail/export/aggregate functions and
   family-specific source-validating writes.
5. Reach zero ordinary-runtime direct Order access.
6. Deploy the compatible fixed-operation application and drain incompatible
   predecessors.
7. Activate policyless Order RLS, prove the pooled runtime, then enable FORCE
   in a separate release.
8. Continue immediately with separate `OrderItem` and
   `OrderShippingRateQuote` releases.
