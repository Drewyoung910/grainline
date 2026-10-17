# Blocked-checkout refund recovery (#688)

Status: reviewed source candidate. No Production migration, deployment, Stripe
request, historical repair, or customer notification has run.

Candidate migration:
`20261015040000_repair_blocked_checkout_refund_recovery`

## Verified failure

The checkout webhook can create an ineligible paid order, authorize its exact
blocked-checkout refund claim, and receive a signed `charge.refunded` event
before the local refund-record transaction commits. The signed event correctly
sets `paymentRefundBlocked`, but the existing-order classifier then returned
`processing` forever. Stripe had refunded the buyer while Grainline retained a
pending claim, an outstanding refund witness, restored no stock, and offered no
automatic exit.

An ADMIN reconciliation could prove the existing provider refund, but the old
record wrapper required the original checkout-event claim generation to still
be current and unprocessed. A later failed or processed retry therefore made
the immutable reconciliation evidence unusable.

## Candidate behavior

The existing-order classifier returns `retry` only when all of these facts hold:

- the durable blocked-checkout refund witness is outstanding;
- `paymentRefundBlocked` is true;
- the order still owns a pending blocked-checkout claim for this checkout event;
- the claim source generation is no newer than the current event generation;
- provider authorization was durably recorded; and
- no local refund record has completed.

That path re-enters the existing claim and records the provider refund already
observed. It does not create another Stripe refund.

The reconciliation wrapper now accepts a failed, processed, or later-generation
checkout event only through an immutable `OrderRefundReconciliation` row made by
a current ADMIN. When the event generation advanced, the wrapper moves the
still-active claim to the locked current generation only if the order, source
event, idempotency scope, provider authorization, session, and outstanding
witness all still match. It then delegates to the existing immutable refund
record core. Record and replay retain one `OrderPaymentEvent`, one refund id,
one stock restoration, and the durable completion witness.

A processed Stripe event cannot later acquire another claim generation:
`grainline_stripe_webhook_begin` returns `processed` before the generation
increment. That makes replay at the recorded generation stable without
broadening this repair into the refund-record core.

## Evidence

The PostgreSQL 16 full-chain scenario uses the complete 347-migration schema. It
temporarily reinstalls the exact two predecessors and proves:

1. a signed refund observation leaves the exact provider-authorized claim stuck
   at `processing` before the repair;
2. an already locally recorded #664 refund still returns `complete`;
3. ADMIN reconciliation cannot record against a processed later generation
   before the repair;
4. after the repair, checkout replay returns `retry` for the stuck exact claim;
5. the later-generation reconciliation records the existing refund exactly
   once, restores stock once, reactivates the eligible listing, records the
   witness, and replays the same immutable event; and
6. the preceding #648 proof restores the later #664 core before this scenario,
   so the run exercises the actual final migration order rather than stale
   harness state.

The migration builder derives both successor functions from their exact live
predecessor migrations and refuses source-shape drift. Its output is byte-equal
to the candidate migration and pins all four predecessor/successor body hashes.

## Release boundary

The protected Production workflow requires:

- the exact independently reviewed current-main commit;
- the exact successful push CI run and every exact-main push workflow green;
- exact candidate bytes and the deterministic builder check;
- every peer migration applied with its reviewed checksum;
- exactly this migration pending, or its exact restart-safe applied state;
- the exact predecessor or successor function sources, owner, security-definer
  posture, search path, and runtime/PUBLIC/staff ACLs;
- unchanged `OrderPaymentEvent` FORCE-RLS, table ACL, and immutable-trigger
  posture; and
- an exact postflight, no remaining migrations, and the global grant audit.

The workflow is database-only. It does not deploy the application or call
Stripe. Dispatch requires a separate Production approval naming the exact
workflow, commit, CI run, migration, and expected effect.

Historical stuck-refund inventory and repair remain separate operations. Any
repair must record an existing Stripe refund and must never issue a second one.
