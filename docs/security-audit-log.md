# Grainline Security Audit Log

Last updated: 2026-05-13

This is the working log for security hardening passes. Only verified findings should be promoted to `audit_open_findings.md`.

## Pass 1: Authorization And IDOR Inventory

Started: 2026-05-13

Initial inventory:

- API route handlers: 100
- Files containing server actions: 20
- Test files: 117

Mechanical sweeps started:

- Dynamic route parameters and body/search IDs.
- Prisma `where: { id }` reads/mutations.
- Server actions with `"use server"`.
- Middleware-public routes vs route-local authentication.

Spot checks completed in this pass:

- `src/app/api/reviews/[id]/route.ts`
  - PATCH/DELETE resolve Clerk user to local `User`.
  - Banned/deleted users are blocked.
  - Review owner check (`review.reviewerId === me.id`) is enforced before edit/delete.
  - Result: no verified IDOR found.

- `src/app/api/orders/[id]/fulfillment/route.ts`
  - Resolves Clerk user, blocks banned/deleted users, resolves seller profile.
  - `ensureSellerOwnsOrder()` requires at least one order item to belong to that seller before fulfillment mutation.
  - Blocks active cases/refunded orders and invalid state transitions.
  - Result: no verified IDOR found in the inspected section.

- `src/app/api/commission/[id]/route.ts`
  - GET is intentionally public but hides missing, banned/deleted buyer, and expired requests.
  - PATCH requires auth, local user, non-banned/non-deleted account, buyer ownership, OPEN status, and non-expired state.
  - Result: no verified IDOR found in the inspected section.

- `src/app/api/cases/[id]/mark-resolved/route.ts`
  - Requires auth and local user.
  - Requires requester to be buyer or seller on the case.
  - Final SQL update repeats participant and status predicates atomically.
  - Result: no verified IDOR found.

- `src/app/api/orders/[id]/refund/route.ts`
  - Requires auth, local user, non-suspended account, seller profile, and at least one order item owned by that seller.
  - Refund lock uses `sellerRefundId` sentinel plus ledger checks before Stripe refund.
  - Current checkout trace shows orders are seller-scoped: `/api/cart/checkout-seller` signs `sellerId` into Stripe metadata and the webhook filters cart items by that `sellerId` before `Order` creation.
  - Result: no verified IDOR found in the inspected seller-refund route.
  - Invariant to preserve: buyer checkout must continue creating one order per seller. If future code creates mixed-seller orders, seller order routes using "owns any item" must be tightened first.

- `src/app/api/orders/[id]/label/route.ts`
  - Requires auth, local user, non-suspended account, seller profile, and at least one order item owned by that seller.
  - Blocks purchased labels, refunded orders, active cases, pickup orders, and terminal fulfillment states.
  - Rate selection is constrained to the order's stored rate or an unexpired quote set.
  - Result: no verified IDOR found in the inspected label-purchase route under the seller-scoped order invariant.

- `src/app/api/cases/[id]/resolve/route.ts`
  - Requires auth and local user.
  - Requires `EMPLOYEE` or `ADMIN` role before case resolution.
  - Refund lock and final case update repeat status preconditions and record orphaned Stripe-refund states for manual reconciliation.
  - Result: no verified IDOR found in the inspected admin case-resolution route.

- `src/app/messages/[id]/page.tsx`
  - Requires auth and local user.
  - Non-staff users must be conversation participants.
  - Staff access is limited to unresolved reported threads.
  - `sendMessage` rechecks participant membership, account availability, block state, and first-party attachment URLs before creating a message.
  - Result: no verified IDOR found in the inspected page/action path.

- `src/app/api/messages/[id]/list/route.ts`
  - Requires auth and local user.
  - Requires requester to be a conversation participant before listing messages.
  - Result: no verified IDOR found.

- `src/app/api/messages/[id]/read/route.ts`
  - Requires auth and local user.
  - Requires requester to be a conversation participant before marking only that user's received messages as read.
  - Result: no verified IDOR found.

- `src/app/api/messages/[id]/stream/route.ts`
  - Requires auth and local user.
  - Requires requester to be a conversation participant before opening the SSE poll stream.
  - Result: no verified IDOR found.

- `src/app/api/messages/custom-order-request/route.ts`
  - Requires auth, local user, non-suspended account, rate limit, no self-message, and no block in either direction.
  - Requires target user to be an active seller accepting custom and new orders with connected payouts.
  - Optional listing context is accepted only when it belongs to that seller and is active/public.
  - Result: no verified IDOR found.

- `src/app/api/account/export/route.ts`
  - Uses `ensureUser()` and account export rate limiting.
  - Export queries are scoped to the current user by `user.id`, owned seller profile, buyer orders, seller-owned order items, sent/received messages, cases as buyer/seller, and current user's saved/followed records.
  - Audit logging is required before returning the JSON download.
  - Result: no verified IDOR found.

- `src/app/api/account/delete/route.ts`
  - Requires auth and `ensureUser()`.
  - Pending-sale/case blockers are scoped to the current user before deletion.
  - `anonymizeUserAccount()` is called with the current user's database ID.
  - Result: no verified IDOR found in the route wrapper.

- `src/app/dashboard/seller/page.tsx`
  - Seller settings server action requires auth and `ensureSeller()`.
  - Updates target the current seller profile ID only.
  - Result: no verified IDOR found in the inspected action path.

- `src/app/dashboard/profile/page.tsx`
  - Profile update, FAQ add/delete, avatar removal, and featured-listing toggle actions require auth and `ensureSeller()` or the current user.
  - Featured-listing toggle verifies the listing belongs to the current seller before updating the seller profile.
  - Result: no verified IDOR found in the inspected action path.

- `src/app/api/dev/make-order/route.ts`
  - Dev fixture route is disabled unless `NODE_ENV !== "production"`, `VERCEL_ENV` is absent, and `ENABLE_DEV_MAKE_ORDER === "true"`.
  - Requires auth and non-suspended local user even when enabled.
  - Result: no verified production exposure found.

- `src/middleware.ts`
  - No DB row-level security policies were found in the migration/schema grep pass.
  - Application-layer middleware enforces signed-in redirects for non-public routes, suspended account blocks, terms acceptance, admin role checks, admin PIN checks for admin APIs/server-action POSTs, cron bearer auth, and geo restrictions.
  - Result: RLS is not currently implemented; application-layer authorization remains the launch-critical control plane. RLS rollout planning is documented in `docs/rls-feasibility-plan.md`; do not enable broad production policies before the staged prototype proves role separation and transaction-local request context.

