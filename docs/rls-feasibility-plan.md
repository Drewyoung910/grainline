# Grainline RLS Feasibility Plan

Last updated: 2026-07-06

Grainline does not currently use PostgreSQL Row Level Security. The production control plane is application-layer authorization through Clerk middleware, route handlers, server actions, shared visibility helpers, and ownership predicates. RLS is still worth evaluating as defense in depth, but it must be staged. A broad RLS rollout with Prisma and pooled Neon connections can break legitimate traffic or create false confidence if runtime roles still own tables or bypass policies.

Execution tracking for the least-privilege runtime role, grant audit, request
context proof, and first table prototypes lives in
`docs/db-defense-in-depth-plan.md`.

## Decision

Do not enable RLS directly on production tables before launch. First build and test a staging prototype on low-blast-radius tables, then expand only after request context, role separation, admin/cron/webhook bypasses, and rollback are proven.

## Required Architecture

- **Migration owner role**: owns tables and runs migrations. Not used by the web runtime.
- **Runtime app role**: used by Prisma in normal web requests. Must not own tables and must not have `BYPASSRLS`.
- **Bypass/service role**: explicit, narrowly held role for migrations, controlled admin maintenance, and emergency repair. Do not use it for normal app traffic.
- **Request context**: every RLS-protected query must run inside a transaction that sets `app.user_id` with `set_config('app.user_id', $userId, true)`. The `true` flag is required so context is transaction-local and does not leak through the pool.
- **Staff context**: staff/admin access needs either explicit `app.role` transaction context or separate audited bypass helpers. Do not silently grant all employees broad RLS bypass in normal user flows.
- **Provider context**: webhooks, cron jobs, and provider callbacks need explicit service-path decisions; do not make them rely on arbitrary end-user context.
- **Grant hygiene**: every future migration that creates tables, sequences, or
  `grainline_*` functions must grant the runtime role the minimum required
  table/sequence privileges and `EXECUTE` on functions that constraints,
  defaults, or app queries invoke. Add a CI grant-audit before swapping
  production runtime credentials to a non-owner role.
- **Forced policy proof**: prototype migrations should use `FORCE ROW LEVEL
  SECURITY` in staging so owner-role local tests cannot accidentally bypass
  policies and give false confidence. Production use of `FORCE` still requires a
  rollback plan and verified migration/service-role behavior.

## Hard Gates

- Prove request context isolation against the actual production-like connection
  topology: Prisma with `@prisma/adapter-pg`, the app `pg` pool, and the Neon
  pooled `DATABASE_URL`. A direct `DIRECT_URL` test is not sufficient.
- Prove both unset `app.user_id` and explicitly empty `app.user_id` return zero
  protected rows.
- Prove transaction-local context does not leak after `prisma.$transaction`
  completes or after the pool reuses a connection for another user.
- If a protected query runs under a serializable retry helper, set
  `app.user_id` as the first statement inside each retried transaction callback.
  Do not set context once outside a retry loop.
- Do not run parallel Prisma queries inside an interactive transaction used for
  RLS context. Queries that currently use `Promise.all` must be serialized or
  redesigned when wrapped in the context helper.
- Stop the RLS rollout if any of these proofs are flaky under the pooler.

## Prototype Sequence

1. **Notification**: owner column is direct (`Notification.userId`) for user
   reads and mark-read updates, but notification creation/deletion is not
   owner-symmetric. Prototype user-scoped `SELECT`/`UPDATE` first, while
   explicitly designing service/cross-user `INSERT` and cleanup `DELETE`.
2. **SavedSearch**: owner column is direct (`SavedSearch.userId`). Prototype `SELECT`/`INSERT`/`DELETE` policies for the current user.
3. **Cart + CartItem**: `Cart.userId` is direct; `CartItem` depends on the parent cart. This tests parent-join policies.
4. **SavedBlogPost**: direct owner row, similar to SavedSearch. Prototype after
   Cart once account-deletion cleanup and account-export reads are wrapped.
5. **Favorite + Follow + Block**: do not group these with simple owner tables.
   Favorite and Follow have public aggregate/fanout semantics, and Block is
   bidirectional. They need separate product/read-design work before any RLS
   prototype.
