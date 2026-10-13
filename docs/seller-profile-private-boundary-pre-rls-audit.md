# SellerProfile private-boundary pre-RLS audit

Date: 2026-10-13 (America/Chicago)

Exact source reviewed: `311fc18835ccdfac87b64b5c60584b2de3f85b49`

## Decision

`SellerProfile` is not ready for an RLS policy, grant reduction, or column
removal. It is ready for an additive compatibility phase that introduces a
one-to-one private operational row, an explicit public projection contract,
and transition guards while the existing row remains authoritative.

The safe order is:

1. add and backfill a private operational companion without removing or
   changing predecessor columns;
2. keep old and new representations transactionally synchronized during the
   deployment-skew window;
3. convert application and currently effective database-function callers to
   explicit public, owner, staff, Stripe, shipping, cron, export, deletion and
   repair operations;
4. deploy and prove the converted application, drain predecessor deployments,
   and inspect the installed function/grant catalog;
5. remove predecessor private columns and broad ordinary-runtime access in a
   separately reviewed release; then design and activate the final
   SellerProfile RLS posture.

Do not pair this release with `CommissionRequest`. Both models have mixed
public/private data, but their principals, lifecycle and recovery paths are
different. Combining them would enlarge rollback and make failures harder to
attribute.

## Intended product behavior

SellerProfile has four distinct products sharing one row today:

1. **Public maker identity and shop presentation.** Public users may see the
   maker's chosen name, profile content, public badges, public policy and
   fulfillment options, public city/state, visible vacation state and eligible
   listings.
2. **Conditional map disclosure.** Exact `lat`/`lng` may be published only when
   the seller explicitly chose `publicMapOptIn` and the privacy radius is null
   or zero. Otherwise public surfaces may use an approximate or privacy-safe
   location but must not receive the exact coordinates.
3. **Seller-private operations.** The seller may manage Stripe onboarding,
   ship-from contact/address, package defaults, carrier preferences,
   onboarding state and analytics.
4. **Staff/service operations.** Signed Stripe webhooks, checkout, Shippo,
   account deletion, ban/unban, Guild review/metrics, staff verification,
   export and repair jobs need narrow subsets. Their need to read or update a
   field does not make that field public or owner-writable.

Application-layer authentication and authorization remain primary. The split
and later RLS/grant work reduce the blast radius of an ordinary runtime
credential compromise and prevent a future broad public projection from
returning private seller data.

## Current row classification

### Public or intentionally discoverable profile fields

- identity and presentation: `id`, `displayName`,
  `displayNameNormalized`, `ownerImageUrl`, `bio`, `city`, `state`,
  `tagline`, profile/story/media/social fields, `yearsInBusiness`, policies,
  featured listing/gallery fields;
- public selling features: `acceptsCustomOrders`, `acceptingNewOrders`,
  `customOrderTurnaroundDays`, gift-wrap fields, flat/free shipping display
  values and `allowLocalPickup`;
- public badges and presentation: `isVerifiedMaker`, `verifiedAt`,
  `guildLevel`, founding-maker fields, `featuredUntil`, metro identifiers;
- public availability snapshots: `ownerAccountActive`, `chargesEnabled`,
  `vacationMode`, `vacationReturnDate`, `vacationMessage`; and
- ordinary timestamps where a caller intentionally selects them.

These fields are eligible for a bounded public projection. That is not a
decision to grant `SELECT *` on the base table. `userId`, internal timestamps
or ranking inputs should remain omitted unless the reviewed operation needs
them.

### Conditional public fields

- `lat` and `lng` are exact seller-chosen coordinates. They are public only
  when `publicMapOptIn = true` and `radiusMeters` is null or zero.
- `radiusMeters` and `publicMapOptIn` control the disclosure decision. Public
  callers should receive a pre-checked map projection, not raw coordinates
  followed by masking in rendering code.

Current `/map`, `/sellers/map`, seller JSON-LD and map-card paths apply that
condition. The dashboard intentionally stores an exact pin. This is a
conditional projection requirement, not a claim that all coordinates are
private or all coordinates are public.

### Private operational fields to move

- Stripe/provider state: `stripeAccountId`, `stripeAccountVersion`,
  `stripeControllerType`, `manualStripeReconciliationNeeded`,
  `manualStripeReconciliationNote`;
- ship-from identity and contact: every `shipFrom*` field;
- package/provider preferences: every `defaultPkg*` field,
  `preferredCarriers`, and `useCalculatedShipping`;
