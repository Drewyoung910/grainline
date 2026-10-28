# Favorite Pre-RLS Domain Audit

Date: 2026-10-28  
Source: `857bc94706913a4d5c4368afa99de0a55bb2437c`  
Status: compatible preparation proved; no Favorite RLS or table-grant change is authorized yet

## Intended Product Behavior

`Favorite` is a user's private saved-listing state. A signed-in, active user may
save an available public listing owned by somebody else when neither party has
blocked the other. Saving the same listing twice is idempotent. Removing a save
is also idempotent. The listing's maker may receive one source-bound
notification, but must not receive a list or export of everyone who saved the
listing.

The marketplace intentionally uses aggregate favorite state in discovery,
ranking and seller analytics. Those aggregate uses do not make the underlying
`userId`/`listingId` pairs public.

No product workflow updates a Favorite row. The only valid row mutations are
insert and delete. `createdAt` is immutable.

## Schema And Current Authority

`Favorite` has a composite primary key `(userId, listingId)`, an index on
`listingId`, cascading foreign keys to `User` and `Listing`, and `createdAt`.
RLS is off. The ordinary runtime role still receives broad table CRUD through
the predecessor provisioning block.

The table itself does not enforce these application invariants:

- the actor is active;
- the listing is public and orderable;
- the actor is not the listing owner;
- neither party has blocked the other;
- `createdAt` is immutable.

The POST route checks those rules before its upsert, but the checks and write
are not one database operation. The row can therefore be inserted after a
concurrent listing-visibility or block change. The notification authority does
perform its own locked, source-bound validation and will refuse a blocked or
unavailable source, so this race does not create a forbidden notification.

## Complete Current Consumer Inventory

### Owner state and owner history

Nineteen application source files contain direct Favorite operations or
Favorite relation-count/order dependencies. Direct owner-state reads currently
occur on:

- the homepage;
- browse results and browse fallback results;
- metro and metro/category pages;
- tag pages;
- seller profile and seller shop pages;
- listing detail and its "more from this maker" cards;
- recently viewed listings;
- the account feed;
- account export.

The account saved-listing count/page already uses the actor-bound
`grainline_seller_owner_saved_listing_count()` and
`grainline_seller_owner_saved_listing_page(integer, integer)` authorities.
Those functions validate transaction-local `app.user_id`, reciprocal blocks,
public listing state and seller availability.

### Owner writes

- `POST /api/favorites` resolves the authenticated local user, validates the
  public target and reciprocal block state, performs an idempotent upsert, and
  requests a source-bound `NEW_FAVORITE` notification.
- `DELETE /api/favorites/[listingId]` resolves the authenticated local user and
  performs an idempotent owner/listing delete.
- Both routes use the save-action rate limit: 100 actions per rolling hour.

### Cross-user cleanup and lifecycle

- Account deletion deletes every Favorite owned by the target user inside the
  target-user contextual transaction.
- Seller listing archive deletes all Favorite rows for that listing before
  returning success.
- Staff listing removal deletes all Favorite rows for that listing inside the
  PIN-protected admin transaction.
- Hard User and Listing deletes have cascading foreign keys. These cascades
  must be proved under the final FORCE posture rather than assumed.

### Aggregates, ranking and service readers

- Browse and seller-shop "popular" ordering use raw relation counts.
- Browse fallback ordering uses raw relation counts.
- Seller dashboard and inventory rows display raw relation counts.
- Seller analytics directly count current Favorite rows whose `createdAt`
  falls in the requested range.
- `grainline_order_seller_analytics_top_listings(...)` reads Favorite for the
  seller's bounded analytics projection.
- `grainline_user_public_listing_favorite_counts(text[])` returns bounded
  public counts used by the quality-score job. It excludes banned/deleted
  users and reciprocal blocks.
- `grainline_notification_create_core(...)` reads the exact Favorite source
  before creating a maker notification. Its User-pair locks and fresh block
  check serialize correctly with block/unblock and account deletion.

### Indirect relation dependencies

Prisma relation-count and relation-order expressions on `Listing` depend on
Favorite visibility even when the application source never names a separate
Favorite query. An owner-only policy applied before converting those
expressions would silently produce zero, one-user-only, or incorrectly ordered
results rather than a clear access error.

## Authority Matrix

| Operation | Principal | Intended scope | Final authority shape |
| --- | --- | --- | --- |
| Read saved state for bounded listing IDs | active owner | own rows only | transaction-local owner operation |
| Read saved-listing page/count | active owner | own visible rows only | retain existing actor-bound functions |
| Export save history | active owner | own rows, bounded listing projection | owner export operation |
| Add favorite | active owner | eligible non-owned listing, no reciprocal block | one atomic guarded operation |
| Remove favorite | active owner | own exact row | owner delete operation |
| Account deletion | deletion worker acting as target | all target-owned rows | target-context delete-all operation |
| Seller listing archive | verified listing owner | all rows for exact owned listing | fixed seller cleanup operation |
| Staff listing removal | PIN-verified admin | all rows for exact listing | fixed admin cleanup operation |
| Public current count | anonymous or signed-in viewer | aggregate only, never user IDs | public projection/counter |
| Seller totals and range count | verified seller | aggregate for owned listings | seller-bound aggregate operation |
| Quality score | scheduled service | eligible aggregate for bounded IDs | retain bounded service function |
| Notification source proof | notification service | exact row and actor/recipient relation | retain source-bound function |

