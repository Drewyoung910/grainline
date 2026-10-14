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

The migration bounds its Production transaction with a 10-second lock timeout
and a 120-second statement timeout. Lock contention or an unexpectedly slow
backfill therefore fails the run without leaving partial schema state, so the
operator can investigate and retry rather than waiting indefinitely on the
Production writer.

Focused source tests pass, Prisma schema validation passes, and
`scripts/seller-profile-private-boundary-postgres-proof.mjs` executed the exact
migration bytes on disposable PostgreSQL 16. The rollback-only proof covered
three-row backfill, supported/legacy/unlinked provider states, insert and update
mirroring, non-private-update isolation, check-constraint enforcement, actual
runtime-role direct-read denial, effective runtime CRUD denial, function
EXECUTE denial, delete cascade and
catalog cleanup after rollback. This proves the candidate's additive SQL
semantics; it is not evidence that the migration is installed in Production.

The protected Production operator is recorded separately in
`.github/workflows/seller-profile-private-boundary-production.yml`. It binds a
first-attempt manual dispatch to an unchanged main commit and that commit's
successful push CI, verifies the exact migration digest, requires the accepted
listing-lifecycle migration as its exact predecessor, rejects partial catalog
state, and admits only this one pending migration. After the nine reviewed
caller migrations landed on main, the operator was tightened to hold and
exactly identify the complete successor set while it checks and applies Phase
0, then prove that all successors remain pending afterward. Its postflight compares the
predecessor table posture, companion/public row counts and every mirrored
private field, the derived support snapshot, constraints, triggers, function
bodies and effective `PUBLIC`/runtime authority before running the global grant
audit. Evidence contains counts and catalog posture only. Production run
`38507108254` installed Phase 0 but its stale global grant expectation failed
after the exact catalog/data postflight. The corrected restart-safe recovery
run `38514343739` then detected the migration as already applied, skipped SQL,
and passed the exact postflight, nine-successor pending check and global grant
audit. The four public and four private rows converged with zero issues.
Neither run deployed the application or enabled RLS.

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

The fifth through eleventh isolated slices centralize the remaining shipping
quote inputs, owner onboarding/export reads and writes, staff ban/unban/undo
seller state, account-deletion seller mutations, and the owner shop-settings
and profile-editor read/write surfaces. Cart and single-listing quote paths now
share one exact fulfillment projection; account export retains every reviewed
owner field without leaving that projection embedded in the route; each
onboarding, shop-settings and profile-editor mutation is owner-bound and
purpose-specific; staff
orderability changes share a single compatibility boundary while preserving
the existing user capability, audit and checkout-expiry protocol; and account
deletion now pauses and anonymizes the expected user-owned seller row through
one fail-closed boundary. Focused source/behavior suites and TypeScript pass for
each slice.

The twelfth isolated slice centralizes both Guild cron scans and every Guild
metric/revocation SellerProfile mutation behind `sellerGuildPrivateAccess.ts`.
The daily member check retains its case and listing-threshold rechecks inside
the audit transaction, while the monthly metrics job retains its warning grace,
fresh-metrics revocation check, exact state predicates and co-committed system
audit. The two cron routes now contain zero direct SellerProfile reads or
writes.

The thirteenth isolated slice moves the authenticated Guild dashboard state,
both application rechecks and the Guild Master application timestamp mutation
behind the owner boundary. Every lookup and the paired application mutation is
bound to both seller-profile id and user id, while the existing verification
status update and transition assertion remain in the same transaction.

The fourteenth isolated slice centralizes staff Guild private-state reads,
review transitions, revocation/reinstatement mutations and bounded admin lists
behind `sellerGuildStaffPrivateAccess.ts`. Existing Admin-PIN and role gates,
verification-state compare-and-set writes, seller-account activity checks,
transition assertions, notifications and audit writes remain at the caller.
The staff page retains only unrelated public featured-maker SellerProfile
operations outside this private compatibility boundary.

The fifteenth isolated slice centralizes the cart, single-checkout and
single-checkout-resume private seller source projections behind
`sellerCheckoutPrivateAccess.ts`. The boundary keeps the exact provider
version, payout destination, package defaults and orderability snapshots used
by the installed reservation-source witnesses, while the route-level buyer,
listing, block, rate, price and reservation checks remain unchanged.

