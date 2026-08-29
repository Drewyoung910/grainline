# OrderPaymentEvent pre-RLS domain audit

Status: audit complete. The claim, record/finalize, signed-webhook,
evidence-bound reconciliation, inactive-seller recovery and durable Case
participant-delivery corrections merged through exact main
`d17b0384f2b90b128ba23852a0dedb004ce52739`. Their reviewed database authority
is production-applied, and the converted application is live from exact main
`2820986538c0d64f035defce052ba4ad0de1b3fb` as deployment
`dpl_73aR913b9hfgkcdfBv2MwMyypR5a`. `OrderPaymentEvent` RLS remains off and
predecessor runtime CRUD remains intact.

Audited: 2026-08-23 against the application source immediately after accepted
SellerPayoutEvent FORCE proof; release state refreshed 2026-08-24 after the
compatible stack merged and the blocked-checkout participant-delivery surface
was re-audited 2026-08-25. This audit does not broaden or reinterpret the
accepted SellerPayoutEvent production record.

## Executive verdict

`OrderPaymentEvent` is the correct next bounded Order/payment/shipping table.
It contains sensitive provider, refund, dispute, replay and reconciliation
evidence and currently grants the ordinary runtime broad table CRUD. It must
become a policyless service ledger under `ENABLE` then `FORCE` RLS, with zero
direct runtime/PUBLIC table or column privileges. Buyers and sellers need
bounded payment outcomes, not base rows.

The underlying refund and dispute handling is materially stronger than a naive
webhook ledger: Stripe signatures are verified before reservation; webhook
claims are generation-fenced; local refund calls have deterministic Stripe
idempotency keys; the staff Case refund path already has a private provider
claim; disputed-order side effects use signed provider event time; and the
Order/refund transitions share row locks. That is a sound foundation.

Activation is nevertheless not ready. The audit found seven load-bearing
issues:

1. buyer and seller account exports expose the full provider ledger, including
   Stripe identifiers, internal descriptions and raw reconciliation metadata;
2. seller and blocked-checkout provider refunds still use a time-expiring
   sentinel rather than an exact generation-fenced claim/finalizer;
3. several fallback and aggregate predicates use any historical dispute row
   rather than the latest state for each Stripe dispute;
4. the database does not enforce append-only rows, the two-event taxonomy,
   currency agreement or typed signed-event ordering; and
5. seller self-service partial refunds have no coherent residual-order model:
   the UI calls the operation cancellation, while every successful partial
   refund permanently blocks fulfillment/review/metrics and optional stock
   restoration does not rewrite purchased items or prove the retained balance;
   and
6. seller, blocked-checkout and staff Case refund notifications, plus seller
   and staff Case buyer email, were attempted only after the financial
   transaction committed. A process exit in that window could permanently
   omit participant delivery because a safe retry must not issue the provider
   refund again; and
7. the automatic blocked-checkout refund was classified as `NEW_ORDER` and
   had no refund-email outbox. A buyer could disable order-confirmation notices
   while retaining refund notices and consequently miss the active-account
   warning that the just-completed payment was immediately returned.

Fix these in a compatible application/schema sequence before activation. Do
not compensate with a permissive policy, a generic DEFINER append function or
participant base-table SELECT.

The first compatible application correction is recorded in
`docs/order-payment-event-refund-contract.md`: seller self-service partial
refunds are removed from the UI and rejected before side effects, while full
seller cancellation/refunds and staff Case partial refunds remain distinct.
The second is recorded in `docs/order-payment-event-dispute-state.md`: all
current-state consumers share the latest-per-dispute row selection while the
typed provider-time/equal-second reconciliation remains a schema prerequisite.
The third is recorded in `docs/order-payment-event-account-export.md`: buyer
and seller self-service exports retain distinct refund-only financial
projections and exclude the private Stripe service ledger. The later RLS
conversion still replaces these compatible nested reads with actor-bound,
keyset-paged database functions.

