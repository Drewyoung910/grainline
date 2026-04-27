# Grainline Open Audit Findings

Last updated: 2026-04-26

This file is the canonical fix-mode backlog for the later audit rounds. It focuses on findings from Rounds 13-20 and re-review passes that were not already closed in `CLAUDE.md`. Items are grouped by severity and practical fix batch.

## Current Backlog Estimate

Raw audit volume across all rounds is now roughly 750+ findings. That number includes duplicates, already-fixed issues, future ideas, product decisions, legal/business tasks, and false positives.

After de-duplication, the current engineering backlog is approximately:

| Priority | Estimated open items | Notes |
| --- | ---: | --- |
| Critical / launch-quality | 35-45 | Email compliance, payment/refund races, moderation bypasses, auth/account-state gaps, severe data integrity. |
| High | 80-110 | GDPR gaps, admin/dashboard correctness, scale risks, webhook/cron robustness, rate-limit gaps. |
| Medium | 90-130 | UX state, SEO, notification dedup, analytics definition drift, API contract cleanup. |
| Low / cleanup / future | 50-80 | Slugs, richer SEO, code organization, nice-to-have features, non-blocking polish. |

Practical remaining total: about 250-320 unique actionable items. The next fix effort should target critical/high items first, not the raw 750 count.

## Round 19 Corrections / Status Notes

- **R18 notification dedup "missing" finding withdrawn.** Current code implements notification dedup through `notificationDedupKey()` and the `Notification` unique constraint. The accurate behavior is per-UTC-day exact-content dedup, not a rolling 24-hour dedup window.
- **R16 AI fail-open findings are fixed.** Listing edit and photo-add AI review failures now leave listings in `PENDING_REVIEW`.
- **Reviews/blog/commission claims re-verified clean.** Round 19 found no actionable bugs in those surfaces.
- **Round 19 adds 20 new items**: 2 critical, 3 high, 6 medium, and 9 low. Highest leverage item is the Stripe fee/accounting mismatch between code and product/legal docs.

## Round 20 Corrections / Status Notes

- **R20 Sentry client PII finding was already fixed in this worktree.** `src/instrumentation-client.ts` had `sendDefaultPii: false` before this pass.
- **Sentry DSNs were still hardcoded.** Fixed on 2026-04-26 by moving client DSN to `NEXT_PUBLIC_SENTRY_DSN` and server/edge DSN to `SENTRY_DSN` with fallback to the existing public DSN env.
- **Notification read-prune was missing.** Fixed on 2026-04-26 by restoring hourly fire-and-forget pruning of read notifications older than 90 days.
- **Sitemap seller/listing leak findings were stale.** `publicListingWhere()` already filters `chargesEnabled`, `vacationMode`, banned users, deleted users, `ACTIVE`, and `isPrivate:false`; seller sitemap entries use the same account-state filters.
- **Round 20 adds roughly 50 actionable items**: 3 reported critical, 8 high, about 20 medium, and about 19 low. The real engineering gaps are configuration drift, missing migration enforcement, onboarding validation, map bundle splitting, CSP reporting, and UI accessibility/polish.

## Round 21 Corrections / Status Notes

- **Round 21 payment findings verified solid.** No new payment bugs were reproduced in this fix pass.
- **R21 listing moderation regressions fixed.** Edit/delete-photo AI review now uses cover-order photos, AI activation writes are guarded with `updatedAt`/status checks, custom listing activation is guarded, and active-listing substantive-change detection now covers tags/materials/meta/dimensions/listing type/stock/shipping windows.
- **R21 cron/dedup regressions fixed.** Failed cron runs can be retried after five minutes, notification dedup no longer hashes title/body, `dedupKey` is required for new notifications, Guild cron concurrency is reduced, and quality-score global means are materialized in `SiteMetricsSnapshot`.
- **Long-term scale guardrails added.** Sitemap listing chunking and five hot-path indexes were added; Vercel still needs `DATABASE_URL` switched to the Neon pooler endpoint.

## Round 22 Fix Status Notes

- **Follower and stock fan-out concurrency bounded.** Listing publish, blog publish/edit, seller broadcast, and back-in-stock fan-outs now use bounded concurrency instead of 50-100 parallel notification/email calls per batch.
- **Account deletion scrubbing broadened.** Deleted users now have sent messages/case messages scrubbed, buyer order shipping/contact/gift PII purged with `buyerDataPurgedAt`, review comments/photos removed, buyer commission request text/media/location scrubbed, maker verification text/portfolio/review notes scrubbed, seller listing descriptions/photos/media hidden and scrubbed, report details nulled, newsletter rows deleted, and collected R2 media best-effort deleted.
- **R2 media origin policy narrowed.** Write-path media validation no longer accepts arbitrary `*.r2.dev`; legacy R2 origins must be explicitly configured through the allowed R2 public URL env vars. CSP now uses configured R2/CDN origins instead of wildcard R2 image/connect/media sources.
- **Low-risk accessibility/UX cleanup.** FollowButton now updates optimistically with rollback on failure, `LocalDate` uses an explicit `en-US` locale, and global CSS has a baseline `:focus-visible` outline for interactive controls.

## Round 23 Fix Status Notes

- **Periodic fulfilled-order buyer PII pruning added.** New `order-pii-prune` cron removes buyer street/contact/gift-note fields from delivered/picked-up orders after 90 days, stamps `buyerDataPurgedAt`, and updates buyer/seller/admin order views to show a retention notice instead of partial addresses.
- **Payout failures now have a durable ledger.** Stripe `payout.failed` upserts `SellerPayoutEvent` rows and the seller settings banner reads the ledger instead of relying only on dismissible notifications.
- **Refund/report notification types added.** `REFUND_ISSUED`, `ACCOUNT_WARNING`, and `LISTING_FLAGGED_BY_USER` are now enum-backed notification types; seller refunds and refund case resolutions use `REFUND_ISSUED`, and listing reports create a deduped seller notification.
- **Photo mutation hardening continued.** Listing photo AI review has a dedicated rate limit, manual alt-text saves are sanitized/capped and constrained to the listing, and photo reordering now only updates photos belonging to the edited listing.

## Recommended Fix Order

1. **Email compliance and unsubscribe correctness**: unblock provider one-click unsubscribe, tokenize links properly, disable all non-transactional prefs, add rate limit/expiry.
2. **Refund/payment race safety**: remove `"pending"` UI leaks, timestamp refund locks, serialize completed/expired webhooks, fix tax-refund accounting, add banned-seller checks in webhook order creation.
3. **Moderation/listing state invariants**: block admin-removed listing resubmission, make edits/photos/variants fail closed to review, close active listing visibility windows during AI review.
4. **Account-state enforcement**: banned/deleted users must not mutate messages, photos, follows, notification state, saved state, or checkout/webhook side effects.
5. **Cron and notification scale**: paginate large cron jobs, batch destructive deletes, add idempotent cron run keys, implement durable notification/email queue or outbox.
6. **GDPR/account deletion**: export endpoint, Stripe deauthorization, newsletter/email erasure, message/photo/order PII scrubbing, retention documentation.
7. **Admin/dashboard correctness**: no-op actions must report errors, note caps, multi-seller math, audit filters, role separation for destructive actions.
8. **SEO/search/performance polish**: slug/i18n handling, GIN/pg_trgm indexes, tag/search endpoint reuse, canonical/noindex decisions.

