# Core Order pre-RLS audit

Status: current-source architecture and authority audit only. This document
contains no migration, policy, fixed-function implementation, grant change,
deployment or production mutation.

Audited source base: `c4e861a30c993909703e3f47876fd56c95b11af6`

Prepared: 2026-08-31

## Decision

`Order` is the next RLS table. It must be activated separately from
`OrderItem` and `OrderShippingRateQuote`, while all three remain in one
continuous Order-domain program. The intended sequence is:

1. convert and protect `Order`;
2. convert and protect `OrderItem`; and
3. convert and protect `OrderShippingRateQuote`.

This ordering protects the highest-risk row first: `Order` combines buyer PII,
shipping addresses, Stripe and Shippo identifiers, fulfillment state, refund
claims, label state, gifts and staff-review data. It does not imply that
purchased-item history or shipping quote snapshots are safe to leave broad;
they are the immediately following releases, not deferred future work.

The target for `Order` is policyless `ENABLE` followed by `FORCE` RLS, zero
direct ordinary-runtime/PUBLIC table or column authority, actor-specific fixed
read projections, source-validating fixed writes and separate cleanup and
aggregate operations. A broad buyer/seller `SELECT` policy is rejected because
row visibility cannot hide provider-only and staff-only columns from a seller
or buyer who may legitimately see other fields in the same row.

## What is already sound

The fresh review did not find a reason to redesign Grainline's entire order
product. Important foundations are already in place:

- checkout creates one seller-scoped Order per Stripe Checkout Session;
- paid cart and single-listing webhook paths explicitly dual-write the locked
  seller ID to `Order.sellerProfileId` and every
  `OrderItem.sellerProfileId`;
- composite foreign keys bind an item to both the same Order seller and the
  purchased Listing seller, while `ON UPDATE RESTRICT` prevents a later
  Listing ownership change from transferring historical purchase authority;
- deferred constraint triggers reject a committed zero-item, null-seller or
  mixed-seller Order;
- checkout captures a bounded `listingSnapshot` and selected-variant snapshot;
- buyer, seller and staff refund/dispute outcomes already use the protected
  `OrderPaymentEvent` projections rather than direct ledger reads;
- the participant mutation routes are authenticated and rate limited, and the
  contended Case, fulfillment and label paths already use the shared Order-row
  lock in their critical transitions; and
- the payment/refund/dispute service ledgers required by this table are already
  policyless ENABLE plus FORCE with direct runtime authority removed.

These are real prerequisites, not discarded work. They make the core Order
conversion narrower and safer than starting from broad CRUD alone.

## Product and architecture findings

### ORD-A01: mixed sensitivity requires fixed projections

`Order` has no safe participant-wide column set. Buyers need their own address,
totals and fulfillment state. Sellers need the fulfillment address and buyer
label for their sale, but not every provider or internal reconciliation field.
Staff need a larger audited support view. Stripe, Shippo and maintenance jobs
need narrow transition inputs rather than a user-facing row.

The database boundary must therefore expose separate buyer-list/detail,
seller-list/detail, staff-list/detail, export, aggregate and maintenance
operations. Each operation must return a fixed typed column list and combine
the actor predicate with the row lookup inside PostgreSQL. Fetching by ID and
checking the actor afterward is not an acceptable RLS-era authority boundary.

### ORD-A02: the durable seller key is live, but consumers still bypass it

The August compatibility migration backfilled and constrained
`sellerProfileId`, and both paid checkout paths now write it. However the main
seller sales list, seller detail, recent-sales analytics, account seller count,
account export, ban/account-deletion paths and several aggregates still derive
seller authority through `OrderItem -> Listing.sellerId`.

That is both an authority bug class and a scale regression: it makes retained
order access depend on mutable catalog state and replaces a direct indexed
`Order.sellerProfileId` predicate with joins plus relational `some`/`every`
filters. Every seller authorization and seller-scoped page must use the durable
Order seller key. The current Listing relation may be consulted only as
optional public catalog context, never as historical order ownership.

### ORD-A03: historical rendering still prefers live Listing data

Buyer and seller order lists/details load current Listing titles, photos,
seller relations and processing-time fields even though checkout captured
`listingSnapshot`. Listing edits can therefore rewrite how an old purchase is
presented, and later Listing RLS could strand order history.

Introduce one strict snapshot reader with a documented legacy fallback. Order
history must prefer snapshot title, image, seller display and price. The
current Listing ID may remain an optional link only when the current public
catalog row is still visible. Current `SellerProfile.userId` may be resolved
from the durable `Order.sellerProfileId` for the buyer's contact-seller action;
it must not be recovered through the first live Listing.

