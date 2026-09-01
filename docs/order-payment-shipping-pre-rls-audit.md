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

A machine-checked scanner pins direct Prisma, raw-SQL and converted fixed
refund-authority callsites under `src`.
The exact baseline is:

| Model | Direct-access source files |
|---|---:|
| `Order` | 40 |
| `OrderItem` | 12 |
| `OrderShippingRateQuote` | 2 |
| `OrderPaymentEvent` | 2 |
| `SellerPayoutEvent` | 3 |
| `CheckoutStockReservation` | 4 |

These counts exclude disposable/proof scripts and nested relation selections
that do not name the Prisma delegate or raw table directly. They are a
conversion floor, not a claim that only 66 semantic operations exist. The
compatible application conversion now routes every ordinary-runtime consumer
through fixed source-bound authorities or database-maintained `Order`
projections. The two remaining matches are the intentionally retained fixed
refund-authority helpers in `orderRefundFinalization.ts` and
`orderRefundRecordAuthority.ts`; neither grants generic table lookup or write
authority. The separate 34-file semantic inventory remains authoritative for
nested projections, event-identity helpers, fixed Case/Notification functions,
cron and provider side effects, so this smaller direct-access floor cannot hide
semantic consumers.

The isolated SellerPayoutEvent and completed CheckoutStockReservation
conversions now have zero direct delegates under `src`; the table above
intentionally retains their three-file and four-file production/predecessor
baselines. Their semantic inventories remain pinned separately so indirection
cannot disappear from review merely because base-table CRUD has been removed.

Current operation families include:

- buyer order lists, detail, checkout success, export and deletion;
- seller sales lists/detail, fulfillment, label purchase, refund, payout and
  analytics;
- employee/admin order queues, holds, verification and audit actions;
- signed Stripe checkout, refund, dispute, payout and deauthorization events;
- source-bound seller and blocked-checkout refund recording through
  `src/lib/orderRefundRecordAuthority.ts`;
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

The detailed coexistence, trigger, composite-key, backfill and convergence
contract is saved in `docs/order-payment-shipping-compatible-schema-plan.md`.
It remains design-only until the aggregate production result is reviewed.

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

### OPS-A15: the Stripe webhook lease has an ABA finalizer race

`beginStripeWebhookEvent()` can reclaim an old `processingStartedAt`, but its
result contains only `"process"`. `markStripeWebhookEventProcessed(id)` and
`markStripeWebhookEventFailed(id, error)` identify the lease only by event ID.
If worker A stalls, worker B reclaims the same event, and A later resumes, A can
complete or clear B's newer lease. The current row has no claim generation or
nonce with which a finalizer can reject that stale worker.

Compatible preparation must add a database-derived monotonic claim generation.
The fixed begin operation returns it; complete/fail require the exact current
generation and event type, and return a superseded result rather than mutating
a newer lease. The database derives reclaim time from its own clock. Initial
event type is immutable: a duplicate event ID with another type is an error,
not a reason to rewrite the source identity. This is independent of Stripe
signature verification, which remains in the application.

### OPS-A16: launch proof must survive policyless webhook-ledger RLS

The staging/local buyer-deletion replay proof directly selected the
`StripeWebhookEvent` row to check processed state and `lastError`. That proof
would fail after base-table SELECT is revoked, but a new runtime-readable row
or error projection would expand production authority solely for a test
harness.

The activation audit in `docs/stripe-webhook-event-activation-audit.md`
chooses the narrower path. The proof resolves and validates the exact event
through Stripe, then calls the existing fixed `begin(event_id,event_type)` in
an always-rollback transaction. Only `processed` passes; missing, stale,
in-progress or type-mismatched evidence fails without durable mutation. The
proof no longer claims a direct `lastError IS NULL` read. This closes the
activation compatibility gap without adding a seventh runtime function.

### OPS-A17: reservation restore authority must be source-partitioned