- `src/app/api/cases/[id]/messages/route.ts`
  - Requires auth, local user, rate limit, participant or staff role, valid case status, and available counterparty account state.
  - Status transition is guarded with an atomic `updateMany` status precondition before message creation.
  - Result: no verified IDOR found.

- `src/app/api/cases/[id]/escalate/route.ts`
  - Accepts CRON secret or authenticated local user.
  - Bulk escalation is staff/cron only.
  - Single escalation requires staff/cron or buyer/seller participation plus unlock-time/counterparty availability rules.
  - Result: no verified IDOR found.

- `src/app/api/notifications/[id]/read/route.ts`
  - Requires auth and local user.
  - `updateMany` scopes notification mutation to `{ id, userId: me.id }`.
  - Result: no verified IDOR found.

- `src/app/api/search/saved/route.ts`
  - POST/GET/DELETE require auth/local user and are scoped to `userId: me.id`.
  - DELETE uses `deleteMany({ id, userId: me.id })`.
  - Result: no verified IDOR found.

- `src/app/api/users/[id]/block/route.ts`
  - Requires auth/local user, blocks self-block, and writes/deletes only rows with `blockerId: me.id`.
  - Result: no verified IDOR found.

- `src/app/api/users/[id]/report/route.ts`
  - Requires auth/local user and rate limit.
  - Validates the reported user exists and target IDs are associated with the reported user before creating a report.
  - Result: no verified IDOR found, but privacy/abuse pass should revisit whether reporters must also have access to private targets such as orders or message threads.

- `src/app/api/follow/[sellerId]/route.ts`
  - Public GET uses `visibleSellerProfileWhere`.
  - POST requires auth/local user, visible seller, no self-follow, and no block in either direction.
  - DELETE removes only the current user's follow row.
  - Result: no verified IDOR found.

- `src/app/api/shipping/quote/route.ts`
  - Requires auth/local user.
  - Cart mode verifies explicit `cartId` belongs to the current user and filters seller-scoped carts before quote signing.
  - Single mode repeats checkout availability checks for active/private/self-purchase/seller-state/stock.
  - Signed rates include context ID, buyer ID, and buyer postal code.
  - Result: no verified IDOR found.

- `src/app/api/admin/listings/[id]/route.ts`
  - Middleware enforces staff role plus admin PIN for admin API calls.
  - Route-local check requires `ADMIN` role before removing a listing.
  - Result: no verified IDOR found.

- `src/app/api/admin/listings/[id]/review/route.ts`
  - Middleware enforces staff role plus admin PIN for admin API calls.
  - Route-local check allows `ADMIN` or `EMPLOYEE`.
  - Approve/reject mutations are status-guarded to `PENDING_REVIEW`.
  - Result: no verified IDOR found.

- `src/app/api/admin/users/[id]/ban/route.ts`
  - Middleware enforces staff role plus admin PIN for admin API calls.
  - Route-local check requires `ADMIN`, blocks self-ban, and blocks banning admin accounts.
  - Result: no verified IDOR found.

- `src/app/api/admin/audit/[id]/undo/route.ts`
  - Middleware enforces staff role plus admin PIN for admin API calls.
  - Route-local check requires `ADMIN`; undo policy is delegated to `undoAdminAction()`.
  - Result: no verified IDOR found in the route wrapper.

- `src/app/api/admin/email/route.ts`
  - Middleware enforces staff role plus admin PIN for admin API calls.
  - Route-local check requires `ADMIN`, validates recipient, checks suppression, and logs the admin action.
  - Result: no verified IDOR found.

- `src/app/api/admin/reports/[id]/resolve/route.ts`
  - Middleware enforces staff role plus admin PIN for admin API calls.
  - Route-local check allows `ADMIN` or `EMPLOYEE`.
  - Result: no verified IDOR found. Later robustness pass can make the missing-report path return a controlled 404 instead of relying on Prisma's throw.

- `src/app/api/admin/reviews/[id]/route.ts`
  - Middleware enforces staff role plus admin PIN for admin API calls.
  - Route-local check requires `ADMIN` before review deletion.
  - Result: no verified IDOR found.

- `src/app/api/reviews/route.ts`
  - Requires auth/local user, account availability, review rate limit, no self-review, and active seller account state.
  - Review creation requires a paid delivered/picked-up order item for the current buyer and listing inside the review window.
  - Review photos are limited to first-party media URLs.
  - Result: no verified IDOR found.

- `src/app/api/reviews/[id]/reply/route.ts`
  - Requires auth and rate limit.
  - The review is loaded through its listing and seller; only the seller owner's Clerk user can reply.
  - Suspended/deleted seller accounts are blocked and only one seller reply is allowed.
  - Result: no verified IDOR found.

- `src/app/api/blog/[slug]/comments/route.ts`
  - Public GET uses `publicBlogPostWhere()` and returns only approved comments from active users.
  - POST requires auth/local user, active account state, comment rate limit, public post visibility, and parent comment membership in the same post before creating an unapproved comment.
  - Result: no verified IDOR found.

- `src/app/api/blog/[slug]/save/route.ts`
  - GET returns a safe false state for unauthenticated or unavailable accounts.
  - POST/DELETE require auth/local user, account availability, rate limit, and public post visibility; saves are scoped to the current user's `SavedBlogPost` row.
  - Result: no verified IDOR found.

- `src/app/api/verification/apply/route.ts`
  - Requires `ensureSeller()` and account availability.
  - Server recomputes eligibility from seller-owned active public listings, delivered/picked-up sales, account age, and unresolved long-running cases.
  - Application upsert is scoped to the current seller profile.
  - Result: no verified IDOR found.

- `src/app/api/seller/broadcast/route.ts`
  - Requires auth/local user, active seller profile, connected payouts, non-vacation shop, weekly rate limit, and first-party optional image URL.
  - GET/POST operate only on the current seller profile; notification fan-out targets followers of that seller only.
  - Result: no verified IDOR found.

- `src/app/api/seller/vacation/route.ts`
  - Requires auth, vacation-mode rate limit, and `ensureSeller()`.
  - Mutation targets only the current seller profile.
  - Result: no verified IDOR found.

- `src/app/api/seller/analytics/route.ts` and `src/app/api/seller/analytics/recent-sales/route.ts`
  - Require auth/local user and current seller profile before returning analytics.
  - Analytics are seller-scoped through the current seller ID. Recent-sales read surface was hardened to require whole-order ownership, not partial item ownership, before returning whole-order totals.
  - Result: no verified live IDOR found; defense-in-depth fix applied for malformed mixed-seller order resilience.