The sixteenth isolated slice inventories the latest source definition of every
database function and moves eight public-eligibility functions off the private
`stripeAccountVersion` field. Migration
`20261013130000_move_seller_supported_snapshot_sql_callers` preserves their
signatures, security attributes and grants while using the transactionally
maintained `stripeAccountSupported` snapshot. The exact migration applied in a
transaction to disposable PostgreSQL 16; catalog readback found all eight
functions using the snapshot and zero references to `stripeAccountVersion`.
Seventeen effective functions still directly depend on fields in the private
inventory. The large notification core remains in that count so its provider
and metric dependencies can be converted together rather than replacing its
definition twice.

The seventeenth isolated slice moves the three checkout reservation functions
that directly consume seller provider or package state onto
`SellerProfilePrivate`. Migration
`20261013140000_move_checkout_seller_private_sql_callers` preserves the fixed
function signatures, owners, security attributes and grants; public seller
orderability continues to use `stripeAccountSupported`, while the provider id,
provider version and default package dimensions come from the zero-direct
companion. The disposable PostgreSQL checkout suite exercises the replacement
functions through the restricted runtime, then restores the sealed predecessor
definitions before replaying the historical activation/FORCE proofs. All 41
PostgreSQL checks pass. Fourteen effective functions remain to convert.

The eighteenth isolated slice moves both custom-order messaging writers and
the bounded User custom-order seller projection onto the private companion.
Migration `20261013150000_move_custom_order_seller_private_sql_callers`
preserves all three public contracts and grants. Seller eligibility now joins
the private payout destination, uses the public supported snapshot, and locks
the companion row with the public seller row; the User projection returns the
same bounded provider fields from the companion. The current Conversation and
Message runtime proof reapplies this successor after its historical service
draft so hosted CI exercises the effective function bodies rather than silently
restoring predecessors. Focused boundary, relationship and conversation suites
pass. Eleven effective functions remain to convert.

The nineteenth and twentieth slices move the Case Guild unresolved guard and
the seller label preflight onto the companion. The Guild guard keeps public
`guildLevel` as the current state while reading the private prior-approval
timestamp from `SellerProfilePrivate`. The label preflight keeps public seller
identity/display state while sourcing ship-from contact and default package
dimensions from the companion. Its PostgreSQL suite deliberately poisons the
predecessor public address and proves the returned label sender still comes
from the private row; all 35 label checks pass, including partial-refund,
deauthorization, claim-fencing, ambiguous-provider and rollback paths. Nine
effective functions remain to convert.

The twenty-first isolated slice moves three provider-identity callers behind
the private companion: signed payout-failure matching, signed seller
deauthorization, and the staff ban-repair projection. Their public contracts,
security modes and existing caller grants remain unchanged. Payout and ban
repair now ignore deliberately stale predecessor account ids in focused
PostgreSQL proofs. Deauthorization finds the account through the private row
and uses a runtime-inaccessible compatibility writer to lock and clear both
the private account id and the predecessor copy in one transaction; replay and
rollback behavior remain intact. That transition-only writer is the single
remaining direct dependency for this mutation and must be replaced after old
deployments drain, before the predecessor column is dropped. Fourteen focused
PostgreSQL checks pass. Seven effective functions, including that compatibility
writer, remain to convert or retire.

The twenty-second isolated slice moves the four refund and Case-refund writers
that set manual Stripe reconciliation state behind one runtime-inaccessible
compatibility writer. Migration
`20261013190000_move_reconciliation_seller_private_sql_callers` preserves the
four public entrypoint signatures and grants, locks the public/private seller
pair, and writes the private source plus the predecessor representation in one
transaction. Focused PostgreSQL proof covers both seller-profile-id and
seller-user-id resolution, deliberately verifies the restricted runtime cannot
execute the bridge, and retains refund replay and rollback behavior. Four
effective functions remain: the checkout-order and notification cores plus the
two transition-only compatibility writers, all of which must be converted or
retired after predecessor deployment drain.

