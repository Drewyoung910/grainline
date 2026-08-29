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
  - Dev fixture route is disabled unless `NODE_ENV === "development"`, `VERCEL !== "1"`, `VERCEL_ENV === undefined`, and `ENABLE_DEV_MAKE_ORDER === "true"`.
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
  - Uses fail-closed `markReadRatelimit` before the current-user mutation.
  - `updateMany` scopes notification mutation to `{ id, userId: me.id }`.
  - Result: no verified IDOR found.

- `src/app/api/notifications/read-all/route.ts`
  - Requires auth and local user.
  - Uses fail-closed `markReadRatelimit` before the current-user mutation.
  - Optional `ids` input is capped at 100 and `updateMany` scopes all mutations to `{ userId: me.id }`.
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
  - `src/app/api/account/shipping-address/route.ts` requires auth/local user and reads/writes only the current `User.id`; GET and PUT are both fail-closed rate-limited before the saved-address read/write.
  - `src/app/api/account/notifications/preferences/route.ts` requires auth/local user, validates the preference key against `VALID_PREFERENCE_KEYS`, and updates only the current user's JSON preferences.
  - `src/app/api/notifications/route.ts`, `src/app/api/notifications/[id]/read/route.ts`, and `src/app/api/notifications/read-all/route.ts` scope notification reads/mutations to the current user ID.
  - `src/app/api/cart/route.ts`, `src/app/api/cart/add/route.ts`, and `src/app/api/cart/update/route.ts` require auth/local user and read/mutate only the current user's cart. Add/update routes re-check listing availability, seller account state, self-purchase, private reservation, variant selection, and made-to-order quantity constraints.
  - `src/app/api/favorites/route.ts` and `src/app/api/favorites/[listingId]/route.ts` require auth/local user and create/delete only the current user's favorite rows; favorite creation uses public listing-detail visibility, blocks self-favorites, and rejects favorites when either side has blocked the other so a blocked user cannot create seller notifications.
  - `src/app/api/search/saved/route.ts` requires auth/local user, fail-closed rate-limits GET/POST/DELETE, caps/normalizes saved-search inputs, and reads/deletes only `userId: me.id` rows.
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
- Admin PIN verification uses account and IP rate limits, constant-time digest comparison, signed HTTP-only cookies, and audit/Sentry evidence for rate-limit and failed-auth cases using hashed source-IP / Clerk-user identifiers rather than raw network addresses in permanent audit metadata.

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
- Public search/blog endpoints cap query/tag/page/limit input, use shared public visibility helpers, and keep popular-tag routes cached. Signed-in global search suggestions also honor block filters.
- Checkout rollback is signed-in, current-buyer-scoped through Stripe session metadata, rate-limited, expires only unpaid/open sessions, and uses idempotent checkout-stock restoration.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** `/api/blog` now uses the shared public search rate limiter and caps tag input before Prisma filters; blog search and blog suggestion APIs now use shared `getIP()` instead of local forwarded-header parsing. Regression coverage lives in `tests/public-cron-search-hardening.test.mjs`.
- **Hardened 2026-05-14:** `/api/blog/search` now bounds invalid/huge `page` and `limit` params before Prisma offsets, caps tag filters through `normalizeTags(..., 20)`, and `/api/blog/search/suggestions` now uses the shared suggestion query normalizer and `BLOG_FUZZY_SUGGESTION_MIN_SIMILARITY` constant instead of a looser hardcoded threshold. Regression coverage lives in `tests/public-cron-search-hardening.test.mjs`.
- **Hardened 2026-05-14:** query-param parsing was centralized in `src/lib/queryParams.ts`; `/api/blog`, `/api/blog/search`, `/api/commission`, `/api/account/feed`, `/api/seller/broadcast`, and message list/stream polling now reject malformed page/limit/timestamp values before Prisma `skip`/`take`/date filters. Public commission reads now share the public search IP limiter. Regression coverage lives in `tests/query-param-state.test.mjs`, `tests/public-cron-search-hardening.test.mjs`, `tests/r49-account-state-routes.test.mjs`, `tests/seller-ops-hardening.test.mjs`, and `tests/custom-order-admin-thread-followups.test.mjs`.

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
- The reviewed provider topology now separates platform snapshots, classic
  connected-account payout failures and v2 thin account events. The compatible
  candidate keeps platform snapshots on `/api/stripe/webhook`, adds
  `/api/stripe/webhook/connect` with `STRIPE_CONNECT_WEBHOOK_SECRET` for only
  `payout.failed`, and leaves v2 thin events on `/api/stripe/webhook/v2`.
  Both classic payout call sites share `src/lib/stripePayoutWebhook.ts` and the
  same fixed generation-bound event lease; no provider or production state was
  changed by the implementation checkpoint.
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
- The only `$queryRawUnsafe` usage is the commission Near Me page. It uses constant SQL fragments selected from booleans, positional parameters for all variable values, and category allowlisting before the raw SQL path.
- Public support, legal data-request, newsletter, CSP-report, listing-view, and listing-click routes are intentionally public and rate-limited or telemetry-only. Newsletter, support, and legal data-request are public but fail-closed because they write durable records; telemetry-style CSP/listing-view/listing-click paths may stay fail-open.
- `POST /api/verification/apply` was authenticated through `ensureSeller()` and state-safe through a single `MakerVerification` upsert, but it lacked a route-level limiter despite mutating review state and running eligibility aggregate queries.
- Seller listing publish/mark-available actions already fail closed to `PENDING_REVIEW` when AI review cannot approve, but the republish path still had less observability than the create-listing path.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** `POST /api/verification/apply` now uses fail-closed `verificationApplyRatelimit` keyed by the current user before parsing the application body or running eligibility queries. Regression coverage lives in `tests/guild-listing-edit-followups.test.mjs`.
- **Hardened 2026-05-13:** seller listing publish/mark-available AI-review failures and error-marking follow-up failures now emit Sentry evidence with bounded listing/seller IDs, matching the create-listing fail-closed observability pattern. Regression coverage lives in `tests/server-action-hardening.test.mjs`.
- **Hardened 2026-05-13:** the follow-up mutating-route sweep added missing fail-closed rate limits to account deletion (`accountDeletionRatelimit`), notification preference writes (`notificationPreferenceRatelimit`), favorite removal (`saveRatelimit`), commission close/fulfilled transitions (`commissionStatusRatelimit`), admin review deletion (`adminActionRatelimit`), and admin user ban/unban (`adminActionRatelimit`). Signed webhooks remain bounded by signature verification and idempotency ledgers, and the dev make-order fixture remains disabled outside local non-Vercel development. Regression coverage lives in `tests/mutation-rate-limit-sweep.test.mjs`.
- **Hardened 2026-05-14:** remaining `safeRateLimitOpen()` uses were re-audited. Fail-open behavior is now limited by regression test to telemetry/diagnostic routes. Public support, legal data-request, newsletter, account feed, blog/search APIs, recently viewed, global search suggestions, and public commission reads now fail closed before Prisma/raw SQL work when Redis rate limiting is unavailable. Regression coverage lives in `tests/public-cron-search-hardening.test.mjs`, `tests/r49-account-state-routes.test.mjs`, and `tests/account-privacy-observability.test.mjs`.
- **Hardened 2026-05-14:** public unauthenticated form/report routes now bound body reads before parsing. `readBoundedJson()` / `readBoundedText()` cap newsletter (8 KiB), support and privacy data requests (24 KiB), and CSP reports (32 KiB), including streamed bodies without `Content-Length`. Regression coverage lives in `tests/request-body-bounds.test.mjs`, `tests/account-privacy-observability.test.mjs`, and `tests/public-cron-search-hardening.test.mjs`.
- **Hardened 2026-05-14:** signed webhook routes now also cap raw body reads before vendor signature verification. Stripe snapshot webhooks allow 1 MiB, Stripe v2 thin and Clerk webhooks allow 512 KiB, and Resend webhooks allow 256 KiB. Oversized unsigned traffic is rejected before signature parsing or idempotency work. Regression coverage lives in `tests/webhook-body-bounds.test.mjs` and `tests/stripe-webhook-v2-route.test.mjs`.
- **Hardened 2026-05-14:** rendering/XSS sweep verified JSON-LD escaping and sanitized blog markdown, then normalized remaining `rel="noreferrer"` target-blank links to `rel="noopener noreferrer"`. Regression coverage lives in `tests/rendering-security.test.mjs`.

Open work:

- Continue route-by-route audit for the remaining dynamic private routes.
- Prioritize remaining unaudited account/support/legal/newsletter/Stripe Connect/account-lifecycle routes and any server-action files not yet represented above.
- Add regression tests for each verified issue before or with the fix.

## 2026-05-13 dynamic route ownership / IDOR audit

Scope started:

- Dynamic API routes under `src/app/api/**/[param]/route.ts`
- High-impact private groups: order fulfillment/label/refund, case actions/messages/resolution, messages, review edit/reply/vote, follows/blocks/reports, and listing stock updates.

Results so far:

- Order fulfillment, label purchase, and seller refund routes resolve the acting seller and require every order item to belong to that seller before mutation. Payment/refund/label state transitions also use atomic conflict guards after authorization.
- Case routes require either staff/admin/cron authority where intended or buyer/seller party membership before state changes. Mark-resolved keeps the party predicate in the SQL mutation.
- Message list/read/stream routes require conversation participant membership before reads or read-state writes.
- Review edit/delete/reply/vote routes require reviewer ownership, seller ownership, or public listing visibility as appropriate.
- Follow, block, report, stock-notification, and listing telemetry routes use current-user ownership or shared public visibility predicates.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** manual listing stock updates now keep the verified seller profile in the final SQL `UPDATE` predicate instead of mutating by listing id alone, and back-in-stock fanout failures now emit Sentry evidence instead of a silent catch. Regression coverage lives in `tests/seller-ops-hardening.test.mjs`.
- **Hardened 2026-05-13:** seller listing server actions now carry the verified seller id into follow-up status mutations after publish, create, custom-listing creation, and ACTIVE edit re-review. This is a defense-in-depth IDOR guard: the actions already verify ownership before mutation, and the final status/SOLD_OUT updates now repeat the same seller boundary.
- **Hardened 2026-05-14:** message thread send actions now reject empty submissions with no valid first-party attachments before conversation lookup/update work, so forged action posts cannot bump thread `updatedAt` without creating content. Message notification email failures from that action now emit bounded Sentry evidence. Regression coverage lives in `tests/custom-order-admin-thread-followups.test.mjs`.
- **Hardened 2026-05-14:** seller listing server-action mutations now use `listingMutationRatelimit` before ownership DB lookups. This covers dashboard status/archive buttons and public shop hide/unhide/mark-sold/mark-available/publish/archive actions, closing a server-action rate-limit gap not covered by API-route mutation sweeps. Regression coverage lives in `tests/seller-ops-hardening.test.mjs`.
- **Hardened 2026-05-14:** seller profile/shop/onboarding settings server actions now use `sellerProfileRatelimit` before seller/profile DB work, and the dashboard notification "mark all read" server action uses `markReadRatelimit` plus a local banned/deleted-account guard. This extends forged server-action POST cost controls beyond listing status changes. Regression coverage lives in `tests/seller-ops-hardening.test.mjs`.
- **Hardened 2026-05-18:** the server-action mutation sweep added local fail-closed rate limits before DB/form/metrics work for blocked-user unblocks (`blockRatelimit`), dashboard blog deletes (`blogCreateRatelimit`), custom-listing creation (`listingCreateRatelimit`), listing edit saves (`listingMutationRatelimit`), and dashboard Guild applications (`verificationApplyRatelimit`). Regression coverage lives in `tests/server-action-rate-limit-sweep.test.mjs`.
- **Hardened 2026-05-18:** admin order/support/blog/broadcast/verification server actions now run `adminActionRatelimit` before local admin-user DB lookups, preserving Admin PIN/middleware as primary gates while adding local cost controls for forged high-privilege server-action POSTs. Regression coverage lives in `tests/admin-action-guardrails.test.mjs`.

## 2026-05-13 checkout/payment boundary audit

Scope started:

- Stripe Checkout creation routes (`/api/cart/checkout/single`, `/api/cart/checkout-seller`)
- Checkout rollback, checkout locks, Stripe webhook signature/idempotency handling, and Stripe Connect v2 thin webhook handling.

Results so far:

- Checkout creation routes authenticate through Clerk, rate-limit before Stripe calls, reject unsupported seller account states, verify signed shipping-rate tokens, use Stripe Checkout/embedded card collection, and return only Stripe Checkout `client_secret` values created server-side.
- Checkout locks are payload-hash scoped and session-bound before release; rollback requires the Stripe session metadata `buyerId` to match the signed-in buyer before expiring/restoring a session.
- Legacy Stripe snapshot webhooks and Connect v2 thin webhooks use separate routes, secrets, verification methods, stale-event rejection, and a shared idempotency ledger.

Follow-up fix from this pass:

- **Hardened 2026-05-13:** checkout stock reservation SQL now repeats live listing availability in the atomic reservation update (`sellerId`, `status = ACTIVE`, `listingType = IN_STOCK`, and sufficient stock). Restore paths carry the captured seller id as well. This closes the read-to-reserve gap where a seller could hide/sell a listing after checkout preflight but before stock decrement. Regression coverage lives in `tests/order-state-followups.test.mjs`.

## 2026-05-14 upload/media/account-deletion audit

Scope started:

- Upload image, presign, and verify routes.
- R2 URL validation, upload verification tokens, direct-upload cleanup, markdown image rendering, message/blog media references, and account-deletion R2 cleanup.

Results so far:

- Upload creation routes authenticate through Clerk, fail closed on suspended/deleted accounts, rate-limit before object creation or presign, centralize size/type/count rules in `uploadRules.ts`, and create path-safe user-segmented R2 keys.
- Direct uploads use signed verification tokens bound to key, endpoint, expected size, content type, and expiry. Verification checks object metadata in R2 and deletes invalid objects with Sentry evidence on cleanup failures.
- Blog markdown rendering is centralized and strips non-Grainline image sources before rendering, preventing arbitrary third-party tracking pixels in public posts.

Follow-up fix from this pass:

- **Hardened 2026-05-14:** account deletion media cleanup now filters collected URLs through `accountDeletionMediaUrlsForCleanup()` before calling `deleteR2ObjectByUrl()`. Only configured first-party media keys owned by the deleted Clerk user are deleted, so copied markdown/message/blog URLs cannot make one user deletion remove another user's upload. Regression coverage lives in `tests/account-deletion-media.test.mjs`.
- **Fixed 2026-05-14:** commission reference-image uploads now use the non-seller `messageImage` endpoint instead of seller-only `listingImage`, and the commission API validates those submitted reference URLs against `messageImage` ownership. This preserves current-uploader scoping without requiring buyers to have a seller profile. Regression coverage lives in `tests/pr-i-media-upload-unsubscribe-followups.test.mjs`.
- **Hardened 2026-05-14:** message attachment upload rules now match the message composer contract: `messageAny` accepts processed images plus PDFs, `messageFile` accepts PDFs only, and MP4/MOV files remain confined to seller-only `listingVideo`. This avoids an authenticated crafted-upload path for unsupported message videos and keeps attachment UX/server validation aligned. Regression coverage lives in `tests/upload-ux-followups.test.mjs`.

## 2026-05-14 public forms, webhooks, payment-script, and XSS surface audit

Scope:

- Public support, legal data-request, newsletter, CSP-report, health, and unsubscribe routes.
- Clerk, Resend, Stripe snapshot, and Stripe Connect v2 thin webhook routes.
- Dev/diagnostic routes and health payload behavior.
- Checkout/payment browser script inventory and CSP controls.
- User-generated HTML/markdown/JSON-LD/video embed rendering paths.

Results:

- Public support and legal data-request forms are IP rate-limited, normalize/sanitize bounded fields before storage/email rendering, escape HTML in generated emails, hash email addresses before Sentry telemetry, and preserve the user's escalation path if email delivery fails.
- Newsletter signup is IP rate-limited, validates/normalizes email before write, respects suppression, hashes telemetry, and fails closed on unexpected errors.
- CSP reports are public but rate-limited, sanitized before Sentry, and tag checkout/payment-surface violations with `checkout_surface=true`.
- Health checks cache backend probes for 30 seconds, rate-limit public callers, and return only `{ ok }` unless `HEALTH_CHECK_TOKEN` matches.
- `/api/dev/make-order` remains disabled outside local non-Vercel development and still requires an authenticated, unsuspended user when explicitly enabled.
- Clerk, Resend, Stripe snapshot, and Stripe v2 thin webhooks all verify signatures before work and use idempotency ledgers before side effects.
- Checkout script inventory remains accurate: no direct `next/script` usage was found in `src/app` or `src/components`; Stripe Embedded Checkout loads through `@stripe/stripe-js`/`EmbeddedCheckoutProvider`; Clerk and Sentry are the other expected browser runtimes; CSP keeps explicit Stripe/Clerk/Sentry/R2/Turnstile host allowlists.
- User-generated HTML surfaces are centralized: blog markdown renders through `renderBlogMarkdown()` with `sanitize-html`, markdown images are limited to first-party R2 public URLs, JSON-LD uses `safeJsonLd()`, and blog video URLs normalize to YouTube/Vimeo IDs before iframe rendering.

Follow-up fix from this pass:

- **Hardened 2026-05-14:** admin blog-comment approval notification failures and maker-blog follower notification fanout failures now emit Sentry evidence with bounded comment/post/seller IDs instead of silent `catch {}` blocks. These side effects remain non-blocking after the primary moderation or publish mutation succeeds. Regression coverage lives in `tests/blog-action-guardrails.test.mjs` and `tests/admin-moderation-observability.test.mjs`.
- **Hardened 2026-05-14:** central email send failure telemetry now uses `hashEmailForTelemetry()` and `subjectLength` instead of raw recipient email addresses or raw subject values for inactive-account lookup failures, invalid-recipient skips, retry failures, and final send failures. Regression coverage lives in `tests/account-privacy-observability.test.mjs`.
- **Hardened 2026-05-14:** profanity/moderation checks now use `captureProfanityFlag()` with bounded IDs and `matchCount` instead of raw `[PROFANITY]` console lines and `matches.join(...)`. Regression coverage lives in `tests/profanity-telemetry.test.mjs`.
- **Hardened 2026-05-14:** high-cost authenticated JSON mutations now bound request bodies before Zod parsing and before downstream Stripe, Shippo, R2, Prisma, email, or notification work. Checkout session creation is capped at 64 KiB, shipping quote requests at 32 KiB, upload presign/verify at 16 KiB, seller broadcast at 32 KiB, admin email at 64 KiB, and reports/cases/reviews/custom-order/commission mutations at 24 KiB (commission status at 8 KiB). Regression coverage lives in `tests/authenticated-json-body-bounds.test.mjs` and `tests/request-body-bounds.test.mjs`.
- **Hardened 2026-05-14:** the remaining API JSON readers were swept so no `src/app/api/**/route.ts` file calls raw `req.json()` or `request.json()` anymore. Smaller JSON mutations and optional-body routes now use `readBoundedJson()` or `readOptionalBoundedJson()` with route-specific caps while preserving prior invalid/empty-body fallback behavior for admin PIN, optional label rate IDs, fulfillment JSON/form dual-mode updates, terms acceptance safe-parse, notification read-all IDs, unsubscribe JSON fallback, and Stripe Connect return URLs. Regression coverage now recursively scans all API routes.
- **Hardened 2026-05-14:** remaining API `formData()` readers now perform a `Content-Length` pre-check before parsing when a practical cap exists: processed image uploads at 12 MiB, order fulfillment form fallback at 24 KiB, and unsubscribe form fallback at 8 KiB. File-specific image limits still apply after multipart parsing through `uploadRules.ts`. Regression coverage lives in `tests/form-data-body-bounds.test.mjs`.
- **Hardened 2026-05-14:** API routes without local auth/session verification were inventoried and regression-allowlisted. The sweep found `/api/listings/[id]/similar` was a public dynamic Prisma/raw-SQL route without an IP rate limit; it now uses fail-closed `safeRateLimit(searchRatelimit, getIP(req))` before listing lookup and candidate SQL. Regression coverage lives in `tests/public-api-auth-inventory.test.mjs` and `tests/public-cron-search-hardening.test.mjs`.
- **Hardened 2026-05-14:** optional-public and signed-in fan-out GET routes were swept for read-amplification gaps not covered by the no-auth inventory. Blog comment reads, commission detail reads, and follow-count reads now run the public `searchRatelimit` before Prisma work. Cart contents, message history polling, notification lists, and seller analytics/recent-sales now use dedicated fail-closed read limiters before fan-out queries. Lightweight `/api/me` and unread-count endpoints remain intentionally small. Regression coverage lives in `tests/api-read-rate-limit-sweep.test.mjs`.
- **Hardened 2026-05-18:** `/api/listings/[id]/similar` now applies optional signed-in block filtering before raw-SQL candidate selection. The route remains public and IP rate-limited, but if Clerk auth is present it resolves the local user, rejects banned/deleted accounts, and excludes reciprocal blocked seller profiles with `l."sellerId" != ALL(${blockedSellerIds})`. Regression coverage lives in `tests/public-cron-search-hardening.test.mjs`.
- **Hardened 2026-05-18:** `sanitizeRichText()` now strips all HTML through `sanitize-html` with no allowed tags/attributes before protocol/event cleanup. Current long-form fields render as React text nodes, so this is defense-in-depth against a future `dangerouslySetInnerHTML` sink accidentally trusting seller/review/commission text. Regression coverage lives in `tests/sanitize-unicode.test.mjs`, `tests/rendering-security.test.mjs`, and `tests/blog-markdown-sanitization.test.mjs`.
- **Hardened 2026-05-18:** Founding Maker number assignment now takes a short Postgres advisory transaction lock before reading `max(foundingMakerNumber)` and assigning the next permanent badge number. The helper still keeps listing transitions non-blocking, but high-concurrency publish bursts can no longer exhaust a bounded unique-conflict retry loop and silently miss eligible makers while slots remain. Regression coverage lives in `tests/post-launch-ui-followups.test.mjs`.
- **Hardened 2026-05-18:** blog comment-approval notifications now include `dedupScope: commentId`, and maker blog edits preserve the first `publishedAt` timestamp through archive/draft cycles so follower fanout only happens on a post's first-ever publish. This closes the verified comment-notification collision and archive/re-publish follower spam chain without blocking legitimate post edits. Regression coverage lives in `tests/blog-action-guardrails.test.mjs`.
- **Hardened 2026-05-18:** the `/api/dev/make-order` fixture gate is now a positive local-development-only check (`NODE_ENV === "development"`, `VERCEL !== "1"`, `VERCEL_ENV === undefined`, and `ENABLE_DEV_MAKE_ORDER === "true"`). This removes dependence on broad `NODE_ENV !== "production"` / falsy `VERCEL_ENV` checks while preserving the local-only test fixture. Regression coverage lives in `tests/public-cron-search-hardening.test.mjs`.
- **Hardened 2026-05-18:** saved-search writes now sort normalized tag filters before duplicate lookup and create. The route was already capped at 25 saved searches and GET/POST/DELETE were already user-rate-limited, but this removes the remaining tag-order permutation waste path. Regression coverage lives in `tests/r49-account-state-routes.test.mjs`.
- **Hardened 2026-05-18:** Guild metrics now count all unresolved cases for the Guild Master zero-active-case requirement, Guild Member revocation includes `UNDER_REVIEW` cases older than 90 days, and admin Guild Member reinstatement re-checks those current good-standing blockers plus the 5-active-listings floor before restoring the badge. Regression coverage lives in `tests/guild-listing-edit-followups.test.mjs` and `tests/guild-member-revocation-state.test.mjs`.
- **Hardened 2026-05-18:** newsletter signup and unsubscribe token generation now NFC-normalize email addresses before lowercasing. Later signed-in email preference opt-ins and newsletter confirmations act as renewed-consent epochs, so one-click unsubscribe links issued before those epochs are rejected. Unicode email variants were a real normalization edge worth closing. Regression coverage lives in `tests/unsubscribe-token.test.mjs` and `tests/account-privacy-observability.test.mjs`.
- **Hardened 2026-05-18:** Stripe account-state mirroring now treats local banned/deleted account state as authoritative. `mirrorStripeChargesEnabled()` computes an effective value from Stripe `charges_enabled && local user active`, so queued Stripe account events cannot re-enable `SellerProfile.chargesEnabled` after a ban or account deletion. Regression coverage lives in `tests/stripe-webhook-v2-route.test.mjs`.
- **Hardened 2026-05-18:** admin PIN cookies now use `sameSite: "strict"` in both normal verification and local dev-bypass issuance, matching the documented privileged-cookie contract. Regression coverage lives in `tests/admin-pin.test.mjs`.
- **Hardened 2026-05-18:** the Sentry privacy filter now scrubs top-level `event.message`, `event.transaction`, and exception values/stack-frame vars in addition to request/user/extra/context/tag/breadcrumb data. This closes the highest-risk remaining observability PII path where SDK or Prisma error messages could carry raw emails or tokenized URLs. Regression coverage lives in `tests/sentry-filter.test.mjs`.
- **Hardened 2026-05-18:** email/Resend observability now avoids raw recipient leakage outside the canonical suppression record. Dev-mode email logs use email hashes and subject lengths, Resend webhook `lastError` uses the shared email-error sanitizer, and suppression `details` stores only webhook type/id plus recipient counts/hashes instead of the full provider payload. Regression coverage lives in `tests/account-privacy-observability.test.mjs`.
- **Hardened 2026-05-18:** CSP report breadcrumbs now use the same sanitized report helper as Sentry event extras, reducing blocked/source URLs to origins and stripping document-query strings before breadcrumb upload. The raw-tag/raw-extra part of the Claude finding was already fixed; the breadcrumb path was the remaining real gap. Regression coverage lives in `tests/csp-report-sanitization.test.mjs`.
- **Hardened 2026-05-18:** direct-upload verification now reads the first 512 bytes from R2 and verifies PDF/video magic signatures before accepting the object. Size and `Content-Type` were already bound to the signed token and R2 metadata, but the new byte check prevents arbitrary content uploaded with a forged client-declared media type from being accepted. Regression coverage lives in `tests/upload-verification-token.test.mjs`.
- **Hardened 2026-05-18:** single-listing and seller-cart checkout routes now tag outer unexpected Sentry exceptions with explicit route/source metadata and bounded reservation counts/IDs. Stock-restoration and stale-lock cleanup paths were already tagged; this closes the bare primary checkout exception path. Regression coverage lives in `tests/r65-observability-guardrails.test.mjs`.
- **Hardened 2026-05-18:** message-thread body media rendering now requires `isTrustedMediaUrl()` before turning bare URLs or parsed file-message URLs into image/PDF/download bubbles. Arbitrary external `https://...jpg/pdf` message text remains plain text, while trusted Grainline/legacy media continues rendering as attachments. Regression coverage lives in `tests/rendering-security.test.mjs`.
- **Documented 2026-05-18:** security/runtime documentation now reflects the resolved `next@16.2.6` runtime and the actual `Cross-Origin-Opener-Policy: same-origin-allow-popups` header used for Clerk/Stripe popup compatibility. Regression coverage lives in `tests/verified-audit-followups.test.mjs`.

