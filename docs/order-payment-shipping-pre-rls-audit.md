# Order, payment and shipping pre-RLS audit

Opened 2026-08-04 from exact main
`9e5d87f4c5b4a529bc84c6c2cf077778fe553186` after the Case-family FORCE
release and real pooled-runtime postflight completed. This is an isolated
audit and design record only. It contains no migration, RLS policy, function,
grant change, deployment or production mutation.

## Scope and activation boundary

This sensitive-data program covers these six base models:

- `Order`;
- `OrderItem`;
- `OrderShippingRateQuote`;
- `OrderPaymentEvent`;
- `SellerPayoutEvent`; and
- `CheckoutStockReservation`.

`StripeWebhookEvent` is a required service-ledger prerequisite because signed
Stripe delivery and durable idempotency must remain bound when broad runtime
CRUD is removed. It may receive its own preparation and activation migration,
but the order/payment group cannot claim write integrity while ordinary
runtime code can freely forge or rewrite the webhook source ledger.

Do not silently bundle `Cart`/`CartItem`, `SellerProfile`, `Listing`, Case,
Notification, or public seller analytics into this activation. Fixed order
operations may validate those existing relations. Their own base-table RLS
and public/private projection designs remain separate releases. Finish this
whole order/payment/shipping program before moving to the next sensitive-data
group; separate production releases inside the program are sequencing, not a
deferral.

## Verified direct-access baseline

A machine-checked scanner pins direct Prisma and raw-SQL access under `src`.
The exact baseline is:

| Model | Direct-access source files |
|---|---:|
| `Order` | 38 |
| `OrderItem` | 12 |
| `OrderShippingRateQuote` | 2 |
| `OrderPaymentEvent` | 7 |
| `SellerPayoutEvent` | 3 |
| `CheckoutStockReservation` | 4 |

These counts exclude disposable/proof scripts and nested relation selections
that do not name the Prisma delegate or raw table directly. They are a
conversion floor, not a claim that only 66 semantic operations exist. The
next inventory pass must classify nested reads, fixed Case/Notification
functions, cron and provider side effects as well.

Current operation families include:

- buyer order lists, detail, checkout success, export and deletion;
- seller sales lists/detail, fulfillment, label purchase, refund, payout and
  analytics;
- employee/admin order queues, holds, verification and audit actions;
- signed Stripe checkout, refund, dispute, payout and deauthorization events;
- Shippo quotes, re-quotes, labels and label-clawback retry;
- checkout stock reservation, completion, expiry restoration and pruning;
- Case predicates and refund/dispute application functions;
- review eligibility, seller-quality metrics and public aggregate jobs; and
- operational repair/proof scripts, which need a separately reviewed role or
  owner-only operator rather than ordinary runtime table grants.

## Actor and data matrix

| Actor | Legitimate visibility | Legitimate mutation |
|---|---|---|
| Buyer | Own retained order and item history, totals, fulfillment, tracking, gift state and buyer-safe payment outcome | Checkout initiation occurs before Order creation; after creation only buyer delivery confirmation and bounded participant actions |
| Seller | Orders durably assigned to that seller, purchased item snapshot, fulfillment address while retained, gift instructions, shipping/label state and seller-safe refund outcome | Fulfillment, label purchase/re-quote, bounded seller notes and seller refund through fixed transitions |
| Employee/Admin | Reviewed queue/detail projections including protected PII only after staff authorization | Holds, reconciliation and reviewed administrative transitions with durable audit evidence |
| Stripe webhook | Exact signed event source, target Order/provider identifiers and service-ledger state | Idempotent checkout creation, payment/refund/dispute/payout/deauthorization transitions |
| Shippo/label flow | Exact seller-owned shipping Order and bounded quote snapshot | Re-quote, label claim/finalize/recovery and bounded provider identifiers |
| Cron/repair | Only eligible bounded batches | Reservation restoration/pruning, refund-lock release, PII pruning and label-clawback retry |
| Analytics/public aggregates | Aggregate facts only | Service-owned aggregate refresh; never base-row enumeration by a public caller |

## Target database shape

The likely safe target is policyless `ENABLE` plus `FORCE` RLS with zero
direct runtime/PUBLIC table or column grants on all six tables. Actor-specific
fixed projections should expose only the columns each buyer, seller or staff
path needs. Source-validating fixed mutations should derive seller, buyer,
target row, provider identity, clocks, replay identity and state transitions
from locked database facts.