The current snapshot contains title, description, price, images, category,
tags, seller name and capture time, but the database constrains only its byte
size. Before making it the canonical UI source, validate its object shape and
classify production null/malformed rows. New snapshots should add the
historical listing type and processing-time values used by the order timeline;
older rows need an explicit null/fallback presentation rather than silently
using edited catalog values.

### ORD-A04: buyer and seller detail checks occur after broad row fetches

Buyer detail currently fetches an Order by ID and then compares `buyerId` in
application code. Seller detail fetches by ID, joins all current Listings, and
then checks that every Listing currently belongs to the seller. These checks
prevent the route from rendering a foreign order today, but the ordinary
runtime credential still reads the entire row before denial.

The fixed detail projections must accept the authenticated actor, bind buyer or
durable seller authority in the SQL predicate, and return no row for another
actor. Direct base-table `SELECT` must then be revoked.

### ORD-A05: 14 runtime/proof source files still touch Order authority directly

The exact current inventory is pinned below. Activation cannot proceed while
ordinary runtime code can still use these base-table paths. Each file needs one
semantic destination; simply hiding Prisma calls behind a generic repository
would preserve the same over-broad credential authority.

Staff and administrative reads/transitions:

- `src/app/admin/actions.ts`
- `src/app/admin/cases/[id]/page.tsx`
- `src/app/admin/flagged/page.tsx`
- `src/app/admin/orders/[id]/page.tsx`
- `src/app/admin/orders/[id]/refundReconciliationActions.ts`
- `src/app/admin/orders/page.tsx`
- `src/app/admin/verification/page.tsx`

Participant/service mutation routes:

- `src/app/api/stripe/webhook/route.ts`

Lifecycle, repair and retention readers/writers:

- `src/lib/accountDeletion.ts`
- `src/lib/audit.ts`
- `src/lib/ban.ts`

At that audit checkpoint this list became executable rather than prose-only:
`tests/order-direct-access-inventory.test.mjs` scans both Prisma delegates and
direct raw-SQL relation references and fails on either a new unclassified file
or an undocumented conversion. Later checkpoint sections below advance those
inventories without rewriting this historical baseline.
The first follow-on conversion replaces
`src/lib/orderRefundProviderReconciliation.ts`'s full-credential Order read
with a fixed exact-claim projection that returns only the provider-authorized
timestamp. Its SQL remains a compatibility draft pending a separate database-
first release, so the application change must not deploy before that function.
The remaining work divides cleanly into seven staff/admin consumers, one
provider route and six lifecycle/maintenance modules; it does not
require reopening already-converted fulfillment, buyer-receipt or label route
authority.

### ORD-A06: the development Order creator is retired

The former `/api/dev/make-order` route was correctly unreachable outside
explicit local non-Vercel development and was not a production back door. A
fresh product/authority audit nevertheless found that it fabricated a `paidAt`
Order without a Stripe Checkout Session, PaymentIntent, Charge, payment-event
evidence, buyer snapshot, or charged subtotal. That synthetic state could
pollute local sales, review and refund behavior and would require preserving a
generic ordinary-runtime `Order INSERT` solely for an unused convenience
endpoint.

No application, script or test called the route, so it is removed rather than
given a privileged database function. Future payment fixtures must remain
outside the application runtime and must use a disposable database or a
provider-backed proof operator with explicit cleanup. This reduces the direct
Order inventory from 21 to 20 without adding database authority.

### ORD-A07: account export crosses the shipping-quote boundary

Buyer and seller exports currently include raw `OrderShippingRateQuote`
identifiers, Shippo shipment IDs and the entire persisted rate JSON, while
seller selection still uses current Listing ownership. A user export should
contain the participant's retained transaction facts, not internal provider
retry material merely because it is related through Prisma.

Define the export contract explicitly. Core Order export and payment-outcome
projections belong to the Order release; raw quote rows remain behind the later
`OrderShippingRateQuote` release and should be omitted unless a field is
demonstrably user data required by the export.

2026-08-31 implementation checkpoint: the isolated
`20260901030000_prepare_order_participant_export_authority` candidate adds
bounded actor-scoped buyer and durable-seller export pages. The converted
route removes direct `Order` reads, raw quote rows, Shippo shipment/rate
payloads and participant-facing provider refund IDs. Refund state/amount and
separately protected `OrderPaymentEvent` histories preserve the user-facing
transaction record. Disposable PostgreSQL and strict shape parsers prove
cross-participant denial, cursor bounds, snapshot stripping and PII purge
suppression. This remains compatible preparation only; no production state
changed.

### ORD-A08: aggregate and eligibility queries need named operations

