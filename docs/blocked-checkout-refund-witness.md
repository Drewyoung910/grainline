# Blocked-checkout refund witness (#664)

Status: reviewed release candidate. No migration, deployment, or Stripe action
has run.

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
review-note marker, a blocked-checkout reconciliation row, or an immutable
blocked-checkout refund event. Existing immutable refund events also populate
the recorded witness, so already recorded refunds do not remain falsely
outstanding.

## Release boundary

This is an additive database and Prisma-schema change. It does not enable or
alter RLS, change table grants, call Stripe, or repair a missing provider refund.
Before publication it requires focused database behavior proof, an independent
money-path review, a full-chain PostgreSQL 16 run, and protected read-only
counts for the historical backfill and index-build population. Those counts
run through
`.github/workflows/blocked-checkout-refund-witness-inventory-production.yml`
and contain aggregates only. The separately protected migration workflow
requires the successful inventory run from the same exact main commit, the
exact successful main CI run, every required exact-main proof workflow, and
exact candidate bytes before allowing one pending migration. The migration
binds all five predecessor
function bodies and their owners, modes, search paths and ACLs before changing
the table, then verifies the two columns, constraint, partial index, immutable
trigger and six installed function bodies before commit. RLS expansion remains
paused through this and the other named money blockers.
