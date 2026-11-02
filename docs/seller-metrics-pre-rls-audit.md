# SellerMetrics pre-RLS domain audit

Date: 2026-11-02

Public-main baseline: `12a4dfc492412ff52ff94d921e20e7026c4cff38`

Isolated serial baseline: `8256a1744`

Decision: **GO for isolated compatible preparation under policyless Option B.**
Production activation remains **NO-GO** until the preparation, behavior parity,
complete-chain proof, compatible deployment/drain, production inventory and
separately approved activation are complete.

This is the required functionality, authority, privacy, integrity,
concurrency, scale, recovery and rollback audit for `SellerMetrics`. It grants
no authority to merge, deploy, change a Production database grant, or activate
RLS. See `docs/seller-metrics-rls-options.md` for the design comparison.

## Product contract

`SellerMetrics` is a private, derived cache of seller performance. It is not a
public rating table and it is not seller-authored content.

The row stores:

- all-time average rating and review count;
- all-time completed-order count and seller merchandise sales;
- rolling on-time shipping and message response rates;
- current active-case count;
- seller-account age; and
- the calculation timestamp and period length.

These values drive the seller's private analytics and Guild Master eligibility,
the monthly Guild maintenance job, and isolated-staff Guild review. Only the
public Guild badge and public rating summary are public products; the cached
sales, case, response and shipping values are not.

The cache is allowed to be stale for at most seven days on read-only owner
surfaces. A Guild application and the monthly Guild job deliberately force a
fresh calculation. An RLS release must preserve those different freshness
contracts.

## Current schema and lifecycle

The table has twelve non-null columns:

- `id` and unique `sellerProfileId`;
- `calculatedAt` and `periodMonths`;
- `averageRating`, `reviewCount`, `onTimeShippingRate`, `responseRate`;
- `totalSalesCents`, `completedOrderCount`, `activeCaseCount`; and
- `accountAgeDays`.

It has a primary key, a unique index on `sellerProfileId`, and a cascading
foreign key to `SellerProfile`. It has no user trigger and no value constraint.
RLS and FORCE are off. The ordinary runtime currently has direct SELECT,
INSERT, UPDATE and DELETE.

One row is lazily created or refreshed. Refreshes serialize through the
transaction advisory key `(913344, hashtext(sellerProfileId))`, read bounded
facts from the Review, Order, Case, Conversation/Message and SellerProfile
domains, then upsert the cache. Hard SellerProfile deletion cascades the row.
Local account deletion explicitly deletes it before the retained seller profile
is anonymized.

The current schema does not prevent negative counts, rates outside `[0,1]`, a
rating outside `[0,5]`, non-finite floating-point values, a negative sales
total, or an unsupported period. Current application calculations produce
valid values, but a direct statement or future bug can persist impossible
Guild evidence.

## Complete source and installed-function inventory

The reviewed application has five direct table operations in three files.
There is no public, buyer, webhook, message, support or notification read.

| Consumer | Current operation | Principal | Required final boundary |
| --- | --- | --- | --- |
| `src/lib/metrics.ts` | two cache `findUnique` reads | authenticated seller owner through dashboard/analytics call chains | bounded owner state/read-through operation |
| `src/lib/metrics.ts` | one upsert after application aggregation | seller owner or Guild cron | database-derived owner refresh; cron supplies only the user id returned by its bounded cohort; no caller-supplied result write |
| `src/app/api/seller/analytics/route.ts` | one eager cache `findUnique` | authenticated seller owner | same bounded owner state operation |
| `src/lib/accountDeletion.ts` | one seller-row `deleteMany` | exact `LOCAL_ANONYMIZE` claim | claim-bound cleanup operation |
| SellerProfile hard delete | foreign-key cascade | database referential action | executed cascade proof under FORCE |

The installed current-schema catalog has five `SECURITY DEFINER` readers or
consumers whose bodies reference `SellerMetrics`:

1. `grainline_seller_guild_metrics_apply` (runtime wrapper);
2. private `grainline_seller_guild_metrics_apply_prepared_impl`;
3. `grainline_seller_guild_staff_master_pending` (isolated staff);
4. `grainline_seller_guild_staff_master_pending_page` (isolated staff); and
5. `grainline_seller_staff_verification_target` (isolated staff).

All five are owned by the migration owner, are security definer, have no
PUBLIC execution, and use the expected runtime/staff split on the disposable
complete schema. They cross the future FORCE boundary and must be source- and
ACL-sealed; they must not be rewritten merely to satisfy RLS.