## Critical / Launch-Quality Findings

### C1. [FIXED 2026-04-25] One-click unsubscribe route is blocked by Clerk

- **File**: `src/middleware.ts`
- **Current state**: Fixed. `/api/email/unsubscribe` is public and allowed through the geo-block API allowlist.
- **Impact**: Gmail/Yahoo one-click POST gets Clerk 401 instead of unsubscribing. Bulk-sender compliance risk.
- **Fix spec**: Add `/api/email/unsubscribe` to the public matcher. Also include it in the geo-block API allowlist if email clients can originate outside the US.

### C2. [FIXED 2026-04-25] One-click unsubscribe only disables three promotional prefs

- **File**: `src/lib/unsubscribe.ts`
- **Current state**: Fixed. One-click unsubscribe now disables every key in `VALID_EMAIL_PREFERENCE_KEYS` and adds an `EmailSuppression` row.
- **Impact**: A user clicking unsubscribe in a message/review/order-ish email can keep receiving other non-transactional mail. CAN-SPAM and Gmail/Yahoo risk.
- **Fix spec**: Define explicit categories:
  - Transactional/required: receipts, shipping, case/security/account notices.
  - Marketing/social optional: follower, broadcast, blog/listing promos, review prompts, saved search alerts, newsletters.
  - One-click unsubscribe must disable all non-transactional categories and newsletter subscription.

### C3. [FIXED 2026-04-25] Email footer unsubscribe link is still sign-in gated

- **File**: `src/lib/email.ts`
- **Current state**: Fixed. Email footer links are replaced with recipient-specific tokenized `/api/email/unsubscribe?...` URLs in `send()`.
- **Impact**: Email footer link can send users to a login wall. Compliance and deliverability risk.
- **Fix spec**: The email template must accept a recipient email and render `buildUnsubscribeUrl(to) ?? /unsubscribe`. For transactional emails, label it clearly as "Manage email preferences" if the email itself is required.

### C4. [FIXED 2026-04-25] One-click unsubscribe API returns JSON only

- **File**: `src/app/api/email/unsubscribe/route.ts`
- **Current state**: Fixed. `GET` returns a small HTML response; `POST` remains JSON for one-click providers.
- **Impact**: Many clients open the URL in a browser; raw `{"ok":true}` looks broken.
- **Fix spec**: For `GET`, return a small HTML confirmation page. For one-click `POST` with `List-Unsubscribe-Post`, JSON is fine. Both should perform the same unsubscribe operation.

### C5. [FIXED 2026-04-25] Unsubscribe token has weak lifecycle

- **File**: `src/lib/unsubscribe.ts`
- **Current state**: Fixed. Tokens are signed with the dedicated unsubscribe secret, include `issuedAt`, expire after 90 days, and are rate-limited.
- **Impact**: Tokens never expire, replay forever, and can break when Clerk/Stripe webhook secrets rotate.
- **Fix spec**: Require `UNSUBSCRIBE_SECRET` in production. Token payload should include email and issued-at timestamp, e.g. `base64url(email:issuedAt).hmac`, with a 90-day TTL. Add endpoint rate limit by IP.

### C6. [FIXED 2026-04-25] Refund `"pending"` sentinel leaks to seller UI and can lock orders

- **Files**: `src/components/SellerRefundPanel.tsx`, `src/app/dashboard/sales/[orderId]/page.tsx`, refund routes.
- **Current state**: Fixed. Refund locks now have `sellerRefundLockedAt`; stale locks are released by refund/case routes and the daily prune cron. UI shows `Refund processing` for `"pending"` and never renders it as a Stripe ID.
- **Impact**: Failed/hung Stripe calls can permanently block refunds and show false success.
- **Fix spec**: Add `sellerRefundLockedAt DateTime?`. Treat `"pending"` as a lock, never as a refund ID. UI should show "Refund processing" with no Stripe ID. Expire locks older than 5 minutes at the start of refund routes and via cron.

### C7. [FIXED 2026-04-25] Admin-removed listings can be resubmitted by seller

- **File**: `src/app/seller/[id]/shop/actions.ts`
- **Current state**: Fixed. `publishListingAction` now rejects the staff-removal rejection reason, uses guarded `updateMany` with the original `updatedAt`, and returns an error instead of clearing staff removal state.
- **Impact**: `publishListingAction` can clear `rejectionReason` and AI-approve an admin-removed listing back to active.
- **Fix spec**: Introduce a durable moderation state, e.g. `adminRemovedAt/adminRemovedReason` or reject reason code. If admin removed, seller resubmission must return an error and require staff action.

### C8. [FIXED 2026-04-25] Stripe Connect onboarding open redirect

