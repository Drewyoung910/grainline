# Seller daily analytics pre-RLS domain audit

Date: 2026-11-01

Source baseline: `12a4dfc492412ff52ff94d921e20e7026c4cff38`

Decision: **GO for isolated compatible preparation under policyless Option B.**
Production activation remains **NO-GO** until every `FIX_BEFORE_ACTIVATION`
item and the complete-schema acceptance proof below are closed.

This is the required product, functionality, authority, privacy, concurrency,
scale, recovery, and rollback audit for `ListingViewDaily` and
`SellerProfileViewDaily`. It is not authorization to merge a migration, deploy
an application, change a database grant, or activate RLS in Production. See
`docs/seller-analytics-daily-rls-options.md` for the design comparison.

## Product contract

The two tables hold private seller-performance aggregates, not public catalog
data and not viewer identities.

- `ListingViewDaily` stores one UTC-day row per listing. `views` means accepted
  listing-detail opens; `clicks` means accepted listing-card click telemetry.
- `SellerProfileViewDaily` stores one UTC-day row per seller profile. `views`
  means accepted public shop-profile opens.
- public event routes deliberately fail open when Redis is unavailable and
  fail closed only at the database mutation itself. Bot filtering, public
  visibility, IP rate limits, 24-hour IP/target deduplication, aggregate cookie
  deduplication, signed-in owner self-exclusion, and per-listing daily Redis
  caps remain application controls.
- sellers see only their own totals and chart buckets. They do not need raw row
  identifiers or another seller's daily rows.
- the order analytics authority may consume listing aggregates only for the
  seller whose actor identity it has independently resolved.
- the monthly Guild metrics job removes daily rows older than the fixed
  730-day retention window.
- account deletion removes profile-view history today. It deliberately retains
  listing rows with the retained, hidden listings until ordinary retention;
  those rows contain no viewer identity. That existing distinction must not be
  changed silently by an RLS release.

RLS is defense in depth. It does not replace the route-level abuse controls or
make a public telemetry endpoint trustworthy by itself.

## Schema and current lifecycle

### `ListingViewDaily`

Columns: `id`, `listingId`, `sellerProfileId`, `date`, `views`, and `clicks`.
It has:

- primary key `id`;
- unique index `(listingId, date)`;
- indexes `(sellerProfileId, date)` and `(date)`;
- cascading foreign keys to `Listing` and `SellerProfile`.

The table currently lacks database constraints that require `views` and
`clicks` to be nonnegative, require `date` to be midnight UTC, or prove that
`sellerProfileId` is the actual owner of `listingId`.

The public listing routes create or increment today's row after incrementing
the matching scalar on `Listing`. Listing or seller-profile hard deletion
cascades the rows. The retention job deletes old rows in bounded batches.

### `SellerProfileViewDaily`

Columns: `id`, `sellerProfileId`, `date`, and `views`. It has:

- primary key `id`;
- unique index `(sellerProfileId, date)`;
- indexes `(sellerProfileId, date)` and `(date)`;
- a cascading foreign key to `SellerProfile`.

It currently lacks database constraints that require `views` to be
nonnegative or `date` to be midnight UTC.

`grainline_seller_profile_view_record(text,date)` locks the public and private
seller rows, checks that the target remains active, increments the private
all-time counter, and upserts today's daily row. Hard seller-profile deletion
cascades the rows; local account deletion explicitly removes them first; the
retention job also removes old rows.

## Complete source inventory

The reviewed source has eight direct daily-table operations in five application
files, plus two retained fixed-function consumers.

