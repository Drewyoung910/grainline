# Listing, Photo and variant pre-RLS domain audit

## Status and exact source

Status: **AUDIT COMPLETE — GO for isolated preparation; NO-GO for activation.**

This audit covers `Listing`, `Photo`, `ListingVariantGroup` and
`ListingVariantOption` as one coupled catalog lifecycle. It began on
2026-11-02 against exact source
`7060b504a9f4503af26dd11a14e316fa89ed93b8`, after the SellerMetrics
preparation and activation candidates were committed and pushed. No catalog
policy, grant, function or migration design predates this audit.

The options comparison is in `docs/listing-domain-rls-options.md`. Drew's
standing instruction is to choose the safer scalable design; the executed
evidence selects the public-only hybrid Option A recorded there. Preparation
may begin only on the isolated branch. Activation still requires every
`FIX_BEFORE_ACTIVATION` closure and the exact full-chain acceptance gate.

## Product contract under review

### Public catalog

- Browse/search/card/sitemap rows are `ACTIVE`, non-private, unarchived and
  seller-orderable.
- Ordinary listing detail also permits `SOLD_OUT`, non-private, unarchived and
  seller-orderable rows.
- Public pages may return displayed photo URLs and alt text, variant names and
  options, price/inventory/display fields and reviewed seller mirrors. They do
  not return photo pre-crop sources, reservation routing or moderation state.
- Signed-in public queries preserve reciprocal block filtering where the
  current route applies it.

### Owner catalog

- An active seller reads all unarchived states of listings they own, including
  draft/hidden/rejected/review state and the data needed to edit media and
  variants.
- Creation and editing co-commit listing, photos, variants and durable upload
  claims. Stock/type transitions retain the dedicated stock mutation lock and
  replay protocol.
- Public content changes pass the current AI/staff review state machine before
  returning to a public state.
- Delete/archive, hide/unhide, sold/available, publish/withdraw and inventory
  operations keep their distinct preconditions and checkout/notification/cache
  side effects.

### Reserved buyer and staff

- A private custom listing is visible only to its owner, its exact active
  reserved buyer in an allowed state, or PIN-authorized staff preview.
- It is never exposed through public search, cards, tags, metros, sitemaps or
  generic relation reads.
- Staff moderation reads include review evidence only through the protected
  staff role/capability. Staff transitions remain version/state bound.

### Service and retained-history work

- Checkout/cart/shipping may read the exact current source required to price,
  reserve and validate a purchase, including variants, but cannot use generic
  catalog authority for a private listing belonging to another buyer.
- Paid order history remains self-contained through Order/OrderItem snapshots;
  catalog cleanup cannot erase required retained evidence.
- Account deletion, upload lifecycle, AI review, analytics, stock restore,
  favorite/review maintenance and scheduled repair use bounded operations with
  explicit principals and restart behavior.

## Source inventory

The generic schema-aware scanner was followed by a TypeScript-AST pass and a
manual receiver/relation reconciliation. One apparent Photo relation in
`ReviewsSection.tsx` was removed because it is `ReviewPhoto`, not this domain.
The exact current inventory is:

| Model | Direct | Relation | Raw SQL | Distinct source files | Direct full-row |
| --- | ---: | ---: | ---: | ---: | ---: |
| `Listing` | 100 | 35 | 11 | 56 | 14 |
| `Photo` | 9 | 29 | 0 | 24 | 2 |
| `ListingVariantGroup` | 3 | 9 | 0 | 7 | 1 |
| `ListingVariantOption` | 0 | 9 | 0 | 5 | 0 |

There are 57 files and 143 exact access-call records in the union. Raw SQL was
read separately and the installed database definitions were inventoried from
the complete chain; the scanner is not treated as behavior evidence by itself.

## Installed PostgreSQL 17 catalog inventory

The complete 466-migration chain was applied to a disposable PostgreSQL 17
database. The last migration is
`20261102040000_activate_seller_metrics_rls`; this is not a hand-built schema.
All four catalog tables currently have RLS and FORCE disabled, no policies,
and direct `SELECT`, `INSERT`, `UPDATE` and `DELETE` grants for the ordinary
runtime role.