This is preferable to broad participant SELECT policies on `Order`: row-level
visibility cannot stop a seller from receiving buyer-only or provider-only
columns from the same row, and column grants cannot vary by buyer versus
seller. Service ledgers should have no user-readable base-table policy at all;
their bounded outcomes belong in Order projections.

As with other fixed-operation groups, a stolen `grainline_app_runtime`
credential can still assert an application actor accepted by a granted
function. Clerk/staff/provider verification remains the authentication
boundary. RLS removes arbitrary table CRUD, enumeration, column exfiltration,
target selection and state rewriting; it does not independently authenticate
the human or Stripe.

## Findings

### OPS-A01: broad runtime CRUD across every in-scope table

`scripts/provision-runtime-db-role.sql` currently grants runtime SELECT,
INSERT, UPDATE and DELETE on all six tables. A stolen runtime credential can
enumerate buyer PII and payment/provider identifiers, create arbitrary orders
or ledger events, rewrite fulfillment/refund state and delete evidence. The
activation grant convergence must revoke every direct table and column grant
and fail closed on partial RLS state.

### OPS-A02: seller authority is derived from mutable catalog state

Neither `Order` nor `OrderItem` stores a durable seller profile/user identity.
Seller authorization and most seller queries join `OrderItem.listingId` to the
Listing's current `sellerId`; the sales list even requires both `some` and
`every` items to resolve to that current seller. The database does not make a
Listing seller immutable for the lifetime of an Order. Catalog changes must
not be able to transfer historical order authority.

Add a durable checkout-derived seller identity, preferably on `Order` for the
single-seller invariant and indexed seller paging, with a same-seller OrderItem
constraint or snapshot where needed. Inspect and classify zero-item and
multi-seller legacy Orders before adding or validating it.

### OPS-A03: the missing seller key is also the primary scale bottleneck

Buyer paging has `(buyerId, createdAt)`, but seller lists/counts traverse
OrderItem then Listing and evaluate relational `some` plus `every`. At 50k+
users and growing order history this adds joins, prevents a compact
seller/order index and makes authorization dependent on the catalog table.
Add stable seller/time/id and seller/status/time/id indexes, then use bounded
keyset projections on hot paths. Offset pagination may remain for small admin
queues only with measured limits.

### OPS-A04: historical item rendering and authority still use live Listings

Checkout captures `listingSnapshot`, but buyer/seller/admin order surfaces
still load current Listing titles, photos and seller relations. Edits can
change historical presentation, later Listing RLS can strand order history,
and current seller ownership is incorrectly reused as purchase authority.
Define and validate the snapshot shape, backfill/classify legacy null or
malformed snapshots, and make participant projections prefer immutable
checkout facts while retaining public Listing links only as optional current
catalog context.

### OPS-A05: database invariants are incomplete

Existing checks cover several nonnegative Order amounts and JSON byte limits,
but do not yet enforce the complete authority-relevant shape. The audit must
inspect and then add compatible invariants for at least:

- positive `OrderItem.quantity` and nonnegative/valid `priceCents`;
- one durable seller per Order and consistency across every OrderItem;
- lowercase three-letter currency and currency agreement across Order,
  payment/payout events and provider-derived amounts;
- bounded, shaped `listingSnapshot`, selected variants, quote rates,
  payment metadata and reservation items rather than size alone;
- coherent pickup/shipping fulfillment states and their timestamps;
- coherent label claim/finalization/retry fields;
- immutable payment-event source identity and bounded event taxonomy; and
- refund/dispute totals and terminal states that cannot exceed or contradict
  the retained Order/payment evidence.

### OPS-A06: fixed-operation conversion is larger than route CRUD

Checkout, refund, dispute, fulfillment, delivery, labels, account deletion,
ban/admin actions, review eligibility, analytics and repair jobs all touch the
same graph. Do not activate after converting only user-facing pages. Build a
semantic inventory with one reviewed read/write/cleanup destination for every
direct and nested access, then require the inventory to reach zero unconverted
ordinary-runtime base-table references.

### OPS-A07: service ledgers should not be participant-readable tables