The current `restoreCheckoutStockReservationOnce()` accepts a reservation ID,
optional Stripe session and free-form reason. That is too broad once ordinary
table authority is revoked: it can make another buyer's reserved inventory
available again. Checkout abort, signed expiry delivery, stale cron repair and
account deletion need distinct fixed entry points. External-provider repair
uses a database-selected, generation-fenced claim/finalize protocol; terminal
pruning selects its own retained rows and never accepts row IDs or a cutoff.
The complete table-specific contract is
`docs/checkout-stock-reservation-rls-audit.md`.

### OPS-A18: unexpected checkout failures can reopen payable stock

Both checkout routes currently restore by reservation ID in the outer catch.
If an unexpected failure happens after a Stripe session is created or bound,
the database can return stock while that external session remains payable. The
compatible app must retain the created session ID, confirm expiry before any
bound-session restore and otherwise leave the row for fenced stale repair. The
database checkout-abort operation is deliberately limited to unbound rows.

### OPS-A19: reservation replay fingerprints have three conflicting contracts

At audit start the deployed application generated a 32-character base64url
SHA-256 prefix, the Prisma column permitted 64 characters and the aggregate
inspector tested for 64 lowercase hexadecimal characters. Do not change the
Redis fingerprint algorithm inside the RLS release. The isolated audit
checkpoint aligns inspection and regression proofs to the deployed
32-character base64url form plus the documented account-deletion sentinel;
treat any full-length-hash migration as a separate old/new deployment
coexistence change.

### OPS-A20: reservation account-scrub shape is a distinct terminal contract

Account deletion intentionally rewrites the replay fingerprint/lock key, clears
buyer and seller columns and strips item seller IDs while retaining only
listing/quantity evidence. The baseline inspector incorrectly required seller
IDs on those deleted terminal items. Inspection and preparation must recognize
the exact scrubbed shape without relaxing normal reservation item validation.

### OPS-A21: an unpaid completion event is not restoration evidence

The predecessor completion branch restored stock whenever the retrieved
Checkout Session was not yet paid. The compatible checkpoint retains that
reservation; only signed failure/expiry or generation-fenced provider repair
may restore it, while a later signed success may complete it.

### OPS-A22: indirect buyer and seller expiry paths were missing from inventory

The direct-delegate baseline did not reveal the authenticated buyer rollback
route or the seller/admin/ban/vacation session-expiry helper. They are distinct
authority families: the database validates the exact buyer or seller-to-
reservation relationship and session lock, while the application remains
responsible for proving external Stripe expiry. They now have separate fixed
operations and are included in the semantic completeness gate.

### OPS-A23: webhook claim generation did not bind the provider object

`StripeWebhookEvent` generation fencing prevented stale finalizers but did not
store the signed event object's ID. A valid active expiry event could therefore
be paired with another Checkout Session by the first reservation draft.
Compatible preparation must add an immutable bounded source-object binding;
checkout completion and restoration compare that stored value to the exact
session before touching reservation or stock state.

The reviewed implementation uses one three-argument webhook-begin statement to
acquire/reclaim and bind that source atomically. The lower-level binder remains
runtime-private. A two-statement begin-then-bind sequence is not acceptable
because a transient second-statement failure would strand an unbound active
lease until reclamation.

### OPS-A24: reservation cleanup is one-batch-per-deletion-attempt

Account cleanup claims at most 50 active reservations. The database scrub is
fail-closed while any active row remains, so accounts above that bound require
a retry rather than partial active-state anonymization. This safe bounded
behavior must be tested and documented; an explicit multi-batch operator is a
later evidence-led decision, not an assumed property.

### OPS-A25: a missing Stripe response is not proof no Session exists

The compatible checkout catch path closed failures after a returned Session,
but it still inferred that a missing local Session ID meant no external Session
had been created. Network response loss makes that implication false. The
application boundary must mark the provider create attempt before calling
Stripe, use one idempotency key per lock acquisition, and retain stock whenever
the provider outcome is unknown. A later signed completion may late-bind the
unbound reservation through the existing fixed operation before completing it;
stale repair remains the conservative fallback after Session expiry. The exact
coexistence and made-to-order compatibility contract is in
`docs/checkout-stock-reservation-app-deployment-audit.md`.

## Semantic write conversion map

This is the first exact write-authority map. Read projections and aggregate
jobs remain the next inventory layer; none of these rows authorizes a function
or migration yet.

