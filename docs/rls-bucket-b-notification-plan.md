# Bucket B: Notification RLS Plan

Status: isolated B0 implementation in progress under explicit user
authorization. Code, unapplied migration/RPC/policy drafts, tests, and local
verification may continue on this branch. No Notification branch change may
merge, deploy, touch a live database, or enter a provider evidence run until
SavedSearch Phase B and the runtime database credential-separation postflight
are live and verified.

First B0 slice: source metadata is now a paired typed contract with a canonical
allowlist. New blog-comment notifications identify `blog_comment` plus the
comment id. Staff blog-comment and seller-broadcast deletion prefers exact
source cleanup while retaining a deliberately null-source-only fallback for
legacy rows. The fallback must be removed after legacy rows are backfilled or
expired; it is not an acceptable shape for the eventual owner RPC.

Account-deletion slice: `Notification.relatedUserId` records the other user
whose identity or authored content is represented in a recipient's row. Twenty-six
literal creation sites now set it, while back-in-stock derives the seller
relationship inside its owner operation. Account deletion deletes
recipient and related-user rows exactly, and limits the legacy sensitive-text
fallback to null-metadata rows. The fallback remains an activation blocker
until coverage/backfill or safe expiry is proven complete. The SQL remains at
`docs/rls-drafts/notification-related-user.sql`, deliberately outside
`prisma/migrations` so it cannot contaminate the sealed SavedSearch artifact.
The Vercel runtime guard fails closed while that draft file exists, preventing
this intentionally schema-ahead branch from being deployed accidentally.

Service-authority slice: the application create path now targets the first
granted family function, `grainline_notification_create_source_fanout`, through
`notificationServiceAccess.ts`. The private core atomically locks and validates the active recipient, honors the
in-app preference, validates bounded payload/source/related-user metadata,
proves source/type/actor/recipient relationships for the generic source-tagged
paths, inserts idempotently, and returns only the row id. Separate fixed-purpose draft
functions cover account lifecycle deletion, staff blog-comment/broadcast
cleanup, fixed 90-day read/365-day unread retention batches, atomic
back-in-stock claim/create/consume, and the reviewed creation families. Seventeen functions
are owner-backed `SECURITY DEFINER` functions with `search_path=pg_catalog`: the
generic fixed-column core is ungranted, while runtime gets exact `EXECUTE` only
on the source-fanout, social-event, message-event, commission-event, case-event,
inventory-event, verification-event, moderation-event, account-warning, and
order-event wrappers,
the back-in-stock claim, plus five
cleanup/retention operations. Direct table
`INSERT`/`DELETE` stays revoked.
The functions also revoke PostgreSQL's default `PUBLIC` execute privilege.
This narrows runtime authority but does not create database-authenticated end
user identity: the application still asserts `app.user_id`, so a fully
compromised runtime could invoke the granted fixed-purpose functions and could
forge that context. Input, role, age, and source constraints limit that residual
capability; runtime credential separation remains the separate control against
owner-credential exfiltration.
All 54 creation paths, exact account cleanup, exact admin source cleanup, and
retention cron are wired to these draft functions in the isolated branch. Admin cleanup
still retains explicitly marked `sourceType/sourceId IS NULL` legacy fallbacks,
and account deletion retains broader legacy source/link cleanup and text
redaction. Those direct fallbacks are an activation blocker because the draft
revokes direct runtime `DELETE`; they must be proven empty, backfilled, expired,
or replaced by equally narrow service operations before the SQL can go live.
The SQL remains outside `prisma/migrations` at
`docs/rls-drafts/notification-service-authority.sql` and is not live-tested.

