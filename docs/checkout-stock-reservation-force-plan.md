# CheckoutStockReservation FORCE posture plan

Status: isolated stacked design after activation draft PR #192 and compatible
authority PR #191. Both predecessors are unmerged and production remains
unchanged. This plan, SQL and tooling do not authorize a merge, deployment,
production migration, grant change, database access or provider mutation.

Date: 2026-08-10

## Threat model and decision

The current production migration owner is expected to remain a reviewed
`BYPASSRLS` role, so `FORCE ROW LEVEL SECURITY` does not make that current owner
subject to policies. The value of FORCE is a durable ownership-drift invariant:
if a later migration changes ownership to a non-BYPASS role, owner sessions do
not silently regain the ordinary owner exemption.

CheckoutStockReservation remains a policyless service ledger. The separate
FORCE release changes exactly `relforcerowsecurity` from false to true. It does
not add a policy, grant, function, trigger, constraint or index; mutate a row;
disable RLS; or alter application/provider state.

## Exact Phase-A predecessor

The FORCE draft refuses to run unless all of these remain exact:

1. The reviewed owner holds the table, has the reviewed production/CI role
   posture, and has no other client sessions in the target database.
2. `grainline_app_runtime` remains LOGIN, NOINHERIT and NOBYPASSRLS with no
   privilege-bearing membership path; only the proven non-effective Neon
   administrative bootstrap edge may exist.
3. RLS is enabled, FORCE is off, zero policies exist, and PUBLIC/runtime have
   zero table or column authority.
4. Exactly 20 reviewed reservation/source-binding functions retain their
   signature, owner, PL/pgSQL SECURITY DEFINER mode, pinned search path,
   volatility, parallel safety, source MD5 and exact runtime/private ACL
   partition.

The transaction takes the same advisory lock and ACCESS EXCLUSIVE table lock
as Phase A, with bounded lock and statement timeouts. A drifted predecessor
aborts without changing FORCE.

## Rollback

The database-first rollback changes only FORCE back to NO FORCE. It preserves
policyless ENABLE and zero direct runtime table authority. It refuses a drifted
forced predecessor, including unexpected PUBLIC/runtime table or column ACLs,
rather than hiding a second authority change during emergency recovery.

## Proof boundary

Disposable PostgreSQL proves the full sequence:

- compatible predecessor to policyless ENABLE;
- Phase A to FORCE;
- runtime direct-table denial plus fixed export under FORCE;
- FORCE rollback to exact Phase A;
- Phase-A rollback to compatible CRUD;
- FORCE aborts atomically on a runtime column ACL, unexpected policy,
  unreviewed membership or leaked private-helper EXECUTE;
- FORCE rollback aborts and stays forced on unrelated PUBLIC authority drift.

The separate production postflight accepts only the exact pooled production
runtime credential and exact clean release commit/run IDs. It asserts actual
`CURRENT_USER = SESSION_USER = grainline_app_runtime`, the restricted role
posture, policyless ENABLE+FORCE, zero table/column authority, the exact
20-function catalog, direct-table/private-helper denial, successful fixed
export and a fixed write reaching the engine-enforced read-only fence. It emits
only fresh mode-0600 sanitized evidence.

## Byte-pinned packaging

The read-only builder
`scripts/build-checkout-stock-reservation-force-candidate.mjs` has only a
`--verify` mode and cannot create a Prisma migration directory. Current pins:

- FORCE draft SHA-256:
  `e09dc1167aa8f98c8c7196af615368b2985e234d6cf17914b186c21003b2aa61`;
- FORCE rollback SHA-256:
  `b1120c068044d33e8993938cc78ba32a2cf04e4d96d7cae37f0940ecc43a390c`;
- deterministic proposed migration SHA-256:
  `e182872ccfa8f2537e28f150cc535464d38affb6e8365d2a48d5b3c8f869bfeb`.

No directory named
`prisma/migrations/20260811020000_force_checkout_stock_reservation_rls`
exists at this checkpoint. Promotion and workflow wiring remain a separate
release after compatible deployment, predecessor drain, Phase-A activation and
accepted pooled-runtime Phase-A evidence.