## Stripe webhook maintenance replay-barrier correction (2026-08-08)

- The Extra-High activation review found that the general 90-day processed
  webhook prune included legacy `checkout.session.stock_restored` claim rows.
  These rows are permanent replay barriers: after one was pruned, a buyer-held
  old expired Checkout Session could pass the authenticated stock-rollback path
  again and restore inventory twice.
- The maintenance migration now excludes that finite event class while keeping
  ordinary processed-event cleanup bounded to 1,000 rows with a database-derived
  cutoff and `FOR UPDATE SKIP LOCKED`. Its disposable PostgreSQL proof creates
  an old permanent claim and proves it survives pruning.
- The corrected migration SHA-256 is
  `0c34cc94f6a602e8f686487277b422f3ba4e89a1f2c50b9b3b673cb63d259df5`;
  the corrected maintenance phase-tree fingerprint is
  `551be631510a20c58eae7b1e84f84d23890d5c2e82b0d1332c7f9f266744f22d`.
  The earlier PR #162 migration bytes were superseded before merge or
  production application. Production was not changed at that correction
  checkpoint.
- **Production preparation accepted 2026-08-08:** PR #161 merged exact app
  head `d2ef37b4c86a0ff174016be77113fa1b888131b4` as main
  `0e2e1cce29089ab1418ff006b461d74b5f9804ca`; PR #162 merged exact
  maintenance head `8abaa36fafd989604a06aa2fee9f1a215e5763b1` as main
  `1fbf17845d72403d8ff28cd038119114583eba04`; and audit-only PR #163
  produced exact release main
  `423d3c1f670a2a4e84dc275eb2c6a4c20234a1f1`. Exact-main CI
  `31284293394` passed. Guarded Production Migrations run `31290691183`
  applied only
  `20260805040000_prepare_stripe_webhook_maintenance_authority`, reported all
  191 migrations current and passed the final global runtime grant/RLS audit.
  The release verifier attested no RLS, FORCE, table-grant or row-data change.
  Manual production deployment `dpl_67W8RkxzdQwbNTy3rmsEL6WK42D3` then
  promoted exact release main `423d3c1f670a2a4e84dc275eb2c6a4c20234a1f1`;
  Vercel reported `READY`, and the canonical homepage plus health endpoint
  returned HTTP 200. The classic signed webhook and exact retry, rollback-only
  retention, fixed aggregate health and legacy restore replay passed with zero
  Listing mutation. No migration, RLS/grant, cleanup or provider mutation was
  part of the deployment/smoke. After the UTC-hour rollover, the expanded
  ops-health route returned HTTP 200, `skipped=false`, all four Stripe counts at
  zero and a healthy SavedSearch canary; sanitized evidence is retained at
  `archive/stripe-webhook-ops-health-compatible-production-20260809.json`.
  Connect v2 signed delivery, predecessor drain and activation remain separate
  gates.
- The follow-up read-only Stripe subscription proof failed closed and retained
  sanitized evidence at
  `archive/stripe-webhook-subscriptions-compatible-production-20260808.json`.
  The enabled test-mode classic destination is missing 11 handled event types
  and contains four unused events. The enabled thin connected-account v2
  destination contains three unused `v2.core.account_person.*` event types
  outside the reviewed `v2.core.account` family. This is provider subscription
  drift; no endpoint, event set, secret or other provider state was changed.
- The follow-up source/topology audit found that the old expected classic set
  mixed platform-account Checkout/refund/dispute events with connected-account
  payout/account events. The executable replacement contract is three distinct
  source-bound surfaces: the platform snapshot route, the current Connect v2
  account route and a new separately signed classic Connect payout route.
  `docs/stripe-webhook-provider-topology-audit.md` retains the aggregate-only
  seller-version evidence, retirement decision boundary for legacy classic
  account events, implementation proofs and release order. No provider or
  production state changed during that audit.
- PR #169 merged exact compatible Connect-route head
  `e45a42b9a6b63acef675d0a86276c96a5da9e22f` as exact `main`
  `6126105b81c79948b6b77066461dd9ac0b8e5e73`; exact-main CI
  `31321837327` and Conversation/Message FORCE regression run `31321837383`
  passed. Read-only Vercel inventory then confirmed that production does not
  yet contain `STRIPE_CONNECT_WEBHOOK_SECRET`; no deployment or provider state
  changed. The release review corrected an impossible ordering assumption:
  Stripe returns the classic endpoint signing secret only at creation. The
  provider boundary must create the Connect endpoint on the deliberately
  absent bootstrap URL, capture the secret without logging it, immediately
  disable and verify the endpoint, install the Sensitive production variable,
  and deploy while the endpoint remains disabled. Failure to verify immediate
  disable requires endpoint deletion and a stop. Only after alias, health and
  secret-isolation proofs may the endpoint move to the canonical URL and be
  enabled for one signed payout delivery plus retry. No random placeholder
  secret or creation-response artifact is permitted.
- PR #170 merged the corrected disabled-bootstrap sequence at exact head
  `89d41f6a7fad593ccb9bf47fe40259cbfb839c30` as exact `main`
  `7576484a5ef57d63eccc9365ab9f3311c22f2a4d`; exact-main CI
  `31323020529` passed. The follow-up isolated branch prepares
  `scripts/stripe-connect-webhook-bootstrap.mjs` and
  `docs/stripe-connect-webhook-bootstrap-operator.md`. The operator binds a
  future run to exact-main CI, keeps the creation-only secret in memory, proves
  the endpoint disabled before installing a production-only Sensitive Vercel
  variable, writes mode-`0600` secret-free evidence, and reconciles ambiguous
  Stripe/Vercel failures before rollback. This is preparation only: the
  endpoint was not created, Vercel was not changed, and nothing was deployed.
- PR #171 merged the guarded operator as exact `main`
  `b2a8d4c26c6739e19820f60b759e425dce1d97ce`; exact-main CI
  `31325868408`, Conversation/Message FORCE `31325868399` and Notification
  FORCE `31325868401` passed. The first exact-main operator preflight then
  passed in Stripe test mode and read only GitHub CI, the linked Vercel project
  and Stripe endpoint inventory: `STRIPE_CONNECT_WEBHOOK_SECRET` remains absent
  from Production and neither reviewed Connect URL exists in test mode. The
  preflight exposed one fail-closed sequencing mismatch before mutation: the
  operator allowed live bootstrap only even though Grainline's pre-launch
  provider proof is deliberately test-mode first. The isolated follow-up binds
  test and live bootstrap to different confirmation strings and retains the
  live-money switch as a separate endpoint/secret/deployment release. No
  endpoint, variable, deployment, migration, grant or production state changed.
- PR #172 merged that provider-mode correction as exact `main`
  `eda20f6f18d08d194b0a44a7414510e3c3a9ef58`; exact-main CI run
  `31328107308` passed. The exact-main read-only preflight passed, followed by
  the separately authorized guarded test-mode bootstrap. It created only the
  reviewed classic Connect `payout.failed` endpoint at the deliberately absent
  URL with `connect=true`, immediately disabled and re-read it, proved
  `livemode=false`, and then installed exactly one unbranched Sensitive
  Production Vercel `STRIPE_CONNECT_WEBHOOK_SECRET`. Secret-free evidence is
  retained at
  `archive/stripe-connect-disabled-bootstrap-test-20260809-eda20f6f.json`.
  Nothing was deployed; the endpoint remains disabled; no migration, grant,
  RLS or live-mode Stripe state changed. The next separate boundary is the
  compatible production deployment while the endpoint stays disabled.
- Exact-main CI run `31329961638` passed for
  `69c14c0618ea7ab9c74756422273d17d66db7efa`, followed by authorized manual
  Vercel production deployment `dpl_CasoctMLsvfcA1Vj2JJcNUFzXQXP`. Vercel
  reported `READY`, Production target and the canonical aliases; `/` and
  `/api/health` returned HTTP 200, and the canonical asset marker bound the
  domain to that deployment. The build-time database guard attested
  `grainline_app_runtime`. The deployed Connect route rejected missing, wrong
  and platform-secret cross-route signatures with HTTP 400. Final read-only
  provider inspection proved the test-mode endpoint digest, absent bootstrap
  URL, disabled status and exact `payout.failed` event set unchanged, with the
  Production Vercel secret still Sensitive. Sanitized evidence is retained at
  `archive/stripe-connect-compatible-production-deployment-20260809.json`.
  No migration, RLS, grant, provider-variable or live-mode Stripe change was
  part of this deployment.
- The next isolated provider branch prepares the restart-safe step-6 operator
  and signed payout proof. Read-only Stripe inventory pinned the exact current
  test-mode predecessor: six platform events; the twelve reviewed
  `v2.core.account` events plus exactly three unused `account_person` extras;
  and the retained disabled Connect endpoint with only `payout.failed`.
  Configuration convergence now stops at the canonical URL while Connect
  remains disabled. The signed proof uses a fresh disposable test account and
  Stripe's documented `no_account` payout bank, accepts no existing seller
  account, passes the Stripe API key only through the child environment, and
  disables Connect again on delivery or replay failure. Durable artifacts use
  ID hashes; the raw event/account/payout handoff is mode `0600` under the
  system temporary directory and is deleted with the test account after proof.
  Extra-High review found and closed two restart boundaries before execution:
  an accepted enable request followed by a lost response could previously evade
  the local `enabled` flag, and a crash after account deletion could lose the
  raw-ID proof context. Failure recovery now always re-reads provider state and
  disables an observed stage-4 endpoint; the handoff advances to a validated
  `delivery-verified` lease identity before deletion, so a post-deletion restart
  performs cleanup without another resend. Final hashed evidence is committed
  before the temporary handoff is removed, with exact completed-evidence resume
  validation for an interrupted local cleanup.
  The same review rejected a shared Stripe idempotency key for opposite
  mutations: an enable response could otherwise be replayed for an emergency
  disable, or a forward event-set response for rollback. Existing-endpoint
  mutations now use invocation-scoped, direction-specific keys; stable keys are
  retained only for creation of the disposable account, funding charge and
  payout, where a process restart must not duplicate provider objects.
  This is prepared code and documentation only: no endpoint was moved or
  enabled, no event set was changed, no test account was created, and no
  production, migration, RLS, grant, secret or live-mode state changed.
- PR #175 exact head `51a07d801dda203056bd84416f2d23ba047669bb`
  merged as exact `main` `56a787b1bb637b8a0f78d43ce27d6c67df65cb01`.
  Exact-main CI `31337348971`, Conversation/Message FORCE `31337348977` and
  Notification FORCE `31337348979` passed. The read-only provider preflight
  then passed against compatible deployment
  `dpl_CasoctMLsvfcA1Vj2JJcNUFzXQXP` at exact predecessor stage 0; it changed
  no Stripe, Vercel, database, deployment or RLS state.
- The pre-mutation execution review then found two restart blockers. Generated
  cutover evidence under `archive/` made the worktree dirty even though the
  next operator required that exact evidence and rejected every dirty path.
  Separately, a cleaned failed preparation reused a release-global Stripe
  idempotency key, which could replay the already deleted disposable account.
  The isolated correction permits only content-validated configured evidence
  files beside the exact commit and introduces a mode-`0600` attempt UUID,
  timestamp and account binding. Successful cleanup removes that attempt so a
  retry receives fresh keys; incomplete cleanup retains it for exact recovery.
  No provider mutation may proceed until the corrected proof chain and exact
  CI pass.
- PR #176 merged the restart corrections as exact `main`
  `abd49d703ec37349c84b0c70912ffb655faac5e3`; exact-main CI
  `31339275512` passed. The authorized test-mode provider cutover completed at
  disabled canonical stage 3 against deployment
  `dpl_CasoctMLsvfcA1Vj2JJcNUFzXQXP`: the platform and v2 event sets converged
  to the reviewed 10/12-event inventories and the classic Connect endpoint
  moved to `/api/stripe/webhook/connect` while remaining disabled with only
  `payout.failed`. Independent provider and public-deployment reads matched
  the sanitized mode-`0600` evidence. No deployment, secret, Vercel variable,
  migration, grant, RLS or live-mode state changed.
- The first separately authorized disposable payout preparation stopped at
  Stripe account creation before an account existed. Current Stripe rejects a
  request containing both legacy `type=custom` and the explicit `controller`
  contract. Cleanup completed with no preparation evidence, handoff or attempt
  journal remaining, and Connect stayed disabled at stage 3. The isolated
  correction removes only the redundant `type` field, retains the exact
  Custom-equivalent controller contract, and requires the returned account to
  re-attest that controller before any funding charge or payout can be created.
- Before retry, the controller fix exposed a separate provenance coupling: the
  signed-payout operator required the completed stage-3 cutover artifact to
  claim the later proof commit and CI run. Re-running a provider mutator merely
  to rewrite historical evidence would erase the true release boundary and
  could roll stage 3 backward on a late local failure. The corrected contract
  therefore requires two explicit exact bindings: the retained cutover
  commit/CI inside the immutable stage-3 evidence and the current proof
  commit/CI used for source code and GitHub gates. This is proof-chain code and
  documentation only; Stripe remains disabled at stage 3.
- The next separately authorized preparation retry also stopped before an
  account existed. Stripe required the platform profile acknowledgment because
  the proof's Custom-equivalent controller made Grainline responsible for
  collecting identity requirements. That did not match production seller
  onboarding, which uses an Express dashboard and Stripe-collected requirements
  while retaining application-paid fees and losses. The isolated correction
  aligns the disposable controller with the production responsibility shape,
  removes application-collected individual identity and service-agreement
  fields, and keeps exact returned-controller attestation before any funding or
  payout call. No profile acknowledgment was accepted, no disposable account
  or proof residue remains, and Connect remains disabled at stage 3.
- The first production-aligned retry was accepted by Stripe far enough to
  create the disposable test account, but the returned account did not satisfy
  the exact controller attestation. The coarse validator did not identify which
  returned enum differed. It stopped before a funding charge or payout, deleted
  the account, removed the attempt journal, and wrote no preparation evidence or
  handoff. A separate read-only provider check confirmed test-mode stage 3 with
  Connect disabled and the exact 10/12/1 event topology. The follow-up adds a
  sanitized mismatch diagnostic containing only presence booleans and the four
  non-secret controller enums; it cannot emit the account ID, release marker,
  identity fields, bank details or credentials.
- The diagnostic retry from exact main `2cea1ee9` and green CI `31345457588`
  proved that the account ID, marker and all four production-aligned controller
  fields matched. The sole mismatch was an absent `livemode` property, which is
  not part of Stripe's Account object response. The proof stopped before the
  funding charge or payout, deleted the disposable account, removed its attempt
  journal, and left no preparation evidence or handoff. The corrected validator
  permits only omission or an explicit `false`; the `sk_test_` key remains a
  hard prerequisite and the later charge, payout and event must each prove
  `livemode=false`. A separate read-only provider read returned predecessor
  stage 3, so the Connect endpoint remains disabled.
- The next production-aligned retry from exact main `71cfd99e` and green CI
  `31346513991` created and re-attested the expected test account, then stopped
  before funding because Stripe-collected Express capabilities did not become
  active without hosted onboarding. Exact deletion completed and no account,
  preparation attempt, handoff or evidence remained. The isolated correction
  adds a restart-safe Stripe-hosted test-onboarding boundary: the raw account
  ID and single-use Account Link URL exist only in a mode-`0600` temporary
  record, the terminal result and durable evidence contain neither, and the
  same attempt/account must re-attest both charges and payouts enabled before
  funding or payout creation. Connect remains disabled at provider stage 3;
  this change itself creates no account, Account Link, charge, payout, webhook
  delivery, deployment, migration, secret or live-mode mutation.
- PR #182 merged the hosted-onboarding boundary as exact `main`
  `0b718171e71700990bf8f9106ee880b116707bd3`; exact-main CI `31357207924`
  passed. The separately authorized test-mode preparation resumed one
  disposable Express account through Stripe-hosted onboarding. The operator
  stopped until Stripe independently reported both charges and payouts
  enabled, then created one test funding charge and one USD 1.00 payout using
  Stripe's reviewed failing test bank. The payout produced exactly one fresh
  `payout.failed` event with failure code `no_account`. Sanitized durable
  evidence at
  `archive/stripe-connect-disposable-payout-preparation-test-20260810-0b718171.json`
  contains only provider-ID hashes and is bound to exact main, CI, compatible
  deployment `dpl_CasoctMLsvfcA1Vj2JJcNUFzXQXP` and the immutable stage-3
  cutover evidence. The raw account, payout and event handoff plus its attempt
  journal remain mode `0600` under `/private/tmp` for restart-safe signed-proof
  cleanup; the single-use onboarding record was removed. The canonical Connect
  endpoint remains disabled at provider stage 3. No event was delivered or
  resent, no endpoint was enabled, and no deployment, migration, database,
  grant, RLS, Vercel-variable, secret or Stripe live-mode state changed. The
  next boundary is the separately reviewed signed-delivery and exact-retry
  proof; preparation success does not authorize that mutation.
- The first explicitly authorized signed-delivery attempt revalidated the
  exact preparation, deployment, runtime identity and disabled stage-3
  provider state, then enabled the exact Connect endpoint. Before any event
  resend, the pinned Stripe CLI `1.39.0` printed its exact version followed by
  a newly applicable update notice on standard output. The operator's
  whole-output comparison failed, and its recovery path independently returned
  Connect to disabled canonical stage 3. No event was delivered or retried, no
  webhook lease or payout projection was written, the disposable account was
  retained, final evidence remained absent, and the exact handoff plus attempt
  remain mode `0600`. The isolated correction preserves the exact CLI version
  pin, recognizes only Stripe's narrow update-check suffix, rejects any other
  suffix, and separates the immutable preparation commit/CI binding from the
  fresh corrected proof commit/CI binding. No deployment, migration, RLS,
  grant, secret, Vercel-variable or live-mode Stripe change is part of the fix.