The subsequent correction migration
`20261014010000_tolerate_missing_seller_reconciliation_target` closes the
post-provider failure identified as Claude session #419 without changing those
four finalizer contracts. A valid public/private seller pair is still locked
and updated exactly as before. If the public seller or its private companion is
unexpectedly absent, the compatibility writer now returns without rejecting
the enclosing refund record and inserts a bounded
`SELLER_RECONCILIATION_FLAG_SKIPPED` warning in `SystemAuditLog` identifying the
missing relation and lookup target. Invalid inputs and lost updates on an
already locked valid pair continue to fail closed. Focused PGlite coverage
proves both missing-target branches, the unchanged valid-target writes and the
runtime-inaccessible grant posture. The correction is additive and must be
applied with the caller batch before those definitions become live.

The protected caller-batch operator is prepared in
`.github/workflows/seller-profile-private-callers-production.yml`. It binds an
unchanged main commit to successful full push CI, pins all ten migration
digests, accepts only a contiguous restart-safe applied prefix, and requires
the remaining exact suffix to be the complete pending migration set before
Prisma deploys it. Preflight and postflight retain `SellerProfile` with RLS off,
retain zero direct ordinary-runtime or `PUBLIC` table authority on
`SellerProfilePrivate`, require public/private identity and supported-snapshot
convergence, verify both transition writers remain runtime-inaccessible, and
run the global grant audit. The workflow deploys no application and performs
no RLS activation; its source availability is not evidence of a Production
dispatch.

The twenty-third isolated slice moves the final two business-function reads
off predecessor private fields. Migration
`20261013200000_move_final_seller_private_sql_callers` makes checkout order
creation source the seller's Stripe account id and version from the locked
private companion while retaining the public-safe supported snapshot for
eligibility. Notification creation likewise uses that snapshot for Stripe
eligibility and reads Guild metric state from the locked private row. It is
based on the corrected notification definition, including explicit rejection
of a null notification type. A paid-checkout PostgreSQL proof deliberately
poisons the predecessor Stripe fields and still creates the order from the
private source. Thirty-three focused checks pass. A subsequent independent
latest-definition scan found four account-deletion functions that still read
predecessor provider or ship-from fields, in addition to the transition-only
`grainline_seller_profile_deauthorize_compat` and
`grainline_seller_profile_reconciliation_required_compat` writers.

The twenty-fourth isolated slice moves those four account-deletion functions
onto the companion. Migration
`20261013210000_move_account_deletion_seller_private_sql_callers` preserves
the preflight, snapshot, Message redaction and Case redaction signatures,
security attributes and grants. Public seller identity remains on
`SellerProfile`; provider identity and ship-from redaction needles now come
from `SellerProfilePrivate`. Focused PostgreSQL proofs deliberately poison the
predecessor provider and ship-from values, then show preflight, snapshot and
received-message redaction use only the private values. The only remaining
effective predecessor-field dependencies are the two transition writers;
both must
be replaced or retired after Phase 0 is installed, converted application code
is deployed, and predecessor deployments have drained.

The twenty-fifth isolated slice begins the application cutover with the complete
Stripe provider family. Migration
`20261014120000_prepare_seller_profile_private_stripe_app_authorities` adds five
fixed operations for owner state, account binding, bounded reconciliation,
signed-provider mirroring and exact-account charge-state updates. Ordinary
runtime retains zero table authority on `SellerProfilePrivate`. Account binding
is now bound to both the authenticated user and seller profile, locks both
representations, refuses a conflicting rebind, and keeps both representations
synchronized during deployment skew. Charge-state updates require both the
seller profile and the exact private connected-account id, preventing a stale
webhook lookup from updating a newly rebound seller. The converted TypeScript
boundary validates every returned row and contains no direct Prisma access to
either seller table. Focused PGlite proof covers owner availability, idempotent
binding, foreign-owner denial, conflicting rebind denial, exact-account charge
updates, bounded reconciliation, representation convergence, direct-table
denial and untrusted-function denial. The focused 46-test suite and TypeScript
pass. This slice is prepared source only; it is not yet applied, merged or
deployed.

