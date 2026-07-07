# Grainline DB Defense-In-Depth Plan

Last updated: 2026-07-07

This is the execution tracker for database-layer hardening. It complements
`docs/rls-feasibility-plan.md`, which remains the design source of truth for
RLS staging and table ordering.

## Objective

Reduce database blast radius without destabilizing launch-critical flows. The
near-term target is a least-privilege runtime database role, followed by a
staging-only RLS prototype on low-blast-radius direct-owner tables.

## Non-Goals

- Do not enable broad production RLS before launch.
- Do not enable RLS on `Order`, `Message`, `Conversation`, `Case`,
  `SellerProfile`, `Listing`, `BlogPost`, or `Review` until the runtime role,
  request context, bypass model, and rollback are proven.
- Do not treat RLS as a replacement for route/server-action authorization.
  App-layer ownership and visibility checks remain required.
- Do not point normal app traffic at the migration owner role once
  least-privilege staging is proven.

## Phase 0 - Baseline

Status: not started.

Required before any role or policy change:

- Confirm `main` CI is green.
- Preserve unstaged raw audit imports and local agent files.
- Confirm production/staging connection topology:
  - `DATABASE_URL` uses the Neon pooled endpoint.
  - `DIRECT_URL` uses the direct endpoint for migrations only.
  - Prisma runtime uses `@prisma/adapter-pg` and the app `pg` pool.
- Record current database roles:
  - table/schema owner;
  - runtime role currently used by `DATABASE_URL`;
  - migration role currently used by `DIRECT_URL`;
  - any Neon/Vercel preview/staging role differences.
- Decide staging target:
  - preferred: Neon branch or staging database with production-like pooler;
  - do not use only a local direct Postgres connection for the hard-gate proof.

Evidence to retain:

- CI run id.
- Staging database/branch name.
- Sanitized role names and privilege summary.
- Confirmation that no production credentials were changed.

## Phase 1 - Least-Privilege Runtime Role

Status: not started.

Purpose: reduce blast radius even before RLS. A leaked runtime connection or
future SQL injection should not own tables, bypass RLS, run migrations, or alter
schema.

Target roles:

- `grainline_migration_owner`
  - owns schema/tables;
  - used by `DIRECT_URL`;
  - runs migrations, restore drills, and controlled maintenance.
- `grainline_app_runtime`
  - used by `DATABASE_URL`;
  - does not own tables;
  - does not have `BYPASSRLS`;
  - has only app-required table, sequence, and function privileges.
- Optional future `grainline_service_bypass`
  - explicit maintenance/bypass role;
  - not used by normal app traffic;
  - only introduced after a concrete service-path need is proven.

Staging implementation checklist:

- Create the runtime role on staging.
- Grant minimum required privileges:
  - schema `USAGE`;
  - table `SELECT`, `INSERT`, `UPDATE`, `DELETE` where runtime paths need them;
  - sequence `USAGE`/`SELECT` where applicable;
  - `EXECUTE` on `grainline_*` functions used by constraints, defaults, or app
    queries.
- Explicitly verify the runtime role:
  - does not own application tables;
  - does not have `BYPASSRLS`;
  - cannot run DDL/migrations;
  - cannot alter RLS policies;
  - cannot drop tables, functions, or schemas.
- Point staging `DATABASE_URL` at the runtime role.
- Keep staging `DIRECT_URL` on the migration owner role.

Verification checklist:

- `npx prisma validate`
- `npx prisma generate`
- `npx prisma migrate status` through `DIRECT_URL`
- `npx tsc --noEmit`
- `npm run lint`
- `npm test`
- Production-like smoke tests against staging:
  - sign-up/sign-in/sign-out;
  - public browse/listing/seller pages;
  - notification reads and mark-read;
  - saved-search create/list/delete;
  - cart and checkout creation;
  - Stripe webhook order creation in test mode;
  - refunds and case resolution in test mode;
  - account export and account deletion;
  - cron routes, including retention/prune jobs;
  - upload presign/verify and cleanup;
  - admin PIN-gated routes;
  - email outbox enqueue/drain.

Rollback:

- Repoint staging `DATABASE_URL` to the previous known-good role.
- No schema rollback should be needed for least-privilege role testing.
- Do not promote role changes to production until staging verification is
  boring and repeatable.

## Phase 2 - Grant Hygiene Automation

Status: not started.

Purpose: prevent future migrations from silently breaking runtime traffic after
the app moves to a non-owner role.

Implementation goals:

- Add a grant-audit script or test that connects as an auditor/owner and checks
  that the runtime role has required privileges on:
  - all app tables;
  - all app sequences;
  - all `grainline_*` functions used by constraints/defaults/app queries.
- Fail if the runtime role:
  - owns app tables;
  - has `BYPASSRLS`;
  - lacks expected table/sequence/function privileges.
