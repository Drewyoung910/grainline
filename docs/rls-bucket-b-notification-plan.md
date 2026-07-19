# Bucket B: Notification RLS Plan

Status: B0 source-lifecycle consolidation in progress. No Notification RLS
migration or production activation is authorized yet. Production work remains
blocked on SavedSearch Phase B and the runtime database credential-separation
postflight.

First B0 slice: source metadata is now a paired typed contract with a canonical
allowlist. New blog-comment notifications identify `blog_comment` plus the
comment id. Staff blog-comment and seller-broadcast deletion prefers exact
source cleanup while retaining a deliberately null-source-only fallback for
legacy rows. The fallback must be removed after legacy rows are backfilled or
expired; it is not an acceptable shape for the eventual owner RPC.

Recipient-path slice: every centralized owner read/count/export/mark-read and
low-stock dedup lookup now enters `withDbUserContext` inside
`notificationOwnerAccess.ts`; that module no longer accepts a default global
Prisma client. The notifications page performs its count, unread count, page
clamp, and row fetch sequentially in one branded transaction. This code must
not be promoted until the two fresh provider performance passes succeed.

## Scope Boundary

Bucket B means `Notification` only. It does not include `StockNotification`,
`EmailOutbox`, `Conversation`, `Message`, `Order`, payment/shipping records,
`Case`, or `CaseMessage`. Those retain separate coverage-matrix groups and
production releases.

The 2026-07-19 source snapshot contains 51 `createNotification({...})`
invocations across 28 caller files, plus the implementation in
`src/lib/notifications.ts`. This broad fanout surface is the main reason the
table cannot receive a copied SavedSearch owner-only policy.

## Actor And Operation Inventory

| Actor/path | Operations | Required behavior under RLS |
|---|---|---|
| Authenticated recipient | Count/list/export own rows; mark own row(s) read; mark own conversation notifications read | Set transaction-local `app.user_id`; `SELECT` and `UPDATE` only where `userId` matches; update only the `read` column and never transfer ownership |
| Application notification service | Read recipient preference/status, insert for any legitimate recipient, recover the existing row after a dedup collision | One reviewed cross-user creation RPC; no direct runtime `INSERT`; validate active recipient, preference, enum/payload bounds, source metadata, and dedup inside the database operation |
| Retention cron | Delete old read and unread rows globally in bounded batches | Parameter-free or tightly bounded owner RPC using server time and code-pinned retention windows; no general runtime `DELETE` |
| Account deletion | Delete the departing user's rows; delete source/link residue across other recipients; find and redact legacy sensitive text across other recipients | Own-row deletion can use owner context. Cross-recipient cleanup needs narrow source-scoped service functions and a reviewed legacy-redaction design; it is a blocking prerequisite, not an exception to disable RLS |
| Staff blog/broadcast deletion | Delete notifications tied to a deleted comment or broadcast across recipients | Use exact `sourceType`/`sourceId` service cleanup; remove legacy title/body/link matching after source coverage/backfill is proven |
| Admin, webhook, cron, order/case/message/social flows | Create recipient notifications through the shared helper | All 51 callsites stay behind one service helper; none receive owner credentials or direct table insert grants |

Current direct-access files are deliberately pinned by test:

- `src/lib/notificationOwnerAccess.ts` — owner reads/counts and mark-read updates.
- `src/lib/notifications.ts` — service create and dedup recovery lookup.
- `src/lib/accountDeletion.ts` — own/cross-user delete, legacy raw reads, and redaction updates.
- `src/app/admin/blog/page.tsx` and
  `src/app/admin/broadcasts/page.tsx` — cross-recipient cleanup.
- `src/app/api/cron/notification-prune/route.ts` — global raw retention delete.

## Chosen Database Shape

1. Keep application authorization primary. RLS is defense in depth.
2. Add recipient policies for `SELECT` and `UPDATE` with both `USING` and
   `WITH CHECK` on exact `userId = current_setting('app.user_id', true)`.