The fourth compatible correction is recorded in
`docs/order-payment-event-refund-claim-generation.md`. Seller and
blocked-checkout refunds now have an additive database-derived claim design
with exact source/generation/idempotency binding and no elapsed-time release.
The reviewed database authority, its distinct actual pooled-runtime compatible
postflight and the converted application deployment are accepted in
production. Live provider/replay proof remains required before RLS activation.

The fifth compatible correction is recorded in
`docs/order-payment-event-refund-record-authority.md`. Seller and
blocked-checkout successful full refunds now use source-bound fixed
record/finalize operations that atomically co-write Order, payment, stock,
Case and audit evidence, plus a restart-safe exact webhook-generation handoff.
The stacked crash-safety refinement moves source-validated in-app notification
creation and deterministic seller-refund email-outbox reservation into the
same application database transaction as that fixed finalizer. Its reviewed
database authority and converted application are production-live.
Ambiguous provider reconciliation,
signed refund/dispute writers, remaining invariants/projections, live proof and
activation remain open.

The next stacked application-only correction is recorded in
`docs/order-payment-event-case-refund-delivery.md`. It keeps the existing
generation-fenced staff Case functions, but commits finalization, both
source-validated participant Notifications and the deterministic
`case_resolved` EmailOutbox reservation in one transaction. Its reviewed
database authority and application conversion are production-live, while the
real provider/replay proof remains outstanding.

The isolated compatible production runner is specified in
`docs/order-payment-event-compatible-production-preparation.md`. It binds the
five sealed migrations to exact-main CI plus a fresh aggregate-only production
inspection, accepts only an exact applied prefix, compares the live function
bodies and catalog in an engine-read-only transaction, and preserves
`OrderPaymentEvent` RLS-off predecessor CRUD. Exact main
`8f4cf2df34a9f700adebc910107ac2dbb878054a`, CI `32792800761`, inspection
`32793276224`, and guarded run `32793394895` accepted the five-step production
preparation. This is not application deployment or RLS activation evidence.

## Product and evidence contract

### What the table is

`OrderPaymentEvent` is retained append-only financial evidence subordinate to
one `Order`. Current event taxonomy is exactly:

- `REFUND`: a signed `charge.refunded` observation or one locally initiated
  provider refund recorded by the seller, blocked-checkout or staff-Case flow;
- `DISPUTE`: a signed `charge.dispute.*` observation, ordered by the signed
  Stripe event clock for each dispute object.

`stripeEventId` is the replay identity. Signed rows use the Stripe event ID.
Local rows use a namespaced identity derived from the fixed source family and
the Stripe refund ID. A replay is successful only when the retained source,
Order, kind and canonical payload are identical. `ON CONFLICT DO NOTHING`
without an equality check is not sufficient.

The row is not the sole current state. `Order.sellerRefundId`,
`Order.sellerRefundAmountCents`, Case source-application ledgers and
`StripeWebhookEvent` claims are intentionally adjacent state. Every new fixed
operation must lock and validate those sources rather than treating the
payment row as self-authenticating.

### Human-visible behavior

Buyer and seller pages currently need only a bounded refund outcome: whether a
nonfailed refund exists, the effective amount/currency and a user-safe status.
Disputes are surfaced to participants through the Case system, not as raw
payment-event rows. Staff order detail needs a bounded latest-25 operational
timeline and selected refund-accounting fields. Public analytics needs only
aggregate qualifying-sale facts.

The automated account export must preserve transaction history, but must not
export raw `stripeEventId`, `stripeObjectId`, provider payload metadata,
internal notification copy, claim identifiers or seller transfer-reversal
details to a buyer. Seller exports likewise receive a seller-safe transaction
projection rather than the raw service row. A separately verified privacy or
support request can retrieve additional legally required records through a
staff-reviewed process.

### Refund semantics for launch

The present data model cannot represent a partially cancelled line/item set,
remaining payable/fulfillable quantity and adjusted tax/shipping allocation.
Therefore a pre-handoff seller partial refund cannot safely mean both
"cancelled" and "continue fulfillment."

The launch-safe target is:

- seller self-service keeps full-order cancellation/refund;
- seller self-service partial refund is disabled until a dedicated line-item
  adjustment model exists;