The calculation also calls four already-bounded source authorities:

- `grainline_seller_service_metrics_identity`;
- `grainline_order_seller_metrics_facts`;
- `grainline_case_seller_active_count`; and
- `grainline_seller_message_response_metrics`.

Those authorities protect their own source tables. They do not authorize raw
SellerMetrics access.

## Authority matrix

| Operation | Seller owner | Guild cron/service | Isolated staff | Other user / public |
| --- | --- | --- | --- | --- |
| Read current metrics | own seller only | exact eligible target needed for processing | only through retained bounded projections | deny |
| Refresh metrics | own seller, forced or read-through | currently active Guild cohort only | no current direct refresh need | deny |
| Apply Guild transition | no generic authority | retained exact transition only | retained reviewed action paths | deny |
| Account-deletion cleanup | exact active deletion claim only | deny | deny | deny |
| Direct table SELECT/INSERT/UPDATE/DELETE | deny after activation | deny | deny | deny |

The Guild cron obtains the seller user id only from the bounded database cohort
and then uses the same transaction-local owner refresh as the seller dashboard.
No arbitrary-seller metrics refresh is granted to the ordinary runtime. A
stolen runtime credential can still establish application user context under
the repository's current model; the signed-database-identity program remains
the systemic control for that broader threat.

## Required calculation parity

The prepared database operation must preserve the current calculation exactly:

- rolling start is `periodMonths * 30` days before one database UTC timestamp;
- rating/review count cover all matching reviews;
- completed orders and merchandise sales reuse the existing Order authority;
- on-time shipping reuses its shipped/on-time facts;
- active cases reuse the current Case authority and current status set;
- response rate reuses buyer-initiated conversation facts;
- account age is whole elapsed UTC days since SellerProfile creation;
- rates are zero when their denominator is zero; and
- cache freshness rejects timestamps more than five minutes in the future and
  accepts rows no older than seven days.

The database refresh must use one statement/transaction timestamp so a refresh
cannot combine facts calculated across two different periods. Counts returned
to JavaScript must be within its safe numeric bounds.

## Concurrency and failure matrix

| Race/failure | Current contract | Required proof |
| --- | --- | --- |
| Owner refresh vs Guild cron refresh | advisory lock serializes the seller; later calculation wins | two sessions, one seller, no deadlock and one internally consistent row |
| Two owner cache misses | one calculates while the second waits and reuses fresh state | two sessions plus exact freshness result |
| Refresh vs SellerProfile deletion | refresh either commits before deletion or fails/returns unavailable without an orphan | both lock orders plus cascade under FORCE |
| Refresh vs source-domain change | transaction uses one PostgreSQL snapshot under the existing transaction isolation | parity fixture with concurrent committed change documented |
| Account deletion vs refresh | deletion claim and seller lock prevent a deleted seller's cache from being recreated after cleanup | both lock orders, no surviving row after deletion completes |
| Calculation failure before upsert | prior cache remains; no partial value family is written | injected source error/rollback proof |
| App deployment before preparation | new functions are absent | build/deploy gate must fail closed |
| Preparation rollback | predecessor direct statements still required | application-first removal proof with row fingerprint preserved |
| Activation rollback | predecessor app may need CRUD immediately | database-first grant restoration, then disable FORCE/RLS, then predecessor proof |

## Findings and disposition

### `FIX_IN_PREPARATION`

1. **Ordinary runtime has full CRUD on private Guild evidence.** Convert the
   five direct operations and retain only purpose-bound functions before any
   activation.
2. **A generic cache upsert would be an eligibility-forgery authority.** The
   fixed refresh must calculate values from source domains; it must never
   accept rating, sales, case, response or shipping values from the caller.
3. **The cache has no value constraints.** Run a read-only production
   inventory. Add validated checks for supported period, finite/ranged rating
   and rates, and nonnegative counts/sales/age. Refuse unknown historical data
   instead of silently clamping it.
4. **Owner reads are not currently actor-bound at the database.** The new owner
   read/refresh operation must require an active actor who owns the exact
   SellerProfile. Supplying another seller id must return no row or fail.
5. **The cron refresh is cross-owner.** Reuse the owner-bound refresh under the
   exact server-side user identity returned by the Guild cohort. Do not add an
   arbitrary-seller metrics function to the ordinary runtime role. A dedicated
   service credential remains future hardening.
