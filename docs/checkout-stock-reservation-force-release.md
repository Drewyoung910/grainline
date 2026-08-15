# CheckoutStockReservation FORCE RLS release

Status: isolated, production-inert release candidate in draft PR #221 at exact
head `a0eadb74707652e3883bde36d9c44be3a430a737`; exact-head GitHub CI run
`31907436947` passed all 133 steps. Production remains at
accepted policyless Phase A from exact main
`405d6dff327bee76aced17f3876f8f18f29e05db`, CI `31894742120`, guarded
migration run `31903152300`, and pooled-runtime evidence SHA-256
`899679a14590200880e89d983fff70492632de458649316bd69cde9a0027ece0`.
This FORCE candidate has not been merged, dispatched or applied. Its exact
guarded workflow wiring is separately prepared in isolation and documented in
`docs/checkout-stock-reservation-force-production-wiring.md`.

Date: 2026-08-15

## Exact release unit

- Migration: `20260815060001_force_checkout_stock_reservation_rls`
- Reviewed FORCE draft SHA-256:
  `5f518087eeaa30c1580cb7522b8d61a6cecf263e4d5dc8c574492a7d8499b0cf`
- Promoted migration SHA-256:
  `cfa05295bd469903aa967919a0178312dbbc855203c408db2395602589f5178d`
- Reviewed rollback SHA-256:
  `e9de52772050a2e12d5d24294722ea5c76c9718d3bd13099e811bda02ed764ef`
- Complete migration-tree SHA-256:
  `75971d49d54b46759851be1f39353fee5132465ce8da59a8b3251a267216aa86`
- Guard phase: `checkout-stock-reservation-force-reviewed`

The transaction changes only `relforcerowsecurity` on
`public."CheckoutStockReservation"`. It changes no row, policy, grant,
function, constraint, index, trigger, application code, deployment or provider
state. The rollback changes only FORCE back to NO FORCE while preserving the
accepted policyless ENABLE and fixed-function authority boundary.

## Why FORCE remains useful

The current table owner is the reviewed `neondb_owner` migration role, which
has `BYPASSRLS`; FORCE does not subject that role to RLS. The present runtime
boundary therefore remains the zero direct table/column grants plus the exact
16-runtime/9-private fixed-function partition.

FORCE is a durable ownership-drift invariant. If a later migration transfers
the table to a non-BYPASS owner, ownership alone cannot silently bypass the
policyless service boundary. With zero policies that drift fails closed, which
may stop service operations until ownership is repaired; that availability
tradeoff is intentional and must remain explicit.

## Fail-closed predecessor

The candidate takes the same advisory lock as Phase A and an ACCESS EXCLUSIVE
table lock. It refuses to proceed unless all of the following remain exact:

- current session owns the table and is the reviewed production owner or
  disposable CI owner;
- the owner-session drain is empty;
- `grainline_app_runtime` remains LOGIN, NOINHERIT, non-privileged and
  NOBYPASSRLS with only Neon's proven non-effective bootstrap edge;
- the table is policyless ENABLE/NO-FORCE with zero ordinary-runtime/PUBLIC
  table or column authority;
- all 25 functions retain exact signatures, language, security mode,
  volatility, parallel safety, pinned search path, source MD5 and ACLs;
- exactly 16 reviewed functions are runtime-executable, nine are private, and
  the 13 direct table-touching runtime functions have not expanded; and
- no expected function uses dynamic `EXECUTE` or `FORMAT(...)` SQL.

The postflight requires policyless ENABLE plus FORCE with the same zero direct
authority. Any drift rolls the transaction back.

The first disposable-PostgreSQL run rejected the draft because a name-only
runtime count also included a legitimate older
`grainline_stripe_webhook_begin` overload. The final release counts the 16
runtime functions by exact `(name, argument types)` identity. Regression
coverage retains the older overload and proves FORCE succeeds, then separately
renames one reviewed function and proves the preflight fails without partially
setting FORCE.

## Disposable proof sequence

CI verifies and isolates FORCE before replaying the sealed predecessor tree.
It applies and proves authority, source consistency and Phase A first. Only
then does it restore and apply FORCE, run migration status and the global
grant/RLS audit, and connect through the actual disposable
`grainline_app_runtime` login inside an engine-attested repeatable-read,
read-only transaction. That proof requires direct-table denial, fixed export
success, private-helper denial and the fixed-write read-only fence behind
FORCE. A separate owner proof runs the reviewed NO-FORCE rollback and always
restores and re-verifies FORCE in `finally`.

## Remaining production boundary

The separate restart-safe production scope and guarded main-only wiring are
now prepared but remain unmerged and undispatched. They still require review,
merge sequencing after this release, exact-main CI and a separate production
dispatch decision. After any successful application, review and run the actual
pooled-runtime FORCE postflight. Nothing in this candidate authorizes a merge,
workflow dispatch, migration, deployment, cleanup, credential change or
provider mutation.