No ordinary principal needs direct UPDATE. No public or seller principal needs
direct access to the user/listing pairs.

## Correctness, Privacy And Scale Findings

### FAV-RLS-1: the write invariant is check-then-write

Classification: `FIX_BEFORE_ACTIVATION`.

The favorite target and reciprocal block checks happen before the upsert in
separate statements. A concurrent block or listing visibility transition can
leave a row that the current product rules would not admit. The activation
design must validate and insert under one lock order, or use a trigger whose
predicate and lock protocol are proved against block/listing changes.

### FAV-RLS-2: aggregate semantics are inconsistent

Classification: `BLOCKS_RLS_DESIGN`.

Raw Prisma counts include every existing Favorite. The bounded public count
function excludes banned/deleted users and reciprocal blocks. Enabling an owner
policy without choosing an aggregate contract would change ordering and
metrics silently.

The security release should preserve today's raw-current-row semantics for
visible raw counters and "popular" ordering, while retaining the stricter
eligible count used by quality scoring. Any product change that makes all
surfaces use one eligibility definition should be separate and explicitly
reviewed.

### FAV-RLS-3: public ordering is coupled to private rows

Classification: `BLOCKS_RLS_DESIGN`.

Browse and seller-shop pagination order by the relation count before rows are
selected. A post-query count helper cannot preserve this order. The count must
be projected onto a public-safe relation or the entire filtered/paginated query
must move behind a fixed database operation.

### FAV-RLS-4: seller analytics is not an event ledger

Classification: `DEFERRED_PRODUCT_WORK`.

"Favorites" for a date range means Favorite rows that still exist and whose
creation time is in the range. An unfavorite removes the row, so the metric is
not historical favorite activity. RLS must preserve this existing definition;
a durable engagement-event ledger is a separate analytics feature.

### FAV-RLS-5: saved-listing pagination has a finite ceiling

Classification: `DEFERRED_PRODUCT_WORK`.

The route rate limit permits long-term accumulation, while the current saved
page authority caps offset at 23,976 (1,000 pages of 24). This is far above
normal use and does not block activation, but scale monitoring should alert
before any account approaches the ceiling.

## Concurrency And Recovery Requirements

- Add/remove replay must remain idempotent.
- Add must serialize with reciprocal block creation, listing archive/removal,
  seller availability changes that make the target ineligible, and account
  deletion.
- Listing cleanup must be all-or-nothing with the visibility transition.
- Counter maintenance, if selected, must cover single deletes, bulk deletes,
  foreign-key cascades and transaction rollback.
- A repair/reconciliation query must compare projected counts with Favorite
  rows and fail closed on drift before activation and after rollback.
- Rollback must restore predecessor grants and direct application behavior
  before disabling/removing any new owner boundary.

## Required Behavior Proof

The acceptance suite must run against the complete migrated PostgreSQL 17
schema and prove at least:

1. owner A cannot select or delete owner B's rows;
2. signed-out and no-context operations fail closed;
3. active owner add/remove/replay behavior;
4. self-favorite, private/inactive listing, banned/deleted actor, unavailable
   seller and reciprocal-block rejection;
5. block-vs-add and archive-vs-add races in both schedules;
6. account deletion and User cascade cleanup;
7. seller archive, staff removal and Listing cascade cleanup;
8. notification creation still proves the exact Favorite source and refuses
   blocked/unavailable actors;
9. browse/shop popular ordering, dashboard/inventory counts, seller range
   totals, top-listing analytics and quality-score counts retain their reviewed
   semantics;
10. account feed, recently viewed, listing pages, search/browse pages, seller
    pages, saved page and export still render the correct owner state;
11. no UPDATE authority, no cross-user row disclosure and no direct runtime
    path outside the reviewed boundary;
12. rollback restores predecessor application statements.

## Audit Decision

The compatible preparation selects Option B's maintained raw-current-row count
projection without activating its final policy/grant posture. Migration
`20261028010000_prepare_favorite_authorities` adds the non-negative
`Listing.favoriteCount` projection, exact backfill and insert/delete
maintenance, forbids Favorite UPDATE, and installs nine bounded operations.
All application consumers now use those operations or the scalar projection;
no source caller directly reads, writes, counts or orders by Favorite.

The full 437-migration chain passes on disposable PostgreSQL 16 and 17. Its
executed scenario first reproduces the predecessor add-after-block gap, then
proves predecessor direct insert/replay/delete compatibility, atomic guarded
add/replay, no-context and self/inactive/blocked denial,
cross-user read/remove denial, owner state, export, seller range analytics,
seller/admin cleanup authorization, User and Listing cascades, exact count
reconciliation, a concurrent actor-ban recheck, and both winner orders of
add-versus-block and add-versus-archive races. The Prisma schema pins the same
descending three-column index order as the SQL migration, and both mutation
routes reject malformed listing ids before database access.

`GO` for independent review and the additive preparation release only. The
preparation migration must run before the compatible application deploys,
because the converted app calls its new functions and reads `favoriteCount`.
`NO-GO` remains for Favorite RLS/table-grant activation until a separate
activation migration proves runtime/no-context/cross-user denial, final policy
and ACL posture, rollback to the compatible predecessor, skew drain and an
exact-head release review. No column deletion belongs in that activation.