6. **Account deletion uses direct DELETE.** Replace it with the same active
   `LOCAL_ANONYMIZE` claim and seller-row lock pattern used by seller daily
   analytics cleanup. Because a predecessor deployment can still issue its old
   direct DELETE during a compatible rollout, also delete the cache when the
   maintained `ownerAccountActive` mirror transitions to false. The cleanup
   uses the same seller advisory key as refresh, so either lock order ends with
   no inactive seller cache.
7. **Five retained functions cross FORCE.** Pin exact overload, owner,
   `SECURITY DEFINER`, search path, volatility/parallel mode, source digest and
   role ACL. Refuse every unreviewed installed reader/writer at activation.

### `FIX_BEFORE_ACTIVATION`

1. Prove zero direct Prisma/raw-SQL consumers, including nested relation reads.
2. Execute cache-hit, forced refresh, zero-denominator, inactive/missing target,
   cross-owner, service-cohort, account-deletion and retained staff behavior on
   the complete PostgreSQL 17 chain.
3. Execute all refresh/deletion races, hard cascade, direct denial,
   provisioning convergence, database-first rollback and exact reactivation.
4. Inventory Production schema, constraints, function catalog, grants, row
   count, invalid-value counts, period distribution, oldest/newest timestamps
   and orphan count without exporting row data.
5. Prove query plans at realistic seller/review/order/message volume and set a
   measured latency/row-count re-review threshold.
6. Deploy the compatible app, verify exact source commit, and drain every
   predecessor deployment before revoking direct table authority.

### `DEFERRED_PRODUCT_WORK`

1. A distinct cron/service database credential would reduce the authority of a
   stolen ordinary-runtime login. This is part of the broader signed-identity
   and service-role program and does not justify leaving raw table CRUD.
2. Legal/product retention for historical seller performance is not yet a
   separate policy. This release adds no retention purge and drops no column.

## Compatible preparation evidence

The isolated compatible implementation is complete on branch
`codex/seller-metrics-pre-rls-audit-20261102`. It adds nine validated value
constraints, four fixed database functions and one inactive-owner cleanup
trigger. It converts every reviewed direct application operation while leaving
RLS off and retaining predecessor runtime CRUD.

Executed evidence on 2026-11-02:

- the failing-first source test failed before the migration and caller
  conversion, then passed after them;
- the selected generic preparation catalog accepted the exact migration digest,
  source tests, function ACLs, retained-function hashes and trigger identity;
- focused cache, analytics, identity, grant-inventory and preparation tests
  passed;
- `npx tsc --noEmit` passed;
- lint passed with zero errors and six pre-existing warnings, and the dependency
  audit found no unreviewed high or critical advisory;
- the purpose-built scenario passed against a disposable fully migrated
  PostgreSQL 17 clone using direct `grainline_app_runtime` login sessions; and
- the complete 465-migration PostgreSQL 17 chain passed with owner cache reuse,
  forced refresh, owner-bound Guild refresh, inactive-owner denial/cleanup,
  value-constraint denial, exact-claim deletion, concurrent refresh, both
  refresh/deletion lock orders, and downstream fixture isolation.

The final security diff scan found one over-broad draft operation: an
arbitrary-seller Guild metrics refresh granted to the ordinary runtime. The
operation and grant were removed; the cron now reuses the actor-bound owner
authority under the database-derived cohort user id. The corrected scan closed
with zero remaining findings, and the full-chain proof above was rerun after
that correction.

The repository-wide `npm test` run is not a green acceptance signal on this
checkout: 6,462 tests passed, 86 historical/replay tests failed and 15 skipped.
The failures are outside this SellerMetrics change and include known one-off
release tests that reject later migrations. A Next.js build is also still a CI
gate: locally Turbopack rejected the worktree's external `node_modules`
symlink, while the Webpack fallback exhausted the nearly full disk. Do not use
either limitation as evidence that the build passed.

This evidence accepts isolated preparation only. It is not Production
inventory, compatible deployment/drain evidence, activation rollback proof or
authorization to merge, deploy, release a migration, revoke a grant, or enable
RLS.

## Go/no-go

**GO for isolated compatible preparation.** Add constraints and fixed
operations, convert callers, keep RLS off and retain predecessor CRUD. Stop if
behavior parity, source binding, account-deletion ordering, current-schema
function inventory or rollback cannot be proved.

**NO-GO for Production activation.** Activation is a separate combined
policyless ENABLE-plus-FORCE release only after compatible preparation and app
deployment are accepted and drained. Drew must separately approve the exact
Production action.
