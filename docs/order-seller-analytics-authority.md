# Order seller analytics authority

Status: isolated compatible preparation only. No production migration, RLS
posture, predecessor table grant, provider state or row data has changed.

Prepared: 2026-09-01

Migration:
`20260901060000_prepare_order_seller_analytics_authority`

## Why this is a separate authority family

Seller analytics needs private commercial facts, but it does not need an
unbounded `Order` or `OrderItem` reader. The authenticated application user is
bound to `SellerProfile.userId` inside PostgreSQL, seller ownership is derived
from the durable `Order.sellerProfileId` and `OrderItem.sellerProfileId` keys,
and each function returns one fixed aggregate or bounded projection.

This family converts:

- seller revenue, order, buyer, repeat-buyer, processing and cart-abandonment
  summary metrics;
- bounded revenue/order chart buckets;
- the eight most active seller listings;
- the ten most recent non-refunded sales; and
- the account-page completed-order count.

It did not originally cover Guild/service scoring in `src/lib/metrics.ts`.
That Order-facts query is now the immediately following isolated
`20260901070000_prepare_order_seller_metrics_authority` cohort; see
`docs/order-seller-metrics-authority.md`. The `SellerMetrics` maintenance
write, staff analytics, Order mutation state machines and lifecycle repair
remain separate named-operation cohorts rather than receiving generic table
access.

## Product-logic audit findings and corrections

This conversion included a fresh behavior audit rather than mechanically
moving the existing queries behind a database function.

### Recent-sale representative item

The previous recent-sales query selected one item without an explicit item
ordering. A multi-item Order could therefore show a different title across
plans or executions. The fixed projection selects the first item by
`OrderItem.createdAt ASC, OrderItem.id ASC`, and the PostgreSQL proof asserts
that stable result.

### Cart abandonment

The previous dashboard counted a surviving cart item as abandoned as soon as
it fell inside the selected date range. That mislabeled recent carts and could
let a purchase made before the cart addition cancel a later cart. The fixed
summary now requires the cart item to be at least 24 hours old and considers it
converted only when a qualifying paid, non-refunded Order for the same buyer,
seller and listing was created at or after that cart item.

This remains a current-cart approximation, not a complete abandonment event
ledger: removing a cart item removes it from the observable population. The UI
therefore labels the measure as current cart items unpurchased for 24 or more
hours.

### Save and back-in-stock counts

`Favorite` and `StockNotification` are current subscription rows, not immutable
event histories. Their selected-range counts mean surviving subscriptions
created during the range; an unsubscribe is no longer countable. The UI copy
now says "current saves added this period" and "current watchers added this
period". A future historical engagement ledger would be required before
calling these all save/watch events.

### Repeat-buyer scale

The previous route returned buyer IDs to application memory and grouped them
in JavaScript. The fixed summary aggregates only buyer counts inside
PostgreSQL and returns no buyer identity. This removes an unbounded private-ID
result and reduces application memory growth.

### Top-listing scale

The top-listing function uses set-based aggregate CTEs for sales, daily views,
favorites and watchers, combines them once, applies deterministic ordering and
returns at most eight rows. It does not run one raw Order query per listing.

## Preserved commercial semantics

The existing seller dashboard excluded any Order with a recorded seller/staff
refund or the database-maintained refund-blocked projection. This candidate
preserves that rule consistently across summary, buckets, top listings, recent
sales and completed-order count. The dashboard already describes revenue as
excluding refunds. Changing to net partial-refund accounting would require an
explicit product decision and a separately proved aggregate contract; it is
not silently introduced by RLS work.

## Security and cost bounds

The five fixed functions:

- are `SECURITY DEFINER` with `search_path = pg_catalog`;
- revoke default `PUBLIC` execution and grant only the reviewed runtime role;
- derive the seller from the authenticated application-user ID;
- accept no seller profile ID or result target from the caller;
- validate time ranges and chart groupings;
- cap range spans, result counts and ordering; and
- expose no address, provider identifier, staff note or buyer ID.

The recent-sales projection suppresses buyer name and email after buyer-data
purge or account deletion. The TypeScript parser rejects inconsistent privacy
states, unexpected cardinality, oversized results, invalid dates, unsafe
integers, invalid currencies and unknown fulfillment statuses.

## Proof and release boundary

Disposable PostgreSQL coverage proves actor binding, cross-seller no-row
behavior, refund exclusion, aggregate repeat buyers, corrected abandonment,
deterministic item selection, PII suppression, top-listing scope, input
rejection and exact grants. Release verification byte-pins the migration and
its full predecessor tree.

This candidate reduces the direct source inventory from 31 to 29 `Order`
files and from 6 to 5 `OrderItem` files. That is progress toward activation,
not an activation claim. Order RLS remains blocked on the remaining read,
maintenance and write families, final seller-key/snapshot convergence,
compatible deployment and predecessor drain.
