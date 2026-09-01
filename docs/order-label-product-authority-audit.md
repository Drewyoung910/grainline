# Order shipping-label product and authority audit

Status: **implementation required before Order RLS activation**  
Audit date: 2026-09-01  
Scope: seller label purchase/re-quote, Shippo transaction recovery, Stripe
label-cost deduction, seller download, buyer notification and retry worker  
Production state: **unchanged**

## Decision

The current label flow has several good safeguards, but it is not ready to be
sealed behind Order RLS unchanged. The replacement must preserve the existing
seller product while separating provider claims from completed labels and
moving every Order mutation behind a fixed, generation-fenced operation.

The required operation family is:

1. seller label preflight;
2. seller quote replacement;
3. seller label claim;
4. exact provider outcome recording;
5. label-cost finalization;
6. label-cost retry claim/finalize; and
7. seller-authorized label download.

No generic `order_update`, caller-selected write target or broad runtime table
grant is acceptable.

## What is already sound

- The route authenticates a live, non-banned seller and uses the durable
  `Order.sellerProfileId` key rather than current Listing ownership.
- Cross-origin POSTs and oversized or malformed bodies are rejected, and label
  purchase has a fail-closed rate limit.
- Pickup, terminal fulfillment, refund, open-dispute, active-Case and seller-
  deauthorization states block purchase.
- A seller-selected rate must be either the retained checkout rate or a member
  of a current bounded quote set; fallback, pickup and quote-only identifiers
  are not purchasable.
- Provider amount and currency have integer/range guards, and the Stripe
  reversal uses a deterministic idempotency key.
- Failed label-cost reversals enter a durable retry/manual-review state instead
  of making a successful carrier purchase disappear.

Those behaviors should be retained. They are not sufficient for RLS
activation because application code still reads and mutates the whole Order.

## Findings that change the implementation

### OL-A01: `PURCHASED` currently also means “provider outcome unknown”

Before the Shippo call, the route writes `labelStatus = PURCHASED` as a mutual-
exclusion lock. A network error then intentionally leaves that value in place
for manual review. The seller UI interprets the same value as a completed
label and can render “Label purchased” even when no transaction, URL or
tracking number was recorded.

Add a separate, monotonic label claim generation and explicit provider state.
`LabelStatus.PURCHASED` must be written only after a structurally valid Shippo
`SUCCESS` result is bound to the exact claim. An ambiguous response keeps the
claim fenced without claiming that a label exists.

### OL-A02: the successful provider response is under-validated

The current code accepts `status = SUCCESS` even if `object_id`, `label_url`,
the selected rate identity or the returned amount/currency is absent or has
drifted. It can therefore mark an Order shipped and reverse a much larger
seller amount than the persisted selected rate authorized.

The claim operation must derive and return the exact rate ID, expected cents
and currency from retained database state. Provider recording must require:

- the exact claim ID and generation;
- a non-empty bounded Shippo transaction ID;
- a bounded HTTPS label URL;
- the same rate ID;
- the exact expected integer amount and currency; and
- a provider-mode result consistent with the configured Shippo credential.

Any mismatch is a provider-reconciliation state, never an automatic Stripe
deduction. Shippo's current transaction contract documents `object_id`,
`label_url`, `rate`, `status`, `test` and conditional tracking output. The API
does not document an idempotency-key parameter for transaction creation, so
the database must not pretend one exists. Grainline should attach the database-
derived claim ID in Shippo's bounded `metadata` field and use it as the manual
or automated recovery marker.

### OL-A03: quote and purchase decisions race refunds and Cases

The re-quote provider call occurs after an application preflight, then writes a
new shipment ID and quote without relocking the Order. The later purchase lock
does recheck most state, but the quote write itself can land after a refund or
Case transition. The interactive route also releases old refund locks as a
side effect, which is unrelated maintenance authority.

The quote replacement function must lock and revalidate the exact seller,
Order and claim generation immediately before writing. The label route must
not release refund locks; dedicated refund recovery remains the only authority
for that state.

### OL-A04: package facts are mutable and the packing rule is approximate

