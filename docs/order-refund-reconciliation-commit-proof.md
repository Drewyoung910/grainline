# Order refund-reconciliation commit proof

Status: locally implemented and PostgreSQL-proven; database-first draft only.
No migration, deployment, RLS posture, table grant or production state changed.

## Finding

The staff refund-reconciliation error recovery attempted to mark its exact
claim ambiguous. If that transition failed, it queried `Order` directly and
treated any cleared claim plus any `sellerRefundId` beginning with `re_` as
proof that the preceding refund committed.

That read would stop working after policyless Order RLS. It also did not bind
the observed refund to the exact claim or generation being recovered, so an
unrelated later state could be reported as success.

## Accepted design

`grainline_order_refund_reconciliation_committed(text, text, bigint)` returns
only a boolean. It requires the exact Order, UUID-shaped claim id and positive
claim generation; joins the immutable `OrderRefundReconciliation` ledger to
that Order; accepts only retry or confirmed-provider-effect decisions; and
requires the matching generation to be fully finalized with a canonical
Stripe refund id, positive amount and cleared claim fields.

A no-provider-effect release, unfinished finalization, different Order, claim,
or generation returns false. Malformed input raises. Runtime receives EXECUTE
only on this fixed projection and receives no new table authority.

## Release order

1. Extra-High review the exact-state predicate and immutable-ledger binding.
2. Apply the function database-first as a byte-pinned compatibility migration.
3. Prove runtime execution, direct-table denial and true/false claim families.
4. Deploy the compatible application before revoking direct Order authority.

Rollback is application-first: restore a compatible application before
restoring or removing the fixed function.