`OrderPaymentEvent`, `SellerPayoutEvent`, `CheckoutStockReservation` and
`OrderShippingRateQuote` contain provider, recovery and replay data. Buyers and
sellers need bounded outcomes, not raw rows. Keep these policyless with no
direct runtime/PUBLIC access. Fixed service writers and participant projections
should expose only status, amount, tracking or retry-safe facts explicitly
required by the product.

### OPS-A08: StripeWebhookEvent isolation is a prerequisite

The Stripe route correctly verifies signatures before reserving its event, but
the ordinary runtime currently has CRUD on `StripeWebhookEvent`. A future
payment function cannot treat that table as unforgeable source evidence until
begin/claim/complete/fail become fixed operations and base-table access is
revoked. Preserve stale-lease recovery and sanitized errors while preventing
arbitrary event creation, completion or deletion.

### OPS-A09: shared Order lock coverage must be completed

Case creation, fulfillment, delivery confirmation, label purchase and refunds
already share an exact Order-row lock in their contended transitions. Other
writers—including checkout creation/finalization, Stripe dispute/refund
updates, account deletion/PII pruning, admin holds, seller deauthorization,
stale-refund repair and label-clawback retry—must be classified against that
lock order. Fields that can safely commute need explicit proof; conflicting
state transitions need the same database lock and fresh post-lock checks.

### OPS-A10: legacy inspection is a hard prerequisite

The aggregate-only production inspector must report, without exporting PII or
provider IDs: zero-item and multi-seller Orders; seller derivation failures;
buyer-equals-seller rows; missing/malformed item snapshots; invalid quantities,
prices, currency or totals; fulfillment/label timeline contradictions;
orphan/duplicate quote and provider-ledger rows; refund/dispute contradictions;
reservation state/shape drift; and hot-path cardinality/maximum-history sizes.
No backfill or cleanup is pre-authorized by the inspection.

### OPS-A11: checkout sessions are seller-scoped, Orders must preserve that fact

The cart UI can prepare several Stripe sessions for a cart containing several
sellers, but `POST /api/cart/checkout-seller` filters one seller's items into
each session. `cartSellerCount` and `multiSellerCheckout` describe the overall
cart/email experience; they do not authorize a multi-seller `Order`. The
webhook nevertheless derives seller authority again from mutable Listings and
does not persist the seller on the Order or OrderItem.

The compatible schema target is nullable `sellerProfileId` on both `Order` and
`OrderItem`, written from the locked checkout Listings. Raw-managed composite
keys should bind `(OrderItem.orderId, OrderItem.sellerProfileId)` to
`(Order.id, Order.sellerProfileId)` and `(OrderItem.listingId,
OrderItem.sellerProfileId)` to `(Listing.id, Listing.sellerId)`. After legacy
classification/backfill, both new columns can become non-null. This proves one
seller per Order, makes seller paging stable, and prevents a purchased Listing
from being reassigned in a way that transfers historical order authority.

### OPS-A12: PostgreSQL cannot authenticate a Stripe signature by itself

The application verifies Stripe's signature before calling the current
webhook helpers. A fixed `stripe_webhook_begin(event_id, event_type)` database
operation can enforce replay, lease and state-transition rules, but a caller
holding only the runtime database credential can still invent its input. The
same is true for provider payload fields passed to checkout/refund/dispute and
payout functions. Do not describe the fixed functions as independently
proving Stripe authenticity.

The honest boundary is: application-held Stripe secrets authenticate the
provider; database operations bind one accepted event to narrowly valid state
transitions and prevent arbitrary table enumeration, deletion and unrelated
row mutation. A separate webhook worker credential/attestation design could
strengthen that boundary later, but is not silently assumed by this rollout.

### OPS-A13: the provider tables do not all have immutable-event semantics

`OrderPaymentEvent` is append-only today (`createMany` with Stripe-event
deduplication). `StripeWebhookEvent` is a mutable processing lease/state row,
and `SellerPayoutEvent` is a mutable latest-state row upserted by Stripe payout
ID. `OrderShippingRateQuote` is an expiring replaceable quote set, while
`CheckoutStockReservation` is a lifecycle state machine.

Fixed operations must preserve those intentional semantics rather than label
every table an immutable ledger. They should make `OrderPaymentEvent`
append-only; expose explicit begin/complete/fail webhook transitions; allow
only monotonic payout state updates from a reserved webhook event; and keep
quote/reservation replacement, restoration and pruning behind exact lifecycle
predicates. None should retain general DELETE or arbitrary UPDATE authority.