Re-quotes use current Listing package dimensions and current seller defaults,
not checkout-time facts. A Listing edit or later Listing RLS can change or
strand fulfillment for a retained Order. Multi-item Orders sum weight and take
the maximum dimensions; this assumes one seller-packed parcel and is only an
approximation, not a true packing algorithm.

New OrderItems must retain the checkout-time package weight/dimensions already
present in the reservation source. The fixed preflight must use those retained
facts. Historical nulls require aggregate-only classification and an explicit
legacy fallback; they must not be silently described as immutable.

This rollout preserves the current one-parcel packing product. A multi-parcel
packing UI/algorithm is a separate product enhancement, not a reason to grant
Order or Listing table access.

### OL-A05: label purchase skips the fulfillment side effects

Buying a label changes the Order to `SHIPPED`, but the label route does not
create the buyer's `ORDER_SHIPPED` Notification or reserve the shipment email.
Manual fulfillment does both. This makes the buyer experience depend on how
the seller marked the same business transition.

The label provider-record/finalize transaction must co-commit the derived
fulfillment audit, source-bound Notification and deterministic email-outbox
reservation. Immediate email delivery remains post-commit and retryable.

### OL-A06: stored label URLs are sensitive and can expire

The seller detail projection returns the raw provider label URL and the UI
links to it directly. Shippo examples use signed URLs with an expiration, and
the label itself contains buyer shipping data. A retained historical URL is
therefore both a brittle download mechanism and unnecessary participant
exposure.

Seller detail should return only label availability and display metadata. A
seller-authorized download route must resolve the stored transaction through
Shippo and redirect to the fresh HTTPS label URL. The transaction ID remains a
service/staff fact, not a browser projection.

### OL-A07: label purchase intentionally means `SHIPPED`

Grainline currently treats buying the carrier label as the shipment transition.
That is a product choice, not a fact proved by a carrier acceptance scan. There
is no Shippo tracking-webhook state machine in the current product, so changing
this meaning during an RLS conversion would leave label-created Orders in
`PENDING` with no reliable automatic next transition.

Preserve the current meaning for this rollout and state it explicitly in the
UI/audit. Carrier-acceptance tracking can later split `LABEL_PURCHASED` from
`SHIPPED`; that enhancement must also revisit processing-deadline analytics.

### OL-A08: label voiding remains a staff reconciliation boundary

Seller self-service refunds correctly refuse a purchased label. Staff can
record a label as voided only after reconciling it with the carrier outside
Grainline. Automating carrier refunds is useful but includes carrier-specific,
asynchronous outcomes and is not required to make current refund authority
honest. Keep it staff-only until a separate provider-backed void state machine
is designed.

### OL-A09: only a terminal provider error may release a pending claim

Shippo can represent a transaction as `WAITING` or `QUEUED` as well as
`SUCCESS` or `ERROR`. Treating every non-success response as rejection would
release the database fence while the carrier transaction could still become a
label. The compatible route now classifies only exact `ERROR` as releasable;
unknown, absent, waiting and queued statuses become `PROVIDER_AMBIGUOUS` and
must use the exact-claim reconciler. Exact success remains recordable from
either pending or ambiguous state even if the seller becomes inactive after
the provider call, because the carrier effect has already occurred.

### OL-A10: checkout package facts must come back from the paid session

The first compatible implementation wrote package fields from the live
Listing read performed during webhook delivery. That is not a checkout-time
snapshot: a seller edit between Checkout Session creation and the signed
webhook could change it. Cart and Buy Now line-item products now carry a
bounded package witness in Stripe metadata, and the webhook accepts only a
complete bounded witness. Predecessor sessions or incomplete packages are
explicitly stored as incomplete and remain measurable `LEGACY_LIVE`
candidates; the webhook never reconstructs missing checkout facts from a
later Listing.

The rest of `listingSnapshot` is still assembled at webhook time. Exact
checkout-time title/description/category/tag preservation remains the existing
`ORD-A03` historical-snapshot product boundary; it is documented rather than
misrepresented as solved by this label change.