- seller workflow state: `onboardingStep`, `onboardingComplete`;
- staff/cron state: `guildMemberApprovedAt`, `guildMasterApprovedAt`,
  `guildMasterAppliedAt`, `guildMasterReviewNotes`,
  `consecutiveMetricFailures`, `lastMetricCheckAt`, `metricWarningSentAt`,
  `listingsBelowThresholdSince`; and
- private analytics: `profileViews`.

`chargesEnabled` currently participates in many public visibility predicates.
`stripeAccountVersion` also participates, but is provider diagnostic state.
The compatibility design should add a public-safe supported/orderable snapshot
derived transactionally from the private provider state rather than leave the
diagnostic value in the final public projection.

The exact placement of non-sensitive shipping configuration such as flat-rate
amounts and local-pickup availability is an implementation choice, provided
buyer/public projections remain explicit and the private address/contact fields
can never be selected with them accidentally.

## Current access inventory

The source scan found 92 direct Prisma `SellerProfile.findUnique`,
`findFirst`, or `findMany` calls. The three direct reads that returned all
scalar fields have now been converted to explicit projections:

- `src/lib/ensureSeller.ts` (authenticated seller bootstrap);
- `src/app/dashboard/seller/page.tsx` (authenticated seller settings); and
- `src/app/dashboard/profile/page.tsx` (authenticated seller profile editor,
  with FAQs).

The nine nested Listing/Cart reads that used `seller: true` have been converted
to explicit projections:

- three checkout/shipping helpers in `src/lib/cartOwnerAccess.ts`;
- three authenticated seller dashboard queries;
- cart-add and shipping-quote routes; and
- the authenticated seller shop action ownership lookup.

The converted checkout and quote projections retain only the provider fields
that those paths currently require; dashboard ownership checks select only the
owner id, and the shop action adds the seller display name required for
notification fanout. A recursive source guard now rejects any reintroduction
of `seller: true`. Public seller, listing, browse, map and card pages also use
narrow projections. This audit did not confirm a current public response
leaking ship-from, provider or reconciliation data.

The recursive guard now rejects both broad direct reads and nested
`seller: true` relations. It does not yet classify all future sensitive-field
additions by principal, so the separate public/owner/staff/service field
allowlists remain `FIX_BEFORE_ACTIVATION` work.

Historical SQL is also a compatibility dependency. The source contains 116
migration files that mention SellerProfile. Multiple currently relevant Order,
Case, User, Notification, Conversation and service-ledger functions read
SellerProfile rows or operational fields. Applied migration bytes must remain
immutable. Any effective function that depends on a moved field must be
redefined additively before the predecessor column is dropped.

## Operation-by-principal authority matrix

| Principal | Intended operations | Required result/authority |
| --- | --- | --- |
| Anonymous/public | Browse active makers/listings, public seller page, public blog/review identity, opt-in map pins | Bounded public profile projection; exact coordinates only after the database-side opt-in/radius condition; no private row |
| Authenticated buyer | Public reads plus cart, quote, checkout, follow, message/custom-order and commission eligibility | Public projection plus purpose-bound orderability and shipping quote operations; never return ship-from contact/address |
| Seller owner | Create/bootstrap profile; edit public profile, location, shipping, package and vacation settings; inspect own onboarding, Stripe and analytics | Owner-bound read/update operations derived from the authenticated local User id; private and public changes may be atomic |
| Signed Stripe webhook/reconciliation | Match exact provider account; update connection/reconciliation state | Fixed provider-account lookup/update; no general seller scan or public-profile mutation |
| Checkout/Order/Shippo | Prove current seller eligibility, destination account and ship-from/package inputs | Fixed transactional projections used by already-reviewed Order/quote/label authorities; no general private-table read |
| Staff with required step-up | Verification, Guild approval/rejection, feature, ban/unban and reviewed support actions | Purpose-bound staff projection/mutation with existing PIN/capability/audit requirements |
| Cron/repair worker | Guild thresholds/metrics, Stripe repair, account-deletion side effects, media/reference cleanup | Fixed batch claim or exact-target operations with bounded paging and retry-safe state |
| Account export | Export the authenticated owner's complete seller data, including ship-from/provider metadata where required | Owner-bound export projection; private data remains private in transport/cache controls |
| Account deletion | Lock/snapshot, provider cleanup, redact/reset public and private state atomically | Fixed deletion operations preserving existing lock order, side-effect journal and retry semantics |
| Direct-upload/media lifecycle | Verify seller ownership and exact durable profile-media references | Id/reference-only operations; no private operational fields |