| Installed object | Exact result |
| --- | ---: |
| Live functions whose body references at least one table in this domain | 123 |
| Security-definer functions among those | 121 |
| Functions executable by `grainline_app_runtime` | 94 |
| Functions executable by `grainline_staff_read_runtime` | 2 |
| Volatile / stable / immutable functions | 59 / 64 / 0 |
| Direct non-internal triggers on the four tables | 3 |
| Direct constraints on the four tables | 15 |
| Indexes on the four tables | 33 |
| Inbound foreign keys to the four tables | 12 |
| Dependent views reported by `information_schema.view_table_usage` | 0 |

All 121 security-definer consumers are owned by a superuser or BYPASSRLS role,
all pin `search_path`, and none of the 123 installed domain consumers is
executable by `PUBLIC`. The four temporary `grainline_probe_*` functions used
only in the disposable plan experiment are excluded from those production
counts and will be removed with the container.

The function families are not 123 prospective Listing functions. They are
the installed cross-domain authorities which happen to consume Listing data:
21 public seller/catalog functions, 11 seller-owner functions, two protected
seller-staff functions, 13 checkout functions, 11 order functions, eight case
functions, ten notification functions, nine favorite functions, three review
functions, 14 other listing functions and 21 deletion/other service
functions. Most remain valid bypass owners after base-table RLS. The audit must
verify their predicates and result shapes rather than replacing them with a
second parallel authority layer.

The only installed security-invoker consumers are
`grainline_conversation_inbox(...)` and `grainline_message_list(...)`.
`grainline_message_list(...)` is runtime-executable and its direct Listing
join would lose the retained context title once RLS hides the row. The inbox
function is not directly runtime-executable; the runtime calls it through
`grainline_conversation_inbox_owner(...)`, a security-definer function owned by
a bypass owner, so its nested Listing/Photo reads retain bypass semantics.
`grainline_seller_actor_conversation_context_listing(text)` already provides a
participant-safe title/photo projection and can replace the message-list join.
Granting every conversation participant generic catalog access is not an
acceptable shortcut.

The three Listing triggers are:

- `Listing_favoriteCount_guard`, which prevents ordinary runtime from writing
  a nonzero favorite-count projection;
- `grainline_listing_seller_public_state_bind`, which binds the public seller
  mirrors from the protected seller source; and
- `grainline_direct_upload_release_listing_delete`, which releases Listing
  media claims before hard deletion.

The inbound Listing references are CartItem, Conversation, Favorite,
ListingVariantGroup, ListingViewDaily, Message, OrderItem (two constraints),
Photo, Review and StockNotification. ListingVariantOption references
ListingVariantGroup. There are no inbound Photo or ListingVariantOption
references. Foreign-key behavior ranges from cascade and set-null to restrict;
the deletion proof must exercise all three rather than treating child cleanup
as an RLS concern.

The installed indexes cover the public visibility predicate, seller/state,
metro/category, price, ranking counters, tags and title/description trigram
search. The selected policy must keep those predicates directly visible to
the planner; a row-by-row security function around the whole public predicate
would need separate plan proof before acceptance.

### Caller families to reconcile

| Family | Representative callers | Audit state |
| --- | --- | --- |
| Public browse/search/home/tag/metro/sitemap | `src/app/page.tsx`, `src/app/browse/**`, `src/app/tag/[slug]/page.tsx`, `src/app/sitemap.ts` | Closed; direct vs bounded shapes assigned |
| Public/owner/reserved/staff detail | `src/app/listing/[id]/page.tsx`, seller shop/profile pages | Closed; actor-aware detail required |
| Owner create/edit/media/variant lifecycle | new/edit listing pages, shop actions, inventory/dashboard | Closed; fixed transitions/projections assigned |
| Checkout/cart/shipping/stock restore | `sellerTransactionAccess.ts`, `cartOwnerAccess.ts`, stock/session helpers | Closed; installed lock/idempotency authorities retained |
| Admin and AI moderation | admin review/listing routes, `ai-review.ts` | Closed; version/staff-role fixes classified |
| Analytics/search/counters | seller analytics, quality score, rating summary, homepage stats | Closed; system-write/bounded-read shapes assigned |
| Account export/deletion/retention | export route, `accountDeletion.ts`, `listingDelete.ts` | Closed; deletion lock protocol reconciled |
| Blog/review/custom-message references | blog editors, review routes/pages, custom-order route | Closed; history/target projections assigned |

The 57-file union has also been partitioned by intended authority. This is a
source reconciliation aid, not permission to skip the file-by-file behavior
read:

| Authority family | Representative direct consumers | Required disposition |
| --- | --- | --- |
| Public set reads | home, browse, metro/category, tag, seller shop, sitemap, public stats | Direct safe projection except bounded q/tag/suggestion paths |
| Public/participant detail | listing detail, similar listing, message context | Public safe row or exact participant/history projection |
| Owner reads and lifecycle writes | dashboard, inventory, listing editors, shop actions, blog editors | Actor-bound owner projections and fixed transitions |
| Checkout/cart/shipping | cart authorities, transaction source, stock/session restore | Existing or fixed transaction/service authorities; no generic package/reservation grant |
| Staff moderation | admin layout/review/reports/listing removal/undo | Protected staff read/write role and version-bound transition |
| Retained history | reviews, account reviews, customer photos, conversation inbox/messages | Purpose-bound projection independent of current public visibility |
| Service/repair | AI review, quality score, rating summary, alt-text backfill, account deletion | Fixed service authority with idempotency/version evidence |

### Exact 57-file source disposition

Every AST-confirmed source file has the following activation disposition. A
row marked direct may use only the pinned active-public columns and policy;
all other rows must stop depending on generic base-table authority.

| Source file | Current purpose | Activation disposition |
| --- | --- | --- |
| `src/app/about/page.tsx` | public count | bounded public aggregate |
| `src/app/account/reviews/page.tsx` | retained review title/photo | retained-history projection |
| `src/app/admin/layout.tsx` | pending-review count | protected staff aggregate |
| `src/app/admin/reports/page.tsx` | reported resource title | protected staff projection |
| `src/app/admin/review/page.tsx` | moderation queue/count/group | protected staff queue authority |
| `src/app/admin/reviews/page.tsx` | retained review title | protected staff/history projection |
| `src/app/admin/verification/page.tsx` | seller active count | protected staff aggregate |
| `src/app/api/account/export/route.ts` | complete owner export | bounded owner export authority |
| `src/app/api/account/feed/route.ts` | active-public followed listings | direct pinned public projection |
| `src/app/api/admin/listings/[id]/route.ts` | remove listing | protected, version-bound staff transition |
| `src/app/api/admin/reviews/[id]/route.ts` | review target owner | protected staff projection |
| `src/app/api/listings/[id]/stock/route.ts` | owner stock mutation | fixed owner stock authority |
| `src/app/api/messages/custom-order-request/route.ts` | active public target | bounded message/custom-order target authority |
| `src/app/api/reviews/[id]/reply/route.ts` | seller review target | bounded review-party target authority |
| `src/app/api/reviews/[id]/route.ts` | reviewer edit/delete target | bounded review-party target authority |
| `src/app/api/reviews/route.ts` | review creation target | bounded review/order target authority |
| `src/app/api/search/suggestions/route.ts` | public trigram suggestions | narrow indexed suggestion authority |
| `src/app/api/seller/analytics/route.ts` | owner counts/aggregates | owner analytics authority |
| `src/app/api/verification/apply/route.ts` | owner eligibility count | existing/bounded verification authority |
| `src/app/blog/[slug]/page.tsx` | selected same-shop cards | direct pinned public projection |
| `src/app/browse/[metroSlug]/[category]/page.tsx` | public filter/list/count | bounded public catalog filter authority |
| `src/app/browse/[metroSlug]/page.tsx` | public list/count/facets | bounded public catalog filter authority |
| `src/app/browse/page.tsx` | public search/filter/list/count | bounded public catalog filter authority |
| `src/app/dashboard/blog/[id]/edit/page.tsx` | owner featured-list choices | bounded owner summary projection |
| `src/app/dashboard/blog/new/page.tsx` | owner featured-list choices | bounded owner summary projection |
| `src/app/dashboard/inventory/page.tsx` | owner inventory rows | bounded owner inventory projection |
| `src/app/dashboard/listings/[id]/edit/page.tsx` | full owner edit lifecycle | owner editor projection plus fixed atomic transitions |
| `src/app/dashboard/listings/custom/page.tsx` | custom creation/review | fixed owner creation and version-bound review transition |
| `src/app/dashboard/listings/new/page.tsx` | ordinary creation/review | fixed owner creation and version-bound review transition |
| `src/app/dashboard/page.tsx` | owner list/lifecycle/delete | bounded owner list plus fixed transitions |
| `src/app/dashboard/profile/page.tsx` | owner listing cards | bounded owner summary projection |
| `src/app/dashboard/seller/page.tsx` | owner draft count | bounded owner aggregate |
| `src/app/dashboard/verification/page.tsx` | owner active count | bounded verification aggregate |
| `src/app/listing/[id]/page.tsx` | public/owner/reserved detail and similar | actor-aware detail plus safe similar-list authority |
| `src/app/page.tsx` | public home sets | direct pinned active-public projection |
| `src/app/seller/[id]/customer-photos/page.tsx` | retained review-photo target | retained-history projection |
| `src/app/seller/[id]/page.tsx` | public shop sets/count/reviews | direct public cards plus bounded aggregates/history |
| `src/app/seller/[id]/shop/actions.ts` | owner hide/sold/delete/media | fixed owner transitions and bounded media projection |
| `src/app/seller/[id]/shop/page.tsx` | public and owner shop list/count/facets | direct safe-column public list plus bounded public aggregates; actor-bound owner catalog for private/nonpublic states |
| `src/app/sitemap.ts` | public ids/tags | direct pinned active-public projection |
| `src/app/tag/[slug]/page.tsx` | tag list/count | bounded indexed public filter authority |
| `src/app/why-grainline/page.tsx` | public count | bounded public aggregate |
| `src/lib/accountDeletion.ts` | delete/redact/retain | existing deletion claim authority, no generic write |
| `src/lib/ai-review.ts` | recent seller titles | bounded service projection |
| `src/lib/audit.ts` | staff undo | protected, version-bound staff transition |
| `src/lib/cartOwnerAccess.ts` | cart display and add validation | pinned cart display/checkout source; no full Listing include |
| `src/lib/checkoutSessionExpiry.ts` | seller visibility after expiry | existing fixed transaction source |
| `src/lib/checkoutStockRestore.ts` | inventory restore | existing fixed lock/idempotency authority |
| `src/lib/foundingMaker.ts` | public eligibility ids | direct pinned active-public ids |
| `src/lib/homepageStats.ts` | public count | bounded public aggregate |
| `src/lib/listingDelete.ts` | owner delete/archive | fixed owner delete authority retaining lock protocol |
| `src/lib/listingStockMutation.ts` | owner stock lock | existing fixed stock authority |
| `src/lib/photoAltTextBackfill.ts` | service photo maintenance | bounded service authority |
| `src/lib/quality-score.ts` | ranking projection write | bounded service authority and system-only write |
| `src/lib/sellerRatingSummary.ts` | ranking aggregate | bounded service authority |
| `src/lib/sellerTransactionAccess.ts` | checkout/package source | existing/fixed transaction authority |
| `src/lib/sitemapSourceCounts.ts` | sitemap count | bounded public aggregate |