- `src/app/dashboard/blog/new/page.tsx`, `src/app/dashboard/blog/[id]/edit/page.tsx`, and `src/app/dashboard/blog/page.tsx`
  - Blog create/edit actions require auth, local user, active account state, author ownership, staff-only post types where applicable, first-party cover URLs, normalized video URLs, and seller-owned featured listings for maker posts.
  - Blog delete action was tightened to check suspended/deleted account state inside the server action before deleting author-owned posts.
  - Result: no verified IDOR found; defense-in-depth account-state fix applied to the delete server action.

- `src/app/admin/actions.ts`, `src/app/admin/support/actions.ts`, `src/app/admin/blog/page.tsx`, `src/app/admin/broadcasts/page.tsx`, and `src/app/admin/verification/page.tsx`
  - Middleware already enforces signed-in admin role checks and signed Admin PIN checks for admin APIs and server-action POSTs.
  - Server actions also re-check staff authority before mutation. During this pass, admin order/support/blog/broadcast action helpers were tightened to select and reject suspended/deleted staff accounts inside the action itself, matching the stronger `admin/verification/page.tsx` helper.
  - Guild approval/rejection/revocation/reinstatement/feature actions use status or state preconditions and log `AdminAuditLog` entries.
  - Blog moderation and broadcast deletion actions are admin/staff-only and log admin actions; no private user self-service path calls these actions.
  - Result: no verified IDOR found; defense-in-depth suspended/deleted staff guard added for consistency.

- Admin pages/APIs local role gates
  - `src/app/admin/audit/page.tsx`, `src/app/admin/support/page.tsx`, `src/app/admin/review/page.tsx`, `src/app/admin/users/page.tsx`, `src/app/admin/reports/page.tsx`, and `src/app/admin/reviews/page.tsx` now select and reject suspended/deleted staff accounts in their local page-level role checks.
  - `src/app/api/admin/listings/[id]/route.ts`, `src/app/api/admin/listings/[id]/review/route.ts`, `src/app/api/admin/users/[id]/ban/route.ts`, `src/app/api/admin/audit/[id]/undo/route.ts`, `src/app/api/admin/email/route.ts`, `src/app/api/admin/reports/[id]/resolve/route.ts`, `src/app/api/admin/reviews/[id]/route.ts`, and `src/app/api/admin/verify-pin/route.ts` now do the same at the route-local API gate.
  - Result: no verified IDOR found; local admin gates now consistently reject suspended/deleted staff even if middleware/layout assumptions change.

- Account/cart/notification/favorite route batch
  - `src/app/api/account/feed/route.ts` requires auth/local user, blocks suspended/deleted accounts through `ensureUserByClerkId()`, reads followed sellers from `followerId: me.id`, removes blocked sellers, and applies active seller/listing/blog visibility predicates before returning feed items.
  - `src/app/api/account/shipping-address/route.ts` requires auth/local user and reads/writes only the current `User.id`.
  - `src/app/api/account/notifications/preferences/route.ts` requires auth/local user, validates the preference key against `VALID_PREFERENCE_KEYS`, and updates only the current user's JSON preferences.
  - `src/app/api/notifications/route.ts`, `src/app/api/notifications/[id]/read/route.ts`, and `src/app/api/notifications/read-all/route.ts` scope notification reads/mutations to the current user ID.
  - `src/app/api/cart/route.ts`, `src/app/api/cart/add/route.ts`, and `src/app/api/cart/update/route.ts` require auth/local user and read/mutate only the current user's cart. Add/update routes re-check listing availability, seller account state, self-purchase, private reservation, variant selection, and made-to-order quantity constraints.
  - `src/app/api/favorites/route.ts` and `src/app/api/favorites/[listingId]/route.ts` require auth/local user and create/delete only the current user's favorite rows; favorite creation uses public listing-detail visibility and blocks self-favorites.
  - `src/app/api/listings/[id]/notify/route.ts` requires auth/local user, uses public listing-detail visibility, and creates/deletes only the current user's stock notification row.
  - `src/app/api/listings/[id]/stock/route.ts` requires auth/local seller ownership before patching stock. The stock route intentionally does not proactively expire open Checkout Sessions when a seller sets stock to zero: Stripe expired-session webhooks restore reserved stock, so expiring in that path would fight the seller's explicit zero-stock action. Payment completion still revalidates listing status and refunds blocked stale checkouts.
  - `src/app/api/listings/[id]/photos/route.ts` is intentionally retired with HTTP 410 so listing edit photo changes stay staged until Save.
  - `src/app/api/listings/[id]/view/route.ts`, `src/app/api/listings/[id]/click/route.ts`, `src/app/api/listings/recently-viewed/route.ts`, and `src/app/api/listings/[id]/similar/route.ts` use public visibility predicates, bot/rate-limit guards where applicable, and avoid exposing private listing rows.
  - `src/app/api/me/route.ts` returns only current-session account/seller summary fields and rejects suspended/deleted signed-in users through `ensureUserByClerkId()`.
  - Result: no verified IDOR found in this inspected route batch.

Out-of-scope verified issue found during this pass:

- Existing-listing photo edits were not fully save-gated. This was not an authorization bypass because ownership checks were present, but it contradicted the intended "listing edits commit on Save, then AI review runs" behavior. Fixed after promotion to `audit_open_findings.md`: `EditPhotoGrid` now stages `photoManifestJson`, `updateListing()` commits the manifest, and the old immediate photo API returns HTTP 410.

## 2026-05-13 payment/webhook/upload spot check

Scope:

- `src/app/api/cart/checkout/single/route.ts`
- `src/app/api/cart/checkout-seller/route.ts`
- `src/app/api/stripe/webhook/route.ts`
- `src/app/api/stripe/webhook/v2/route.ts`
- `src/app/api/upload/image/route.ts`
- `src/app/api/upload/presign/route.ts`
- `src/app/api/upload/verify/route.ts`
- `src/lib/urlValidation.ts`
- `src/lib/checkoutSessionLock.ts`
- `src/lib/checkoutStockRestore.ts`

Results:

- Checkout uses Stripe-hosted embedded Checkout Sessions with `transfer_data.amount` rather than collecting card data directly. This keeps raw card handling out of Grainline's database and app code.
- Checkout routes re-check authentication/local account state, seller orderability, private listing access, self-purchase, signed shipping-rate tokens, variant selections, minimum seller-transfer math, and atomic stock reservation before creating a Stripe session.
- Checkout locks use Redis payload hashes and session IDs to prevent duplicate sessions from silently diverging. Stock restoration is wired for expired/failed sessions and guarded by transaction-level advisory locks plus idempotency records.
- Legacy Stripe snapshot webhooks and Connect v2 thin webhooks use separate routes and separate signing secrets. Both routes reject missing/invalid signatures, stale events, and duplicate event IDs through `stripeWebhookEvent` state.
- Upload image route processes images server-side through `sharp`, strips metadata, enforces endpoint-specific size/type/count rules, requires seller profile for seller-only endpoints, and deletes objects when post-upload public availability checks fail.
- Direct presign route rejects all image MIME types so images cannot bypass processing/metadata stripping. Direct uploads require signed verification tokens, user-scoped keys, matching object size, and matching content type before callers can treat the object as accepted.
- Result: payment/webhook/upload controls were broadly sound, with one legacy checkout-success trust-boundary hardening item found and fixed below.

Hardening notes:

- Grainline still handles sensitive business data even though Stripe handles raw card data: user accounts, addresses, orders, messages, upload content, seller payout state, refund state, admin tools, and webhook-derived payment state.
- RLS is not currently enabled as a broad database policy layer. Current protection is Clerk middleware plus route/action-level ownership predicates. Targeted RLS or lower-privilege database roles should follow `docs/rls-feasibility-plan.md` after route predicates are fully inventoried.
- Open checkout sessions are proactively expired when a seller enters vacation mode or an active listing leaves buyer availability through hide, mark-sold, archive, AI hold, disconnected-seller draft, or AI-error hold paths. Successful proactive expiration also calls the idempotent stock-restore helper; the Stripe webhook still revalidates buyer/seller/listing state at payment completion and refunds blocked checkouts as the backstop.

Follow-up fix from this pass:

- **Fixed 2026-05-13:** cart checkout webhook finalization no longer trusts mutable live `CartItem` rows after payment. Stripe's immutable paid `line_items` are now the source of truth for `OrderItem` creation, live cart rows are only optional enrichment for variant labels, and the transaction revalidates seller vacation/orderability plus listing active/private-reservation state before order side effects. Regression coverage lives in `tests/stripe-webhook-cart-finalization.test.mjs` and `tests/stripe-webhook-state.test.mjs`.
- **Fixed 2026-05-13:** seller order mutation routes now require whole-order ownership. Refund, fulfillment, and label-purchase routes no longer authorize on "seller owns any item" because that would be unsafe if a malformed mixed-seller order ever existed. Regression coverage lives in `tests/order-seller-route-ownership.test.mjs`.
- **Fixed 2026-05-13:** seller order read surfaces now match the whole-order ownership rule. Recent-sales analytics, seller sales page, account seller stats, account export, seller profile processing-time stats, account deletion blockers, and ban blockers require `items.some` and `items.every` for the same seller before exposing or acting on seller-order data. Regression coverage lives in `tests/order-seller-route-ownership.test.mjs`.
- **Fixed 2026-05-13:** dashboard blog delete action now checks banned/deleted account state inside the server action before deleting an author-owned post. Regression coverage lives in `tests/blog-action-guardrails.test.mjs`.
- **Fixed 2026-05-13:** user report target validation now requires reporter access. Reports can still target public content, but orders/messages/threads require reporter participation and blog targets require public visibility, preventing report submission from acting as a private-object oracle. Regression coverage lives in `tests/user-report-target-access.test.mjs`.
- **Fixed 2026-05-13:** review helpful votes now require the review's listing to pass `canViewListingDetail()` for the voter. This prevents hidden/private listing reviews from being manipulated by direct review ID. Regression coverage lives in `tests/review-vote-visibility.test.mjs`.
- **Fixed 2026-05-13:** checkout success no longer writes orders. The old legacy hosted-checkout fallback `order.create` paths were removed because no active hosted checkout route remains and the success page should not derive paid orders from mutable post-payment cart/listing state. `/checkout/success` now verifies `metadata.buyerId` against the signed-in user and only reads buyer-scoped orders; the Stripe webhook remains the sole order writer. Regression coverage lives in `tests/checkout-success-state.test.mjs`.
- **Fixed 2026-05-13:** blog markdown no longer renders arbitrary remote images. Rendering now goes through `src/lib/blogMarkdown.ts`, which keeps the existing `sanitize-html` XSS boundary, drops user-supplied `target`/`rel` attributes, permits only `https`/`mailto` schemes, caps markdown before parsing, and removes `<img>` tags unless the URL passes `isR2PublicUrl()`. Regression coverage lives in `tests/blog-markdown-sanitization.test.mjs`.
- **Fixed 2026-05-13:** all audited `target="_blank"` links in app/components now carry an explicit `rel` boundary. Regression coverage lives in `tests/link-security.test.mjs`.
- **Fixed 2026-05-13:** public vulnerability disclosure is now live at `/security` and `/.well-known/security.txt`. Both routes are public, terms-gate-exempt, suspended-account-exempt, and geo-block-exempt; launch ops must verify `security@thegrainline.com` mailbox routing before public launch. Regression coverage lives in `tests/security-disclosure.test.mjs`.
- **Fixed 2026-05-13:** CSP report handling now sanitizes Sentry payloads and tags checkout/cart document violations with `checkout_surface=true`. This preserves payment-page monitoring evidence without sending checkout query strings or external blocked-URL paths to Sentry tags/extra. Regression coverage lives in `tests/csp-report-sanitization.test.mjs`.
- **Documented 2026-05-13:** checkout/payment-page browser script inventory is recorded in `docs/checkout-script-inventory.md`. It documents the Stripe Embedded Checkout path, Clerk/Sentry runtime presence, no direct `next/script` usage on checkout surfaces, and a change-control rule for future checkout scripts. Regression coverage lives in `tests/checkout-script-inventory.test.mjs`.
- **Fixed 2026-05-13:** seller vacation mode and listing availability transitions now proactively expire matching open Stripe Checkout Sessions and run idempotent stock restoration after successful expiration. This prevents buyers from completing stale sessions after a seller/listing becomes unavailable, while keeping webhook payment-completion revalidation/refund logic as the final backstop. Regression coverage lives in `tests/checkout-session-expiry.test.mjs`.
- **Hardened 2026-05-13:** upload key ownership verification now uses the same sanitized user-segment algorithm as presign and processed-image key creation, preventing path-unsafe Clerk IDs from drifting between signed keys and ownership checks. Direct-upload verification cleanup failures now emit Sentry evidence with `source: "upload_verify_cleanup"`. Regression coverage lives in `tests/upload-verification-token.test.mjs` and `tests/upload-ux-followups.test.mjs`.
- **Hardened 2026-05-13:** fulfillment notification/email side-effect failures no longer mask successful order status mutations with false 500 responses; seller-refund buyer notification/email failures, label lock rollback/orphan-record failures, and checkout stock-restoration failures now emit bounded Sentry evidence instead of silent best-effort catches. Regression coverage lives in `tests/payment-side-effect-observability.test.mjs`.