- PR #184 merged the CLI-output correction as exact `main`
  `b9444e3488db9276c0d9f895043fe1fc32c850d1`; exact-main CI
  `31366490630` passed. The authorized corrected test-mode proof enabled the
  canonical Connect endpoint, delivered the prepared `payout.failed` event and
  sent exactly one retry. Pooled `grainline_app_runtime` evidence proved one
  processed generation-1 webhook lease, no seller or payout projection for the
  unlinked account, and no lease change on retry. Cleanup deleted the
  disposable account plus all raw-ID temporary records. Sanitized mode-`0600`
  evidence is retained at
  `archive/stripe-connect-signed-payout-proof-test-20260810-b9444e34.json`;
  no raw provider ID or secret is present.
- The immediate read-only provider audit passed the exact enabled test-mode
  10/1/12 event topology for platform snapshot, classic Connect payout and
  thin v2 account destinations. Sanitized mode-`0600` evidence is retained at
  `archive/stripe-webhook-subscriptions-test-20260810-b9444e34.json`. Connect
  is now enabled at reviewed test-mode provider stage 4. No deployment,
  migration, database grant/RLS change, Vercel variable or secret change, or
  Stripe live-mode operation occurred. Aggregate ops health, valid Connect v2
  signed delivery, predecessor drain and final compatibility postflight remain
  before StripeWebhookEvent activation; live-mode topology and signed delivery
  remain a separate launch gate.
- The authenticated aggregate ops-health request then acquired a fresh UTC-hour
  bucket and returned HTTP 200 with `skipped=false`, all four Stripe
  failure/lease counts at zero, a healthy SavedSearch canary and every other
  operational issue count at zero. Sanitized evidence is retained at
  `archive/stripe-webhook-ops-health-connect-acceptance-20260810-b9444e34.json`.
  This normal health invocation recorded only its bounded CronRun row and made
  no provider, deployment, migration, grant, RLS, secret or live-mode change.

## Dependency security refresh (2026-07-25)

- GitHub Actions run `30174843104` first proved the Conversation/Message PostgreSQL invariants, grant convergence, TypeScript, lint, and tests, then failed at the independent dependency-audit step because advisories published after the last green `main` run affected the unchanged lockfile. This is repository-wide security drift, not an RLS proof failure.
- `next` moved from `16.2.6` to `16.2.12`. Grainline uses App Router Server Actions, so GHSA-m99w-x7hq-7vfj is reachable; GitHub documents no workaround other than upgrading. Other July 2026 Next advisories are patched by the same update.
- `postcss` moved from `8.5.10` to `8.5.23` in both the direct development dependency and the npm override. The resolved tree must contain exactly one PostCSS installation.
- Direct Prisma packages remain aligned at `7.9.0`. The compatible `@prisma/dev@0.24.16` override resolves `find-my-way@9.7.0`, and `valibot@1.4.2` closes the remaining Prisma development-tool advisory without changing Prisma's direct minor.
- A proposed global `brace-expansion@5.0.8` override was rejected after verification: ESLint's `minimatch@3` expects the older callable CommonJS API and lint failed with `TypeError: expand is not a function`. The override is not retained.
- `scripts/audit-dependencies.mjs` runs both production-only and full audits. High/critical production vulnerabilities always fail. The full audit permits only GHSA-mh99-v99m-4gvg through development-only ESLint paths; every other high/critical advisory fails. Remove this exact exception once upstream ESLint consumers accept a patched compatible dependency.
- **2026-08-01 follow-up:** the legacy `minimatch@3` path moved from unbounded
  `brace-expansion@1.1.16` to the official callable CommonJS `1.1.17` bounded
  backport. The temporary GHSA-mh99-v99m-4gvg development-only exception was
  removed; all high/critical advisories now fail both audit passes. The direct
  user-content sanitizer also moved from `sanitize-html@2.17.4` to `2.17.6`
  for GHSA-vccv-cmxp-4j9h. Existing Grainline policies already excluded the
  affected form/media attributes, but the upgrade closes the dependency-level
  URI-scheme gap before a future policy expansion can expose it.
- Production release accepted on 2026-07-25:
  - Dependency patch commit: `50ef609bbb747070cbb57bc469c2e99831ffc302`.
  - Exact merged `main` commit: `1a7904852eb751f086eb048a0e83aa3627dfaa1d`.
  - Pull request: `#40`.
  - Pull-request CI run `30175735578` and post-merge `main` CI run `30175897573` passed, including migrations, grant audits, the dependency gate, the full test suite, and the production build.
  - Post-merge Notification FORCE proof run `30175897569` passed rollback, grant, and service-authority checks.
  - Exact production deployment: `dpl_GvwU3xtgMWyR5E1JwHKPs1yUionq` (`grainline-iwsom87u6-drew-youngs-projects.vercel.app`).
  - Vercel reported the deployment `READY`, target `production`, and assigned `thegrainline.com`, `www.thegrainline.com`, and the stable Vercel aliases. The deployment build used Next.js `16.2.12`; the production runtime database isolation guard verified `grainline_app_runtime`.
  - Independent canonical-domain smoke returned HTTP 200 and the response asset URL carried `dpl=dpl_GvwU3xtgMWyR5E1JwHKPs1yUionq`, proving `thegrainline.com` served this exact deployment.
  - This release changed dependencies and audit tooling only; it applied no database migration and changed no RLS policy.

Open work:

- Continue with abuse/volume economics and any new Claude-proposed findings added to `audit_open_findings.md`; treat those entries as suspected until locally reproduced.

## Stripe webhook RLS activation authority review (2026-08-08)

- The Extra-High pre-activation review found that the activation preflight and
  disposable PostgreSQL proof required runtime `EXECUTE` on the six fixed
  Stripe webhook functions, but did not reject `EXECUTE WITH GRANT OPTION`.
  The activation migration itself granted plain `EXECUTE`, so no reviewed
  production state had the broader authority; the defect was in proving the
  exact intended ACL. The activation SQL and PostgreSQL proof now reject a
  runtime function ACL whose grantor is not the owner or whose grant is
  grantable. The global grant audit independently applies the same class-wide
  check to every Grainline function. Unit coverage exercises both plain and
  grantable runtime ACLs.
- The same review found that the bounded 90-day Stripe webhook maintenance
  prune included legacy `checkout.session.stock_restored` claim rows. Those
  rows are permanent replay barriers: deleting one could allow an old expired
  Checkout Session to pass the authenticated stock-rollback path again and
  restore inventory twice. The maintenance migration now excludes that event
  type from the general prune. Its disposable PostgreSQL proof creates an old
  permanent claim and proves it survives, while ordinary terminal events still
  prune in bounded batches.
- The corrected maintenance migration SHA-256 is
  `0c34cc94f6a602e8f686487277b422f3ba4e89a1f2c50b9b3b673cb63d259df5`;
  the corrected maintenance phase-tree fingerprint is
  `551be631510a20c58eae7b1e84f84d23890d5c2e82b0d1332c7f9f266744f22d`.
  The corrected activation draft SHA-256 is
  `29dcf34d4438999469313b22415f221f917c372fb6e880c57276c0e9ee177c2b`,
  the promoted activation migration SHA-256 is
  `f33fc6c9b65444b437d62856c22116cac56c6a4d8c7b05340117120a06aab66b`,
  and the resulting full migration-tree fingerprint is
  `72b5648c4cdc98245dd3b2887a0aab89b264ed860f6141d5a215c2fe34569a13`.
- These changes remain isolated on the cumulative activation branch. Production
  was not changed. The corrected maintenance bytes must replace the earlier
  bytes on PR #162 before that migration can merge or run; otherwise a later
  edit would create a Prisma migration-checksum mismatch. The cumulative PR
  #164 must not be merged as one release batch.
- Exact reviewed checkpoint `fb0facf146e58123ddd2f4a727fda1b966669d5d`
  passed CI run `31272188477`: disposable PostgreSQL activation and rollback,
  four direct runtime denial probes, restored-posture grant/RLS audit, 2,824
  tests with seven intentional skips, TypeScript, lint, both dependency audits,
  and the production build. This is candidate evidence only, not production
  activation authority.

## Dependency security refresh (2026-08-08)

- StripeWebhookEvent activation PR #164 exact-head CI run `31268968442`
  passed the complete disposable-PostgreSQL activation, fixed-operation,
  rollback/restoration and grant/RLS proof chain, then failed at the independent
  dependency gate before the production build. The RLS branch did not introduce
  the advisory and production was not touched.
- The production tree resolved `nanoid@3.3.16` through `postcss@8.5.23`.
  GHSA-2v37-7h3g-55p8 affects custom generators called with a zero size and is
  fixed on the compatible 3.x line. The isolated lockfile now resolves
  `nanoid@3.3.18` without adding a direct dependency or override.
- After that production-tree repair, the full audit exposed
  GHSA-5p4m-2wfm-xmqj in development-only `js-yaml@4.3.0` through ESLint. The
  compatible transitive resolution is `js-yaml@4.3.1`.
- Dependency hygiene tests pin both reviewed resolutions so a later lockfile
  refresh cannot silently restore the vulnerable versions. Both the production
  and complete audit must be clean; no exception, forced audit rewrite, direct
  dependency or npm override is introduced.

## Stripe webhook activation source and postflight hardening (2026-08-08)

- A second Extra-High review found that the policyless activation pinned all
  six function signatures, owners, modes, search paths and ACLs but not their
  exact PostgreSQL source bodies. A signature-compatible `CREATE OR REPLACE`
  drift could therefore have passed the migration preflight. The candidate now
  derives the latest reviewed function sources from the committed preparation
  migrations, pins each `md5(prosrc)` in activation SQL, and compares SHA-256
  under the actual runtime postflight. The source catalog fails closed unless
  all six expected functions are found exactly.
- The database-first rollback previously proved the restricted runtime role's
  direct authority but did not explicitly reject direct PUBLIC table or column
  ACL drift. Both rollback preflight and postflight now reject those classes.
  Disposable PostgreSQL injects a PUBLIC table grant and a PUBLIC column grant
  separately and proves each aborts before posture mutation.
- A dedicated production postflight now uses only the pooled
  `grainline_app_runtime` credential, rejects owner and aliased URLs, attests
  the exact production endpoint/database/role plus repeatable-read/read-only
  transaction state, and records sanitized mode-0600 evidence. It is an
  operator tool rather than a GitHub Production workflow because that protected
  environment intentionally contains only the owner migration credential.
  CI separately gives its ephemeral runtime role a disposable password and
  opens a new connection as that role to exercise the same catalog, denial,
  health and read-only-fence path without owner `SET ROLE`.
- Corrected candidate hashes are: draft
  `fd92c05ca2581eeeec19fd81e41a0dd672300381ad2d55396234a8f2fb0907d3`,
  promoted migration
  `c500e2c5135488d81929025a184f384fd53eed37f38d8dbf7e7e9bb8445e1299`,
  rollback
  `2174c06aba53726523921ef0938cc92744aed187ea5dfdff3a8ea1e3499b3722`,
  and migration tree
  `d525a4d8e7982f49dbfd280b9d9cc46e0dac39da0507b66881b7828786cd4bdc`.
  These bytes remain isolated on PR #164. No production migration, grant, RLS,
  deployment or provider state changed in this review.

## CheckoutStockReservation source-consistency acceptance (2026-08-14)

- `CSR-A23`: the compatible fixed-operation application was authority-safe but
  assembled Cart/Listing creation evidence in multiple application statements.
  A concurrent source edit could make the snapshot stale before mutation. The
  accepted candidate now locks and validates every creation source and derives
  the written reservation in one PostgreSQL statement; the application witness
  is rejection-only and cannot select targets or payload.
- `CSR-A24`: two fresh provider slots passed through exact disposable Preview
  commit `d0bb3824176ad9e006d9423c771b9a984a09bf16` and deployment
  `dpl_CB3uX5qzZESrBMCMh9hYMuDgWbES`. All four 80-request workloads completed
  with zero errors/issues/residue; candidate p95 was 151.4-185.4 ms and maximum
  187.1 ms against unchanged 750/3000 ms thresholds. All child, Preview,
  variable, bypass, fixture and local proof state was deleted; production was
  unchanged.
- The additive promoted migration
  `20260814053000_prepare_checkout_stock_reservation_source_consistency` has
  SHA-256 `69623f2363c6ae4978ff2cc8a22ccc1b8d9f43d378e01678c2fc6ef6f14b9928`
  and complete-tree SHA-256
  `527b93f81e4b74a2cf04218d2d4b53cd8524bbb4fc9b93db6072c387bbb71e54`.
  It adds three private and two runtime functions without RLS, policy, grant or
  data changes. CI and the guarded production workflow now prove the exact
  successor order and fail closed on unknown, duplicate, failed, drifted or
  later migration rows. This isolated wiring does not authorize merge,
  dispatch, migration, deployment, activation or provider change.
- Exact main `16239fce2956c6dc726c24ccd7a91d1ea35463bd` passed CI run
  `31813433933`. Guarded Production Migrations run `31814032227` applied only
  the promoted source-consistency migration, converged the reviewed function
  grants, reported all 195 migrations applied, passed the 64-table global
  grant/RLS audit and ended with `state: source-consistent`. The final proof
  found zero activation rows, zero FORCE rows and made no changes itself. No
  deployment, RLS activation, predecessor-grant revocation, cleanup or provider
  change occurred.
- The actual production postflight passed separately from exact clean main
  `ac4c9d2139f5294c5e91edd24acb3dbe71b4976c`, bound to exact-main CI
  `31819848330`, migration-main CI `31813433933` and migration run
  `31814032227`. It authenticated only as pooled `grainline_app_runtime` inside
  an engine-attested repeatable-read/read-only transaction, matched the exact
  25-function and compatible table catalog, proved private-helper denial and a
  SQLSTATE `25006` fixed-write fence, then rolled back. Sanitized mode-0600
  evidence SHA-256 is
  `bec37f40d995e311bee5d80fc63c3485f7d325cdcd846b88656684fe2f592afe`;
  `productionChangedByPostflight=false`. No deployment, RLS/grant change,
  cleanup or provider mutation occurred.
- Exact authority-hardening checkpoint
  `7a57316bcd16daeef5ac9d595180284d1953e316` passed exact-head CI run
  `31282060518`. The run exercised the actual direct disposable runtime login,
  exact six-function source catalog, policyless activation, direct denial,
  read-only write fence, lease and maintenance behavior, PUBLIC table/column
  rollback drift rejection, restoration and final catalog audit, followed by
  TypeScript, lint, 2,846 tests with seven intentional skips, both dependency
  audits and the production build. This is isolated candidate evidence only;
  production was not changed.
- A later release-order review found an operator-documentation gap: PR #162's
  application calls three functions introduced by its own additive migration,
  while the written stack sequence moved directly from merge to deployment.
  The release contract now requires applying only
  `20260805040000_prepare_stripe_webhook_maintenance_authority` from the exact
  green main commit, then verifying migration status and the global grant/RLS
  audit, before any deployment containing those call sites. The code and
  migration boundary were unchanged; this prevents a new deployment from
  calling not-yet-created functions.

## Stripe webhook activation current-main refresh (2026-08-10)

- The activation candidate was rebuilt on the accepted current-main provider
  evidence rather than merging the stale cumulative PR #164. The provider
  proof is test-mode only: classic Connect `payout.failed` signed delivery and
  exact retry produced one unchanged generation-1 lease, exact 10/1/12
  topology passed, aggregate ops health was clean, and the disposable account
  plus raw recovery records were deleted.
- The Extra-High refresh found that the final predecessor postflight still
  proved only the original three lease functions and reduced combined runtime
  CRUD to one boolean. That was insufficient after the maintenance conversion.
  The postflight now requires exact direct SELECT/INSERT/UPDATE/DELETE with no
  grant option, no PUBLIC or column authority, and exact owner/mode/search-path,
  ACL and SHA-256 source identity for all six runtime functions. It remains an
  engine-attested repeatable-read read-only production proof.
- The activation SQL now separately counts all runtime-executable overloads of
  the six trusted function names. A shadow overload therefore aborts before
  RLS or grants change even when every canonical signature and source body is
  still present.
- Connect v2 signed delivery remains a mandatory launch/provider gate, but was
  removed as a `StripeWebhookEvent` database-authority prerequisite. Static
  coverage now proves the platform, classic Connect and v2 routes all call the
  same fixed begin/complete/fail wrappers and have zero direct table access.
  This reclassification does not weaken the launch checklist or claim that the
  v2 signing secret/provider delivery has been proved.
- Refreshed candidate hashes are: draft
  `af47ed86b90276b0285618b7751c27a15fc52bd0a1a7bcc279c959e05c37e88b`,
  promoted migration
  `6e9175b503d77cf899c8d4b9abb882788776e7d104a39bad5f7c4a5de122e033`,
  rollback
  `2174c06aba53726523921ef0938cc92744aed187ea5dfdff3a8ea1e3499b3722`,
  and migration tree
  `fbbaeaf57b32ebd382138685ea972487ed0c52f92fe01ca88421bf2021b9b2c5`.
  These are isolated candidate bytes. Production RLS, grants, migrations,
  deployment and provider state were unchanged by this review.
- Draft PR #186 exact-head CI run `31372159544` failed closed in the compatible
  production-postflight PostgreSQL proof before the activation release was
  restored. The newly expanded function audit incorrectly applied the runtime
  wrappers' `VOLATILE` / `PARALLEL UNSAFE` contract to all four private order
  integrity functions. `grainline_order_seller_key_assert(text)` is
  intentionally read-only `STABLE` / `PARALLEL SAFE`; the proof now pins each
  function's individual volatility and parallel mode, and the unit contract
  enumerates the exceptional read-only function explicitly. No production or
  provider state changed.
- Corrected candidate `d9b637c6a76196579317de3b189046746ca19916`
  subsequently passed exact-head CI `31372665563`, including the real
  disposable-PostgreSQL runtime-login proof and production build. The current
  canonical Vercel deployment remained `READY` at source `69c14c06`, and the
  canonical health endpoint returned HTTP 200. The hardened predecessor
  postflight then passed from that exact clean candidate through the actual
  pooled production runtime in an engine-attested repeatable-read read-only
  transaction: exact predecessor CRUD, no PUBLIC/column/grant-option drift,
  exact four-private plus six-runtime function catalog, six zero integrity
  counts, and direct private-function denial. It recorded sanitized mode-0600
  evidence and reported `productionChangedByPostflight=false`; no production
  or provider state changed.
- PR #186 merged exact head
  `654a730b575ddbcf954f6a6287f5aa6fa34c592a` as exact main
  `f987645784a447604fcab2399dc8e7fd7bef9d7c`; exact-main CI
  `31408797498` passed. Guarded Production Migrations run `31410550315`
  applied only `20260805060000_enable_stripe_webhook_event_rls`, then passed
  migration status and the global grant/RLS audit. Production now has
  policyless ENABLE/NO-FORCE, zero policies, zero direct runtime/PUBLIC table
  or column authority, and exactly six source-pinned runtime functions. The
  separate actual pooled-runtime postflight passed from exact clean main in an
  engine-attested repeatable-read read-only transaction, proving direct denial,
  aggregate health, exact function/source/ACL identity and the write-function
  read-only fence; it reported `productionChangedByPostflight=false`. No app
  deployment, FORCE change or Stripe/Vercel provider change occurred.
- PR #188 merged the separately reviewed posture-only FORCE preparation from
  exact head `b8a9f41b9f5ca966f02901fb322ba9775210fd80` as exact main
  `6d448bce38bed2aa54bf4ce7ae8e5f8a4ba73186`. Exact-head CI `31417322388`
  and exact-main CI `31419148169` passed the ordered Phase-A/FORCE PostgreSQL
  authority, rollback/restoration, migration, grant, application and build
  gates. The merge staged migration
  `20260810172000_force_stripe_webhook_event_rls` on main but did not run it;
  production remains policyless ENABLE/NO-FORCE Phase A. No migration,
  deployment, provider change or production FORCE occurred at this boundary.

## CheckoutStockReservation compatible application production release (2026-08-14)

- PR #209 merged exact reviewed head
  `a6556be1ae4afde93af46899f0a9e74e22d85644` as exact main
  `84a58f0fc818b502564ef6bcd974ff4af3cc4395`. Exact-main CI run
  `31822968848` passed all 109 gates, including disposable PostgreSQL proofs,
  TypeScript, lint, the complete suite, dependency audits and production build.
- Manual Vercel Production deployment
  `dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw`
  (`grainline-l8zenc6ym-drew-youngs-projects.vercel.app`) built from an exact
  clean detached worktree. The runtime DB guard proved the pooled
  `grainline_app_runtime` role; Vercel reported READY and assigned
  `thegrainline.com`, `www.thegrainline.com` and both stable Vercel aliases.
- Canonical `GET /api/health` returned HTTP 200 with `{ "ok": true }`.
  Unauthenticated POSTs to cart checkout, Buy Now checkout, resume and rollback
  each returned the expected 401. No migration, RLS/grant change, cleanup or
  Stripe/provider mutation accompanied the release.
- These immediate checks did not prove authenticated checkout. No fail-closed
  production fixture/session/cleanup operator existed at deployment time. The
  separate execution recorded below later closed that gate without claiming
  paid completion. CheckoutStockReservation RLS remained off and predecessor
  table grants remained intact throughout.

## CheckoutStockReservation authenticated production smoke (2026-08-14)

- PR #212 merged the reviewed restart-safe smoke operator as exact main
  `e9d343b6f316ceb1c75553aec77e9f310a12d802`. Exact-main CI run
  `31829740992` passed all 109 gates before execution.
- The operator reused only the retained non-customer Clerk canary and one
  existing eligible test-mode seller. It created private buyer-reserved
  fixtures, exercised Buy Now in-stock, Buy Now made-to-order and cart
  in-stock checkout, proved three exact retry reuses, cart resume, rollback,
  stock restoration, Redis-lock release, cross-origin denial and zero Orders.
- Three real test-mode Checkout Sessions were expired and their three genuine
  signed `checkout.session.expired` deliveries were processed. The
  made-to-order predecessor path retained exactly one processed
  `checkout.session.stock_restored` idempotency claim without changing stock.
- Cleanup deleted every database fixture and Redis/account-state key, restored
  canary terms state and revoked every canary session. Expected immutable
  residue is limited to three expired test Checkout Sessions, three processed
  expiry ledger rows and one processed made-to-order restore claim.
- The sanitized mode-`0600` evidence SHA-256 is
  `86b37f18cae8fadb8a126b548455201a7816c74f00731d13fa8a6bf2de8602db`;
  it contains counts and booleans only, records every cleanup invariant true
  and reports `secretsRetained=false`.
