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

2026-09-05 Stripe-webhook authority completion checkpoint: the final direct
Order source is now converted across four distinct, source-bound operations.
Paid creation derives protected rows from the retained checkout snapshot;
exact-session replay returns a closed idempotency decision; post-payment work
receives only a bounded delivery/stock/first-sale projection; and blocked
refund review writes use fixed PostgreSQL-derived messages bound to the active
signed event generation and exact Order/session. The final operation accepts
only three closed action codes, derives refund/dispute precedence itself, and
cannot accept caller review text. This reduces the candidate direct Order
inventory from 1 to 0 while preserving the existing generation-fenced refund
claim and finalization authorities. Disposable PostgreSQL proves direct-table
denial, forged identity rejection, closed outcomes and rollback-safe writes.
All work remains isolated compatibility code, not a migration or activation.

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

### ORD-A15: sold-out availability must not invalidate reserved paid units

2026-09-06 candidate review. Classification: `FIX_BEFORE_ACTIVATION`;
corrected in the undeployed candidate, not asserted fixed in production.

The signed paid-checkout writer reproduced a two-reservation defect: two buyers
already hold the final two units, leaving available stock zero. The first
payment creates its Order and marks the Listing `SOLD_OUT`. The second payment
then sees a non-ACTIVE Listing and receives an invalid-listing reason, which the
webhook routes to blocked-checkout refund handling. The old application helper
`invalidCheckoutListingReason` in `src/lib/stripeWebhookState.ts` has the same
condition; this is an inherited product defect, not an RLS denial or evidence
of an observed production incident.

Rule: zero available inventory governs admission of **new** checkouts; it does
not cancel an existing exact reservation. The corrected paid writer permits
only an IN_STOCK listing retained as ACTIVE in the validated source snapshot,
currently IN_STOCK/SOLD_OUT with exactly zero available stock. Its active signed
event generation, exact Session/reservation binding, source-derived quantity,
price and seller checks are unchanged. No extra stock is decremented or
restored, and no new reservation is admitted by this exception. Seller stock
edits that reach zero likewise do not cancel these existing held units.

HIDDEN, DRAFT, SOLD, PENDING_REVIEW and REJECTED remain invalid; positive/null
stock or a made-to-order/source-status mismatch does not qualify for the
exception. Private-recipient changes, seller reassignment, suspension, deletion,
vacation and stopped-order checks retain their precedence. Withdrawing a listing
or stopping new orders remains distinct from merely exhausting available stock.
Released reservations still fail before Order creation.

Proof: the actual candidate function in PGlite, restricted runtime role, two
different buyers and two pre-existing Session-bound reservations. Before the
correction the second result was `Listing was no longer active before payment
completion.` Afterward both create valid Orders with stock still zero. Additional
negative controls exercise disallowed statuses, inventory/type/source drift,
private-recipient mismatch, banned seller and released reservation. This local
proof isolates the writer: reservation completion uses the existing test double;
full-schema server proofs and authenticated provider smoke remain separate gates.

Only the undeployed paid-checkout draft, identical staged migration and exact
compatible-prefix byte pin change. The predecessor application/helper and all
applied historical migrations remain untouched. Release acceptance still needs
the larger candidate review, exact-head CI and the documented compatibility
sequence; this finding does not authorize activation or deployment.

### ORD-A16: paid completion and repair must share one Session lock order

2026-09-07 candidate review. Classification: `FIX_BEFORE_ACTIVATION`;
corrected and locally PostgreSQL-proven in the undeployed candidate, not
asserted fixed in production.

The paid writer locked the signed `StripeWebhookEvent`, then the
`CheckoutStockReservation` row, and only near the end called the existing
reservation-completion function. That function acquires the Session advisory
lock before the same reservation row. Concurrent repair finalization already
uses Session advisory lock -> reservation row. A reachable paid delivery and
`PAID_OR_COMPLETE` repair could therefore form the inverse wait cycle: paid
owned the reservation and waited for Session while repair owned Session and
waited for the reservation.