The twenty-sixth isolated slice converts shipping quote disclosure. Migration
`20261014130000_prepare_seller_profile_private_shipping_quote_authority` adds
one fixed read operation whose caller must supply an active buyer, the exact
seller and exactly one purchase context: an eligible listing or that buyer's
exact cart. The operation denies self-purchase, banned or deleted accounts,
blocked buyer/seller pairs, unavailable sellers, foreign private listings,
archived listings and invalid cart items before returning the private ship-from
and package inputs. The route now passes the authenticated local user plus its
exact cart or listing witness. Runtime retains zero direct table authority, and
the TypeScript boundary rejects malformed or duplicate database results.
Focused PostgreSQL proof deliberately poisons predecessor ship-from/package
fields, proves the companion remains authoritative, and covers single-listing,
private-listing and cart success plus denial for foreign, archived, blocked,
banned, self-purchase and wrong-role requests. The focused 42-test suite,
TypeScript and scoped lint pass. This slice is prepared source only; it is not
yet applied, merged or deployed.

The twenty-seventh isolated slice converts checkout application projections.
Migration
`20261014140000_prepare_seller_profile_private_checkout_app_authority` adds one
fixed read operation whose caller must present an active buyer, the exact
seller and exactly one eligible purchase context: an exact listing or that
buyer's exact cart. It rejects self-purchase, blocked pairs, inactive actors,
unavailable sellers, foreign private listings, archived listings and invalid
cart contents before disclosing the private Stripe account and package
defaults. Public listing/cart projections retain only the supported-account
snapshot used for early eligibility. Single checkout, seller-group checkout,
cart add/update, shipping quote and single-checkout resume now obtain private
provider/package state only through the fixed operation. Reservation witnesses
compose that exact private result with their public source immediately before
the database reservation call, preserving the source-equality check without
restoring direct table access. Focused PostgreSQL proof deliberately poisons
the predecessor values, proves listing and cart success from the companion,
and covers invalid context, foreign/private/self/blocked and invalid-cart
denials plus direct-table and untrusted-function denial. The 104-test focused
suite, the 130-test adjacent-route suite, TypeScript and scoped lint pass. This
slice is prepared source only; it is not yet applied, merged or deployed.

The twenty-eighth isolated slice converts the non-Guild owner surface.
Migration
`20261014150000_prepare_seller_profile_private_owner_app_authorities` adds an
active-owner-only private-state projection plus narrow onboarding-step,
onboarding-completion and shop-settings writers. Onboarding, shop settings and
account export combine bounded public projections with that private result;
the general seller bootstrap no longer carries a private Stripe account id.
Vacation-mode checkout expiry obtains the account id through the already fixed
Stripe owner operation. Onboarding progress uses a compare-and-set operation,
and completion now rechecks the private step, current Stripe eligibility and
existence of a listing while both seller representations are locked. The shop
settings writer validates geographic, monetary, carrier, address-country and
package bounds and updates the private source plus predecessor representation
in one transaction during deployment skew. Ordinary runtime receives only
function execution and retains zero private-table authority. Focused PostgreSQL
proof deliberately poisons predecessor private values, proves owner reads come
from the companion, proves onboarding and settings synchronization, and covers
stale-step, completion-prerequisite, direct-table and untrusted-function
denials. The 65-test owner/static suite, TypeScript and scoped lint pass. This
slice is prepared source only; it is not yet applied, merged or deployed.

The twenty-ninth isolated slice converts account-deletion application writes.
Migration
`20261014160000_prepare_seller_profile_private_account_deletion_app_authorities`
adds one exact pause operation and one atomic anonymization operation. Both
destructive paths require the current generation-fenced, UUID-bound
`LOCAL_ANONYMIZE` side-effect claim. The pause operation also supports the
separate Clerk-provider-deleted deferral only after the database verifies the
exact terminal local ban reason, and it tolerates buyer-only accounts. Seller
pauses bind to the authoritative private Stripe account when provider identity
is known. The anonymization operation locks both representations, fails closed
if the private provider identity changed after deletion preflight, and clears
the private companion and predecessor fields in one transaction. It does not
require an otherwise active User because claimed cleanup runs after Clerk
identity deletion. Ordinary runtime retains no direct private-table authority
and cannot use the functions without a live deletion witness. Focused
PostgreSQL proof poisons the public Stripe and ship-from predecessors, proves
claim-token and exact-account enforcement, provider-rebind denial, full
public/private cleanup, safe buyer-only deferral, direct-table denial and
untrusted-function denial. Focused account-deletion tests, TypeScript and
scoped lint pass. This slice is prepared source only; it is not yet applied,
merged or deployed.

