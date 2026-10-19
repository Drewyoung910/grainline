# Public SellerProfile pre-RLS audit

Date: 2026-10-18

Status: Phase 0 complete; additive Phase 1 design may begin. This is a source
and design audit only. It does not authorize or apply a Production migration,
database grant change, RLS change, deployment, credential change, or provider
action.

## Scope and selected design

The private half of the seller split is complete: `SellerProfilePrivate` is
policyless FORCE RLS in Production with zero ordinary-runtime or `PUBLIC`
direct table authority. The remaining target is the mixed public
`SellerProfile` row.

Drew selected Option B on 2026-10-18 for isolated design and source
preparation:

- retain the current table and foreign keys;
- expose anonymous catalog data through bounded public projections;
- expose only database-derived approximate location through separate public map
  and resource contracts; exact coordinates remain owner or purpose bound;
- move owner, staff and service reads to purpose-bound operations;
- move every write to a fixed operation;
- reach zero runtime/PUBLIC base-table authority before policyless ENABLE;
- apply ENABLE and FORCE as separate reviewed releases; and
- do not drop columns in a security release.

The complete options comparison is in
`docs/seller-profile-public-rls-options.md`.

## Verified source baseline

This audit is based on exact main
`e92b7a329cf3f7c1d45e8c2857e26b336d26ff65`.

The schema-aware TypeScript AST inventory is run with:

```sh
npm run audit:seller-profile-public-access
```

It resolves Prisma relations from `prisma/schema.prisma`, follows local
literal query shapes, inventories typed query factories, and recognizes static
raw SQL fragments. On this baseline it reports:

| Access class | Operations | Files | Important detail |
|---|---:|---:|---|
| Direct `SellerProfile` delegate | 99 | 58 | 12 count, 1 create, 13 findFirst, 18 findMany, 42 findUnique, 1 update, 12 updateMany |
| Confirmed schema relations | 103 | 52 | Five additional typed predicate factories traverse `SellerProfile` |
| Static raw SQL | 17 | 14 | All are reads/joins or the listing-delete ownership lock read; no raw `SellerProfile` mutation was found |
| Union | — | 100 | Exact source-file conversion queue for these three proven access classes |

The scan found zero direct full-row returns, zero opaque direct projections,
and zero relation full-row returns. Callers already request bounded fields, but
they still execute under the shared runtime role's broad table authority.

The first regex inventory reported 73 literal `prisma.sellerProfile` calls and
an upper bound of 106 relation-shaped files. That result is retired: it missed
`tx`, `client`, and `db` receivers and counted unrelated relation syntax. The
schema-aware result is the canonical source baseline.

### Scanner limits and opaque-shape reconciliation

- The scan does not execute TypeScript and cannot prove runtime receiver types.
- It reports 218 syntactically opaque generic query shapes and 12 typed
  factory shapes across all Prisma models. All are now reconciled by the
  machine check below: 47 are explicit `SellerProfile` visibility-helper
  predicates, 149 are reviewed non-target query-factory calls, and 22 are
  inspected non-target scalar/data/order fragments. The 12 typed shapes are
  caller-supplied predicate extensions in the reviewed visibility/owner
  factories. None is an unclassified hidden `SellerProfile` projection or
  mutation. A count, factory, or target-expression change fails the check.
- Dynamic SQL generators are not proven absent, although all static raw SQL
  reaching Prisma raw calls is inspected.
- The source scan does not replace the separate installed database-object
  inventory below.

## Machine-checked consumer contracts

The exact 100-file union is assigned in
`scripts/seller-profile-public-consumer-contracts.mjs` and verified with:

```sh
npm run audit:seller-profile-public-contracts
```

The check fails when a current caller is missing, a stale caller remains, an
unknown or empty contract appears, a direct write lacks an owner/staff/service
boundary, or a coordinate reader lacks either the owner or strict public-map
contract. The current assignment is:

| Contract | Consumer files | Boundary represented |
|---|---:|---|
| `PUBLIC_PROFILE` | 34 | Public-safe presentation under the caller's existing visibility predicate |
| `PUBLIC_ELIGIBILITY` | 47 | Boolean, count, or filter-only availability without returning a seller row |
| `PUBLIC_MAP` | 5 | Approximate point under the opt-in and no-positive-radius directory predicate |
| `OWNER` | 22 | Authenticated active owner and that owner's row |
| `PARTICIPANT` | 15 | Relationship-bound follow, save, report, review, or message behavior |
| `STAFF` | 7 | Named role/PIN/target/audit-bound staff operations |
| `SERVICE` | 14 | Named webhook, cron, deletion, notification, metrics, repair, or telemetry operation |
| `TRANSACTION` | 14 | Actor/resource-bound checkout, shipping, listing, or custom-order behavior |

Contracts overlap by design. For example, a public listing page needs public
presentation, availability, conditional map disclosure, and signed-in
participant behavior. Seven files read raw seller coordinates: five are
public-location consumers and two are owner-only. All 14 direct base-table writes
are classified as owner, staff, or service operations. This manifest closes
the source-file principal assignment and opaque-shape reconciliation; it does
not yet define the final SQL function/view surface.

## Full-chain PostgreSQL 16 catalog baseline

The repository's full-chain harness built and applied all **350 migrations**
to a new disposable PostgreSQL 16.15 database, including its two reviewed
historical role-convergence retries. The complete existing full-chain behavior
suite passed. The read-only catalog inventory is run against that database
with:

```sh
SELLER_PROFILE_PUBLIC_CATALOG_DATABASE_URL=postgresql://ci:...@127.0.0.1/... \
  npm run audit:seller-profile-public-catalog
```

The script refuses non-loopback hosts and requires `ci@.../grainline_ci`; it
cannot target Production.

| Catalog class | Baseline | Consequence |
|---|---:|---|
| RLS policies | 0 | The table is still RLS-disabled and not forced |
| Runtime table privileges | 4 | Runtime has direct `SELECT`, `INSERT`, `UPDATE`, and `DELETE` |
| Runtime column privilege rows | 165 | All 55 columns carry runtime `SELECT`, `INSERT`, and `UPDATE` through the table grant |
| Installed function bodies containing `SellerProfile` | 130 | Every retained function must be classified and tested under the future grant/RLS posture |
| Runtime-executable functions in that set | 91 | Existing fixed authorities are a major part of the compatibility surface; they are not automatically conversion defects |
| Staff-read-role executable functions in that set | 7 | The staff projection surface is separate from the shared app runtime and must retain its staff role/PIN/audit binding |
| Migration-owner/internal-only functions in that set | 32 | Internal helpers remain non-runtime authorities unless a reviewed caller proves otherwise |
| PUBLIC-executable functions in that set | 0 | Current function ACLs do not expose them to unauthenticated database roles |
| Dependent non-internal triggers | 24 | Six are on `SellerProfile`; the rest synchronize or enforce cross-domain state |
| Views or materialized views referencing the table | 0 | The selected bounded projections are additive new objects |
| Constraints involving the table | 23 | Seven belong to `SellerProfile`; 16 are incoming foreign keys from other tables |

All 130 matching functions are `SECURITY DEFINER`, owned by the disposable
migration owner, and pinned to `search_path=pg_catalog`. Their execute ACL
partition is exact: the migration owner can execute all 130, the shared app
runtime can execute 91, the staff-read role can execute 7, and 32 are
owner/internal-only; none is executable by `PUBLIC`. The runtime-callable
functions include existing case, order, checkout, deletion, Guild, Stripe,
shipping, notification and seller-owner operations. Option B must retain only
the reviewed subset and prove each function's result and actor binding; it
must not revoke function execution merely because the function reads this
table.

