# OrderPaymentEvent pre-RLS domain audit

Status: audit complete; compatible design and application corrections are
blocked on the findings below. This document contains no policy, function,
migration, grant, deployment, provider or production-state change.

Audited: 2026-08-23 against the application source immediately after accepted
SellerPayoutEvent FORCE proof. This branch is intentionally stacked on the
unmerged SellerPayoutEvent production-record checkpoint `fd9c012150cbd4f4b12acbafa3d8567492c5f11a`.
Merge that record first; this audit does not broaden or reinterpret it.

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

Activation is nevertheless not ready. The audit found five load-bearing
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
   restoration does not rewrite purchased items or prove the retained balance.

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
blocked-checkout refunds now have an isolated, additive database-derived claim
design with exact source/generation/idempotency binding and no elapsed-time
release. It is prepared only: the migration and application conversion are not
merged, deployed or applied to production, and the later fixed provider
record/finalize catalog remains required before RLS activation.

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

| Actor | Required read | Required mutation | Database destination |
|---|---|---|---|
| Buyer | Refund outcome for buyer-owned Orders; buyer-safe export page | None | Actor-bound bounded outcome/export projections |
| Seller | Refund outcome for durably seller-owned Orders; seller-safe export page | Full-refund claim followed by exact provider record/finalize | Seller-bound claim/finalizer plus bounded projections |
| Staff | Latest bounded operational timeline and selected accounting facts | Staff refund remains through the existing Case claim/provider-record/finalize family | Live staff-role projection; no generic table writer |
| Signed Stripe webhook | No enumerating read | Append one exact refund or dispute observation and apply reviewed Order/Case side effects | Active webhook-generation/source-bound family writer |
| Blocked-checkout webhook | Existing refund outcome for exact checkout Order | Claim, provider record and finalize exact automatic full refund | Session/event-bound refund claim family |
| Fulfillment/label/delivery/review | Boolean/refund outcome inside one exact Order transition | None on this table | Source-specific transition functions; no general status oracle |
| Notification/Case DEFINER functions | Exact source row already named by durable evidence | Existing source-bound side effects | Retain owner-private dependency; never grant generic runtime access |
| Analytics/quality jobs | Aggregate qualifying-sale facts only | None | Fixed aggregate projection with no event IDs or raw rows |
| Account deletion/retention | Financial evidence remains; Order PII is separately scrubbed | No payment-event deletion | Existing retained-record boundary |

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

Add a typed `stripeEventCreatedSeconds` column for signed events and one
supporting latest-per-dispute index. Replace every latest-state predicate with
the same canonical database expression. For equal provider seconds with
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

### OPE-A10 - existing owner-private consumers are release dependencies

Case staff resolution inserts an exact payment row inside its generation-fenced
provider-record function. Case dispute/seller-refund application and
Notification creation functions read payment evidence. Activation proof must
execute these functions under their real owner/runtime ACL split and prove
their intended source paths still work while direct runtime reads/writes fail.
Do not grant table SELECT back to make an old proof pass.

## Required fixed-operation catalog

Names remain design contracts until reviewed SQL is written.

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
6. Bounded no-provider-effect reconciliation/release: separate staff or
   database-selected maintenance authority; no caller-selected generic row
   release.
7. Buyer and seller refund-outcome batch/page projections.
8. Buyer and seller payment-history export pages with distinct safe columns.
9. Live staff payment timeline projection with fixed role check and limit.
10. Source-specific transition predicates for fulfillment, label, delivery,
    review, ban/listing lifecycle and post-payment side effects.
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
4. Promote the prepared refund-generation claim only through a separately
   byte-pinned compatible release, then add typed ordering, evidence-based
   claim reconciliation, invariants and the remaining fixed operations with
   RLS off and predecessor grants retained.
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