Homepage totals, public seller stats, seller analytics, quality score,
verification, reporting and review eligibility raw-join Order/OrderItem and in
some cases Listing. These consumers need counts or bounded outcomes, not Order
rows. Create named aggregate/eligibility functions with fixed return shapes,
durable seller predicates and explicit paid/refund/dispute rules. They must not
restore base-table `SELECT` merely to keep a dashboard query working.

2026-08-31 implementation checkpoint: the isolated
`20260901040000_prepare_order_eligibility_authority` candidate converts review
eligibility, Order-report target access, seller verification sales and
listing-archive blocking to four fixed actor-bound functions. Review creation
retains the parent-Order lock; the other operations return only a boolean or
aggregate cents. Five source files leave the direct Order inventory, reducing
it from 40 to 35. Seller-private analytics, public aggregates and maintenance
scoring remain separate named-operation work; no production state changed.

2026-09-01 implementation checkpoint: the isolated
`20260901050000_prepare_order_public_aggregate_authority` candidate converts
homepage fulfilled count, public seller shipping/sold totals, public listing
quality counts and marketplace listing conversion totals to four aggregate-only
functions. They return no Order row, participant, address or provider identity;
public listing/seller visibility and paid/refund/dispute rules are derived in
PostgreSQL. Four more files leave the direct Order inventory, reducing it from
35 to 31, while three also leave the direct OrderItem inventory. Seller-private
analytics and maintenance scoring remain separate named-operation work. See
`docs/order-public-aggregate-authority.md`; no production state changed.

2026-09-01 implementation checkpoint: the isolated
`20260901060000_prepare_order_seller_analytics_authority` candidate converts
seller dashboard summaries and buckets, top listings, recent sales and the
account completed-order count to five actor-bound fixed functions. The product
audit corrected immediate cart-abandonment classification, rejected a purchase
that predates the cart item as conversion evidence, made the representative
recent-sale item deterministic, and moved repeat-buyer grouping out of
application memory. Save/watch copy now identifies the surviving-subscription
semantics of the current tables. The candidate reduces the direct inventory
from 31 to 29 Order files and from 6 to 5 OrderItem files. Guild/service
maintenance scoring in `src/lib/metrics.ts` remains a separate cohort. See
`docs/order-seller-analytics-authority.md`; no production state changed.

2026-09-01 implementation checkpoint: the isolated
`20260901070000_prepare_order_seller_metrics_authority` candidate moves Guild
sales and shipping facts behind one bounded service aggregate. The product
audit found and corrected mutable Listing ownership as a historical
attribution source: both completed sales and on-time shipping now use the
checkout-time `Order.sellerProfileId` and `OrderItem.sellerProfileId` keys.
Guild thresholds, private/custom paid-order inclusion, refund exclusion and
the 90-day shipping meaning remain unchanged. The candidate reduces the
current direct inventory from 29 to 28 Order files and from 5 to 4 OrderItem
 files. The `SellerMetrics` cache upsert remains a separately audited table
boundary. See `docs/order-seller-metrics-authority.md`; no production state
changed.

2026-09-01 implementation checkpoint: the isolated
`20260901080000_prepare_order_participant_summary_authority` candidate fixes a
product gap found before participant-page conversion. The predecessor scalar
list projection did not contain the historical item cards used by every
buyer/seller list. Replacing it directly would have removed useful UI or
caused an N+1 detail query for every Order. The successor instead returns at
most five fixed checkout-time item summaries plus the complete item count in
the same actor-scoped keyset query. `src/app/account/page.tsx` and
`src/app/dashboard/orders/page.tsx` now use that projection, reducing the
direct Order inventory from 28 to 26 without mutable Listing fallback or
unbounded item payloads. The full buyer history and seller sales pages remain
direct until their offset pagination is deliberately converted to cursor
navigation. See `docs/order-participant-summary-authority.md`; no production
state changed.

2026-09-01 implementation checkpoint: the isolated
`20260901090000_prepare_order_participant_cursor_authority` candidate adds the
newer-page half of the participant keyset contract and converts
`src/app/account/orders/page.tsx` plus `src/app/dashboard/sales/page.tsx` off
direct Order reads. The product audit rejected both growing OFFSET scans and
cursor pagination without a usable Previous control. Opaque, strictly parsed
tokens now bind a direction, page label and `(createdAt,id)` boundary; older
and newer database queries remain bounded and return rows in the same newest-
first UI order. The seller page now uses the durable full Order subtotal rather
than summing the five displayed summaries, preventing underreported totals for
larger Orders. The direct Order inventory falls from 26 to 24. See
`docs/order-participant-cursor-authority.md`; no production state changed.

