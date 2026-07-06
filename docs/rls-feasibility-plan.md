# Grainline RLS Feasibility Plan

Last updated: 2026-07-06

Grainline does not currently use PostgreSQL Row Level Security. The production control plane is application-layer authorization through Clerk middleware, route handlers, server actions, shared visibility helpers, and ownership predicates. RLS is still worth evaluating as defense in depth, but it must be staged. A broad RLS rollout with Prisma and pooled Neon connections can break legitimate traffic or create false confidence if runtime roles still own tables or bypass policies.

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
4. **Favorite + SavedBlogPost + Follow + Block**: direct owner rows, but reads may have product semantics beyond the owner. Document per-table read/write behavior before enabling.
5. **Conversation + Message**: participant policies (`userAId`/`userBId`) and staff-reported-thread exceptions. Requires careful staff bypass design.
6. **Order + OrderItem + OrderPaymentEvent + OrderShippingRateQuote**: buyer access plus seller access through listing ownership. Higher risk because checkout, refunds, labels, tax records, and support all depend on these rows.
7. **Case + CaseMessage**: buyer/seller participant access plus staff/admin case handling. High risk; do after messages and orders.

## Candidate Table Matrix

| Table | Current app-layer owner model | RLS difficulty | Prototype decision |
|---|---|---:|---|
| `Notification` | `userId` | Low | First prototype |
| `SavedSearch` | `userId` | Low | Second prototype |
| `Cart` | `userId` | Low | After direct-owner prototype |
| `CartItem` | Parent `Cart.userId` | Medium | Requires parent policy test |
| `Favorite` | `userId` | Low | Candidate after cart |
| `SavedBlogPost` | `userId` | Low | Candidate after cart |
| `Follow` | `followerId`; public follower counts remain app-layer | Medium | Write-policy candidate; public reads need design |
| `Block` | `blockerId` for writes; both users may need reads | Medium | Requires product semantics |
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

## Non-Goals For Launch

- Do not enable RLS on public discovery tables (`Listing`, `SellerProfile`, `BlogPost`, `Review`) before a separate public/private visibility design. Those tables intentionally mix public marketplace reads with owner/staff/private states.
- Do not use RLS as a replacement for route/action ownership checks. App-layer authorization remains required because RLS cannot express all product-state rules cleanly.
- Do not use the migration/table-owner role for normal Prisma runtime queries. Table owners can bypass RLS unless `FORCE ROW LEVEL SECURITY` is used, which has its own migration and operational risks.
