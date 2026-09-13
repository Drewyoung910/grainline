# Order public aggregate authority

Status: isolated compatible preparation only. The migration is not applied in
production and does not enable RLS, revoke predecessor table grants, mutate
rows, deploy application code or change provider state.

Prepared: 2026-09-01

## Decision

Public marketplace counters and public seller/listing quality summaries do not
need an `Order` row. They now use four named aggregate operations whose source
filters and result shapes are fixed inside PostgreSQL:

- `grainline_order_public_fulfilled_count()` returns one marketplace count;
- `grainline_order_public_seller_stats(text,bigint)` returns only sold count,
  recent shipped count and average ship days for a publicly eligible seller;
- `grainline_order_public_listing_counts(text[])` returns one count per visible
  requested listing for a unique batch of at most 200 IDs; and
- `grainline_order_public_marketplace_listing_metrics()` returns only total
  visible-listing views, clicks and purchased-item count.

The word `public` describes the product data class. It does not grant database
execution to PostgreSQL `PUBLIC`: every function revokes that default and
grants execution only to `grainline_app_runtime` during the compatible period.

## Authority and privacy boundary

No operation returns an Order ID, participant identity, address, provider
identifier, gift data, refund identifier or row-shaped payload. Seller and
listing visibility is derived inside PostgreSQL from current public catalog
state. Listing and marketplace quality counts additionally exclude refunded,
refund-blocked and conversion-dispute-blocked Orders. The homepage fulfilled
count and public seller history deliberately preserve their existing broader
marketplace semantics while still exposing only aggregates.

The listing function validates a non-empty, unique, bounded ID batch on both
the TypeScript and PostgreSQL boundaries. Public seller stats return no row for
an ineligible seller, allowing the application to preserve a public zero/null
fallback without revealing a hidden profile through Order history.

## Application conversion

The following consumers no longer directly read `Order`:

- `src/lib/homepageStats.ts`;
- `src/lib/publicSellerStats.ts`;
- `src/lib/quality-score.ts`; and
- `src/lib/site-metrics-snapshot.ts`.

Three of those files also stop directly reading `OrderItem`. The direct source
inventories move from 35 to 31 files for `Order` and from 9 to 6 files for
`OrderItem`. The semantic payment inventory continues to retain the converted
call sites plus the shared authority hub so indirection cannot erase them from
future reviews.

## Proof and release boundary

`tests/order-public-aggregate-authority-postgres.test.mjs` applies the exact
migration to disposable PostgreSQL-compatible storage and proves public
visibility, hidden-seller denial, refund/dispute exclusion, batch validation,
function grants and unchanged RLS posture. Strict state, application-contract,
byte/tree release and global grant-inventory tests keep those boundaries
fail-closed.

This is one compatible-preparation cohort, not `Order` activation. Seller-only
analytics, maintenance/repair operations and all mutation state machines remain
separate named-operation cohorts before predecessor table authority can be
revoked and policyless RLS can be enabled.