2026-09-01 implementation checkpoint: the isolated
`20260901100000_prepare_order_participant_detail_projection` successor converts
`src/app/dashboard/orders/[id]/page.tsx` and
`src/app/dashboard/sales/[orderId]/page.tsx` to corrected actor-bound
projections. The product audit removes dead counterparty messaging actions,
suppresses seller notes after buyer-data purge, strips label material unless
the label is actually purchased, derives actor-specific historical Listing
links, and requires an active actor inside PostgreSQL. The initially sealed v2
projection over-narrowed valid snapshots; additive v3 functions restore the
complete allowlisted checkout snapshot without exposing unknown JSON keys. The
sealed v1 functions remain runtime-private building blocks. The
direct Order inventory falls from 24 to 22. See
`docs/order-participant-detail-projection.md`; no production state changed.

2026-09-01 implementation checkpoint: the isolated
`20260901110000_prepare_order_checkout_receipt_authority` candidate converts
`src/app/checkout/success/page.tsx` from direct Order reads to one bounded,
paid-only buyer projection. The product audit fixes checkout-time identity
drift, inaccessible historical Listing links, a no-wait webhook “retry,” and
duplicated receipt rendering. Strict parsing refuses line-item/subtotal drift;
an aggregate-only production inspection must classify any historical mismatch
before application. The direct Order inventory falls from 22 to 21. See
`docs/order-checkout-receipt-authority.md`; no production state changed.

2026-09-01 implementation checkpoint: the unused local-only
`/api/dev/make-order` route is retired after the product audit found it
fabricated paid state without Stripe session, charge or payment-event evidence.
It had no application or test callsite. The direct Order inventory falls from
21 to 20 without adding a runtime create function; no production state changed.

### ORD-A09: write conversion must preserve lock and provider semantics

Order creation, fulfillment, delivery, label purchase/finalization, label
clawback retry, seller/staff refunds, signed refund/dispute updates, ban holds,
account deletion, PII pruning and stale-claim repair are distinct state
machines. They cannot share a caller-directed `order_update` function.

For every family, the database function must derive or validate the target,
actor, clock, state transition and replay identity; lock the Order before a
conflicting transition; and expose only its exact operation. Provider calls
remain outside PostgreSQL. Claim/finalize designs must preserve the current
restart-safe behavior when Stripe or Shippo succeeds but a later database step
is ambiguous.

As with the completed payment-event work, RLS removes arbitrary table CRUD but
does not independently authenticate Stripe or Shippo. The application-held
provider secrets remain the ingress trust boundary; fixed functions bind an
accepted source event/claim to narrow local effects.

2026-09-05 paid-checkout authority checkpoint: the isolated fixed operation
now derives Order/OrderItem source facts from the complete retained reservation
snapshot and has real PostgreSQL single/cart, replay, forged-input, direct-grant
denial and rollback proof. The audit corrected currency binding, duplicate
source/variant handling, single-versus-cart processing floors, fulfillment
validation, quoted address-line retention and bounded audit text before any
route conversion. The webhook's predecessor writers remain intentionally in
place until the compatible database dependency is packaged first; therefore
this checkpoint proves the candidate but does not reduce the direct-access
inventory or authorize deployment/RLS.

### ORD-A10: compatible nullable seller keys are not the final invariant

Production inspection previously found no seller-key derivation ambiguity,
and deferred database triggers prevent new committed invalid Orders. The
columns remain nullable in Prisma and PostgreSQL for old/new application
coexistence. Before activation, rerun an aggregate-only inspection against the
current release, prove zero null/mismatch/zero-item rows, and converge both
Order and OrderItem keys to `NOT NULL` in a separately rollback-proven
compatibility release.

This does not authorize cleanup if the result differs from zero.

### ORD-A11: pagination is bounded but not the final scale shape

Buyer and seller lists use stable `(createdAt,id)` ordering, but the paginated
surfaces still use offset/page-number queries and separate counts. The seller
path also ignores the installed durable seller indexes. This is acceptable for
the pre-launch data volume, but the fixed projection API should support
keyset/cursor paging on `(sellerProfileId,createdAt,id)` and
`(buyerId,createdAt,id)`. Preserve bounded page sizes and avoid exposing an
unbounded export or dashboard function.

### ORD-A12: participant screens exposed a raw Stripe refund identifier

The seller detail panel rendered `Order.sellerRefundId` after a completed
refund. That identifier is provider/reconciliation metadata, not a seller
receipt requirement, and its presence encouraged a future detail function to
return the raw provider column merely to preserve UI behavior.

The isolated detail-authority candidate changes the panel to a derived
`NONE | PROCESSING | AMBIGUOUS | RECORDED` display state and removes the raw ID
from participant rendering. The fixed buyer/seller detail functions derive the
same state inside PostgreSQL and return an amount only for `RECORDED`. Staff
and reconciliation projections may retain exact provider identity separately.