This was reproduced against PostgreSQL 16.14 with the real predecessor
`grainline_checkout_reservation_complete` and
`grainline_checkout_reservation_repair_finalize` function bodies plus the
actual paid-writer candidate. Three separate connections and an independent
test-only advisory barrier made the ownership order observable through
`pg_blocking_pids`. The before-fix result was paid `created` and repair SQLSTATE
`40P01`; PostgreSQL selected repair as the deadlock victim. This is a confirmed
candidate concurrency defect, not an observed production incident, data-loss
claim or RLS-policy failure. The sanitized local before log has SHA-256
`f0bdca9677277a9da1ba1354794b2347ceb788dd7801b1802b102bf4da9acf30`.

The corrected writer keeps the verified webhook-event row first, then acquires
the established Session advisory lock namespace `913337` before selecting the
reservation `FOR UPDATE`. It therefore matches completion and repair:
verified event -> Session -> reservation. The event is still authenticated
before a caller can consume a Session lock, and all source, actor, inventory,
payment and replay checks remain inside the same transaction.

Acceptance criteria are explicit:

- the harness must install and catalog-attest the exact real predecessor
  completion and repair bodies, not substitutes;
- paid-first must visibly own the reservation before repair begins, while
  repair-first must visibly own Session before paid begins;
- neither observed order may return `40P01` or another transaction error;
- both orders must end with one Order for the Session, stock zero, a
  `COMPLETED` reservation, a cleared repair claim and exact replay; and
- the existing forged-authority, restricted-runtime, rollback and source
  projection controls must continue to pass.

Local post-fix PostgreSQL results satisfy both schedules. Paid-first returns
paid `created` and repair `superseded`, because completion cleared the repair
claim before repair obtained the row. Repair-first returns repair `deferred`
and then paid `created`. Both exact replays return `replayed` without another
Order or stock effect. A dedicated PostgreSQL 16 CI job now preserves this
three-connection proof. The final sanitized local after log has SHA-256
`1c05bb35eda5fcef630ddafe5fb1171c8710c49144b0e44f848fab1f3d347f5b`;
its exact-head remote result remains a release gate.

The first independent remote proof run `34088368605` failed before schema
setup because PostgreSQL reported its GitHub service-container address
`172.18.0.2`, even though the client target was the required numeric loopback.
The proof identity rule now keeps the exact loopback URL, database, owner and
PostgreSQL-major checks, accepts an RFC1918 server address only under GitHub
Actions, and rejects public, malformed and non-CI private addresses. This was
a fail-closed proof-harness portability failure; it did not execute the lock
schedule or alter the candidate SQL.

Only the undeployed paid-checkout draft, byte-identical staged migration,
compatible-prefix byte pin, proof harness and documentation change. No applied
historical migration, production table, deployment or provider state changes.
The wider candidate review and full compatibility sequence remain mandatory.

### ORD-A17: staff mutations require the isolated credential and action PIN

2026-09-07 candidate review. Classification: `FIX_BEFORE_ACTIVATION`;
corrected and locally PostgreSQL-proven in the undeployed candidate, not
asserted fixed in production.

The staff Order queue/detail projections already required exact
`SESSION_USER = grainline_staff_read_runtime`, because their PII and provider
state must not be callable by the shared marketplace credential with a forged
EMPLOYEE/ADMIN ID. The later mark-reviewed, external-label-void and append-note
functions accidentally violated that same threat boundary: all three were
granted to `grainline_app_runtime` and relied only on a caller-supplied staff
row. A holder of the ordinary runtime credential could therefore forge a known
staff ID and mutate arbitrary Order review, label or note state. The matching
Server Actions also rechecked Clerk, role and rate limit but relied on the admin
layout for Admin-PIN gating rather than verifying the signed PIN session at the
action boundary.

