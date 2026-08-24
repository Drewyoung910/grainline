# OrderPaymentEvent signed-webhook authority design

Status: compatible candidate implemented, byte-pinned and merged through exact
main `d17b0384f2b90b128ba23852a0dedb004ce52739`. Migration
`20260824030000_prepare_order_payment_signed_authority` has SHA-256
`176ad2c17301dd1d6bd9a1c0e190e8d44b15463ec830f9a67eb43ec3070396f2`.
No migration dispatch, application deployment, RLS, table-grant, provider or
production state change has occurred for this checkpoint.

Audited: 2026-08-23 after the fixed local-refund record and crash-safe
participant-delivery packages.

## Exact scope

This successor converts only the signed platform webhook writers for:

- `charge.refunded`; and
- `charge.dispute.created`, `charge.dispute.updated`,
  `charge.dispute.closed`, `charge.dispute.funds_withdrawn` and
  `charge.dispute.funds_reinstated`.

The two families share the Stripe charge serialization lock, exact
`StripeWebhookEvent` generation binding, Order derivation and the new typed
provider-event clock. Keeping them in one compatible release avoids two
temporary ordering representations. It does not authorize bundling ambiguous
local-refund reconciliation, staff Case refunds, participant projections,
base-table grant revocation or RLS activation.

## Trust boundary

The application verifies the Stripe signature before opening a webhook lease.
PostgreSQL does not receive the raw signed envelope or the webhook secret, so a
database function cannot independently prove cryptographic authenticity. The
fixed functions therefore provide a narrower but still material invariant:
they accept bounded provider observations only while the exact event ID, event
type, source object and claim generation are actively leased, derive every
Grainline target from durable relationships, and reject inconsistent replay or
collision. They prevent a normal application path from becoming a generic
cross-order ledger writer. They are not evidence that a fully compromised
runtime—which can invoke the webhook-begin authority—cannot fabricate an
ingress lease.

No function accepts a caller-selected `orderId`, participant, actor,
description, arbitrary metadata document or audit target. The only
runtime-supplied facts are the bounded fields parsed from the already verified
Stripe object. Currency, amount, status, reason, provider object ID and event
time must be shape-checked and cross-checked against the active source and
derived Order wherever a durable local fact exists.

## Fixed operation catalog

The compatible release exposes exactly two runtime-callable operations:

1. `grainline_order_payment_signed_refund_apply(...)`; and
2. `grainline_order_payment_signed_dispute_apply(...)`.

Both are `SECURITY DEFINER`, `VOLATILE`, `PARALLEL UNSAFE`, use
`SET search_path = pg_catalog`, contain no dynamic SQL, have `PUBLIC` execution
revoked and grant `EXECUTE` only to `grainline_app_runtime`. A private helper
may centralize validated insertion, but it must be runtime-inaccessible. There
is no generic append, arbitrary lookup, arbitrary Order update or cleanup
function.

Each operation locks and validates the active `StripeWebhookEvent` row for the
exact event ID, expected event type, expected source object ID, positive claim
generation, non-null `processingStartedAt` and null `processedAt`. It then
acquires the existing charge advisory lock before deriving and locking the
single Order through `Order.stripeChargeId`. The dispute family additionally
serializes the dispute object before reading or appending its latest state.
The fixed order is source event row, charge advisory lock, Order row, then
dispute-object advisory lock. Every competing local refund path must retain the
same charge-before-Order order.

## Typed signed-event time

The compatible schema adds nullable
`OrderPaymentEvent.stripeEventCreatedSeconds bigint` with a validated range
check. Signed refund and dispute writes require it. Local historical writers
remain nullable during coexistence. A latest-per-dispute index orders by
`orderId`, `eventType`, `stripeObjectId`, typed event time descending and
stable row ID.

The migration does not backfill a provider time from application `createdAt`.
That would turn arrival time into fabricated provider evidence. Legacy rows
remain explicitly classified until a later validating/activation release can
prove the required domain.

## Replay and dispute ordering