| Operation family | Current source | Required fixed destination |
|---|---|---|
| Stripe delivery reservation | `src/lib/stripeWebhookEvents.ts` | begin/reclaim, complete and fail transitions; no direct table read/delete |
| Seller-scoped checkout Order + items | `src/app/api/stripe/webhook/route.ts` | one transaction deriving durable seller, buyer, listing, totals, snapshot, provider replay source and reservation completion |
| Stripe refund/dispute evidence | `src/app/api/stripe/webhook/route.ts`, `src/lib/localRefundEvidence.ts`, `src/lib/refundLedgerSql.ts` | append-only payment evidence plus separately locked Order/Case application |
| Seller refund | `src/app/api/orders/[id]/refund/route.ts`, `src/lib/orderRefundFinalization.ts`, `src/lib/orderRefundProviderReconciliation.ts`, `src/lib/refundLocks.ts` | seller-authorized refund claim and exact provider finalizers; bounded provider-outcome recovery; source-bound participant notification plus email-outbox reservation commit with the refund record; stale-claim release is an operator/cron transition |
| Fulfillment and buyer delivery | `src/app/api/orders/[id]/fulfillment/route.ts`, `src/app/api/orders/[id]/confirm-delivery/route.ts` | seller/buyer-specific monotonic transitions under the Order lock |
| Shippo quote and label purchase | `src/app/api/orders/[id]/label/route.ts` | seller-authorized quote replacement and label claim/finalize operations with bounded provider snapshots |
| Label clawback retry | `src/lib/labelClawbackRetry.ts` | bounded batch claim plus generation-checked success/failure finalizers |
| Checkout stock lifecycle | `src/lib/checkoutStockRestore.ts`, `src/app/api/cart/checkout/resume/route.ts` | reserve, bind session, complete, restore, repair and terminal-prune transitions with one lock order |
| Account deletion and PII expiry | `src/lib/accountDeletion.ts` | bounded account-owned reservation cleanup, Order PII purge, quote deletion and seller-history anonymization |
| Admin reconciliation | `src/app/admin/actions.ts`, `src/app/admin/orders/[id]/refundReconciliationActions.ts` | staff-authorized review, evidence-bound ambiguous-refund classification, void/reconcile and append-note transitions with durable audit evidence |
| Payout failure state | `src/app/api/stripe/webhook/route.ts`, `src/app/api/stripe/webhook/connect/route.ts`, `src/lib/stripePayoutWebhook.ts` | separately signed platform/Connect compatibility routes share one webhook-bound monotonic payout-state upsert; seller receives only a bounded projection |
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
  `src/app/api/stripe/webhook/route.ts`,
  `src/app/api/stripe/webhook/connect/route.ts` and
  `src/lib/stripePayoutWebhook.ts`;
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
  `src/lib/refundLedgerSql.ts`, `src/lib/orderRefundFinalization.ts` and
  `src/lib/labelClawbackRetry.ts`;
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

The first fixed-operation and projection catalog is saved in
`docs/order-payment-shipping-fixed-operation-catalog.md`. It pins the service
lease generations, participant/staff projection boundaries, provider
claim/finalize families and release dependency order; it remains design-only.

The prerequisite inventory identified three ordinary-runtime accesses that
must be converted before `StripeWebhookEvent` table privileges can be revoked:
processed-row retention, aggregate ops health, and the synthetic
`checkout-stock-restore:<session>` dedup claim. The isolated
`20260805040000_prepare_stripe_webhook_maintenance_authority` candidate routes
those three paths through catalog operations 34 through 36 and retains exact
rollback-only PostgreSQL proof. It is reviewed at PR #162 exact head
`78fb92546362d3744db924b312c27a7e915b279c` with green exact-head CI
`31279844745`, but remains unmerged, undeployed and unapplied, so the production
finding remains open and predecessor table grants remain unchanged.
Owner-only predecessor inspection and disposable PostgreSQL proofs remain
outside ordinary runtime and do not justify a runtime table grant. The
staging/local buyer-deletion replay proof now uses the same fixed lease surface
inside an always-rollback transaction rather than direct table SELECT. Its
dedicated database URL is bound to an explicit non-production target and the
engine must attest the exact restricted runtime role; disposable PostgreSQL
also proves the real Prisma transaction rolls back missing inserts and stale
reclaims with zero residue.

