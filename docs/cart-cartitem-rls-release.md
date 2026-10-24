# Cart and CartItem RLS release

Status: active in Production. Migration
`20261023080000_activate_cart_cart_item_rls` was applied by protected run
`40098629729`; restart-safe closeout run `40106017717` verified the active
posture and changed no production state.

The private pre-RLS audit covers every application, database, checkout,
webhook, deletion, listing-cleanup and stock-restoration path. It stays outside
the public repository while the repository is public. This document records
the safe architecture and release contract without publishing the private
finding inventory.

## Authority model

- `Cart` is owned directly through `userId`.
- `CartItem` is owned through its parent `Cart`.
- Every ordinary owner query runs in a short transaction with the
  server-resolved local user id in transaction-local `app.user_id`.
- The runtime role retains owner-scoped SELECT, INSERT and DELETE.
- Whole-table UPDATE is revoked. The runtime may update only
  `Cart.updatedAt` and `CartItem.quantity`, `priceCents`, `priceVersion`, and
  `selectedVariantOptionIds`.
- Checkout, Stripe completion, shipping and analytics continue through their
  existing reviewed security-definer functions.
- Admin listing removal and seller-owned listing deletion call separate,
  actor-checked cleanup functions. There is no cross-user Cart policy.
- Checkout stock recovery uses durable `CheckoutStockReservation` state. It
  does not reconstruct reservations from mutable CartItem rows.

Migration `20261023080000_activate_cart_cart_item_rls` applies validated bounds
for quantity, price, price version and variant arrays, creates eight owner
policies, narrows grants, and enables and forces RLS on both tables in one
transaction. It does not drop a table or column.

## Accepted evidence

The release evidence retains all of the following:

1. A full PostgreSQL 16 build from migration one through the activation.
2. A failing-first predecessor proof showing that the runtime could read and
   update another user's cart before activation.
3. Owner isolation for reads, inserts, updates and deletes after activation.
4. Denial of forged ownership and immutable-column updates.
5. Constraint enforcement for quantity, price, version and variant arrays.
6. Exact admin and seller listing-cleanup authority, including employee and
   non-owner denial.
7. Serialization evidence that a Cart row lock blocks a concurrent owner
   update until release.
8. CartItem cascade behavior for Cart and account deletion.
9. Runtime-role provisioning replay with the narrow grants preserved.
10. Production-inspector ready and active states with no row data in evidence.
11. An executed FORCE-only rollback that retains ENABLE, policies, constraints,
    functions and narrow grants.

The full-chain test is the behavior proof. Source-text tests only seal the
reviewed migration, workflow and rollback artifacts.

## Protected production sequence

The application code must deploy before the database activation. After the
candidate is based on current main and all earlier pending migrations have
been applied:

1. Merge the reviewed exact head only after CI passes.
2. Wait for every required exact-main push workflow to pass.
3. Deploy that exact main commit or a reviewed descendant and verify its live
   release marker.
4. Run `owner-table-rls-activation-production.yml` with release id
   `cart_cart_item_v1`, the exact main commit, its CI run, the compatible live
   app commit and deployment id, and confirmation
   `activate-reviewed-owner-table-rls`.
5. The workflow must report this migration as the sole pending migration,
   inspect the predecessor, apply it once, read back policies, grants,
   functions, constraints and aggregate-only inventory, verify no migration
   remains pending, and run the global grant audit.

The shared `production-database-migrations` concurrency group serializes this
operation with every other protected database release.

## Production completion

- Exact main: `49842ba29f16a55fd4712080bdb0c8d8015a8eb7`.
- Exact-main CI: run `40103340938`, all 775 steps passed.
- Compatible application commit:
  `af1ee330f661c4604bf939085b175d00060d2dd0`.
- Compatible deployment: `dpl_GikXkpiK6ZoM2r4Zqz3PiCTDfQL6`.
- Restart-safe protected run: `40106017717`; the migration apply step was
  skipped because the migration was already active, all preflight and
  postflight checks passed, no migrations remained pending, the global grant
  audit passed, and `productionChanged` was `false`.
- Cart keeps table-level SELECT, INSERT and DELETE plus column-level UPDATE on
  `updatedAt` only. CartItem keeps table-level SELECT, INSERT and DELETE plus
  column-level UPDATE on `quantity`, `priceCents`, `priceVersion`, and
  `selectedVariantOptionIds` only.

## Recovery

The reviewed emergency rollback is
`docs/rls-drafts/cart-cartitem-activation-rollback.sql`. It first verifies the
exact active posture, then applies `NO FORCE ROW LEVEL SECURITY` to both tables.
It does not disable RLS, broaden grants, remove policies, drop constraints, or
remove service functions. Application rollback must follow only after the
database posture permits the predecessor code.