6. **Conversation + Message**: participant policies (`userAId`/`userBId`) and staff-reported-thread exceptions. Requires careful staff bypass design.
7. **Order + OrderItem + OrderPaymentEvent + OrderShippingRateQuote**: buyer access plus seller access through listing ownership. Higher risk because checkout, refunds, labels, tax records, and support all depend on these rows.
8. **Case + CaseMessage**: buyer/seller participant access plus staff/admin case handling. High risk; do after messages and orders.

## Candidate Table Matrix

| Table | Current app-layer owner model | RLS difficulty | Prototype decision |
|---|---|---:|---|
| `Notification` | `userId` | Low | First prototype |
| `SavedSearch` | `userId` | Low | Second prototype |
| `Cart` | `userId` | Low | After direct-owner prototype |
| `CartItem` | Parent `Cart.userId` | Medium | Requires parent policy test |
| `Favorite` | `userId`; public listing favorite counts and ranking use cross-user aggregates | High | Defer until public aggregate/count design exists |
| `SavedBlogPost` | `userId` | Low | Candidate after cart |
| `Follow` | `followerId`; public follower counts and follower fanout read cross-user rows | High | Defer until public count/fanout design exists |
| `Block` | `blockerId` for writes; reads need `blockerId = me OR blockedId = me` | Medium | Bidirectional policy plus system fanout bypass required |
| `Conversation` | `userAId` or `userBId`; staff-reported-thread exception | High | Design after prototype |
| `Message` | Parent conversation participant; sender/recipient checks | High | Design after conversation |
| `Order` | `buyerId` or seller owns an order item listing | High | Do not prototype first |
| `OrderItem` | Parent order buyer or listing seller owner | High | Do not prototype first |
| `OrderPaymentEvent` | Parent order buyer/seller; staff/admin | High | Do not prototype first |
| `OrderShippingRateQuote` | Parent order buyer/seller; seller label flow | High | Do not prototype first |
| `Case` | `buyerId` or `sellerId`; staff/admin | High | Do not prototype first |
| `CaseMessage` | Parent case participant; staff/admin | High | Do not prototype first |
| `UserReport` | `reporterId`/`reportedId`; admin resolution | High | Admin workflow design first |
| `AdminAuditLog` | Admin-only | High | Do not RLS until admin bypass model is mature |

## Required Tests Before Any RLS Migration

- A direct database test connects through the runtime-role `DATABASE_URL`, not
  the migration owner, and proves the runtime role cannot read another user's
  protected row without `app.user_id`.
- A direct database test proves `set_config(..., true)` is transaction-local and does not leak to the next query/pooled connection.
- App route tests keep passing with the RLS helper wrapper enabled.
- Admin/cron/webhook tests prove their bypass path is explicit and audited.
- Rollback test proves RLS can be disabled or policy changes reverted quickly without data loss.
- A grant-audit test proves the runtime role has required privileges for every
  table, sequence, and `grainline_*` function used by the app, and no ownership
  or `BYPASSRLS`.
- Route-level happy-path tests prove protected reads still return the current
  user's rows. DB-denial tests alone are insufficient because missing context
  wrappers can fail closed silently.

## Notification Prototype Edge Cases

`Notification` is the first prototype table, but it is not a simple
`userId = app.user_id` table for every verb.

- `createNotification()` writes rows for recipients, not necessarily for the
  actor. It is called from follow/favorite/case/message/follower-fanout flows,
  admin flows, Stripe webhooks, and cron/system paths.
- A naive `INSERT WITH CHECK (userId = current_setting('app.user_id', true))`
  would block legitimate cross-user and zero-user-context notification creation
  and can turn notification fanout into 500s.
- Notification cleanup also includes cross-user/system deletes, including
  account-deletion sensitive-text cleanup and notification pruning.
- The first `Notification` policy design should therefore protect user reads and
  mark-read updates with owner-scoped `SELECT`/`UPDATE`, while choosing one of
  these explicit write strategies:
  - permissive runtime `INSERT`/system `DELETE` policies, with app-layer
    authorization remaining the control for notification creation and cleanup;
  - or a dedicated service/bypass helper used by every cross-user writer and
    cleanup path.
- The owner-scoped `UPDATE` policy must include both `USING` and `WITH CHECK`
  predicates on `userId = app.user_id`; `USING` controls which rows can be
  updated, while `WITH CHECK` prevents a buggy update from reassigning a
  notification to another user.