### OPS-A14: provider side effects require claim/finalize operations

Refunds, label purchases, transfer reversals and some checkout repair paths
cannot hold a database transaction open across Stripe or Shippo calls. Each
must use a durable claim derived under the shared Order lock, an idempotency key
derived from database facts, and a success/ambiguous/failure finalizer that
compares the exact claim generation. Directly updating an Order before or after
a provider call is not sufficient because stale workers can otherwise finalize
over newer refund, dispute, fulfillment or reconciliation state.

## Semantic write conversion map

This is the first exact write-authority map. Read projections and aggregate
jobs remain the next inventory layer; none of these rows authorizes a function
or migration yet.

| Operation family | Current source | Required fixed destination |
|---|---|---|
| Stripe delivery reservation | `src/lib/stripeWebhookEvents.ts` | begin/reclaim, complete and fail transitions; no direct table read/delete |
| Seller-scoped checkout Order + items | `src/app/api/stripe/webhook/route.ts` | one transaction deriving durable seller, buyer, listing, totals, snapshot, provider replay source and reservation completion |
| Stripe refund/dispute evidence | `src/app/api/stripe/webhook/route.ts`, `src/lib/localRefundEvidence.ts`, `src/lib/refundLedgerSql.ts` | append-only payment evidence plus separately locked Order/Case application |
| Seller refund | `src/app/api/orders/[id]/refund/route.ts`, `src/lib/refundLocks.ts` | seller-authorized refund claim and exact provider finalizers; stale-claim release is an operator/cron transition |
| Fulfillment and buyer delivery | `src/app/api/orders/[id]/fulfillment/route.ts`, `src/app/api/orders/[id]/confirm-delivery/route.ts` | seller/buyer-specific monotonic transitions under the Order lock |
| Shippo quote and label purchase | `src/app/api/orders/[id]/label/route.ts` | seller-authorized quote replacement and label claim/finalize operations with bounded provider snapshots |
| Label clawback retry | `src/lib/labelClawbackRetry.ts` | bounded batch claim plus generation-checked success/failure finalizers |
| Checkout stock lifecycle | `src/lib/checkoutStockRestore.ts`, `src/app/api/cart/checkout/resume/route.ts` | reserve, bind session, complete, restore, repair and terminal-prune transitions with one lock order |
| Account deletion and PII expiry | `src/lib/accountDeletion.ts` | bounded account-owned reservation cleanup, Order PII purge, quote deletion and seller-history anonymization |
| Admin reconciliation | `src/app/admin/actions.ts` | staff-authorized review, void/reconcile and append-note transitions with durable audit evidence |
| Payout failure state | `src/app/api/stripe/webhook/route.ts` | webhook-bound monotonic payout-state upsert; seller receives only a bounded projection |
| Seller deauthorization review flag | `src/app/api/stripe/webhook/route.ts` | exact affected-seller batch operation using the durable Order seller key, not live Listing ownership |

## Semantic read and aggregate conversion map

Every direct-access source pinned by the scanner now has an explicit
destination family. This is a source disposition, not yet a function catalog;
the next design pass must specify exact input/output columns and pagination for
each fixed projection.

Buyer and participant projections:

- compact account history: `src/app/account/page.tsx` and
  `src/app/account/orders/page.tsx`;
- buyer dashboard list/detail: `src/app/dashboard/orders/page.tsx` and
  `src/app/dashboard/orders/[id]/page.tsx`;
- checkout recovery/success lookup: `src/app/checkout/success/page.tsx`;
- purchase/review eligibility: `src/app/api/reviews/route.ts` and
  `src/components/ReviewsSection.tsx`;
- private-target report eligibility: `src/app/api/users/[id]/report/route.ts`;
  and
- account portability: `src/app/api/account/export/route.ts`, with separate
  buyer-order, seller-order, payout and reservation projections.

Seller projections:

- seller home payout summary: `src/app/dashboard/seller/page.tsx`;
- sales list/detail: `src/app/dashboard/sales/page.tsx` and
  `src/app/dashboard/sales/[orderId]/page.tsx`;
- recent-sales and bounded analytics:
  `src/app/api/seller/analytics/recent-sales/route.ts` and
  `src/app/api/seller/analytics/route.ts`; and