## Product, correctness and scale findings

### `BLOCKS_RLS_DESIGN`

1. **Mixed public/private row.** A public row policy would expose private
   columns; an owner-only policy would break public catalog reads. Split or
   fixed public projections are required.
2. **Provider diagnostic in public eligibility.** Public visibility currently
   reads `stripeAccountVersion`. Replace it with a transactionally maintained
   public-safe availability snapshot or a fixed eligibility operation before
   moving provider state.
3. **Installed database-function dependencies.** Effective functions must be
   inventoried by name/body/grant and additively redefined before any moved
   column is dropped. Historical migration search alone is not sufficient.
4. **Deployment skew.** Existing and new deployments must work against the
   same schema during rollout. A one-step move would break either predecessor
   or successor code.
5. **Atomic cross-row lifecycle.** Seller settings, Stripe state, ban/deletion,
   Guild state and public availability snapshots must not diverge between the
   public and private rows. Transition triggers/functions and later fixed
   operations must preserve one transaction and a documented lock order.

### `FIX_BEFORE_ACTIVATION`

1. Keep the converted zero-count invariant for broad direct reads and nested
   `seller: true` relations; add principal-specific sensitive-field allowlists
   as private operations replace predecessor reads.
2. Add a recursive source guard with an exact sensitive-field inventory and
   reviewed public/owner/staff/service allowlists.
3. Move conditional coordinate disclosure into a bounded database or server
   authority so public callers cannot receive non-opted-in coordinates.
4. Prove checkout/quote/label, Stripe webhook/reconcile, seller settings,
   staff verification/Guild, ban/unban, export/deletion and upload-reference
   paths on the converted schema.
5. Inspect and pin the installed function and grant catalog, then prove direct
   ordinary-runtime/PUBLIC denial for the private table and the intended final
   SellerProfile authority.
6. Add rollback that restores predecessor representation and grants before an
   old application deployment can receive traffic.

### `DEFERRED_PRODUCT_WORK`

- Replacing the existing multi-item one-parcel shipping heuristic is unrelated
  to this authority boundary. The split must preserve current behavior.
- A dedicated service database role can further isolate cron/provider work,
  but fixed operations and zero broad private-table access are sufficient for
  this boundary.
- Product changes to public map semantics, Guild badges, seller analytics or
  shipping presentation require separate decisions and must not be smuggled
  into the split.

## Scalability and maintainability

- Keep the public row one-to-one with the private row using the existing
  SellerProfile id as the private primary/foreign key. Avoid a second lookup
  key and preserve deterministic joins.
- Batch worker reads by stable `(id)` or existing purpose-specific cursors;
  do not introduce unbounded private-table scans.
- Preserve existing public listing/search query shapes. A broad per-card join
  to the private table is rejected; public eligibility must be available from
  the public row or a bounded set-oriented operation.
- Do not duplicate every field permanently. Dual representation is temporary
  compatibility state with convergence checks and a retirement release.
- Keep public, owner-private, Stripe, shipping, staff/cron and deletion access
  modules separate enough that future field additions have an obvious
  authority class.

## Release gates

### Phase 0: additive preparation — **GO**

The next implementation may add the private table, constraints, exact backfill,
temporary synchronization and a public-safe availability snapshot. It must not
drop predecessor columns, revoke predecessor grants, enable RLS, change live
provider behavior or require the new application before it is deployed.

The isolated Phase 0 candidate now implements that exact boundary in
`20261013120000_prepare_seller_profile_private_boundary`. `SellerProfile`
remains authoritative, and one-way triggers maintain the private companion and
the derived `stripeAccountSupported` snapshot. The migration gives neither
`PUBLIC` nor `grainline_app_runtime` direct companion-table or trigger-function
authority.

Focused source tests pass, Prisma schema validation passes, and
`scripts/seller-profile-private-boundary-postgres-proof.mjs` executed the exact
migration bytes on disposable PostgreSQL 16. The rollback-only proof covered
three-row backfill, supported/legacy/unlinked provider states, insert and update
mirroring, non-private-update isolation, check-constraint enforcement, actual
runtime-role direct-read denial, effective runtime CRUD denial, function
EXECUTE denial, delete cascade and
catalog cleanup after rollback. This proves the candidate's additive SQL
semantics; it is not evidence that the migration is installed in Production.