`stripeEventId` remains the exact replay identity. Replaying the same event is
accepted only when every canonical stored field is identical; otherwise the
operation fails closed. A different event may never overwrite an existing
append-only observation.

For disputes, signed event seconds—not event ID and not application arrival
time—govern local side effects:

- an older observation is retained as evidence with action `stale_recorded`
  and applies no Order, Case, refund-lock or notification transition;
- a newer observation is retained and applies the reviewed Order transition;
  a newer `charge.dispute.created` may invoke the already source-bound Case
  dispute operation;
- an identical replay at the same provider second applies no repeated side
  effect; and
- conflicting states at the same provider second are both retained, mark the
  Order for staff reconciliation and apply no Case, refund-lock or
  notification transition.

The equal-second conflict path must not throw after inserting evidence: doing
so would roll back the very observation needed for reconciliation. Its result
must explicitly tell the application that no participant fanout is authorized.

## Application conversion and delivery

The webhook route calls only the fixed family function and validates its exact
single-row result. The old `recordOrderPaymentEvent` path is removed for these
six event types but remains until other local families convert. Seller dispute
notification is allowed only from the function-derived Case tuple for an
applied, non-replay `charge.dispute.created` result. Before release review,
that delivery must either co-commit through the source-validating Notification
operation or have a documented durable outbox/retry boundary; a post-commit
best-effort call is not accepted silently.

The release is additive: predecessor direct table authority and old/new app
compatibility remain until the converted deployment, signed delivery/retry and
concurrency proof, and predecessor drain are complete. Policyless ENABLE,
grant revocation and FORCE remain later releases.

## Implemented candidate checkpoint

The merged candidate implements the two operations above, the nullable typed
event-time column and its latest-dispute index. The Stripe platform webhook
route uses typed application wrappers and no longer directly inserts
`OrderPaymentEvent` rows for the converted refund/dispute families. Missing
signed charge/dispute amount, currency or status fields fail closed rather than
being replaced with application defaults.

The dispute operation derives Order, buyer and seller from the validated
source, invokes the existing Case source operation only for a newest
`charge.dispute.created` observation, and co-commits its source-bound seller
Notification in the same database transaction. Same-provider-second rows are
classified as `same_second_recorded` only when amount, currency, reason,
status, and signed Stripe event type agree. Any differing field—including a
`created`/`updated` type difference—records `conflict_recorded`, marks the
Order for staff reconciliation and authorizes no Case or participant fanout.

The migration stays compatible: RLS remains unchanged, predecessor table CRUD
remains available for old deployments and exactly the two new operations are
runtime-callable. `scripts/verify-order-payment-signed-authority-release.mjs`
seals this phase as `order-payment-signed-authority-prepared`; CI applies the
migration only after replaying the byte-sealed historical refund,
CheckoutStockReservation and SellerPayoutEvent chains. The guarded Production
Migrations workflow intentionally does not expose this candidate yet.

The stacked compatible refund-reconciliation successor is documented in
`docs/order-payment-event-refund-reconciliation.md`. It does not widen these
signed operations or authorize RLS activation.

Disposable PostgreSQL proof covers separate owner/runtime ACLs, forged
source/type/object/generation denial, replay/collision behavior, refund and
dispute serialization, older/newer/equal-second handling, Case binding,
transaction rollback and zero new generic function authority. Predecessor
direct table CRUD is intentionally retained for coexistence. These local proofs do not
replace the future converted-deployment signed Stripe delivery/retry proof.

## Proof gates

Before merge or deployment, disposable PostgreSQL must prove separate owner and
runtime roles, ACLs, source/type/object/generation rejection, Order derivation,
currency and amount checks, identical replay, conflicting replay, concurrent
first insert, refund/dispute serialization, older/newer/equal-second dispute
behavior, Case source binding, rollback and zero new generic function authority.

Before activation, a fresh provider proof must exercise real signed Stripe
test-mode refund and dispute deliveries plus retry against the converted
deployment. Production inspection, legacy classification, projections,
remaining fixed families, invariants, exact grant convergence, policyless
ENABLE and FORCE keep their separate gates.