## Data classification

| Data | Classification | Notes |
| --- | --- | --- |
| Listing title, description, price, currency, public fulfillment fields, category, tags, materials and product dimensions | Public only while the row is publicly visible; owner/participant retained otherwise | Public search must not make a private/draft row visible |
| Displayed `Photo.url`, alt text and order | Public only through a public parent; owner/participant retained otherwise | Child policy derives from Listing |
| `Photo.originalUrl` | Owner/service purpose-bound | It may reveal uncropped source content and is excluded from generic public grants |
| Variant group/option labels, price adjustments, stock and order | Public only through a visible parent; owner/transaction retained otherwise | Checkout requires a consistent snapshot under the parent |
| `reservedForUserId`, `customOrderConversationId` | Purpose-bound relationship/routing | Never generic public output |
| AI flags/score, staff review fields, rejection reason | Owner and PIN-authorized staff; rejection reason is owner-facing | Never generic public output |
| Package dimensions/weight | Owner and transaction/service | Not required for catalog cards or anonymous detail |
| View/click/favorite counts and quality score | Public ranking inputs or bounded owner analytics, but system-controlled writes | Must not become owner-writable through a broad policy |
| Seller mirrors and metro ids | Public predicate/search inputs | Trigger/service-controlled, not owner mutations |
| `archivedAt`, `status`, `priceVersion`, stock | Lifecycle/control | Reads vary by principal; writes require state/lock checks |

The generic active-public manifest is explicit and fail-closed. It may grant
only these existing columns (a future column is private until reviewed):

