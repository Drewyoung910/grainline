# OrderItem pre-RLS audit

## Decision

`OrderItem` is the next Order-family RLS release after accepted Core `Order`
FORCE. `OrderShippingRateQuote` remains a separate successor release. The
target posture is policyless ENABLE followed by a separate FORCE release, with
zero ordinary-runtime, staff-runtime, or PUBLIC table and column authority.

This audit preparation does not enable RLS, apply SQL, deploy application code,
or change Production. It replaces repeated broad tests with one exact source
inventory and one bounded read-only Production catalog inspection.

## Current inherited posture

- Application source has zero direct Prisma or raw-SQL access to `OrderItem`
  and `OrderShippingRateQuote`; the existing direct-access inventory test pins
  both lists to empty.
- Production migration
  `20260929130000_revoke_order_item_shipping_quote_runtime_access` removed all
  PUBLIC and `grainline_app_runtime` table privileges from both tables.
- Accepted Core `Order` FORCE left both child tables RLS-off, FORCE-off and
  policyless, with the same reviewed owner and no non-owner table or column
  ACLs.
- The live application uses fixed database functions for every child-table
  operation.

## Exact source surface at `c7d956c2046b481693a7edec89f6b7b5995366cc`

The latest migration definitions contain 38 direct child-table functions:

- 34 directly reference `OrderItem`;
- four directly reference `OrderShippingRateQuote`;
- all 38 are PL/pgSQL `SECURITY DEFINER` functions with
  `search_path=pg_catalog`;
- two non-internal triggers are attached to `OrderItem`, using
  `grainline_order_item_seller_key_bind` and
  `grainline_order_item_seller_key_complete`;
- no non-internal trigger is attached to `OrderShippingRateQuote`.

The exact names are pinned in `scripts/order-child-authority-catalog.mjs`.
That verifier rejects an added overload, an unreviewed direct function,
dynamic `EXECUTE`, PUBLIC execution, an unexpected grantee, an invoker-rights
direct function, owner drift, trigger drift, or a change in the inherited RLS
posture. It reads only catalogs inside a repeatable-read, read-only transaction
and does not read table rows.

## Next release steps

1. Merge the read-only catalog verifier and its manual, exact-main Production
   inspection workflow.
2. Run the inspection once against the current live catalog and retain the
   sanitized seven-day artifact.
3. Use that accepted catalog to pin the policyless `OrderItem` ENABLE draft,
   rollback, focused PostgreSQL proof and guarded Production workflow.
4. After ENABLE overlap is accepted, release `OrderItem` FORCE separately.
5. Repeat the smaller process for `OrderShippingRateQuote`; its source surface
   is four functions and no table triggers.

No authenticated browser smoke or full application test suite is required for
the catalog inspection. CI still runs once on the eventual source PR; the
table-specific PostgreSQL proof runs only when the ENABLE candidate exists.