| Consumer | Operation | Principal | Required final boundary |
| --- | --- | --- | --- |
| `src/app/api/listings/[id]/view/route.ts` | increment `Listing.viewCount`, derive seller, upsert listing daily `views` | anonymous or signed-in public viewer | one atomic public telemetry operation |
| `src/app/api/listings/[id]/click/route.ts` | increment `Listing.clickCount`, derive seller, upsert listing daily `clicks` | anonymous or signed-in public viewer | same atomic operation with a pinned metric kind |
| `src/app/api/seller/[id]/view/route.ts` through `recordSellerProfileView` | increment all-time profile counter and upsert profile daily `views` | anonymous or signed-in public viewer | retain and pin `grainline_seller_profile_view_record` |
| `src/app/api/seller/analytics/route.ts` | aggregate listing views/clicks | authenticated seller owner | bounded owner summary operation |
| same route | aggregate profile views | authenticated seller owner | bounded owner summary operation |
| same route | read listing daily rows for chart buckets | authenticated seller owner | database-grouped, bounded owner bucket operation |
| `grainline_order_seller_analytics_top_listings` | aggregate listing daily rows for the actor's top listings | authenticated seller owner | retain and pin the existing fixed operation |
| `src/app/api/cron/guild-metrics/route.ts` | delete old listing daily rows | authenticated cron service | bounded retention operation with internal cutoff |
| same route | delete old profile daily rows | authenticated cron service | same bounded retention operation |
| `src/lib/accountDeletion.ts` | delete the target seller's profile daily rows | claimed account-deletion transaction | deletion-claim-bound cleanup operation |
| Listing hard deletion | cascade listing daily rows | database referential action | executed cascade proof under FORCE |
| SellerProfile hard deletion | cascade both tables | database referential action | executed cascade proof under FORCE |

`src/lib/metrics.ts` and `src/lib/metricsState.ts` define retention and metric
calculation constants but do not issue another daily-table query. No staff,
buyer export, webhook, message, support, or public page reads a raw daily row.
No additional Prisma relation read, nested write, raw SQL, trigger, or current
function body was found on the reviewed baseline.

## Authority matrix

| Operation | Seller owner | Public viewer | Staff | Cron/service | Other seller / ordinary caller |
| --- | --- | --- | --- | --- | --- |
| Record listing view/click | may create non-self telemetry only as a viewer | eligible public target, abuse controls first | no distinct need | no | only through the same public operation |
| Record profile view | self traffic denied by caller; otherwise public operation | eligible public seller target | no distinct need | no | only through the same public operation |
| Read totals and buckets | own seller profile only | deny | no current product need | no | deny |
| Read top listings | own seller profile through retained function | deny | no current product need | no | deny |
| Retention delete | deny | deny | deny | rows strictly older than internal 730-day cutoff | deny |
| Account-deletion cleanup | own claimed deletion only | deny | deny | exact active deletion claim | deny |
| Direct insert/update/delete/select | deny after activation | deny | deny | deny | deny |

There is no product reason for an ordinary runtime, staff runtime, or public
role to hold direct table or column authority after activation.

## State machines

### Listing daily row

1. **Absent** — no accepted event for the listing/day.
2. **Current** — the first accepted event atomically creates a row with one
   counter incremented and the other at zero.
3. **Accumulating** — later accepted events increment exactly one counter.
4. **Retained** — once the day ends, the row is read-only aggregate history.
5. **Removed** — retention or a parent hard-delete removes the row.

There is no legitimate update to `listingId`, `sellerProfileId`, `date`, or
`id`, and no legitimate decrement.

### Seller-profile daily row

The same states apply, with only a `views` counter. Local account deletion also
removes all profile daily rows before the retained seller profile is
anonymized.

Retries must be harmless at the database boundary only when the caller has
already won the application deduplication decision. The database operation is
an increment, not an idempotency ledger; replaying it intentionally counts a
second accepted event.

## Findings and gates

There are no remaining `BLOCKS_RLS_DESIGN` findings after selecting Option B.
The following items block activation and, where noted, must be included in the
compatible preparation.

### `FIX_BEFORE_ACTIVATION`

1. **Daily-row invariants are not enforced.** Run a read-only production
   inventory for negative counts, non-midnight dates, and listing/seller
   mismatches. Refuse preparation if unknown rows exist. Add validated checks
   for nonnegative counts and midnight dates. Because a cross-table `CHECK`
   cannot prove listing ownership, every writer must derive
   `sellerProfileId` from the locked `Listing`; the postflight inventory must
   prove zero mismatches.
2. **Listing telemetry is a split direct transaction.** Replace both routes'
   `Listing` increment plus `ListingViewDaily` upsert with one fixed operation.
   It must validate the metric kind, derive the current UTC day and seller,
   lock the public listing, re-check current public visibility and signed-in
   owner self-exclusion, reject exhausted integer counters before mutation,
   and update the scalar and daily row atomically. The existing application
   abuse controls stay before this call.
3. **Owner analytics performs three direct reads and materializes every daily
   listing row in the range.** Replace them with bounded owner summary and
   grouped-bucket operations that derive the seller from the actor. Aggregate
   by the requested day/month/year grouping in PostgreSQL rather than returning
   one row per listing/day. Preserve all range semantics, including yesterday's
   half-open end.