- No migration, RLS/grant change, deployment or provider configuration change
  occurred. Paid completion was deliberately not exercised because it would
  create durable charge, Order, notification and email side effects. The next
  boundary is predecessor deployment drain before policyless ENABLE/direct-
  grant revocation; FORCE remains separate.

## CheckoutStockReservation predecessor drain preparation (2026-08-14)

- Provider inventory proved the current compatible deployment is exact source
  `84a58f0f...` at `dpl_AGN7...`. Exactly one superseded READY deployment,
  `dpl_C3N3...`, sits between the accepted credential rotation and the current
  deployment and therefore shares the current runtime password.
- The restored credential-recovery record and byte-pinned sanitized evidence
  prove every older deployment's embedded runtime password rejects. The prior
  completion doc had remained on an unmerged record branch while current docs
  referenced it; this preparation restores a concise accepted record on main.
- The restart-safe operator validates exact clean main/CI, deployment sources,
  inventory, aliases, maximum 300-second request duration, canonical health
  and credential-recovery evidence. It writes private restart state before it
  removes only the exact superseded deployment, then proves absence and writes
  sanitized evidence.
- This preparation changes no production/provider state. CheckoutStockReservation
  RLS remains off and direct predecessor grants remain until the separate
  operator execution passes.

## CheckoutStockReservation predecessor drain verifier correction (2026-08-14)

- Exact main `05e652501485e2701720e1883906ec0a36bb75a0` and CI
  `31845083086` passed before the reviewed operator removed only deployment
  `dpl_C3N3PudFHg4GoRMAAZJuz9aNZ5Y6`.
- The final absence verifier failed closed on Vercel CLI 59.0.0's real `Can't
  find the deployment` diagnostic. Direct read-only inspection confirms the
  predecessor is absent and current deployment
  `dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw` remains READY.
- A private restart marker remains at exact stage `removal-authorized`. The
  correction adds that provider phrase plus an exact old-commit, old-CI and
  stage tuple; it does not permit generic prior state or manual state edits.
- CheckoutStockReservation RLS remains off and direct grants remain intact.
  No migration, deployment, alias, secret, environment-variable, database or
  other provider-configuration change occurred.

## CheckoutStockReservation predecessor drain completion (2026-08-14)

- PR #215 merged the exact provider-diagnostic and restart-tuple correction as
  main `4ff40f22c70072406168c378cdb13860f9de317b`; exact-main CI
  `31858295911` passed the full database, type, lint, test, dependency and build
  gates.
- The restart-safe finalizer accepted only prior main `05e652501485e2701720e1883906ec0a36bb75a0`,
  CI `31845083086` and stage `removal-authorized`, then proved the exact
  predecessor absent, current deployment READY, all four canonical aliases
  preserved and canonical health exact.
- Sanitized mode-`0600` evidence SHA-256 is
  `5f3b63675bdc84749b5f8fef25086bc42a5dddba5e87f5a46fa7bf6015322141`;
  it records one-to-zero shared-credential predecessors and no secret retained.
  The private restart marker was removed.
- No migration, deployment, RLS/grant, alias, environment-variable or provider
  configuration change occurred. CheckoutStockReservation RLS remains off;
  policyless ENABLE/direct-grant revocation and FORCE remain separate.

## CheckoutStockReservation activation refresh (2026-08-15)

- `CSR-A33`: the earlier draft-only activation package pinned the original
  20-function authority catalog. Production's accepted source-consistency
  successor has 25 exact functions, so the stale preflight would fail closed
  and could not activate the real predecessor. The refreshed package pins all
  18 runtime operations and seven private helpers, including the two
  source-consistent creation functions and three SQL witness helpers. After
  verifying that predecessor, Phase A retires runtime EXECUTE on the two unused
  legacy creation functions, producing a 16-runtime/9-private activated
  partition without dropping the rollback functions.
- `CSR-A34`: the transplanted PostgreSQL proof duplicated indexes already in
  the current synthetic predecessor, omitted the source-consistency successor
  from tamper fixtures and could inherit PGlite's internal bootstrap identity
  after `RESET ROLE`. The proof now uses the exact current indexes, applies both
  predecessor migrations and explicitly restores the `ci` owner identity
  before the owner-bound activation transaction.
- `CSR-A35`: the application authority module still exposed two unused callers
  for the legacy creation functions even though both checkout routes use the
  source-consistent successors. The refresh removes those exports and reverses
  the guardrail so deployable source cannot call either retired function.
- The candidate remains production-inert and read-only. It proposes policyless
  ENABLE with zero policies, revokes direct runtime/PUBLIC table and column
  authority, preserves database-first compatible rollback and cannot create a
  Prisma migration directory. FORCE remains separate.
- No production query, migration, deployment, RLS/grant change, cleanup or
  provider mutation occurred during this refresh.

## CheckoutStockReservation activation promotion (2026-08-15)

- The prerequisite activation-refresh PR #217 merged as exact main
  `865a2de0d5a5e1225e85da9bdb431df9f030e90f`; exact-main CI
  `31868509324` passed. Vercel created only the expected failed Preview and no
  Production deployment.
- Promoted only the exact deterministic candidate as migration
  `20260815060000_enable_checkout_stock_reservation_rls`; promoted SHA-256 is
  `7940be1969c89c8bbf5818164a56afb7e8bf7925bd8a26231d8ac865fac7c519`
  and migration-tree SHA-256 is
  `b014ea6ccc6ec6107e06897269ed607e6a8930c770fea3914e4b6b8b42b502f3`.
- Added a distinct fail-closed deploy-guard phase and release verifier. CI
  isolates the new migration while historical predecessors replay, restores
  it only after the source-consistency catalog is proven, applies it to
  disposable PostgreSQL, converges exact grants and runs the global audit.
- Added an actual direct-login `grainline_app_runtime` proof in an
  engine-attested repeatable-read read-only transaction. It checks exact
  identity/catalog, direct-table and private-helper denial, fixed export, and
  SQLSTATE `25006` at the fixed-write fence.
- Production workflow wiring remains intentionally absent. No production
  query, migration, deployment, RLS/grant change, cleanup or provider mutation
  occurred during promotion.

## CheckoutStockReservation activation production wiring (2026-08-15)

- Release PR #218 merged exact reviewed head
  `1dbab12dfe52867f1df5ca8689db2e3f0ae89933` as main
  `5817dea6725f7f2eb7fde3da1f546aa75dd449b1`; exact-main CI run
  `31892857440` passed. No Production deployment followed the merge.
- `CSR-A36`: the generic Production Migrations workflow still ended at the
  source-consistency preparation and had no activation-specific restart
  classifier. The isolated correction verifies and removes the byte-pinned
  activation before replaying the sealed source-consistency/authority prefix,
  restores migrations in dependency order, and runs the activation scope
  proof before Prisma and after the final global audit.
- The scope proof reads `_prisma_migrations` only inside an engine-attested
  `READ ONLY` transaction. It recursively retains the three reviewed
  historical ledger exceptions, accepts only an exact source-consistent or
  exact fully activated restart state, and rejects unknown, missing, duplicate,
  partial, rolled-back or checksum-drifted activation rows.
- Unit and disposable-PostgreSQL proofs cover both accepted restart states and
  reject a zero-step failed activation row instead of implicitly resolving or
  replaying it.
- The review also removed stale, pre-release activation/FORCE placeholder names
  from the older authority-only scope verifier. Its regression test now rejects
  the actual byte-pinned activation successor explicitly.
- This is isolated workflow, test and documentation work only. It was not
  merged or dispatched; no production query, migration, deployment, RLS/grant
  change, FORCE, cleanup, credential or provider mutation occurred.

## CheckoutStockReservation Phase-A production completion (2026-08-15)

- Production-wiring PR #219 merged exact reviewed head
  `6dec4f84afea9e817a29247f9f57cf5646cc5b8b` as main
  `405d6dff327bee76aced17f3876f8f18f29e05db`; exact-main CI
  `31894742120` passed the database, type, lint, test, dependency and build
  gates.
- Guarded Production Migrations run `31903152300` accepted only the exact
  source-consistent restart state, applied only
  `20260815060000_enable_checkout_stock_reservation_rls`, converged the
  reviewed activated grants, and passed migration status, global grant/RLS
  audit and exact applied-ledger scope.
- Production now has policyless RLS enabled on
  `public."CheckoutStockReservation"`, FORCE off, zero policies, zero direct
  ordinary-runtime/PUBLIC table or column authority, 16 runtime-executable
  fixed operations and nine owner-private functions. No row data changed.
- The separate actual pooled-runtime postflight ran from the clean exact main
  commit inside an engine-attested repeatable-read/read-only transaction. It
  proved restricted identity, the exact 25-function source/mode/owner/ACL
  catalog, direct-table denial, fixed export success, private-helper denial and
  SQLSTATE `25006` at the fixed-write fence.
- Sanitized mode-`0600` evidence SHA-256 is
  `899679a14590200880e89d983fff70492632de458649316bd69cde9a0027ece0`;
  it records `productionChangedByPostflight=false` and retains no URL, secret
  or row data.
- No application deployment or provider change accompanied Phase A. FORCE is
  the next separate CheckoutStockReservation database boundary.

## CheckoutStockReservation FORCE isolated release (2026-08-15)

- Prepared the separate posture-only migration
  `20260815060001_force_checkout_stock_reservation_rls`, promoted SHA-256
  `cfa05295bd469903aa967919a0178312dbbc855203c408db2395602589f5178d`.
- The migration changes only `relforcerowsecurity`; policy, grant, function,
  schema, data, application and provider changes are rejected by the builder
  and release tests.
- The preflight binds the exact accepted Phase-A table/role graph and all 25
  function signatures, sources, modes and ACLs. It retains 16 runtime and nine
  private functions and rejects dynamic SQL or authority expansion.
- Added loopback-only direct-runtime FORCE proof and restart-safe owner
  rollback/restoration proof to disposable CI PostgreSQL.
- The first real disposable-PostgreSQL proof exposed a name-only overload
  count: the legitimate older webhook-begin overload made the reviewed
  16-signature runtime set appear to contain 17 functions. The final preflight
  joins exact names plus `oidvectortypes(proargtypes)`. Real-PG regression
  coverage now proves both accepted overload coexistence and post-Phase-A
  function-drift rejection with FORCE left off.
- Production remains at Phase A. The production scope, guarded workflow and
  actual pooled-runtime postflight are intentionally deferred to a separate
  reviewed boundary.

## CheckoutStockReservation FORCE guarded-wiring preparation (2026-08-15)

- FORCE release draft PR #221 pins exact head
  `a0eadb74707652e3883bde36d9c44be3a430a737`; exact-head CI run
  `31907436947` passed all 133 steps, including the canonical clean install and
  production build.
- Added a FORCE-specific read-only production-scope verifier that recursively
  seals the accepted migration ledger through Phase A plus the one exact FORCE
  successor. Restart accepts only a complete activated state with no FORCE row
  or one complete force-hardened state.
- Added unit and disposable-PostgreSQL coverage for both accepted restart
  states and fail-closed rejection of a zero-step FORCE row.
- Local validation passed 358 focused tests and the full suite with 3,106
  passed, seven intentional skips and zero failures; TypeScript, lint and diff
  checks passed.
- Wired the exact migration into the guarded workflow on an isolated successor
  branch: FORCE is verified and isolated before predecessor verification,
  restored last, restart-proven before Prisma, and after-proven following
  migration status and the global grant/RLS audit.
- Guarded-wiring draft PR #222 pins exact head
  `5af7d4801dc36d3f63b7168b3790d92b1a4cd0b8`; exact-head CI
  `31908557122` passed all 133 steps, including the canonical clean install and
  production build.
- Production remains unchanged at policyless Phase A. The release and wiring
  are unmerged; no workflow was dispatched and no application/provider state
  changed. Retain
  `docs/checkout-stock-reservation-force-production-wiring.md`.

## CheckoutStockReservation FORCE pooled-runtime postflight preparation (2026-08-15)

- Prepared a distinct production-inert operator for the final actual-runtime
  proof after a separately successful FORCE migration. It is not an activation
  operator and cannot change RLS, grants, rows, migrations or provider state.
- The operator requires the clean exact release commit, successful exact-main
  CI and migration run identifiers, the actual pooled
  `grainline_app_runtime` connection, and a fresh exact evidence filename. It
  rejects owner/direct and aliased PostgreSQL URLs plus nondeterministic TLS or
  session options.
- PostgreSQL must attest repeatable-read/read-only transaction state and the
  exact policyless ENABLE/FORCE table, owner, zero-authority and 25-function
  catalog. Direct table read and private-helper execution must return `42501`,
  fixed export must succeed, and a fixed write must reach SQLSTATE `25006`.
- Evidence is exclusive, sanitized and mode `0600`; it retains only role and
  target identity metadata, a URL digest, bound run IDs and aggregate proof
  facts. Production remains unchanged at Phase A and the operator has not run.
- Validation passed 55 focused activation/FORCE/workflow/PostgreSQL tests and
  the complete repository suite with 3,111 passed, seven intentional skips and
  zero failures. TypeScript, lint, syntax and diff checks passed; lint emitted
  only the repository's existing jsx-ast-utils diagnostic.
- Postflight draft PR #223 implementation checkpoint
  `d0ee090c091476d078e41304d9e86876484dfef4` passed exact-head CI run
  `31909599657`, all 133 steps including clean install, disposable PostgreSQL
  authority/rollback proofs, the full test suite, dependency audit and
  production build. The PR was restored to its intended #222 stacked base after
  the canonical CI run.
- Final Extra-High stack review found no SQL, authority, restart, rollback or
  postflight defect. It did surface and record the complete dependency order:
  Phase-A production-record PR #220, FORCE release #221, guarded wiring #222,
  then pooled-runtime postflight #223. None is merged by this checkpoint.

## CheckoutStockReservation FORCE production completion (2026-08-15)

- PRs #220 through #223 merged in their reviewed dependency order. Final exact
  main `7c033eac8b18f2c7b6837dc8caafa5d3eda47f76` passed CI
  `31911640477`.
- Guarded Production Migrations run `31912265711` applied only
  `20260815060001_force_checkout_stock_reservation_rls`. The protected workflow
  verified the exact source and migration tree, recursively sealed all
  predecessors, accepted only the exact restart state, converged reviewed
  grants, and passed migration status, the global grant/RLS audit and exact
  FORCE after-scope.
- Production now has policyless ENABLE plus FORCE on
  `public."CheckoutStockReservation"`, zero policies, zero direct
  ordinary-runtime/PUBLIC table or column authority, and the exact
  16-runtime/9-private fixed-function partition. No row, function, schema,
  application deployment or provider state changed in the FORCE release.
- The distinct actual pooled-runtime postflight ran from the clean exact main
  commit inside an engine-attested repeatable-read/read-only transaction. It
  proved the `grainline_app_runtime` identity, exact 25-function catalog,
  direct-table denial, fixed export success, private-helper denial and
  SQLSTATE `25006` at the fixed-write fence.
- Sanitized mode-`0600` evidence is retained outside the application repository
  with SHA-256
  `4534d58c6a7872d7fae6169e12db56aa62414a16a5e71cad3f4e163c83752d51`.
  It records `productionChangedByPostflight=false`; no database URL, secret or
  row data is retained.
- CheckoutStockReservation is complete through FORCE. The next
  Order/payment/shipping boundary must start with the standard pre-RLS domain
  audit rather than inheriting reservation assumptions. No deploy or provider
  change accompanied this completion.

## SellerPayoutEvent compatible authority and app preparation (2026-08-15)

- The domain-first audit selected `SellerPayoutEvent` as the next independent
  Order/payment/shipping table and found the direct mutable upsert lacked
  provider event ordering and no-row-yet race serialization.
- PR #225 merged the exact additive authority migration and proof harness at
  main `e78c1ef28f88778f86947a8cb501af8dfb916b26`; exact-main CI
  `31915878411` passed. Migration bytes are SHA-256
  `9aca2449c229d0c393e41e3b63c938b6ac80c3a3bbfcda5fc68198fbc94ec146`.
- Compatible preparation is accepted in production from exact main
  `6bc89c58d7d83509f73206a2f9b4854e3bed476b`: CI `31923317475`, read-only
  inspection `31923608819`, and guarded migration run `31923767337` passed.
  Only `20260815210000_prepare_seller_payout_event_authority` was applied. RLS
  remains off and predecessor table CRUD remains available; no deploy or
  provider change accompanied preparation.
- PR #226 merged the app conversion at exact main
  `99591a8f93c45f9324fb834fcbc1ea525867ace8`; exact-main CI `31925636570`
  passed. Production still serves the predecessor application. The candidate
  converts the signed write, seller banner
  and account export to the fixed writer/latest/export functions. It passes
  the database-issued lease generation and provider event time, retries the
  source-bound notification after `already_applied`, skips stale/unknown
  results, and leaves no direct `prisma.sellerPayoutEvent` access under `src/`.
- Review found that the shared best-effort notification helper would swallow a
  payout notification failure after the payout row committed, allowing the
  webhook lease to finish. The payout path now uses a strict helper which
  reports and rethrows; an exact retry reaches `already_applied` and retries
  the source-deduped notification. Existing best-effort callers are unchanged.
- Exact-source deployment, the separately reviewed linked-seller production
  proof, drain, policyless ENABLE and FORCE remain separate gates. The linked
  proof design reuses the canonical test-mode endpoint and an existing eligible
  test seller, removes only its exact payout/notification canary rows and
  leaves the processed webhook lease under normal retention; it does not create
  another provider topology. See
  `docs/seller-payout-event-linked-production-proof.md`.

## SellerPayoutEvent compatible application production deployment (2026-08-16)

- Exact reviewed source `e9239463a71860451191344b26dd20b45298f239`
  passed exact-main CI `31927548800` and was manually deployed to Vercel
  Production as `dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h`.
- Vercel reported `READY` and all four canonical aliases. The canonical root
  returned HTTP 200 with the exact deployment marker, `/api/health` returned
  HTTP 200 with `{"ok":true}`, and `www.thegrainline.com` returned the expected
  308 redirect. Immediate predecessor
  `dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw` remained `READY`.
- An owner catalog proof and separate actual pooled-runtime proof ran only in
  engine-attested repeatable-read/read-only transactions. They accepted the
  exact 198-migration prepared catalog, all three fixed functions, RLS/FORCE
  both off, all four predecessor runtime CRUD privileges, and pooled role
  `grainline_app_runtime` on the reviewed production endpoint. Both reported
  `productionChangedByProof=false`.
- No migration, linked-seller proof, database fixture, RLS/grant change,
  cleanup, Stripe mutation or provider-configuration change accompanied the
  deployment. The next independent gate is the already-reviewed linked-seller
  signed test-mode production proof; predecessor drain and ENABLE/FORCE remain
  later separate releases.

## SellerPayoutEvent linked proof verifier correction (2026-08-21)

- Exact-main proof release `bbc4abdb97498823f255e013bf90b5a859c42fc0`
  passed CI `31957863843` and remained bound to deployed source
  `e9239463a71860451191344b26dd20b45298f239` and deployment
  `dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h`.
- The first authorized operator attempt stopped at the deployment-identity
  preflight before opening a database connection, selecting a seller or making
  any Stripe call. No recovery or evidence file was created, and no Stripe,
  database, Vercel or provider state changed.
- Root cause was an output-contract drift in pinned Vercel CLI `inspect --json`:
  it returned plural `aliases` and omitted `meta.gitCommitSha`. Weakening the
  source check was rejected. The verifier now reads the same deployment through
  Vercel's authenticated read-only `/v13/deployments/{id}` API and still
  requires the exact deployment ID, production target, READY state, deployed
  Git commit and every canonical alias.
- Unit coverage accepts both API alias field spellings only when exact commit
  metadata is present and rejects missing/wrong commit metadata, a missing
  canonical alias, a non-READY deployment and a non-production target. The
  linked proof requires a new exact-main commit and successful CI binding before
  it can be re-authorized and retried.

## Prisma configuration dependency advisory (2026-08-21)

- A newly published high-severity advisory, `GHSA-ggr8-5vv4-36mx`, affects
  Prisma CLI configuration's transitive `deepmerge-ts@7.1.5` through stack
  exhaustion on recursive object graphs. The repository's full dependency
  audit correctly failed closed even though the path is build/config tooling.
- Prisma `7.9.1` still pins the affected release, and `npm audit fix --force`
  proposed an unsafe Prisma 6 downgrade. The narrow resolution keeps the
  aligned Prisma `7.9.0` packages unchanged and overrides only
  `deepmerge-ts` to patched `8.0.2`.
- Dependency guardrails pin the override and resolved lockfile version. The
  acceptance gate requires zero audit findings, a clean install, successful
  Prisma config/schema load and client generation, full tests, TypeScript,
  lint and a production build before merge.

## SellerPayoutEvent disposable linked-seller correction (2026-08-21)

- The Vercel deployment-reader correction merged at exact main
  `c221b1871ee73bbce8f092daf49536c4381cf9de`; exact-main CI
  `32537455244` passed. The authorized linked-seller proof rerun accepted the
  exact source/deployment/provider preflight and then stopped before mutation
  because no linked test seller met the complete failure-bank requirement. It
  created no charge, payout, database fixture, notification, state file or
  evidence file and changed no Stripe, database, Vercel or RLS state.
- A separate aggregate-only diagnosis used an engine-enforced read-only
  production database transaction plus Stripe GET operations. It found two
  linked, retrievable Stripe test-mode sellers; both were Stripe-controlled
  Express accounts with charges and payouts enabled, and neither had the
  documented failure bank ending `1116`. No raw account, seller or user IDs
  were retained. Changing a real seller's bank was rejected because a failed
  payout disables the external account and would make the proof alter a real
  seller's payout configuration.
- The replacement design has no existing-seller selection path. It prepares
  one release-bound disposable test-mode Express account through Stripe-hosted
  onboarding, then creates one deterministic vacation-mode User/SellerProfile
  pair immediately before delivery. The proof deletes the exact notification,
  payout projection, temporary seller and temporary user transactionally, but
  first catalog-scans every foreign key under parent-row locks and requires
  zero remaining dependents so cascades cannot broaden cleanup. It then deletes
  only the marker-bound Stripe account. The processed
  `StripeWebhookEvent` lease remains as the sole production residue.
- Provider preparation, proof and abort have separate confirmations. A
  mode-0600 canary handoff is written before account creation; onboarding-link
  generations and every provider mutation use restart-safe release-bound
  identity. A separate mode-0600 database recovery record is written before
  inserting the temporary rows. Abort is blocked after that database record
  exists.
- Focused tests include fail-closed configuration/state/provider cases and a
  real disposable PostgreSQL proof of idempotent fixture creation, exact
  relationship cleanup, retained webhook evidence, collision rejection and
  rollback on an unexpected cascading dependent. The final source review also
  caught that Prisma-managed `User.updatedAt` and `SellerProfile.updatedAt`
  have no database default; both raw fixture inserts now set them explicitly,
  and the disposable schema deliberately omits a default so the proof guards
  that production shape.
  Review/merge remains non-mutating; account preparation and the temporary
  production database fixture require a new explicit execution boundary.

## SellerPayoutEvent linked-seller production proof accepted (2026-08-22)

- Exact main `854233e3b8729da60c0da46ff8af492e53e48438`, CI `32552336641`,
  deployed source `e9239463a71860451191344b26dd20b45298f239` and deployment
  `dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h` passed the restart-safe test-mode proof.
- One release-bound disposable Express account completed Stripe-hosted test
  onboarding. The proof created one hidden vacation-mode User/SellerProfile,
  one five-dollar test funding charge and one deliberately failed one-dollar
  payout, then observed exactly one linked payout projection and one
  source-bound `PAYOUT_FAILED` notification through the deployed signed route.
- Exact retry left the webhook lease generation and time, payout identity and
  update time, notification identity and dedup key unchanged.
- Catalog-fenced cleanup removed the exact notification, payout projection,
  temporary seller and temporary user; the marker-bound disposable account was
  deleted afterward. The processed test-mode `StripeWebhookEvent` lease is the
  sole production residue under normal retention. No existing seller,
  deployment, provider configuration, migration, grant or RLS state changed,
  and no live money moved.
- Sanitized mode-0600 evidence SHA-256 is
  `8ff3c342bdc47ea5b8ebe9576c7a4de1253afa36e1a0a40798c0516cc55c3907`.
  The raw canary and database recovery files were removed after acceptance.
  The next separate boundary is predecessor drain and zero-direct-access
  proof, followed by separate policyless ENABLE and FORCE releases.

## SellerPayoutEvent predecessor boundary prepared (2026-08-22)

- A read-only Vercel inventory covering READY, BUILDING, QUEUED and
  INITIALIZING Production states found the compatible deployment
  `dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h` first and exactly one READY deployment
  between it and the accepted credential-recovery boundary:
  `dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw`, source
  `84a58f0fc818b502564ef6bcd974ff4af3cc4395`. Both exact inspections report
  READY Production state and a 300-second maximum function timeout.
- Older READY deployments predate the byte-verified credential recovery, whose
  evidence proves superseded runtime and owner passwords reject. The one
  post-recovery predecessor is conservatively classified as current-credential
  even though no credential value is inspected or retained.
- The new tracked-source verifier scans every JavaScript/TypeScript file under
  `src/`, requires the exact webhook/dashboard/export authority consumers and
  rejects direct Prisma delegate, computed delegate and raw quoted-table access.
  It independently scanned the exact deployed source and later operator tree;
  each has 723 files, the exact six source-reference files and zero direct
  access matches. CI enforces the current tree and the drain pins the deployed
  Git tree by exact source commit.
- The restart-safe operator is exact-main/CI/evidence/inventory/alias/health/
  timeout bound, writes mode-0600 state before mutation and can remove only
  exact deployment `dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw`. It contains no database,
  deployment creation, provider-configuration, credential, Stripe, migration,
  RLS or grant mutation. Removal has not run and production is unchanged.
- The operator refreshes the active-or-pending inventory immediately before
  removal and fails if any newer production build appears, closing the
  preflight-to-removal deployment race.
- Exact removal remains a separate destructive execution boundary. Only
  accepted drain evidence may unblock preparation of the policyless ENABLE and
  direct-grant-revocation release; FORCE remains separate after that.

## SellerPayoutEvent predecessor drain completed (2026-08-22)

- Exact main `9947a9e485a686dc801befcdea285cddc5b3aff7` and CI `32583228592`
  passed the fresh read-only preflight with zero direct SellerPayoutEvent access
  in both the deployed and operator trees and exactly one current-credential
  predecessor.
- The restart-safe operator permanently removed only deployment
  `dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw`. Its first invocation stopped after the
  removal and before evidence finalization, leaving the expected mode-`0600`
  `removal-authorized` state. Exact inspection proved the target absent; the
  same exact invocation resumed without another removal and completed the
  post-removal proof.
- Current deployment `dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h` remained READY on all
  four canonical aliases and `https://thegrainline.com/api/health` remained
  exactly `{ "ok": true }`. Shared-current-credential predecessors converged
  from one to zero.