- `Listing`: `id`, `sellerId`, `title`, `description`, `priceCents`,
  `currency`, `status`, `createdAt`, `updatedAt`, `videoUrl`, `tags`,
  `processingTimeMinDays`, `processingTimeMaxDays`, `listingType`,
  `stockQuantity`, `shipsWithinDays`, `category`, `clickCount`, `viewCount`,
  `isPrivate`, `cityMetroId`, `metroId`, `qualityScore`, `materials`,
  `metaDescription`, `productHeightIn`, `productLengthIn`, `productWidthIn`,
  `sellerPubliclyOrderable`, `sellerDisplayName`,
  `sellerDisplayNameNormalized`, `sellerAverageRating`, `sellerReviewCount`
  and `favoriteCount`;
- `Photo`: `id`, `listingId`, `url`, `sortOrder`, `createdAt`, `altText`;
- `ListingVariantGroup`: `id`, `listingId`, `name`, `sortOrder`;
- `ListingVariantOption`: `id`, `groupId`, `label`, `priceAdjustCents`,
  `sortOrder`, `inStock`.

`priceVersion`, package fields, reservation/conversation routing, moderation
state, rejection reason, AI evidence, archive state and `Photo.originalUrl`
are excluded from the generic manifest. Fixed owner, detail, transaction,
history, staff and service authorities return only the additional fields their
contract requires.

## Current visibility predicates

The current source distinguishes at least three listing read contracts:

1. **Public browse:** `ACTIVE`, `isPrivate = false`, `archivedAt IS NULL`,
   `sellerPubliclyOrderable = true`.
2. **Public detail:** the same predicate but status may be `ACTIVE` or
   `SOLD_OUT`.
3. **Participant detail:** owner preview for any unarchived state; exact
   reserved buyer for `ACTIVE` or `SOLD`; PIN-authorized staff preview.

Routes also add reciprocal-block filters, category/tag/metro/search filters and
different ordering. The selected database design must not collapse these into
one route-independent application assumption.

## State-machine, lock and recovery reconciliation

- Creation writes Listing, Photo, variants and upload claims in one
  transaction, then assigns metro separately and runs AI review out of
  transaction.
- The creation AI result updates a row by `id + PENDING_REVIEW` but does not
  bind the exact reviewed content version. This is now executed and confirmed:
  a synthetic row was reviewed as version 1, withdrawn and edited, resubmitted
  as version 3, and the stale version-1 approval updated one row and activated
  the version-3 content. Custom-listing creation and ordinary edit already bind
  `updatedAt`. Ordinary creation must capture and bind the reviewed version.
- Editing correctly keeps listing, variant replacement, photo replacement,
  upload claims and listing-type stock mutation in one transaction, but later
  AI state transitions happen separately and must remain version bound.
- The ordinary edit path computes the public status before AI review. The
  stock mutation route can change stock/status while the listing is pending;
  the final AI transition therefore must bind the reviewed version and derive
  the publishable status from the locked current row, not restore a stale
  pre-review value.
- Staff review is protected by the staff role but does not take an expected
  `updatedAt` or content version. Staff removal reads before entering its
  transaction and records the pre-read as audit evidence. Both transitions
  must be version bound before activation.
- Listing deletion locks the parent `Listing` `FOR UPDATE`, inspects retained
  references and refuses deletion while a `RESERVED` or `SESSION_CREATED`
  checkout references the listing. Both cart and Buy Now reservation creation
  lock each target Listing `FOR UPDATE` before inserting the reservation. The
  former hard-delete/checkout race is therefore closed by serialization: the
  loser waits and then observes either the reservation or the deleted row.
  Activation still needs an executed two-session regression test so this lock
  protocol cannot silently regress.
- Cart and checkout currently traverse Listing/Photo/variant relations through
  already-live Cart RLS. Catalog activation must convert or authorize those
  exact nested reads; otherwise the previously locked Cart flow will regress.
- Public search needs flexible set-based filtering, grouping, ranking and
  pagination. This is the primary scalability test for the options comparison.