### OL-A11: replacement and legacy fallback must cover the whole Order

The first quote replacement candidate deleted only expired quotes, allowing
multiple unexpired rate sets for one Order. It also used an inner Listing join
for legacy package aggregation, which could omit a deleted Listing and
silently calculate a partial package. Replacement now removes every prior
quote for the locked Order before inserting one bounded current set. Legacy
aggregation counts every OrderItem, uses seller package defaults when a
Listing is missing, and rejects the whole package if any item or address is
invalid. The aggregate inspection applies the same item, package and trimmed-
address predicates before activation.

### OL-A12: audit evidence must fail closed on identity collision

Provider success and ambiguous release use deterministic audit IDs derived
from the database claim. `ON CONFLICT DO NOTHING` could have allowed the Order
state mutation to commit while an unrelated pre-existing audit row occupied
that ID. The candidate now lets an audit-ID collision abort and roll back the
entire state transition. Disposable PostgreSQL proves both provider-record and
staff-release collisions preserve the prior claim state.

### OL-A13: provider absence is not a terminal fact

The first reconciliation candidate allowed an owner operator to clear an
ambiguous claim when a rate-filtered Shippo scan found no matching transaction
after one hour. That was unsafe. PostgreSQL cannot lock Shippo, Shippo does not
document an immutable absence watermark or application idempotency key for
label creation, and a same-mode credential can still belong to the wrong
Shippo account. A transaction that becomes visible after release would lose
its durable claim/generation fence and a later seller retry could buy a second
label.

No-transaction evidence is therefore diagnostic only. It leaves the exact
claim `PROVIDER_AMBIGUOUS`, writes no production row, and requires provider
escalation. Only an exact terminal `ERROR` may release. A requested transaction
ID is only an assertion about the unique match: the operator still exhaustively
pages the rate scope and rejects multiple exact-claim transactions before
recording `SUCCESS` or releasing `ERROR`. Release audit attribution records the
actual database session principal and separately records the authorizing staff
row instead of presenting the caller-supplied staff ID as session identity.

## Target state machine

```text
none
  -> PROVIDER_PENDING (DB-derived claim/generation/rate/amount/currency)
       -> released-no-effect (explicit Shippo ERROR; seller may retry)
       -> PROVIDER_AMBIGUOUS (timeout/invalid response; no automatic retry)
       -> PROVIDER_RECORDED + LabelStatus.PURCHASED + Order.SHIPPED
            -> FINALIZED (zero cost or Stripe reversal recorded)
            -> CLAWBACK_RETRY_PENDING
            -> MANUAL_REVIEW
```

Every state change compares the exact claim ID and generation under the Order
lock. Stale workers cannot release, overwrite or finalize a newer claim.

## Proof requirements

- Cross-seller, banned/deleted seller and forged-actor denial.
- Paid shipping Order only; pickup, refund, dispute, Case, deauthorization and
  terminal-state denial.
- One claim under concurrent purchase; deterministic-error release; ambiguous
  outcome remains fenced.
- Quote replacement rejects stale generation, unknown rate, malformed JSON,
  excessive rate count/expiry, currency mismatch and Order state drift.
- Provider record rejects transaction/rate/amount/currency/mode drift and
  missing required artifacts.
- Label success co-commits `SHIPPED`, audit, Notification and email-outbox
  reservation exactly once.
- Clawback claim uses stable ordering plus `FOR UPDATE SKIP LOCKED`; finalizer
  rejects stale generation and derives retry schedule in PostgreSQL.
- Direct Order reads/writes disappear from the label route and retry worker.
- Runtime receives EXECUTE only on reviewed functions; PUBLIC receives none;
  the migration does not change Order RLS posture or base-table grants.

## Release boundary

This audit authorizes isolated implementation and disposable PostgreSQL proof.
It does not authorize a production inspection, migration, application deploy,
RLS activation, table-grant change, provider mutation or label purchase.

## 2026-09-01 isolated implementation status