The Phase 1 candidate adds ten converted runtime authorities without changing
predecessor table grants. `grainline_seller_public_map_points(integer)` returns
only seller id/name/city/state and a database-derived coarse point, enforces
active public-map eligibility, applies reciprocal blocks from trusted
transaction-local user context, and caps results at 500.
`grainline_seller_public_location(text,text)` binds one approximate point to an
already-visible seller or listing and returns only the point, display radius,
and structured-geo eligibility. It preserves owner and reserved-buyer access,
denies reciprocal blocks, excludes archived listings, and deliberately emits
no location for a staff-only preview.
`grainline_seller_public_browse_nearby(double precision,double
precision,double precision)` applies the same approximation inside the
database, enforces public-listing/seller/block predicates, and returns seller
ids only for the requested radius.
`grainline_seller_public_name_suggestions(text,text,boolean,integer)` returns
only seller id/name, owns active-seller, optional public-listing, literal-search,
stable-order, limit and reciprocal-block rules, and serves both global and blog
suggestions without exposing normalized search state.
`grainline_seller_public_sitemap_counts()` and
`grainline_seller_public_sitemap_page(text,integer,integer)` own the ordinary
seller and customer-photo sitemap predicates, counts, stable pagination, and
the exact id/name/updated-at output.
`grainline_seller_public_marketplace_counts()` returns only the active seller
count used by public marketplace statistics and the historical all-profile
founding-maker allocation count.
`grainline_seller_public_metro_count(text,boolean,boolean)` returns one count
while owning major/city membership, optional public-listing eligibility,
active seller state and reciprocal blocks.
`grainline_seller_public_similar_makers(text,integer)` accepts a source listing,
proves public, owner or reserved-buyer visibility, derives metro/state scope
from that listing's seller, and returns at most four rendered card rows. It
owns metro-before-state selection, active candidate seller/listing predicates,
reciprocal blocks, stable Guild/follower ordering and the top public-listing
cover without returning user ids or raw geography.
`grainline_seller_public_featured_makers()` owns the homepage's maximum-two
spotlight selection: active admin-featured sellers first, weekly Guild rotation
second and weekly rotation within the top-four reviewed public sellers last. It
returns the exact rendered spotlight fields; `userId` is purpose-bound to
suppressing the current seller's follow control. All ten grant execute only
to the app runtime. Their disposition is machine-checked by
`scripts/seller-profile-public-catalog-disposition.mjs`:

| Disposition | Count | Meaning for public SellerProfile |
|---|---:|---|
| Retained fixed authority | 98 | 91 shared-app-runtime and 7 staff-read operations remain callable under their existing purpose-bound contracts |
| Internal support | 32 | Owner-only trigger, core, compatibility and composed-predecessor functions remain non-runtime implementation details |
| Converted authority | 10 | The additive directory-map, resource-bound detail, browse-membership, seller-name suggestion, two seller-sitemap operations, marketplace/metro aggregates, listing-bound similar-maker cards and homepage featured-maker selection replace public base-table reads while predecessor grants remain available |
| Retired predecessor | 0 | No installed function in this matching set can be dropped merely for the RLS conversion |

The classifier rejects a count change, an unreviewed internal signature, any
`PUBLIC` execute grant, any execute principal outside the exact owner/runtime/
staff partition, or loss of `SECURITY DEFINER`/`search_path=pg_catalog`.
Function-family counts are:

| Family | Total | App runtime | Staff read | Internal support |
|---|---:|---:|---:|---:|
| Blog | 2 | 0 | 0 | 2 |
| Case | 10 | 7 | 0 | 3 |
| Checkout | 11 | 6 | 0 | 5 |
| Commission | 1 | 0 | 0 | 1 |
| Conversation | 1 | 0 | 0 | 1 |
| Direct upload | 5 | 3 | 0 | 2 |
| Listing | 2 | 2 | 0 | 0 |
| Message | 4 | 3 | 0 | 1 |
| Notification | 2 | 1 | 0 | 1 |
| Order | 38 | 30 | 1 | 7 |
| Seller | 55 | 45 | 4 | 6 |
| Stripe | 4 | 4 | 0 | 0 |
| User | 12 | 7 | 2 | 3 |

The six direct table triggers are:

- private-row initialization;
- supported-snapshot guard;
- seller-profile media-reference release on delete;
- owner public-state snapshot binding;
- public blog-state synchronization; and
- public commission-state synchronization.

They are part of the compatibility proof. None is removed merely to simplify
RLS activation. All six are classified as internal support, and the classifier
binds each trigger name to its exact function signature so a replacement or
additional table trigger reopens review.

### Retained-authority evidence map

The 98 callable retained authorities are bound to evidence in
`scripts/seller-profile-public-retained-authority-evidence.mjs`. Against the
sanitized full-chain catalog report, run:

```sh
SELLER_PROFILE_PUBLIC_CATALOG_REPORT=/path/to/report.json \
  npm run audit:seller-profile-public-retained-evidence
```

The machine check rejects a missing or stale authority, missing evidence file,
evidence that no longer names the authority, or claimed database behavior that
no longer executes a database path. Current disposition:

| Evidence class | Authorities | Meaning |
|---|---:|---|
| Direct database behavior | 93 | A PostgreSQL proof or database behavior test names and executes the installed authority |
| Composed database behavior | 2 | The authority is covered by a reviewed composed migration/flow proof rather than a single direct test |
| Source-only gap | 3 | Source guards exist, but no current PostgreSQL behavior proof qualifies |

The three explicit Phase 1 proof obligations are:

- `grainline_checkout_reservation_account_claim_batch(text,integer)`;
- `grainline_listing_delete_reference_state(text,text)`; and
- `grainline_seller_guild_listing_threshold_sync(text)`.

They do not reopen the authority inventory or justify removing the functions.
They must receive full-chain database behavior tests before any release closes
the predecessor `SellerProfile` grant.

## Field and disclosure contracts

`SellerProfile` remains mixed-purpose. A single public row projection is not a
sufficient security boundary.

All **55 scalar columns** now have one machine-checked maximum-disclosure
class in `scripts/seller-profile-public-field-contracts.mjs`. Run the gate
with:

```sh
npm run audit:seller-profile-public-fields
```

The gate fails if a scalar column is added or removed without review, one
column appears in more than one class, a restricted source column enters the
generic public set, or the approximate public-location rules drift.

| Maximum-disclosure class | Count | Exact columns |
|---|---:|---|
| Generic public-profile output | 38 | `id`, `ownerImageUrl`, `displayName`, `bio`, `city`, `state`, `createdAt`, `updatedAt`, `allowLocalPickup`, `tagline`, `bannerImageUrl`, `avatarImageUrl`, `workshopImageUrl`, `storyTitle`, `storyBody`, `instagramUrl`, `facebookUrl`, `pinterestUrl`, `tiktokUrl`, `websiteUrl`, `yearsInBusiness`, `acceptsCustomOrders`, `acceptingNewOrders`, `offersGiftWrapping`, `giftWrappingPriceCents`, `returnPolicy`, `customOrderPolicy`, `shippingPolicy`, `featuredListingIds`, `galleryImageUrls`, `galleryAltTexts`, `isVerifiedMaker`, `guildLevel`, `vacationMode`, `vacationReturnDate`, `vacationMessage`, `isFoundingMaker`, `foundingMakerNumber` |
| Public predicate only | 7 | `ownerAccountActive`, `displayNameNormalized`, `chargesEnabled`, `stripeAccountSupported`, `featuredUntil`, `metroId`, `cityMetroId` |
| Public-location source only | 4 | `lat`, `lng`, `radiusMeters`, `publicMapOptIn` |
| Purpose-bound only | 6 | `userId`, `shippingFlatRateCents`, `freeShippingOverCents`, `customOrderTurnaroundDays`, `verifiedAt`, `foundingMakerAt` |

“Generic public-profile output” is a maximum allowlist, not a requirement that
one broad view return all 38 columns. Each Phase 1 projection returns only the
subset its callers currently consume. Predicate-only columns can filter,
order, or aggregate inside a reviewed public authority but do not appear in
its returned row. Purpose-bound columns leave the base table only through a
named owner, participant, staff, service, or transaction operation. Shipping
operations can return a derived quote without making either stored shipping
rate a public profile field.