| Mutation family | Locks/version binding now | Recovery/idempotency | Activation disposition |
| --- | --- | --- | --- |
| Create ordinary/custom | transaction for row/children/claims; AI later | AI result retries by state; ordinary path lacks exact version | fix ordinary version binding; preserve atomic source |
| Edit and resubmit | parent/children in one transaction; later AI uses version in most paths | replacement rolls back atomically | derive final state from locked version; regression for stock race |
| Stock change/restore | dedicated Listing lock and replay-aware SQL | checkout restore is idempotent | retain existing authority; forbid generic writes |
| Hide/unhide/sold/available/publish/withdraw | app precondition plus conditional update | caller retries after stale count | move to actor-bound fixed transitions |
| Delete/archive | Listing `FOR UPDATE`, reference and order checks | full transaction rollback; media release tracked | preserve protocol; add two-session reservation race test |
| Staff approve/reject/remove/undo | protected role, but incomplete version evidence | AdminAuditLog supports undo | version-bind review/removal and keep staff role |
| Checkout reserve/bind/complete/restore | stable user/seller/listing locks; durable reservation | Stripe idempotency plus durable source snapshot | retain installed authorities; no generic package/stock access |
| Favorites/reviews/counters | dedicated authorities/triggers | aggregate repair exists | system-only writes; correct ranking semantics before activation |
| AI/quality/alt-text backfills | service-specific scans and updates | rerunnable batches vary | fixed service authority, bounded batch and version evidence |

## Executed behavior and plan proofs

The disposable proof database is the complete 466-migration PostgreSQL 17
chain, not a hand-built schema. The following evidence has been executed with
an ordinary login that does not own or bypass the tables:

- the rejected mixed-principal policy exposed 46,000 of 50,000 seeded rows,
  admitted an unarchived owner draft and exact reserved-buyer row, rejected an
  unrelated/banned actor and denied the owner's archived row;
- the selected generic policy exposes only `ACTIVE`, non-private, unarchived,
  seller-orderable rows. Owner, reserved-buyer and sold-out detail rows are
  intentionally absent and must come from bounded authorities;
- displayed child batches used their foreign-key indexes plus the Listing
  primary key (0.08–0.09 ms in the representative four-row plans);
- a real Prisma relation query returned safe Listing, Photo and variant fields;
  unsafe Photo original, package and moderation selections failed at the
  database boundary;
- direct category/rank predicates remained indexable, but RLS prevented
  trigram and tag-GIN pushdown: a five-row title search took 21.47 ms instead
  of 0.19 ms, and a 50-row rare-tag query took 10.56 ms instead of 0.11 ms;
- changing the policy from mixed-principal to active-public-only restored a
  category newest-page plan from 11.33 ms to 0.109 ms (0.153 ms without RLS),
  a three-id fetch to 0.067 ms and a seller page to 1.07 ms. `ILIKE`, array
  containment and enum count filters remained fenced because PostgreSQL marks
  their operators non-leakproof;
- a bounded security-definer search-id prototype restored selective title/tag
  paths to 0.59–0.74 ms before safe row fetch, while a common 25,000-row tag
  page plus safe fetch completed in 6.55 ms warm and its count in 5.80 ms;
- a non-security-barrier view restored a fast plan but was rejected because it
  is not a safe boundary against caller-supplied leaky predicates; a security-
  barrier view retained the slow plan.

The plan evidence changes the design: ordinary safe reads remain direct, but
q/tag/suggestion filters require bounded public search contracts. The final
proof must repeat these plans on the exact proposed migration and include a
regression threshold which fails on sequential visible-row scans for selective
queries.

## Verified findings and gate classification