- Sanitized mode-`0600` evidence SHA-256 is
  `3bb83df87df2cf2571df53ef0021e73886eca5d57140e0e8bc929eac4e2b61b1`; the
  restart state is absent. No deployment was created, and no database,
  credential, Stripe, migration, RLS, grant or provider-configuration state
  changed.
- This evidence unblocks preparation only of the separate policyless ENABLE
  plus direct-grant-revocation release. It does not authorize that migration or
  the later posture-only FORCE release.

## SellerPayoutEvent policyless activation candidate (2026-08-22)

- The isolated candidate promotes only
  `20260822180000_enable_seller_payout_event_rls`. Its migration SHA-256 is
  `0347a8d930631b4fbed793eec4d119d1c56adcaa2802a89c61940ef6b62fb4bc`;
  its database-first rollback SHA-256 is
  `b311f9ae78a8d093d2b200f68acf17d1b4d6b2dd4d1eda342f701b0b4553a94a`.
- The migration validates the owner/runtime roles and recursive membership
  graph, compatible grants, zero policies, five constraints, six indexes,
  retained row invariants and the exact source/owner/mode/ACL of all three
  fixed functions before taking any posture action.
- It then makes provider event time required, enables RLS with zero policies,
  explicitly leaves FORCE off and revokes all direct runtime/PUBLIC table
  authority. It creates no function or policy and performs no row DML.
- CI isolates the successor while replaying every sealed predecessor, then
  applies it to PostgreSQL 16, converges grants, runs the global audit and uses
  separate owner/runtime logins for direct-denial, fixed-operation and rollback
  proofs. The production ledger scope accepts only exact prepared/activated
  restart states and preserves the three reviewed historical exceptions.
- Focused static and contract suites pass locally. The exact-head real
  PostgreSQL and full repository gates remain required. Production workflow
  wiring, merge, migration execution, pooled-runtime production postflight and
  FORCE are not authorized by this candidate and remain separate boundaries.

## SellerPayoutEvent activation proof and postflight hardening (2026-08-22)

- Exact isolated checkpoint
  `38d9acb1cf07cd772cc1fa23cc29024ff9f9dc95` passed exact-head CI
  `32590297568`, including real PostgreSQL 16 activation, separate restricted
  runtime-login proof, database-first rollback/restoration, global grant/RLS
  audit, full tests, TypeScript, lint, dependency audit and production build.
- The reusable activated-catalog proof now requires the exact table and
  function owner in addition to source, mode, pinned search path and ACL. This
  closes acceptance of an otherwise matching function owned by an unreviewed
  role.
- A separate actual pooled-runtime production postflight is scaffolded. It is
  exact-release/CI/migration bound, rejects privileged or aliased database
  variables, uses no owner or `SET ROLE`, runs in an engine-attested
  repeatable-read read-only transaction, proves catalog posture and direct
  denial, exercises both fixed reads, and requires SQLSTATE `25006` from the
  fixed writer's read-only fence. Evidence is fresh, sanitized and mode-`0600`.
- CI exercises the same catalog, identity, denial, projection and read-only
  fence path through a separate direct restricted-runtime login against
  disposable PostgreSQL before rollback/restoration.
- After this hardening, the focused release/postflight/cross-audit suite passed
  19/19; TypeScript and lint passed; and the full local repository suite passed
  3,213 tests with seven documented skips and zero failures. Exact hardening
  head `d5fa351247fcf28c736a760974f50f1718427281` then passed CI
  `32591448929` in 6m44s, including the new direct-runtime PostgreSQL postflight
  and production build.
- The postflight has not run. The activation release later merged, while
  guarded production migration wiring remained on a separate stacked branch.
  Migration execution and FORCE remained separate unauthorized boundaries;
  production state was unchanged by this checkpoint.

## SellerPayoutEvent activation guarded-wiring preparation (2026-08-22)

- Exact activation head `be061901523fb81edf88f59c0c8c86aa06457554`
  passed exact-head CI `32591832748`, including the disposable PostgreSQL
  separate-runtime postflight, all repository tests, dependency audit and
  production build. The expected Vercel Preview runtime-database guard failed
  closed; it is not a production deployment or application-test failure.
- The guarded Production Migrations workflow now verifies and isolates only
  `20260822180000_enable_seller_payout_event_rls`, verifies its sealed
  compatible-authority predecessor and the full older release chain, then
  restores every successor in dependency order with this activation last.
- Before Prisma may write, the workflow uses the engine-read-only activation
  scope in `restart` mode. It accepts only the exact fully prepared ledger or
  the exact fully activated ledger. Unknown, duplicate, unfinished,
  rolled-back, zero-step and checksum-drifting rows fail closed.
- After migration deployment, the workflow converges the reviewed global
  runtime grants, checks migration status, runs the global grant/RLS audit and
  requires the exact activation `after` scope. No workflow input can select a
  different migration.
- Cross-release contracts retain every byte-sealed historical verifier while
  recognizing SellerPayoutEvent activation as the new latest successor.
  Detailed operator and restart semantics live in
  `docs/seller-payout-event-activation-production-wiring.md`.
- Local validation passed 45 focused release/workflow tests plus six
  disposable-PostgreSQL activation-scope assertions; TypeScript and lint
  passed, and the full repository suite passed 3,220 tests with seven
  documented skips and zero failures. Lint emitted only the repository's
  existing jsx-ast-utils TypeScript-expression diagnostic.
- This is an isolated, production-inert source change. No workflow was
  dispatched; no merge, migration, deployment, RLS/grant, credential, Stripe
  or provider mutation occurred. Policyless activation, its actual pooled
  runtime postflight and later FORCE remain separate boundaries.

## SellerPayoutEvent activation merge and Notification fixture correction (2026-08-22)

- The predecessor-drain record merged at main
  `9198e5b236b4599ecf01a3a32c1244561f64e9f9`; exact-main CI `32606760572`
  passed. The policyless activation release then merged from exact head
  `be061901523fb81edf88f59c0c8c86aa06457554` at main
  `570aa8aa2690bcbd341ce08a9cabdcaaa8bcab3d`; exact-main CI `32608753825`
  passed the complete PostgreSQL, runtime-authority, rollback/restoration and
  application gates. Conversation/Message FORCE proof `32608753833` passed.
- Notification FORCE proof `32608753821` stopped while creating its disposable
  payout source because that historical fixture omitted the provider event
  time made NOT NULL by the merged activation migration. PostgreSQL returned
  `23502` before Notification authority assertions ran. The isolated correction
  adds deterministic valid `stripeEventCreatedSeconds` to that source and a
  focused regression assertion; it does not weaken the promoted invariant.
- This is a cross-release CI-fixture compatibility correction. The activation
  migration has not run, SellerPayoutEvent production RLS/FORCE and grants are
  unchanged, the pooled-runtime postflight has not run, and draft production
  wiring remains a later merge boundary.
- The correction's first full PR CI run `32609335900` passed the PostgreSQL,
  TypeScript and lint gates, then stopped on the coverage-matrix status
  allowlist after the record advanced from compatible-live to
  merged-unapplied. The narrow follow-up registers that evidenced status while
  retaining the separate assertion that only production-RLS rows count as
  live; it does not change a release or security disposition.
- The corrected package merged at exact main
  `d9518f5545fac722f208d12fcdc48be41ec89d97`; exact-main CI `32610218785`
  passed and exact-main Notification FORCE proof `32610218792` passed. This
  closes the cross-release fixture regression. SellerPayoutEvent production
  RLS/FORCE and grants remain unchanged because no migration was dispatched.

## SellerPayoutEvent activation production isolation correction (2026-08-23)

- Production-wiring PR #242 merged exact head
  `962631d6c5379cd7c5c1ca8e39c628d041c7f5cb` as main
  `af56bf99c4eac4366b6bcecbabaabd84992f0e62`; exact-main CI
  `32611954204` passed.
- Authorized guarded migration run `32659750056` passed the exact-source and
  protected owner-role guard, verified the SellerPayoutEvent activation bytes,
  isolated activation and verified the compatible authority release. It then
  failed closed at the strict CheckoutStockReservation FORCE migration-tree
  guard because the later
  `20260815210000_prepare_seller_payout_event_authority` migration remained in
  Prisma discovery.
- The restart-scope reader, Prisma generation, `prisma migrate deploy`, grant
  convergence, migration status, global grant/RLS audit and applied-scope proof
  were all skipped. Production rows, schema, grants and RLS remained unchanged;
  SellerPayoutEvent remains in its compatible RLS-off posture.
- The isolated correction mirrors the already-proven CI release order: after
  verifying the SellerPayoutEvent authority bytes it moves that migration out
  before the older reservation seals, then restores reservation successors,
  SellerPayoutEvent authority and finally SellerPayoutEvent activation in
  dependency order. Exact-path and exact-order tests prevent a verification-only
  step from being mistaken for filesystem isolation again.
- Merge, exact-main CI and any production rerun remain separate gates. The
  actual pooled-runtime postflight and later FORCE release remain later still.
- Draft correction PR #244 exact-head CI `32660232917` passed the complete
  disposable PostgreSQL release chain, TypeScript and lint, then reported one
  stale release-document regex in the full suite: it still required wording
  that production wiring was only prepared. The other 3,225 tests passed. The
  follow-up changes only that assertion to require the now-true merged-wiring
  and failed-dispatch record; it does not change workflow or production logic.

## SellerPayoutEvent policyless Phase A accepted in production (2026-08-23)

- The predecessor-isolation correction merged at exact main
  `bf9f353ed1d94f4d32933b5d6417a75f4c0f625e`; exact-main CI
  `32663849012` passed the disposable PostgreSQL release chain, separate
  restricted-runtime proof, database-first rollback/restoration, full tests,
  TypeScript, lint, dependency audit, and production build.
- Guarded Production Migrations run `32667518275` accepted the exact prepared
  restart state, applied only
  `20260822180000_enable_seller_payout_event_rls`, converged the reviewed
  runtime grants, and passed migration status, the global grant/RLS audit, and
  exact activated scope. The resulting production catalog is RLS enabled,
  explicitly not forced, zero policies, zero direct runtime/PUBLIC table or
  column authority, and exactly three reviewed fixed operations.
- The separate actual pooled `grainline_app_runtime` postflight was bound to
  the same exact main, CI, and migration run. PostgreSQL attested a
  repeatable-read/read-only transaction; the proof confirmed the restricted
  role identity and exact function catalog, denied direct table reads, allowed
  both absent-actor fixed projections, and rejected the fixed writer at the
  SQL read-only fence with `25006`. It reported
  `productionChangedByPostflight=false`.
- Sanitized mode-`0600` evidence SHA-256 is
  `01235ef9a0922d1d1b8feb17e53bf9bbf47589ef23c927a9e5e65312cebb27de`.
  No deployment, FORCE change, provider configuration, credential change, or
  other migration accompanied this acceptance.
- SellerPayoutEvent is complete through policyless Phase A. Its posture-only
  FORCE successor remains a separate release with fresh proof. The remaining
  `OrderPaymentEvent`, `OrderShippingRateQuote`, `Order`, and `OrderItem`
  domains remain separate audits and releases.

## SellerPayoutEvent FORCE isolated candidate (2026-08-23)

- Prepared one posture-only migration,
  `20260823220000_force_seller_payout_event_rls`, from a byte-pinned draft.
  It changes only `relforcerowsecurity`; no row, policy, grant, function,
  application, deployment, credential or provider state is changed.
- The migration revalidates the accepted Phase-A table and three-function
  catalog, restricted role graph, owner identity and owner-session drain before
  setting FORCE. It retains zero policies and zero direct runtime/PUBLIC table
  or column authority.
- Static release, historical sealed-prefix, restart-scope, direct-runtime and
  database-first rollback/restoration proofs are wired on an isolated branch.
  Exact hashes and the production sequence are retained in
  `docs/seller-payout-event-force-release.md`.
- Production remains at SellerPayoutEvent Phase A. Merge, exact-main CI and a
  guarded production migration remain separate boundaries.

## SellerPayoutEvent FORCE applied; runtime acceptance pending (2026-08-23)

- Phase-A production record PR #245 merged at
  `f579693a0303cca955fa25307605585ed7bb8d22`; exact-main CI `32671503232`
  passed. FORCE release PR #246 then merged at exact main
  `0eb360b9878698f45288ac3c1649871de9a8a33c`; exact-main CI `32672008187`
  passed the byte seals, disposable PostgreSQL owner/runtime FORCE proof,
  rollback/restoration, full tests, TypeScript, lint, dependency audit and
  production build.
- Guarded Production Migrations run `32672434812` applied only
  `20260823220000_force_seller_payout_event_rls`, converged the reviewed
  grants, and passed migration status, the global grant/RLS audit and exact
  FORCE scope. No deployment or provider state changed.
- Immediate release-closure review found a real packaging gap: the runbook
  required a separate actual pooled-runtime FORCE postflight, but the merged
  package exposed only the Phase-A postflight, which correctly expects
  `NO FORCE`. The production FORCE posture and owner-side proof remain sound;
  final FORCE acceptance is withheld until a distinct runtime proof passes.
- Isolated branch `agent/seller-payout-force-postflight-20260823` adds a
  fail-closed `--post-force` mode, FORCE-only confirmation and environment
  namespace, distinct fresh evidence filename, exact migration-run binding,
  package command and regression coverage. It reuses the already-proven
  read-only runtime path while requiring the catalog's FORCE bit. The accepted
  Phase-A evidence cannot satisfy this contract. CI also invokes that exact
  FORCE branch through a separate direct restricted-runtime login after FORCE
  is applied in disposable PostgreSQL. Focused tests passed 7/7 before the
  documentation pass. PR CI `32673349223` then passed every migration and
  PostgreSQL proof—including the new direct-runtime FORCE postflight—plus
  TypeScript and lint, before the full suite found two stale source/document
  assertions: one required the old two-argument catalog call and one required
  the FORCE release to remain candidate-only. No behavior or database proof
  failed. Both contracts now assert the mode-aware call and exact applied-but-
  pending-runtime-acceptance state; the expanded focused set passes 41/41.
  Merge, replacement exact-head CI, live read-only proof and final evidence
  retention remain separate gates.

## SellerPayoutEvent FORCE accepted in production (2026-08-23)

- Postflight package PR #247 merged at exact main
  `fb350c31772938ef52ef796c61bf670d9cf0750e`. Exact-main CI `32675227286`
  passed the complete database release chain, direct-runtime FORCE proof,
  3,253 tests, TypeScript, lint, dependency audit and production build.
- The distinct production FORCE postflight was bound to exact main
  `fb350c31772938ef52ef796c61bf670d9cf0750e`, CI `32675227286`, and guarded
  migration run `32672434812`. It used only the pooled
  `grainline_app_runtime` credential inside an engine-attested
  repeatable-read/read-only transaction.
- All nine checks passed: restricted runtime identity, policyless ENABLE plus
  FORCE, zero direct runtime/PUBLIC authority, exact three-function catalog,
  direct table denial, both fixed projections, and the fixed writer's SQLSTATE
  `25006` read-only fence. The proof reported
  `productionChangedByPostflight=false`.
- Retain sanitized mode-`0600` evidence SHA-256
  `f2be83824cf4f8a9354ae72a5d9a12498ba1b7c24bf10f9b1c92636a3490228e`.
  No migration, deployment, grant, credential or provider change accompanied
  the postflight. SellerPayoutEvent is accepted `RLS_LIVE_FORCE`.
- The next remaining table starts only after its own fresh domain audit. Do
  not bundle `OrderPaymentEvent`, `OrderShippingRateQuote`, `Order`, or
  `OrderItem`.

## Order refund reconciliation failed-lease recovery correction (2026-08-24)

- Extra-High end-to-end review found a functional recovery defect before merge
  or production use. Failed Stripe webhook handling intentionally clears
  `StripeWebhookEvent.processingStartedAt`, but the blocked-checkout refund
  record function required that lease to remain active. An administrator could
  therefore classify an ambiguous provider effect or authorize an exact-scope
  retry, yet the subsequent local finalization would always fail unless it
  raced a later active webhook lease.
- The compatible record migration now keeps the shared blocked-checkout
  mutation body in an owner-private `SECURITY DEFINER` core with explicit
  runtime and PUBLIC revocation. The original runtime entrypoint remains the
  signed-delivery wrapper and still requires the exact active event generation;
  it retains only exact committed replay after the event is processed.
- The compatible reconciliation migration adds a separate runtime wrapper.
  It accepts an exact immutable reconciliation ID plus the claim tuple, derives
  the event/generation from that row, rechecks the current ADMIN and failed
  inactive event state, invokes the private core, and marks the source event
  processed while clearing its error in the same transaction. A forged row,
  active/raced event, wrong generation, wrong claim family, released claim, or
  direct runtime call to the core fails closed.
- The sealed PGlite proofs retain their historical migration boundaries: the
  record proof reads only claim plus record, while reconciliation behavior is
  tested at its own stage. The loopback-only PostgreSQL 16 rollback proof
  executes the complete prefix and proves the failed-lease path end to end:
  ordinary finalization denied, forged reconciliation denied, exact recovery
  accepted once, event completion and error clearing co-committed, and all
  runtime/private ACLs exact.
- Exact-head CI run `32707048056` exposed and failed closed on a packaging
  regression before PostgreSQL execution: the isolated record proof tried to
  read the intentionally hidden later reconciliation migration. The record
  proof was restored to a self-contained sealed prefix and its release test now
  rejects later migration references. This did not expose a SQL-engine defect
  or change migration bytes. Fresh exact-head CI remains required before the
  draft PR can leave review. No migration, deployment, grant, credential, or
  provider state changed while correcting this finding.

## Order refund inactive-seller first-record recovery (2026-08-24)

- Extra-High end-to-end review found a second pre-activation recovery gap. A
  seller may acquire a generation-fenced refund claim and Stripe may accept the
  refund, but the seller can become banned or soft-deleted before the atomic
  local record/finalizer runs. The reconciliation action could correctly
  classify the provider effect while `grainline_seller_refund_record` and its
  Case side effect still rejected the historical seller posture. The provider
  effect stayed fenced from duplication, but Order, payment, stock, Case and
  participant-delivery records could remain incomplete.