### ORD-A13: staff PII cannot use the shared runtime actor-argument boundary

The staff Order queue/detail legitimately needs buyer PII, addresses, internal
review notes and limited provider reconciliation identity. Granting that
projection to `grainline_app_runtime` would let any code path holding the
shared credential call it with the ID of a live staff row. The participant
actor-argument pattern is therefore too broad for this data class.

The isolated staff-read candidate is dormant and instead requires exact
`SESSION_USER = grainline_staff_read_runtime`, revalidates the live staff row,
and grants neither PUBLIC nor ordinary-runtime execution. A separate
membership-free, NOBYPASSRLS staff-read login and isolated application client
must be provisioned and proved before any grant or page conversion. Retain the
Admin-PIN application gate; the database role is an additional boundary, not
a replacement for Clerk or the PIN.

### ORD-A14: pickup completion must be buyer-controlled

The fulfillment product audit found that the seller could move a pickup Order
from `READY_FOR_PICKUP` to `PICKED_UP`. Because `pickedUpAt` starts the buyer's
30-day Case window, this let a seller assert handoff and start that clock
without buyer evidence. The isolated correction limits sellers to
`PENDING -> READY_FOR_PICKUP` and lets only the buyer confirm
`READY_FOR_PICKUP -> PICKED_UP`. The same receipt route retains buyer-only
`SHIPPED -> DELIVERED`, rejects unpaid Orders and open Stripe disputes, and
co-commits a derived transition audit. Dead seller `delivered` and impossible
`READY_FOR_PICKUP -> SHIPPED` vocabulary is removed.

The eventual fixed operations must preserve this product split and close the
remaining post-commit Notification/email reliability gap. See
`docs/order-fulfillment-receipt-product-audit.md`.

2026-09-01 fixed-authority checkpoint: the three separate fulfillment,
buyer-receipt and seller-note operations are implemented in the isolated
`20260901130000_prepare_order_fulfillment_authority` candidate. Both HTTP routes
now delegate to these functions; seller transition Notification and a
deterministic email-outbox reservation co-commit with the derived audit, while
buyer receipt and its seller Notification share one transaction. The direct
Order inventory falls from 20 to 18. Disposable PostgreSQL proves both delivery
methods, notes, anti-forgery, active-Case denial and direct table-write denial.
No migration, deployment, RLS/grant or production state changed. See
`docs/order-fulfillment-authority.md`.

2026-09-01 label product/authority audit: the next direct-write family is not
safe to seal unchanged. `labelStatus = PURCHASED` currently doubles as an
in-flight/ambiguous provider claim; successful Shippo output is not bound to
the selected rate amount/identity; re-quotes depend on mutable Listing package
facts; label purchase omits the buyer Notification/email side effects; and the
seller projection exposes a raw, potentially expiring label URL. The isolated
successor will use a separate generation-fenced claim, retained package facts,
exact provider binding, source-derived fulfillment side effects and an
authenticated fresh-download boundary. Purchasing a label will continue to
mean `SHIPPED` until a separate carrier-acceptance product exists. See
`docs/order-label-product-authority-audit.md`; production remains unchanged.

2026-09-01 label fixed-authority implementation checkpoint: the isolated,
unapplied `20260901140000_prepare_order_label_authority` candidate now separates
provider-pending, ambiguous, provider-recorded and finalized claims; derives
quote expiry, rate, amount, currency, claim generation and clawback generation
inside PostgreSQL; and retains checkout-time package facts for new OrderItems.
The label route and clawback worker no longer directly access `Order` or
`OrderShippingRateQuote`, reducing the direct Order inventory from 18 to 16 and
the direct quote inventory from two files to one. A successful provider record
co-commits the normal shipped Notification and email-outbox reservation; label
download now goes through actor-bound database authority and a fresh Shippo
transaction lookup. Disposable PostgreSQL proves actor isolation, money/identity
binding, ambiguity fencing, generation finalization, `SKIP LOCKED` retry claims
and base-table denial. Seller detail v4 and the application now omit the raw
label URL; predecessor v2/v3 execution remains a deliberate deployment-overlap
grant that must be retired after the compatible app drain and before Order RLS
activation. Aggregate production inspection for duplicate Shippo transaction
identities and legacy package-fallback counts also remains required. No
migration, deployment, RLS/grant or production state changed.

2026-09-05 legacy refund-lock authority checkpoint: the generic runtime
`Order.updateMany` cleanup is removed from the stacked candidate. Its three
callers now use separate fixed operations: the blocked-checkout path must prove
the exact active signed Stripe event generation and Checkout Session; the Case
path must prove the active staff actor plus nonterminal Case-to-Order source;
and the cron path can release only a 100-row `FOR UPDATE SKIP LOCKED` batch.
Every operation clears only a stale pre-generation `pending` sentinel with no
Case or modern refund claim. Invalid Case input no longer triggers a global
cleanup. This reduces the candidate direct Order inventory from 14 to 13. The
SQL remains a database-first draft, so none of the application changes may
deploy before the fixed functions. See
`docs/order-legacy-refund-lock-authority.md`.