| Finding | Classification | Closure required |
| --- | --- | --- |
| Ordinary listing creation accepts a stale AI result for a newer resubmission | `FIX_BEFORE_ACTIVATION` | Bind the result to the captured `updatedAt`/content version; failing-first race/state test |
| Pure mixed-principal RLS hides ordinary public ordering and non-leakproof filter indexes | `BLOCKS_RLS_DESIGN` | Resolved in design by active-public-only generic policy plus bounded filter/suggestion authorities; exact migration plan gate still required |
| Runtime `grainline_message_list` directly joins Listing for retained context | `FIX_BEFORE_ACTIVATION` | Reuse the installed participant-safe conversation-context authority; hidden/archived context regression test |
| Generic public grants cannot include reservation routing, moderation fields, package dimensions or `Photo.originalUrl` | `BLOCKS_RLS_DESIGN` | Pinned reviewed column manifest; unsafe-column and `SELECT *` denial proof |
| Owner editor/export needs fields excluded from generic grants | `FIX_BEFORE_ACTIVATION` | Bounded owner editor/export projections; active owner and cross-user tests |
| Staff review does not bind the content version; listing removal reads/audits state before its transaction; staff list/count reads use ordinary Prisma | `FIX_BEFORE_ACTIVATION` | Protected staff projections and version-bound transitions. Middleware already enforces the PIN on `/api/admin/**`; this is not a live PIN bypass |
| Retained review/message views cannot disappear merely because a listing is hidden or archived | `FIX_BEFORE_ACTIVATION` | Purpose-bound historical projections with party/staff tests |
| No constraint prevents a public listing row from retaining reservation ids | `BLOCKS_RLS_DESIGN` | Exclude routing columns from generic grants and enforce/repair the intended public/private invariant before activation |
| Similar-list ranking returns nullable `categoryMatch`, which strict result validation turns into a page error | `FIX_BEFORE_ACTIVATION` | Coalesce in SQL and execute an uncategorized-candidate behavior test |
| Ranking treats a zero-review summary as zero rather than marketplace fallback and does not cap click-through rate at one | `FIX_BEFORE_ACTIVATION` | Apply the reviewed ranking correction and behavior tests for removed-last-review and click-only traffic |
| Materials entries have no per-item storage limit | `FIX_BEFORE_ACTIVATION` | Choose and enforce a code-point and database bound; prove existing inventory fits or repair first |
| Ordinary edit can restore a pre-AI status after concurrent stock state change | `FIX_BEFORE_ACTIVATION` | Lock/version-bind final transition and derive status from current stock/type; failing race test |
| `publishListingAction` ignores a failed custom-ready message delivery | `FIX_BEFORE_ACTIVATION` | Surface/retry the durable delivery result without rolling back a committed publish |
| Featured-listing removal first requires the Listing to exist, so hard-deleted stale ids cannot be removed and consume the six-slot cap | `FIX_BEFORE_ACTIVATION` | Permit owner-bound removal of a stale id; executed regression |
| Seller suggestion uses unescaped `%`/`_` patterns | `STALE_CLOSED` | Current `grainline_seller_public_name_suggestions` escapes `\\`, `%` and `_` and uses an explicit `ESCAPE` clause for both raw and normalized patterns. Retain a literal-input regression test in the Listing preparation proof. |
| Upload cleanup would delete inline blog images and retained listing photos not registered as live | `DEFERRED_PRODUCT_WORK` | Keep cleanup unscheduled until the upload-reference findings are fixed and the dry-run is empty; not a reason to weaken catalog RLS |

### Reconciliation of high-signal audit allegations

| Allegation | Current result on this source |
| --- | --- |
| Buy Now variants charge without order (`#1218`) | Fixed in ancestor `c2546eae0`; metadata now carries the exact variant key. Keep end-to-end paid-order coverage. |
| Hard delete races checkout (`#423/#567`) | Stale. Both paths lock the same Listing before reservation insert/reference decision. Add an executed two-session regression. |
| Similar-list uncategorized row crashes (`#1193`) | Valid and still open on this branch. |
| Review/ranking integrity (`#1194/#1195`) | Valid and still open; reviewed side-branch patch is not an ancestor. |
| Favorite cleanup/count guard (`#1396/#1399`) | Stale. Current removal order and the BEFORE guard/lock protocol close both claims. |
| Inline upload cleanup (`#171`) | Valid, but cleanup is not scheduled. Classified deferred with an explicit schedule blocker. |

No finding above authorizes an implementation before this audit's GO gate.

## Authority matrix (draft)

| Operation | Principal | Intended authority |
| --- | --- | --- |
| Search/list/count/group public rows | Anonymous or active viewer | Safe columns, public-browse predicate, optional reciprocal-block filter |
| Read public detail | Anonymous or active viewer | Safe detail columns and displayed children for active/sold-out public row |
| Read owner listing/editor | Active owning seller | Exact unarchived owned row, pre-crop photos, variants and owner review state |
| Read reserved custom listing | Exact active reserved buyer | Bounded detail only; no generic owner/moderation fields |
| Read moderation queue/detail | PIN-authorized staff role | Bounded staff projection and version/state evidence |
| Create/edit/publish/hide/sell/delete | Active owning seller | Fixed actor-bound state transition; atomic child/upload/stock work |
| Moderate approve/reject/undo | PIN-authorized staff capability | Fixed version/state-bound transition with audit evidence |
| Checkout/cart/quote | Active exact buyer | Fixed transaction source; public or exact reserved listing only |
| Stock restore/record | Signed checkout/webhook or reviewed service authority | Existing lock/idempotency protocol; never generic catalog update |
| Export/delete | Exact user or active deletion claim | Complete owner/relationship export; bounded deletion/redaction and retained-order safety |
| AI review/backfill | Fixed service path | Exact content version, bounded moderation writes and owner-scoped media |
| Ranking/analytics/counters | Fixed service/trigger or owner-safe read | System-controlled writes; bounded indexed reads |