- staff Case resolution retains the already generation-fenced bounded partial
  refund path; and
- any successful retained refund remains terminal for ordinary fulfillment,
  label, review and conversion-count eligibility.

This is a deliberate product constraint, not an RLS consequence. If Grainline
later wants goodwill adjustments or partial item cancellation, build explicit
residual OrderItem quantities, tax/shipping allocation, fulfillment and buyer
copy as a separately audited feature. Do not encode that future feature by
loosening the payment-ledger predicate.

### Retention

The privacy contract retains order and payment records for at least seven
years while separately removing fulfilled-order buyer/shipping PII after the
reviewed 90-day window. `OrderPaymentEvent` has a restrictive Order foreign key
and no ordinary deletion path, which is correct for the current financial
record contract. The row and its metadata must remain PII-minimized. Any
maximum-retention/purge policy requires legal review and a separate fixed,
bounded maintenance operation; RLS activation does not silently add one.

## Actor and operation matrix

| Actor                               | Required read                                                           | Required mutation                                                                         | Database destination                                                |
| ----------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Buyer                               | Refund outcome for buyer-owned Orders; buyer-safe export page           | None                                                                                      | Actor-bound bounded outcome/export projections                      |
| Seller                              | Refund outcome for durably seller-owned Orders; seller-safe export page | Full-refund claim followed by exact provider record/finalize                              | Seller-bound claim/finalizer plus bounded projections               |
| Staff                               | Latest bounded operational timeline and selected accounting facts       | Staff refund remains through the existing Case claim/provider-record/finalize family      | Live staff-role projection; no generic table writer                 |
| Signed Stripe webhook               | No enumerating read                                                     | Append one exact refund or dispute observation and apply reviewed Order/Case side effects | Active webhook-generation/source-bound family writer                |
| Blocked-checkout webhook            | Existing refund outcome for exact checkout Order                        | Claim, provider record and finalize exact automatic full refund                           | Session/event-bound refund claim family                             |
| Fulfillment/label/delivery/review   | Boolean/refund outcome inside one exact Order transition                | None on this table                                                                        | Source-specific transition functions; no general status oracle      |
| Notification/Case DEFINER functions | Exact source row already named by durable evidence                      | Existing source-bound side effects                                                        | Retain owner-private dependency; never grant generic runtime access |
| Analytics/quality jobs              | Aggregate qualifying-sale facts only                                    | None                                                                                      | Fixed aggregate projection with no event IDs or raw rows            |
| Account deletion/retention          | Financial evidence remains; Order PII is separately scrubbed            | No payment-event deletion                                                                 | Existing retained-record boundary                                   |

Clerk, staff-role checks and Stripe signature verification remain application
authentication boundaries. PostgreSQL cannot independently authenticate a
human or Stripe payload. Fixed operations still remove arbitrary table CRUD,
enumeration, unrelated target selection, replay suppression and state rewrite.

## Complete semantic source inventory

The audit pins 26 current source files that name the delegate, nested relation,
raw table or payment-event semantic helper. This is intentionally broader than
the older seven-file direct-access floor.

### Participant and staff projections

- `src/app/account/orders/page.tsx`
- `src/app/dashboard/orders/page.tsx`
- `src/app/dashboard/orders/[id]/page.tsx`
- `src/app/dashboard/sales/page.tsx`
- `src/app/dashboard/sales/[orderId]/page.tsx`
- `src/app/admin/orders/[id]/page.tsx`
- `src/lib/orderPaymentEventLabels.ts`

### Account export

- `src/app/api/account/export/route.ts`

### Eligibility and aggregate predicates

- `src/app/account/page.tsx`
- `src/app/api/reviews/route.ts`
- `src/app/api/seller/analytics/recent-sales/route.ts`
- `src/components/ReviewsSection.tsx`
- `src/lib/ban.ts`
- `src/lib/homepageStats.ts`
- `src/lib/listingSoftDelete.ts`
- `src/lib/quality-score.ts`
- `src/lib/site-metrics-snapshot.ts`

### Contended Order transitions