The protected Production operator is prepared separately in
`.github/workflows/seller-profile-private-boundary-production.yml`. It binds a
first-attempt manual dispatch to an unchanged main commit and that commit's
successful push CI, verifies the exact migration digest, requires the accepted
listing-lifecycle migration as its exact predecessor, rejects partial catalog
state, and admits only this one pending migration. Its postflight compares the
predecessor table posture, companion/public row counts and every mirrored
private field, the derived support snapshot, constraints, triggers, function
bodies and effective `PUBLIC`/runtime authority before running the global grant
audit. Evidence contains counts and catalog posture only. The operator neither
deploys the application nor enables RLS, and its source availability is not
evidence of a Production dispatch.

### Phase 1: compatible application conversion — **GO for isolated source work**

The disposable PostgreSQL prerequisite is satisfied. Isolated source work may
now convert callers, but the converted application must not be deployed until
Phase 0 is accepted in Production. Prove account-deletion reset and each caller
family as it moves; use focused tests during conversion and batch full test,
lint and build at the cohesive merge/deploy boundary.

The first isolated Phase 1 slice now converts public maker, listing, blog,
search, commission-interest, stock-notification and conversation-eligibility
callers from the private diagnostic `stripeAccountVersion` to the derived
public-safe `stripeAccountSupported` snapshot. It deliberately leaves exact
provider-version reads in checkout, Stripe Connect, reconciliation, export and
account-deletion paths, where the diagnostic value controls provider-specific
behavior or recovery. A focused source guard prevents the reviewed public
paths from reintroducing the private provider version. TypeScript and 116
focused tests pass for this slice. This is prepared source only; it must stay
stacked behind Phase 0 and is not evidence of a Production schema or
application change.

The second isolated Phase 1 slice removes every nested `seller: true` read.
Checkout and shipping share explicit seller-state projections; dashboard and
shop ownership checks request only the fields they consume. A recursive source
guard makes the zero-count invariant durable. Exact provider-version reads
remain intentionally limited to checkout eligibility until that family moves
to purpose-bound private operations.

The third isolated Phase 1 slice converts the authenticated seller bootstrap,
shop-settings page and profile editor to explicit projections. The recursive
guard now proves zero direct SellerProfile reads without a `select` and zero
nested `seller: true` reads across `src`.

The fourth isolated slice funnels Stripe Connect owner onboarding/status,
dashboard links, scheduled account reconciliation and signed-webhook capability
mirroring through `sellerStripePrivateAccess.ts`. The compatibility module still
uses exact predecessor projections because Phase 0 intentionally gives the
ordinary runtime no direct access to `SellerProfilePrivate`; deploying a raw
Prisma relation switch would fail. With the route and worker family centralized,
the post-Phase-0 operation migration can replace one implementation boundary
with fixed owner/provider functions while preserving caller behavior and the
audit-plus-capability-update transaction.

The fifth through ninth isolated slices centralize the remaining shipping
quote inputs, owner onboarding/export reads and writes, staff ban/unban/undo
seller state, and account-deletion seller mutations. Cart and single-listing quote paths now
share one exact fulfillment projection; account export retains every reviewed
owner field without leaving that projection embedded in the route; each
onboarding mutation is owner-bound and purpose-specific; staff
orderability changes share a single compatibility boundary while preserving
the existing user capability, audit and checkout-expiry protocol; and account
deletion now pauses and anonymizes the expected user-owned seller row through
one fail-closed boundary. Focused source/behavior suites and TypeScript pass for
each slice.

These compatibility modules still read and write the predecessor table. That
is intentional until Phase 0 is installed because ordinary runtime has zero
direct authority on the companion. Phase 1 remains incomplete: seller profile
and shop-settings writes, Guild/cron state, checkout and currently effective
SQL-function dependencies must move to purpose-bound private operations before
predecessor columns can be retired.

### Phase 2: private-boundary cutover and RLS/grants — **NO-GO**

Do not activate until all `BLOCKS_RLS_DESIGN` and `FIX_BEFORE_ACTIVATION`
items close, predecessor deployments are drained, effective SQL functions are
redefined and inspected, converted runtime smoke passes, and the exact rollback
order is reviewed. RLS activation remains a separate decision after the split
is accepted in Production.