2026-09-05 proof-lock retirement checkpoint: the remaining raw Order lock in
`src/lib/caseLifecycleLocks.ts` had no application callsite; only the
disposable Case concurrency harness imported it. The primitive and its
database-clock helper now live inside that harness, while the tracked source
path remains an inert historical marker. This does not change the proof or any
runtime behavior and avoids creating a fixed database operation for dead code.
The candidate direct Order inventory falls from 13 to 12.

2026-09-05 legacy stock-restore fence checkpoint: unordered-checkout recovery
previously took the shared Checkout Session advisory lock, queried `Order`
directly, and then called the fixed legacy restore claim. The source-consistent
replacement performs the exact `stripeSessionId` existence check inside that
fixed operation while holding the same transaction-scoped advisory lock used
by compatible Order creation. The runtime transaction therefore retains the
lock through stock restoration, and neither side can pass an absence check and
commit concurrently. The candidate direct Order inventory falls from 12 to 11.
The replacement SQL is database-first and must deploy before the application.
See `docs/order-legacy-stock-restore-fence.md`.

2026-09-05 refund-reconciliation commit-proof checkpoint: the administrator
recovery catch path no longer infers success from any `re_` refund on an Order.
It asks one fixed operation whether the exact Order, claim id and claim
generation have an immutable retry/provider-effect reconciliation and have
reached the corresponding finalized Order state. A no-effect reconciliation,
an older generation, a different claim or an unfinished finalization all
return false. This removes a false-success edge and reduces the candidate
direct Order inventory from 11 to 10. The SQL remains database-first and must
deploy before the application. See
`docs/order-refund-reconciliation-commit-proof.md`.

2026-09-05 Guild Member verification conversion checkpoint: the staff
approval path no longer joins `Order`, `OrderItem`, and mutable `Listing`
ownership directly to compute completed sales. It reuses the already prepared
and PostgreSQL-proven seller-metrics projection, which attributes historical
sales through durable Order and OrderItem seller keys and preserves the paid,
completed, non-refunded and non-blocked filters. Unknown or mismatched sellers
fail closed instead of being treated as zero sales. This reduces the candidate
direct Order inventory from 10 to 9 and direct OrderItem inventory from 4 to 3
without changing the published Guild threshold. See
`docs/order-seller-metrics-authority.md`.

2026-09-05 staff mutation authority checkpoint: mark-reviewed, external-label
voiding and staff-note append now use three actor-bound fixed operations. Each
revalidates the active EMPLOYEE/ADMIN row, locks one exact Order, derives its
database timestamp, enforces the active label-clawback and 10,000-character
review-note boundaries, and co-commits its immutable AdminAuditLog row. The
application no longer performs read/compare/write sequences or supplies audit
metadata and timestamp authority. This reduces the candidate direct Order
inventory from 9 to 8. The SQL is database-first and must deploy before the
application. See `docs/order-staff-mutation-authority.md`.

2026-09-05 seller-ban review authority checkpoint: ban, manual unban and
audited ban undo no longer select or mutate Order review state through the
ordinary table delegate. Two actor-bound fixed operations derive the banned
seller, lock and recheck exact open/no-refund Orders, return only hashed
restoration snapshots, and restore only a byte-authenticated marker suffix on
Orders belonging to that seller. The product audit also removed a silent
5,000-character truncation of staff notes: an existing note is now preserved
when the fixed marker cannot fit under the 10,000-character contract. This
reduces the candidate direct Order inventory from 8 to 6. The SQL is
database-first and must deploy before the application. See
`docs/order-ban-review-authority.md`.

2026-09-05 staff read application checkpoint: the all-Orders queue,
review-needed queue and Order detail page now use the fixed staff projections
through a lazy server-only client that can authenticate only with the separate
`grainline_staff_read_runtime` credential. There is no ordinary-runtime
fallback, the pool is capped independently at two connections, and the Vercel
guard requires the staff URL to be pooled and bound to the same reviewed
database. Both queues now render immutable checkout snapshots rather than the
flagged queue drifting through mutable current Listing identity. This reduces
the candidate direct Order inventory from 6 to 3. The local branch is
intentionally not deployable until the database-first login, function grants
and production secret are separately provisioned and proved. See
`docs/order-staff-read-authority.md`.