3. Grant the runtime role table `SELECT` and column-level `UPDATE (read)` only.
   Do not grant direct `INSERT` or `DELETE`. RLS cannot by itself prevent an
   owner from changing protected columns, so the column grant is mandatory.
4. Wrap multi-query owner surfaces with `withDbUserContext`; the context must
   be the server-resolved local user id and the protected queries must stay on
   the branded transaction client. Keep the restored generic provider
   wrapper/performance thresholds blocking and pass them before activation.
5. Implement notification creation as a narrowly reviewed owner-backed RPC.
   It must be the sole cross-user insert path and must keep recipient status,
   preferences, payload bounds, source metadata, and durable dedup behavior.
6. This RPC is application-asserted service authority, not database-authenticated
   end-user identity. A compromised runtime could call it with another valid
   recipient. Record that residual honestly; do not introduce a second owner or
   service credential into Vercel Functions, which would defeat the runtime
   separation control.
7. Implement separate fixed-purpose cleanup RPCs for retention and exact source
   residue. Do not expose a generic `delete notification where ...` interface.
8. Eliminate or explicitly gate the legacy account-deletion text scan/redaction
   before RLS. Prefer complete `sourceType`/`sourceId` coverage plus backfill;
   any retained redaction RPC must require the deletion context and prove it
   cannot become a general cross-user content editor.
9. Use explicit `NO FORCE` plus `ENABLE ROW LEVEL SECURITY` for the first
   production activation, then a separate `FORCE ROW LEVEL SECURITY` release
   after its skew/canary/session-drain window. FORCE does not constrain the
   BYPASS migration owner used by service RPCs.

## Implementation Gates

### B0 - Consolidation and source coverage

- Inventory every owner read/update, create/dedup, prune, staff cleanup, and
  account-deletion path mechanically.
- Add `sourceType`/`sourceId` to every fanout whose lifecycle can require
  cross-recipient cleanup; backfill or safely expire legacy rows.
- Replace blog/broadcast title/body/link cleanup with exact source cleanup.
- Choose and test the legacy account-deletion redaction disposition.
- Retain two fresh counted passes for the Notification workload with the
  restored generic provider transaction performance gate.

### B1 - Staging database prototype

- Add exact creation and cleanup RPCs, recipient policies, grants, default
  privileges, catalog fingerprints, and static callsite guards.
- Test own/foreign empty and nonempty reads, counts, pagination, exports,
  mark-one, mark-many, conversation mark-read, column-update denial, ownership
  transfer denial, direct insert/delete denial, RPC dedup, preference opt-out,
  recipient suspension/deletion, retention batches, source cleanup, account
  deletion, connection reuse, and context reset.
- Exercise rollback in staging: disable RLS, restore grants/RPC posture, re-enable
  exact policies, and positively verify the final state.

### B2 - Production activation

- Require Phase B and runtime credential separation already live and healthy.
- Deploy Notification RPC/application changes before enabling policies where
  compatibility requires it; never ship an app/table ordering that strands
  writes or cleanup.
- Activate `ENABLE` with explicit `NO FORCE`, retain catalog/grant/direct-denial
  evidence, route smokes, cron/webhook health, account-deletion proof, and a
  permanent non-customer Notification canary.
- Promote FORCE only in a later release after the full provider skew window,
  post-skew canary, owner credential/session drain, and tested database-first
  rollback.

## Current Blockers

- SavedSearch Phase B has not yet passed its time/canary gate and production
  postflight.
- Runtime owner-credential separation is implemented but not production-active.
- Cross-recipient account-deletion redaction still operates on notification
  text and requires redesign or a narrowly proven service path.
- Not every create path has proven lifecycle-complete source metadata.
- The generic provider wrapper/performance gate is restored in code, but two
  fresh counted provider passes are still required.

These blockers permit code preparation and staging design; they prohibit
production Notification RLS activation.