The accepted correction retains the already-reviewed separate role and
environment names for operational compatibility, but explicitly expands their
semantic contract from read-only to an exact isolated staff surface:

- two bounded v2 queue/detail projections;
- three fixed, atomically audited Order mutations; and
- no table, sequence, schema-create, default or unrelated definer authority.

The three mutation functions now require the exact isolated `SESSION_USER` and
grant nothing in their migration. Both `PUBLIC` and ordinary runtime are
revoked. The staff-role converger grants exactly the six operations only after
the compatible prefix exists. The application mutation helpers require an
explicit client, all three actions use `getOrderStaffReadClient()`, and the
action guard verifies the Clerk-session-bound Admin-PIN cookie after the live
staff-row check. Layout visibility remains defense in depth rather than the
authorization boundary.

Disposable PostgreSQL proves the three transitions and their audit rows through
the isolated session while direct Order/audit access stays denied. It proves
ordinary runtime cannot invoke a mutation with a forged staff ID and that an
accidental future EXECUTE grant still fails inside the function on
`SESSION_USER`. Static tests pin explicit-client use, zero ordinary grants,
three session checks and action-level PIN verification. Exact-head CI, actual
separate-login convergence, pooled application smoke, compatible deployment and
predecessor drain remain release gates. This correction changes only the
unapplied candidate and does not establish or alter production credentials,
grants, rows, migrations, deployments or RLS posture.

### ORD-A18: first-sale congratulations must be a seller milestone

2026-09-07 candidate review. Classification: `FIX_BEFORE_ACTIVATION`;
corrected and locally unit-proven in the undeployed application candidate, not
asserted fixed in production.

The post-payment projection correctly excludes refunded, payment-blocked and
held-for-review Orders and chooses the earliest legitimate `(paidAt, id)` tuple
among rows visible to its statement. Its first-sale email idempotency key was
nevertheless Order-scoped. If a later-signed first Order completed its entire
side-effect pass before an earlier signed event created its Order, both closed
projections could truthfully observe no earlier visible Order. They would then
enqueue different keys and send the one-time congratulations twice.

The correction treats the email as a `SellerProfile` milestone. Every initial
Order for one seller now converges on `first-sale-congrats:<sellerProfileId>`;
the unique EmailOutbox key elects one job even when both projections return
true, while different sellers remain isolated. This preserves retry after
direct-send or webhook failure because the retained outbox job owns delivery.
The maximum accepted Stripe event age is 30 days and terminal outbox retention
is 30 days measured from later delivery/update time, so an accepted earlier
event cannot arrive after the newer event's milestone row is eligible for
deletion. After that boundary, retained legitimate Order history makes future
projections false.

Focused tests pin seller convergence, cross-seller separation and the absence
of the old Order-scoped key. The PostgreSQL test name now accurately states
what it proves: earliest selection among visible committed Orders, not an
atomic durable claim across transactions. This application-only correction
does not alter the staged SQL bytes, migration order, database state, provider
state or RLS posture.

### ORD-A19: seller refund responses must not expose provider identifiers

2026-09-07 candidate review. Classification: `FIX_BEFORE_ACTIVATION`;
corrected and locally contract-tested in the undeployed application candidate,
not asserted fixed in production.

The participant detail projection and seller UI already replaced raw Stripe
refund identity with a derived refund state and amount. The seller refund API
success response still returned both the primary Stripe refund ID and the full
refund-ID list even though the client consumed only `refundAmountCents`. Those
identifiers are reconciliation metadata rather than participant receipt data,
so returning them widened the participant boundary without a product need and
contradicted ORD-A12.

The response now contains only `ok` and the refunded amount. Server-side
finalization, retry and restricted telemetry retain the identifiers required
for reconciliation. A source contract isolates the final success response and
rejects either identifier field while preserving the amount used by the UI.
This application-only correction does not alter migrations, database rows,
provider state, grants or RLS posture.

### ORD-A20: checkout notifications must participate in signed-event retry