Extra-high static review hardened the draft further: renderer-aligned relative
link validation rejects backslashes and control characters; recipient, related
user, source, follower, and staff rows use locks appropriate to the state being
validated; account cleanup takes a conflicting user-row lock before deleting;
and staff source cleanup refuses to run until the comment or broadcast was
deleted in the same transaction. These changes close create-versus-delete races
and prevent source metadata from being attached to the wrong notification type,
actor, or recipient. They do not close every runtime-compromise residual: the
granted create families still accept bounded caller-supplied title/body.
Canonical links and stable 64-hex replay identity are now derived inside the
private core from validated database facts; neither link nor dedup identity is
present in a granted creation signature. App-level `link` and `dedupScope` are
telemetry only. Social/message/commission absence-of-block checks do not
serialize against a concurrent block insertion because the block-writing paths
do not share a lock protocol. Payload derivation/templates and that concurrency decision remain
pre-activation work; app-layer authorization and block checks remain required.
The message family proves message kind and conversation participants.
Custom-order-ready extracts the listing id from the durable structured message
inside the private core, joins it to the reserved buyer, seller, conversation
and listing status, and derives `/listing/<id>`. No caller-provided route or
second Notification source field participates in authority.
Commission-interest creation relies on the durable `CommissionInterest` row,
not the request's mutable current status, because its `after()` notification may
race a legitimate close or fulfill transition. Close, fulfill, and expiry
fanout still require the exact final `CommissionRequest` state and recipient
relationship.

All twelve case emissions use durable evidence appropriate to the event. Case
open and staff resolution bind the `Case`; thread notifications bind the exact
`CaseMessage`; mark-resolved now writes its user audit row atomically with the
case transition; cron notifications use the existing system audit row returned
by the same transaction. The audit-backed paths validate recorded transition
metadata instead of mutable current status, so a legitimate later case change
does not silently suppress an already-committed event.

Creation-authority classification is now complete. All 54 emission paths now carry reviewed creation authority:
a non-null source pair and dispatch through one of ten reviewed creation
families or the dedicated back-in-stock claim. The 26 family-dispatched source
types validated by database joins, plus the dedicated back-in-stock operation,
still require PostgreSQL parse/apply and provider performance evidence before
promotion. This 54/54 result does not select the recipient read architecture,
close block races, remove legacy cleanup fallbacks, or prove live isolation.

The inventory family is now complete in the isolated draft. Webhook low-stock uses
the exact `OrderItem` as its durable source and proves the paid `Order`, completed
`CheckoutStockReservation` containing that listing, seller ownership, and live
1-2 quantity before deriving the seller payload and `/dashboard/inventory` link.
Manual low-stock now writes `MANUAL_LISTING_STOCK_LOW` evidence atomically with
the row-locked listing update; its family validates that event, seller, 1-2
quantity snapshot and derives the payload/link. Back-in-stock writes a durable
`MANUAL_LISTING_RESTOCKED` audit in the same transaction as the locked
SOLD_OUT→ACTIVE transition. Its dedicated owner function validates that audit,
locks the exact `StockNotification`, derives recipient/seller/payload/link/replay
identity, applies the in-app preference, inserts idempotently, and consumes the
subscription atomically. Only its winning claim can proceed to independently
preference-gated email enqueueing. This is an atomic restock-audit plus
subscription claim/create/consume operation.

The verification/Guild family is complete in the isolated draft. Seven staff
approve/reject/revoke/reinstate transitions return the durable, non-undone `AdminAuditLog`
row written with the state change. The wrapper validates the active staff role,
seller recipient, `MakerVerification` status, `SellerProfile.guildLevel`, action,
type, and audit target before deriving the payload and route. Three cron paths
use `SystemAuditLog` with fixed job identities. The first Guild Master metrics
warning now writes its system audit in the same transaction as the warning
state; the two revocations already had atomic system evidence.

The moderation and account-warning families bind all five paths to exact durable
evidence. Listing decisions return their co-committed staff audit; listing reports
use the exact `UserReport`. Successful admin emails write a strict post-send audit
containing the bounded notification body before attempting the in-app row. A
banned-seller warning uses `<ban-audit-id>:<order-id>` as a validated compound
event key, proves the order appears in the audit snapshot, derives the buyer and
banned seller, and keeps each affected order's replay identity distinct.