- verification eligibility: `src/app/api/verification/apply/route.ts` and
  `src/app/dashboard/verification/page.tsx`.

Staff projections and transitions:

- order queues/detail: `src/app/admin/orders/page.tsx` and
  `src/app/admin/orders/[id]/page.tsx`;
- flagged queue: `src/app/admin/flagged/page.tsx`;
- Case-linked staff order detail: `src/app/admin/cases/[id]/page.tsx`;
- verification evidence: `src/app/admin/verification/page.tsx`; and
- reviewed mutations: `src/app/admin/actions.ts`.

Service, safety and aggregate consumers:

- signed provider ingestion and checkout creation:
  `src/app/api/stripe/webhook/route.ts`;
- reservation resume/restore: `src/app/api/cart/checkout/resume/route.ts` and
  `src/lib/checkoutStockRestore.ts`;
- participant state transitions:
  `src/app/api/orders/[id]/confirm-delivery/route.ts`,
  `src/app/api/orders/[id]/fulfillment/route.ts`,
  `src/app/api/orders/[id]/label/route.ts` and
  `src/app/api/orders/[id]/refund/route.ts`;
- PII expiry/account lifecycle: `src/lib/accountDeletion.ts`;
- staff ban/undo and listing-retention blockers: `src/lib/ban.ts`,
  `src/lib/audit.ts` and `src/lib/listingSoftDelete.ts`;
- shared lock/refund/label helpers: `src/lib/caseLifecycleLocks.ts`,
  `src/lib/refundLocks.ts`, `src/lib/localRefundEvidence.ts`,
  `src/lib/refundLedgerSql.ts` and `src/lib/labelClawbackRetry.ts`;
- public and staff-safe aggregates: `src/lib/homepageStats.ts`,
  `src/lib/metrics.ts`, `src/lib/publicSellerStats.ts`,
  `src/lib/quality-score.ts` and `src/lib/site-metrics-snapshot.ts`; and
- the development-only synthetic creator:
  `src/app/api/dev/make-order/route.ts`, which must be removed from production
  reachability or converted to a separately gated test-only operation before
  runtime INSERT is revoked.

Fixed Case functions already read bounded Order facts. They must remain in the
function-catalog/global-grant audit, but they do not justify restoring runtime
base-table SELECT after this group activates.

## Rollout sequence

The aggregate-only inspector scaffold is now saved as
`scripts/order-payment-shipping-legacy-inspect.mjs` with a fail-closed unit
contract. The exact aggregate SQL is wired into normal CI against the
disposable loopback PostgreSQL 16 service after the compatible migration tree,
where PostgreSQL itself attests that the proof transaction is read-only. No
The protected aggregate-only workflow is prepared on this isolated branch. It
requires an exact main commit, exact confirmation, the Production environment,
the protected owner-URL digest, the reviewed Case FORCE prerequisite, a clean
checkout and the shared production-migration concurrency group. It cannot be
dispatched unless the workflow is first reviewed and merged to main. No
production inspection has been run, and a separate exact-main dispatch review
is still required.

Checkpoint `7065e961ec7afc20c3a58c76fcca814b940620b8` was proved by GitHub
CI run `30955791275` on 2026-08-04. The PostgreSQL 16 step executed the exact
40-field aggregate query successfully in the disposable `grainline_ci`
database; the full CI run also passed. This is syntax/shape/read-only evidence
only and did not inspect or change production.

1. Finish the semantic direct/nested access inventory and actor projections.
2. Build and test an aggregate-only legacy inspector; inspect production under
   the protected read-only gate and decide cleanup separately from its result.
3. Add compatible durable seller/snapshot/invariant schema and fixed functions
   without changing existing grants or RLS posture.
4. Deploy the compatible application conversion and prove old/new coexistence
   for checkout, webhook, refund, fulfillment, label, export, deletion and jobs.
5. Activate the provider/service ledgers through their reviewed fixed
   operations, then activate `Order` plus `OrderItem`; keep rollback byte-pinned.
6. Run real pooled-runtime buyer/seller/staff/service denial and projection
   proofs, then apply posture-only FORCE and repeat the proofs.
7. Finish this complete group and durable record before beginning Cart/CartItem
   or another sensitive-data activation.

Keep Extra High for schema, authority, concurrency, migration and production
review. High is sufficient only for mechanical inventory and documentation
once the security decisions above are pinned.