- `src/app/api/orders/[id]/confirm-delivery/route.ts`
- `src/app/api/orders/[id]/fulfillment/route.ts`
- `src/app/api/orders/[id]/label/route.ts`
- `src/app/api/orders/[id]/refund/route.ts`

### Signed/local evidence and shared semantics

- `src/app/api/stripe/webhook/route.ts`
- `src/lib/localRefundEvidence.ts`
- `src/lib/localRefundEvidenceCore.ts`
- `src/lib/refundLedgerSql.ts`
- `src/lib/refundRouteState.ts`

Existing Case and Notification `SECURITY DEFINER` functions also name
`OrderPaymentEvent` in migration-owned SQL. They are dependencies, not direct
ordinary-runtime table access, and must be included in disposable/live catalog
proofs. Proof-only scripts and owner migrations never justify a runtime grant.

The inventory test fails if any source enters or leaves this set without an
explicit audit update. Activation requires zero ordinary-runtime base-table
access even if helpers hide the delegate behind another module.

## Findings and required disposition

### OPE-A01 - broad service-ledger CRUD is still the predecessor

The ordinary runtime can currently select, insert, update and delete payment
rows. That permits cross-user provider-data enumeration, forged refund/dispute
sources, evidence suppression and mutation. Target posture is policyless
`ENABLE` then `FORCE`, no policies, zero runtime/PUBLIC table or column grants,
and only the exact fixed functions below.

### OPE-A02 - account export crosses the participant privacy boundary

Both buyer and seller exports select every payment-event column, including
raw Stripe object/event IDs and arbitrary metadata. Local seller refund
metadata can contain transfer reversal identifiers and amounts, platform-funded
amounts, original seller transfer amounts, notification copy and internal
reconciliation flags. A buyer does not own the seller's transfer ledger.

Replace both nested selects with separately actor-bound, keyset-paged,
sanitized projections. Update the existing test that currently asserts the
unsafe full-ledger shape; its presence proves an old contract, not that the
contract is correct.

### OPE-A03 - local provider side effects have an ABA claim gap

Seller and blocked-checkout refunds set `Order.sellerRefundId='pending'`, call
Stripe outside a transaction and later finalize. A general helper releases the
sentinel after 15 minutes without a claim generation. A stalled worker can be
overtaken, a different partial amount can produce a different Stripe
idempotency key, and a stale worker has no generation to prevent finalizing
over a newer attempt. Case staff refund already uses the correct private claim
shape and is not subject to elapsed-time release.

Add source-specific database-derived claims. Provider record and finalization
must compare the exact generation. Ambiguous provider outcomes enter a durable
reconciliation state. A bounded stale release may release only a proved
no-provider-effect claim; elapsed time alone is not that proof.

Prepared disposition: migration
`20260824010000_prepare_order_refund_claim_generation` plus the converted
seller and blocked-checkout routes establish the database-derived claim and
exact-generation comparisons. The database tuple constraint prevents legacy
code and signed refund handlers from detaching an active claim. This closes the
ABA acquisition/finalization race in the compatible application, but it is not
live and does not replace the later atomic payment-event/provider
record/finalize functions or evidence-based reconciliation operation.

Prepared disposition update: the stacked reconciliation candidate now scans
the exact PaymentIntent with claim metadata, permits same-scope retry only
before 23 hours, permits proved no-effect release only at or after 25 hours and
records immutable private evidence. It also repairs the previously unreachable
blocked-checkout claim-resume branch. See
`docs/order-payment-event-refund-reconciliation.md`. OPE-A03 is implemented in
the merged compatible stack, not accepted in production.

### OPE-A04 - generic duplicate skipping is not replay validation

Both signed and local writers use `createMany(..., skipDuplicates: true)`.
When a replay identity already exists, they do not consistently prove that its
Order, source family, object, kind and canonical payload match. The fixed
writer must return `created` or `replay` only for an identical source. Any
collision or type/Order mismatch fails closed and applies no side effect.

### OPE-A05 - dispute current-state logic is inconsistent

