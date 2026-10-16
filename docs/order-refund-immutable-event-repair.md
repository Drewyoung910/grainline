# Immutable order-refund event repair

Audit finding: #648

Prepared migration: `20261015020000_repair_immutable_order_refund_recording`

Production status: source-only. No SQL, deployment, Stripe operation, or repair
of historical orders has run.

## Defect and correction

The seller-refund and blocked-checkout-refund record functions inserted an
`OrderPaymentEvent`, restored listing stock, and then attempted to update the
event with the restored-listing count. The table's append-only trigger rejects
that update, so Stripe could complete a refund while Grainline rolled back its
local recording transaction.

The forward repair computes the restored active-listing count first and writes
the complete metadata in the initial immutable event row. It does not weaken or
replace the append-only trigger.

## Release boundary

The dedicated protected workflow:

- binds an exact current-main commit to its successful push CI;
- requires every exact-main push workflow to be complete and green;
- verifies the candidate checksum and every other repository migration ledger
  checksum, including migrations applied after this repair's timestamp;
- permits exactly this migration to be pending, or an exact applied replay;
- captures both predecessor functions, their owner/configuration and ACLs, and
  the `OrderPaymentEvent` table/immutability-trigger posture;
- applies only the reviewed migration; and
- proves exact installed source while requiring the prior owner, ACL and
  append-only posture to remain unchanged.

This repair is database-only and performs no Stripe API operation. It prevents
new local recording failures. It does not repair refunds Stripe already
completed.

The PostgreSQL 16 full-chain proof temporarily reinstalls the exact predecessor
functions, reproduces SQLSTATE `23514` after the immutable payment event is
inserted, verifies the failed statement rolls back its stock and evidence
writes, installs the repair, and proves record plus replay on the complete
migrated schema.

## Historical repair follow-up

After this migration is live, produce a read-only inventory of Stripe refunds
since 2026-08-29 that lack corresponding local payment/refund state. Any later
repair must record existing provider evidence and must never issue a second
refund. That inventory and repair require separate review and Production
authorization.