| Contract | Intended principal | Fields and predicates | Exclusions |
|---|---|---|---|
| Public catalog/profile | Anonymous and signed-in visitors | Public profile presentation, public badge state, and only rows satisfying the route's existing active/visible predicate | `userId`, exact `lat`/`lng`, `displayNameNormalized`, owner-only settings, mutation-only state |
| Public listing/blog eligibility | Anonymous and signed-in visitors | Boolean seller availability predicates used by listing, blog, search, sitemap and aggregate paths | No seller row or private field returned merely to evaluate eligibility |
| Public directory map point | Anonymous and signed-in visitors | `id`, `displayName`, `city`, `state` and a coarse-grid public point; row must satisfy `ACTIVE`, `publicMapOptIn = true`, valid coordinates, and a null/zero privacy radius | No point for non-opted-in or radius-protected sellers; no raw or exact coordinates in the result |
| Public profile/listing location | Authorized viewer of the seller or listing resource | A derived `publicLat`, `publicLng`, and `approximate = true`. Positive radii quantize to a radius-sized grid; null/zero radii use the coarse public grid | No raw `lat`, `lng`, `radiusMeters`, or `publicMapOptIn` returned to the caller; exact output is owner or purpose bound only |
| Owner profile/settings | Authenticated active owner | The owner's exact location, editable profile/settings fields and bounded provider-safe availability state | Foreign seller rows and staff/system-only mutations |
| Staff moderation | Authorized staff, with the existing role/PIN/audit requirements preserved per caller | Verification, feature, ban/unban and audited recovery state required for the named action | Generic staff table browsing and unaudited mutation |
| Service/transaction | Named webhook, cron, checkout, deletion, export, notification and repair operation | Only the fields and row set needed by that operation | Reusable broad service table authority |

Public visibility is not one predicate. `visibleSellerProfileWhere` allows
vacation profiles while `activeSellerProfileWhere`, public listings and public
blogs exclude them. The projection layer must preserve those route-specific
semantics instead of replacing them with one universal view.

The exact Phase 0 row predicates are:

- `VISIBLE`: `ownerAccountActive = true`, `chargesEnabled = true`, and
  `stripeAccountSupported = true`;
- `ACTIVE`: `VISIBLE` plus `vacationMode = false`;
- public directory point: `ACTIVE`, non-null valid coordinates,
  `publicMapOptIn = true`, `radiusMeters IS NULL OR radiusMeters = 0`, followed
  by coarse-grid derivation inside the database boundary;
- seller-page location: `VISIBLE` for a public visitor, or the existing exact
  owner/resource authorization for previews, followed by database-side
  derivation of the public point; and
- listing-page location: the existing public, reserved-buyer, owner-preview,
  or staff-preview listing decision, followed by the same database-side
  derivation. The location operation cannot independently make a private
  listing visible.

Viewer block exclusions remain caller-specific relationship predicates. They
are applied through the future bounded operation rather than expanding the
generic public row or returning `userId` to perform the check in application
code.

## Write inventory

Fourteen direct base-table writes remain:

- one idempotent seller bootstrap create in `src/lib/ensureSeller.ts`;
- one owner vacation update in `src/app/api/seller/vacation/route.ts`;
- two staff featured-maker updates in
  `src/app/admin/verification/page.tsx`;
- two founding-maker badge updates in `src/lib/foundingMakerCore.ts`;
- six owner-bound updates in `src/lib/sellerOwnerPrivateAccess.ts`; and
- two staff orderability updates in `src/lib/sellerStaffPrivateAccess.ts`.

The TypeScript owner/staff wrappers already apply useful row predicates, but
they still rely on shared-role direct `UPDATE` authority. Each becomes a fixed
database operation with actor, target, state-transition, affected-row and audit
requirements appropriate to its caller. The seller bootstrap create likewise
becomes a fixed idempotent operation.

## Raw SQL inventory

The 17 raw SQL accesses are in these 14 files:

- `src/app/api/blog/search/route.ts`
- `src/app/api/blog/search/suggestions/route.ts`
- `src/app/api/listings/[id]/similar/route.ts`
- `src/app/api/listings/[id]/stock/route.ts`
- `src/app/api/search/suggestions/route.ts` (three accesses)
- `src/app/blog/page.tsx`
- `src/app/browse/page.tsx`
- `src/app/commission/page.tsx`
- `src/app/page.tsx`
- `src/lib/listingDelete.ts`
- `src/lib/popularBlogTags.ts`
- `src/lib/popularTags.ts` (two accesses)
- `src/lib/quality-score.ts`
- `src/lib/site-metrics-snapshot.ts`