## 2026-05-13 public form/privacy telemetry spot check

Scope:

- `src/app/api/account/accept-terms/route.ts`
- `src/app/api/legal/data-request/route.ts`
- `src/app/api/support/route.ts`
- `src/app/api/newsletter/route.ts`
- `src/app/api/email/unsubscribe/route.ts`
- `src/lib/supportRequest.ts`
- `src/lib/emailSuppression.ts`
- `src/lib/unsubscribe.ts`

Results:

- Terms acceptance is authenticated, rate limited, scoped to the current local user, and pins the current terms version.
- Legal/data-request and support forms are intentionally public, IP-rate-limited, Zod/sanitizer-backed through `supportRequest.ts`, persisted before email delivery, and return a request ID/SLA timestamp without exposing private account data.
- Newsletter subscription normalizes email, checks suppression state before upsert, and does not expose subscriber rows.
- Unsubscribe uses signed tokens; GET renders confirmation only and POST performs the mutation.
- Email suppression continues to fail closed for invalid email input and throws on persistence failure so callers do not treat a failed suppression lookup/write as safe.

Follow-up fix from this pass:

- **Fixed 2026-05-13:** support/data-request routes and email suppression failures no longer send raw email addresses to Sentry `extra` payloads. They now use `hashEmailForTelemetry()` for deterministic non-raw correlation when needed. Regression coverage lives in `tests/privacy-telemetry.test.mjs`.

## 2026-05-13 Stripe Connect/account-lifecycle route spot check

Scope:

- `src/app/api/stripe/connect/create/route.ts`
- `src/app/api/stripe/connect/status/route.ts`
- `src/app/api/stripe/connect/login-link/route.ts`
- `src/app/api/stripe/connect/dashboard/route.ts`
- `src/app/api/account/delete/route.ts`
- `src/lib/accountDeletion.ts`

Results:

- Connect account creation uses the Accounts v2 raw endpoint, idempotent creation keys, safe internal return URLs, supported-version checks, and current-user seller ownership.
- Connect status/login-link routes require a signed-in local user, apply account-state checks, and scope reads/writes to the current seller profile.
- Account deletion checks open obligations before deleting the Clerk user, rejects connected Stripe accounts before local anonymization, uses the 30-second local deletion transaction, explicitly disables seller orderability, and logs partial-failure reconciliation evidence.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** the older `/api/stripe/connect/dashboard` route now matches the newer Connect routes by resolving `ensureUserByClerkId()` and passing `accountAccessErrorResponse()` before issuing a Stripe dashboard login link. This prevents the route from relying only on middleware for banned/deleted local-account state. Regression coverage lives in `tests/stripe-connect-v2.test.mjs`.

## 2026-05-13 messaging/custom-order route spot check

Scope:

- `src/app/api/messages/[id]/list/route.ts`
- `src/app/api/messages/[id]/read/route.ts`
- `src/app/api/messages/[id]/stream/route.ts`
- `src/app/api/messages/custom-order-request/route.ts`
- `src/app/api/messages/unread-count/route.ts`
- `src/app/messages/new/page.tsx`
- `src/app/messages/[id]/page.tsx`

Results:

- Message list/read/stream routes resolve the signed-in local user, reject suspended/deleted accounts, require current-user conversation participation, and only then return or mutate message state.
- Staff reported-thread review remains page-only and read-only for non-participants; live polling and read marking remain participant-scoped.
- New conversation creation blocks self-conversations, unavailable recipients, mutual blocks, and private listing contexts that are not visible to the two participants.
- Custom-order requests block self-targeting, mutual blocks, unavailable sellers, sellers not accepting custom/new orders, disconnected payout state, invalid listing context, invalid budget values, and use race-safe canonical conversation creation.
- Unread-count is current-user scoped and returns a safe zero for signed-out users.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** message thread archive/unarchive server actions now reject banned/deleted local accounts inside the action before mutating conversation archive state, and custom-order request email failures now emit Sentry evidence instead of being swallowed by a silent non-fatal catch. Regression coverage lives in `tests/custom-order-admin-thread-followups.test.mjs`.

## 2026-05-13 case/dispute route spot check

Scope:

- `src/app/api/cases/route.ts`
- `src/app/api/cases/[id]/messages/route.ts`
- `src/app/api/cases/[id]/escalate/route.ts`
- `src/app/api/cases/[id]/mark-resolved/route.ts`
- `src/app/api/cases/[id]/resolve/route.ts`

Results:

- Case creation is buyer-only for the order, blocks duplicate cases and already-refunded orders, respects shipment/estimated-delivery timing unless seller unavailability/review-needed state applies, rate-limits creation, and logs the buyer action.
- Case messages require buyer/seller participation or staff role, block closed statuses, reject unavailable counterparties for party-to-party messages, and use a status precondition in the transaction before creating the message.
- Escalation is cron/staff-only for bulk escalation and participant/staff/cron-scoped for single cases. Participant escalation respects the unlock time unless the counterparty account is unavailable.
- Mark-resolved requires buyer/seller participation and uses one atomic SQL update scoped by case ID, actor participation, and active status.
- Staff case resolution is staff-only, rate-limited, uses refund locks and stale-lock release, blocks duplicate refund/dispute ledger state, caps partial refunds, records Stripe-orphaned refund evidence, and uses a status precondition before persisting resolution.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** case message email side effects, case-resolved email side effects, case-resolution audit logging, refund-lock release failure, and orphaned-refund review-note remediation failures now emit Sentry evidence instead of silent `catch {}` / empty `.catch()` blocks. Regression coverage lives in `tests/case-observability-followups.test.mjs`.

## 2026-05-13 reviews/reports/block/follow route spot check

Scope:

- `src/app/api/reviews/route.ts`
- `src/app/api/reviews/[id]/route.ts`
- `src/app/api/reviews/[id]/reply/route.ts`
- `src/app/api/reviews/[id]/vote/route.ts`
- `src/app/api/users/[id]/block/route.ts`
- `src/app/api/users/[id]/report/route.ts`
- `src/app/api/follow/[sellerId]/route.ts`
- `src/app/api/favorites/route.ts`
- `src/app/api/favorites/[listingId]/route.ts`

Results:

- Review creation is authenticated, rate-limited, blocks self-review and banned/deleted target sellers, requires a paid delivered/picked-up order within the review window, rejects refunded order contexts, caps first-party review photos, and persists review/photo rows in a transaction.
- Review edit/delete is owner-only, rejects banned/deleted local accounts, respects seller-reply and 90-day edit locks, caps first-party replacement photos, and keeps rating-summary refresh/photo cleanup outside the primary mutation.
- Seller replies are restricted to the listing owner seller account and blocked for banned/deleted seller users.
- Review helpful votes require the review's listing to pass `canViewListingDetail()` for the voter and block reviewer/seller self-votes.
- User block/report routes are signed-in, account-state checked, rate-limited, self-action blocked, and target-aware. Reports require reporter access to private targets instead of acting as a private-object oracle.
- Follow/favorite routes scope mutations to the signed-in user, use public/visible listing and seller predicates, block self-actions where applicable, and treat owner notifications as non-blocking side effects.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** review rating-summary/email failures, review-photo R2 cleanup failures, listing-report notification failures, favorite upsert/notification failures, and block follow-cleanup failures now emit Sentry evidence using safe internal IDs or media hostnames. Raw emails, comments, report details, full media URLs, and address-like values are intentionally excluded. Regression coverage lives in `tests/review-report-observability.test.mjs`.

## 2026-05-13 commission/custom-work route spot check

Scope:

- `src/app/api/commission/route.ts`
- `src/app/api/commission/[id]/route.ts`
- `src/app/api/commission/[id]/interest/route.ts`
- `src/app/api/cron/commission-expire/route.ts`
- `src/app/commission/[param]/page.tsx`
- `src/app/commission/new/page.tsx`
- `src/lib/commissionState.ts`
- `src/lib/commissionExpiry.ts`

Results:

- Public commission reads use `openCommissionWhere()`/`commissionIsExpired()` so closed, expired, banned-buyer, or deleted-buyer requests are hidden from public board/detail surfaces.
- Commission creation is signed-in, rate-limited, banned/deleted-account blocked, Zod-backed, budget-capped, first-party-reference-image constrained, and applies a separate IP limiter when reference images are included.
- Commission close/fulfill is buyer-owner-only and uses `openCommissionMutationWhere()` inside the write predicate so stale reads cannot mutate terminal, expired, or inactive-buyer requests.
- Commission interest creation is seller-only, requires connected non-vacation sellers, blocks own-request interest, mutual blocks, duplicate interest, closed/expired requests, and uses a transaction with the shared open-request write predicate before creating the conversation/interest and updating counts.
- The commission expiry cron is cron-authenticated, bounded by batch/concurrency limits, idempotently updates only still-open rows, and captures per-record failures through Sentry.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** commission geo-assignment failures, close/fulfill notification failures, and interest-created message/notification failures now emit Sentry evidence with safe commission/conversation/user/seller-profile IDs. The interest route no longer selects the buyer email address because it is not needed for the side effects. Regression coverage lives in `tests/commission-observability-followups.test.mjs`.

## 2026-05-13 admin/moderation route spot check

Scope:

- `src/app/api/admin/listings/[id]/route.ts`
- `src/app/api/admin/listings/[id]/review/route.ts`
- `src/app/api/admin/reports/[id]/resolve/route.ts`
- `src/app/api/admin/reviews/[id]/route.ts`
- `src/app/api/admin/users/[id]/ban/route.ts`
- `src/app/api/admin/audit/[id]/undo/route.ts`
- `src/app/api/admin/email/route.ts`
- `src/app/api/admin/verify-pin/route.ts`
- `src/app/admin/actions.ts`
- `src/app/admin/support/actions.ts`
- `src/app/admin/verification/page.tsx`
- `src/lib/audit.ts`
- `src/lib/ban.ts`

Results:

- Admin APIs/pages/actions re-check local role plus banned/deleted state at the access point instead of relying only on middleware or layout state.
- Destructive admin listing/review/user actions require `ADMIN`; staff review/report/support/order actions allow `ADMIN | EMPLOYEE` where intended.
- Admin listing review uses a pending-status precondition for approve/reject writes, and custom-order ready-link side effects remain idempotent through `customOrderReadyLink.ts`.
- User ban/unban flows block admin-target bans, write durable audit metadata, disable seller orderability on ban, close open buyer commission requests, mark open seller orders for review, expire open checkout sessions for banned sellers, and sync Clerk session state after the local transaction.
- Admin PIN verification uses account and IP rate limits, constant-time digest comparison, signed HTTP-only cookies, and audit/Sentry evidence for rate-limit and failed-auth cases.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** staff listing removal now proactively expires matching open Stripe Checkout Sessions; admin report resolution is rate-limited and stale-safe; admin listing-review notifications/Founding Maker grants, custom-order ready emails, admin review rating/photo cleanup, admin email send/notification/audit side effects, and admin verification emails now emit Sentry evidence with bounded IDs or hashed email telemetry. Regression coverage lives in `tests/admin-moderation-observability.test.mjs`.

## 2026-05-13 account/privacy route spot check

Scope:

- `src/app/api/account/accept-terms/route.ts`
- `src/app/api/account/delete/route.ts`
- `src/app/api/account/export/route.ts`
- `src/app/api/legal/data-request/route.ts`
- `src/app/api/support/route.ts`
- `src/app/api/newsletter/route.ts`
- `src/app/api/email/unsubscribe/route.ts`
- `src/app/api/clerk/webhook/route.ts`
- `src/app/api/resend/webhook/route.ts`
- `src/lib/supportRequest.ts`
- `src/lib/unsubscribe.ts`

Results:

- Terms acceptance is authenticated, rate-limited, version-pinned, and writes durable `termsAcceptedAt`, `termsVersion`, and `ageAttestedAt` state for the current user only.
- Account deletion blocks open obligations, returns a terminal error when Clerk deletion succeeds but local anonymization fails, and emits Sentry evidence for both Clerk deletion and anonymization failures.
- Account export is authenticated, rate-limited, buyer/seller scoped, and requires an `ACCOUNT_EXPORT` audit row before returning the export download.
- Support and data-request forms are public but IP-rate-limited, normalized/sanitized, stored before email delivery, and keep email-delivery errors on the `SupportRequest` row without blocking the user receipt.
- Newsletter signup is public and fail-closed on suppression uncertainty; unsubscribe GET is non-mutating and POST verifies signed tokens before mutating preferences/suppression state.
- Clerk and Resend webhooks verify signatures, reserve webhook event IDs before processing, and use retryable event state for failed/in-progress deliveries.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** account export failures/missing audit rows, newsletter signup failures, unsubscribe processing failures, and Resend webhook mark-failed errors now emit Sentry evidence with local IDs, webhook IDs, methods, or hashed emails only. Newsletter signup now uses the shared `getIP()`/`rateLimitResponse()` helpers. Regression coverage lives in `tests/account-privacy-observability.test.mjs`.