The order, payment, and fulfillment family binds the final nine paths. Checkout
buyer/seller notices validate the atomic checkout-order audit, paid order, exact
buyer, and single seller. Seller fulfillment changes co-commit a user-attributed
system audit with the row-locked order transition, and the owner wrapper derives
the buyer payload from the recorded transition. Seller refunds and blocked
checkout refunds bind durable `OrderPaymentEvent` rows; Stripe disputes require
both the provider event ledger and the applied-side-effects system audit; payout
failure binds `SellerPayoutEvent`. Recipient, counterpart, payload, canonical
route, and replay identity are derived from those ledgers and order
relationships rather than accepted as caller-controlled authority. Dispute
counterpart validation is null-safe so a seller still receives a real provider
dispute notification after buyer deletion has legitimately cleared
`Order.buyerId`; a non-null caller value must still match the retained buyer.

The authority fork is resolved directionally in
`docs/notification-create-authority-inventory.md`: do not accept one permissive
runtime-callable insert, and do not force every path into one provenance shape.
Keep a fixed-column insert primitive ungranted to runtime and expose reviewed
family functions for source fanout, social/review, messaging/custom orders,
cases, commissions, inventory, orders/providers, listing moderation,
verification/guild, and staff warnings. Stable domain ids and small event
discriminators let the database derive or validate recipients and types without
pretending every server-side assertion can be authenticated by PostgreSQL.

Experimental recipient-path slice: every centralized owner
read/count/export/mark-read and low-stock dedup lookup now enters
`withDbUserContext` inside
`notificationOwnerAccess.ts`; that module no longer accepts a default global
Prisma client. The notifications page performs its count, unread count, page
clamp, and row fetch sequentially in one branded transaction. This is a
correctness/performance candidate, not the selected production architecture,
and must not be promoted in its current state.

## Isolation Boundary And Hot-Path Decision

- The isolated branch may retain the verified inventory, source-lifecycle
  hardening, static guards, restored blocking gate, and experimental wrapper.
- Isolated runtime, RPC, policy, grant, and migration drafts plus local tests may
  continue. Do not merge, deploy, apply them to a live database, create staging
  objects, or collect provider promotion evidence until SavedSearch Phase B and
  credential separation complete their exact production postflights.
- The statement that the site currently has no users does not waive the sealed
  SavedSearch operator's skew/canary gate or any production evidence gate. It
  only makes parallel isolated Bucket B construction a reasonable use of time.
- The 2026-07-19 wrapper-versus-autocommit provider result makes interactive
  transactions on the bell and notification pages a credible performance risk;
  it does not by itself prove a Notification-specific result.
- After the production evidence gate lifts, compare the wrapper candidate with narrow
  one-statement `SECURITY INVOKER` recipient RPCs. Bell/page candidates must
  preserve explicit projections, counts, pagination, owner isolation, context
  reset, and hot-route SLOs. Mark-read and export need the same candidate review.
- Recipient RPCs are distinct from cross-user creation/cleanup service
  authority. Do not use recipient performance as justification for a broad
  `SECURITY DEFINER` function or direct runtime `INSERT`/`DELETE` grants.

## Scope Boundary

Bucket B means `Notification` only. It does not include `StockNotification`,
`EmailOutbox`, `Conversation`, `Message`, `Order`, payment/shipping records,
`Case`, or `CaseMessage`. Those retain separate coverage-matrix groups and
production releases.

The 2026-07-19 source snapshot contains 51 direct `createNotification` calls
across 29 caller files: 50 object-literal calls plus the fulfillment route's
typed wrapper call. That wrapper serves three distinct fulfillment payloads,
and back-in-stock uses one dedicated owner-backed claim, so the authority
inventory contains 54 distinct emission paths. All 54 are currently
authority-bound and none are source-less. This broad fanout surface is the main
reason the table cannot receive a copied SavedSearch owner-only policy; the
completed source inventory does not remove its asymmetric service-authority
requirements.

## Actor And Operation Inventory