The lock-critical SQL correctly selects the latest row per dispute object using
signed event time. Two fallback conflict queries use
`blockingOpenDisputeLedgerWhere()`, which considers any historical open row.
Quality-score and site-metrics SQL likewise scans all historical rows, so an
open event followed by an accepted `won` or `warning_closed` event can remain
excluded forever. Those aggregates deliberately exclude lost/prevented/unknown
outcomes as conversion signal; that distinct product rule must be preserved.

Prepared disposition: the merged compatible signed-authority candidate adds
a nullable typed `stripeEventCreatedSeconds` column for signed events and one
supporting latest-per-dispute index. Its signed dispute writer applies the
newer state, retains older states without side effects, and treats any
same-second difference in amount, currency, reason, status, or signed Stripe
event type as a reconciliation conflict. Remaining non-webhook latest-state
consumers must still use the same canonical database expression. For equal
provider seconds with
different state, do not use application arrival time as hidden authority: keep
the ledger rows, refuse conflicting side effects and mark the Order for staff
reconciliation unless a deterministic provider-confirmed state is obtained.

### OPE-A06 - append-only and shape invariants are not database-enforced

The application currently appends only, but the database permits update and
delete. The event kind is free text; currency agreement with Order is only
inspected; amount nonnegativity and source-family metadata are not complete
constraints; `updatedAt=createdAt` is only a historical aggregate assumption.

Compatible preparation must add validated constraints/trigger coverage for:

- exact `REFUND | DISPUTE` taxonomy;
- lowercase three-letter currency equal to the locked Order currency;
- null or nonnegative PostgreSQL-range amount;
- bounded nonblank source IDs/types/status/reason/description;
- source-family shape and typed signed-event time;
- immutable source, payload, timestamps and Order relationship; and
- insert-only lifecycle under ordinary functions, with no DELETE operation.

Use fixed source functions to derive canonical payloads. Do not attempt to
express every JSON family rule as a permissive caller-populated check.

### OPE-A07 - participant reads must be set-based and bounded

List pages currently use nested `take: 1` refund reads. Converting these to one
function call per Order would create an N+1 regression. Use actor-bound batched
or parent-page projections with hard database limits and stable cursors.
Admin history remains capped at 25. Participant functions expose no Stripe IDs
or raw metadata.

### OPE-A08 - synchronous account export is not a 50k-user end state

The route currently materializes complete buyer/seller Order histories and all
nested events in one serverless request. RLS conversion must at least retrieve
payment outcomes in bounded keyset pages. Before any account can accumulate a
large order history, move the complete export to an asynchronous streamed job
or encrypted short-lived object; do not silently truncate a legal portability
export. This scale upgrade is not permission to retain raw ledger access.

### OPE-A09 - the inspected production data snapshot is stale for activation

The accepted 2026-08-05 aggregate inspection contained zero payment-event rows.
Provider and canary work has occurred since then. Run a fresh aggregate-only,
engine-enforced read-only inspection before compatible invariant validation and
again before activation if rows can change. It must expose counts only and
classify taxonomy, currency, amounts, mutation, source-family shapes, replay
collisions, event ordering, refund totals and maximum events per Order.

Prepared disposition: the merged successor extends the existing protected,
engine-read-only inspection from its historical 54-field shape to 66 aggregate
counts. The 12 new counts classify source-family identity, signed/local clock
shape, refund/dispute shape, cross-Order provider-object collisions and
same-second dispute conflicts without retaining identifiers or rows. See
`docs/order-payment-event-invariant-inspection.md`. Its first production
dispatch failed closed before counts, and successful aggregate results must be
reviewed before invariant validation.
The first exact-head CI run, `32770581896`, failed before later gates because
the query compiled only against the prepared provider-time column while CI was
still proving the predecessor schema. The corrected query uses a fail-closed
row projection and is explicitly dual-schema; the failed run touched no
production state and is not acceptance evidence.

Corrected exact head `dd790d40f1c7212c31a0953a8386213c686ded31` passed full
CI run `32770970002` on 2026-08-24, including the aggregate inspection proof
against the predecessor schema and the later restored migration/proof stack.
This does not replace the fresh aggregate-only production inspection required
before invariant validation, and no production or provider state changed.