## 2026-05-13 seller operational route spot check

Scope:

- `src/app/api/seller/vacation/route.ts`
- `src/app/dashboard/seller/VacationModeForm.tsx`
- `src/app/api/seller/broadcast/route.ts`
- `src/app/api/seller/analytics/route.ts`
- `src/app/api/seller/analytics/recent-sales/route.ts`
- `src/app/api/seller/[id]/view/route.ts`

Results:

- Vacation mode is current-seller-only through `ensureSeller()`, accepts the native `YYYY-MM-DD` value emitted by `<input type="date">`, rejects malformed provided return dates, and queues seller-wide checkout-session expiry only when enabling vacation mode.
- The vacation warning UI remains reversible while the warning is open: toggling the switch back off clears the pending enable state and dismisses the warning, matching the Cancel action.
- Seller broadcasts are current-seller-only, block incomplete/disconnected/vacation sellers, rate-limit by seller, require first-party broadcast image URLs, and keep notification fanout idempotent by `dedupScope`.
- Seller analytics and recent-sales APIs resolve the current local user, scope to that user's seller profile, block incomplete onboarding, and keep recent-sales reads on whole-order seller ownership (`items.some` plus `items.every`).
- Public seller profile view analytics skip likely bots, skip owner views, rate-limit by IP/client ID, and apply the shared visible-seller predicate before recording.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** vacation return-date parsing now supports native date input without weakening invalid-date rejection, the warning toggle can be cancelled by toggling back off, vacation-route failures emit Sentry evidence, and seller broadcast notification fanout failures are captured with bounded IDs instead of being silently swallowed. Regression coverage lives in `tests/seller-ops-hardening.test.mjs`.

## 2026-05-13 cron/public utility route spot check

Scope:

- `src/app/api/cron/*/route.ts`
- `src/lib/cronAuth.ts`
- `src/app/api/csp-report/route.ts`
- `src/app/api/health/route.ts`
- `src/app/api/blog/route.ts`
- `src/app/api/blog/search/route.ts`
- `src/app/api/blog/search/suggestions/route.ts`
- `src/app/api/search/popular-tags/route.ts`
- `src/app/api/search/popular-blog-tags/route.ts`
- `src/app/api/search/suggestions/route.ts`
- `src/app/api/cart/checkout/rollback/route.ts`

Results:

- Every cron route checks `verifyCronRequest()` before work, uses the shared cron-run state helpers to avoid duplicate execution, and reports through `withSentryCronMonitor`.
- `cronAuth.ts` uses SHA-256 digests with `timingSafeEqual` and supports `CRON_SECRET_PREVIOUS` for rotation.
- CSP reports remain public by design, but they are IP-rate-limited, sanitized before Sentry capture, and tag checkout/cart document violations without leaking checkout query strings.
- Health checks are IP-rate-limited and hide backend component details unless `HEALTH_CHECK_TOKEN` is supplied.
- Public search/blog endpoints cap query/tag input, use shared public visibility helpers, and keep popular-tag routes cached. Signed-in global search suggestions also honor block filters.
- Checkout rollback is signed-in, current-buyer-scoped through Stripe session metadata, rate-limited, expires only unpaid/open sessions, and uses idempotent checkout-stock restoration.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** `/api/blog` now uses the shared public search rate limiter and caps tag input before Prisma filters; blog search and blog suggestion APIs now use shared `getIP()` instead of local forwarded-header parsing. Regression coverage lives in `tests/public-cron-search-hardening.test.mjs`.

## 2026-05-13 social interaction route spot check

Scope:

- `src/app/api/blog/[slug]/comments/route.ts`
- `src/app/api/blog/[slug]/save/route.ts`
- `src/app/api/reviews/route.ts`
- `src/app/api/reviews/[id]/route.ts`
- `src/app/api/reviews/[id]/reply/route.ts`
- `src/app/api/reviews/[id]/vote/route.ts`
- `src/app/api/follow/[sellerId]/route.ts`
- `src/app/api/users/[id]/block/route.ts`
- `src/app/api/users/[id]/report/route.ts`

Results:

- Blog comment reads are public only for published/visible posts and active authors. Comment creation is signed-in, current-account checked, rate-limited, sanitized, moderation-gated, and now rejects replies to unapproved comments or comments whose author is suspended/deleted.
- Saved blog post actions resolve the current local user through `ensureUserByClerkId`, rate-limit mutations, and only save public posts through `publicBlogPostWhere()`.
- Reviews require a signed-in active buyer, block self-reviews, require a delivered or picked-up paid order inside the 90-day window, reject refunded orders, require first-party media URLs, and preserve review edit/delete ownership checks.
- Review helpful votes resolve the current local user, require public/reserved listing visibility via `canViewListingDetail()`, and block voting on one's own review or own listing.
- Follow/unfollow actions resolve current-account state, target only visible seller profiles, block self-follows, honor user blocks, and keep follower counts current.
- User reports require reporter access to private targets; public targets use shared visibility helpers; commission-request reports are limited to open public commission requests via `openCommissionWhere()`.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** review/follow notification side-effect failures no longer turn successful primary mutations into false 500s; duplicate review races now return `409 Already reviewed`; blog comment tree reads are bounded by depth (`100` top-level, `50` replies, `25` nested replies); and commission-request reports cannot target closed/expired/suspended-buyer requests. Regression coverage lives in `tests/social-interaction-hardening.test.mjs`.

## 2026-05-13 server action spot check

Scope:

- `src/app/account/blocked/actions.ts`
- `src/app/dashboard/onboarding/actions.ts`
- `src/app/admin/actions.ts`
- `src/app/admin/support/actions.ts`
- `src/app/seller/[id]/shop/actions.ts`
- `src/app/dashboard/listings/new/page.tsx`

Results:

- Account blocked-user unblocking resolves the current local user through `ensureUserByClerkId()` and deletes only `Block` rows where the current user is the blocker.
- Onboarding actions resolve the current seller through the signed-in Clerk user, reject suspended/deleted accounts, constrain step advancement with `updateMany({ id, onboardingStep })`, and keep profile media first-party-only.
- Admin order/support server actions repeat local active-staff gates (`EMPLOYEE`/`ADMIN`, not banned, not deleted) before mutating order review flags, order notes, or support request state.
- Seller listing shop actions resolve ownership through `getOwnedListing()`, use state-preconditioned `updateMany()` for listing status transitions, and keep checkout-session expiry queued only for availability-changing transitions.
- New-listing creation keeps AI review fail-closed and follower fanout after-response/non-blocking.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** seller shop activation fanout and new-listing follower fanout failures now emit Sentry evidence instead of silent catches. New-listing AI review failures and "mark AI error" follow-up failures also emit bounded Sentry evidence while preserving the existing fail-closed `PENDING_REVIEW` behavior. Regression coverage lives in `tests/server-action-hardening.test.mjs`.

