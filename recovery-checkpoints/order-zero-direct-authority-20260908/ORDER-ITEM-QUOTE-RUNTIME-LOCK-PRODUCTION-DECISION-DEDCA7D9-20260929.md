# Order item and shipping-quote runtime lock — Production decision

Date: 2026-09-29

This sanitized packet prepares one exact Production decision. It contains no
credential, database URL, session value, row data, or synthetic fixture value.
It is not authorization to dispatch the workflow.

## Current accepted posture

- Core `Order` RLS is enabled with zero policies and no ordinary-runtime direct
  table or column authority.
- Core `Order` FORCE remains disabled.
- `OrderItem` and `OrderShippingRateQuote` remain outside this Core `Order`
  posture change. The pending migration removes only their unused PUBLIC and
  `grainline_app_runtime` table/column authority.

## Exact source binding

- Merged main commit:
  `dedca7d9fd7b7f7c64587af688c922d11ae44192`
- Merged PR #477 head/base:
  `ae4f332ba93758d21c2e75fd5824bf4dfc7b067b` /
  `19e0cece5a72d86df2b22c739f70bb6fb36d1656`
- Exact-head PR CI:
  `36636202493` — passed, along with all three specialized checks
- Required merged-main push CI:
  `36638383343` — completed successfully at `2026-09-29T22:45:07Z`
- Migration:
  `20260929130000_revoke_order_item_shipping_quote_runtime_access`
- Migration SHA-256:
  `32c085b262400201864e6bfb7d32829b886b99a48771f62da141352c1c8bab99`
- Production workflow:
  `.github/workflows/order-item-quote-runtime-lock-production.yml`
- Required confirmation:
  `revoke-reviewed-order-item-quote-runtime-access`

The merge commit and reviewed PR head have the identical tree
`a64ceb9897abb341a0bba96af1285d0ea89d8096`.

## Exact live-deployment binding

- Deployment:
  `dpl_FpD59NTBtkRj4v1KP5yEjMRdvNdj`
- Vercel CLI resolved `thegrainline.com` to that READY Production deployment.
- A final read-only surface proof passed from `2026-09-29T22:45:56Z` through
  `2026-09-29T22:46:00Z`: both public
  aliases returned HTTP 200 with the exact deployment marker, both protected
  aliases retained their exact Vercel SSO redirect, `www` retained its HTTP 308
  canonical redirect, and `/api/health` returned HTTP 200 with `{ ok: true }`.

The deployment identity must be re-read immediately before dispatch because it
is time-sensitive.

## Exact Production effect

The 12-line migration executes one transaction containing:

```sql
REVOKE ALL ON TABLE
  public."OrderItem",
  public."OrderShippingRateQuote"
FROM PUBLIC, grainline_app_runtime;
```

It does not deploy application code, move aliases, rotate credentials, change
Core `Order` RLS/FORCE, enable RLS on either child table, add a policy, change a
function, or apply the prepared Core `Order` FORCE migration.

## Fail-closed boundaries

The protected workflow:

1. requires `main`, a first workflow attempt, the exact typed confirmation,
   and the GitHub `Production` environment;
2. binds the dispatch to the exact current main commit, a completed successful
   `CI` push run for that commit, and an exact live Vercel deployment id;
3. verifies the exact migration checksum and that it is the latest migration;
4. verifies the owner connection boundary and every predecessor ledger row;
5. rejects any unrelated pending migration;
6. records the pre-change grants, Core/child RLS posture, unrelated grants, and
   every `grainline_order_%` function definition;
7. applies only the reviewed migration through Prisma;
8. requires an exact completed ledger row, no PUBLIC/runtime table or column
   grants on either target, and byte-for-byte unchanged unrelated grants,
   function definitions, and RLS posture.

The workflow is restart-safe: an exact already-applied ledger row is accepted
only when the checksum and postflight match. Drift fails before or after the
write. Restoration of removed direct CRUD grants, if ever required, is a
separate owner-level Production action and is not bundled into this approval.

## Approval frontier

The source and deployment gates are satisfied: merged-main CI run
`36638383343` completed successfully, public main still equals
`dedca7d9fd7b7f7c64587af688c922d11ae44192`, and the final live deployment
readback still equals `dpl_FpD59NTBtkRj4v1KP5yEjMRdvNdj`. Dispatch still
requires the exact user approval below.

Once those conditions hold, the exact approval request is:

> Approve dispatching `order-item-quote-runtime-lock-production.yml` on exact
> main `dedca7d9fd7b7f7c64587af688c922d11ae44192`, bound to successful push CI
> run `36638383343`, exact live deployment
> `dpl_FpD59NTBtkRj4v1KP5yEjMRdvNdj`, migration
> `20260929130000_revoke_order_item_shipping_quote_runtime_access`, checksum
> `32c085b262400201864e6bfb7d32829b886b99a48771f62da141352c1c8bab99`, and
> confirmation `revoke-reviewed-order-item-quote-runtime-access`. Apply no
> other migration and do not enable Core Order FORCE.