Protected production inspection run `32773408735` at exact main
`d17b0384f2b90b128ba23852a0dedb004ce52739` then failed closed with
`POSTURE_MISMATCH` before counts or evidence. The stale fence still expected
`SellerPayoutEvent` to be a broad-CRUD predecessor after its accepted FORCE
release. The correction requires all three completed service ledgers to remain
policyless FORCE/no-CRUD and retains only `Order`, `OrderItem`,
`OrderPaymentEvent` and `OrderShippingRateQuote` as RLS-off predecessors. No
production mutation occurred; the failed run is not inspection evidence.

The corrected posture fence merged in PR #262 at exact main
`bc64516c6463118012c643806a3f398f2584092c`; exact-main CI `32782625503`
passed. Protected engine-read-only run `32783261534` accepted the current
production snapshot. Its sanitized artifact SHA-256 is
`2a4e2819efa40acae014521aff141408cef66d468d0f4935c093415416dbbe30`.
It found zero `OrderPaymentEvent` rows and zero values for every payment-event,
refund, dispute, replay, ordering, object-collision, currency and amount defect
count. This permits the isolated invariant design to continue; it is not
activation evidence and must be refreshed before activation if the table can
change.

The same snapshot found one `Order.label_state_coherence_count` defect among 2
Orders and 3 OrderItems. That is an Order release finding, not an
OrderPaymentEvent row or authority defect. A 76-field aggregate-only successor
adds ten overlapping label-lifecycle subtype counts without retaining an Order
ID, provider ID, URL, timestamp, cost or raw row. Classification is not cleanup
authorization, and the Order finding remains tracked for the separate Order
release.

PR #263 exact head `ca02809a793b1455f27cdbe67ba25fca45484f65`
merged at exact main `3bd0a0f7a11074a323c0d6facdcc08d2aeadc0e1`;
exact-main CI `32784976638` passed. Protected read-only run `32785532138`
accepted the 76-field successor with sanitized artifact SHA-256
`a4c7d40ac292d1fa4c8e43ad95b47630ac40be9ef7b5553f56e0523894cd0bff`.
The only nonzero label subtypes were one PURCHASED row missing both
`shippoTransactionId` and `labelUrl`; timestamp, cost, method, fulfillment and
clawback classifications were clean. Every OrderPaymentEvent count remains
zero, so this does not block its invariant/RLS work.

Static lifecycle review found that buyer and seller account deletion
intentionally erase those two provider/download fields while retaining
PURCHASED status and fulfillment history. Do not repair or rehydrate that
privacy-redacted state. The isolated 78-field successor adds aggregate-only
privacy-redacted versus unexplained missing-reference counts using
`buyerDataPurgedAt` and the seller user's `deletedAt`; only a nonzero
unexplained count may enter a separate Order repair design.

PR #264 exact head `6cc8625a252b79b1b794d7b86b9009a36d4f1690`
merged at exact main `1d5bdf3ffa6b1ab41daf5a1c3e0f341253620dc4`.
Exact-main CI `32787483409` and protected engine-read-only inspection
`32788031745` passed. Sanitized artifact SHA-256
`c7c70e68097174182b1aea43420ca1e5ff91c52e670b822f20bcb10db7d2649c`
shows one privacy-redacted missing-reference state and zero unexplained states.
The Order label finding is closed without mutation or repair. It does not block
the separately empty and clean OrderPaymentEvent invariant/RLS work.

### OPE-A10 - existing owner-private consumers are release dependencies

Case staff resolution inserts an exact payment row inside its generation-fenced
provider-record function. Case dispute/seller-refund application and
Notification creation functions read payment evidence. Activation proof must
execute these functions under their real owner/runtime ACL split and prove
their intended source paths still work while direct runtime reads/writes fail.
Do not grant table SELECT back to make an old proof pass.

### OPE-A11 - refund participant delivery had a post-commit crash gap