4. **Retention uses direct raw deletes.** Replace both delete loops with a
   bounded fixed operation that derives the 730-day cutoff from database UTC,
   orders oldest first, returns exact per-table counts and `complete` state,
   and cannot delete a current row even if a caller supplies bad input.
5. **Account deletion directly deletes profile analytics.** Move that cleanup
   into a function bound to the exact active local-anonymization claim, or into
   the already claim-bound seller anonymization function. It must preserve the
   current behavior of retaining listing daily aggregates and removing only
   the target seller's profile daily rows.
6. **Existing security-definer consumers must survive FORCE exactly.** Pin the
   owner, security mode, `search_path`, volatility, parallel mode, signature,
   body digest, and ACL for `grainline_seller_profile_view_record` and
   `grainline_order_seller_analytics_top_listings`. Re-run both behaviors after
   FORCE and after rollback/reactivation.
7. **The profile recorder checks the legacy all-time counter but not an
   independently poisoned daily row.** Preparation inventory must detect a
   daily count at integer exhaustion, and the fixed function must reject the
   update before changing either counter.
8. **Current tests are mostly source-text assertions.** Add failing-first,
   complete-chain PostgreSQL behavior tests for public eligibility, seller
   isolation, data invariants, both cascades, retention, deletion, rollback,
   and concurrency. Route tests must execute the handler boundary and prove the
   abuse-control ordering is preserved.
9. **The live catalog is not established by this source audit.** Before a
   release candidate, read the production catalog for table owner, RLS flags,
   policies, table/column ACLs, constraints, indexes, triggers, row counts, and
   every current function body that references either table. No source
   assumption may replace that inventory.
10. **Activation must be one reviewed authority change.** After compatible
    callers are live and predecessor traffic is drained, combine `ENABLE` and
    `FORCE`, revoke all ordinary runtime/staff/`PUBLIC` table and column
    privileges, install zero policies, and pin the exact fixed-operation
    catalog. Do not leave an ENABLE-only compatibility interval.

### `DEFERRED_PRODUCT_WORK`

1. **C-1367:** `ClickTracker` counts any click bubbling through the card,
   including the heart or maker link. Restrict telemetry to the listing
   navigation action. This changes metric quality, not row authority; close it
   before analytics is used for seller ranking or billing.
2. The `alltime` dashboard combines 730-day listing daily history with
   unpruned order totals and the unpruned legacy profile counter. After two
   years, conversion and year charts are no longer truly all-time. Rename the
   range or adopt a durable aggregate before sellers rely on it contractually.
3. Hourly revenue is real, but hourly listing views/clicks are fabricated by
   spreading a daily total evenly across hours. Show daily engagement beside
   hourly sales or label the approximation.
4. Retention runs after the seller loop in the monthly Guild job. A process
   timeout can skip cleanup. The fixed operation is still required for RLS;
   scheduling it as a separate durable maintenance job is follow-up work.
5. Redis daily caps intentionally fail open. This prevents analytics failure
   from breaking public browsing, but it means counters are not fraud-proof.
   Keep them out of money, eligibility, or punitive moderation decisions until
   a durable abuse ledger exists.
6. The dashboard blocks incomplete onboarding even when historical orders and
   analytics exist. That access decision is independent of table isolation and
   should be reviewed with the seller-support contract.

Each deferred item preserves the Option B authority boundary. None requires
direct daily-table access to remain.

## Concurrency and lock order

The fixed operations must follow one stable order.

### Listing telemetry

1. lock the exact `Listing` row;
2. derive and, if needed, lock its `SellerProfile` only for mutable visibility
   state not already mirrored on the listing;
3. re-check public eligibility and owner self-exclusion;
4. lock or upsert the `(listingId, current UTC day)` daily row;
5. increment the `Listing` scalar and daily counter in the same transaction.

Listing deletion already starts from the parent and cascades to the child, so
the telemetry operation must remain parent-first. A child-first writer would
invert that order and can deadlock with hard deletion.

### Seller-profile telemetry

The retained function locks `SellerProfile` and `SellerProfilePrivate` before
upserting the daily row. Account deletion pause uses the same seller/private
order. Any cleanup folded into anonymization must occur only after those parent
locks, never daily-row-first.

### Retention and cascades

Retention locks only rows older than the cutoff in `(date,id)` order. Current
telemetry writes only today's row, so ordinary recording and retention do not
target the same row. Tests must still race retention against parent deletion
and prove no `40P01`, duplicate count, or surviving orphan.