The compatible candidate now exists locally at
`20260901140000_prepare_order_label_authority` and is not applied anywhere.
Seven fixed operations cover seller preflight, quote replacement, purchase
claim, provider record, clawback claim/finalize and seller download. An eighth
fixed projection, `grainline_order_seller_detail_v4`, preserves the reviewed v3
seller detail contract while omitting `label_url`. The application consumes v4
and the authenticated download endpoint; it never receives the retained raw
URL. The predecessor v3 grant remains intentionally compatible until a later
deployment drain/activation step revokes it.

The route and retry worker have been converted to fixed operations; new
checkout-created OrderItems retain bounded package facts and an explicit
completeness marker; successful provider record co-commits the standard shipped
Notification and email-outbox reservation. Provider success now fails closed
when rate currency or carrier evidence is absent rather than substituting a
default value. The implementation audit also caught that the first candidate
documented provider-mode binding without enforcing it. Create responses and
fresh label downloads now require Shippo's `test` flag to match the configured
`shippo_test_` or `shippo_live_` credential prefix; an absent or mismatched flag
fences the claim as ambiguous rather than releasing or completing it.

The cross-system audit caught and corrected a Notification source-contract
defect before deployment: the first candidate wrote an
`ORDER_LABEL_PURCHASED` audit that the production-live Notification owner
function would reject. The fixed candidate writes the already-reviewed
`ORDER_FULFILLMENT_TRANSITION` action plus exact `shipped`, `SHIPPED` and
carrier metadata. A deeper replay audit found that the generic Notification
order-family validator still derives seller identity through mutable Listing
ownership; using it could therefore roll back a valid label purchase after
Listing ownership drifted away from the immutable checkout seller. The fixed
label provider-record operation now derives the buyer and seller from the
Order, honors the buyer's `ORDER_SHIPPED` preference, and co-commits a
deterministically deduplicated Notification itself. A real PostgreSQL exact
success replay produces one fulfillment audit and one Notification. The
current Notification completeness inventory remains 56/56 and explicitly
counts this one database-owned path rather than silently omitting it.

Disposable PostgreSQL currently proves the main claim, denial, identity/money,
ambiguity and worker-generation boundaries. The release remains blocked on:

- an aggregate-only production inspection proving `shippoTransactionId` has no
  duplicates before the candidate's partial unique index is applied;
- explicit counts for legacy Orders that will require `LEGACY_LIVE` package
  fallback;
- revoking predecessor seller-detail v2/v3 runtime execution after the
  compatible application deploy/drain so raw `labelUrl` no longer crosses any
  ordinary-runtime database authority boundary.

The bounded ambiguous-claim operator path is now implemented, but remains
unexecuted. Two owner-only functions expose and release only one exact claim to
a current EMPLOYEE/ADMIN; ordinary runtime and PUBLIC have no EXECUTE. A
release requires an exact Shippo `ERROR` transaction carrying the
database-derived metadata. An exhaustive rate-filtered scan with no matching
metadata is non-mutating evidence and leaves the claim fenced for provider
escalation. A successful
transaction is not released: it is validated for exact provider mode, rate,
amount, currency, HTTPS label and carrier, then recorded through the same app
wrapper that owns the deterministic email-outbox reservation and Stripe
clawback. A reversal failure is durably returned to the existing retry state.
The operator refuses incomplete, duplicate, count-drifted, cross-origin or
cross-rate provider pagination. An optional transaction ID cannot bypass the
exhaustive uniqueness scan. Evidence retains only hashed identities in a fresh
mode-0600 file.

The authority review also closed a privilege flaw in the first candidate:
ordinary runtime could previously submit `REJECTED` against an already
ambiguous claim and clear the fence without provider proof. Runtime rejection
now releases only `PROVIDER_PENDING`; all ambiguous release is owner-only,
staff-authorized and audit-backed, with the database session principal recorded
separately from the authorizing staff row. Exact successful evidence remains recordable
after the originating seller becomes inactive because the provider effect
already occurred, but cannot create or release a claim.

These are release gates, not deferred cleanup. Production remains unchanged.

### Buyer shipping-quote correctness gate

