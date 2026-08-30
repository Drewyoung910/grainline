# OrderPaymentEvent transition authority

Status: isolated compatible candidate; not applied, deployed or activated.

## Decision

The remaining order-transition callers do not need payment-event rows. They
need two database-maintained facts on the parent `Order`:

- `paymentRefundBlocked`, prepared by the aggregate-authority release; and
- `paymentOpenDisputeBlocked`, prepared by this release.

Migration
`20260830020000_prepare_order_payment_event_transition_authority` adds the
second database-maintained `Order` projection, backfills it from the immutable
ledger and refreshes it after each `OrderPaymentEvent` insert. It changes no
RLS bit and no table or column grant. RLS and predecessor table grants remain
unchanged until the later, separate activation releases.

This avoids a generic runtime `has_payment_event(order_id)` function and avoids
giving order, label, refund or webhook routes authority to enumerate provider
evidence. Those callers now make their contended state change against the
projection on the same parent row they update.

## Canonical dispute state

The projection groups events by Stripe dispute object, using the immutable
event row ID only when no provider object ID exists. For each object it selects
the greatest provider event second; legacy rows without that field fall back
to their database `createdAt` second. The latest state is considered closed
only for `won`, `lost`, `prevented` or `warning_closed`.

Unknown and null states fail closed. Same-provider-second conflicts fail closed
as well: if any row in the latest provider-time group is open, or the group has
more than one normalized status, the Order remains blocked. Arrival order and
caller-provided sorting can therefore never turn an ambiguous dispute into an
unblocked transition.

## Authority and anti-forgery boundary

Three fixed `SECURITY DEFINER` functions are migration-owned, `VOLATILE`,
`PARALLEL UNSAFE`, and pinned to `search_path = pg_catalog`:

- `grainline_order_payment_open_dispute_state(text)` derives one boolean from
  the exact Order's immutable payment evidence;
- `grainline_order_payment_open_dispute_guard()` rejects direct attempts to
  forge the Order projection; and
- `grainline_order_payment_open_dispute_refresh()` refreshes only the exact
  parent Order after a payment-event insert.

`PUBLIC` and `grainline_app_runtime` execution are revoked from all three.
The ordinary runtime cannot execute or use them as a payment lookup API. Their
only runtime reachability is through the database-owned triggers. The grant
audit classifies all three as runtime-private.

The migration takes the parent `Order` relation lock before the
`OrderPaymentEvent` relation lock. Fixed payment writers already lock the
parent `Order` row before appending evidence, so installation preserves the
same lock order. At request time, an evidence insert refreshes and holds the
parent `Order` row; a competing transition waits, rechecks its projection
predicate after the evidence commits, and affects zero rows. If the transition
locks first, it linearizes before the later evidence. Neither ordering admits
a stale transition after a committed open dispute.

## Application conversion

The compatibility candidate removes direct base-ledger access from exactly the
remaining ordinary-runtime surfaces:

- buyer delivery confirmation;
- seller fulfillment changes;
- shipping-label purchase;
- seller self-service refund preflight;
- Stripe checkout/refund webhook recovery;
- shared transition SQL; and
- the unused generic local-refund evidence writer, which is retired while its
  deterministic event-ID helper remains available to fixed database
  authorities and proof tooling.

The complete 34-file semantic inventory remains broader than this seven-file
direct-access set. It intentionally retains projection and typed semantic
references after base-table access disappears; the inventory test prevents a
new wrapper or indirection from silently escaping the activation audit.

## Proof and release sequence

The candidate is acceptable only when all of these pass:

1. byte-pinned release verification with no later unreviewed migration;
2. class-wide zero-direct-access application checks;
3. PostgreSQL special-form syntax checks;
4. disposable PostgreSQL backfill, ordering, unknown-state, same-second
   conflict, anti-forgery and private-execution checks;
5. separate owner/runtime-login proof of the parent-row transition race;
6. TypeScript, lint, the full repository suite and production build; and
7. hosted CI with the migration applied only after its read and aggregate
   predecessors pass.

Merge is not production authorization. Compatible database preparation,
compatible application deployment, bounded authenticated smoke, predecessor
drain, policyless `ENABLE`, runtime grant removal and later `FORCE` remain
separate releases. No provider configuration or production data is changed by
this candidate.
