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
  - Result: RLS is not currently implemented; application-layer authorization remains the launch-critical control plane.

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
- Result: no verified payment/webhook/upload vulnerability found in this spot check.

Hardening notes:

- Grainline still handles sensitive business data even though Stripe handles raw card data: user accounts, addresses, orders, messages, upload content, seller payout state, refund state, admin tools, and webhook-derived payment state.
- RLS is not currently enabled as a broad database policy layer. Current protection is Clerk middleware plus route/action-level ownership predicates. Targeted RLS or lower-privilege database roles should be evaluated in a dedicated pass after route predicates are fully inventoried.
- Open checkout sessions remain valid for their short Stripe expiry window after some listing-level seller actions unless those actions explicitly expire sessions. This is not logged as a verified bug yet because checkout sessions reserve stock and represent a buyer already in payment flow, but future hardening can decide whether listing archive/unpublish/seller vacation should also expire open sessions.

Follow-up fix from this pass:

- **Fixed 2026-05-13:** cart checkout webhook finalization no longer trusts mutable live `CartItem` rows after payment. Stripe's immutable paid `line_items` are now the source of truth for `OrderItem` creation, live cart rows are only optional enrichment for variant labels, and the transaction revalidates seller vacation/orderability plus listing active/private-reservation state before order side effects. Regression coverage lives in `tests/stripe-webhook-cart-finalization.test.mjs` and `tests/stripe-webhook-state.test.mjs`.
- **Fixed 2026-05-13:** seller order mutation routes now require whole-order ownership. Refund, fulfillment, and label-purchase routes no longer authorize on "seller owns any item" because that would be unsafe if a malformed mixed-seller order ever existed. Regression coverage lives in `tests/order-seller-route-ownership.test.mjs`.
- **Fixed 2026-05-13:** user report target validation now requires reporter access. Reports can still target public content, but orders/messages/threads require reporter participation and blog targets require public visibility, preventing report submission from acting as a private-object oracle. Regression coverage lives in `tests/user-report-target-access.test.mjs`.
- **Fixed 2026-05-13:** review helpful votes now require the review's listing to pass `canViewListingDetail()` for the voter. This prevents hidden/private listing reviews from being manipulated by direct review ID. Regression coverage lives in `tests/review-vote-visibility.test.mjs`.

Open work:

- Continue route-by-route audit for the remaining dynamic private routes.
- Prioritize remaining admin actions, reviews/review replies/votes, verification/guild routes, blog write routes, and a dedicated checkout-session-expiry policy review for seller/listing availability changes.
- Add regression tests for each verified issue before or with the fix.