- Add migration authoring guidance:
  - new tables/sequences/functions require corresponding grants;
  - raw SQL migrations must include grant review;
  - local owner-role success is not enough.

Verification:

- Add focused tests for the grant audit.
- Run grant audit in CI only after a suitable CI role model exists, or keep it
  as a staging/manual check until CI can represent owner/runtime separation.

## Phase 3 - Request Context Proof

Status: not started.

Purpose: prove the core RLS mechanism under the actual runtime topology before
enabling policies.

Required helper contract:

- Open an explicit Prisma transaction.
- Run `set_config('app.user_id', $userId, true)` as the first statement inside
  the transaction.
- Use the transaction client for every protected query.
- Do not run parallel Prisma queries inside that interactive transaction.
- If combined with serializable retry, set context inside each retried
  transaction callback, not outside the retry loop.

Hard-gate tests:

- Runtime-role connection through pooled `DATABASE_URL`, not `DIRECT_URL`.
- `app.user_id` is available inside the transaction.
- `app.user_id` is gone after transaction completion.
- pooled connection reuse does not leak one user's context into the next query.
- unset `app.user_id` returns zero protected rows once RLS is enabled.
- explicitly empty `app.user_id` returns zero protected rows once RLS is enabled.
- serializable retry re-runs `set_config` on every retry attempt.
- route-level happy paths still return current-user rows.

Stop condition:

- If any context proof is flaky under the Neon pooler plus Prisma adapter/pool,
  stop RLS work and keep app-layer authorization plus least-privilege role as
  the active DB defense.

## Phase 4 - Notification RLS Prototype

Status: not started.

Purpose: protect user notification reads and mark-read updates while preserving
legitimate cross-user/system notification creation and cleanup.

Policy shape:

- `SELECT`: owner-scoped to `Notification.userId = app.user_id`.
- `UPDATE`: owner-scoped with both `USING` and `WITH CHECK` on
  `Notification.userId = app.user_id`.
- `INSERT`: do not naively owner-scope. Choose one explicit strategy:
  - permissive runtime insert, with app-layer authorization remaining the
    notification creation control; or
  - service/bypass helper used by every cross-user writer.
- `DELETE`: do not naively owner-scope. Account deletion and prune flows need a
  system cleanup design.
- Use `FORCE ROW LEVEL SECURITY` in staging prototype migrations to avoid
  owner-role false-green tests.

Read/update paths to inventory and wrap before enabling:

- `/api/notifications`
- `/api/notifications/read-all`
- `/api/notifications/[id]/read`
- dashboard notification page reads
- notification bell data sources
- account export notification reads

Writer/cleanup paths to inventory before choosing `INSERT`/`DELETE` policy:

- `createNotification()`;
- follow/favorite/listing/case/message/follower fanout paths;
- admin notification paths;
- Stripe webhook notification paths;
- cron/system notification paths;
- account-deletion notification cleanup;
- notification prune cron.

Regression tests:

- direct DB: user A cannot select user B notifications.
- direct DB: missing/empty context returns zero rows.
- route: user sees own notifications.
- route: user cannot mark another user's notification read.
- route: read-all only marks own notifications.
- fanout/webhook/cron notification creation still works under the chosen write
  strategy.
- cleanup/prune still works under the chosen delete strategy.
- if `INSERT` is ever tightened, `createNotification()` handles RLS `42501`
  deliberately instead of treating it like the current `P2002` dedup path.

Rollback:

- Disable RLS on `Notification`.
- Remove/widen only the prototype policies through a forward migration.
- Keep app-layer notification ownership predicates in place throughout.

## Phase 5 - SavedSearch RLS Prototype

Status: not started.

Purpose: validate a simpler direct-owner table after Notification proves the
context helper and role model.

Policy shape:

- `SELECT`: `SavedSearch.userId = app.user_id`.
- `INSERT`: `SavedSearch.userId = app.user_id`.
- `DELETE`: `SavedSearch.userId = app.user_id`.
- `UPDATE`: add only if a future route supports updates.

Implementation constraints:

- Saved-search cap checks must remain in the same transaction as insert.
- If serializable retry is used, context must be set inside each retry attempt.
- Forged `userId` must still be ignored/rejected by app-layer code.
- Account deletion deletes saved searches inside the anonymization transaction.
  That transaction must either set `app.user_id` to the target deleted user as
  its first statement or use an explicit cleanup bypass. Otherwise a
  user-scoped `DELETE` policy can silently leave saved-search query/location
  data behind during self-deletion, Clerk webhook deletion, or admin-triggered
  deletion.

Read/delete paths to inventory and wrap before enabling:

- `GET /api/search/saved` list reads.
- `DELETE /api/search/saved` deletes.
- Dashboard server-component saved-search reads.
- Dashboard `deleteSavedSearch` server action.
- Account export saved-search reads. These currently run in a broader export
  `Promise.all`, so the saved-search read should be wrapped individually or the
  export query shape must avoid parallel work inside a single RLS-context
  transaction.
- Account-deletion saved-search cleanup.

Regression tests:

- direct DB: user A cannot read/delete user B saved searches.
- route: list returns only own saved searches.
- route: create writes only current user's `userId`.
- route: delete cannot delete another user's row.
- dashboard: saved-search section still renders current-user rows.
- account export: saved-search rows still export for the current user.
- account deletion: saved-search cleanup removes the deleted user's rows under
  self-deletion and provider/admin deletion paths.
- cap behavior still works under context/retry.

## Phase 6 - Expansion Decision

Status: deferred.

Move beyond `Notification` and `SavedSearch` only when:

- least-privilege runtime role passes staging smoke;
- grant audit exists and is maintainable;
- context helper is proven under the production-like pooler;
- route-level happy-path tests exist for protected reads;
- rollback has been tested;
- CI is green;
- launch-critical legal/provider/runtime evidence is not being delayed.

Candidate next tables:

- `Cart`
- `CartItem`
- `Favorite`
- `SavedBlogPost`

### Cart + CartItem Parent-Join Notes

`Cart` is direct-owner (`Cart.userId`), but `CartItem` is owned only through
`CartItem.cartId -> Cart.userId`. This is the first parent-join RLS design and
must get a separate review before implementation.

Policy shape:

- `Cart`: owner-scoped to `Cart.userId = app.user_id`.
- `CartItem`: parent-join scoped through the owning cart, for example
  `EXISTS (SELECT 1 FROM "Cart" WHERE "Cart".id = "CartItem"."cartId" AND
  "Cart"."userId" = app.user_id)`.
- Enable `Cart` and `CartItem` policies together in staging so half-enabled
  behavior does not hide context or parent-policy mistakes.
- Do not copy the parent-join pattern onto unbounded hot tables without a
  separate query-plan review. Cart item counts are already bounded, which keeps
  this prototype lower risk.

System/cross-user paths that need explicit context or bypass:

- Stripe webhook cart finalization directly deletes purchased `CartItem` rows
  after order creation. Missing buyer context or bypass would leave paid items
  in the buyer's cart and can create duplicate checkout confusion.
- Admin listing removal deletes `CartItem` rows for the removed listing across
  all users' carts. This cannot use ordinary owner context.
- Seller/listing soft-delete cleanup deletes `CartItem` rows for the listing
  across all users' carts. This needs an explicit service/admin cleanup design.
- Checkout stock restoration can read `CartItem` rows from session metadata
  during webhook/expiry repair. Missing context or bypass can under-restore
  reserved stock.
- Account deletion deletes the user's `Cart`; `CartItem` cleanup relies on the
  `onDelete: Cascade` relation. Test the cascade with both `Cart` and
  `CartItem` RLS enabled instead of assuming Postgres referential actions behave
  as desired under the final policies.

Read/write paths to inventory and wrap before enabling:

- `GET /api/cart`
- `POST /api/cart/add`
- `POST /api/cart/update`
- shipping quote cart reads
- cart checkout/resume reads
- Stripe webhook cart reads and finalization deletes
- account export cart reads
- account deletion cart cleanup
- admin/listing cleanup paths

Regression tests:

- direct DB: user A cannot read or mutate user B's cart or cart items.
- route: cart read/add/update still works for the current user.
- route: shipping quote still sees the current user's cart.
- webhook: paid cart items are cleared after order creation.
- webhook/expiry repair: stock restoration still finds restorable cart items.
- admin/listing cleanup removes a listing from all relevant carts through the
  chosen bypass/service path.
- account deletion: deleting a cart under target-user context cascades cart
  item deletion with both `Cart` and `CartItem` RLS enabled.

High-risk tables requiring separate design and likely second review:

- `Conversation`
- `Message`
- `Order`
- `OrderItem`
- `OrderPaymentEvent`
- `OrderShippingRateQuote`
- `Case`
- `CaseMessage`
- `SellerProfile`
- `Listing`
- `AdminAuditLog`

## Production Promotion Gate

Do not promote runtime role changes or RLS policies to production unless all are
true:

- staging uses the same connection topology as production;
- direct DB denial tests pass through the runtime role;
- route happy-path tests pass;
- cron, webhook, admin, account deletion, refund, and retention paths pass;
- rollback has been executed successfully on staging;
- security evidence and launch checklist work is not blocked by the rollout;
- latest `main` CI is green.

## Current Recommendation

Start with Phase 0 and Phase 1 only. Treat least-privilege runtime role
validation as the immediate high-return work. Treat RLS as a staging prototype
until the request-context and grant-hygiene gates are proven.
