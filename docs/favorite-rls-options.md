# Favorite RLS Options

Date: 2026-10-28  
Source: `857bc94706913a4d5c4368afa99de0a55bb2437c`

This comparison follows the audit in `docs/favorite-pre-rls-audit.md`. Favorite
is mixed private/aggregate data: the row identifies a user's private save, but
the marketplace intentionally consumes cross-user counts.

## Selected Compatible Boundary

The isolated candidate selects Option B's maintained Listing projection for
the raw public count and popular ordering. It goes one step narrower during
preparation by converting every current Favorite caller to nine bounded
operations. The activation candidate keeps direct owner SELECT and DELETE,
but deliberately withholds INSERT and UPDATE. New rows continue through the
atomic guarded add function so a direct table insert cannot bypass the active
actor, public-target, self-favorite, reciprocal-block and lock-order checks.
Quality-score eligibility remains on its stricter existing authority, while
the new scalar deliberately preserves raw current-row counter semantics.

This selection authorizes compatible preparation only. It does not authorize
ENABLE, FORCE, table-grant revocation, application deployment before the
preparation migration, or a Production run.

## Option A: Owner Policies Plus Dynamic Aggregate Functions

Use owner SELECT/DELETE policies on Favorite. Convert every owner caller
to transaction-local context. Keep raw rows private and replace public/seller
counts with fixed security-definer aggregate functions.

Advantages:

- no duplicated counter to drift;
- row privacy is direct and easy to reason about;
- existing bounded quality-score and seller-analytics functions are reusable.

Costs and risks:

- popular browse and seller-shop ordering must move their full filter,
  ordering and pagination logic into database functions;
- discovery logic becomes coupled to a large SQL surface;
- repeated aggregate scans become more expensive as Favorite grows;
- adding a new listing filter means changing both Prisma and SQL paths.

Conversion scope: 19 application source files currently contain direct
Favorite operations or relation-count/relation-order dependencies; some contain
multiple calls. Rollback restores predecessor CRUD and the original Prisma
aggregate queries.

## Option B: Owner Policies Plus A Maintained Public Count Projection

Use owner SELECT/DELETE policies for private Favorite rows, while retaining a
fixed guarded add operation as the sole ordinary-runtime insert boundary. Add a
non-negative raw current-favorite count to the public Listing projection,
backfill it, and maintain it transactionally on Favorite insert/delete. Convert
owner state, export and cleanup to bounded operations. Keep the existing
eligible-count function for quality score and the existing seller analytics
function for range/top-listing work.

Advantages:

- private user/listing pairs are not public;
- browse/shop ordering and dashboard counts become fast indexed scalar reads;
- app code remains composable in Prisma instead of duplicating all discovery
  filters in SQL;
- the public projection has clear long-term scale characteristics;
- add/remove and count update commit or roll back together.

Costs and risks:

- the projected count can drift if a future mutation path bypasses maintenance;
- very high write traffic to one viral listing serializes on its Listing row;
- bulk/cascade deletion behavior and rollback need real PostgreSQL proofs;
- a reconciliation check/job is mandatory.

The projection should preserve the existing raw-current-row semantics used by
visible counters and "popular" order. The stricter eligible count used by
quality scoring remains separate. This avoids silently changing product
ranking inside a security release.

Conversion scope: the owner/write/cleanup calls in those 19 files move to the
reviewed boundary; public count and order callers change from relation `_count`
to the scalar projection.
Rollback restores predecessor CRUD and relation-count queries, then disables
the new boundary. The additive count column can remain inert; no security
release drops it.

## Option C: Zero Direct Runtime Table Authority

Revoke direct Favorite access and put every owner, public aggregate, seller,
cleanup, notification and service operation behind fixed functions. This is
the policyless private-table pattern used where no ordinary row access is
appropriate.

Advantages:

- smallest direct SQL surface;
- each operation can encode its full product predicate;
- no reliance on transaction-local owner policy for application correctness.

Costs and risks:

- the largest function catalog and highest long-term maintenance cost;
- still requires either dynamic aggregate queries or a maintained count;
- behavior drift risk when rewriting many otherwise-simple owner callers;
- changes to listing cards and discovery require coordinated function edits.

Estimated callers converted: every direct and indirect consumer, more than 20
surfaces. Rollback requires restoring broad predecessor CRUD before retiring
the functions.

## Option D: Column-Level Privileges For Aggregate Reads

Expose only `listingId` to ordinary runtime for counts while hiding `userId` and
serve owner history through functions.

This is not recommended. Prisma relation-count SQL and `COUNT(*)` privilege
requirements are brittle under column-only grants, broad listing-id reads still
leak save distribution beyond the intended bounded projections, and writes
still require a separate authority design. It is neither a clean privacy
boundary nor a maintainable aggregate interface.

## Recommendation

Choose **Option B**.

It gives private rows a conventional owner boundary while keeping the public
catalog fast and composable. It adds far less function/release machinery than
Option C and avoids moving the entire browse query into SQL as Option A would.
The required safeguards are:

- one atomic guarded add/remove boundary;
- owner-only SELECT/DELETE, no direct INSERT or UPDATE;
- a non-negative count invariant;
- deny ordinary runtime writes to `Listing.favoriteCount` and prove that only
  the reviewed Favorite maintenance trigger can change the projection;
- exact backfill and postflight reconciliation;
- mutation coverage for route, archive, staff removal, account deletion and
  both FK cascades;
- a bounded drift detector and documented rebuild procedure;
- full-chain PostgreSQL race and rollback tests before activation.

The compatible preparation and isolated activation candidate now implement
this shape. The activation candidate passes the complete 438-migration
PostgreSQL 17 chain, final runtime/no-context/cross-user denial, both FK
cascades, rollback to the compatible predecessor, and reactivation. That is
source and disposable-database evidence only; production activation still
requires a compatible deployed predecessor, skew drain, exact-head review and
its own explicit approval.