- The isolated successor
  `20260824050000_prepare_order_refund_inactive_seller_recovery`, SHA-256
  `e37d5ea925af5f4b82f90b1f1bcdeb9b14f5a4b34da7c228bdc94f8bfbbb9598`,
  replaces only `grainline_seller_refund_record(text,text,bigint,text,text,text,integer)`
  and `grainline_case_seller_refund_apply(text,text)`. It creates no function,
  table, policy or grant family and changes no RLS posture. Existing signatures
  and runtime-only execute remain exact.
- The ordinary active-seller path is unchanged. An inactive first write passes
  only when PostgreSQL derives an immutable reconciliation with the exact
  Order, claim ID, generation, seller source, null source generation,
  idempotency scope, an effect-preserving action and a still-current ADMIN
  author. PostgreSQL holds shared locks on the immutable reconciliation and
  ADMIN rows through finalization, preventing an administrator demotion, ban
  or deletion from racing that decision. The Case function derives the same
  tuple from the already-inserted local payment event. No reconciliation ID,
  Order, seller, Case, buyer or source target is added to caller input.
- Normal account deletion retains the User and SellerProfile identities while
  setting banned/deleted state, so the historical seller relationship remains
  provable. Missing source rows, unrelated reconciliation, no-effect release,
  wrong claim/generation/scope, inactive administrator or forged payment-event
  metadata fail closed. Exact committed refund replay remains available after
  later account-state changes.
- The deterministic builder pins the two sealed predecessor function sources
  and emits fixed, non-dynamic SQL. Static release tests, byte verification and
  proof-configuration tests pass locally. CI is staged to isolate the successor
  until its four sealed predecessors pass, apply it to loopback PostgreSQL 16,
  re-audit grants/RLS and run a runtime-role rollback proof covering denial,
  exact recovery, Case boundary, stock restoration, replay and zero residue.
  Exact-head CI has not yet run for this stacked branch. No production,
  provider, credential, deployment, migration or RLS state changed.
- Final local validation for the stacked successor passed 3,348 tests with
  seven intentional environment-dependent skips, TypeScript, lint, Prisma
  schema validation, deterministic migration regeneration and
  `git diff --check`. The real PostgreSQL runtime-role proof remains CI-only
  because this workstation has no local PostgreSQL or Docker service.
- Draft PR #258 tracks the pushed stacked recovery branch. It remains draft;
  exact-head CI and the loopback PostgreSQL proof are required before any
  merge decision. No production action is authorized by that checkpoint.
- Exact-head CI run `32712132534` applied the complete sealed migration chain
  and reached the new runtime-role recovery proof. The recovery, stock restore
  and durable event metadata all completed, but the proof expected camelCase
  JavaScript keys from three unquoted PostgreSQL aliases; node-postgres
  correctly returned the lowercase/snake-case identifiers. The proof now
  double-quotes those evidence aliases and its static contract pins the exact
  driver shape. Migration and application bytes did not change. Replacement
  exact-head CI remains required.
- Replacement exact-head CI run `32712649978` on code-bearing commit
  `8d8f9ab26cd65f141d4f61216f61719d89dd4838` passed all 203 workflow steps.
  It applied the complete prefix only to disposable PostgreSQL 16, re-audited
  grants/RLS, and proved inactive denial, exact ADMIN-authorized recovery,
  Case-boundary reachability, stock restoration, replay and zero residue
  through `grainline_app_runtime`. Historical database proofs, 3,355 tests,
  TypeScript, lint, dependency audit and the production build also passed.
  Production remained unchanged.

## OrderPaymentEvent compatible stack merged; successor inspection failed closed (2026-08-24)

- PRs #257 through #260 merged in dependency order through exact main
  `d17b0384f2b90b128ba23852a0dedb004ce52739`: refund reconciliation,
  inactive-seller recovery, durable staff Case participant delivery, then the
  additive 66-count `OrderPaymentEvent` inspection. Exact final-main CI
  `32772585632` passed all migration/grant/RLS/rollback/runtime proofs,
  TypeScript, lint, tests, security audit and production build. Main automatic
  Vercel deployment is disabled; no migration, deploy, provider or production
  mutation accompanied these merges.
- Protected production inspection run `32773408735` was released through the
  Production environment at that exact main commit. PostgreSQL rejected the
  stale posture fence with `POSTURE_MISMATCH` before `readCounts()` ran or an
  evidence file was created. The workflow had no mutation operation.
- The mismatch was expected drift in a safety assertion, not production RLS
  regression: `SellerPayoutEvent` had completed policyless FORCE RLS after the
  earlier Order/payment/shipping inspection was written, while the fence still
  required broad runtime CRUD on that table. The successor requires all three
  completed service ledgers (`CheckoutStockReservation`,
  `StripeWebhookEvent`, `SellerPayoutEvent`) to remain policyless FORCE with
  zero ordinary-runtime CRUD. Only `Order`, `OrderItem`,
  `OrderPaymentEvent` and `OrderShippingRateQuote` remain exact RLS-off
  broad-CRUD predecessors.
- The failed run is not aggregate evidence. A fresh exact-head full CI pass is
  required before another protected engine-read-only dispatch. No cleanup,
  invariant validation, migration, deployment, grant/RLS or provider change is
  authorized by this correction.

## Order/payment/shipping production classification accepted (2026-08-24)

- PR #262 exact head `6d0996a02250ea05aaaaff258532c8efcea21e3f`
  corrected the stale completed-service-ledger posture only. It merged at exact
  main `bc64516c6463118012c643806a3f398f2584092c`; full exact-main CI
  `32782625503` passed.
- Protected inspection run `32783261534` completed the exact 66-count query in
  an engine-attested `REPEATABLE READ READ ONLY` transaction. Sanitized
  artifact SHA-256
  `2a4e2819efa40acae014521aff141408cef66d468d0f4935c093415416dbbe30`
  retained no addresses, credentials, object/provider/user IDs, rows or
  snapshots. The run made no production mutation.
- The snapshot contained 2 Orders, 3 OrderItems and 13 StripeWebhookEvents,
  with maximum 2 items per Order, 1 Order per buyer and 1 Order per current
  seller. It contained zero payment events, payout events, reservations and
  quotes. Apart from those volume/maxima fields, the only nonzero count was
  `label_state_coherence_count = 1`; every payment/refund/dispute/replay,
  source, amount, currency, privacy, collision, reservation and quote defect
  count was zero. Fifty-nine of the 66 aggregate fields were zero.
- The label finding belongs to the separate Order release and is not a reason
  to stall the empty OrderPaymentEvent release. It is classification, not
  cleanup authority. The isolated successor extends the accepted 66-field
  baseline to 76 aggregate-only fields with ten overlapping label-state
  subtypes. It retains no Order/provider identity or raw state and changes no
  production data.

## Order label subtype and privacy-redaction classification (2026-08-24)

- PR #263 exact head `ca02809a793b1455f27cdbe67ba25fca45484f65`
  merged at exact main `3bd0a0f7a11074a323c0d6facdcc08d2aeadc0e1`.
  Exact-main CI `32784976638` passed the complete PostgreSQL/release chain,
  TypeScript, lint, 3,360 tests with seven intentional skips, security audit
  and production build.
- Protected inspection `32785532138` passed the exact 76-field query inside an
  engine-enforced repeatable-read read-only transaction. Sanitized artifact
  SHA-256
  `a4c7d40ac292d1fa4c8e43ad95b47630ac40be9ef7b5553f56e0523894cd0bff`
  retained no address, credential, Order/user/provider identity, raw row or
  snapshot. No production mutation occurred.
- Counts remain 2 Orders, 3 OrderItems and 13 StripeWebhookEvents, with zero
  OrderPaymentEvents, SellerPayoutEvents, CheckoutStockReservations and
  OrderShippingRateQuotes. All previously clean defect families remain zero.
  `label_state_coherence_count = 1`; the only nonzero subtypes are
  `label_purchased_missing_transaction_count = 1` and
  `label_purchased_missing_url_count = 1`.
- Static lifecycle audit corrected the initial repair interpretation:
  `anonymizeUserAccount()` intentionally clears those exact two fields for
  buyer- and seller-side account deletion while preserving PURCHASED status
  and fulfillment history. Rehydrating them could violate the privacy action.
- The isolated 78-field successor adds only aggregate privacy-redacted and
  unexplained missing-reference counts, derived from `buyerDataPurgedAt` and
  the seller user's `deletedAt`. It returns no identity and authorizes no
  cleanup. Only an unexplained count belongs in a later Order repair review.
- GitHub emitted a nonblocking runner warning that `actions/upload-artifact@v4`
  targets deprecated Node.js 20 and is being forced to Node.js 24. Track the
  action-runtime upgrade separately; it did not affect evidence acceptance.
- PR #264 exact head `6cc8625a252b79b1b794d7b86b9009a36d4f1690`
  merged at exact main `1d5bdf3ffa6b1ab41daf5a1c3e0f341253620dc4`.
  Exact-main CI `32787483409` passed the complete sealed migration/PostgreSQL
  authority chain, TypeScript, lint, tests, security audit and production
  build.
- Protected inspection `32788031745` passed the exact 78-field query in an
  engine-enforced repeatable-read read-only transaction. Sanitized artifact
  SHA-256
  `c7c70e68097174182b1aea43420ca1e5ff91c52e670b822f20bcb10db7d2649c`
  retained no addresses, credentials, identities, provider values, raw rows or
  snapshots. No production mutation occurred.
- The historical broad count and missing-transaction/missing-URL subtype counts
  remain one. The decisive new counts are
  `label_purchased_missing_reference_privacy_redacted_count = 1` and
  `label_purchased_missing_reference_unexplained_count = 0`. Close the finding
  as an intentional account-deletion privacy transform. No cleanup, row
  enumeration or provider-reference rehydration is authorized or required.

## OrderPaymentEvent compatible production runner isolated (2026-08-24)

- Added a protected, main-only workflow for the five byte-sealed compatible
  refund/payment authority migrations. It requires exact-main push CI, a fresh
  exact-main aggregate-only inspection and the exact confirmation string.
- The restart verifier accepts only a valid exact-checksum applied prefix,
  refuses failed/duplicate/gapped/unknown target state and refuses any migration
  successor after `20260824050000_prepare_order_refund_inactive_seller_recovery`.
- Its engine-enforced repeatable-read/read-only catalog proof requires
  `OrderPaymentEvent` to remain RLS-off with exact predecessor runtime CRUD,
  verifies staged columns, requires the private reconciliation table to remain
  policyless FORCE/no-CRUD, and hashes every reviewed live function body against
  the applicable migration prefix. The final replaced seller/Case functions are
  therefore checked by body, not merely by signature.
- CI runs the same catalog reader against PostgreSQL 16 after the full five-step
  compatible stack. The candidate is isolated only: no workflow dispatch,
  migration, deployment, grant, RLS, provider or production change occurred.
- PR `#266` merged as `0e3a5531c5e216dec2be77126d0cd712316247d7`;
  exact-main CI `32791106621` and fresh engine-read-only aggregate inspection
  `32791693877` passed. Sanitized mode-`0600` inspection evidence SHA-256 is
  `bee2ff246cac5c45b1131ac58f192c1b671b8d9782d1355165e5666975c74d8c`.
  Guarded production-preparation run `32791937150` then failed closed before
  migration deployment because its SellerPayoutEvent predecessor step named a
  nonexistent package script. No migration or grant change occurred. The
  correction uses the existing byte-sealed FORCE release verifier and adds an
  exact package-script existence contract.
- PR `#267` exact head `9e93bfe2562a12c280359cb18a167666b5a11474`
  merged as main `8f4cf2df34a9f700adebc910107ac2dbb878054a`.
  Exact-main CI `32792800761` passed. Fresh protected inspection
  `32793276224` retained the identical accepted aggregate posture; sanitized
  mode-`0600` evidence SHA-256 is
  `f97e90cf79be803cf462b3201e6f71e2208268d399cf4903fe1ddae759503730`.
- Corrected guarded run `32793394895` applied only the five reviewed compatible
  migrations. Production reports 205 migrations up to date; the global audit
  passed for 65 tables, 22 enums, 178 `grainline_*` functions, one extension,
  four policy tables and zero sequence references. Final engine-read-only scope
  was `prepared` with prefix length five, `OrderPaymentEvent` RLS/FORCE off and
  predecessor CRUD retained, plus private policyless-FORCE
  `OrderRefundReconciliation`. No application deployment or RLS activation
  occurred. The distinct actual pooled-runtime postflight remains the next
  acceptance gate.
- The follow-up isolated release adds that distinct proof without changing the
  historical owner-side runner. CI connects through a direct login as the
  restricted runtime role after applying the exact five-migration stack;
  production accepts only the reviewed pooled `DATABASE_URL` and rejects every
  privileged or aliased PostgreSQL URL. Both paths attest repeatable-read and
  read-only mode, compare all 14 live function bodies and ACLs with the
  migration bytes, retain predecessor `OrderPaymentEvent` compatibility, and
  directly deny the private reconciliation table and refund-record core. The
  production proof remains unexecuted until its exact-main CI passes; no
  deployment, migration, grant, RLS, row or provider state is changed by this
  scaffolding.
- PR #268 CI run `32794527053` reached the new direct-runtime step only after
  every predecessor and compatible migration proof passed, then failed closed
  on an incorrect test expectation: PostgreSQL rejects `SELECT ... FOR UPDATE`
  immediately with read-only SQLSTATE `25006`, even when the predicate would
  find no actor row. The fixed seller-refund operation therefore proved its
  runtime EXECUTE path reached the transaction lock fence; expecting the later
  source-validation exception was impossible in an engine-read-only
  transaction. The correction requires exact `25006`, retains all catalog and
  denial checks, and records no production change.
- PR #268 exact corrected head
  `714a3cdc5ba8fccca4a3c92f1a09f95f05c341df` merged as exact main
  `5d3b402317084d9d2af6b8bdf52300a800eda0d8`. PR CI `32794890489` and
  exact-main CI `32795444295` passed the complete release chain, including the
  direct-login PostgreSQL 16 runtime proof, all repository tests, dependency
  audit and production build. The Vercel Preview compiled and typechecked, then
  failed only at page collection because Preview intentionally has no
  `DATABASE_URL`; it did not expose a source defect or deploy production.
- The actual production postflight ran from that exact clean main through only
  the reviewed pooled `grainline_app_runtime` credential. All nine checks
  passed inside an engine-attested repeatable-read/read-only transaction:
  exact role identity; `OrderPaymentEvent` RLS-off predecessor CRUD; private
  policyless-FORCE `OrderRefundReconciliation`; exact 14-function bodies and
  ACLs; predecessor read success; direct private-table/helper denial; and the
  fixed seller-refund function's read-only lock fence. It wrote only sanitized
  mode-`0600` evidence with SHA-256
  `ecb1ce1b1f4dd6fa2ad62e23882c16f6021be6ed42698b54a663ca11bd236f10`,
  retained no database URL or row data, and recorded
  `productionChangedByPostflight=false`. At that checkpoint the converted
  application remained undeployed and `OrderPaymentEvent` RLS remained off.

## OrderPaymentEvent compatible application live (2026-08-24)

- The application-side seller refund validation now derives the expected
  seller transfer through `calculateCheckoutAmounts()` instead of duplicating
  the launch fee arithmetic. A release contract prevents changing the
  application fee rate while the byte-sealed PostgreSQL finalizers still
  validate the historical 5% contract and Orders lack a durable checkout-time
  fee/transfer snapshot.
- PR #270 exact head `b7bd29a4c3957f5234a9cca7290e610dace02d63`
  merged as exact main `2820986538c0d64f035defce052ba4ad0de1b3fb`.
  Exact-main CI `32798835742` passed the complete release chain.
- A manual deployment from a clean detached worktree at that exact commit
  produced Vercel Production deployment
  `dpl_73aR913b9hfgkcdfBv2MwMyypR5a`, state `READY`. The build runtime guard
  attested the pooled `grainline_app_runtime` identity; both
  `thegrainline.com/api/health` and `grainline.vercel.app/api/health` returned
  HTTP 200 with `{ "ok": true }`.
- No migration, grant, RLS, Stripe, database-row or credential change was part
  of the deployment. `OrderPaymentEvent` remains RLS/FORCE off with predecessor
  CRUD. The previous deployment remains the coexistence predecessor until the
  real signed-provider/refund/Case/replay proof succeeds and a separate drain
  is accepted.
- Vercel CLI 58.9.0 automatically created one persistent, no-expiry automation
  bypass while probing the protected deployment URL. The token was matched by
  sanitized scope and creation timestamp, never printed, and revoked with no
  regeneration. A postflight reported zero remaining project bypasses and
  canonical public health stayed 200. Future protected URL probes must not use
  `vercel curl` without an intentionally provisioned reviewed bypass.

## OrderPaymentEvent signed provider proof prepared (2026-08-24)

- Added a restart-safe, Stripe-test-mode-only live proof for the deployed
  `charge.refunded` and `charge.dispute.created` families. It binds an exact
  clean-main operator commit, exact-main CI, the compatible deployed source,
  Vercel deployment/project/aliases/health, Stripe provider stage 4 and exact
  production owner/runtime identities before any test mutation.
- The proof uses independent refund and dispute charges, derives two private
  disposable Orders from their returned charge IDs, verifies the exact
  payment, Order, Case, Notification and audit effects, and sends an exact
  post-success replay for each family. The dispute receives one earlier exact
  resend after fixture insertion because Stripe's special dispute payment may
  emit before its Order exists.
- Cleanup verifies exact relationships and every live foreign-key dependent
  before deleting two Users, one SellerProfile, two Listings, two Orders, two
  OrderItems, two payment rows, one Case/application, one Notification and
  three audit rows. It intentionally retains only two processed test-mode
  `StripeWebhookEvent` replay leases in the database. Stripe test objects and
  ordinary Stripe/Vercel/Sentry delivery telemetry remain external records;
  evidence distinguishes those from database residue. Unexpected dependents
  fail and roll back cleanup rather than cascading.
- Adversarial restart review corrected three pre-checkpoint defects: final
  evidence no longer attempts to re-read rows already removed by a committed
  cleanup; each non-transactional Stripe resend now has a durable pending stage
  and evidence does not claim an unknowable exactly-once call count; and a
  crash-left `.next` state is promoted only as one exact adjacent transition
  with all prior fields sealed. Cleanup also re-proves every base fixture
  marker immediately before deletion.
- Pure and disposable PostgreSQL tests pass locally. The operator has not run,
  no Stripe object, database row, endpoint, deployment, grant or RLS state has
  changed, and the package is not activation evidence. Seller,
  blocked-checkout and staff Case refund live proofs remain separate gates.

## OrderPaymentEvent seller-refund proof prepared (2026-08-24)

- Draft PR #273 exact head
  `4c4f0d6f7231594bf6a125693bf3b298c7de0025` adds a separate restart-safe
  seller-refund provider proof. It is stacked on the signed-family proof and
  therefore has not yet received main-targeted GitHub CI; its Vercel Preview
  fails at the expected runtime-database isolation guard rather than compiling
  or deploying with a privileged credential.
- The operator authenticates one retained canary buyer, creates only hidden
  test fixtures and a disposable Stripe test-mode seller, exercises the real
  seller refund route, proves the source-bound payment/Case/stock/Notification
  and EmailOutbox boundary plus exact replay, and removes all disposable
  application and provider state except the reviewed processed webhook lease
  and ordinary external telemetry.
- Local validation at the exact checkpoint passed eight operator/fixture tests,
  the 45-test refund and signed-authority suite, all 3,384 repository tests
  with seven documented skips, TypeScript, lint and a clean-clone production
  build. The proof has not run and changes no production or provider state.

## Blocked-checkout refund delivery compatibility prepared (2026-08-25)

- The required pre-RLS product audit found that an automatic paid-checkout
  refund emitted `NEW_ORDER` and reserved no refund email. This consulted the
  wrong preference/icon class and could omit durable refund delivery for an
  otherwise active buyer. The correction is independent of RLS and is not
  deferred behind activation.
- Isolated branch
  `agent/order-payment-event-blocked-checkout-delivery-20260825` changes the
  existing path to `REFUND_ISSUED` and atomically co-commits its deterministic
  `refund_issued` EmailOutbox reservation with the fixed payment record and
  source-derived Notification. The post-commit send remains recoverable and
  does not replay the Stripe refund.
- Migration `20260825010000_prepare_blocked_checkout_refund_delivery`, SHA-256
  `24000c6a69525b19ce14ef8031cfb7a7c1914aedc26115f7425b7ff9f7e223a6`,
  temporarily accepts both the predecessor and corrected type for only the
  existing source-bound blocked-checkout family. It recreates no wrapper,
  changes no table/RLS posture or table grant, and re-denies the generic core
  to `PUBLIC` and `grainline_app_runtime`.
- A final whole-transition review rejected the first compatibility draft even
  after exact-head CI had started: Notification replay identity and its unique
  constraint include `type`, so accepting old `NEW_ORDER` and corrected
  `REFUND_ISSUED` literally could create two rows when a webhook retry crossed
  the deployment drain. The owner function now canonicalizes the legacy input
  to `REFUND_ISSUED` before preference evaluation, replay-key derivation and
  insert. The real creation-family matrix invokes both spellings in both
  orders and requires one stable stored `REFUND_ISSUED` row. Focused migration,
  ACL, Notification-matrix and refund-finalization tests pass 19/19; the
  superseded exact-head CI result is not release evidence.
- CI verifies and isolates the successor before the five byte-sealed
  OrderPaymentEvent predecessors, restores it only after their proofs, then
  applies it, audits grants and runs the complete Notification family matrix
  for both old and corrected spellings. Historical release verifiers accept
  only this exact byte-verified successor; arbitrary later migrations remain
  fail-closed.
- Focused static/release checks and the complete local suite pass: 3,390 tests
  passed with seven documented skips and zero failures; TypeScript, lint, YAML,
  JSON and Notification 55/55 readiness checks also pass. No migration,
  deployment, Stripe object, database row, grant, RLS or provider state has
  changed. Required next gates are a clean-checkout build, exact-main
  PostgreSQL CI, compatibility migration, compatible application deploy, real
  hosted test-checkout proof, predecessor drain and a separate retirement
  migration.

## Blocked-checkout refund delivery production gate isolated (2026-08-25)

- The isolated successor now has a dedicated exact-main production workflow
  rather than relying on the older five-migration compatible-stack runner. It
  binds one successful push-triggered main CI run, the direct reviewed owner
  credential and the exact latest migration before any mutation is reachable.