## Rollout sequence

The aggregate-only inspector scaffold was saved as
`scripts/order-payment-shipping-legacy-inspect.mjs` with a fail-closed unit
contract. The exact aggregate SQL is wired into normal CI against the
disposable loopback PostgreSQL 16 service after the compatible migration tree,
where PostgreSQL itself attests that the proof transaction is read-only. No
production data is read by that CI proof. The protected aggregate-only workflow
was prepared on its isolated branch. It
requires an exact main commit, exact confirmation, the Production environment,
the protected owner-URL digest, the reviewed Case FORCE prerequisite, a clean
checkout and the shared production-migration concurrency group. It cannot be
dispatched unless the workflow is first reviewed and merged to main. The
completed protected results are retained below; this paragraph records the
original safety boundary, not current status.

Checkpoint `7065e961ec7afc20c3a58c76fcca814b940620b8` was proved by GitHub
CI run `30955791275` on 2026-08-04. The PostgreSQL 16 step executed the exact
40-field aggregate query successfully in the disposable `grainline_ci`
database; the full CI run also passed. This is syntax/shape/read-only evidence
only and did not inspect or change production.

That first engine pass exposed a completeness gap in review rather than a SQL
failure: the query did not yet count every label/clawback, live-quote,
refund-total, reservation-member or stale-webhook contradiction required by
OPS-A10. The expanded query adds those families plus payment currency and
mutable payout-state classification. Exact checkpoint
`29d055564b499b3edca78462cc31fa5ccacf93cc` was proved by GitHub CI run
`30956595275` on 2026-08-04: the exact 54-field query passed against disposable
PostgreSQL 16, and TypeScript, lint, the full test suite, security audit and
production build all passed. This closes SQL syntax/shape/read-only readiness;
it does not inspect production or establish that production legacy data is
clean.

The later hard-readiness review rechecked the manual-main SHA and confirmation
binding, protected owner endpoint/digest, clean checkout, 50-second statement
timeout, aggregate-only evidence shape, mode-0600 fresh-file write and exact
transaction sequence. Tests now pin exactly 54 fields and require posture plus
count reads to occur after engine-attested `READ ONLY` begins and before
rollback.

### First protected production inspection result

The first protected production inspection ran from exact merged main
`d52add7eb8047c7c1f040f5e6efd40d64ab5d861` in GitHub Actions run
`30962036218` on 2026-08-05. Every workflow step passed. PostgreSQL reported
`repeatable read` and `transaction_read_only=on`; the transaction rolled back,
and production was not mutated. Artifact `8913326042` retained one sanitized
54-count JSON file and no row data, user IDs, provider IDs, addresses,
credentials, snapshots or object IDs. The uploaded zip SHA-256 was
`4d3d2c7f8ec0ec04b7502f6a3916df581286e27433ecbfdbaaf5402929db33a9`;
the extracted JSON SHA-256 was
`be708caa323c4c74e0f62e461eb9915d08af1acca736858ebe50fd485f09d3cc`.

The inspected predecessor posture matched review exactly: all seven tables
were owned by `neondb_owner`, had RLS and FORCE disabled, had zero policies,
and retained broad runtime CRUD. The base cardinalities were two Orders, three
OrderItems, zero quotes/payment events/payout events/reservations and 27 Stripe
webhook events. Every structural, currency, snapshot, subtotal, PII purge,
fulfillment-state, label, quote, payment, refund, payout, reservation, blank
webhook and stale-webhook count was zero except two timestamp buckets:
`fulfillment_timestamp_order_count=2` and
`webhook_state_coherence_count=5`.