## Activation evidence still required

The audit gate is closed, but activation remains blocked until preparation
provides all of the following on the exact candidate:

1. Failing-first/current-main then passing behavior tests for every
   `FIX_BEFORE_ACTIVATION` row above, including the two-session checkout/delete
   race.
2. Full-chain PostgreSQL 17 proof for anonymous, signed-in public, owner,
   reserved buyer, unrelated buyer, blocked pair, inactive owner, protected
   staff, checkout, retained history, export, deletion and service principals.
3. A generated and pinned safe-column manifest, `SELECT *` and restricted-
   column denials, and a catalog diff proving no accidental table/function
   authority.
4. Plan thresholds for direct active-public newest/seller/exact-id pages and
   bounded title/tag/category/facet/count/suggestion queries at representative
   volume. A selective query may not fall back to scanning all visible rows.
5. Complete predecessor/app coexistence proof, database-first emergency
   rollback proof and exact compatible-app/deploy binding.
6. Focused tests plus typecheck, lint, full tests, build and dependency audit.
7. Coverage-matrix and strategy updates that distinguish preparation from
   activation and preserve this NO-GO until the acceptance record passes.

## Decision

**Decision: GO for isolated preparation; NO-GO for activation.** All 57 source
files, 143 exact access calls, installed PostgreSQL objects, principal shapes,
state/lock families, high-signal allegations and representative scale plans
have been reconciled. The selected design is the public-only hybrid Option A:
generic runtime reads see only active-public rows and pinned safe columns;
non-leakproof filters and every non-public principal use bounded authorities.

This GO permits implementation, tests and disposable-database proof only on
the isolated branch. It does not permit a PR, merge, deploy or Production
action. Activation remains blocked by the exact closure/evidence list above.

## Activation candidate acceptance update (2026-11-02)

The exact four-table activation candidate now closes the local behavior,
catalog, rollback and performance gates in items 2 through 4 above. The final
PostgreSQL 17 full-chain run applied 468 migrations and passed the direct-role,
rollback/reactivation and 50,000-row plan scenarios. A real provisioning replay
regression that widened Listing back to CRUD was found by this proof and fixed;
the role provisioner and global audit now pin the four policy expressions and
safe-column ACLs.

Activation remains NO-GO for Production until the candidate receives
independent review and a compact reusable release binding is implemented and
proved. No deployment, merge or Production database operation was performed.

## Preparation progress: residual mutation authorities (2026-11-02)

The preparation now removes three additional direct Listing-family mutation
paths without changing the activation decision:

- owner AI alt-text backfill is actor-bound, exact-photo-sequence-bound and
  preserves nonempty seller text;
- legacy checkout stock restoration combines the durable Session claim and
  mutation atomically, with exactly-once replay behavior;
- Listing-family account deletion is bound to the exact active local-anonymize
  side-effect claim rather than a caller-selected seller id.

All three were exercised after a clean 467-migration PostgreSQL 17 build. The
candidate migration and every full-chain scenario passed. This is preparation
evidence only; it does not authorize activation, deployment or Production
changes. The remaining activation gates in this audit continue to apply.

## Independent candidate review update (2026-11-02)

The immutable candidate range
`7060b504a9f4503af26dd11a14e316fa89ed93b8..054bc861d388cd240ace591bee9bbb2877357cac`
received a complete Codex Security diff review. All 103 generated review items
were closed across the public catalog, RLS policies, owner and staff authority,
checkout/cart, retained history, account lifecycle, release tooling, rollback
and PostgreSQL proofs. The completed scan
`9e5dbeca-ed52-4c64-9d58-473037a2e9c4` reported zero security findings.

The review found one non-security compatibility defect: browse sends the
`relevant` sort and PostgreSQL implements it, but the TypeScript boundary did
not accept it. Commit `8078bc5fcb3e0c0acdc3a371137f1a2b5715d916`
adds that existing sort to the boundary and pins it with a focused regression;
the 38-test Listing suite passes.

Draft PR #732 is deliberately stacked on the SellerMetrics activation branch
so that its diff contains only the Listing-domain successor. It is evidence and
CI coordination only. Activation remains **NO-GO for Production** until every
predecessor is released, the candidate is rebased onto the exact released
chain, exact-head CI and PostgreSQL 17 full-chain proofs pass again, and the
protected release admission is separately approved.