- A combined scope reader verifies the five-migration `OrderPaymentEvent`
  prefix, the candidate ledger, Notification ENABLE/FORCE posture, its two
  exact policies, runtime table/column grants, and the exact private core plus
  source-specific order-wrapper bodies in one engine-attested
  repeatable-read/read-only transaction. Restart mode accepts only the exact
  absent candidate or exact applied candidate; failed, partial, duplicate or
  checksum-drifted rows fail closed.
- The runner isolates the candidate while proving the sealed predecessor tree
  and clean predecessor migration status, restores it before one conditional
  `prisma migrate deploy`, then runs migration status, the global grant/RLS
  audit and required after-state scope proof. It does not run the broad role
  provisioner because this successor changes only one source-validating
  function body and explicitly re-denies its private core.
- Focused migration, scope, workflow and predecessor-contract validation passes
  20/20, including real disposable PostgreSQL application and ACL proof. The
  complete repository suite passes 3,400 tests with seven documented skips and
  zero failures; TypeScript and lint pass, and both edited GitHub workflows
  parse as YAML. The branch remains unmerged and the workflow has not run;
  production, deployment, provider, grants and RLS state are unchanged.

## Blocked-checkout live provider proof isolated (2026-08-25)

- Isolated branch
  `agent/order-payment-event-blocked-checkout-proof-20260825` adds the distinct
  restart-safe live acceptance operator
  `scripts/order-payment-event-blocked-checkout-production-proof.mjs`. It has
  four explicit commands: `prepare`, loopback-only `serve`, `verify`, and an
  unpaid-only `cleanup`. Review, commit or merge does not authorize execution.
- The proof creates one marker-bound transfer-only Stripe test Custom account,
  one hidden private $5 listing, and a Checkout Session through the deployed
  authenticated quote and single-item checkout routes. It changes only the
  synthetic seller to vacation mode after Session creation, so the real
  webhook path must recognize the now-blocked paid checkout. Payment remains a
  human-completed Stripe Embedded Checkout; no webhook secret or forged event
  substitutes for provider delivery.
- Verification binds the genuine `checkout.session.completed` and
  `charge.refunded` events to one Order, completed reservation, restored stock,
  full tax-inclusive buyer refund, exact $4.75 seller transfer reversal, two
  source-bound `OrderPaymentEvent` rows, one `REFUND_ISSUED` Notification, one
  preference-skipped refund EmailOutbox row and three audit rows. It separately
  requires zero erroneous `NEW_ORDER` Notification or email effects, then
  resends both exact signed event identities and rejects any application-row or
  lease-generation change.
- Cleanup performs exact relationship and live foreign-key checks before
  deleting the application fixture, restores the canary's original preference
  and terms snapshot, revokes its Clerk sessions, removes only its Redis keys,
  and deletes the zero-balance connected account. It retains only the two
  processed webhook leases plus immutable Stripe test objects and ordinary
  provider/observability telemetry. A paid Session cannot use the abort path.
- Adversarial review tightened the mode-`0600` restart journal's preference,
  terms, timestamp and disposable-identity validation; removed an unnecessary
  early-stage direct SellerProfile delete; pinned the live Grainline Clerk
  tenant and HTTPS Redis credentials; and explicitly classified the new
  owner-side `StripeWebhookEvent` reads in the historical activation inventory.
  The inventory tripwire was the only failure in the first full run and passed
  after that classification.
- The final local validation passed the 84-test focused payment/refund suite,
  the 16-test operator plus StripeWebhookEvent inventory suite, all 3,415
  repository tests with 3,408 passes and seven documented skips, TypeScript,
  lint, syntax/diff checks and an exact clean-clone Next.js production build.
  The nested-worktree build was rejected by Turbopack's filesystem-root check,
  and the first sandboxed clean-clone attempt was denied its internal localhost
  port; the identical clean-clone build completed after removing that sandbox
  restriction, including compilation, TypeScript, page-data collection and all
  159 static pages. The disposable clone and its mode-`0600` environment copy
  were deleted afterward. The operator has not run: no Stripe object, Checkout
  Session, database row, deployment, migration, grant, RLS, Clerk, Redis or
  provider configuration changed in this checkpoint.
- The review stack is intentionally linear: PR `#272` targets `main`; PRs
  `#273`, `#274`, `#275` and `#276` each target the immediately preceding
  branch. Land one PR at a time, retarget the next child to current `main`, and
  require fresh exact-main CI before landing it; merging a child into its
  feature-branch base does not put that child on `main`. Root PR `#272` passed
  GitHub CI run `32804056205`. Its Vercel Preview and PR `#276`'s Preview both
  compiled and passed TypeScript before page-data collection failed because
  Preview deliberately has no `DATABASE_URL`; those red Preview checks are not
  application failures and are not accepted as build evidence. The clean-clone
  build above is the successful production-build evidence for exact head
  `e95c60c9f2227ab97c1bb5c290041d92ee12cceb`.
- A final state-machine audit found that abort cleanup could reach ambiguous
  persisted stages immediately around account creation, fixture creation or
  Checkout Session creation and then either miss an unjournaled provider
  object or report a misleading relationship mismatch. Cleanup now rejects
  those four stages before loading provider credentials and requires the same
  restart journal to resume `prepare` through its idempotent/marker-bound
  convergence. Only `reserved`, `account-created` and `seller-blocked` are
  unpaid abort checkpoints; paid states still require `verify`. Unit coverage
  enumerates every accepted and rejected boundary. Focused validation passes
  20/20; the complete suite passes 3,409 tests with seven documented skips and
  zero failures, and TypeScript plus lint pass. The operator remains unexecuted
  and production/provider state remains unchanged.
- A subsequent whole-transition review found one remaining crash window:
  `checkout-created` changed the synthetic seller to vacation mode before
  persisting `seller-blocked`, but its retry required the old value to remain
  false. A crash between those operations therefore could not converge. The
  transition now revalidates and idempotently updates the exact marker-bound
  SellerProfile whether its vacation flag is false or already true. Disposable
  PostgreSQL regression coverage executes the transition twice and proves one
  unchanged blocked fixture. The operator remains unexecuted and production
  state remains unchanged.
- The same review rejected `account-created` as an unproven cleanup checkpoint:
  fixture creation could have committed before the journal advanced, allowing
  abort cleanup to remove the disposable Stripe account while leaving the
  production fixture and altered canary fields behind. The operator now writes
  `fixtures-create-pending` before that transaction and refuses cleanup from
  that state. Consequently `account-created` proves no fixture mutation has
  begun, while a crash around fixture commit must resume the exact idempotent
  prepare path. Unit coverage includes the new ambiguous stage. Nothing has
  run against production or a provider.
- Exact-release binding was also inconsistent across commands: `prepare`,
  `verify` and `cleanup` checked the clean reviewed main commit and successful
  CI, while loopback `serve` handled the private Checkout client secret without
  repeating those checks. `serve` now enforces both bindings before reading the
  recovery journal or environment. Static regression coverage pins that order;
  the operator remains unexecuted.
- Post-correction validation passes the 26-test focused migration/scope/operator
  suite, all 3,417 repository tests with 3,410 passes and seven documented
  skips, TypeScript, lint, syntax and diff checks. No production or provider
  operation was executed.
- The exact-main hard review then found that fixture cleanup restored the
  operational canary's saved preference/terms snapshot without first proving
  those fields had not changed concurrently. That could overwrite an external
  canary update even though all marker-bound fixture deletion remained exact.
  Fixture creation now locks the exact canary row and accepts only the saved
  original snapshot before mutation or the exact proof-fenced snapshot on
  resume. Successful and unpaid cleanup lock and require the proof-fenced state
  before any deletion or restoration. Disposable PostgreSQL coverage changes
  the canary preference between stages and proves both resume and cleanup fail
  without deleting fixture rows.
- That fence review also caught a same-class timestamp risk: directly reading
  PostgreSQL `timestamp without time zone` fields through node-postgres can
  reinterpret their wall time in the workstation timezone before a later exact
  comparison. The canary query now projects both timestamp snapshots as
  lossless six-digit database text, retains that representation in the private
  journal, and casts it back only inside PostgreSQL. Regression coverage pins
  the microsecond-preserving representation. The refreshed focused
  operator/inventory suite passes 19/19; the complete local suite passes 3,418
  tests with 3,411 passes, seven documented skips and zero failures, and
  TypeScript plus lint pass. Exact head
  `d568238accb123784a42fc4b3d202c4d5ac73ab4` passed CI `32893122321`, and
  PR #276 merged as main `dc46c7791d0761735118666800d5beaddd402ec9`.
  The operator remains unexecuted and production/provider state remains
  unchanged.

## Blocked-checkout compatibility runner predecessor isolation (2026-08-25)

- Authorized workflow run `32895229230` passed its exact-main/CI, credential,
  byte, and read-only restart-scope gates, then failed closed before
  `prisma migrate deploy` while verifying the sealed predecessor releases.
  No production migration, deployment, provider action, grant change or RLS
  change occurred.
- The run's engine-read-only restart snapshot directly reported
  `blockedCheckoutRefundDeliveryApplied=false`,
  `state=delivery-predecessor`, `OrderPaymentEvent` RLS off, predecessor CRUD
  retained, Notification FORCE retained and `productionChangedByProof=false`.
- The runner had isolated only the blocked-checkout candidate before invoking
  the oldest OrderPaymentEvent predecessor verifier. Four later reviewed
  predecessors remained visible, and the verifier correctly rejected them as
  successors. This was a workflow staging defect, not migration-ledger or live
  database drift.
- The isolated correction mirrors the already-proven CI sequence: verify the
  newest predecessor, move it aside, continue backward through all five, then
  restore the four isolated successors chronologically before migration status
  and the one conditional deploy; the oldest visible leaf never moves. A
  disposable migration-tree regression runs every verifier at the exact staged
  filesystem boundary, preventing a static ordering assertion from masking
  this failure class again.
- Focused migration/scope/workflow validation passes 11/11. The complete
  repository suite passes 3,419 tests with 3,412 passes, seven documented
  skips and zero failures; TypeScript, lint, YAML parsing and diff checks pass.

## Blocked-checkout provider metadata failure (2026-08-25)

- Exact main `a6593516be9fd5531e867aea43b4bbf6319f3094`, CI
  `32900648444`, migration run `32902265239` and READY deployment
  `dpl_JCmwmKQVwTnvMB2nk7XwYFvQR5xA` passed the pre-execution bindings. The
  focused migration, scope, operator and atomic refund-side-effect suite passed
  24/24 immediately before execution.
- Stripe rejected the disposable connected-account request because the
  operator's marker metadata key was 46 characters; Stripe permits at most 40.
  The provider request created no account, and the proof reached no database
  fixture, Checkout Session, payment, signed event or sanitized success
  evidence. The private recovery journal is preserved at
  `account-create-pending` with no provider object identifier.
- The isolated correction uses a 32-character marker key and adds an executable
  provider-limit assertion plus fail-closed unit coverage. It does not rewrite
  the journal. Instead, the original attempt commit and CI remain the state,
  marker and idempotency binding while a separate clean operator commit and CI
  are required for execution. Both CI bindings are revalidated, and recovery
  mode refuses to create a fresh attempt without the preserved journal.
- Production application, database, grants, RLS posture, deployment and
  provider configuration were not changed by the failed attempt or correction.
  The hosted payment, signed delivery, exact replay and cleanup remain open.
- The isolated correction passes the 24-test focused migration, scope,
  operator and atomic refund-side-effect suite; all 3,419 repository tests
  complete with 3,412 passes, seven documented skips and zero failures.
  TypeScript, lint, syntax and diff checks pass.

## Blocked-checkout provider responsibility regression (2026-08-25)

- PR #279 merged the metadata-limit correction as exact main
  `ed80ecc3401ec9b1b95724978beccb85e0d8f9b0`; exact-main CI
  `32907978390` passed the complete PostgreSQL, TypeScript, lint, test,
  security-audit and production-build chain.
- The resumed test-mode attempt stopped fail closed at
  `account-create-pending`. The disposable builder still requested a legacy
  Custom/application-collected identity contract, so Stripe required a
  platform-profile acknowledgment. No acknowledgment was submitted. The
  request created no account and reached no application fixture, Checkout
  Session, payment, signed event or success evidence. Deterministic fixture IDs
  are reserved in the private journal before any fixture row exists;
  `createFixtures()` follows only after `account-created`.
- This reproduces a previously resolved provider-proof class. Grainline's real
  seller onboarding uses an Express dashboard, Stripe-collected identity
  requirements and application-paid fees/losses. A disposable proof must not
  create a different compliance contract merely to avoid hosted onboarding.
- The isolated successor removes `type`, `business_type`, `individual` and
  direct `tos_acceptance`; adds the exact production-aligned controller and
  non-secret returned-controller diagnostics; and pauses before application
  fixtures when Stripe-hosted onboarding is required. Its one-time Account
  Link lives only in a mode-`0600` record, is redacted from errors, and is
  opened through a local command without printing the URL. An account-create
  idempotency version successor prevents the two rejected parameter shapes
  from aliasing the corrected request while preserving the original attempt,
  marker and evidence boundary.
- The corrected successor passes the 30-test focused migration, scope,
  disposable-PostgreSQL and operator suite; all 3,421 repository tests complete
  with 3,414 passes, seven documented skips and zero failures. TypeScript,
  lint, syntax and diff checks also pass.
- Production application, database, migration, grants, RLS, deployment and
  provider configuration remain unchanged. Do not submit the Stripe platform
  profile for this proof, delete the recovery journal, or advance predecessor
  drain/RLS activation before hosted onboarding, genuine payment, signed
  delivery, exact replay and cleanup all pass.

## Blocked-checkout disposable seller eligibility drift (2026-08-25)

- Hosted test onboarding completed and the preserved proof created its exact
  private seller/listing fixtures. The first quote stopped fail closed before a
  Checkout Session because the fixture still carried the obsolete
  `v1/custom` database markers; production's seller-order guard correctly
  rejects `stripeAccountVersion='v1'`.
- No reservation, Checkout Session, payment or signed event existed at the
  stop. The temporary account was created through the classic Accounts API, so
  labeling it Accounts v2 would be false. The isolated recovery instead uses
  `stripeAccountVersion IS NULL` for honest legacy compatibility and binds
  `stripeControllerType` to the exact Express/application/application/Stripe
  controller summary.
- Recovery is restricted to the exact marker-bound temporary seller identity
  and accepts only the known prior `v1/custom` tuple or the exact converged
  tuple. Any other controller/version drift fails closed. Real seller
  onboarding remains unchanged on `/v2/core/accounts`; no production migration,
  deployment, RLS, grant, credential or provider configuration changed.
- The recovery passes the 31-test focused migration, scope, disposable-
  PostgreSQL and operator suite; all 3,422 repository tests complete with 3,415
  passes, seven documented skips and zero failures. TypeScript, lint, syntax and
  diff checks also pass.

## Blocked-checkout client-secret encoding drift (2026-08-25)

- The corrected seller identity passed the shipping quote and the real checkout
  route behaved correctly: the forged-origin request returned `403`, and the
  authenticated request returned `200`, creating one open unpaid Embedded
  Checkout Session and one `SESSION_CREATED` reservation.
- The proof stopped before journal advancement because its response validator
  allowed only an alphanumeric/underscore client-secret suffix. The observed
  current Stripe test secret is bound to the exact Session ID but contains a
  valid percent escape. No payment or signed event exists; the journal remains
  at `checkout-create-pending` and the existing checkout lock is the recovery
  source of truth.
- The isolated correction requires the exact test Session ID prefix, binds the
  secret to that exact ID plus `_secret_`, caps the full value at 1,024
  characters, and accepts `%` only as a complete hexadecimal escape triplet.
  Cross-session secrets, malformed escapes, control characters and oversized
  values are explicitly rejected. This changes no application, migration,
  grants, RLS or provider configuration.

## Blocked-checkout Stripe expansion-depth drift (2026-08-25)

- PR #282 merged the encoded-client-secret correction as exact main
  `f361d6c8a4c34b2eb097e18025d515bd7a19285a`; push-triggered main CI
  `32916271880` passed the full release/test/build chain.
- The next restart recovered the existing checkout response but stopped before
  journal advancement because Session retrieval asked Stripe to expand
  `payment_intent.latest_charge.refunds.data.transfer_reversal`, which exceeds
  Stripe's four-level property-expansion limit. No payment or signed event
  exists; the journal remains at `checkout-create-pending` and the existing
  unpaid Session/reservation remains the restart source of truth.
- Refund verification already resolves the exact refund ID from the durable
  Order and retrieves that refund separately with only `transfer_reversal`
  expanded. The isolated correction therefore removes the redundant deep
  Session expansion, pins the exact three-level
  `payment_intent.latest_charge.transfer` expansion, and leaves all refund and
  reversal assertions intact.
- PR #283 merged that correction as exact main
  `d08ce3eb94efe74b388bc1d6605a2657f1f2035f`; push-triggered main CI
  `32918254271` passed. During the two correction/CI waits, both pre-payment
  Sessions expired normally and their signed expiry handling restored stock.
  A later aggregate-only production/Stripe inspection retained no raw IDs and
  proved exactly two fixture-bound rows, both
  `RESTORED/stripe_session_expired`, unpaid, Embedded Checkout, test mode,
  without a PaymentIntent, with null repair claims and exact buyer, seller,
  listing, lock, metadata and one-item reservation bindings. No payment,
  checkout-completed delivery or refund delivery occurred.
- A new isolated recovery correction treats that history as explicit input
  rather than residue to ignore. It permits at most five exact terminal
  expired attempts and at most one exact open unpaid attempt, reuses the active
  Session if present, and persists the terminal count with the private journal.
  The Session-bound encoded-secret validator is shared by route and journal
  validation, and redaction now consumes complete percent escapes. Paid and
  unpaid cleanup each lock and re-prove the full fixture-bound reservation set,
  delete every classified row in the same serializable transaction, and fail
  without partial deletion on source, item, provider, repair or cardinality
  drift. Disposable PostgreSQL coverage proves cleanup of two terminal rows
  plus the current row for both paths and proves rollback on drift. Production
  remains at the two restored rows pending the same proof's successful or
  explicit unpaid-abort cleanup; RLS, grants, deployment and provider
  configuration are unchanged.
- Final validation passes the 17-test operator/disposable-PostgreSQL suite,
  all 3,425 repository tests with 3,418 passes and seven documented skips,
  TypeScript, lint and diff checks. The exact new classifier also accepted the
  two real rows and Stripe Sessions through an engine-read-only aggregate check
  with `terminalCount=2`, `activeCount=0` and no raw identifiers in output.

## Buy Now last-unit exact-retry recovery gap (2026-08-25)

- The bounded-history recovery merged as exact main
  `0a77c695a079568ac4eb16d91d16da1406e39b07`; exact-main CI `32922211178`
  passed the complete migration, PostgreSQL, TypeScript, lint, 3,425-test,
  dependency-audit and production-build chain.
- Its authorized restart classified the two exact restored/expired unpaid
  attempts and created one new open unpaid Embedded Checkout Session with one
  exact `SESSION_CREATED` reservation. The exact POST retry then failed closed,
  and a subsequent restart returned `400` from shipping quote because the
  first request had correctly reserved the final unit and reduced live stock to
  zero before the buyer consumed the response.
- A sanitized read-only database/Stripe inspection plus exact Redis-key read
  proved three bounded rows: two `RESTORED/stripe_session_expired` and one
  `SESSION_CREATED`; all Sessions are unpaid with no PaymentIntent; and the
  active ready lock exactly matches the reservation payload, Session and
  client secret. No raw identity or secret was retained in output. No fourth
  Session was created and no payment, delivery, deployment, migration, RLS,
  grant or provider-configuration change occurred.
- Root cause is application ordering: the Buy Now POST checked last-unit stock
  before its ready lock, while modal re-entry asked shipping quote before it
  had any single-checkout resume mechanism. The isolated fix keeps exact
  payload validation and database stock authority, recovers only an exact ready
  lock before new-attempt stock rejection, and adds a buyer/listing/lock/
  Stripe-bound resume route. Mismatched metadata, payload, Session, mode,
  status or secret fails closed. The retained active attempt may continue only
  after this correction passes review, exact-main CI and a compatible
  production deployment. No attempt may be created before that deployment. If
  the retained Session expires during review, the restart must classify all
  three exact terminal unpaid attempts and may create exactly one bounded
  replacement under the already-reviewed five-attempt ceiling.
- The recovery configuration preserves the journal's original source, CI and
  deployment identity while accepting a separate all-or-none corrective
  source/CI/deployment binding. It revalidates every distinct exact-main CI,
  attests the corrective canonical deployment, and retains both application
  bindings in final sanitized evidence rather than rewriting history.

## Blocked-checkout paid proof exposed transfer-visibility accounting race (2026-08-26)

- Exact main/operator `71197a539e2eb2e476dce3fc0c4ae2b11315032b`
  passed CI `32988148978`. Its authorized renewal created at most one bounded
  replacement, restored vacation mode and produced a genuine human-completed
  Stripe test-mode Checkout. The journal advanced to `payment-completed`.
- Verification failed closed before event replay or cleanup. Sanitized
  engine-read-only database and provider inspection proved the buyer's
  541-cent refund succeeded, the exact 475-cent destination transfer exists,
  no transfer reversal exists, the Order retained null `stripeTransferId`, and
  the local refund ledger truthfully recorded platform-funded/manual-transfer-
  reconciliation accounting. No success evidence was written and the exact
  fixture remains preserved.
- A subsequent deep read returned the same transfer from the exact
  PaymentIntent/Charge. The isolated correction now performs a bounded
  provider reread and throws for signed-event retry while the transfer is
  absent. Migration
  `20260826010000_prepare_blocked_checkout_transfer_binding` adds one
  `SECURITY DEFINER`, `search_path=pg_catalog`, runtime-only binding operation.
  It locks the exact active `StripeWebhookEvent` generation and paid
  Order/Session/PaymentIntent/Charge, permits exact replay, rejects conflicting
  transfers and refuses first-write binding after refund authority.
- The separate `reconcile` operator never changes the failed run to passed. It
  is exact-journal and test-mode only, checkpoints before the manual 475-cent
  reversal, uses one deterministic idempotency key, proves exact retry and
  one-reversal cardinality, and resumes cleanup safely after database or
  account cleanup. Its sanitized evidence must say
  `reconciled-failed-proof`, `automaticProductionProofPassed=false` and
  `freshAutomaticProofRequired=true`.
- Production was not changed by preparing this correction. Required order is
  migration review/apply, compatible app deploy, separately authorized exact
  fixture reconciliation, and a fresh automatic paid proof. Do not drain the
  predecessor or activate `OrderPaymentEvent` RLS before the fresh proof.