| Actor/path | Operations | Required behavior under RLS |
|---|---|---|
| Authenticated recipient | Count/list/export own rows; mark own row(s) read; mark own conversation notifications read | Set transaction-local `app.user_id`; `SELECT` and `UPDATE` only where `userId` matches; update only the `read` column and never transfer ownership |
| Application notification service | Read recipient preference/status, insert for any legitimate recipient, recover the existing row after a dedup collision | Ten reviewed family creation RPCs plus one dedicated back-in-stock operation; no direct runtime `INSERT`; validate active recipient, preference, enum/payload bounds, source metadata, and dedup inside the database operation |
| Retention cron | Delete old read and unread rows globally in bounded batches | Parameter-free or tightly bounded owner RPC using server time and code-pinned retention windows; no general runtime `DELETE` |
| Account deletion | Delete the departing user's rows; delete related-user/source residue across other recipients; retire the legacy sensitive-text fallback | Use one narrow account-lifecycle RPC for recipient plus `relatedUserId` deletion and separate exact source cleanup; do not grant direct table `DELETE`. Exact recipient/related-user cleanup is wired to the draft RPC; legacy source/link/text work remains blocking |
| Staff blog/broadcast deletion | Delete notifications tied to a deleted comment or broadcast across recipients | Use exact `sourceType`/`sourceId` service cleanup; remove legacy title/body/link matching after source coverage/backfill is proven |
| Admin, webhook, cron, order/case/message/social flows | Create recipient notifications through reviewed service access | All 54 emission paths dispatch through ten reviewed family wrappers or the dedicated back-in-stock claim; the gate also requires the corresponding SQL function, revoke, and runtime grant |

Current direct-access files are deliberately pinned by test:

- `src/lib/notificationOwnerAccess.ts` — owner reads/counts and mark-read updates.
- `src/lib/notifications.ts` plus `src/lib/notificationServiceAccess.ts` —
  bounded service-create input and the single raw service RPC call.
- `src/lib/accountDeletion.ts` — own/cross-user delete, legacy raw reads, and redaction updates.
- `src/app/admin/blog/page.tsx` and
  `src/app/admin/broadcasts/page.tsx` — cross-recipient cleanup.
- `src/app/api/cron/notification-prune/route.ts` — bounded orchestration over
  the two parameter-free draft retention functions.

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
9. Use `relatedUserId` for exact account-deletion cleanup of cross-recipient
   identity or user-authored notification content. Keep it distinct from
   `sourceType`/`sourceId`, which identify the domain object's lifecycle.
10. Use explicit `NO FORCE` plus `ENABLE ROW LEVEL SECURITY` for the first
   production activation, then a separate `FORCE ROW LEVEL SECURITY` release
   after its skew/canary/session-drain window. FORCE does not constrain the
   BYPASS migration owner used by service RPCs.

## Implementation Gates

### B0 - Consolidation and source coverage

- Inventory every owner read/update, create/dedup, prune, staff cleanup, and
  account-deletion path mechanically.
- Add `sourceType`/`sourceId` to every fanout whose lifecycle can require
  cross-recipient cleanup; backfill or safely expire legacy rows.
- Add `relatedUserId` to every cross-recipient notification containing another
  user's identity, authored text, or account-owned object reference; backfill
  or safely expire null-metadata legacy rows.
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
- Run `npm run audit:rls-notification-readiness` and require an exact 54/54
  result. The AST-backed gate fails on count drift, dynamic/unrecognized helper
  calls, missing source pairs, source constants not dispatched by a reviewed
  service family, or a missing SQL wrapper/revoke/runtime grant. Its current
  green result proves the creation call graph and draft authority surface agree;
  it is not a complete Bucket B activation verdict.
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
- Null-metadata legacy account-deletion cleanup still falls back to notification
  text and requires coverage/backfill or safe expiry plus a narrow service path.
- Creation authority is 54/54 in the isolated draft, but it has not received
  PostgreSQL parse/apply, own/foreign/direct-denial, concurrency, provider, or
  pre-activation proof. Direct or generic runtime creation remains unacceptable.
- Recipient bell/page/count/export/mark-read architecture is not selected;
  compare narrow one-statement `SECURITY INVOKER` RPCs with the experimental
  transaction wrapper after the production sequencing gate lifts.
- Social/message/commission block checks do not yet share a serialization
  protocol with concurrent block creation.
- The generic provider wrapper/performance gate is restored in code, but two
  fresh counted provider passes are still required.

These blockers permit isolated implementation drafts and local verification.
They prohibit merge, deployment, live-database or staging activation, provider
promotion evidence, and production Notification RLS activation.