- **File**: `src/app/api/stripe/connect/create/route.ts`
- **Current state**: Fixed. Return URLs are normalized against the app origin and protocol-relative/backslash forms are rejected.
- **Impact**: Protocol-relative open redirect after Stripe onboarding.
- **Fix spec**: Reject `//`, `/\`, and absolute URLs. Build with `new URL(returnUrl, APP_URL)` and assert `origin === APP_URL` and `pathname.startsWith("/")`.

### C9. [FIXED 2026-04-25] Stripe webhook order creation lacks banned/deleted seller re-check

- **File**: `src/app/api/stripe/webhook/route.ts`
- **Current state**: Fixed. Completed checkout now re-checks seller `banned`, `deletedAt`, `chargesEnabled`, and `stripeAccountId` before normal order side effects. Invalid sessions create a review-flagged order, skip normal notifications/emails, attempt a reverse-transfer refund, restore reserved stock after a successful refund, and leave a staff review note if automatic refund reconciliation fails.
- **Impact**: Seller banned during checkout can still receive completed order side effects.
- **Fix spec**: In `checkout.session.completed`, re-load seller inside the order transaction with `user.banned/deletedAt`, `chargesEnabled`, and `stripeAccountId`. If invalid, do not create normal order side effects; refund or queue manual review.

### C10. [FIXED 2026-04-25] `checkout.session.completed` / `checkout.session.expired` stock race

- **File**: `src/app/api/stripe/webhook/route.ts`
- **Current state**: Fixed. Completed and expired/async-failed session mutation sections now take the same PostgreSQL advisory transaction lock by Stripe session ID. Expired restores re-check order existence under the lock before stock restoration.
- **Impact**: Expired can restore stock while completed is still committing, overstating stock.
- **Fix spec**: Use a PostgreSQL advisory transaction lock keyed by Stripe session ID in both completed and expired handlers.

### C11. [FIXED 2026-04-25] Duplicate completed webhook emails

- **File**: `src/app/api/stripe/webhook/route.ts`
- **Current state**: Fixed for checkout session order creation. Cart and single-listing completed handlers now re-check `stripeSessionId` inside the same advisory-locked transaction before creating the order; racing duplicate/completed-like events return before buyer/seller notification side effects.
- **Impact**: Concurrent completed retries can both pass legacy idempotency and send duplicate buyer/seller emails after one loses on unique order insert.
- **Fix spec**: Send emails only after the transaction that created the order commits and only in the execution that actually inserted the order. Better: write an outbox row in the same transaction and drain it separately.

### C12. [FIXED 2026-04-25] Stock `SOLD_OUT` update uses non-atomic read/update

- **File**: `src/app/api/stripe/webhook/route.ts`
- **Current state**: Fixed for completed checkout order creation. Cart and single-item completed handlers now use a single guarded SQL `UPDATE` when marking `SOLD_OUT`.
- **Impact**: Stock status can flip incorrectly under completed/expired/refund interleavings.
- **Fix spec**: Replace `findUnique` then `update` with one guarded SQL update: `UPDATE Listing SET status='SOLD_OUT' WHERE id=$id AND stockQuantity <= 0 AND status='ACTIVE'`.

### C13. [FIXED 2026-04-26] Tax refund accounting can make platform absorb seller tax

- **Files**: `src/app/api/orders/[id]/refund/route.ts`, `src/app/api/cases/[id]/resolve/route.ts`
- **Current state**: Fixed. Full marketplace refunds now split item/shipping reversal from tax refunding when seller transfer reversal is available. The tax portion is refunded without `reverse_transfer`, and disconnected sellers use a platform-funded refund path with a manual reconciliation note.
- **Impact**: Full refund includes tax while seller transfer excluded tax; with `reverse_transfer:true`, platform may absorb tax refund incorrectly.
- **Fix spec**: Split item/shipping refund from tax refund, or define all refunds as platform-originated and reconcile seller balance separately. Requires Stripe accounting decision.

### C14. [FIXED 2026-04-26] Stripe platform fee accounting/doc mismatch

- **Files**: `src/app/api/cart/checkout-seller/route.ts`, `src/app/api/cart/checkout/single/route.ts`, `CLAUDE.md`
- **Current state**: Fixed by aligning code and docs on explicit `transfer_data.amount`. Embedded checkout routes retain platform fee/tax by transferring `itemsSubtotal + shipping + giftWrap - platformFee`; `application_fee_amount` is documented as not currently used.
- **Impact**: Docs say `application_fee_amount` is used, but checkout currently relies on manual `transfer_data.amount` math. Stripe reporting and refund/reversal accounting can diverge from the documented marketplace model.
- **Fix spec**: Decide the canonical Stripe Connect pattern and align code/docs. Recommended audit spec: set `application_fee_amount` explicitly in checkout session payment intent data and avoid manual platform-fee subtraction where Stripe can account for the fee directly.

### C15. [FIXED 2026-04-26] Seller effective fee contradicts stated platform-fee policy

- **Files**: `src/app/api/cart/checkout-seller/route.ts`, `src/app/api/cart/checkout/single/route.ts`, Terms/fee docs, `CLAUDE.md`
- **Current state**: Fixed in code and docs. Checkout transfer math no longer subtracts estimated Stripe processing fees from seller payouts; platform absorbs processing fees from the 5% platform fee.
- **Impact**: Code subtracts estimated Stripe processing fees from seller transfers, while docs state the platform absorbs Stripe processing fees from the 5% platform fee. Sellers may be paying an undisclosed ~7.9% effective rate. This is financial/product/legal risk.
- **Fix spec**: Pick one policy and make it consistent:
  - Preferred code fix: remove the estimated Stripe fee deduction from seller transfer math so the platform absorbs Stripe processing fees as documented.
  - Alternative legal/product fix: update Terms, seller-facing copy, and `CLAUDE.md` to clearly disclose seller-paid Stripe processing fees and the actual effective fee.

### C16. [NOT REPRODUCED 2026-04-26] Sentry client `sendDefaultPii` is true

- **File**: `src/instrumentation-client.ts`
- **Current state**: Not reproduced in this worktree. Client Sentry config already has `sendDefaultPii: false`.
- **Impact**: If regressed, browser errors can send avoidable user/session PII to Sentry.
- **Fix spec**: Keep `sendDefaultPii: false` on client, server, and edge configs. Add an assertion/lint check if this keeps recurring.

### C17. [FIXED 2026-04-26] Sentry DSN hardcoded in source

- **Files**: `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/instrumentation-client.ts`
- **Current state**: Fixed. Server and edge use `process.env.SENTRY_DSN` with fallback to `process.env.NEXT_PUBLIC_SENTRY_DSN`; client uses `process.env.NEXT_PUBLIC_SENTRY_DSN`.
- **Impact**: Hardcoded DSN exposes org/project IDs and prevents rotation without code changes.
- **Fix spec**: Keep DSNs in environment variables. Configure Vercel production/preview envs before relying on Sentry events.

### C18. [FIXED 2026-04-26] Notification read-prune cleanup missing

- **File**: `src/app/api/notifications/route.ts`
- **Current state**: Fixed. Authenticated notification GET now runs an hourly gated, fire-and-forget prune for read notifications older than 90 days.
- **Impact**: Read notifications accumulate forever and grow the table/indexes without bound.
- **Fix spec**: Longer term, move pruning to a daily cron with batched deletes and keep per-request cleanup only as a fallback.

## High Priority Findings

### H1. [FIXED 2026-04-25] Messages read/list/stream routes missing banned/deleted checks

- **Files**: `src/app/api/messages/[id]/list/route.ts`, `stream/route.ts`, `read/route.ts`
- **Current state**: Verified stale finding. All three routes already call `ensureUserByClerkId()` and return typed account-access errors for suspended/deleted users.
- **Impact**: Banned harasser can retain read access to threads.
- **Fix spec**: Use `ensureUserByClerkId()` and `accountAccessErrorResponse()` at route entry.

### H2. [FIXED 2026-04-25] Listing photos route missing banned/deleted check

- **File**: `src/app/api/listings/[id]/photos/route.ts`
- **Current state**: Fixed. The route now loads the Clerk user row, rejects banned/deleted users, and joins listing ownership through an active seller user.
- **Impact**: Banned seller can mutate listing photos.
- **Fix spec**: Use `ensureSeller()` or join through seller user with `banned:false`, `deletedAt:null`.

### H3. [FIXED 2026-04-26] More mutation routes need account-state enforcement

- **Files**: listing notify, follow, refund caller, notifications poll/read, blog save, favorites, saved/search variants.
- **Current state**: Fixed for the listed mutation surfaces. Existing guards were verified on notify/follow/refund/notifications/favorites/saved search; blog save, listing stock, review creation, and shipping quote now use the shared active-user guard and return typed suspended/deleted responses where appropriate.
- **Impact**: Suspended/deleted users can still perform or observe certain actions.
- **Fix spec**: Standardize a route wrapper or helper: `requireActiveUserFromClerk()` returning `{ user, response }`.

### H4. [FIXED 2026-04-26] Transactional emails can still send to banned/deleted users

- **File**: `src/lib/email.ts`
- **Current state**: Fixed. The shared `send()` helper checks `EmailSuppression` and then skips recipients whose `User` row is banned or deleted before calling Resend.
- **Impact**: Suspended users can keep receiving operational mail.
- **Fix spec**: In the shared email send helper, check recipient email against `User.banned/deletedAt` and `EmailSuppression`.

### H5. [FIXED 2026-04-26] Refund routes do not handle deauthorized Stripe accounts

- **Files**: seller refund and case resolve routes.
- **Current state**: Fixed. Seller and case refunds now check the seller profile's Stripe account before choosing refund parameters; if the account is unavailable, the refund is issued without transfer reversal and the order is marked for manual reconciliation.
- **Impact**: `reverse_transfer` can fail after Connect deauthorization and leave refund locks.
- **Fix spec**: Pre-check seller Stripe account state. If unavailable, use platform refund/manual reconciliation path and clear lock on failures.

### H6. [NOT REPRODUCED 2026-04-26] Seller refund idempotency key collides on identical partial refunds

- **File**: `src/app/api/orders/[id]/refund/route.ts`
- **Current state**: Not reproduced in the current model. Orders allow only one seller/case refund because `sellerRefundId` blocks any later refund after success or while locked. Deterministic Stripe idempotency keys remain appropriate for retry safety under the current single-refund invariant.
- **Impact**: Same partial amount within Stripe idempotency window can return prior refund.
- **Fix spec**: Add `refundAttemptCount` or `SellerRefundAttempt` table; include attempt ID in idempotency key.

### H7. [FIXED 2026-04-25] Dispute created can race seller refund

- **Files**: webhook dispute handler and seller refund route.
- **Current state**: Fixed. Seller refunds now check the latest local `OrderPaymentEvent` with `eventType = DISPUTE` and return HTTP 409 while the dispute status is not closed (`won`, `lost`, or `warning_closed`).
- **Impact**: Buyer sees dispute and refund states interleaved.
- **Fix spec**: Seller refund route must block if an order has an open `OrderPaymentEvent` dispute.

### H8. [FIXED 2026-04-26] Notification dedup is incomplete/missing

- **Files**: `src/lib/notifications.ts`, favorites/follow routes.
- **Current state**: Fixed. `Notification` now has a required shared `dedupKey` with a database unique constraint on `(userId, type, dedupKey)`. `createNotification()` computes a daily key from recipient, notification type, and link; title/body are excluded so copy changes do not bypass dedup. Favorites/follow routes no longer use fuzzy text/link-only route dedup that suppressed legitimate distinct users.
- **Impact**: Duplicate notifications under concurrency; fuzzy dedup can suppress legitimate users.
- **Fix spec**: Add `dedupKey` or metadata to `Notification`. Dedup by stable sender/action/listing keys, not text/link alone.

### H9. [FIXED 2026-04-26] Back-in-stock notification idempotency gap

- **File**: `src/app/api/listings/[id]/stock/route.ts`
- **Current state**: Fixed. Restock fan-out now claims subscribers with one `DELETE ... RETURNING "userId"` statement before sending, so racing restock jobs cannot notify the same subscription twice.
- **Impact**: Fast 0->1->0->1 updates can double notify.
- **Fix spec**: Add a stock notification sent marker or transactionally delete subscribed rows before sending through outbox.

### H10. [FIXED 2026-04-26] Checkout uses stale cart prices

- **File**: `src/app/api/cart/checkout-seller/route.ts`
- **Current state**: Fixed. Checkout now compares the live listing + variant price against `CartItem.priceCents` and returns HTTP 409 with `code: "PRICE_CHANGED"` plus old/new prices before creating a Stripe session.
- **Impact**: Seller edits price after cart add; buyer pays old snapshot.
- **Fix spec**: Compare live listing variant-adjusted price with `CartItem.priceCents`; return 409 `price_changed` and require buyer confirmation/update.

### H11. [FIXED 2026-04-25] Charges/Connect status can flip during checkout

- **Files**: checkout routes and webhook completed handler.
- **Current state**: Fixed for completed checkout. The webhook re-checks seller `chargesEnabled` and `stripeAccountId` before normal side effects and moves invalid completions to refund/manual-review handling.
- **Impact**: Sessions created before deauthorization can complete after seller is no longer payable.
- **Fix spec**: Re-check seller Connect status in webhook order transaction and route invalid sessions to refund/manual review.

### H12. [FIXED 2026-04-25] Listing edit updates public listing before AI re-review

- **File**: `src/app/dashboard/listings/[id]/edit/page.tsx`
- **Current state**: Fixed. Active listings with substantive edits are moved to `PENDING_REVIEW` in the same update that saves the changed content and are reactivated only after AI approval.
- **Impact**: Active listing can show unreviewed content during review call.
- **Fix spec**: If substantive fields change, set `PENDING_REVIEW` in the same transaction as content update, then activate only after AI approval.

### H13. [FIXED 2026-04-25] AI photo re-review checks stale first photos

- **File**: `src/app/api/listings/[id]/photos/route.ts`
- **Current state**: Fixed. Photo-add review sends the newly added URLs directly to AI; edit/delete review uses newest remaining photos.
- **Impact**: Newly appended photos may never be reviewed when listing has 4+ older photos.
- **Fix spec**: Review newly added URLs directly, or query newest photos by `createdAt desc`.

### H14. [FIXED 2026-04-25] AI errors fail open on edit/photo add

- **Files**: listing edit page and photos route.
- **Current state**: Fixed for visibility. AI errors now leave the listing in `PENDING_REVIEW` instead of ACTIVE. Sentry capture remains part of broader observability cleanup.
- **Impact**: AI outage can leave active unreviewed changes public.
- **Fix spec**: Match publish path: fail closed to `PENDING_REVIEW`, capture exception to Sentry.

### H15. [FIXED 2026-04-25] Variant changes skip AI re-review

- **File**: listing edit page.
- **Current state**: Fixed. Existing and submitted variant groups/options are normalized and compared; variant changes are substantive changes.
- **Impact**: Seller can change option labels/variant text without moderation.
- **Fix spec**: Include serialized variant diff in `substantiveChange`.

### H16. [FIXED 2026-04-25] Admin reject/resubmit race

- **File**: `src/app/seller/[id]/shop/actions.ts`
- **Current state**: Fixed. Publish/resubmit writes are guarded by original `updatedAt` and refuse staff-removed rejection state.
- **Impact**: Seller resubmit can overwrite admin rejection.
- **Fix spec**: Use guarded `updateMany` with expected current state and preserve admin rejection fields.

### H17. [FIXED 2026-04-25] Seller can set stock zero while AI re-review reactivates

- **Files**: stock route, photo/edit AI review handlers.
- **Current state**: Fixed for AI activation paths. New/edit/custom listing forms require positive stock for `IN_STOCK`, and AI activation paths run a guarded `SOLD_OUT` correction if stock is zero/null.
- **Impact**: `IN_STOCK` listing can become `ACTIVE` with zero stock.
- **Fix spec**: After AI activation, run guarded SQL to force `SOLD_OUT` if stock is <= 0.

### H18. [FIXED 2026-04-25] Fulfillment/case race

- **File**: `src/app/api/orders/[id]/fulfillment/route.ts`
- **Current state**: Fixed. Fulfillment updates now include active-case absence in the atomic `updateMany` predicate, so a concurrently opened case blocks shipped/picked-up transitions.
- **Impact**: Seller can mark shipped/picked-up while buyer opens case concurrently.
- **Fix spec**: Move case absence condition into the atomic update predicate.

### H19. [FIXED 2026-04-25] Quality-score cron loads all active listings

- **File**: `src/lib/quality-score.ts`
- **Current state**: Fixed. Active listings are now cursor-paginated by listing ID and scored/updated one batch at a time.
- **Impact**: OOM risk at scale.
- **Fix spec**: Cursor paginate active listings in batches of 500 and process batch-by-batch.

### H20. [FIXED 2026-04-25] Guild metrics cron loads all Guild sellers

- **File**: `src/app/api/cron/guild-metrics/route.ts`
- **Current state**: Fixed. Guild sellers are now cursor-paginated in pages of 50 and processed with bounded concurrency of 5.
- **Impact**: OOM/maxDuration risk.
- **Fix spec**: Cursor paginate sellers in batches of 50 and limit inner concurrency to 3.

### H21. [FIXED 2026-04-25] Large deleteMany cron operations are unbounded

- **Files**: notification prune, `ListingViewDaily` cleanup.
- **Current state**: Fixed. `ListingViewDaily` cleanup and notification prune both delete in 1,000-row SQL chunks; notification prune also respects a 45s execution budget.
- **Impact**: Long table locks at large row counts.
- **Fix spec**: Delete in SQL chunks of 1,000-5,000 rows per loop with max execution budget.

### H22. [FIXED 2026-04-26] Cron jobs lack idempotent run keys

- **Files**: all cron routes.
- **Current state**: Fixed. Added `CronRun` persistence and wired all six Vercel cron routes to claim a deterministic UTC-hour run before side effects. Duplicate retries in the same bucket return a skipped success response.
- **Impact**: Vercel retry can double-warn/double-revoke/double-notify.
- **Fix spec**: Add `CronRun` table and deterministic per-job time-bucket run ID.

### H23. [PARTIAL 2026-04-25] Cron failures leak internals and stop batches

- **Files**: guild cron routes and other sequential cron loops.
- **Current state**: Guild metrics and Guild member check now isolate per-seller failures, capture full errors to Sentry, and return sanitized error codes. Other cron routes still need the same sweep.
- **Impact**: stack/path leakage in JSON responses; one record failure can stop batch.
- **Fix spec**: Capture full details to Sentry, return counts/codes only, isolate per-record failures.

### H24. [FIXED 2026-04-26] Resend webhook gaps

- **Files**: `src/app/api/resend/webhook/route.ts`
- **Current state**: Fixed. Verified Resend webhooks now reserve/dedupe `svix-id` values in `ResendWebhookEvent`; processed replays return duplicate success. `email.failed` and `email.delivery_delayed` are tracked in `EmailFailureCount`, and 3 failures in 30 days suppress the recipient with source `resend_transient_failure`.
- **Impact**: `email.failed` and `email.delivery_delayed` ignored; webhook replay not deduped.
- **Fix spec**: Add `ResendWebhookEvent` table keyed by `svix-id`; track transient failures and suppress after threshold.

### H25. [FIXED 2026-04-26] Newsletter signup skips suppression check

- **File**: `src/app/api/newsletter/route.ts`
- **Current state**: Fixed. The route checks `isEmailSuppressed(email)` before upserting `NewsletterSubscriber` and returns a suppressed response.
- **Impact**: Suppressed users can resubscribe only to be skipped later.
- **Fix spec**: Check `EmailSuppression` before create/update; return clear suppressed state.

### H26. [FIXED 2026-04-25] Destructive admin actions available to EMPLOYEE

- **Files**: admin listing/review delete routes.
- **Current state**: Fixed. `DELETE /api/admin/listings/[id]` and `DELETE /api/admin/reviews/[id]` now require `ADMIN`; `EMPLOYEE` remains limited to moderation/review workflows.
- **Impact**: EMPLOYEE can hard-remove sensitive records.
- **Fix spec**: Restrict permanent destructive actions to `ADMIN`; use soft moderation actions for `EMPLOYEE`.

### H27. [FIXED 2026-04-25] Admin PIN cookie secret falls back to PIN

- **File**: `src/lib/adminPin.ts`
- **Current state**: Fixed. Production cookie signing uses `ADMIN_PIN_COOKIE_SECRET` only; non-production without that env uses an ephemeral per-process fallback. Vercel Production was confirmed to have `ADMIN_PIN_COOKIE_SECRET`.
- **Impact**: Knowledge of PIN becomes signing-secret knowledge.
- **Fix spec**: Require `ADMIN_PIN_COOKIE_SECRET` in production. Add env var before deploying the code change.

### H28. [FIXED 2026-04-25] Admin PIN IP limiter can lock shared office

- **File**: `src/app/api/admin/verify-pin/route.ts`
- **Current state**: Fixed. User attempts remain 5/15m, while IP-level bot-flood protection is now a separate 50/15m limiter.
- **Impact**: 5 shared attempts/IP can lock all admins.
- **Fix spec**: Keep strict per-user limiter; loosen per-IP to bot-flood thresholds.

### H29. Account deletion/export GDPR gaps

- **Files**: account deletion library and account export route.
- **Current state**: Fixed in code for the identified engineering gap. `/api/account/export` returns signed-in account portability JSON, seller-side sales exports omit buyer shipping/contact PII, account deletion scrubs the listed PII/media surfaces, and the `order-pii-prune` cron now removes fulfilled-order buyer street/contact/gift-note fields after 90 days. Broader legal retention schedule decisions remain product/legal work.
- **Impact**: Privacy promises portability/deletion beyond implemented code.
- **Fix spec**: Finish scrub/anonymize message bodies, order shipping PII, maker verification text, listing media, newsletter email, reports, and R2 objects according to retention policy.

### H30. [FIXED 2026-04-26] Account deletion does not deauthorize Stripe Connect

- **File**: `src/lib/accountDeletion.ts`
- **Current state**: Fixed. Account deletion now attempts `stripe.accounts.reject(..., { reason: "other" })` before local anonymization/nulling. Stripe failures are captured to Sentry and do not block local deletion.
- **Impact**: Seller's connected account can remain active after Grainline deletion.
- **Fix spec**: Call Stripe account reject/deauthorize path before nulling local `stripeAccountId`; log failures to Sentry.

### H31. [FIXED 2026-04-26] NewsletterSubscriber retains email after deletion

- **File**: `src/lib/accountDeletion.ts`
- **Current state**: Fixed. Account deletion deletes the newsletter subscriber row and upserts an `EmailSuppression` record with reason `MANUAL` and source `account_deletion`.
- **Impact**: GDPR/CCPA deletion gap.
- **Fix spec**: Delete subscriber row and add `EmailSuppression` with reason `MANUAL_DELETION`.

### H32. [NOT REPRODUCED 2026-04-26] BlogPost author cascade deletes public content

- **File**: `prisma/schema.prisma`
- **Current state**: Not reproduced. The original blog migration uses `ON DELETE RESTRICT` for `BlogPost_authorId_fkey`, not cascade, and the account deletion flow anonymizes the user row rather than hard-deleting it. Broader deleted-author public display policy remains a product/privacy decision.
- **Impact**: User deletion can destroy published public content.
- **Fix spec**: Move author relation to `SetNull`, add `authorDeleted`, render "Former author".

### H33. [FIXED 2026-04-26] Reviews can display anonymized deleted emails

- **Files**: reviews API/UI and account deletion.
- **Current state**: Fixed. Public review rendering now selects `reviewer.deletedAt`, displays deleted reviewers as `Former buyer`, avoids deleted-email initials/avatar fallback, and hides report/block controls for already-deleted reviewer accounts.
- **Impact**: `deleted+...@deleted.thegrainline.local` can leak to users.
- **Fix spec**: Add `reviewerDisplayName` snapshot and render "Former buyer" for deleted users.

### H34. Message/order/listing PII persists after deletion

- **Files**: account deletion and associated UI.
- **Current state**: Fixed for user-initiated account deletion and old fulfilled-order buyer PII. Deleted-user sent messages/case messages are replaced with deletion placeholders; buyer order contact/shipping/gift fields are nulled and stamped with `buyerDataPurgedAt`; seller listings are hidden/private and stripped of description/media/tags/materials; listing/review/commission media is best-effort deleted from R2. A daily cron now applies the buyer order PII purge to delivered/picked-up orders after 90 days.
- **Impact**: Personal data remains visible to counterparties.
- **Fix spec**: Define retention rules. Scrub old fulfilled order shipping details, deleted user's sent messages, R2 attachments, listing descriptions/photos, verification notes.

### H35. [FIXED 2026-04-26] Signed shipping rate token is not buyer-bound

- **File**: `src/lib/shipping-token.ts`
- **Current state**: Fixed. Signed rate HMAC input now includes the authenticated buyer ID, and checkout verification supplies the current buyer ID.
- **Impact**: A signed shipping rate can be replayed by a different buyer for the same object/postal combination during the token TTL.
- **Fix spec**: Add `buyerId` to signed rate fields and canonical HMAC input. Quote routes should sign with the authenticated buyer ID; checkout routes should verify the token buyer matches the current buyer.

### H36. [FIXED 2026-04-26] Shipping quote route accepts mismatched cart and seller IDs

- **File**: `src/app/api/shipping/quote/route.ts`
- **Current state**: Fixed. Cart quote requests with an explicit `cartId` and `sellerId` now require the seller to be present in that cart.
- **Impact**: A buyer can pass their cart ID with an arbitrary seller ID. Combined with unbound shipping tokens, this can mint rates outside the intended cart/seller relationship.
- **Fix spec**: When quoting for a cart, require `sellerId` to be present in that cart's items: `cart.items.some((item) => item.listing.sellerId === sellerId)`. Return 400 when mismatched.

### H37. [FIXED 2026-04-26] R2 presign trusts client-declared upload size

- **File**: `src/app/api/upload/presign/route.ts`
- **Current state**: Fixed in app code. Presigned uploads now have stricter extension/type matching, only video/PDF direct-upload endpoints are accepted, GIF direct uploads are rejected, uploads share a 50/hour per-user cap, and clients call `/api/upload/verify` after PUT so the server HEAD-checks actual R2 `Content-Length` before the URL is used.
- **Impact**: A client can request a presign for an allowed size and then attempt a larger PUT. Actual enforcement depends on R2/S3 presign behavior and bucket configuration.
- **Fix spec**: Keep app-level post-upload verification. Also enforce object-size limits at the Cloudflare R2 bucket level as infrastructure defense in depth.

### H38. [STALE 2026-04-26] Sitemap leaks banned/vacation/non-charged sellers

- **File**: `src/app/sitemap.ts`
- **Current state**: Stale in this worktree. Seller sitemap entries already require `chargesEnabled: true`, `vacationMode: false`, and `user: { banned: false, deletedAt: null }`.
- **Impact**: If regressed, Google can crawl seller pages that public routing then hides or 404s.
- **Fix spec**: Keep sitemap seller queries aligned with `publicListingWhere()` account-state rules.

### H39. [STALE 2026-04-26] Sitemap leaks listings without seller safety filters

- **File**: `src/app/sitemap.ts`
- **Current state**: Stale in this worktree. Listing sitemap entries use `publicListingWhere()`, which includes listing status/privacy and seller account-state filters.
- **Impact**: If regressed, Google can index inactive or unsafe listings.
- **Fix spec**: Continue using `publicListingWhere()` for listing sitemap and metro/category sitemap grouping.

### H40. [FIXED 2026-04-26] chargesEnabled backfill script cannot run in production

- **File**: `scripts/backfill-charges-enabled.ts`
- **Current state**: Fixed. The script now requires `--force-prod` in production and syncs each seller from `stripe.accounts.retrieve(...).charges_enabled` instead of blindly setting `chargesEnabled: true`.
- **Impact**: Future sellers with `stripeAccountId` but stale `chargesEnabled:false` can remain invisible if the only repair script refuses production execution.
- **Fix spec**: Prefer a guarded admin-only sync action/route that retrieves Stripe accounts and updates `chargesEnabled`. If keeping the script, add an explicit `--force-prod` flag with confirmation logging and require `DIRECT_URL`.

### H41. [FIXED 2026-04-26] No CI/deploy enforcement for `prisma migrate deploy`

- **Files**: `.github/workflows/ci.yml`, `vercel.json`
- **Current state**: Fixed for production Vercel deploys. `vercel.json` now runs `npx prisma migrate deploy` before `npm run build` when `VERCEL_ENV=production`.
- **Impact**: Code that references new columns can deploy before migrations run, causing production 500s until manual migration.
- **Fix spec**: Add a production deploy workflow that runs `npx prisma migrate deploy` against `DIRECT_URL` before Vercel production deployment, or set Vercel `buildCommand` to run migrations before `next build` once env wiring is confirmed.

### H42. [FIXED 2026-04-26] Onboarding can be completed without Stripe

- **File**: `src/app/dashboard/onboarding/actions.ts`
- **Current state**: Fixed. `completeOnboarding()` now requires `chargesEnabled` before setting `onboardingComplete`.
- **Impact**: Sellers could advance steps directly and mark onboarding complete without a usable Stripe account.
- **Fix spec**: Keep `completeOnboarding()` as the invariant gate, independent of UI step controls.

### H43. [FIXED 2026-04-26] Maplibre CSS still loads through static listing MapCard import

- **Files**: `src/app/listing/[id]/page.tsx`, `src/components/DynamicMapCard.tsx`
- **Current state**: Fixed. Listing detail now imports a client-only dynamic MapCard wrapper with SSR disabled and a fixed-height loading placeholder.
- **Impact**: Listing pages without immediate map interaction paid for Maplibre CSS/JS in the base route path.
- **Fix spec**: Keep map-heavy components behind dynamic imports and fixed-size placeholders.

### H44. [FIXED 2026-04-26] CSP missing modern `report-to` reporting path

- **File**: `next.config.ts`
- **Current state**: Fixed. Security headers include `Reporting-Endpoints: csp-endpoint="/api/csp-report"` and CSP includes `report-to csp-endpoint` plus legacy `report-uri`.
- **Impact**: Modern browsers can drop CSP reports when only deprecated `report-uri` is configured.
- **Fix spec**: Keep both `report-to` and `report-uri` until reporting support is stable across target browsers.

### H45. [FIXED 2026-04-26] UnreadBadge polls while signed out

- **File**: `src/components/UnreadBadge.tsx`
- **Current state**: Fixed. The component now gates polling on Clerk `isSignedIn` and clears count when signed out.
- **Impact**: Signed-out visitors generated periodic 401s every 10 minutes.
- **Fix spec**: Any auth-only polling widget should use the same `useUser()` gate as `NotificationBell`.

## Admin / Dashboard Findings

- `approveGuildMember` silently no-ops when recomputed eligibility is false. **Current state: Fixed.** Approval now uses a stateful form, reports unmet listing/account-age/case/sales criteria inline, and excludes externally refunded orders via `chargeRefundId`.
- [FIXED 2026-04-26] `appendNote` and `markReviewed` now return `{ ok:false, error }` state through a client action form instead of crashing the admin order page.
- `updateSellerProfile` throws raw `Display name is required`. Convert to inline form error.
- `/admin/orders` and `/admin/flagged` show only `items[0]` seller. **Current state: Fixed.** Admin order tables now load all order items and render all distinct sellers plus item summaries.
- [FIXED 2026-04-26] `VacationModeForm` now surfaces save errors and `Retry-After` rate-limit failures inline.
- [FIXED 2026-04-26] `/admin/audit` has an action filter and hides Undo behind explicit undoability instead of showing an expired-looking control for non-undoable actions.
- [FIXED 2026-04-26] Non-undoable moderation actions now render as "Not undoable"; admin undo API is also rate-limited.
- `/admin/verification` still risks N x `calculateSellerMetrics` per render. Cache metrics or load precomputed `SellerMetrics`.
- [FIXED 2026-04-26] `/dashboard/inventory` stock saves now serialize per row and disable quantity edits while a save is in flight.
- [FIXED 2026-04-26] `/dashboard/sales/[orderId]` now displays seller-owned item subtotal in the seller subtotal row.
- [FIXED 2026-04-26] `appendNote` now caps each append at 2,000 chars and total review notes at 10,000 chars.
- Admin prompt flows still use blocking `window.prompt`; replace with modal/action form over time.

## UX / Product Correctness Findings

- Buyer cannot delete their own review. **Current state: Fixed.** Reviewer-owned reviews can now be deleted through `DELETE /api/reviews/[id]`, and `/account/reviews` exposes the action.
- [FIXED 2026-04-26] Authenticated banned/deleted users are redirected to `/banned` from public pages and receive consistent account-state JSON from non-bypass API routes.
- Banned user cart/message errors can be misleading. Return buyer-specific suspended-account messages.
- [FIXED 2026-04-26] AdminPinGate now uses the server `Retry-After` header and disables input until the server lockout expires.
- Stripe onboarding skip/return flow can land sellers at step 4/5 with unclear status. Show explicit Stripe incomplete banner keyed by account status.
- Cart close/payment modal can orphan Stripe sessions and stock locks. Consider session cancel/release endpoint or clearer lock-expiry messaging.
- Multi-seller success/receipt views need all seller receipts/items, not just last or first seller.
- Soft-deleted saved favorites no longer show broken listing links on `/account/saved`; a richer "No longer available" history section remains optional product polish.

## Search / SEO / i18n Findings

- [FIXED 2026-04-26] Blog slug generation normalizes diacritics (`Café` -> `cafe`) and falls back to a stable hash slug for non-Latin titles instead of returning empty.
- Listings and sellers still primarily use CUID URLs. Slug work remains a larger SEO pass.
- Browse rating filter performs heavy review scans. Add optimized aggregate/materialized rating fields.
- [FIXED 2026-04-26] Browse popular tags now use a shared `getPopularListingTags()` cached query consumed by both `/api/search/popular-tags` and browse/home server renders.
- [FIXED 2026-04-26] Featured maker fallback is cached with `unstable_cache` and a 1-hour revalidation window.
- [FIXED 2026-04-26] Added pg_trgm-backed GIN indexes for active listing titles and published blog titles, plus a GIN index for listing tags.
- Tag autocomplete cross-joins all `Listing x unnest(tags)` at scale. Use cached tag table/materialized view.
- Browse canonical/noindex/page/filter strategy still needs one deliberate SEO decision.
- Sitemap index splitting remains future scale work.

## Schema / CI / Platform Findings

- Schema has few `@db.VarChar(N)` caps. Add caps to bounded text fields; leave long bodies as `Text`.
- Viewed cookies can leak listing IDs and hit header size limits. Cap count, compress, or move to server-side recently viewed for signed-in users.
- [FIXED 2026-04-26] CI lint and high-severity audit checks are now blocking, and CI runs `npm run build` after TypeScript.
- Zero real test suite remains. Start with payment/webhook/refund/account-state route tests.
- `tsconfig` target ES2017 may increase bundle size. Evaluate ES2022 target with Next/browser support.
- `npm audit`: no current critical/high from dependency pass; moderate findings are mostly transitive/gated. Track Next/Clerk/maplibre updates.
- Sentry `beforeSend` filtering is missing. **Current state: Fixed.** Shared server/edge/client filter drops common browser/network noise and redacts cookies, auth headers, token query params, user email/IP, and email-like strings.
- Vercel/Resend/Stripe deploy checklist needs explicit webhook registration validation.

## Medium / Low Findings To Batch Later

- [FIXED 2026-04-26] `CaseReplyBox` and `OpenCaseForm` now handle empty/non-JSON error responses without leaving spinners stuck.
- [FIXED 2026-04-26] `POST /api/cases` now enforces the 20-character description minimum server-side.
- [FIXED 2026-04-26] Message inbox snippets now use persisted `Message.kind` for structured cards instead of inferring from arbitrary JSON body shape.
- [FIXED 2026-04-26] `MarkdownToolbar` now rejects unsafe link protocols such as `javascript:` before inserting markdown links.
- `setStatus` and shop listing actions miss some `revalidatePath` calls.
- `chargesEnabled` lost mid-edit silently moves listing to draft; surface warning.
- `unhideListingAction` and `markAvailableAction` should return `publishListingAction` errors.
- Photo delete should check listing state before delete. **Current state: Fixed.** Listing photo delete checks archived state before deleting the DB row.
- `computeGlobalMeans` for quality score should move to snapshot/materialized data.
- Guild revocation/reinstatement races need stale-state guards.
- `activeCaseCount` should be period-scoped or explicitly lifetime-scoped in Guild docs.
- `payout.failed` should write a durable seller payout event ledger.
- `payment_intent.processing` / `payment_failed` handlers should be added or delayed methods should be explicitly disabled/documented.
- Missing notification types: `REFUND_ISSUED`, `ACCOUNT_WARNING`, `LISTING_FLAGGED_BY_USER`. **Current state: Fixed.** Enum values, preference keys, notification icons, refund notification wiring, and listing-report notifications are implemented.
- Audit log subject/body should sanitize persisted user-provided strings.
- Upload presign per-request `fileIndex` is client-controlled. **Current state: Fixed for upload flood control.** Presign and processed image uploads now share an additional 50/hour per-user Redis limit; endpoint-specific file count remains client-index based.
- R2 objects are orphaned when photos/listings/reviews are deleted. **Current state: Partial.** Listing photo deletion and review photo replacement/deletion now attempt R2 object deletion after the DB row is removed; listing archive/delete still preserves media by product decision and may need a retention cleanup policy.
- Listing photo alt text generated in `api/listings/[id]/photos` should be sanitized and capped before persistence. **Current state: Fixed.**
- New-listing submitted alt text needs server-side max length and sanitization parity with edit/photo paths. **Current state: Fixed.**
- AI review prompt should isolate user-submitted listing fields inside explicit data delimiters and redact obvious prompt-injection phrases before interpolation. **Current state: Fixed.**
- Stripe fee estimate is hardcoded to 2.9% + 30 cents and will be wrong for Amex/international/FX cases. **Current state: Fixed.** Estimated Stripe fee deduction was removed from checkout transfer math.
- Case message display-name fallback leaks email prefixes when `name` is null. **Current state: Not reproduced.** Case messages already use `name ?? email.split("@")[0] ?? "Someone"`.
- Notification dedup is per UTC day, not rolling 24 hours. **Current state: Documented in `CLAUDE.md`; accepted for now.**
- [FIXED 2026-04-26] Prevent self-feature by admin seller.
- Block records and blocked-feed behavior need deleted-user policy. **Current state: Fixed.** Block helpers ignore deleted users, and account feed now distinguishes "all followed makers are blocked" from no follows.
- Similar listings should avoid same-seller duplicates where possible. **Current state: Fixed.** Similar listing results now keep at most one listing per seller after scoring.
- Analytics `avgPriceCents` should be weighted by quantity. **Current state: Fixed.**
- Drop duplicate/legacy `viewToClickRatio` once clients use `clickThroughRate`. **Current state: Fixed.**
- Reconcile period window definitions in metrics. **Current state: Fixed for Guild metrics; calendar-month period windows and period-scoped active cases are now used.**
- R2 media validation previously accepted arbitrary legacy `*.r2.dev` URLs. **Current state: Fixed.** Write-path validation now accepts only configured Grainline R2/CDN origins and explicitly listed legacy origins; CSP no longer uses wildcard R2 media/connect sources.
- GIF/video/PDF uploads may retain metadata; current state rejects GIF uploads and strips JPEG/PNG/WebP metadata, while video/PDF metadata retention remains disclosed/product-accepted.
- Photo upload route lacks a dedicated rate limit around OpenAI alt-text/review cost amplification. **Current state: Fixed.** Active-listing photo additions now require the shared listing mutation limiter plus a dedicated `listingPhotoAiRatelimit` before triggering AI re-review/alt-text work.
- Presign extension/type handling should use an explicit allowlist in addition to MIME checks.
- Photo-add AI review currently reviews newly added photos, not the merged final set; acceptable for new-photo safety, but document the intended invariant.
- Blog featured listing rendering should re-verify ownership/visibility at render time where not already guaranteed.
- [FIXED 2026-04-26] Featured maker queries are cached through `unstable_cache`.
- Onboarding step 4 navigation should advance persisted step state, and the skip-Stripe path needs an explicit `chargesEnabled` warning.
- Reverse-geocode throttling should move from Lambda-local memory to shared Redis/Upstash state.
- Onboarding step 1 profile image state can be lost on browser back/forward navigation; persist draft/upload state.
- `advanceStep` can race under concurrent submits; use a guarded `updateMany` with expected current step. **Current state: Fixed.**
- Loading skeleton coverage is still inconsistent across key dashboard/public pages.
- [FIXED 2026-04-26] Remaining user-visible no-locale `toLocaleString`/`toLocaleDateString` calls in app/components were normalized to `en-US`.
- COOP/CORP settings should be rechecked against Stripe popup and legacy `*.r2.dev` media behavior before hardening further.
- Sitemap scale remains capped by single-file entry limits; add sitemap index splitting before large catalog growth.
- `BuyNowButton`, gallery controls, attachment remove buttons, and mobile filters need 44px touch targets and semantic button/focus-visible coverage. **Current state: Partial.** Buy Now has a 44px minimum target and focus ring; listing gallery main image is now a semantic button with focus-visible outline.
- Follow/feed UI should add retry/error affordances and accessible loading states. **Current state: Partial.** FollowButton now updates optimistically and rolls back on API/network failure.
- Cron schedules are UTC; document or adjust jobs whose business deadlines are intended to be Central time.
- `/api/health` currently does deep service pings despite docs claiming static/no-DB behavior; either split static and deep health endpoints, or update docs/monitoring.
- [FIXED 2026-04-26] CSP report endpoint is IP rate-limited before forwarding high-signal script/frame violations to Sentry.
- [FIXED 2026-04-26] Sentry `enableLogs` is disabled in server, edge, and client configs to avoid log-volume billing/noise.
- Robots/blog API allowlist and lazy-loading coverage claims need doc/code reconciliation.

## Product / Legal / Business Items Still Not Solved By Code Alone

- Attorney sign-off on Terms/Privacy.
- Money transmitter / Stripe Connect "agent of payee" confirmation.
- INFORM Consumers Act reporting/disclosure workflow if promised in Terms.
- Business/cyber/marketplace liability insurance.
- Data retention schedule for tax, fraud, cases, messages, order shipping addresses, and R2 media. **Current state: Partially fixed.** Order shipping/contact/gift-note PII has a 90-day fulfilled-order purge and Privacy Policy disclosure; remaining legal/product decisions cover cases, reports, messages, tax/fraud holds, and archived listing/R2 media.
- Decision on partial-refund inventory semantics and line-item refunds.
- Decision on whether deleted seller public content is preserved as marketplace history.