The label lifecycle audit also rechecked the earlier buyer quote rather than
assuming that successful seller re-quotes proved the checkout UI. It found
that free pickup was silently auto-selected as the cheapest rate, malformed
provider identities could be displayed and then rejected only at checkout,
delivery-day estimates were not normalized at the provider boundary, a
provider failure dropped pickup, and the UI offered no retry action.

The isolated correction now drops malformed/duplicate provider rates before
signing, shares one bounded delivery-estimate contract across quote, checkout
and webhook parsing, requires the actual normalized city/state/postal/country,
defaults to shipping when shipping exists, retains pickup as an explicit
choice and exposes a retry button. Full street/name data remains absent from
the buyer quote and is used only by the seller's authenticated label re-quote.
See `docs/verified-cross-domain-pre-rls-findings-20260901.md`.

### CI release-chain correction

Draft PR #382 first failed CI run `33540533675` before any PostgreSQL mutation:
the historical `order-payment-event-force-reviewed` verifier correctly refused
three later migration directories that had not yet been isolated. The branch
now verifies and removes label, fulfillment and receipt-Notification candidates
in descending migration order before the historical FORCE gate, restores them
in ascending order afterward, re-verifies their byte-pinned releases, applies
them only to the disposable CI database, converges grants and runs their focused
PostgreSQL proofs. A static regression test pins that ordering. This changes no
production migration workflow or production state.

The next replacement CI run reached the expanded aggregate inspection and
failed before mutation because that proof was still scheduled against the old
DirectUpload-era schema, which predates the Order payment-hold columns the
current inspection deliberately classifies. The proof now runs only after the
restored `OrderPaymentEvent` FORCE posture is re-audited and before any later
Order participant/label candidate is restored. A regression assertion pins
that exact live-prefix position instead of weakening the SQL for a historical
schema it is not intended to inspect.

The third CI run passed both new boundaries and then exposed a pre-existing
test-placement mismatch: the historical `OrderPaymentEvent` aggregate database
gate also invoked an application-source test that reads later eligibility and
seller-metrics migration files after those directories had intentionally been
isolated. The database gate remains at its historical prefix; only that
application-source assertion now runs after all compatible Order candidates
are restored. CI pins that it appears once and only after restoration.

The fourth CI run `33542191639` reached the historical `OrderPaymentEvent`
transition-authority PostgreSQL gate and exposed the same source-placement
class for its application assertion: that assertion now reads the later
fulfillment and label migration sources, which are intentionally absent at the
historical prefix. The transition database proof remains at that prefix. Only
the static application assertion moves after compatible-candidate restoration,
and the release test now pins both source-reading assertions to that later
position exactly once.

The fifth CI run `33542988628` passed the complete historical chain and every
new release verifier, then failed at the final global grant audit. The audit's
function inventory had not classified seven already-reviewed private
functions: the retired v1 buyer/seller detail projections, the dormant
staff-only page/detail pair, the owner-private summary helper and the two
owner-only ambiguous-label reconciliation operations. Their runtime grants
were correctly absent; granting them would have been the unsafe correction.
The catalogs now declare those names as ordinary-runtime-private and the grant
inventory test pins the classification.

The following local full suite then exposed one stale test-only ordering
assertion. It still expected the expanded legacy inspection immediately after
the first generic migration deploy, even though the reviewed execution point
is now the restored `OrderPaymentEvent` FORCE production prefix. The test now
anchors the actual invariant: FORCE re-audit precedes inspection, and inspection
precedes restoration of the compatible Order candidates.

Exact-head CI run `33544838838` then passed the complete historical database
chain, the compatible Order-label PostgreSQL proof, TypeScript, lint and the
full application test suite before the fail-closed dependency audit detected
new high-severity advisories in transitive `browserslist <=4.28.6` and
`mysql2 <3.22.0`. Grainline does not use Prisma's bundled MySQL client, but the
vulnerable package still existed in the installed tree. Exact overrides now
converge all Browserslist consumers on `4.28.8` and Prisma's transitive MySQL
client on `3.24.2`; dependency-hygiene tests pin both resolutions. No broad
audit autofix or Prisma major-version change was used.