The fixed refund record operation made financial, stock, Case and audit state
atomic, but the converted application initially created the source-bound
Notification and sent seller-refund email only after that operation committed.
If the process exited after commit, a safe replay could not revisit those side
effects because the Order correctly reported an existing refund. The prior
best-effort catches also turned Notification or email failure into a successful
HTTP response, removing automatic webhook retry pressure.

Keep the provider call outside PostgreSQL, then run the fixed record operation,
source-validated Notification function and deterministic refund EmailOutbox
reservation through one Prisma database transaction. The email worker—not the
request lifetime—is the delivery guarantee. The request attempts the exact
committed job immediately for existing UX, while the scheduled worker recovers
a missed or retryable send; both re-check recipient lifecycle, preference,
suppression and quota state before sending. Exact refund replays
reuse source and outbox deduplication and cannot mint duplicate participant
effects. The 2026-08-25 follow-up found that the blocked-checkout exception was
not a sound product boundary: a paid then automatically refunded checkout needs
the same durable refund-delivery class. Its corrected buyer Notification and
refund EmailOutbox reservation are part of the same transaction. Public
listing/search cache invalidation remains post-commit and idempotent; a missed
call affects only the existing bounded 5-to-60-minute cache TTL, not durable
money, inventory or participant evidence.

### OPE-A12 - blocked-checkout refund delivery used the wrong preference class

`finalizeBlockedCheckoutOrderRefund()` used `NEW_ORDER` for an automatic refund.
That produced the package/order-confirmation icon, consulted the buyer's
`NEW_ORDER` preference instead of `REFUND_ISSUED`, and omitted the durable
refund email that exists for seller and staff-Case refunds. This is a product
and delivery defect independent of RLS.

The compatible correction is specified in
`docs/order-payment-event-blocked-checkout-refund-delivery.md`. First, the
Notification owner function accepts both the predecessor `NEW_ORDER` spelling
and the corrected `REFUND_ISSUED` spelling for only the already source-bound
`BLOCKED_CHECKOUT_REFUND_RECORDED` family. The owner function canonicalizes the
legacy input to `REFUND_ISSUED` before recipient preferences, replay-key
derivation and storage; otherwise the type-bearing uniqueness key would allow
one old and one corrected row when a webhook retry crossed the deployment
drain. Then the application deploy changes the in-app type and atomically
reserves the existing `refund_issued` email template. After predecessor drain
and live proof, a separate byte-pinned retirement removes `NEW_ORDER`
acceptance. No permissive policy, generic runtime function or direct
Notification table grant is introduced.

## Required fixed-operation catalog

Items 1 and 2 are implemented in the merged, byte-pinned migration
`20260824030000_prepare_order_payment_signed_authority`; its authority and
compatible callers are production-live, but that is not provider-proof or RLS
activation evidence. The remaining items are still design contracts until
reviewed SQL is written.

1. Signed refund append: requires active exact `charge.refunded` webhook
   generation/source, derives Order from the retained charge relationship,
   validates cumulative/provider evidence and returns created or identical
   replay.
2. Signed dispute append/apply: requires the exact active dispute event,
   derives the Order through the charge relationship, stores typed provider
   time, applies only a non-superseded state and preserves Case source binding.
3. Seller full-refund claim: derives seller from durable
   `Order.sellerProfileId`, validates terminal/label/dispute/refund state under
   the shared Order lock, derives amount, claim generation and Stripe
   idempotency key.
4. Seller provider record/finalize: binds exact provider evidence to the claim,
   records the payment event, Order terminal state, stock restoration, Case
   application and audit atomically; stale generations cannot finalize.
5. Blocked-checkout full-refund claim/record/finalize: derives the exact
   session/Order from the active webhook generation and preserves recovery.
6. Bounded no-provider-effect reconciliation/release: implemented in the
   merged `20260824040000_prepare_order_refund_reconciliation_authority`
   successor. Current ADMIN plus session-bound PIN selects only an audit reason;
   the bounded provider scan and fixed database operation derive the outcome.