2026-09-07 candidate review. Classification: `FIX_BEFORE_ACTIVATION`;
corrected and locally contract-tested in the undeployed application candidate,
not asserted fixed in production.

The checkout post-payment path used the best-effort Notification helper for
buyer confirmation, seller sale and low-stock alerts. That helper records a
failure but intentionally does not throw. A transient Notification database
failure could therefore be followed by a successful email pass and Stripe
event completion, permanently losing the in-app alert even though the signed
event and exact source identity were still available.

These three provider-backed notifications now use the throwing helper. A
failed write keeps the signed Stripe event retryable. On retry, the exact
Session lookup reaches the same post-payment path, while Notification source
deduplication and EmailOutbox keys make already-completed side effects safe to
replay. This does not make email delivery synchronous: the existing durable
outbox continues to own email retry. Static coverage pins all three throwing
calls and the existing-order retry path. This application-only correction
does not alter migrations, database rows, provider state, grants or RLS
posture.

### ORD-A21: ban review mutations must carry isolated staff authority

2026-09-07 candidate review. Classification: `FIX_BEFORE_ACTIVATION`;
corrected and locally PostgreSQL-proven in the undeployed database-first
candidate, not asserted fixed in production.

The first seller-ban review candidate moved direct Order reads and writes into
two fixed operations, but both remained callable by ordinary runtime with a
caller-supplied ADMIN user ID. The database verified that the named actor was
an active ADMIN; it did not prove that the call came through the separately
authenticated staff credential. Disposable PostgreSQL reproduced an ordinary-
runtime call naming `admin-1` and receiving buyer/Order restoration material.
Route auth was useful defense in depth, not a source-validating database
boundary.

Granting the Order consumers only to the staff role would require committing
their updates outside the existing User, SellerProfile, Commission and
AdminAuditLog transaction. That was rejected because a failure could leave ban
state and Order review state divergent. Keeping a caller actor ID was rejected
because it preserved the forged-authority defect.

The accepted candidate adds a private, policyless FORCE-RLS
`OrderStaffCapability` table. Only a direct `grainline_staff_read_runtime`
session can call the mint, whose body repeats the exact session fence and
active ADMIN/target validation. The five-minute UUID is bound to target,
operation and canonical restore-payload hash. Ordinary runtime has no table or
mint authority and can only atomically consume one exact capability inside the
existing transaction. Commit makes it one-use; rollback restores it for a
bounded retry. Expired, replayed, cross-target, cross-operation, forged and
payload-substituted calls fail closed. Ban, manual unban and audit undo routes
also repeat the signed Admin-PIN check before minting.

The application integration review also caught a fail-closed response
regression introduced by the new ordering: capability minting preceded the
old transactional missing-target check, so a missing/deleted account could
surface as an internal SQL error instead of the established bounded policy
response. Ban and unban now perform a response-contract-only target preflight
before minting. The SQL mint and consumer remain authoritative and repeat the
locked target validation, preserving denial under concurrent deletion or role
changes.

Manual unban also retains its documented external-sync retry. Because the local
unban transaction commits before Clerk synchronization, a retry sees an
already-unbanned target. The candidate now routes that state to idempotent Clerk
convergence before capability minting; it does not replay Order review restore,
seller state or the local unban transaction. A first-attempt unban remains
capability-bound and atomic, and its external-sync evidence carries the exact
unban audit-row id.

Focused static and disposable PostgreSQL proof covers the source/control/sink
chain, direct-table denial, defense-in-depth `SESSION_USER` fence after an
accidental grant, one-use semantics, rollback safety and payload binding. The
candidate changes only draft/staged migration bytes, application wiring,
schema, grant inventories, proofs and documentation. Production remains
unchanged. Acceptance still requires exact six-function staff-role
provisioning, byte-pinned compatible migration, separate-login postflights,
compatible deployment/smoke/drain and the normal Order Phase-A/FORCE gates.
See `docs/order-ban-review-authority.md`.

