# Public SellerProfile pre-RLS audit

Date: 2026-10-18

Status: Phase 0 in progress. This is a source and design audit only. It does
not authorize or apply a Production migration, database grant change, RLS
change, deployment, credential change, or provider action.

## Scope and selected design

The private half of the seller split is complete: `SellerProfilePrivate` is
policyless FORCE RLS in Production with zero ordinary-runtime or `PUBLIC`
direct table authority. The remaining target is the mixed public
`SellerProfile` row.

Drew selected Option B on 2026-10-18 for isolated design and source
preparation:

- retain the current table and foreign keys;
- expose anonymous catalog data through bounded public projections;
- keep exact location in a separate conditional map contract;
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
| `PUBLIC_MAP` | 5 | Exact point only under the opt-in and no-positive-radius predicate |
| `OWNER` | 22 | Authenticated active owner and that owner's row |
| `PARTICIPANT` | 15 | Relationship-bound follow, save, report, review, or message behavior |
| `STAFF` | 7 | Named role/PIN/target/audit-bound staff operations |
| `SERVICE` | 14 | Named webhook, cron, deletion, notification, metrics, repair, or telemetry operation |
| `TRANSACTION` | 14 | Actor/resource-bound checkout, shipping, listing, or custom-order behavior |

Contracts overlap by design. For example, a public listing page needs public
presentation, availability, conditional map disclosure, and signed-in
participant behavior. Seven files read exact seller coordinates: five are
public-map consumers and two are owner-only. All 14 direct base-table writes
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

The disposition is now machine-checked by
`scripts/seller-profile-public-catalog-disposition.mjs`:

| Disposition | Count | Meaning for public SellerProfile |
|---|---:|---|
| Retained fixed authority | 98 | 91 shared-app-runtime and 7 staff-read operations remain callable under their existing purpose-bound contracts |
| Internal support | 32 | Owner-only trigger, core, compatibility and composed-predecessor functions remain non-runtime implementation details |
| Converted authority | 0 | Source caller conversion will add new bounded authorities in Phase 1; none exists in this baseline |
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
| Seller | 38 | 28 | 4 | 6 |
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

## Field and disclosure contracts

`SellerProfile` remains mixed-purpose. A single public row projection is not a
sufficient security boundary.

| Contract | Intended principal | Fields and predicates | Exclusions |
|---|---|---|---|
| Public catalog/profile | Anonymous and signed-in visitors | Public profile presentation, public badge state, and only rows satisfying the route's existing active/visible predicate | `userId`, exact `lat`/`lng`, `displayNameNormalized`, owner-only settings, mutation-only state |
| Public listing/blog eligibility | Anonymous and signed-in visitors | Boolean seller availability predicates used by listing, blog, search, sitemap and aggregate paths | No seller row or private field returned merely to evaluate eligibility |
| Public map point | Anonymous and signed-in visitors | Only active sellers with `publicMapOptIn = true`, valid coordinates, and no positive privacy radius; exact point is returned only under that predicate | No exact point for non-opted-in or radius-protected sellers |
| Owner profile/settings | Authenticated active owner | The owner's exact location, editable profile/settings fields and bounded provider-safe availability state | Foreign seller rows and staff/system-only mutations |
| Staff moderation | Authorized staff, with the existing role/PIN/audit requirements preserved per caller | Verification, feature, ban/unban and audited recovery state required for the named action | Generic staff table browsing and unaudited mutation |
| Service/transaction | Named webhook, cron, checkout, deletion, export, notification and repair operation | Only the fields and row set needed by that operation | Reusable broad service table authority |

Public visibility is not one predicate. `visibleSellerProfileWhere` allows
vacation profiles while `activeSellerProfileWhere`, public listings and public
blogs exclude them. The projection layer must preserve those route-specific
semantics instead of replacing them with one universal view.

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

Current public exact-pin paths were rechecked:

- `/map` requires `publicMapOptIn = true`, non-null coordinates and
  `radiusMeters IS NULL OR radiusMeters = 0`;
- `/sellers/map` applies the same conditions; and
- the public map-card route returns no coordinates.

This supports the existing privacy claim for those paths. The future database
contract must encode the same condition so a new caller cannot bypass it with
a broad select. General public projections must omit `lat`, `lng`, `userId`,
and `radiusMeters`; map access is a separate operation.

## Reconciliation of recent Claude allegations

Claude findings are treated as allegations until reproduced against current
main. The raw audit's finding numbers are not imported because the repository
ledger later reused some numbers for unrelated findings.

| Allegation | Current-main result | RLS classification |
|---|---|---|
| Listing AI review omits `materials`, `metaDescription`, variant group names and option labels | **Confirmed.** All four `reviewListingWithAI` call sites pass title, description, category, tags, seller name, price and images; the review contract has no fields for the omitted public text. | `DEFERRED_PRODUCT_WORK`. Fix in the Listing moderation batch. It does not change the SellerProfile projection design or block additive design work. |
| “Local makers only” commissions are visible to makers nationwide | **Confirmed.** Creation stores a privacy-reduced point and `isNational = false`, but the default `All` tab queries all open requests without a distance predicate. Only the `Near Me` raw query applies the 80 km filter, and any seller shown the request can submit interest. | `DEFERRED_PRODUCT_WORK`. Fix the promise/enforcement in the CommissionRequest domain. Preserve the current active-seller interest predicate during SellerProfile conversion. |
| Public seller maps disclose exact coordinates without consent | **Not reproduced in the reviewed exact-pin paths.** Both map pages require explicit opt-in and no positive privacy radius; the card endpoint omits coordinates. | Retain as a required behavior proof. Any projection that exposes coordinates before those predicates is a `BLOCKS_RLS_DESIGN` defect. |

These classifications preserve the verified product bugs without allowing
unrelated Listing or CommissionRequest work to stall the seller authority
boundary.

## Conversion groups

The 100-file queue will be converted in independently reviewable groups:

1. public catalog/profile and seller-name projections;
2. public eligibility predicates for listing, blog, search, sitemap and
   aggregates;
3. exact public map operation;
4. authenticated owner reads and the eight owner mutations;
5. staff reads and six staff/system/founding-maker mutations;
6. checkout, shipping, cart, deletion, export, upload, notification and webhook
   service operations; and
7. the 17 raw SQL accesses.

Each group needs behavior evidence for its real callers. Source-text checks can
guard the final zero-direct state, but they do not count as behavior proof.

## Gate status

### `BLOCKS_RLS_DESIGN`

- The machine-checked per-consumer principal/contract assignment and
  opaque-shape reconciliation are complete for all 100 proven source files.
- The 130 installed functions and six direct table triggers are classified.
  Bind each of the 98 retained fixed authorities to its existing acceptance
  flow before grant closure; a test-source name reference alone is not
  behavior proof.
- Define the exact columns and row predicates for the public profile,
  eligibility, exact-map, owner, staff and service operations.

### `FIX_BEFORE_ACTIVATION`

- Convert every proven direct, relation and raw SQL caller away from runtime
  base-table authority.
- Replace all 14 direct writes with fixed operations.
- Prove anonymous, owner, staff, map, checkout/shipping, deletion/export,
  webhook/cron and aggregate behavior on the full migrated PostgreSQL 16
  schema.
- Add the final zero-direct guard and prove runtime/PUBLIC table and column
  grants are closed before ENABLE.

### `DEFERRED_PRODUCT_WORK`

- Expand Listing AI moderation coverage to materials, SEO text and variant
  labels.
- Make the local commission promise match discovery and interest enforcement.

Phase 0 is not closed yet, so no SellerProfile view, function, policy, grant or
migration implementation begins from this checkpoint. The next pass is exact
field/predicate design and retained-authority acceptance mapping.
