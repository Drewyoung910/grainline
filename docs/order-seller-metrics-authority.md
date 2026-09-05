# Order seller metrics authority

Status: isolated compatible preparation only. No production migration, RLS
posture, predecessor table grant, provider state or row data has changed.

Prepared: 2026-09-01

Migration:
`20260901070000_prepare_order_seller_metrics_authority`

## Product decision before RLS

Guild Master scoring is a product trust decision, not merely an Order query to
hide behind RLS. The audit preserved the published thresholds and the existing
refund policy, but found one historical-authority defect: completed sales and
on-time shipping were attributed through the purchased Listing's current
seller. A later Listing ownership change could therefore remove or add old
sales to a seller's Guild score.

Historical order facts now bind to the checkout-time
`Order.sellerProfileId` and `OrderItem.sellerProfileId` keys. Listing ownership
is not consulted. Private/custom purchases remain eligible by deliberate
policy because they are real paid work; the fixed operation does not expose
the Listing or whether it is private.

The retained metric meanings are:

- completed sales are paid, Stripe-backed, non-refunded, non-blocked Orders in
  `DELIVERED` or `PICKED_UP` state;
- total sales are the sum of the seller's durable OrderItem price times
  quantity for those completed Orders, excluding shipping and tax as before;
- shipping rate uses paid, non-refunded, non-blocked Orders shipped during the
  selected window with a processing deadline; and
- on time means `shippedAt <= processingDeadline`.

The current product requests a fixed 90-day shipping window. The database
accepts at most 400 days so a future 12- or 13-month maintenance run is bounded
without exposing an unbounded aggregate.

## Authority shape

`grainline_order_seller_metrics_facts(text,bigint)` returns exactly one
low-dimensional row for an existing SellerProfile:

- seller profile ID;
- completed order count;
- total sales cents;
- shipped count; and
- on-time count.

It is a purpose-bound service aggregate because the guild cron and staff
verification workflows must recalculate sellers other than the signed-in
actor. It is therefore not actor-bound like the seller dashboard analytics
functions. This is an intentional narrow exception: the function returns no
Order ID, buyer ID, contact detail, address, provider ID, Listing identity or
timeline row, validates a bounded seller ID and period, and grants execution
only to `grainline_app_runtime` after revoking `PUBLIC`.

The TypeScript boundary validates cardinality, identifiers, safe integers and
`onTimeCount <= shippedCount` before the values reach Guild logic. The existing
transaction-scoped advisory lock still serializes refreshes. The subsequent
`SellerMetrics` upsert remains direct and is not claimed as solved by this
cohort; `SellerMetrics` is a separate RLS/maintenance-write boundary.

## Proof and release boundary

Disposable PostgreSQL proves:

- listing reassignment cannot rewrite historical seller attribution;
- paid/refund/block/completion rules are retained;
- the period applies only to shipping while completed sales remain all-time;
- unknown and malformed sellers fail closed;
- periods beyond the bound fail closed; and
- runtime has EXECUTE while `PUBLIC` does not.

The release verifier byte-pins migration SHA-256
`bc555f857d7fc253bd84cb01913cda5001e42d3328b4042e4945e35745b8c336`
and tree SHA-256
`ab1b2c2f91dc62aa41007b145ba7a3c9acce9505b837004a1900c12d79f11171`.
CI isolates this successor before replaying every historical Order and
OrderPaymentEvent release, then restores, applies and proves the complete
compatible stack in disposable PostgreSQL.

This candidate reduces the current direct source inventory from 29 to 28
Order files and from 5 to 4 OrderItem files. It does not activate Order RLS,
revoke predecessor CRUD, migrate `SellerMetrics`, deploy, or touch production.

## 2026-09-05 application continuation

The Guild Member staff approval path now reuses this fixed projection instead
of joining Order, OrderItem and mutable Listing ownership directly. Its $250
completed-sales requirement is unchanged, while historical seller attribution
now matches the same durable keys used by Guild Master scoring. A missing or
mismatched projection fails closed. In the stacked Order candidate this moves
the direct inventories from 10 to 9 Order files and from 4 to 3 OrderItem
files. No migration, deployment, RLS posture or production state changed.