Review found that those two predicates compared application-generated
timestamps with database-default `createdAt`. Checkout captures `paidAt` before
inserting the Order, so both valid Orders were necessarily eligible for the
first false positive. Webhook creation similarly captures lease/completion
timestamps before the database supplies `createdAt` on the reviewed synthetic
stock-restore path, so the five webhook rows are not accepted as corrupt data
from this aggregate alone. The corrected
contract compares only causal application timestamps: pickup ready to picked
up, shipped to delivered, and webhook processing start to completion. It keeps
missing processing start and retained error-after-completion as invalid. The
exact predicates now have class-wide unit coverage and read-only disposable
PostgreSQL fixture coverage. The same hard review also closed an adjacent
completeness gap: `PICKED_UP` now requires both `pickupReadyAt` and
`pickedUpAt`, matching the enforced `READY_FOR_PICKUP` to `PICKED_UP`
transition. A new exact-main protected inspection must be
reviewed separately before the legacy-data gate can be called clean; this
record authorizes no rerun, cleanup, migration, grant/RLS change or deployment.

### Corrected protected production inspection result

The separately reviewed corrected inspection ran from exact merged main
`8f22ebe326fa67bc3b71b8998b2f6b440ad7f69b` in GitHub Actions run
`30963859119` on 2026-08-05, after exact-main CI run `30963597414` passed.
PostgreSQL again attested `repeatable read` and
`transaction_read_only=on`; the transaction rolled back, and production was
not mutated. Artifact `8913958032` retained only the sanitized aggregate JSON.
GitHub recorded the uploaded artifact digest as
`36909b30062e5fbdab2a3700b1f477ee65be74cc0d6dc9a4c737ebbbfbfeff26`;
the independently downloaded mode-0600 JSON SHA-256 was
`b469b7d23054194ac48fd9f57ee7ec7789105401c58e3952a6c2990270b4104a`.

The predecessor posture and base cardinalities were unchanged: the seven
tables remained owned by `neondb_owner`, with RLS and FORCE disabled, zero
policies and broad runtime CRUD; production contained two Orders, three
OrderItems, 27 Stripe webhook rows and no quote, payment-event, payout-event or
reservation rows. Every structural and integrity inconsistency count was zero,
including `pickup_state_invalid_count`,
`fulfillment_timestamp_order_count` and
`webhook_state_coherence_count`. The retained artifact contains no raw rows,
IDs, addresses, credentials, provider identifiers, snapshots or other PII.

This closes the OPS-A10 legacy-data classification gate for the inspected
predecessor state. It authorizes compatible seller-key, webhook-generation and
invariant preparation only. It does not authorize cleanup, deployment, fixed
operation grants, RLS activation, FORCE, provider changes or another
sensitive-data group.

1. **Complete:** finish the semantic direct/nested access inventory and actor
   projections.
2. **Complete:** treat the completed corrected aggregate inspection as the pinned production
   predecessor record; rerun it if preparation is delayed or predecessor data
   can materially change before migration.
3. **Complete in production:** add compatible durable seller/snapshot/invariant
   schema and generation-bound Stripe functions without changing existing
   grants or RLS posture. Exact main
   `6f1f4c1e99fb21726744ecd1652a37b6be35c294`, CI `31276366947` and guarded
   migration run `31277540714` applied only
   `20260805012000_prepare_order_payment_shipping_compatibility`; the separate
   actual pooled-runtime read-only postflight passed.
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

### 2026-08-15 remaining-domain refresh

CheckoutStockReservation is complete through policyless FORCE RLS and its
actual pooled-runtime proof. A fresh direct-access inventory still finds five
unfinished tables: Order, OrderItem, OrderShippingRateQuote,
OrderPaymentEvent and SellerPayoutEvent. They remain separate releases.

The required domain-first gate selected SellerPayoutEvent because it has only
three direct consumers and no Order fulfillment, refund or Shippo state
transition. The dedicated audit is
`docs/seller-payout-event-pre-rls-audit.md`. Compatible preparation is accepted
in production from exact main
`6bc89c58d7d83509f73206a2f9b4854e3bed476b`, CI `31923317475`, inspection
`31923608819`, and guarded run `31923767337`; RLS remains off and predecessor
CRUD remains retained. Application conversion/deployment, linked-seller signed
proof, predecessor drain and separate ENABLE/FORCE releases remain required.

### 2026-08-24 OrderPaymentEvent inspection refresh