Residual cross-provider ordering is tracked separately from this RLS release.
Ban and unban database transitions are atomic and their Clerk calls are
retryable, but opposing concurrent staff actions can still complete external
calls out of commit order. The launch backlog therefore requires a durable
per-user desired-state generation/outbox and concurrency proof. That
pre-existing lifecycle hardening is a launch gate, not a reason to broaden or
delay the Order table's fixed-authority and RLS boundary.

### ORD-A22: fixed writers must accept the signed Stripe event window

2026-09-07 candidate review. Classification: `FIX_BEFORE_ACTIVATION`;
corrected and locally engine-proven in the undeployed database-first candidate,
not asserted fixed in production.

The applicable Stripe route verifies the signature and accepts an event
timestamp up to 30 days old with ten minutes of positive clock skew before
reserving its durable event lease. Both the paid-checkout and
seller-deauthorization fixed writers
receive that same signed timestamp, but their candidate SQL independently
rejected timestamps older than eight days or more than five minutes ahead. A
valid manually resent event in the 8-30 day interval, or a valid 5-10 minute
skew interval, could therefore pass the shared signed-envelope boundary and
then fail every database application attempt. Paid checkout would not create
its Order; seller deauthorization would not clear the account or mark affected
Orders. The webhook lease would remain retryable, but the narrower fixed writer
could never succeed before the shared route itself aged the event out.

The correction does not widen cryptographic or source authority. Both writers
still require the active `StripeWebhookEvent` generation, exact source object,
processing lease, normalized UTC timestamp and all existing source-derived
business invariants. Their future bound matches the shared ten-minute skew
constant. Their lower bounds preserve the route's 30-day age window plus
bounded clock transit: two minutes around the platform checkout route's
60-second ceiling and one minute around the Accounts-v2 closure route's
30-second ceiling. Those small asymmetric allowances prevent an event accepted
at a route boundary from aging out before the SQL call; they are not extensions
of either public route or substitutes for signature checks. The routes remain
the signature and age boundaries; the database remains the active-generation
and state-transition boundary.

Static contract tests bind both SQL members to
`STRIPE_WEBHOOK_MAX_EVENT_AGE_SECONDS` and
`STRIPE_WEBHOOK_FUTURE_SKEW_SECONDS`, each applicable route ceiling and SQL
allowance, and reject recurrence of the old 8-day or 5-minute predicates.
Disposable engine tests exercise both accepted and rejected old/future
witnesses through the restricted runtime role. UTC wall-clock strings are kept
inside PostgreSQL semantics so the proof
does not accidentally reinterpret timestamp-without-time-zone values through
the host timezone. Drafts and staged migrations remain byte-identical, and the
compatible-prefix pins are refreshed. No historical migration, production row,
grant, deployment, provider state or RLS posture changes in this correction.

### ORD-A23: terminal seller cleanup was wired to an unreachable provider identity

2026-09-07 candidate review. Classification: `FIX_BEFORE_ACTIVATION`;
corrected and locally engine-proven in the undeployed database-first candidate,
not asserted fixed in production.

The original conversion preserved the historical platform-route branch for
`account.application.deauthorized`. That was not valid authority for
Grainline's current seller system. Stripe defines the event for an OAuth
application, its `data.object` is the application, and its connected account is
the top-level `event.account`. Grainline creates Accounts-v2 Express accounts,
its platform endpoint is intentionally not subscribed to the OAuth event, and
its separately signed Accounts-v2 endpoint already subscribes to
`v2.core.account.closed`. The candidate branch nevertheless read
`data.object.id` as an account ID. A real event could not satisfy the fixed
writer's required `acct_...` source identity, while the reachable terminal v2
closure event only ran the nonterminal charges-enabled mirror.