Required two-session tests cover:

- first listing view versus listing deletion in both winner orders;
- view and click on the same listing/day;
- duplicate concurrent views on an absent daily row;
- profile view versus account-deletion pause/cleanup;
- retention versus Listing and SellerProfile cascades; and
- owner reads while telemetry and retention commit.

## Privacy and data minimization

The tables contain no IP address, Clerk id, cookie, user agent, viewer user id,
or event-level trail. That is the correct data-minimized shape. The sensitive
fact is seller performance: a seller's daily traffic should not be enumerable
by another seller or a public caller.

Fixed owner reads return only totals and chart buckets needed by the dashboard.
Public writers return a boolean recorded/skipped result and no seller-private
count. Retention and deletion return only bounded counts. Sanitized production
evidence must not export seller ids, listing ids, dates, or counter values.

## Scale and query-plan requirements

- Public telemetry is a hot path. It must remain one database round trip after
  application abuse controls, use the unique `(listingId,date)` index, and
  avoid scanning seller history.
- Owner summary queries use `(sellerProfileId,date)` and aggregate in the
  database. They must not return `listings x 730 days` to Node merely to group
  it again.
- Retention uses `(date)` with a fixed batch size and time budget.
- The top-listings function remains capped at eight and must retain its seller
  predicate before reading daily rows.
- Full-chain proof must run `EXPLAIN (FORMAT JSON)` for the public upsert,
  owner range aggregation, and retention candidate query and reject an
  unbounded sequential plan at representative scale where an index plan is
  expected.
- No RLS policy should execute a per-row subquery on either hot table. Option B
  deliberately installs zero policies.

## Recovery and rollback

The compatible preparation is additive: constraints, fixed operations, and
converted callers are installed while predecessor CRUD remains available.
The compatible app can therefore continue using fixed operations after an
activation rollback.

Emergency rollback is database-first:

1. restore exact predecessor runtime CRUD grants without grant option;
2. verify no `PUBLIC`, staff, column, `TRUNCATE`, `REFERENCES`, or `TRIGGER`
   authority appears;
3. disable FORCE and RLS;
4. remove only activation policies (expected: none) and activation-only
   guards, not compatible functions or constraints;
5. execute the predecessor listing telemetry, owner analytics, retention, and
   account-deletion statements on PostgreSQL;
6. reconcile the migration ledger as a separately documented operator step.

Rollback must refuse unexpected policies, grants, function bodies, triggers,
or schema drift. It must be proved from the actual rollback SQL, then followed
by a clean reactivation and the same behavior matrix.

## Required acceptance proof

The complete migrated PostgreSQL 17 schema must prove at least:

1. public view and click success for an eligible listing;
2. hidden, private, archived, sold-out, unavailable-seller, malformed, bot,
   rate-limited, duplicate, daily-capped, and owner-self requests do not write;
3. scalar and daily counters change together or not at all;
4. seller id and UTC day are derived rather than trusted;
5. negative, non-midnight, mismatched-seller, and exhausted-counter states are
   rejected and inventories are empty;
6. profile views preserve current eligibility and self-exclusion behavior;
7. seller A reads only seller A totals and buckets; no-context and seller B
   cannot call A's owner read successfully;
8. the top-listings authority still returns only the actor's listings;
9. retention removes only rows older than 730 days, in bounded batches;
10. account deletion removes only target profile history and preserves current
    listing-history semantics;
11. Listing and SellerProfile hard-delete cascades succeed under FORCE;
12. direct runtime/staff/`PUBLIC` table and column access is zero;
13. the exact function catalog, constraints, indexes, foreign keys, triggers,
    owner, policies, and ACLs match the reviewed source;
14. provisioning replay does not restore broad grants;
15. all two-session races listed above complete without deadlock or drift;
16. database-first rollback restores predecessor statements; and
17. reactivation closes direct access and passes the same proof again.

## Audit decision

Option B is the best long-term safety and scalability choice. The tables are
private aggregates with public/service writers, not owner-authored records.
Zero direct authority makes future columns fail closed, avoids raw-row leakage,
removes per-row RLS policy cost from a hot telemetry table, and lets the owner
dashboard receive already-grouped results.

This decision authorizes only isolated compatible preparation after the
findings above are encoded in failing-first tests. It does not authorize a
Production action.