- The final isolated release adds a dedicated exact-main/CI production
  workflow plus one engine-attested repeatable-read/read-only restart verifier.
  It accepts only absent or exact-applied candidate ledger state and pins the
  function owner, body, SECURITY DEFINER/search-path posture, runtime-only
  EXECUTE and PUBLIC denial. The generic Production Migrations runner now
  isolates the candidate whenever it is unapplied, preventing accidental
  application outside the dedicated boundary. The final migration SHA-256 is
  `95fcb6a8dceeb116b96f4f6f3dc18ada055c91a931a88b0d22672ea2ed027e09`;
  its final UPDATE independently refuses refund locks, claims and ledger rows.
  Focused tests pass 44/44 and the full repository passes 3,451 tests with zero
  failures and seven intentional skips; TypeScript, lint and diff checks pass.
  Production and the preserved failed-proof fixture remain unchanged.
- Draft head `a403e3c947a7f5f7728fa384b2c397e9694e50f8` failed exact-head CI
  `33045363294` only when its proof logged in through the real restricted
  runtime role against the complete migration tree. The complete tree's
  deferred Order seller-key trigger rejected the proof's empty synthetic
  Order; the lightweight migration-only PGlite test did not include that older
  invariant. The production function was not relaxed. The proof fixture now
  creates and cleans one full disposable User/SellerProfile/Listing/Order/
  OrderItem authority chain in a single transaction, with regression coverage
  preventing another incomplete-order shortcut. The failed run is not release
  evidence and made no production or provider change; fresh exact-head CI is
  required. The corrected focused suite passes 17/17 and the full repository
  suite passes 3,452 tests with zero failures and seven intentional skips;
  TypeScript, lint and diff checks pass.
- Correction head `f456d912d24f8c7c8096adce8f77248c0ac2a664` reached the same
  direct-runtime proof in CI `33046021218` and found a separate real candidate
  defect: the function attempted to update nonexistent `Order.updatedAt`.
  The migration-only PGlite fixture had modeled that nonexistent column and
  therefore masked the defect. Production remained untouched. The candidate
  now writes only `stripeTransferId`, the lightweight schema no longer invents
  `updatedAt`, and a static assertion rejects its reintroduction. The repinned
  SHA-256 is recorded above; this second failed run is not release evidence.
- Final correction head `a092e4a4bf1608ab1e7231633db3da36d2fbd391`
  passed exact-head CI `33046657108`, including disposable and real restricted-
  runtime PostgreSQL proofs, the complete repository suite, TypeScript, lint,
  dependency audit and production build. PR #289 merged as exact main
  `ea12d220b9809ac113e9d79c7e8996e103d8d641`; exact-main CI
  `33088415834` plus the standing Conversation/Message and Notification FORCE
  proofs `33088415885` and `33088415831` passed. This is release-byte evidence,
  not production-application evidence: no migration, deployment, fixture
  reconciliation, RLS activation or provider mutation occurred. The preserved
  paid failed-proof fixture remains the exact separate reconciliation target.
- Guarded production run `33106083900`, bound to exact main
  `855118f36d0a98d1bc376d35101f50e21e87d184` and CI `33096249263`,
  applied only the byte-pinned transfer-binding migration. Migration status
  and the global grant/RLS audit passed; the final read-only scope proof failed
  because its source extractor stripped the two newlines PostgreSQL preserves
  inside the function's dollar-quote delimiters. Sanitized read-only catalog
  comparison proved every other ledger, ownership, function-posture and ACL
  field exact and proved `"\n" + expected + "\n"` equals the stored source.
  The extractor and real-PostgreSQL regression proof are corrected without
  changing the sealed migration. Acceptance remains open pending a corrected
  exact-main restart-safe read-only rerun. No deployment, fixture cleanup, RLS
  activation, predecessor drain or provider change occurred.
- With the extractor corrected, the same owner-credential production reader
  passed locally inside an engine-attested repeatable-read/read-only
  transaction: state `transfer-binding-compatible`, both candidates applied,
  runtime EXECUTE only, payment RLS off, predecessor CRUD retained and
  `productionChangedByProof=false`. This validates the diagnosis without
  mutation but does not substitute for the exact-main/CI-bound GitHub restart
  proof.
- Correction head `8bd52c006a8637d6bf6009eb38212154541ab91d`
  passed exact-head CI `33106963478` and PR #291 merged as exact main
  `9736957e0700e1c41e3319148daa63a1d8f17602`; exact-main CI
  `33108121631` passed. Restart-safe guarded production run `33109482365`
  classified the exact state as `transfer-binding-compatible`, skipped both
  the predecessor-only migration-status check and migration deployment, then
  passed final migration status, the global grant/RLS audit and the corrected
  engine-read-only post-application scope proof. Production acceptance of the
  compatibility migration is closed. No application deployment, fixture
  reconciliation, RLS activation, predecessor drain or provider change
  occurred.
- PR #292 merged the accepted evidence as exact main
  `a09827e0a641ec2f7e228520661cd7e74625bb0d`; exact-main CI
  `33110954923` passed. Vercel production deployment
  `dpl_8FMq11zfZT166Dve7Vf6sTJTXFzX` reached `READY`, reports exact source SHA
  `a09827e0a641ec2f7e228520661cd7e74625bb0d`, serves every canonical alias and
  returned healthy canonical runtime status. The post-deployment engine-read-
  only proof remained exactly `transfer-binding-compatible`, retained
  predecessor CRUD and changed no production state. Predecessor deployment
  `dpl_AJanN3zfnubB39Aj14NFziHAhfeB` remains `READY`. No fixture reconciliation,
  migration, RLS activation, predecessor drain, provider-variable or
  credential change occurred.
- The first authorized failed-proof reconciliation invocation from exact main
  `bfcd1ce44e66e9d68e7db498901bc513ae76dc72` / CI `33113589947`
  failed before any checkpoint write, transfer reversal or cleanup because its
  Stripe event selector required `charge.refunded.data.object.refunds.data`.
  The pinned Clover event shape omits that embedded collection. Engine-read-
  only database inspection plus read-only Stripe test-mode inspection proved
  one exact 541-cent durable refund, one exact 475-cent transfer with zero
  reversals, one signed charge-refund lease, one unique matching
  `charge.refunded` event and one unique matching `refund.created` event. The
  mode-`0600` journal remains `payment-completed` and no reconciliation state or
  evidence exists. The correction cross-binds the signed charge event by
  charge/payment-intent/transfer/totals and independently binds the durable
  refund ID through the exact refund-created event. Separate retrieved-refund
  and transfer/reversal readers retain the money-movement proof; ambiguity and
  mismatch still fail closed. The same stale embedded-list assumption is removed from
  the seller-refund proof operator with regression coverage. No production or
  provider state changed during diagnosis or candidate validation.
- PR #294 merged the modern Stripe event-identity correction as exact main
  `3b11d8f95f402675bed0446cf32dd2db374603bb`; exact-main CI
  `33117395241` passed. Its separately authorized reconciliation rerun failed
  closed after exact identity rediscovery but before a reconciliation
  checkpoint, reversal or cleanup. Read-only inspection proved zero reversals
  and found four exact historical-representation mismatches in the manual-only
  predicate: the signed row is `additional_external_refund` with null
  `latestRefundId`; that classification installed the exact preserved-local-
  audit review note; and the private listing correctly remains `SOLD_OUT` with
  stock one. The local row, independent `refund.created` event and retrieved
  Refund still cross-bind the durable 541-cent refund. The isolated correction
  requires only this exact failed-fixture shape and leaves the normal automatic
  success predicate unchanged. The journal remains mode `0600` at
  `payment-completed`; no reconciliation evidence, automatic-proof evidence,
  reversal or cleanup exists.
- A final cleanup-path review found the shared fixture deletion fence still
  required the normal proof's `ACTIVE` listing. That would have made a corrected
  reconciliation reverse the exact transfer and then fail before removing the
  historical `SOLD_OUT` fixture. The cleanup function remains default-strict on
  `ACTIVE`; only the manual reconciliation call selects `SOLD_OUT`, and it
  rejects every other status before opening its serializable transaction.
  Disposable PostgreSQL coverage proves both paths and rollback on mismatch.
- PR #295 merged those corrections as exact main
  `350133a9e67295e09a9238df09444326442b6585`; CI `33120674371`
  passed. The authorized reconciliation then failed before checkpoint,
  reversal or cleanup because the provider predicate required
  `Refund.livemode=false`, but Stripe's current OpenAPI Refund object has no
  `livemode` field. Read-only proof confirmed the object is the exact test-mode
  refund and the transfer remains unreversed with zero reversal objects. The
  isolated correction uses the real `object='refund'` discriminator plus
  exact ID and rejects explicit live-mode drift; validated test credentials,
  Session, Charge, Transfer and Events retain the mode boundary. A shared
  helper and class-wide guard correct the same dormant assumption in all three
  production refund proof operators without changing application behavior.
- PR #296 merged that correction as exact main
  `c0f706e8d92087dc51da8b1fefba976bc867296b`; CI `33127595577`
  passed. The authorized reconciliation created the exact idempotent 475-cent
  Stripe test transfer reversal, then failed closed before cleanup or evidence
  because `TransferReversal.livemode` is also absent from Stripe's current
  object and generated type. Read-only inspection proved exactly one fully
  bound reversal, a test-mode parent Transfer, intact application fixtures and
  a private `reversal-pending` restart journal. The isolated proof-only fix
  requires `object='transfer_reversal'` plus exact `trr_` identity and marker
  metadata while rejecting any future explicit live-mode field.
- PR #297 merged the transfer-reversal proof correction as exact main
  `ad2a8546e9799a25bd77ae0dfae662da6ec2823f`; CI `33132430080`
  passed. Its restart preflight stopped locally before external calls because
  the private `reversal-pending` journal is intentionally bound to the prior
  operator/CI. The isolated correction preserves that provenance: it accepts
  only an explicitly supplied prior commit/CI pair, re-verifies prior and
  current CI, permits the old binding only at `reversal-pending` with no stored
  reversal ID, and requires exactly one existing marker-bound reversal. The
  rebind path cannot create a reversal; after the full provider predicate
  passes, it atomically records the current operator binding and
  `reversal-confirmed`. No production or provider state changed.
- PR #298 merged that restart correction as exact main
  `c19be00957555ba09251b9a7369ba4ec11fcf431`; CI `33134429864`
  passed. The resumed test-mode reconciliation proved and persisted the exact
  reversal, advanced to `cleanup-started`, and revoked canary sessions, then
  failed inside the serializable cleanup transaction because node-postgres did
  not decode `array_agg(pg_catalog.name)` as an array. The transaction rolled
  back all row deletion; read-only proof found the application fixture and
  disposable account intact, one unchanged reversal, and no evidence. The
  isolated correction casts both catalog arrays to `text[]`; engine-read-only
  production proof through node-postgres confirmed array decoding for every
  returned foreign-key row across the four cleanup roots. The same latent
  assumption is corrected in the seller-refund and signed-payment proof
  operators, with a repository-wide recurrence guard. The restart permits an
  explicit prior binding at `reversal-confirmed`/`cleanup-started` only when
  the persisted reversal ID matches the one exact provider object. A
  `cleanup-started` rebind additionally re-proves the complete database
  snapshot before atomically updating the operator pair.
- PR #299 merged the catalog/restart correction as exact main
  `61ea7c0156838599d39ab621cdd4d93373c3c3ba`; CI `33135791154`
  passed. Its authorized restart committed the exact serializable database
  cleanup, restored the canary, retained the two processed webhook leases and
  removed every marker-bound Redis key. The exact zero-row post-cleanup
  snapshot passed. Stripe account deletion also succeeded, but the operator
  then issued an unsupported verification GET; Stripe returned exact
  `StripePermissionError/account_invalid/403`. A complete read-only account
  listing contained 13 test accounts and excluded the disposable ID. No
  reconciliation or automatic-success evidence was written, and the private
  state plus `cleanup-started` journal remain mode `0600`.
- Stripe's account-deletion API documents the successful DELETE response as
  the deleted-object proof and says a nonexistent account raises an error. The
  correction therefore removes both redundant post-delete GETs. Restart
  recovery accepts account absence only for the exact error tuple plus a
  complete listing that excludes the expected ID. It always re-proves the
  sole exact transfer reversal and requires either the complete intact failed
  fixture or the complete cleaned aggregate snapshot; partial cleanup,
  malformed account rows, a listed target account or any other Stripe error
  fails closed. Reconciliation remains cleanup-only evidence and cannot satisfy
  the fresh automatic provider-proof activation gate.

## Blocked-checkout failed-proof cleanup finalized (2026-08-27)

- PR #300 merged the post-delete restart correction as exact main
  `8f31857bc6ca0f26c4965dfaae64f85089c0ede3`; exact-main CI
  `33137658339` passed. The authorized restart was additionally bound to the
  preserved `cleanup-started` journal from exact main
  `61ea7c0156838599d39ab621cdd4d93373c3c3ba` / CI `33135791154`.
- The operator re-proved the exact test-mode Session, 541-cent Refund,
  475-cent Transfer and sole 475-cent reversal. It required zero temporary
  application rows, exactly two processed webhook leases, one restored canary,
  removed exact Redis state and the reviewed exact account-absence predicate.
  It wrote sanitized mode-`0600` evidence and removed both private restart
  journals. The automatic-success evidence path remains absent.
- Retain reconciliation evidence SHA-256
  `d3a6ab9a109de1d607920e72ec92ba8811c3971104f079cde7e8525c504ba4f7`.
  Its status is `reconciled-failed-proof`, with
  `automaticProductionProofPassed=false` and
  `freshAutomaticProofRequired=true`. Independent read-only complete-list
  verification scanned 13 Stripe test-mode connected accounts and found no ID
  matching the deleted account hash.
- This closes the failed fixture only. It is not provider-path acceptance and
  does not authorize predecessor drain or `OrderPaymentEvent` activation. A
  completely fresh automatic paid blocked-checkout proof is the next mandatory
  gate.

## Signed refund omitted-identity compatibility finding (2026-08-27)

- The mandatory pre-RLS/domain audit found that the real pinned Stripe
  `charge.refunded` object can omit `charge.refunds.data`. The route passes null
  latest-refund fields, and the live compatible database function then records
  the signed event as `external:<event-id>` / `additional_external_refund` even
  when exact local refund evidence already exists. A new automatic paid proof
  would therefore fail again for an independent accounting reason.
- The isolated candidate replaces only the same-signature signed-refund
  function. It derives the missing identity only from exactly one fixed local
  `OrderPaymentEvent` plus its co-committed `SystemAuditLog`, with exact Order,
  refund, amount, currency, reason, local action and canonical-event binding.
  Missing, duplicate or mismatched evidence remains external. The three
  allowed actions are seller, staff Case and blocked-checkout refund records.
- Byte generation is bound to the sealed signed-authority predecessor.
  Disposable PostgreSQL covers all three families, exact/legacy replay,
  ambiguity and forgery denial. Separate owner/runtime PostgreSQL proof,
  restart-safe read-only production scope checks, exact-main workflow binding
  and global grant/RLS audit are wired. No migration, deployment, provider
  operation, grant or RLS state changed during this candidate work.
- This is `FIX_BEFORE_ACTIVATION` and `BLOCKS_PROVIDER_PROOF`. Apply and
  postflight it separately before spending another Stripe test payment; then
  create an entirely new automatic-proof namespace.
- Draft PR #302 exact-head CI run `33144446602` failed closed in the new real
  runtime-login proof because its fixture omitted the Listing/OrderItem seller
  graph required by the existing deferred durable-seller-key invariant. The
  database rejected fixture setup before the candidate function ran. The proof
  fixture now creates the full matching graph and teardown, with local
  regression coverage. The failed run is retained as negative evidence and
  cannot satisfy any release gate.

## Signed refund compatibility production scope failure (2026-08-28)

- PR #302 merged exact head
  `f5b5b7f394b44b68145bb856458ae16be2baf936` as main
  `f7491bf109a79ac7f34c29c604763c38396a7340`; exact-main CI
  `33149665189` passed.
- Guarded run `33176428000` applied only
  `20260828010000_prepare_order_payment_signed_refund_identity`. Migration
  status and the global grant/RLS audit passed. The final engine-read-only scope
  step failed because its recursive predecessor verifier still required the old
  signed-refund function body after the reviewed successor replaced that body.
- Production therefore contains the compatible function, with RLS and table
  grants unchanged, but the release remains unaccepted. The isolated proof fix
  validates the real successor catalog first, requires the two read-only catalog
  views to agree exactly, and substitutes only the byte-sealed predecessor body
  while checking the older chain. Missing, duplicate or mismatched views fail
  closed. Do not replay the migration or proceed to the pooled-runtime/provider
  proof until corrected exact-main CI and restart-safe final scope pass.
- Draft PR #303 exact-head CI `33177740639` passed the sealed database and
  real-login proof chain, then failed in the ordinary test step because the
  PGlite replay fixture recomputed the signed event timestamp from `Date.now()`.
  Crossing a one-second boundary made the replay payload genuinely different,
  and the fixed function correctly rejected it. The fixture now reuses one
  exact signed event timestamp across insert and replay. The failed CI did not
  contact or mutate production and is retained only as negative test evidence.
- Corrected PR #303 code head
  `55a4efe6e40dae9ea09be9146aa53d77ed723e65` passed exact-head CI
  `33178566813`: the sealed migration and real-login PostgreSQL chain, full
  tests, TypeScript, lint, audit and production build all passed. Its Vercel
  Preview failed only because Preview intentionally has no `DATABASE_URL`.
  This validates the isolated correction but does not accept production; exact
  reviewed merge, exact-main CI, restart-safe no-replay final scope and the
  distinct pooled-runtime postflight remain open.
- PR #303 merged as exact main
  `4ea201c411afd5e065200f81dbbf18d9dd5044d1`; exact-main CI
  `33190374131` passed. Restart-safe production run `33194758799` classified
  the already-applied successor as `signed-refund-identity-compatible` and
  skipped migration deployment. Prisma status, the global 65-table/
  179-function grant and RLS audit, and corrected engine-read-only scope all
  passed with `productionChangedByProof=false`.
- The distinct pooled `grainline_app_runtime` postflight passed from the same
  clean commit inside an engine-attested repeatable-read read-only transaction.
  It proved the actual NOBYPASSRLS runtime identity, exact successor body and
  ACL, predecessor CRUD retained, `OrderPaymentEvent` RLS off, direct empty
  read and expected read-only lock fence. Sanitized mode-`0600` evidence
  SHA-256 is
  `7849c8383164ae46d94bd8522710c8dbfdd1037da1e23281db1c3ef3e5b9e477`;
  `productionChangedByPostflight=false`. Compatibility is accepted. A fresh
  automatic paid provider proof, predecessor drain, remaining invariants and
  separate ENABLE/FORCE releases remain mandatory.

## Fresh blocked-checkout verifier false negative (2026-08-28)

- Exact main/deployed source
  `3431bb83fa16fabb9b9e18a729a7d138d48764d9`, CI `33211840251` and
  deployment `dpl_CcwbUVcaEsiVU1yscDT5fxX72P8S` produced a fresh genuine
  Stripe test-mode payment and both expected signed webhook deliveries.
- Verification failed closed before replay or cleanup. No automatic-success
  evidence was written; the mode-`0600` journal remains at
  `payment-completed`, and all marker-bound fixtures remain recoverable.
- Engine-read-only diagnosis found correct 541-cent refund accounting, exact
  475-cent transfer/reversal, 66-cent platform-funded remainder, no manual
  reconciliation/follow-up, restored stock, one notification, one skipped
  test email, three audits and two processed error-free webhook leases.
- The verifier—not production behavior—was stale. The database correctly
  writes its canonical automatic-refund note and intentionally leaves the
  private listing `SOLD_OUT` with quantity one. The isolated correction pins
  those semantics and additionally enforces every refund-accounting field.
  Focused unit and disposable-PostgreSQL tests pass 25/25. No production or
  provider state changed. Resume the existing journal only after exact merge
  and exact-main CI; do not charge another fixture.
- PR #306 merged that correction as exact main
  `b3d11828e80723858c1e7ce59e90307f2615379f`; CI `33218192414` passed. Its
  restart accepted the corrected delivery and exact replay, then failed closed
  at `cleanup-started` because the automatic cleanup call still inherited the
  helper's legacy `ACTIVE` default instead of explicitly requiring the private
  listing's `SOLD_OUT` status. The serializable transaction rolled back before
  row deletion; Redis/account cleanup was not reached and success evidence is
  absent. The isolated call-site correction and scoped regression pass 25/25
  focused tests and the full 3,479-test suite with zero failures. Resume the
  same journal only after exact merge/main CI under a new operator binding.

## Signed refund production proof identity false negative (2026-08-28)

- The first signed refund/dispute production proof was bound to operator main
  `2836e51d0ceb91ce05756dc5138e7c337e02a503`, CI `33220013251`, deployed
  source `3431bb83fa16fabb9b9e18a729a7d138d48764d9` and deployment
  `dpl_CcwbUVcaEsiVU1yscDT5fxX72P8S`. It ran in Stripe test mode only.
- The run created one $5 refund charge/Refund and its exact temporary refund
  fixture. The genuine `charge.refunded` lease processed once without error;
  the Order recorded 500 cents plus review state, one refund audit and one
  signed `OrderPaymentEvent` existed. The run created no dispute charge or
  fixture, wrote no success evidence and preserved its mode-`0600` journal at
  `refund-event-ready`.
- Engine-read-only diagnosis found a proof-contract defect. The pinned signed
  event omitted its nested refund collection. With no prior fixed local refund
  evidence, the production function correctly represented this direct provider
  refund as `external:<event-id>`. The verifier incorrectly queried and compared
  against the separately created `re_` Refund ID. Production behavior matches
  the accepted signed-refund identity design; no app/database correction or
  weakening is warranted.
- The isolated correction derives the expected identity from the exact
  immutable Stripe event: a valid embedded successful refund requires its
  exact `re_` ID, while omission requires `external:<event-id>`. It uses that
  source-derived identity for ledger, Order and replay checks and retains only
  its hash/representation in sanitized evidence. An explicit preparation
  commit binds the old journal and idempotency namespace while a separate exact
  operator/CI commit binds corrected code. Missing, malformed, different or
  unreviewed state fails closed; no second refund attempt is allowed.
- The failed run also exposed a node-postgres deprecation warning from issuing
  several catalog reads concurrently on one owner client. The correction runs
  those reads sequentially; this does not change the proof boundary, but makes
  database-check ordering explicit and removes that avoidable warning.