The correction removes the dead classic branch and invokes the restart-safe
seller cleanup only for `v2.core.account.closed` on the separately signed
Accounts-v2 route. The account identity comes from the already validated
notification `related_object`, the exact same identity reserved in
`StripeWebhookEvent`; the SQL function accepts only that event type and exact
active generation. Closure runs before provider retrieval, clears only a
currently matching account, durably holds eligible paid Orders, and preserves
replay identity for cache/session side effects. Nonterminal v2 events continue
through the existing provider-state mirror and do not permanently hold paid
Orders. A replacement account still cannot clear historical holds without the
separately audited staff review operation.

Static tests bind the exact provider subscription, v2 route, retired classic
branch and SQL event type. Disposable engine proof accepts the v2 closure,
rejects the retired OAuth event, proves complete Order effects, direct-table
denial, replay after account clearing, replacement-account preservation and
atomic rollback. The artifact keeps its historical deauthorization names as
internal compatibility terminology, but no OAuth event is accepted. No
historical migration or production/provider state changes in this correction.

### ORD-A24: closure session side effects are not fully fenced or retry-proven

2026-09-07 follow-through review after `4d0fae83`. Classification:
`FIX_BEFORE_ACTIVATION`; corrected with executable orchestration tests in the
isolated candidate. Production behavior is not claimed changed.

Before this correction, the database closure operation preserved exact account
identity on replay, but its side effect called `expireOpenCheckoutSessionsForSeller`.
That helper matches sessions by seller identity; its `stripeAccountId` input
is telemetry only. A delayed closure replay after a replacement account is
linked can therefore expire a new checkout for that same seller. The SQL
replacement-account proof does not cover this provider side effect.

The same helper catches list/expiry failures, caps scans at ten pages, and
swallows stock-restoration errors. A successful return is not evidence of
complete expiry, and the previous v2 route marked the lease processed anyway.
Earlier claims that awaiting this helper made every expiry retryable were too
strong. New checkout sessions expire after 31 minutes, and the paid-checkout
writer independently rejects disabled/disconnected or changed seller accounts
into the blocked-payment flow; these are backstops, not proof of precise cleanup.

The correction writes `sellerStripeAccountId` into both checkout families'
server-created Session metadata from the exact `payment_intent_data` destination.
The terminal closure route calls a separate strict adapter requiring both that
account and the database-derived seller. The ordinary vacation/listing sweeps
retain their existing behavior. No table grant, SQL signature, migration or
provider configuration changes are needed.

The strict sweep includes expired as well as open sessions within the existing
two-hour created-time window. List, expiry, ambiguous-response retrieval and
stock-restoration failures propagate to the route's failed-lease path. An
ambiguous expiry retrieves only that exact Session: confirmed expiry permits
idempotent stock restoration; completed checkout leaves payment processing to
the signed payment flow; an unresolved open session remains retryable. A retry
can therefore repair a session expired before the previous database failure.
Provider-returned account/seller/session drift fails before stock restoration.

An unbound payable predecessor session is never guessed to belong to the closed
account: it is left untouched and keeps the closure delivery retryable until
it completes or reaches its 31-minute expiry. Unbound expired sessions and
restoration delayed beyond the two-hour scan window remain owned by the existing
signed expiry/repair-worker paths. New sessions appearing after a scan retain
the same native expiry and paid-checkout account revalidation backstops. A
successful sweep means completion of its bounded provider scan, not a durable
claim that no future or historical session exists.

Executable tests cover replacement-account and other-seller isolation,
partial success/retry, list/expiry/retrieval failures, expired-session stock
retry, payment races, identity drift, legacy ambiguity, invalid inputs and
pagination exhaustion. The ten-page/1,000-session bound now throws instead of
silently claiming exhaustion. Provider throughput and the 30-second handler
limit remain a measured rollout concern; the durable-work-queue follow-up is
tracked in `docs/deferred-launch-backlog.md`. Fresh signed route smoke remains
required before production acceptance.