SellerPayoutEvent subsequently completed policyless ENABLE plus FORCE, zero
ordinary-runtime/PUBLIC table authority, its exact three-function catalog and
the distinct actual pooled-runtime postflight. The unfinished table set is now
`OrderPaymentEvent`, `OrderShippingRateQuote`, `Order` and `OrderItem`; keep
those four as separate releases.

The compatible OrderPaymentEvent refund/signed-authority stack and additive
66-count inspector merged through exact main
`d17b0384f2b90b128ba23852a0dedb004ce52739`; full main CI `32772585632`
passed. Protected production inspection run `32773408735` failed closed with
`POSTURE_MISMATCH` before the aggregate query or evidence write because its
posture fence still treated the completed SellerPayoutEvent ledger as an
RLS-off broad-CRUD predecessor. No count result exists for that run and no
production mutation occurred.

The reviewed successor posture requires `CheckoutStockReservation`,
`StripeWebhookEvent` and `SellerPayoutEvent` all to be owner-held policyless
FORCE tables with zero ordinary-runtime CRUD. `OrderPaymentEvent`,
`OrderShippingRateQuote`, `Order` and `OrderItem` must remain owner-held,
RLS-off, zero-policy broad-CRUD predecessors for this inspection only. Any
other combination fails before counts. A fresh exact-main CI pass and separate
protected read-only dispatch remain required; do not treat the failed run as
legacy-data evidence.

PR #262 corrected that fence and merged at exact main
`bc64516c6463118012c643806a3f398f2584092c`; exact-main CI `32782625503`
passed. Protected production inspection `32783261534` then passed inside an
engine-enforced repeatable-read read-only transaction. Sanitized evidence
SHA-256 `2a4e2819efa40acae014521aff141408cef66d468d0f4935c093415416dbbe30`
retains no raw row or private/provider identity. It reports 2 Orders, 3
OrderItems and 13 StripeWebhookEvents; zero payment events, payout events,
reservations and quotes; and zero for every refund, dispute, replay, amount,
currency, source-family, privacy, collision, reservation and quote defect.

The sole nonzero defect is `label_state_coherence_count = 1`. That finding is
scoped to the future Order release and does not block the separately empty
OrderPaymentEvent release. It is not cleanup permission. The additive
aggregate-only successor expands the 66-field accepted baseline to 76 fields
with ten overlapping label-state subtype counts and preserves the no-row,
no-identifier evidence boundary. The historical 66-field evidence remains
accepted and unchanged.

PR #263 exact head `ca02809a793b1455f27cdbe67ba25fca45484f65`
merged at exact main `3bd0a0f7a11074a323c0d6facdcc08d2aeadc0e1`;
full exact-main CI `32784976638` passed. Protected engine-read-only production
inspection `32785532138` accepted the exact 76-field query. Sanitized artifact
SHA-256 `a4c7d40ac292d1fa4c8e43ad95b47630ac40be9ef7b5553f56e0523894cd0bff`
retains no private/provider identity or raw row and made no mutation.

The broad count remains one. Exactly one PURCHASED row lacks both its Shippo
transaction reference and label URL; no other label-state or clawback subtype
is nonzero. Account deletion intentionally clears those two fields for a
deleted buyer or seller while preserving PURCHASED and fulfillment history, so
this shape is not automatically corrupt or repairable. The isolated 78-field
successor adds two overlapping counts that distinguish deletion-marked privacy
redaction from an unexplained missing reference. It does not enumerate the row
or authorize restoration of erased provider data.

PR #264 exact head `6cc8625a252b79b1b794d7b86b9009a36d4f1690`
merged at exact main `1d5bdf3ffa6b1ab41daf5a1c3e0f341253620dc4`.
Exact-main CI `32787483409` passed, and protected inspection `32788031745`
accepted the exact 78-field query inside an engine-enforced repeatable-read
read-only transaction. Sanitized artifact SHA-256
`c7c70e68097174182b1aea43420ca1e5ff91c52e670b822f20bcb10db7d2649c`
retains no identities or raw rows and made no production mutation. The broad
label count remains one, but the new classification is exactly one
privacy-redacted missing-reference state and zero unexplained states. No Order
cleanup or provider-reference restoration is needed. Keep the intentional
privacy transform legal in future Order invariants.
