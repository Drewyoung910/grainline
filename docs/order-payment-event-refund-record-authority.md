# Order refund record authority preparation

Status: isolated compatible preparation; not merged, deployed or applied to
production. `OrderPaymentEvent` RLS remains off and predecessor table grants
remain unchanged.

Prepared: 2026-08-23 on
`agent/order-payment-event-refund-finalization-20260823`, stacked on the
generation-fenced claim checkpoint in PR #253. The exact prepared migration is
`20260824020000_prepare_order_refund_record_authority`, SHA-256
`e1cd79da8f6a0a22668cb612c6f7d579b7af1caf431f917d69771e6b0742d505`.

All fixed-operation timestamps are written explicitly in UTC. This preserves
the claim clock and finalization evidence across database session time zones.

## Decision

Seller full refunds and blocked-checkout automatic refunds now use one fixed
PostgreSQL record/finalize statement after Stripe returns. The operation locks
and revalidates the exact active refund claim and derives the Order, amount,
currency, buyer, seller, stock rows, Case application and durable evidence from
database state. In one transaction it:

- inserts one replay-keyed `OrderPaymentEvent`;
- replaces the active Order claim with the exact provider refund identity;
- applies the existing private Case seller-refund operation where relevant;
- restores eligible in-stock quantities and reactivates only public sold-out
  listings whose restored quantity is positive;
- sets the bounded seller-reconciliation flag when no historical transfer can
  be reversed;
- inserts one `SystemAuditLog` row; and
- records the database-derived notification body and restored-listing count in
  event metadata.

Any failure rolls the complete statement back. Application code retries the
same fixed operation once with identical claim/provider evidence; it no longer
falls back to a broad partial "orphan" transaction that can separate Order,
payment, stock, Case and audit state. Exact replays return the existing result
without restoring stock or writing evidence again.

## Crash-safe participant delivery refinement

The stacked
`agent/order-payment-event-refund-side-effects-20260823` refinement closes the
remaining application transaction gap. Seller finalization now runs the fixed
record operation, source-validated buyer Notification function and a
deterministic `refund_issued` EmailOutbox reservation through one Prisma
transaction. Blocked-checkout finalization runs its fixed record operation and
source-validated buyer Notification through the same transaction. Recipient,
refund amount, currency and source identity come from the validated claim and
record result rather than the earlier route snapshot.

The provider refund still happens before the database transaction because
PostgreSQL cannot perform or authenticate the Stripe request. If Notification
or outbox reservation fails, the complete local transaction rolls back and the
same provider evidence can retry through the generation-fenced finalizer. Once
it commits, a request crash cannot lose the participant evidence: the existing
request path attempts the exact committed outbox job immediately, while the
email-outbox cron recovers a missed or retryable send. Both recheck current
account, preference, suppression and quota state and use the same provider
idempotency key, so delivery never requires another refund. Exact replay
deduplicates both Notification and outbox identity.

The outbox reservation uses Prisma `createMany(..., skipDuplicates: true)` and
then reads the exact dedup row. This intentionally maps PostgreSQL replay to
`ON CONFLICT DO NOTHING`: catching a `P2002` after a normal insert and then
querying would leave the enclosing transaction aborted and make the supposedly
restart-safe replay fail.

Search and homepage tag invalidation remains an idempotent post-commit action.
A process exit can therefore retain only the existing bounded cache staleness
(five minutes for featured makers and at most one hour for popular listing
tags); it cannot lose durable refund, stock, Case, notification or email-queue
state.

The separate staff Case family uses its already-live Case claim/provider/
finalize functions. Its stacked application correction is documented in
`docs/order-payment-event-case-refund-delivery.md`: the existing fixed
finalizer plus buyer/seller source-validated Notifications and one
claim-deduplicated `case_resolved` EmailOutbox reservation now share a
transaction. This does not change the seller or blocked-checkout SQL in this
release.

## Restart-safe blocked-checkout handoff

A failed Stripe webhook attempt clears its lease. A later signed retry owns a
higher `StripeWebhookEvent.claimGeneration`, while Stripe must retain the same
idempotency identity for the already-authorized provider request. The new
`grainline_blocked_checkout_refund_claim_resume` operation hands the existing
claim to the current generation only when all of these facts still match:

- exact event ID and accepted checkout event type;
- exact active current event generation and unprocessed lease;
- exact Checkout Session source object;
- exact Order and Order session binding;
- exact database-derived refund amount and currency;
- exact blocked-checkout claim source and nondecreasing prior generation; and
- exact database-derived idempotency scope.

It changes only `refundClaimSourceGeneration`. Any other difference fails
closed. If no resumable claim exists, it delegates to the sealed predecessor
claim operation, which retains all refund/dispute/Order eligibility checks.

## Authority and replay boundary

The three new runtime entrypoints are:

1. `grainline_blocked_checkout_refund_claim_resume(text,bigint,text,text,integer)`;
2. `grainline_seller_refund_record(text,text,bigint,text,text,text,integer)`; and
3. `grainline_blocked_checkout_refund_record(text,bigint,text,bigint,text,text,text,integer)`.

All are owner-held `SECURITY DEFINER`, `VOLATILE`, `PARALLEL UNSAFE`, pinned to
`search_path=pg_catalog`, revoked from `PUBLIC`, and executable only by
`grainline_app_runtime`. There is no dynamic SQL or generic table writer.

The shared blocked-checkout mutation body is the separate
`grainline_blocked_checkout_refund_record_core(...)`. It is owner-private:
both `PUBLIC` and `grainline_app_runtime` are explicitly revoked. The ordinary
runtime wrapper requires the exact active signed webhook lease, except that an
exact already-recorded local payment-event replay remains readable. The later
reconciliation migration adds a distinct runtime wrapper around the same core;
that wrapper derives the event/generation from one immutable ADMIN
reconciliation row and accepts only the failed, inactive, unprocessed event
state. Runtime never receives direct execute on the core.

Provider refund/reversal fields necessarily cross the application/database
boundary because PostgreSQL cannot authenticate a synchronous Stripe API
response. The fixed functions accept only one shaped refund identity, bind it
to one database-authorized claim, reject terminal failure statuses and
unexpected reversal evidence, require the expanded reversal ID and exact
database-derived original seller-transfer amount whenever the Order proves a
transfer must be reversed, and compare the canonical payload on replay. A
one-cent short reversal therefore fails closed.
The accepted provider status is also closed over Stripe's documented nullable
refund-status contract: only `pending`, `requires_action`, `succeeded` or null
may cross the application boundary. Unknown, case-drifted and terminal values
fail before any evidence or Order transition is written.
This is a materially smaller authority than direct table CRUD, but it is not a
claim that PostgreSQL cryptographically verified Stripe. Signed-event/provider
reconciliation remains an activation gate.

## Coexistence and deliberately retained paths

This preparation is additive. It does not enable or FORCE RLS, create policies,
revoke table grants or change existing rows. Old deployments can continue to
use the predecessor table path until the converted application is deployed and
drained.

Two fail-closed ambiguous-provider branches remain direct conditional `Order`
updates. They run only when Stripe does not return a single usable refund ID,
retain the active generation tuple, set the reconciliation sentinel/note, and
do not create payment evidence, restore stock or resolve a Case. They cannot be
converted to a successful finalizer without proving a provider effect. A later
bounded reconciliation operation must classify them before activation.

The staff Case refund family, signed `charge.refunded`/dispute append families,
typed ledger invariants, actor-safe projections and aggregate consumers remain
separate work. This checkpoint does not authorize `OrderPaymentEvent` RLS.

## Proof retained

Disposable PostgreSQL executes the actual claim and record migrations and
proves:

- seller finalization atomically updates payment, Order, Case, stock and audit
  evidence;
- an injected Case-application drift rolls every earlier write back;
- exact replay does not double-restore stock and remains available after the
  seller account later becomes banned;
- a later signed webhook generation can resume only the identical active
  blocked-checkout claim;
- blocked-checkout replay remains exact after the event is processed;
- direct runtime execution of the blocked-checkout core is denied;
- after a failed webhook clears its lease, the ordinary wrapper denies a new
  record while the exact immutable-reconciliation wrapper can record once and
  atomically mark the source event processed;
- malformed provider evidence and claim-generation drift fail closed; and
- runtime/PUBLIC function privileges match the reviewed catalog.

Static contracts additionally pin the three runtime signatures plus the one
owner-private core, fixed function posture, application callsites, typed result
validation, absence of dynamic SQL and absence of RLS/table-grant changes. The release verifier seals the exact
migration bytes and nests the release after the exact claim-generation
predecessor. CI must isolate this migration while replaying historical sealed
predecessors, then restore and apply it only to the disposable CI database.

## Next sequence

1. Complete the Extra-High implementation/release review and merge only the
   stacked compatible preparation.
2. Wire a separate guarded production preparation release; do not combine it
   with RLS activation.
3. Deploy the converted application and prove seller and blocked-checkout
   provider/retry behavior while predecessor authority still coexists.
4. Retain the evidence-bound ambiguous-claim successor in
   `docs/order-payment-event-refund-reconciliation.md`, then finish the staff
   families, append-only/taxonomy/currency/provider-time invariants,
   participant/staff projections and aggregate predicates.
5. Run fresh aggregate-only production inspection, prove the complete catalog
   with distinct owner/runtime logins, and drain the predecessor deployment.
6. Revoke direct table authority and release policyless ENABLE, pooled-runtime
   postflight, FORCE and a second pooled-runtime postflight as separate gates.
