# Grainline Open Audit Findings

Last updated: 2026-04-26

This file is the canonical fix-mode backlog for the later audit rounds. It focuses on findings from Rounds 13-18 and re-review passes that were not already closed in `CLAUDE.md`. Items are grouped by severity and practical fix batch.

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

### H8. [FIXED 2026-04-25] Notification dedup is incomplete/missing

- **Files**: `src/lib/notifications.ts`, favorites/follow routes.
- **Current state**: Fixed. `Notification` now has a shared `dedupKey` with a database unique constraint on `(userId, type, dedupKey)`. `createNotification()` computes a daily exact-content key and returns the existing notification on duplicate insert races. Favorites/follow routes no longer use fuzzy text/link-only route dedup that suppressed legitimate distinct users.
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

- **Files**: account deletion library and missing export route.
- **Impact**: Privacy promises portability/deletion beyond implemented code.
- **Fix spec**: Add `/api/account/export`; scrub/anonymize message bodies, order shipping PII, maker verification text, listing media, newsletter email, reports, and R2 objects according to retention policy.

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
- **Impact**: Personal data remains visible to counterparties.
- **Fix spec**: Define retention rules. Scrub old fulfilled order shipping details, deleted user's sent messages, R2 attachments, listing descriptions/photos, verification notes.

## Admin / Dashboard Findings

- `approveGuildMember` silently no-ops when recomputed eligibility is false. Return an inline error explaining which criterion failed.
- [FIXED 2026-04-26] `appendNote` and `markReviewed` now return `{ ok:false, error }` state through a client action form instead of crashing the admin order page.
- `updateSellerProfile` throws raw `Display name is required`. Convert to inline form error.
- `/admin/orders` and `/admin/flagged` show only `items[0]` seller. Render all seller names/items for multi-seller orders.
- [FIXED 2026-04-26] `VacationModeForm` now surfaces save errors and `Retry-After` rate-limit failures inline.
- [FIXED 2026-04-26] `/admin/audit` has an action filter and hides Undo behind explicit undoability instead of showing an expired-looking control for non-undoable actions.
- [FIXED 2026-04-26] Non-undoable moderation actions now render as "Not undoable"; admin undo API is also rate-limited.
- `/admin/verification` still risks N x `calculateSellerMetrics` per render. Cache metrics or load precomputed `SellerMetrics`.
- [FIXED 2026-04-26] `/dashboard/inventory` stock saves now serialize per row and disable quantity edits while a save is in flight.
- [FIXED 2026-04-26] `/dashboard/sales/[orderId]` now displays seller-owned item subtotal in the seller subtotal row.
- [FIXED 2026-04-26] `appendNote` now caps each append at 2,000 chars and total review notes at 10,000 chars.
- Admin prompt flows still use blocking `window.prompt`; replace with modal/action form over time.

## UX / Product Correctness Findings

- Buyer cannot delete their own review. Add `DELETE /api/reviews/[id]` for reviewer-owned reviews, with soft delete or removal policy.
- Banned users can browse public pages while signed in. Decide policy: full redirect to `/banned` for authenticated banned users, or allow public browsing but block mutations consistently. Current behavior is inconsistent.
- Banned user cart/message errors can be misleading. Return buyer-specific suspended-account messages.
- AdminPinGate should show server `Retry-After`, not a fake reset-on-refresh attempt count.
- Stripe onboarding skip/return flow can land sellers at step 4/5 with unclear status. Show explicit Stripe incomplete banner keyed by account status.
- Cart close/payment modal can orphan Stripe sessions and stock locks. Consider session cancel/release endpoint or clearer lock-expiry messaging.
- Multi-seller success/receipt views need all seller receipts/items, not just last or first seller.
- Soft-deleted saved favorites no longer show broken listing links on `/account/saved`; a richer "No longer available" history section remains optional product polish.

## Search / SEO / i18n Findings

- Slug generator strips non-ASCII: `Café` -> `caf`, CJK -> empty. Use Unicode normalization/transliteration and fallback IDs.
- Listings and sellers still primarily use CUID URLs. Slug work remains a larger SEO pass.
- Browse rating filter performs heavy review scans. Add optimized aggregate/materialized rating fields.
- Browse popular tags duplicates cached endpoint. Use ISR endpoint or shared cached query.
- Featured maker fallback query runs every homepage hit. Cache/ISR or precompute featured maker data.
- `pg_trgm` similarity/search lacks proper GIN indexes for keystroke-scale search.
- Tag autocomplete cross-joins all `Listing x unnest(tags)` at scale. Use cached tag table/materialized view.
- Browse canonical/noindex/page/filter strategy still needs one deliberate SEO decision.
- Sitemap index splitting remains future scale work.

## Schema / CI / Platform Findings

- Schema has few `@db.VarChar(N)` caps. Add caps to bounded text fields; leave long bodies as `Text`.
- Viewed cookies can leak listing IDs and hit header size limits. Cap count, compress, or move to server-side recently viewed for signed-in users.
- CI still has non-blocking lint/audit in places. Make TypeScript/build blocking; keep audit advisory if needed.
- Add `next build` to CI if not already blocking.
- Zero real test suite remains. Start with payment/webhook/refund/account-state route tests.
- `tsconfig` target ES2017 may increase bundle size. Evaluate ES2022 target with Next/browser support.
- `npm audit`: no current critical/high from dependency pass; moderate findings are mostly transitive/gated. Track Next/Clerk/maplibre updates.
- Sentry `beforeSend` filtering is missing. Add noise filtering and PII scrubbing.
- Vercel/Resend/Stripe deploy checklist needs explicit webhook registration validation.

## Medium / Low Findings To Batch Later

- `setStatus` and shop listing actions miss some `revalidatePath` calls.
- `chargesEnabled` lost mid-edit silently moves listing to draft; surface warning.
- `unhideListingAction` and `markAvailableAction` should return `publishListingAction` errors.
- Photo delete should check listing state before delete.
- `computeGlobalMeans` for quality score should move to snapshot/materialized data.
- Guild revocation/reinstatement races need stale-state guards.
- `activeCaseCount` should be period-scoped or explicitly lifetime-scoped in Guild docs.
- `payout.failed` should write a durable seller payout event ledger.
- `payment_intent.processing` / `payment_failed` handlers should be added or delayed methods should be explicitly disabled/documented.
- Missing notification types: `REFUND_ISSUED`, `ACCOUNT_WARNING`, `LISTING_FLAGGED_BY_USER`.
- Audit log subject/body should sanitize persisted user-provided strings.
- [FIXED 2026-04-26] Prevent self-feature by admin seller.
- Block records and blocked-feed behavior need deleted-user policy.
- Similar listings should avoid same-seller duplicates where possible.
- Analytics `avgPriceCents` should be weighted by quantity.
- Drop duplicate/legacy `viewToClickRatio` once clients use `clickThroughRate`.
- Reconcile period window definitions in metrics.

## Product / Legal / Business Items Still Not Solved By Code Alone

- Attorney sign-off on Terms/Privacy.
- Money transmitter / Stripe Connect "agent of payee" confirmation.
- INFORM Consumers Act reporting/disclosure workflow if promised in Terms.
- Business/cyber/marketplace liability insurance.
- Data retention schedule for tax, fraud, cases, messages, order shipping addresses, and R2 media.
- Decision on partial-refund inventory semantics and line-item refunds.
- Decision on whether deleted seller public content is preserved as marketplace history.
