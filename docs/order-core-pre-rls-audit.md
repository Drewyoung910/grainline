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

### ORD-A05: 41 source files still touch Order authority directly

The exact current inventory is pinned below. Activation cannot proceed while
ordinary runtime code can still use these base-table paths. Each file needs one
semantic destination; simply hiding Prisma calls behind a generic repository
would preserve the same over-broad credential authority.

Participant, account and export reads:

- `src/app/account/orders/page.tsx`
- `src/app/account/page.tsx`
- `src/app/api/account/export/route.ts`
- `src/app/checkout/success/page.tsx`
- `src/app/dashboard/orders/[id]/page.tsx`
- `src/app/dashboard/orders/page.tsx`
- `src/app/dashboard/sales/[orderId]/page.tsx`
- `src/app/dashboard/sales/page.tsx`

Staff and administrative reads/transitions:

- `src/app/admin/actions.ts`
- `src/app/admin/cases/[id]/page.tsx`
- `src/app/admin/flagged/page.tsx`
- `src/app/admin/orders/[id]/page.tsx`
- `src/app/admin/orders/[id]/refundReconciliationActions.ts`
- `src/app/admin/orders/page.tsx`
- `src/app/admin/verification/page.tsx`

Participant/service mutation routes:

- `src/app/api/orders/[id]/confirm-delivery/route.ts`
- `src/app/api/orders/[id]/fulfillment/route.ts`
- `src/app/api/orders/[id]/label/route.ts`
- `src/app/api/orders/[id]/refund/route.ts`
- `src/app/api/stripe/webhook/route.ts`

Eligibility, analytics and aggregate readers:

- `src/app/api/reviews/route.ts`
- `src/app/api/seller/analytics/recent-sales/route.ts`
- `src/app/api/seller/analytics/route.ts`
- `src/app/api/users/[id]/report/route.ts`
- `src/app/api/verification/apply/route.ts`
- `src/app/dashboard/verification/page.tsx`
- `src/lib/homepageStats.ts`
- `src/lib/listingSoftDelete.ts`
- `src/lib/metrics.ts`
- `src/lib/publicSellerStats.ts`
- `src/lib/quality-score.ts`
- `src/lib/site-metrics-snapshot.ts`

Lifecycle, repair and retention readers/writers:

- `src/lib/accountDeletion.ts`
- `src/lib/audit.ts`
- `src/lib/ban.ts`
- `src/lib/caseLifecycleLocks.ts`
- `src/lib/checkoutStockRestore.ts`
- `src/lib/labelClawbackRetry.ts`
- `src/lib/orderRefundProviderReconciliation.ts`
- `src/lib/refundLocks.ts`

Development-only fixture path:

- `src/app/api/dev/make-order/route.ts`

### ORD-A06: the development Order creator is unreachable in production but incomplete

`/api/dev/make-order` correctly requires local development, absence of Vercel,
an explicit feature flag, authentication and an active account. It is not a
production back door. It nevertheless creates a paid Order without an explicit
seller key or historical snapshot and is a direct ordinary-runtime Order
creator in the source inventory.

Before activation, either convert it to a separately gated test fixture
operation that produces a fully valid modern Order or remove it. Do not grant a
generic create function solely to preserve this convenience route.

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

### ORD-A08: aggregate and eligibility queries need named operations

Homepage totals, public seller stats, seller analytics, quality score,
verification, reporting and review eligibility raw-join Order/OrderItem and in
some cases Listing. These consumers need counts or bounded outcomes, not Order
rows. Create named aggregate/eligibility functions with fixed return shapes,
durable seller predicates and explicit paid/refund/dispute rules. They must not
restore base-table `SELECT` merely to keep a dashboard query working.

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
- aggregate consumers still rely on broad raw table access;
- the development fixture creates an incomplete modern Order; and
- the nullable seller keys and snapshot shape still need final convergence.

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
exports. Prove staff role changes, no participant provider-column exposure and
bounded aggregate semantics.

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
- seller keys and other authority-relevant invariants pass fresh inspection;
- the compatible app is deployed and predecessor overlap is drained;
- the migration, grants, rollback and separate-login PostgreSQL proofs pass;
  and
- Phase A and FORCE remain distinct production releases.
