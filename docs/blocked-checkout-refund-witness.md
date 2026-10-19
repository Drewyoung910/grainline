# Blocked-checkout refund witness (#664)

Status: Production live. Read-only inventory run `38952207430` found zero
historical witnesses. Protected Production run `38956619452` applied only
`20261015030000_preserve_blocked_checkout_refund_witness` on 2026-10-16 and
passed its catalog, ledger, behavior, and zero-outstanding postflight. Neither
run called Stripe or deployed application code.

Candidate migration:
`20261015030000_preserve_blocked_checkout_refund_witness`

## Verified failure

A paid checkout that became ineligible was identified by mutable
`Order.reviewNote` text and a temporary refund-claim tuple. Reconciliation can
replace that note and release the claim after it concludes that no provider
refund happened. A later checkout-webhook delivery could then treat the order
as complete, while fulfillment and label functions no longer saw a pending
refund. The charged order could therefore become shippable without the required
buyer refund.

## Candidate invariant

Every ineligible paid checkout receives an append-only requirement witness on
its `Order`. The witness remains outstanding until the blocked-checkout refund
record function inserts immutable `OrderPaymentEvent` evidence and records the
completion timestamp in the same transaction.

While that witness is outstanding:

- checkout replay retries the blocked-checkout refund, or waits when another
  claim or provider result is unresolved;
- post-payment projections and notifications stay blocked; and
- every path using the shared refund/fulfillment classifier remains blocked,
  including direct seller fulfillment, buyer receipt, and label operations.

Changing staff notes or releasing a reconciliation claim cannot clear the
witness. Neither timestamp can be changed or removed after it is present, and
the completion timestamp cannot first be set without the matching immutable
payment event.

## Historical transition

The migration conservatively marks existing orders when any retained evidence
identifies a blocked checkout: an active blocked-checkout claim, the historical
review-note marker, its immutable checkout-creation audit reason, a
blocked-checkout reconciliation row, or an immutable blocked-checkout refund
event. Existing immutable tagged refund events also populate
the recorded witness, so already recorded refunds do not remain falsely
outstanding.

If a seller, Stripe-dashboard operator, or legacy application path already
settled the payment, checkout replay may finish once no refund claim remains
active. The outstanding witness still blocks every fulfillment consumer until
staff records the supported completion evidence. The aggregate inventory
separately reports those already-refunded outstanding rows for reconciliation.

## Release boundary and evidence

This is an additive database and Prisma-schema change. It does not enable or
alter RLS, change table grants, call Stripe, or repair a missing provider refund.
Before release it required focused database behavior proof, an independent
money-path review, a full-chain PostgreSQL 16 run, and protected read-only
counts for the historical backfill and index-build population. Those counts
ran through
`.github/workflows/blocked-checkout-refund-witness-inventory-production.yml`
and contained aggregates only. The separately protected migration workflow
required the successful inventory run from the same exact main commit, the
exact successful main CI run, every required exact-main proof workflow, and
exact candidate bytes before allowing one pending migration. The migration
bound all five predecessor
function bodies and their owners, modes, search paths and ACLs before changing
the table, then verified the two columns, constraint, partial index, immutable
trigger and six installed function bodies before commit. The retained release
evidence reported `issueCount=0` and zero outstanding witnesses.
