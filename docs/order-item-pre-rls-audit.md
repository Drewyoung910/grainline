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
- all 38 are `SECURITY DEFINER` functions with `search_path=pg_catalog`;
- four reviewed `OrderItem` readers are SQL-language stable, parallel-safe
  functions; the other 30 `OrderItem` functions are PL/pgSQL with their exact
  volatility and parallel-safety attributes pinned per identity;
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

## First Production readback

The verifier and read-only inspection workflow merged on main
`cfeae8117a5a3ff89078f45fe3c9575764064e87`. Its exact push CI run
`36810108185` passed. Production inspection run `36812475699` then reached the
catalog verifier and failed safely because PostgreSQL `format('%s', boolean)`
serialized `acl.is_grantable = false` as `f`, while the JavaScript verifier
expected the word `false`.

This was a result-format defect, not accepted evidence of catalog drift. The
inspection used a repeatable-read, read-only transaction and only catalog
queries, so the failed run did not read application rows or change Production.
It produced no accepted artifact and cannot satisfy the ENABLE workflow gate.
The OrderItem candidate normalizes both function and trigger ACL booleans to
the exact words `true` and `false` and includes a regression check for that
boundary.

## First candidate CI finding

The first public candidate head `1e5715cb11883653809d66f3ef21326140fd722b`
completed the broad CI suite but failed safely in the final disposable
PostgreSQL apply (run `36818251498`). The preflight had incorrectly required all
34 direct `OrderItem` functions to be PL/pgSQL. Four reviewed stable,
parallel-safe readers are intentionally SQL-language functions:

- `grainline_order_buyer_detail_v3`;
- `grainline_order_public_marketplace_listing_metrics`;
- `grainline_order_seller_detail_v3`;
- `grainline_order_summary_items`.

The amended candidate pins each function's exact language, volatility and
parallel-safety attributes alongside its identity and body hash. It retains the
independent requirements that all 34 functions are `SECURITY DEFINER`,
non-leakproof, owner-controlled, fixed-search-path functions with reviewed
execute ACLs and no dynamic `EXECUTE`. The failed head remains unmerged and no
Production SQL ran.

## Prepared OrderItem ENABLE release

The prepared successor is migration
`20261001030000_enable_order_item_rls`, SHA-256
`928413764a087ef5f535f99ed993c85da0a528767e26a89d2faf791eb9c29d17`.
It enables policyless RLS on `OrderItem`, explicitly retains NO FORCE, re-revokes
all ordinary-runtime, staff-runtime and PUBLIC table authority, and leaves
`OrderShippingRateQuote` unchanged. Its atomic preflight pins all 34 direct
OrderItem function identities and bodies plus both trigger identities, bodies,
timing, ownership, security mode, configuration and ACLs. The separate rollback
returns only the RLS posture to the accepted zero-direct predecessor and does
not recreate grants.

## Next release steps

1. Merge the prepared OrderItem source candidate, including the catalog output
   normalization and guarded ENABLE workflow.
2. Run the corrected inspection once against that exact main commit and retain
   the sanitized seven-day artifact.
3. Apply only the pinned OrderItem ENABLE migration through its exact-main,
   exact-CI, accepted-inspection-bound Production workflow.
4. After ENABLE overlap is accepted, release `OrderItem` FORCE separately.
5. Repeat the smaller process for `OrderShippingRateQuote`; its source surface
   is four functions and no table triggers.

No authenticated browser smoke or full application test suite is required for
the catalog inspection. CI still runs once on the eventual source PR; the
table-specific PostgreSQL proof runs only when the ENABLE candidate exists.