Provider contract references: Stripe's [Session listing API](https://docs.stripe.com/api/checkout/sessions/list)
supports created-time/cursor pagination without an open-only filter; the
[Session expiry API](https://docs.stripe.com/api/checkout/sessions/expire)
accepts only open sessions and can reject an already-terminal session. That is
why a failed expiry is followed by an exact retrieval rather than treated as
either guaranteed failure or proof that stock is safe to restore.

2026-09-07 validation: all 14 new executable/adapter tests pass; the focused
closure and v2 route set passes 24/24. Full candidate suite: 4,310 passed,
12 skipped, zero failed (4,322 tests, 536 suites). TypeScript, ESLint and
`git diff --check` pass. Preceding checkpoint `aadc09fb` CI `34145262838`
also succeeded. These are local/candidate proofs, not a live provider smoke or
permission to merge, deploy or activate Order RLS.

### ORD-A25: account deletion could overwrite a concurrent staff review note

2026-09-07 review of the complete Order compatibility stack. Classification:
`FIX_BEFORE_ACTIVATION`; corrected and locally engine-proven in the isolated
candidate. Production behavior is not claimed changed.

The staged account-deletion function previously materialized redacted
`reviewNote` values before acquiring each Order row lock. Under the
application's normal read-committed transaction, a staff append could hold the
Order lock while deletion read the preceding note. After the staff transaction
committed, deletion resumed and wrote its stale materialized value, silently
discarding the authorized note. The deleting User lock does not serialize this
path because staff authority locks the staff actor and the target Order, not
the deleting participant's User row.

A synthetic PostgreSQL 16 two-connection reproducer observed the deletion
backend blocked behind the staff backend and then confirmed the new staff text
was absent. The correction removes the materialized candidate and applies the
redactor directly to the target tuple. PostgreSQL's read-committed update
recheck now evaluates the expression against the current committed row.

The permanent PostgreSQL 16 proof applies the real staged migration, enters
the exact lock interleaving, and verifies that the actor's sensitive text is
redacted, the concurrent staff note remains, the actor's other Order PII and
quote are scrubbed, and an unrelated order is unchanged. Static checks reject
reintroduction of a materialized review candidate. This correction changes no
function signature, selected row ownership, table grant, RLS posture, or
production state.

### ORD-A26: dispute-quality projection is missing from three trust consumers

2026-09-07 independent review of the imported Order-family audit.
Classification: `FIX_BEFORE_ACTIVATION`; confirmed and corrected in the staged
`20260905170000_correct_order_authority_composition` migration, not yet applied
to production.

`Order.paymentConversionDisputeBlocked` is a database-maintained projection of
the latest signed dispute state. Its trigger and anti-forgery guard correctly
treat every state except `won` and `warning_closed` as disqualifying for
conversion quality. The public aggregate authority consumes that projection,
but the sibling eligibility, seller-analytics and seller-metrics authorities
do not. Consequently, a chargeback-lost Order can still contribute to seller
revenue, Guild thresholds and review eligibility even though the canonical
quality projection excludes it.

This is a consumer-composition defect, not a projection defect. The staged
successor retains the distinct refund and dispute columns and excludes disputed
Orders from review eligibility, verification sales, revenue, conversion and
completed-sales facts. It deliberately preserves fulfilled-order shipping
performance and the listing archive blocker: a later chargeback does not erase
what was actually shipped, and an unresolved dispute must not allow archival.
Focused PostgreSQL covers the corrected consumers; the complete migration-stack
proof remains required before the Order compatibility stack is accepted.

### ORD-A27: blocked-checkout refund can cross a manual-fulfillment boundary

2026-09-07 independent review of the imported Order-family audit.
Classification: `FIX_BEFORE_ACTIVATION`; confirmed in narrower form than
reported and corrected in the staged
`20260905170000_correct_order_authority_composition` migration, not yet applied
to production.

The historical blocked-checkout claim does not require a pending fulfillment
state, and its record function restores in-stock inventory without rechecking
fulfillment. A signed-event retry can therefore claim and record a refund for
an Order that has since moved to `SHIPPED`, `READY_FOR_PICKUP`, `DELIVERED` or
`PICKED_UP`, then make sold inventory available again. The claim and record
operations both lock the Order, so the correction belongs in both locked
state checks rather than in application timing.

The imported claim that label purchase is wholly unguarded is stale when the
complete candidate is composed: the later
`Order_provider_claim_mutual_exclusion_check` rejects both label-then-refund
and refund-then-label overlap. That invariant is not yet production-live, so
it remains a mandatory predecessor. The staged correction also repeats the
label and active-label-claim rejection at both refund boundaries as
defense-in-depth, explicitly requires `PENDING` fulfillment at claim and record
time, and proves the record-time fulfillment race leaves stock sold out.

### 2026-09-07 imported audit disposition

The remaining imported claims were checked against the complete current
candidate rather than individual historical files:

- the deauthorization hold remains text-coupled technical debt, but the claim
  that nothing binds the text is false: `tests/order-review-holds.test.mjs`
  pins the prefix across fulfillment, label and participant detail. A future
  typed, clearable review-hold state is preferable to making the existing
  terminal-account timestamp permanent;
- receipt-notification `p_type = NULL` can bypass the explicit matrix branch,
  but the final `Notification.type NOT NULL` constraint aborts the transaction
  before durable effects. Add an explicit null guard with the next authority
  correction; this is hardening, not a current authorization bypass;
- label provider-record `p_outcome = NULL` is a real input-domain defect even
  though success still requires provider evidence. The clawback and ambiguous
  release null cases are contained by their later state/evidence checks;
- refund-reconciliation null reason/action/disposition inputs are inconsistent
  validation. The action/disposition paths fail at later non-null constraints;
  the nullable reason can select the ambiguous branch. Normalize these in the
  correction tranche without widening target authority;
- the live CheckoutStockReservation repair operation accepts a null outcome
  through a `NOT IN` guard and can classify it as restored. This is a confirmed
  cross-table integrity defect and requires its own additive, independently
  activated CheckoutStockReservation successor before relying on that repair
  path. A tested draft now rejects NULL before any side effects and preserves
  all six legitimate outcomes; release wiring and production acceptance remain
  open in `docs/checkout-reservation-repair-outcome-correction.md`; and
- StripeWebhookEvent legacy lease retirement, DirectUpload dependency-catalog
  completeness, SavedSearch deterministic ordering, report-admin context
  links and Conversation file-payload shape are valid separately scoped
  follow-ups. They are not evidence that the Order candidate is early-stage or
  permission to bundle unrelated live-table changes into Order activation.

No production state is changed by this disposition. The Order candidate is a
late compatibility stack with zero direct source access. ORD-A26, ORD-A27 and
the account-deletion concurrency correction now have staged implementations,
but none is accepted in production. Phase A still requires their complete
prefix evidence, the separate CheckoutStockReservation repair correction, and
a fresh accepted authenticated route smoke.

### 2026-09-07 CI setup correction after composition checkpoint

CI `34159053890` failed before executing the historical refund proof because
its new behavior cases read a successor migration while the pipeline had
intentionally moved that suffix out of the migration tree. The four standalone
behavior suites now read the identical retained draft; the complete-prefix
contract still verifies draft/migration bytes before and after isolation, and
the final PostgreSQL step still applies the complete migration chain.

Concurrency run `34159053735` stopped at its server identity assertion: a client
connecting to numeric loopback through a published Docker port sees the private
container address from `inet_server_addr()`. Both local concurrency operators
now share the existing CI-private-address rule, with strict IPv4 parsing.
Client URLs still require `127.0.0.1`, an exact disposable database and owner,
and no connection-option overrides; PostgreSQL 16 and empty-database checks
remain mandatory. Private server addresses are rejected outside GitHub Actions.
Neither failed run is accepted concurrency or migration evidence.