Most use `SellerProfile` only to enforce active public-seller predicates. They
should join a bounded eligibility projection or call a purpose-bound operation.
`listingDelete.ts` is different: it locks the listing and joins the seller to
prove ownership inside the same transaction. That path needs a fixed
owner-bound delete preparation operation, not a public projection.

`src/app/commission/page.tsx` uses `$queryRawUnsafe` with a static query and
bound positional inputs. This audit found no interpolated untrusted SQL, but
the query still directly joins `SellerProfile` for active-interest counts and
must convert. `CommissionRequest` remains a separate RLS release.

## Location boundary

Current public coordinate paths were rechecked:

- `/map` requires `publicMapOptIn = true`, non-null coordinates and
  `radiusMeters IS NULL OR radiusMeters = 0`;
- `/sellers/map` applies the same conditions; and
- the homepage map applies the same conditions;
- seller and listing detail pages pass the source point through
  `publicSellerLocationPoint`, which quantizes radius-protected locations and
  uses the coarse public grid when exact-location opt-in is absent; and
- the public map-card route returns no coordinates; and
- the seller JSON-LD emits raw `geo` for opted-in null/zero-radius sellers.

The three directory/home map queries and seller JSON-LD currently publish the
raw point. Seller and listing detail helpers also return the raw point when
exact-location opt-in is set. That contradicts Privacy Policy section 2.7 and
Terms sections 4.19 and 4.20, which promise approximate city/region display and
say exact coordinates are not displayed. Opt-in does not cure that mismatch:
the current checkbox does not clearly disclose raw-coordinate publication, and
the legal promise is unconditional.

Option B therefore adopts the safer contract: every anonymous or signed-in
public location result is database-derived and approximate. Positive privacy
radii use a radius-sized grid; null/zero radii use the coarse public grid.
Exact coordinates remain available only to the owner or a reviewed
purpose-bound transaction such as pickup fulfillment. General public
projections omit all four location source columns and `userId`; location access
is a separate operation. The current raw-map and JSON-LD behavior is a product
defect that Phase 1 must remove before activation.

An isolated Phase 1 source candidate now removes that raw public output across
the three maps, seller/listing map cards, seller JSON-LD and browse-distance
SQL. Its behavior test failed on the exact-main implementation and passes after
the change. The three directory/home maps additionally read through the first
database-derived public operation instead of directly selecting raw map source
columns. This does not rewrite the baseline above or claim a live fix: the
candidate remains unmerged and undeployed, and seller/listing detail plus
browse location still need database-bound operations before RLS activation.

## Reconciliation of recent Claude allegations

Claude findings are treated as allegations until reproduced against current
main. The raw audit's finding numbers are not imported because the repository
ledger later reused some numbers for unrelated findings.

| Allegation | Current-main result | RLS classification |
|---|---|---|
| Listing AI review omits `materials`, `metaDescription`, variant group names and option labels | **Confirmed.** All four `reviewListingWithAI` call sites pass title, description, category, tags, seller name, price and images; the review contract has no fields for the omitted public text. | `DEFERRED_PRODUCT_WORK`. Fix in the Listing moderation batch. It does not change the SellerProfile projection design or block additive design work. |
| “Local makers only” commissions are visible to makers nationwide | **Confirmed.** Creation stores a privacy-reduced point and `isNational = false`, but the default `All` tab queries all open requests without a distance predicate. Only the `Near Me` raw query applies the 80 km filter, and any seller shown the request can submit interest. | `DEFERRED_PRODUCT_WORK`. Fix the promise/enforcement in the CommissionRequest domain. Preserve the current active-seller interest predicate during SellerProfile conversion. |
| Public seller maps and seller JSON-LD disclose exact coordinates despite approximate-only legal promises | **Confirmed on exact main.** Opted-in null/zero-radius sellers' raw coordinates reach three map surfaces and seller JSON-LD. Seller/listing helpers can also return exact points. Privacy 2.7 and Terms 4.19/4.20 promise approximate-only public display. | The Phase 0 design requires approximate-only public output. An isolated Phase 1 candidate corrects the current application callers and “exact pin” copy, with failing-first behavior evidence. It remains `FIX_BEFORE_ACTIVATION` until merged, released and replaced by the authoritative database projection; exact location remains owner or purpose bound. |