2026-09-05 staff Case composition checkpoint: the admin Case detail no longer
reads `Order` or participant `User` rows directly. It combines the existing
fixed Case result with the corrected staff Order detail through the dedicated
staff credential, rejects any buyer/seller relationship mismatch, uses the
signed charged total when available, and shows immutable purchased-item titles
while consulting only current listing type for stock-restoration eligibility.
This reduces the candidate direct Order inventory from 3 to 2. The only
remaining direct Order sources are the Stripe webhook service path and the
account-deletion path.

2026-09-05 account-deletion authority checkpoint: the lifecycle path now uses
two actor-bound fixed operations for blocker counts and PII scrubbing. The
audit corrected mutable `OrderItem -> Listing` seller reconstruction, changed
full-refund comparison to prefer provider-signed `chargedTotalCents`, removed
caller-supplied clock authority, and added an in-transaction blocker recheck
after the deleting User is locked. Checkout reservation and final Stripe Order
creation take the same buyer/seller User locks, so the recheck serializes with
new paid Orders. The migration is additive and locally PostgreSQL-proven; it
has not been merged, applied or deployed. This reduces the candidate direct
Order inventory from 2 to 1, the OrderItem inventory from 3 to 2, and the quote
inventory from 1 to 0. Stripe webhook remains the only direct Order source. See
`docs/order-account-deletion-authority.md`.

2026-09-05 final webhook product-audit checkpoint: before sealing the last
direct Order/OrderItem runtime source, the paid-checkout path was reviewed as
a payment and fulfillment state machine rather than mechanically wrapped. Two
correctness defects were found and corrected in the isolated candidate. New
Orders now use the already age-validated, signed Stripe event timestamp for
`paidAt` instead of webhook handler time, so provider delay and replay do not
shift review windows or sales analytics. The first-sale email count now
excludes refunded, payment-blocked, and blocked-checkout review Orders, so a
failed first checkout cannot consume the first legitimate sale milestone.
The listing-page review hint also reuses the fixed actor-bound eligibility
operation, reducing direct `OrderItem` access to the webhook alone. These are
application-only candidate corrections; they are not deployed and do not
authorize Order activation.

2026-09-05 paid-checkout application conversion checkpoint: the cart and
single-listing direct writers now converge on the one fixed
`grainline_stripe_checkout_order_create(...)` candidate. The route supplies a
bounded Stripe-authenticated projection; PostgreSQL binds it to the active
event generation and complete retained reservation snapshot, revalidates the
buyer/seller/listings under locks, derives every protected Order/OrderItem
field, creates history, marks sold-out listings, completes the reservation and
removes only retained paid CartItems atomically. The duplicated 976-line
writer is gone, direct runtime `OrderItem` access is now zero, and the one
remaining direct `Order` source file is still the webhook because its exact
idempotency, blocked-refund and post-payment reads are separate named
operations. The combined app/SQL work remains a local, intentionally
undeployable candidate until its database-first compatible migration is
packaged and proved; it does not authorize Order or OrderItem activation.

2026-09-01 label authority hardening continuation: the bounded staff
reconciliation path is now implemented and proven locally rather than left as
future cleanup. Runtime can no longer falsely release an ambiguous claim as a
provider rejection. Two owner-only, staff-authorized functions read/release one
exact ambiguous generation; the local operator uses an exhaustive Shippo
rate/metadata scan, rejects incomplete or drifted pagination, records exact
SUCCESS through the normal email/clawback finalization path, and permits an
audited release only for exact `ERROR`. Provider absence is diagnostic only:
it leaves the claim fenced because Shippo provides no immutable absence or
idempotency guarantee. A requested transaction ID cannot bypass exhaustive
same-rate uniqueness proof, and release audit attribution distinguishes the
database session principal from the authorizing staff row.
Provider mode is now checked both when creating and freshly retrieving labels.
The remaining release gates are the aggregate-only production counts and the
post-deploy/drain retirement of seller-detail v2/v3. Production remains
unchanged.

## Current functionality verdict

The order, checkout, fulfillment, refund and Case integration are not being
treated as automatically perfect merely because their service-ledger RLS is
complete. The core user flows are coherent and have meaningful provider and
PostgreSQL proof coverage, but this fresh audit found concrete architectural
debt that should be fixed before Order RLS:

- historical views and seller authority still depend on live Listings;
- fixed read projections now have isolated list/count and detail candidates,
  but are not applied or consumed yet;
- account export includes internal shipping quote material;
- the remaining aggregate consumers are named fixed authorities, including
  Guild order facts, but the separate `SellerMetrics` cache write remains;
- the seller analytics and Guild Order-facts cohorts are isolated and
  product-corrected;
- seller fulfillment and buyer receipt semantics are product-corrected so a
  seller cannot assert pickup completion or start the buyer's Case window, and
  their isolated fixed operations close the Notification/email crash gap;