7. Buyer and seller refund-outcome batch/page projections.
8. Buyer and seller payment-history export pages with distinct safe columns.
9. Live staff payment timeline projection with fixed role check and limit.
10. Source-specific transition predicates for fulfillment, label, delivery,
    review, ban/listing lifecycle and post-payment side effects. Local seller,
    blocked-checkout and staff Case participant notification and email-outbox
    reservation commit with their exact fixed finalization transaction.
11. Fixed quality/site/homepage/recent-sales aggregate facts; no arbitrary
    event predicate or event-ID enumeration.

A runtime-ungranted private append core may centralize validated insertion.
There is no runtime-callable `write_payment_event`, `get_payment_event`,
`has_refund(order_id)` or general cleanup function.

## Release and proof sequence

1. Merge this audit and its 26-source inventory tripwire after the stacked
   SellerPayoutEvent record.
2. Implement the launch-safe refund product correction and canonical
   latest-dispute helper with focused business-logic regressions.
3. Run the fresh aggregate-only production inspection; review counts before
   any validating migration.
4. Promote the prepared refund-generation, fixed record/finalize, signed
   refund/dispute and evidence-bound reconciliation authorities only through
   separately byte-pinned compatible releases, then add remaining invariants
   and fixed operations with RLS off and predecessor grants retained.
5. Prove all functions, replay/collision cases, append immutability, claim ABA
   races, dispute reorderings, actor projections and rollback in disposable
   PostgreSQL using separate owner and restricted runtime roles.
6. Deploy the converted application and prove signed Stripe refund/dispute,
   seller full refund, blocked-checkout recovery, staff Case refund,
   participant pages, admin timeline, exports, Notification/Case dependencies
   and aggregate jobs. Preserve old/new coexistence until exact predecessor
   deployment drain.
7. Require the inventory gate to report zero ordinary-runtime base-table
   references. Revoke INSERT/UPDATE/DELETE/SELECT and activate policyless
   `ENABLE` in one byte-pinned release.
8. Run a distinct actual pooled-runtime read-only postflight: direct DML/read
   denial, exact function catalog/ACLs, own/foreign projection isolation and
   real dependency smoke.
9. Apply posture-only FORCE separately and repeat the actual pooled-runtime
   proof. Keep `OrderShippingRateQuote`, `Order` and `OrderItem` separate.

Provider proof is required for this table: it changes a hot signed-event path,
refund money movement and lock/generation behavior. Ephemeral PostgreSQL alone
cannot establish Stripe delivery/retry or serverless overlap correctness.

The signed refund/dispute portion of step 6 is accepted with sanitized evidence
recorded in `docs/order-payment-event-signed-production-proof.md`. The distinct
fresh automatic blocked-checkout proof is also accepted. Those proofs cannot
stand in for the still-separate seller or staff Case refund proofs and do not
permit skipping the remaining activation sequence.

The active isolated package is the authenticated seller full-refund proof in
`docs/order-payment-event-seller-refund-production-proof.md`. It uses the
retained operational Clerk canary only as a temporary vacation-mode seller,
one synthetic email-opted-out buyer and one disposable Stripe test-mode
transfer-capable account. It must prove the exact 500-cent buyer refund,
475-cent reversal, local plus signed payment evidence, Case, Notification,
skipped outbox, stock and retry boundaries before exact cleanup. Its hard
review corrected same-client PostgreSQL query concurrency and the exact Stripe
post-deletion 403 restart shape. It does not authorize execution or RLS
activation.

## Exit criteria

The table is complete only when all of the following are durable:

- all findings above have an accepted disposition;
- the 26-source baseline converts to zero runtime base-table access;
- fresh production data is classified with aggregate-only evidence;
- buyer/seller/staff/service boundaries pass disposable PostgreSQL;
- signed Stripe and local refund paths pass retry/concurrency proof;
- converted old/new deployment coexistence and predecessor drain are proven;
- production is policyless ENABLE plus FORCE with zero direct runtime/PUBLIC
  table/column privileges and the exact reviewed EXECUTE catalog;
- distinct Phase-A and FORCE actual pooled-runtime postflights pass; and
- evidence, failures, rollback bytes, deployment IDs and residual risks are
  recorded in the matrix, architecture, strategy and release documents.