These classifications preserve the verified product bugs without allowing
unrelated Listing or CommissionRequest work to stall the seller authority
boundary.

## Conversion groups

The 100-file queue will be converted in independently reviewable groups:

1. public catalog/profile and seller-name projections;
2. public eligibility predicates for listing, blog, search, sitemap and
   aggregates;
3. approximate public map/location operations;
4. authenticated owner reads and the eight owner mutations;
5. staff reads and six staff/system/founding-maker mutations;
6. checkout, shipping, cart, deletion, export, upload, notification and webhook
   service operations; and
7. the 17 raw SQL accesses.

Each group needs behavior evidence for its real callers. Source-text checks can
guard the final zero-direct state, but they do not count as behavior proof.

## Gate status

### `BLOCKS_RLS_DESIGN`

- No open design blocker remains. Phase 0 fixed the authority, field,
  predicate, and approximate-location contracts needed for additive design.
- The machine-checked per-consumer principal/contract assignment and
  opaque-shape reconciliation are complete for all 100 proven source files.
- The 130 installed functions and six direct table triggers are classified.
  All 98 retained fixed authorities are mapped: 93 direct behavior proofs, two
  composed behavior proofs, and three explicit source-only proof gaps.
- The 55-column disclosure partition and public visibility/location predicates
  are complete and prohibit exact public location output. Phase 1 still defines
  each operation's narrower return shape;
  owner, staff, service, participant and transaction operations never inherit
  a reusable whole-row result from this maximum allowlist.

### `FIX_BEFORE_ACTIVATION`

- Convert every proven direct, relation and raw SQL caller away from runtime
  base-table authority.
- Replace all 14 direct writes with fixed operations.
- Keep global and blog seller-name suggestions on the exact two-column
  `grainline_seller_public_name_suggestions` projection; do not restore direct
  profile reads or expose normalized search state.
- Keep sitemap counts and pages on the exact sitemap authorities; customer
  photos admit only active or sold-out public listing details with a photo.
- Keep marketing-page active/founding counts on the exact marketplace-count
  authority; founding allocation intentionally counts inactive profiles too.
- Keep metro seller counts on the exact metro-count authority; it owns
  major-vs-city membership, the caller's optional public-listing requirement,
  active seller state and reciprocal blocks while returning one integer only.
- Keep similar-maker cards on the exact listing-bound authority; it proves the
  source listing is visible, owns metro-before-state scope, active candidate
  seller/listing visibility, reciprocal blocks and stable ordering while
  returning only rendered card fields and one public-listing cover image.
- Keep the homepage spotlight on the exact featured-maker authority; it owns
  admin-featured, weekly Guild and top-four-reviewed fallback selection, caps
  results at two, and returns `userId` only for self-follow suppression.
- Merge and release the isolated application correction that replaces
  raw-coordinate output on public maps, seller/listing public helpers, seller
  JSON-LD and browse-distance SQL with approximate points and removes “exact
  pin” UI copy. The three directory/home maps and seller/listing detail routes
  now use three additive bounded authorities. The application no longer
  derives a public point from raw seller coordinates; the two remaining
  coordinate consumers are purpose-bound owner paths.
- Add full-chain behavior proof for the checkout claim batch, listing delete
  reference state, and Guild listing-threshold sync authorities.
- Prove anonymous, owner, staff, map, checkout/shipping, deletion/export,
  webhook/cron and aggregate behavior on the full migrated PostgreSQL 16
  schema.
- Add the final zero-direct guard and prove runtime/PUBLIC table and column
  grants are closed before ENABLE.

### `DEFERRED_PRODUCT_WORK`

- Expand Listing AI moderation coverage to materials, SEO text and variant
  labels.
- Make the local commission promise match discovery and interest enforcement.

Phase 0 closed on 2026-10-19 with a **go to additive Phase 1 design**. The
existing Option B approval covers isolated source preparation only. It does not
authorize a Production migration, grant change, RLS change, deployment, or
provider action. Phase 1 begins with bounded projection/operation definitions
and the retained-location/authority behavior obligations above; predecessor
runtime grants remain unchanged throughout compatible preparation.