The thirtieth isolated slice converts Guild listing-threshold maintenance.
Migration
`20261014170000_prepare_seller_profile_private_guild_listing_threshold_authority`
adds a fixed operation that accepts only a seller identity, locks both seller
representations, derives the current count from canonical active public
listings, preserves the existing below-threshold clock when appropriate, and
synchronizes the companion and predecessor in one transaction. All listing
creation, stock, seller-hide and staff-review callers retain their existing
best-effort invocation but can no longer issue a direct SellerProfile update.
Ordinary runtime receives only function execution and cannot choose the
private timestamp or obtain direct private-table authority. Focused source
tests, TypeScript and scoped lint pass. This slice is prepared source only; it
is not yet applied, merged or deployed.

The thirty-first isolated slice converts the two bounded Guild cron scans.
Migration
`20261014180000_prepare_seller_profile_private_guild_cron_batch_authorities`
adds separate 100-row-capped, stable projections for daily Guild Member
revocation review and monthly Guild metrics review. Public badge and vacation
eligibility remain on SellerProfile; the threshold clock, consecutive failure
counter and warning timestamp come only from the private companion. Cursor and
page-size inputs are bounded in the database, ordinary runtime receives only
the two exact function grants, and direct companion access remains denied. The
cron routes retain their existing cursor runner and processing behavior. This
slice is prepared source only; it is not yet applied, merged or deployed.

The thirty-second isolated slice converts monthly Guild metrics mutations.
Migration
`20261014190000_prepare_seller_profile_private_guild_metrics_authority`
adds one fixed transition that accepts only a seller identity and the exact
persisted metrics calculation timestamp. The function locks the public seller,
private companion and matching three-month metrics snapshot; rejects replaced,
stale, future, malformed and out-of-range snapshots; derives threshold success
inside PostgreSQL; enforces the 30-day warning window from companion state; and
atomically synchronizes both seller representations. Warning and automatic
Guild Master revocation audit rows are inserted in the same transaction as
their state changes, while revocation also requires and updates the current
`GUILD_MASTER_APPROVED` verification row. The function interface does not let
the caller select the action, counter, warning time, demotion, verification
result or audit payload. The cron now calculates metrics once and uses the
returned action only for notification, email and cache side effects. The shared
runtime still writes the `SellerMetrics` cache directly, so Phase 2 remains
blocked on the separate coverage-ledger requirement for a database-derived or
service-only metrics refresh; this exact-cache token is not by itself the final
trust boundary. Focused PostgreSQL proof covers warning, recovery,
revocation, verification conflict, exact-snapshot rejection, malformed metrics,
direct companion denial and untrusted-function denial. This slice is prepared
source only; it is not yet applied, merged or deployed.

The thirty-third isolated slice converts automatic Guild Member revocation.
Migration
`20261014200000_prepare_seller_profile_private_guild_member_revocation_authority`
adds one fixed transition that accepts only the seller identity. PostgreSQL
locks the seller and private companion, derives the current 90-day unresolved
case guard through the existing Case authority, and otherwise requires both a
private 30-day below-threshold clock and a fresh count below five ACTIVE,
non-private listings. A successful transition updates the current eligible
verification, public badge state, private metrics state and
`AUTO_REVOKE_GUILD_MEMBER` audit row atomically. The caller cannot choose the
guard, reason, verification result, seller state or audit payload. The cron
uses the database result only for notification, email and cache side effects.
Focused PostgreSQL proof covers case and listing revocations, restored-count
and recent-threshold rejection, stale/non-member state, verification conflict,
atomic state, direct companion denial and untrusted-function denial. This
slice is prepared source only; it is not yet applied, merged or deployed.

The staff compatibility module is the only remaining application caller
family that reads or writes predecessor private fields. Phase 1 remains
incomplete until it moves to purpose-bound operations, the converted
application is deployed and proven, and predecessor deployments have drained.
The two transition-only SQL writers remain intentionally installed until that
drain completes.

### Phase 2: private-boundary cutover and RLS/grants — **NO-GO**

Do not activate until all `BLOCKS_RLS_DESIGN` and `FIX_BEFORE_ACTIVATION`
items close, predecessor deployments are drained, effective SQL functions are
redefined and inspected, converted runtime smoke passes, and the exact rollback
order is reviewed. RLS activation remains a separate decision after the split
is accepted in Production.