- a fresh route audit found that label-provider and refund-provider claims
  could overlap in one direction; the isolated shared Order constraint closes
  that race but remains unapplied pending its own inspection and compatibility
  release;
- the incomplete development Order fixture is retired; and
- the nullable seller keys and historical non-package snapshot shape still
  need final convergence.

None of these findings require abandoning the existing checkout/refund design.
They define the compatibility work that makes the eventual RLS boundary match
the actual product.

## Release plan and hard gates

### O0 — this audit

Pin the 41-file access inventory, current strengths, known defects and target
operation families. No implementation or production change.

### O1 — participant projections and historical facts

Add strict snapshot parsing plus buyer/seller list/detail/count projections.
Move seller authority to `Order.sellerProfileId`, bind actor predicates inside
SQL, and make historical rendering independent of live Listing attributes.
Prove cross-user/cross-seller denial, deleted participant behavior, paging and
fixed column exposure in disposable PostgreSQL.

### O2 — staff, export, eligibility and aggregate projections

Add explicit staff queue/detail, participant export, review eligibility,
verification and aggregate operations. Remove raw quote payloads from Order
exports. Staff projections require a separate database login and must remain
dormant until its credential, zero-table-privilege posture and dedicated
client are proved. Prove staff role changes, ordinary-runtime denial, no
participant provider-column exposure and bounded aggregate semantics.

### O3 — write and maintenance authority

Convert checkout creation, fulfillment/delivery, label lifecycle, refund and
dispute effects, ban/audit holds, deletion/PII pruning and repair jobs to
family-specific source-validating functions. Require one complete semantic
inventory with zero unconverted ordinary-runtime Order references.

### O4 — compatibility convergence

Run an aggregate-only production inspection, validate snapshot/seller/lock
state, set final seller-key invariants only if clean, deploy the compatible
application, exercise authenticated/provider smoke and drain predecessor
deployments. Preserve restart-safe evidence and rollback paths.

### O5 — policyless Phase A

Apply only `ENABLE ROW LEVEL SECURITY`, revoke all direct runtime/PUBLIC Order
table and column grants, converge the exact reviewed function grants and run
the global grant/RLS audit plus separate actual pooled-runtime proof. Do not
activate `OrderItem` or `OrderShippingRateQuote` in this migration.

### O6 — FORCE

After Phase A acceptance, apply a posture-only FORCE migration and repeat the
separate owner and pooled-runtime proofs. Then continue directly with the
fresh `OrderItem` audit/activation work, followed by
`OrderShippingRateQuote`.

## Activation blockers

`Order` activation is blocked until all of the following are true:

- the exact direct-access inventory reaches zero for ordinary runtime code;
- every actor receives a fixed, tested column projection;
- durable seller authority replaces live Listing ownership everywhere;
- snapshot history and legacy fallback are defined and production-classified;
- every write/maintenance family has a source-validating operation and lock
  proof;
- the provider-claim mutual-exclusion successor is PostgreSQL-proven,
  production-inspected, applied and exercised before either claim family is
  relied on under RLS;
- seller keys and other authority-relevant invariants pass fresh inspection;
- the compatible app is deployed and predecessor overlap is drained;
- the migration, grants, rollback and separate-login PostgreSQL proofs pass;
- the verified buyer quote defects and cross-domain Case money-path blockers
  in `docs/verified-cross-domain-pre-rls-findings-20260901.md` are closed; and
- Phase A and FORCE remain distinct production releases.

2026-09-02 quote-audit continuation: the provider-only quote proof did not
exercise the Buy Now UI bridge. That bridge omitted the selected quantity, so
the quote route signed quantity one while the single-checkout route verified
the actual quantity. The correction forwards the quantity and pins the bridge
in regression coverage. Exact main `b22fa138d84bad792ba206ee00dacb48d475d4a4`
and deployment `dpl_6vA4bWrP4KhADtGAXKsisXdmvJBX` now carry it; authenticated
shipping evidence is still required. The release changed no database or RLS
state.

2026-09-02 seller-policy continuation: the audit also proved that the runtime
quote route ignored all three persisted seller shipping controls. The
correction restores calculated-versus-flat/free precedence, retains calculated
shipping for legacy rows with no flat rate, prefers the seller's configured
rate during provider failure and signs free eligibility against exact
server-derived cart or variant pricing. Seller flat/free rate identities are
quote-only, so label purchase continues to re-quote with the retained full
Order address. The bounded global provider-outage fallback remains a documented
economic-precision limitation and is not being silently redesigned as part of
RLS. The corrected compatible application is now live at the exact release
above; authenticated smoke remains required before predecessor drain or Order
activation.