## 2026-05-13 message/custom-order route spot check

Scope:

- `src/app/api/messages/[id]/list/route.ts`
- `src/app/api/messages/[id]/read/route.ts`
- `src/app/api/messages/[id]/stream/route.ts`
- `src/app/api/messages/unread-count/route.ts`
- `src/app/api/messages/custom-order-request/route.ts`

Results:

- Message list/read/stream routes resolve the current local user through account-state helpers and require the user to be a participant in the target conversation before returning messages or marking them read.
- Message list and stream reads are capped or paced: list returns at most 200 rows, stream uses a bounded polling backoff and captures poll errors once per stream.
- Unread count uses `ensureUserByClerkId()` and returns account-state errors when available; the outer header-safe catch keeps the header from breaking on unexpected failures.
- Custom-order requests block self-messages, enforce mutual block checks, require an active seller who accepts custom orders and is currently orderable, and validate listing context against the seller's active public listing.
- Custom-order requests now validate budget before any conversation/message side effects.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** custom-order request budget validation now runs before conversation upsert/message creation, preventing invalid-budget attempts from leaving empty conversations behind. Custom-order seller notification failures now emit Sentry evidence and no longer turn successful message creation into a false 500. Regression coverage lives in `tests/custom-order-admin-thread-followups.test.mjs`.

## 2026-05-13 upload/media write-path spot check

Scope:

- `src/app/api/upload/image/route.ts`
- `src/app/api/upload/presign/route.ts`
- `src/app/api/upload/verify/route.ts`
- `src/lib/urlValidation.ts`
- Message attachment, listing photo, profile media, onboarding avatar, commission reference, review photo, blog cover, broadcast image, and legacy listing image write paths.

Results:

- Processed image uploads require an active signed-in account, enforce endpoint-specific size/type/count rules, require seller profile ownership for seller-only endpoints, strip image metadata through `sharp`, write user-segmented R2 keys, verify public availability, and delete the object if availability checks fail.
- Direct presigned uploads reject image MIME types so images cannot bypass server-side processing. Direct upload verification requires an HMAC token bound to key, endpoint, expected size, content type, and expiry; the verify route HEAD-checks actual R2 metadata and deletes mismatched objects.
- URL origin validation correctly separates first-party writable media from legacy display-only media. The follow-up gap was that origin-only validation still let a signed-in user reuse another user's public Grainline media URL in hidden fields.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** new upload-backed media writes now use current-uploader key scoping through `isFirstPartyMediaUrlForUser()` / `filterFirstPartyMediaUrlsForUser()`. Listing/profile/review/blog edit paths preserve existing DB-owned media values so legacy/unchanged media is not broken, but newly submitted URLs must match the current Clerk user segment and expected upload endpoint. Regression coverage lives in `tests/media-url.test.mjs`, `tests/pr-i-media-upload-unsubscribe-followups.test.mjs`, `tests/seller-ops-hardening.test.mjs`, and `tests/server-action-hardening.test.mjs`.

## 2026-05-13 Stripe Connect/account lifecycle route spot check

Scope:

- `src/app/api/stripe/connect/create/route.ts`
- `src/app/api/stripe/connect/status/route.ts`
- `src/app/api/stripe/connect/dashboard/route.ts`
- `src/app/api/stripe/connect/login-link/route.ts`
- `src/app/api/stripe/webhook/route.ts`
- `src/app/api/stripe/webhook/v2/route.ts`
- `src/lib/stripeConnectV2.ts`
- `src/lib/stripeConnectV2State.ts`
- `src/lib/stripeWebhookMirror.ts`
- `src/lib/stripeWebhookEvents.ts`
- `src/lib/accountDeletion.ts`

Results:

- Connect account creation, dashboard-link, login-link, and status routes derive the seller from the authenticated Clerk user and never accept a client-supplied Stripe account ID.
- New accounts are created through Accounts v2 raw `/v2/core/accounts` with an idempotency key scoped to the seller profile. Existing account links preserve the destination-charge model and keep `stripeAccountVersion` diagnostics backward-compatible for legacy/null sellers.
- Legacy snapshot webhooks remain on `/api/stripe/webhook` with `STRIPE_WEBHOOK_SECRET`; Accounts v2 thin events remain isolated on `/api/stripe/webhook/v2` with `STRIPE_V2_WEBHOOK_SECRET`, `stripe.parseEventNotification()`, the shared webhook-idempotency ledger, and `mirrorStripeChargesEnabled()`.
- Stripe event processing rejects stale events, reclaims stale in-progress idempotency rows, and avoids logging raw webhook payloads or secrets in Sentry extras.
- Account deletion still runs the local anonymization transaction with `{ timeout: 30000, maxWait: 10000 }`, disables local seller orderability inside the transaction when Stripe rejection succeeds, and leaves audit-log redaction/R2 cleanup outside the transaction as Sentry-captured best-effort work.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** `/api/stripe/connect/status` now shares the fail-closed `stripeConnectRatelimit` before retrieving the connected account from Stripe. This closes an authenticated Stripe API hammer surface while keeping the route seller-owned and account-state checked. Regression coverage lives in `tests/stripe-connect-v2.test.mjs`.

## 2026-05-13 static API footgun sweep

Scope:

- Empty-catch patterns under `src`
- API mutation routes without obvious auth/signature/rate-limit boundaries
- Redirect usage and raw SQL usage for follow-up review targets

Results:

- No empty `catch {}` blocks remain under `src`.
- Public support, legal data-request, newsletter, CSP-report, listing-view, and listing-click routes are intentionally public and rate-limited or telemetry-only.
- `POST /api/verification/apply` was authenticated through `ensureSeller()` and state-safe through a single `MakerVerification` upsert, but it lacked a route-level limiter despite mutating review state and running eligibility aggregate queries.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** `POST /api/verification/apply` now uses fail-closed `verificationApplyRatelimit` keyed by the current user before parsing the application body or running eligibility queries. Regression coverage lives in `tests/guild-listing-edit-followups.test.mjs`.

Open work:

- Continue route-by-route audit for the remaining dynamic private routes.
- Prioritize remaining unaudited account/support/legal/newsletter/Stripe Connect/account-lifecycle routes and any server-action files not yet represented above.
- Add regression tests for each verified issue before or with the fix.
