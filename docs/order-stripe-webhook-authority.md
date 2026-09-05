# Order Stripe-webhook authority

Status: audited design with isolated SQL and application candidates. No SQL in
this document is a production migration, and the application candidate is
intentionally not deployable before its database-first compatible release.
This record does not authorize a deployment, grant change, provider mutation,
or Order/OrderItem RLS activation.

Audited application checkpoint: `3aeb05af` (2026-09-05).

## Decision

The Stripe webhook is the last ordinary-runtime source file with direct
`Order` and `OrderItem` access. It must not be converted by moving its Prisma
calls behind a generic repository. The route authenticates and normalizes the
provider envelope; PostgreSQL must independently bind each mutation to the
active `StripeWebhookEvent` generation, its immutable source object, the
checkout-time database source, and the exact state transition.

The conversion is one compatibility family but five named authorities:

1. checkout source persistence and paid-order creation;
2. exact checkout-session idempotency lookup;
3. blocked-checkout review/refund state transitions;
4. bounded post-payment projections and first-sale classification; and
5. restart-safe seller deauthorization.

Order activation remains separate from later `OrderItem` and
`OrderShippingRateQuote` activation. All three direct inventories must be zero
for the table being activated; a completed webhook conversion does not bundle
the three tables into one release.

## Authentication boundary

PostgreSQL does not verify Stripe signatures. The route must continue to:

- read a bounded raw request body;
- validate the signature with the route-specific webhook secret;
- reject missing, malformed, future-unsafe, or stale event timestamps;
- retrieve and compare thin events where required; and
- acquire the exact generation-fenced `StripeWebhookEvent` lease with the
  signed object's canonical ID.

After that boundary, the database may trust only the active event ID,
generation and already-bound source-object tuple. It must derive user, seller,
listing, reservation, Order and OrderItem relationships itself. Provider
amounts, currency and identifiers remain inputs because PostgreSQL cannot call
Stripe, but every one is shape-bounded and compared with the bound checkout or
existing payment state before a write.

## Product corrections found before RLS

The pre-RLS audit deliberately reviewed behavior, not only access syntax.

### Signed payment time

Both paid checkout families previously stamped `paidAt` with webhook handler
time. A delayed delivery or replay could therefore move review eligibility and
analytics windows. The isolated candidate now rejects a missing Stripe event
timestamp and uses the age-validated signed event time in both creation paths.

### First legitimate sale

The first-sale congratulations query previously counted every seller Order,
including a blocked checkout or refunded payment. The candidate now requires a
paid, non-refunded, non-payment-blocked Order and excludes the blocked-checkout
review marker. A failed synthetic sale can no longer consume the milestone.

### Listing-page review hint

The listing page directly queried `OrderItem` to decide whether to show the
review composer. It now calls the same actor-bound fixed eligibility operation
used by the write route. The POST route remains authoritative and rechecks
under the Order lock.

## Finding ORD-W01: checkout source is proven and then discarded

The source-consistent CheckoutStockReservation functions currently rebuild the
seller, listing, variant, image, price, package and cart-item witness under
locks and compare it byte-for-byte with the application witness. They persist
only the inventory subset. At payment time the webhook reconstructs item
snapshots from mutable Listing and Cart rows.

Consequences:

- a CartItem removed after Checkout Session creation can erase the selected
  variant snapshot from retained purchase history;
- an edited title/photo/package graph can make the paid record describe a
  later catalog state; and
- a made-to-order Buy Now checkout has no reservation row at all, so it lacks
  a durable checkout-to-payment database source.

Decision: extend the already policyless-FORCE `CheckoutStockReservation` with
one nullable, 4-MiB-bounded object `sourceSnapshot`. Add new versioned creation
functions; do not replace predecessor functions in place. The new functions
first reduce the versioned witness to the predecessor pricing shape and let the
existing locked function accept it. While those locks remain held, a private
successor helper independently rebuilds and compares the additional retained
history fields: description, category, tags, every ordered photo URL,
processing bounds and ships-within days. Only then is the full JSON persisted.
The single-item successor creates a source-only reservation with
`reservedItems = []` for made-to-order checkout. This gives every new Checkout
Session one durable source row without inventing stock.

The original 1-MiB candidate bound was insufficient: a legitimate 50-item cart
with ten maximum-length photo URLs per listing can exceed it. The 4-MiB bound
is covered by a worst-shape application test and remains enforced both on the
column and at each fixed-operation entry point.

Deployment compatibility order:

1. add the nullable column, constraint and versioned functions;
2. deploy checkout routes that use the successors and require one reservation
   for both listing types;
3. prove new in-stock, made-to-order and cart sessions bind snapshots;
4. drain predecessor deployments; and
5. let the paid-order function require the reservation snapshot for sessions
   created by the new application epoch while retaining an explicit bounded
   legacy branch for older sessions.

The snapshot contains catalog facts, provider routing and seller identity, not
the buyer's shipping address or email. Buyer-entered delivery fields remain in
the signed Checkout Session metadata and are independently bounded before the
database call.

The isolated application candidate now calls only the two versioned snapshot
functions. Both cart checkout and single-listing checkout fail closed when no
reservation row is returned, and made-to-order checkout carries that new
source-only reservation through the existing Stripe metadata and one-time
session bind. Predecessor deployments remain compatible because their original
functions are unchanged. Do not deploy this candidate until the nullable
column and successor functions exist and have passed a pooled-runtime
postflight.

## Finding ORD-W02: deauthorization is neither complete nor restart-safe

The current `account.application.deauthorized` branch first clears
`SellerProfile.stripeAccountId`, then separately flags only open Orders where
`reviewNeeded = false`, then expires provider sessions outside the transaction.

This creates two defects:

- an already-held open Order never receives durable deauthorization state;
  fulfillment and label guards that recognize only the review-note prefix can
  miss it; and
- if the process stops after clearing the account ID, replay cannot rediscover
  the seller from `stripeAccountId` and therefore cannot finish Order marking
  or session expiry.

Decision: add explicit nullable Order fields `sellerDeauthorizedAt` and
`sellerDeauthorizationEventId`, plus a private immutable
`SellerDeauthorizationApplication` ledger keyed by webhook event. A single
"last event" field on SellerProfile is insufficient: a later deauthorization
could overwrite the only recovery identity while an older event still needs to
retry its provider side effect. A fixed deauthorization function must lock the
active webhook lease, derive the seller from either its current exact account
or the immutable account history, atomically disable and clear the account,
insert the exact replay row, mark every open Order regardless of an existing
review hold, and write the audit row. Existing `reviewNote` text is preserved;
the dedicated columns, not a mutable note prefix, become the
fulfillment/label authority.

The new ledger is born policyless FORCE RLS with no direct runtime or PUBLIC
authority; ordinary runtime can use only the deauthorization function. It
retains no customer PII. The function returns only a bounded seller ID and
whether public visibility changed. Provider Checkout Session expiry and
public-cache invalidation remain application side effects, but the immutable
row retains and replays the exact seller/account tuple and whether public
visibility changed until those side effects succeed. The webhook lease is
completed only afterward. A replay after an application crash can therefore
resume without guessing from a cleared profile or silently skipping cache
invalidation.

Reauthorization does not silently clear historical Order deauthorization.
Staff must explicitly review affected open Orders; otherwise a later Stripe
reconnect would make old held Orders fulfillable without a decision.
The staff mark-reviewed successor may clear those fields only after the seller
has a current charges-enabled account; while the seller remains deauthorized it
returns a closed `seller_still_deauthorized` result. This successor and the
fulfillment/label functions' column-based checks must ship before the note
prefix is demoted to presentation-only compatibility.

## Paid checkout authority

The future `grainline_stripe_checkout_order_create` operation must:

- require `checkout.session.completed` or
  `checkout.session.async_payment_succeeded` on the active exact event lease;
- lock the lease, reservation, buyer, seller and source rows in the documented
  global order;
- require the bound reservation/session/payload tuple and a complete durable
  source snapshot for the new application epoch;
- validate one seller, no self-purchase, exact currency, positive signed line
  amounts, charged total, gift-wrap amount and destination account;
- derive durable `sellerProfileId`, listing IDs, titles, selected variants and
  package snapshots from the stored source;
- create exactly one Order and at least one same-seller OrderItem, or return the
  exact existing Order for a replay of the same session; and
- reject an existing session whose signed payment tuple differs.

It must not accept caller-selected Order IDs, buyer/seller relationships,
listing snapshots, review state, fulfillment state, refund state or
notification recipients.

The checkout address is intentionally the address signed into Grainline's rate
token and copied into Checkout metadata. Stripe Checkout currently does not
collect a replacement shipping address. The webhook should therefore retain
the normalized quoted address; any future Stripe address collection is a
separate product change and must define an explicit mismatch policy rather
than silently switching sources.

## Remaining named operations

### Exact idempotency projection

`grainline_stripe_checkout_order_existing(...)` returns only the exact Order ID
and state for the active event's bound Checkout Session. It is not a general
session-ID lookup.

### Blocked-checkout transitions

One fixed state machine derives the review reason category from closed inputs,
sets or advances the generation-fenced refund claim, and preserves unrelated
staff notes. It must not expose a generic review-note writer. Signed refund
finalization remains in the already protected payment-event authority.

### Post-payment projection

`grainline_stripe_checkout_postpayment(...)` returns the bounded buyer/seller
delivery facts, cart cleanup targets and a database-derived
`isFirstLegitimateSale` boolean only for the exact paid Order/session. Email,
cache and analytics side effects remain outside PostgreSQL and are exactly
replayable from this projection.

### Seller deauthorization

`grainline_stripe_seller_deauthorization_apply(...)` implements ORD-W02. No
generic seller disable or Order review writer is granted to ordinary runtime.
The isolated application candidate now replaces the former split
`SellerProfile`/`Order` writes with this single generation-bound operation. It
passes the signature-authenticated event time as an explicitly UTC-normalized
PostgreSQL value, invalidates public visibility from the database's replayable
decision, and expires sessions for the database-derived seller before the
webhook lease can complete. The result parser rejects malformed cardinality,
outcomes, nullable identities, booleans and counts rather than guessing.

This candidate is deliberately not deployable yet. The private application
ledger, fixed operation, dedicated Order columns, fulfillment/label consumers
and staff review successor must land and pass their joint proofs first. That
keeps predecessor application instances compatible and prevents a deployment
from calling a function that production does not yet contain.

## Release gates

Before compatible SQL can enter the migration tree:

- disposable PostgreSQL must prove in-stock, made-to-order and cart snapshot
  persistence, forged-witness rejection and concurrent active-lock behavior;
- deauthorization proof must cover pre-held Orders, exact replay after the
  current account ID is cleared, reauthorization non-bypass and rollback;
- every function must have fixed search path, no dynamic SQL, `PUBLIC` revoked,
  an exact runtime/private ACL classification and bounded output;
- the direct access inventory must be zero after the matching application
  conversion; and
- full TypeScript, lint, unit, migration-tree, grant/RLS and PostgreSQL suites
  must pass.

Production remains a later boundary: read-only inspection, byte-pinned
compatible migration, pooled-runtime postflight, compatible deployment,
authenticated paid/blocked/deauthorization smoke, predecessor drain, Phase A,
then FORCE. No provider proof or RLS activation is implied by the local work.
