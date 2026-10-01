# OrderItem FORCE release plan

## State and boundary

This is local successor preparation only. It is based on OrderItem ENABLE
candidate `760cd8058d74d1a2bc40f3e0dac6b6e690cdad93`; that candidate is not yet
merged or applied. No OrderItem FORCE migration may be published or applied
until policyless ENABLE is live and its postflight is accepted.

The eventual release changes only `public."OrderItem"` from RLS ENABLE / NO
FORCE to RLS ENABLE / FORCE. It creates no policy, changes no application code,
does not change `OrderShippingRateQuote`, and does not restore any direct table
or column grant.

## Required predecessor evidence

1. `20261001030000_enable_order_item_rls` is applied once with exact checksum
   `928413764a087ef5f535f99ed993c85da0a528767e26a89d2faf791eb9c29d17`.
2. A corrected Order child authority inspection succeeds on an ancestor of the
   FORCE source commit and preserves its sanitized artifact.
3. `OrderItem` is enabled, not forced, policyless, owned by the reviewed
   migration owner, and has zero PUBLIC, ordinary-runtime, and staff-runtime
   table and column authority.
4. The exact 34 direct OrderItem functions and two trigger functions still
   match their reviewed identities, bodies, owners, security modes,
   configurations, ACLs, trigger names, and trigger timing.
5. Application source still has zero direct Prisma or raw-SQL OrderItem access.
6. `OrderShippingRateQuote` remains RLS-off, FORCE-off, policyless, and
   zero-direct as a separate successor release.

## FORCE migration shape

- Run from a direct reviewed owner session under the shared Production
  migration concurrency group.
- Acquire a transaction advisory lock and `ACCESS EXCLUSIVE` OrderItem lock
  with bounded lock and statement timeouts.
- Reject owner, restricted-role, role-membership, ledger, table, function,
  trigger, grant, policy, or source drift before changing posture.
- Require the migration-owner session drain used by accepted Core Order FORCE.
- Execute only `ALTER TABLE public."OrderItem" FORCE ROW LEVEL SECURITY` and a
  defensive repeat of the existing direct-grant revocation.
- Re-read the exact catalog in the same transaction and retain a sanitized
  postflight after commit.

The rollback performs only `NO FORCE ROW LEVEL SECURITY`, leaving policyless
ENABLE and every zero-direct grant boundary intact.

## Production workflow gates

The workflow must be manual, main-only, first-attempt-only, and bound to exact
main, successful exact-head push CI, the accepted OrderItem ENABLE Production
run, and the accepted corrected authority inspection. It must reject any other
pending migration, support an exact-ledger restart, apply only the FORCE
migration, audit global runtime grants, prove the forced catalog posture, and
preserve a sanitized seven-day artifact.

Source publication waits for accepted ENABLE postflight. Production execution
requires a separate exact approval after the FORCE source PR and checks pass.