- If the prototype starts with permissive runtime `INSERT`, do not later tighten
  `INSERT` to owner-scoped without also auditing `createNotification()` error
  handling. RLS-denied inserts raise a permission error (`42501`), not the
  `P2002` unique-conflict path that notification dedup currently treats as
  non-fatal.
- Before enabling the policy, inventory and wrap all notification read/update
  paths, including `/api/notifications`, `/api/notifications/read-all`,
  `/api/notifications/[id]/read`, dashboard notification pages, notification
  bell data sources, and account export reads.
- Existing read paths that use parallel `findMany`/`count` queries must be
  serialized or otherwise adapted inside the transaction-local context helper.

## SavedSearch Prototype Edge Cases

`SavedSearch` is closer to a direct-owner table, but its cap and writes still
need retry/context discipline.

- `SELECT`, `INSERT`, and `DELETE` can be owner-scoped to `app.user_id`.
- The saved-search cap must continue to run in the same transaction as the
  insert.
- If serializable retry is used, the RLS context must be set inside each retry
  transaction before count/read/write work.
- Saved-search reads are not only in API routes. The dashboard server component
  and account export also read saved searches and must be wrapped or redesigned
  before RLS is enabled.
- Account deletion deletes saved searches as privacy cleanup. That transaction
  must set target-user context or use an explicit cleanup bypass, or a
  user-scoped `DELETE` policy can silently leave saved-search query/location
  data behind.

## Cart + CartItem Prototype Edge Cases

`Cart` is direct-owner, but `CartItem` is owned through its parent cart. This is
the first parent-join policy and must be reviewed separately before
implementation.

- `CartItem` policies need a parent `Cart.userId = app.user_id` predicate; the
  table has no direct `userId`.
- Enable `Cart` and `CartItem` policies together in staging, and test the
  parent-join policy with the final `Cart` policy enabled.
- Stripe webhook cart finalization directly deletes paid cart items. Missing
  buyer context or bypass would leave already-purchased items in the cart after
  payment.
- Admin listing removal and seller/listing soft-delete cleanup remove a listing
  from all users' carts and need an explicit service/admin cleanup path.
- Checkout stock restoration can read cart items from webhook/session metadata
  and needs context or bypass so reserved stock repair does not silently
  under-restore.
- Account deletion deletes `Cart` and relies on cascading `CartItem` deletion.
  Test the cascade with both policies enabled instead of assuming the RLS
  interaction.

## Favorite, Follow, And Block Edge Cases

Do not treat these as ordinary `userId = app.user_id` tables.

- `Favorite` has private owner reads, such as saved-items pages, but public and
  seller-facing aggregate reads count all users' favorites for listings.
  Browse ranking, seller dashboards, seller analytics, homepage/top-saved
  surfaces, and quality-score style metrics can all depend on cross-user
  favorite counts. Owner-only `SELECT` RLS would silently zero or skew those
  counts unless favorite counts are first denormalized into separate maintained
  counters or served through an explicit aggregate/bypass design.
- `Follow` has private owner reads, but public follower counts are intentional
  product state and follower fanout reads all followers of a seller for listing
  and blog notifications. Owner-only `SELECT` RLS would collapse follower counts
  to at most the current viewer and break fanout unless counts/fanout move to a
  deliberate aggregate/service path.
- `Block` is bidirectional by design. Current block filtering needs rows where
  `blockerId = app.user_id` and rows where `blockedId = app.user_id`. An
  owner-only `blockerId` policy would let a user miss rows created by someone
  who blocked them and can become a content-safety regression. A future policy
  needs bidirectional reads plus explicit system/service bypass for fanout paths
  that exclude reciprocal blocks without an end-user context.
- `SavedBlogPost` should remain separate from these tables. It is the cleaner
  direct-owner candidate after SavedSearch/Cart, subject to the same account
  export and account-deletion cleanup caveats as other owner tables.

## Non-Goals For Launch

- Do not enable RLS on public discovery tables (`Listing`, `SellerProfile`, `BlogPost`, `Review`) before a separate public/private visibility design. Those tables intentionally mix public marketplace reads with owner/staff/private states.
- Do not use RLS as a replacement for route/action ownership checks. App-layer authorization remains required because RLS cannot express all product-state rules cleanly.
- Do not use the migration/table-owner role for normal Prisma runtime queries. Table owners can bypass RLS unless `FORCE ROW LEVEL SECURITY` is used, which has its own migration and operational risks.
