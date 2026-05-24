# Closed Audit History

Historical audit and fix-pass logs moved out of `CLAUDE.md` so project instructions stay focused on current architecture and behavior contracts. `audit_open_findings.md` remains the source of truth for individual findings.

## Notification Preference Runtime Shape Pass (2026-05-24)

- Added `normalizeNotificationPreferences()` as the shared runtime boundary for `User.notificationPreferences` JSON. It preserves only known preference keys with boolean values.
- In-app notification delivery, email preference checks, unsubscribe writes, seller broadcast follower filtering, and preference UI rendering now use the normalized shape instead of trusting `Record<string, boolean>` casts.
- This reduces current reader-side risk from malformed JSON values; a database-level JSON CHECK, historical data scan, and broader JSON/TEXT size policy remain separate product/ops decisions.
- Guardrail coverage: `tests/notification-preference-keys.test.mjs`, `tests/notification-delivery-preferences.test.mjs`, and `tests/notification-email-preferences.test.mjs`.

## Conversation Pair Invariant Pass (2026-05-24)

- Added a raw-managed unique expression index on `Conversation` unordered participant pairs (`LEAST(userAId,userBId)`, `GREATEST(userAId,userBId)`) while keeping the Prisma-visible ordered unique key used by app upserts.
- The migration fails with an explicit duplicate-pair error instead of silently merging retained conversation history if pre-existing swapped duplicates are found.
- Added guardrail coverage for the raw migration and normal canonical conversation creation paths.
- Guardrail coverage: `tests/conversation-pair-guardrails.test.mjs`.

## AI Review Outer Fail-Closed Coverage Pass (2026-05-24)

- `reviewListingWithAI()` now accepts optional test-only dependency injection for its duplicate-title lookup, OpenAI fetch, and retry sleep while preserving existing production callers.
- Added direct outer-wrapper coverage for missing OpenAI config, malformed model output, and transient provider retry exhaustion.
- Cross-seller duplicate detection remains a product-risk design decision because generic woodworking titles can create false positives without a broader threshold/appeal design.
- Guardrail coverage: `tests/ai-review-outer-failclosed.test.mjs`.

## Anonymous Cart Merge Durability Pass (2026-05-24)

- Extracted anonymous-cart sign-in merge outcome handling into `src/lib/anonymousCartMerge.ts`.
- Merge now removes only successfully merged or terminally rejected anonymous-cart lines; retryable auth, rate-limit, conflict, network, and 5xx failures remain in local storage for a later retry.
- Signed-out/sign-out cross-account leakage findings remain closed through `clearSignedOutLocalAccountState()`; this pass targeted partial-merge data loss and regression coverage.
- Guardrail coverage: `tests/anonymous-cart-merge.test.mjs`.

## Round 11 Verification Follow-up Pass (2026-05-24)

- Buyer order confirmations now show the multi-seller separate-order disclaimer only when checkout metadata records a multi-seller cart flow.
- The numeric-guard migration now normalizes malformed historical listing processing windows before validating the processing-days check constraint.
- Prisma schema comments and guardrail coverage now document that `Order.stripePaymentIntentId` and `Order.stripeChargeId` are raw-managed partial unique indexes, not plain Prisma `@unique` fields.
- Verified false/stale: `Order.platformFeeCents` is not a persisted column in current schema, and `tests/round10-state-machine-guardrails.test.mjs` exists.
- Guardrail coverage: `tests/email-delivery-guardrails.test.mjs`, `tests/schema-numeric-index-guardrails.test.mjs`, and `tests/schema-retention-guardrails.test.mjs`.

## Admin Audit Durability Pass (2026-05-24)

- Added strict transactional admin audit logging via `logAdminActionOrThrow({ client: tx, ... })` while preserving best-effort `logAdminAction()` for non-blocking evidence.
- Co-committed audit rows with listing removal/review, admin order review actions, support/report resolution, admin review deletion, blog/broadcast deletes, and Guild verification state changes.
- BAN undo now fails closed for legacy or malformed `BAN_USER` audit rows without `metadata.appliedBannedAt`; staff should use the explicit unban workflow for manual current-state unbans.
- Guardrail coverage: `tests/admin-audit-durability.test.mjs`, `tests/admin-moderation-observability.test.mjs`, `tests/admin-action-guardrails.test.mjs`, `tests/admin-audit-undo-state.test.mjs`, `tests/ban-side-effect-guardrails.test.mjs`, and `tests/ban-audit-metadata.test.mjs`.

## Ban Open-Order Review Update Pass (2026-05-24)

- Replaced the per-order `tx.order.update()` loop in `banUser()` with a chunked `UPDATE ... FROM (VALUES ...)` that applies per-order review notes inside the ban transaction.
- The bulk update guards on each order's captured `reviewNeeded` and `reviewNote`, using `IS NOT DISTINCT FROM` so concurrent staff note edits are not overwritten.
- Guardrail coverage: `tests/ban-side-effect-guardrails.test.mjs`, `tests/ban-order-review-state.test.mjs`, `tests/ban-audit-metadata.test.mjs`, and `tests/ban-side-effect-repair.test.mjs`.

## Security + Financial Audit Fixes (2026-04-23)

### Review fulfillment gate
- `POST /api/reviews` now requires `fulfillmentStatus IN (DELIVERED, PICKED_UP)` on the order. Prevents reviews before the item arrives.

### Double-refund guard
- `POST /api/cases/[id]/resolve` checks `order.sellerRefundId` before issuing Stripe refund. Returns 400 if seller already refunded. Prevents seller refund + admin case resolve double-dip.

### Case creation blocks refunded orders
- `POST /api/cases` checks `order.sellerRefundId`. Returns 400 if refund already issued. Prevents opening cases on already-refunded orders.

### Photo URL R2 origin validation
- `POST /api/listings/[id]/photos` Zod schema: `z.string().url().refine(u => u.startsWith(R2_ORIGIN))`. Blocks SSRF via arbitrary URLs forwarded to OpenAI's image fetcher. Uses `CLOUDFLARE_R2_PUBLIC_URL` env var.

### Audit logging additions
- **Case resolve**: `logAdminAction({ action: "RESOLVE_CASE" })` with resolution type + refund amount
- **Admin email**: `logAdminAction({ action: "SEND_EMAIL" })` with recipient + subject

### sendMessage rate limit
- `sendMessage` server action in `messages/[id]/page.tsx` now uses `messageRatelimit` (30/60s). Prevents message spam.

### Stripe processing fee absorbed by platform
- `checkout-seller` and `checkout/single` transfer `preTaxTotal - platformFee` to the seller.
- Formula: `sellerTransferAmount = itemsSubtotal + shipping + giftWrap - platformFee`.
- Platform absorbs Stripe processing fees from the 5% platform fee; sellers are not charged an estimated processor fee in transfer math.
- `Math.max(1)` floor prevents negative/zero transfers.

## Audit Hardening Pass (2026-04-23)

### Blog post rate limit
- `blogCreateRatelimit` in `src/lib/ratelimit.ts`: 3 posts per 24h per author, sliding window
- Wired in `dashboard/blog/new/page.tsx` `createBlogPost` server action

### AI duplicate title normalization
- `normalizeTitle()` in `ai-review.ts`: lowercase, strip punctuation/emoji, collapse whitespace
- "Walnut Bowl." and "walnut bowl" now match as duplicates
- Uses `findMany` + JS filter (was `prisma.count` with `mode: 'insensitive'` which couldn't normalize punctuation)

### Fulfillment method guard
- `api/orders/[id]/fulfillment/route.ts`: blocks `ready_for_pickup` and `picked_up` actions when `fulfillmentMethod === "SHIPPING"`
- Prevents shipping orders from being incorrectly marked as pickup

### Case auto-close cron
- **`GET /api/cron/case-auto-close`** — daily at 7am UTC (`vercel.json`)
- PENDING_CLOSE cases older than 7 days → RESOLVED (DISMISSED)
- OPEN cases where `sellerRespondBy` passed 14+ days ago → UNDER_REVIEW (escalated for admin)
- CRON_SECRET auth (same pattern as other crons)

### Seller refund notification
- `api/orders/[id]/refund/route.ts`: notification title changed from "Refund issued" to "Refund from maker" — distinguishes from admin case resolution notifications

### Image URL R2 origin enforcement
- `api/seller/broadcast/route.ts`: `imageUrl` Zod refine checks `startsWith(CLOUDFLARE_R2_PUBLIC_URL)`
- `api/reviews/route.ts`: `photoUrls` array elements validated against R2 origin
- `api/listings/[id]/photos/route.ts`: already done in previous commit

### AI alt text sanitization
- `ai-review.ts` `generateAltText()`: strips HTML tags from AI response (`replace(/<[^>]*>/g, "")`)
- `dashboard/listings/new/page.tsx` alt text backfill: applies `sanitizeText()` before saving

### Private listing cart guard
- `api/cart/add/route.ts`: blocks `isPrivate && reservedForUserId !== me.id` — private/custom listings can only be added by the reserved buyer

### MADE_TO_ORDER quantity cap
- `api/cart/add/route.ts`: `listingType === "MADE_TO_ORDER" && quantity > 1` → 400 error. Made-to-order items limited to 1 per add-to-cart (seller makes each one individually)

## Final Audit Cleanup (2026-04-23)

### Mass-report detection
- Admin reports page (`admin/reports/page.tsx`): "Top reporters (last 30 days)" section shown when any user has 3+ reports
- `prisma.userReport.groupBy` by reporterId with count, top 5
- Color-coded badges: 10+ reports red, 5+ amber, 3+ neutral

### YouTube shorts/embed regex
- `blog/[slug]/page.tsx` `extractVideoId()`: regex updated to support `/shorts/`, `/embed/`, `/v/` paths (was only `/watch?v=` and `youtu.be/`). Vimeo also supports `/video/` prefix.

### Carrier preferred filter — exact match
- `api/shipping/quote/route.ts`: changed from `carrier.includes(pc)` (substring) to `carrier === pc || carrier.startsWith(pc + " ")` (exact match with space-delimited service name). Prevents theoretical false positives.

### Admin undo race — atomic lock
- `src/lib/audit.ts` `undoAdminAction()`: `updateMany({ where: { id, undone: false } })` as atomic lock at function start. If the update affects 0 rows, throws "Already undone (concurrent request)". Removed duplicate `update` call that was setting the same fields after the undo action.

### Items assessed as not bugs
- **SearchBar race**: already calls `setOpen(false)` before `router.push` on both Enter and form submit. Not a bug.
- **Quality score totalOrders**: already filters `WHERE il.status = 'ACTIVE' AND il."isPrivate" = false`. Not a bug.
- **Cart reservation DoS**: `checkoutRatelimit` (10/60s per user) + Cloudflare DDoS protection + 31-min session expiry provides adequate defense. Multi-account coordinated attacks require Cloudflare WAF ($20/mo) — not worth it pre-launch.

## Comprehensive Audit Fix Pass (2026-04-23)

17 fixes across critical, week-1, and low-priority categories. Zero TypeScript errors.

### Critical fixes (1-6)

**1. Webhook variant collision** — `paidItemMap` in `stripe/webhook/route.ts` changed from `Map<string, {qty,price}>` to `Map<string, {qty,price}[]>`. Multiple variants of the same listing now create separate entries. OrderItem creation uses `.shift()` to match cart items to Stripe line items in order.

**2. Stock leak on variant validation** — `checkout/single/route.ts`: variant price calculation + group validation + inStock checks moved BEFORE stock reservation. Previously: reserve stock → validate variants → return 400 (stock never restored). Now: validate variants → reserve stock → create Stripe session. Follows the documented invariant "All return-400 paths must be above stock reservation."

**3. Listing hard delete → soft delete** — Both `dashboard/page.tsx` `deleteListing` and `seller/[id]/shop/actions.ts` `deleteListingAction` changed from `prisma.listing.delete()` to `prisma.listing.update({ status: HIDDEN, isPrivate: true })`. Preserves OrderItem references and order history (7-year retention requirement).

**4. Case resolve sets Order.sellerRefundId** — `cases/[id]/resolve/route.ts` transaction now writes `sellerRefundId` and `sellerRefundAmountCents` to Order when a refund is issued. Prevents seller from issuing a duplicate refund via the separate refund API (which only checks `Order.sellerRefundId`).

**5. Variant validation in checkout/single** — Server-side validation matching `cart/add` logic: requires exactly one option per variant group, checks `inStock` per option, rejects invalid option IDs. Prevents client-side bypass of variant requirements.

**6. publishListingAction fail closed** — `seller/[id]/shop/actions.ts` catch block changed from `status: "ACTIVE"` to `status: "PENDING_REVIEW"`. AI review errors now send listings to admin queue instead of publishing them.

### Week-1 fixes (7-12)

**7. MTO quantity cap on upsert** — `cart/add/route.ts` upsert update uses `{ quantity: 1 }` for MADE_TO_ORDER listings (was `{ increment: quantity }`). Prevents accumulation past 1 via repeated add-to-cart.

**8. Cart UI sends cartItemId** — `cart/page.tsx` `setQuantity` and remove buttons now use `item.id` (cartItemId) instead of `item.listing.id` (listingId). Fixes wrong-row updates when multiple variants of the same listing are in cart.

**9. Custom-order block check** — `api/messages/custom-order-request/route.ts` now queries `Block` table before sending. Blocked users can't send custom order requests.

**10. Upload presign rate limit** — `api/upload/presign/route.ts` now rate-limited to 30 uploads per 10 minutes per user. Prevents R2 bucket abuse.

**11. Metadata priceCents fix** — `checkout/single` Stripe session metadata now stores `unitPriceCents` (variant-adjusted) instead of `listing.priceCents` (base). Webhook reads from Stripe line items anyway, but metadata now matches.

**12. Banned user check in ensureUserByClerkId** — `src/lib/ensureUser.ts` `ensureUserByClerkId` now throws on `banned=true`, matching `ensureUser` behavior. Closes the gap where banned users with active sessions could call checkout/cart APIs.

### Low-priority fixes (13-17)

**13. R2 origin on create listing** — `dashboard/listings/new/page.tsx` filters `imageUrls` by `CLOUDFLARE_R2_PUBLIC_URL` prefix after parsing. Blocks injection of non-R2 URLs via crafted form POST.

**14. Soft-delete state machine** — `unhideListingAction` blocks unhiding of soft-deleted listings (`isPrivate: true` + `HIDDEN` status). Sellers can't resurrect deleted listings via the unhide button.

**15. Admin PIN httpOnly cookie** — `api/admin/verify-pin/route.ts` now sets a 4-hour `httpOnly`, `secure`, `sameSite: strict` cookie on successful PIN verification. Provides server-side enforcement beyond the client-side sessionStorage check.

**16. ESLint config** — Added `.claude/**`, `prisma/seeds/**`, `scripts/**` to ignores. Stops lint from scanning worktrees and build-only scripts.

**17. CI lint step** — `.github/workflows/ci.yml` now runs `npx next lint` (continue-on-error) after tsc. Catches lint issues in PRs.

## Codex Audit Fix Takeover (2026-04-24)

This pass corrected incomplete fixes from the prior audit implementation and tightened the invariants around admin access, listing visibility, variant pricing, stock reservation, and seller shipping money fields.

### Admin PIN is now server-enforced
- Added `src/lib/adminPin.ts` for signed, short-lived, user-bound `httpOnly` cookie creation/verification.
- `src/app/admin/layout.tsx` now verifies the signed cookie before rendering admin sidebar counts or child pages. Without a valid cookie, only `AdminPinGate` renders.
- `src/middleware.ts` now protects `/api/admin/*` with the same signed cookie, except `/api/admin/verify-pin`.
- `/api/admin/verify-pin` now allows EMPLOYEE and ADMIN consistently with the admin layout, sets the signed cookie on success, and fails closed in production if `ADMIN_PIN` is missing.
- `AdminPinGate` no longer trusts `sessionStorage`; it posts the PIN, receives the server cookie, then reloads for server-side verification.

### Variant validation and checkout pricing
- Added `src/lib/listingVariants.ts` shared resolver. It requires exactly one option per group, rejects duplicate option IDs, rejects invalid options, checks `inStock`, calculates total adjustment, and returns a normalized `variantKey` plus display/snapshot data.
- `POST /api/cart/add`, `POST /api/cart/checkout/single`, and `POST /api/cart/checkout-seller` all use the shared resolver.
- Cart checkout no longer trusts stale `CartItem.priceCents`; it recalculates each item's live server-side `unitPriceCents` from listing base price + selected variant adjustments immediately before creating the Stripe session.
- Stripe cart line item metadata now includes `cartItemId` and `variantKey`; the webhook matches paid line items by `cartItemId`, then `listingId+variantKey`, then listing-only legacy fallback.
- Cart queries and webhook cart reads order items by `createdAt` for deterministic legacy fallback behavior.

### Stock reservation ordering
- In both checkout paths, all validation-return paths (variant validation, stale price validation, low effective payout validation, shipping token validation) now occur before stock reservation.
- After stock is reserved, later failures should throw and hit the catch block so reservations are restored.
- `POST /api/cart/update` also enforces MADE_TO_ORDER quantity <= 1, and single checkout rejects MADE_TO_ORDER quantity > 1.

### Listing visibility policy
- Added `src/lib/listingVisibility.ts`.
- `publicListingWhere()` is now used by browse, seller profile, seller shop, sitemap, similar listings, and recently viewed listings.
- Listing detail uses `canViewListingDetail()` so direct URLs cannot render non-public listings unless the viewer is the owner, valid preview owner, or the reserved buyer for a private custom listing.
- Listing metadata uses `isPublicListing()` and returns `noindex` for non-public listings.

### Seller shipping money fields
- Completed Float → Int migration for `SellerProfile.shippingFlatRate` and `freeShippingOver`:
  - Schema fields are now `shippingFlatRateCents Int?` and `freeShippingOverCents Int?`.
  - Migration `20260424120000_seller_shipping_cents` copies existing dollar floats to cents, then drops old float columns.
  - Seller dashboard still accepts dollar inputs but stores cents.
  - `GET /api/cart` now reads cents fields and returns existing dollar-shaped response fields for UI compatibility.

### Verification
- `npx prisma validate` passed.
- `npx prisma generate` passed.
- `npx tsc --noEmit --incremental false` passed.
- Targeted ESLint on all touched files passed with 0 errors.
- Superseded by the 2026-04-24 stabilization pass: full `npm run lint` now exits 0 with warnings.

## Opus 4.7 Audit Compliance Pass (2026-04-24)

### CAN-SPAM compliance
- **`/unsubscribe` route** — `src/app/unsubscribe/page.tsx`: redirects signed-in users to `/account/settings`, shows sign-in prompt for signed-out. Added to `isPublic` in middleware. Fixes the 404 that every email footer linked to.
- **Physical mailing address** in email footer: "5900 Balcones Drive STE 100, Austin, TX 78731" — required by CAN-SPAM §316.5(c)(1).
- **`List-Unsubscribe` + `List-Unsubscribe-Post` headers** on all outbound emails via Resend `headers` option. Gmail/Yahoo bulk-sender rule compliance (Feb 2024).

### Data retention (Order cascade fix)
- **`Order.buyerId` changed from `String` to `String?`** with `onDelete: SetNull` (was `Cascade`). Deleting a User no longer cascades-deletes their Orders. Tax/IRS 7-year retention preserved.
- Migration: `20260424_add_performance_indexes_v2` — drops NOT NULL, recreates FK with SET NULL.
- 9 files updated with optional chaining (`order.buyer?.name`) and null guards. Display shows "Deleted user" fallback.

### Stripe webhook observability
- `Sentry.captureException` added to main error handler + signature verification failure in `stripe/webhook/route.ts`. Webhook errors now appear in Sentry dashboard.

### Performance indexes (same migration)
- `Listing.priceCents` — browse price-sort queries
- `Message(conversationId, createdAt)` — compound index for thread loading
- `Review(listingId, createdAt)` — compound index for review sort
- `Order.stripePaymentIntentId` — unique index for webhook/refund lookups

### Accessibility
- **Skip-to-content link** in `layout.tsx`: `sr-only` by default, visible on keyboard focus (`focus:not-sr-only`). Points to `#main-content` wrapper.
- **`prefers-reduced-motion`** in `globals.css`: all animations disabled (`animation: none !important`), all transitions set to `0.01ms` duration. Covers hero mosaic scroll, slide-in, slide-up, pulse skeletons.

### Remaining items from Opus 4.7 audit (not yet implemented)
- ✅ **Clickwrap/age-gate server enforcement** — `/sign-up` still captures Terms/Privacy acceptance for normal signups, and middleware now enforces `User.termsAcceptedAt` + current `termsVersion` + `ageAttestedAt` for every signed-in account. OAuth/back-button and webhook-created users without durable DB acceptance are redirected to `/accept-terms` before account features are available. Attorney still reviews final legal wording.
- ~~**Age gate checkbox**~~ — DONE as technical implementation: `/sign-up` requires 18+ attestation and stores `ageAttestedAt`.
- ~~**Account deletion flow**~~ — DONE: `/api/account/delete`, account settings UI, cascade-aware anonymization, and Clerk `user.deleted` webhook handling.
- ~~**EXIF stripping from uploads**~~ — DONE for JPEG/PNG/WebP: server-side `sharp` pipeline strips metadata before R2 storage. GIF/video/PDF may retain metadata and Privacy discloses that.
- ~~**OpenAI image sharing disclosure**~~ — DONE: Privacy Policy discloses listing images may be sent to OpenAI for content review and alt text.
- **Money transmitter licensing** — attorney sign-off on Stripe Connect exemption
- **INFORM Consumers Act** — attorney scope for high-volume seller disclosures
- ~~**Accessibility statement page**~~ — DONE (`/accessibility` page deployed)
- ~~**Bounce/complaint webhook from Resend**~~ — DONE: `/api/resend/webhook` verifies Resend/Svix signatures and suppresses bounced/complaining recipients.
- ~~**Deep health check**~~ — DONE (`/api/health` checks DB + Redis, returns 503 on failure)
- ~~**Toast system replacing alert()**~~ — DONE: existing toast system + `emitToast()` are used for former alert paths.
- ~~**autoComplete attributes on forms**~~ — DONE: seller/profile/onboarding/shipping/commission forms have appropriate autocomplete hints or explicit opt-outs.
- ~~**Webhook/fire-and-forget patterns**~~ — DONE for the audited server-action/API paths: fan-out work now uses `after()` or is awaited/batched.

### Additional fixes from Opus 4.7 audit (2026-04-24)

**Observability:**
- All 4 cron routes now have `Sentry.captureException` on errors (guild-metrics, guild-member-check, quality-score, case-auto-close)
- `quality-score` + `case-auto-close` crons: added `maxDuration` (300s and 60s)
- `/api/health`: deep check with `SELECT 1` (DB) + `redis.ping()` (Upstash), returns 503 on failure
- Email send errors: `Sentry.captureException` with source tag + recipient metadata

**Security:**
- Commission reference image URLs: R2 origin validation
- Block action deletes reciprocal Follow rows (both directions) — prevents orphaned follower counts

**SEO:**
- Sitemap listings: filtered by `seller.chargesEnabled + vacationMode:false + user.banned:false`
- Sitemap sellers: filtered by `chargesEnabled + vacationMode:false + banned:false + has active listings`

**Email:**
- `shouldSendEmail`: checks `user.banned` — banned users don't receive non-transactional emails

**Compliance:**
- `/accessibility` page: WCAG 2.1 AA statement with known limitations + feedback channel. In footer + public middleware.

**Financial:**
- Sub-$1 payout block: both checkout routes reject orders where `preTaxTotal - fees < $1` (100 cents)
- Label purchase: blocked on refunded orders (`sellerRefundId` check) and pickup orders (`fulfillmentMethod` check)

**Schema:**
- Migration timestamp note: `20260423_add_listing_variants` remains under its original directory name because that name was already applied in production. Do not rename applied migration directories; future migrations should use full timestamps before first deploy.

### Remaining items requiring attorney/business decisions
- Clickwrap legal wording/enforceability review (attorney)
- Age/COPPA wording review (attorney)
- Money transmitter licensing (attorney)
- INFORM Consumers Act implementation (attorney)
- OpenAI image/AI processing Privacy Policy wording review (attorney)

### Remaining items requiring significant code work
- ~~Account deletion flow (cascade-aware, Clerk webhook, GDPR Art. 17)~~ — DONE in lifecycle compliance pass
- ~~EXIF stripping from uploaded photos (R2 worker or sharp)~~ — DONE for JPEG/PNG/WebP via `/api/upload/image`
- ~~Toast system replacing ~20 alert() calls~~ — DONE
- ~~autoComplete attributes on forms~~ — DONE
- ~~Webhook fire-and-forget → waitUntil() or outbox pattern~~ — DONE for audited fan-out paths; outbox remains a future scale refactor, not a launch blocker.
- ~~Money fields Float→Int migration (shippingFlatRate, freeShippingOver)~~ — DONE in `20260424120000_seller_shipping_cents`
- Lightbox focus trap + dialog role
- Photo drag touch events for mobile
- Browse pagination canonical URLs
- Sitemap index for >2000 listings
- LocalDate/DismissibleBanner hydration mismatch fixes
- EventSource reconnect on error
- Case status human-readable labels in UI
- "Verified Maker" → "Guild Member" in 2 email templates

## Stabilization Pass (2026-04-24)

Small cleanup pass before continuing the larger Opus audit backlog. Goal: make the repo easier and safer for future agents and deployment work without changing product behavior.

### Lint and framework tooling
- `eslint-config-next` updated from 15.5.15 to 16.2.4 to match Next.js 16.2.4.
- `eslint.config.mjs` now imports Next's native flat configs (`eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`) instead of using the old `FlatCompat` bridge.
- Next 16 enables several React Compiler-oriented rules as errors by default. These are disabled for now (`react-hooks/immutability`, `react-hooks/purity`, `react-hooks/set-state-in-effect`, `react-hooks/static-components`) because the existing app has many stable client-effect patterns that should be migrated deliberately, not churned during unrelated fixes.
- Full `npm run lint` now exits 0. Remaining lint output is 30 warnings only.
- Fixed the previous blocking lint errors by replacing internal `<a>` navigation with `next/link` and escaping JSX quotes/apostrophes. Also ran ESLint's safe autofix to remove stale disable comments.

### Documentation and launch operations
- `README.md` replaced the create-next-app boilerplate with Grainline-specific setup, verification, migration, and deployment instructions.
- `.env.example` expanded from one variable to the full known env surface used by the app.
- Added `docs/launch-checklist.md` covering production env vars, vendor setup, Prisma deploy, Vercel deploy, and smoke tests.
- Corrected stale docs that still described `/api/health` as static. It is now a dynamic deep health check for DB + Upstash Redis and returns 503 on dependency failure.
- Corrected stale business checklist entries: Texas marketplace facilitator registration is complete, and the single-member operating agreement is not a launch blocker for the current launch plan.

### Verification
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint` passed with 30 warnings and 0 errors.
- `npm run build` passed outside the sandbox. The sandboxed build failed first due a Turbopack internal-process port bind restriction (`Operation not permitted`), not a code error.

## Lifecycle Compliance + Upload Privacy Pass (2026-04-24)

Focused launch-blocker pass after reconciling the 300-item Opus audit against already-applied Claude/Codex changes. Scope was limited to code-safe, non-attorney-dependent fixes that were still real in the repo.

### User lifecycle and deletion
- Added `User.deletedAt`, `termsAcceptedAt`, `termsVersion`, `ageAttestedAt`, and `welcomeEmailSentAt`.
- Migration: `20260424153000_user_lifecycle_compliance`.
- `/sign-up` now gates Clerk account creation behind two explicit checkboxes: Terms/Privacy acceptance and 18+ age attestation. Acceptance metadata is sent to Clerk `unsafeMetadata`.
- `ensureUser()` and the Clerk webhook copy Clerk legal/unsafe metadata into the DB, so acceptance stamps are stored even if the first DB touch happens outside the webhook.
- Clerk webhook now handles `user.deleted` by anonymizing the Grainline DB account instead of ignoring the event.
- Welcome email sends are idempotent via `welcomeEmailSentAt`, preventing duplicate welcome emails on Clerk webhook retries.
- New `/api/account/delete` self-service deletion route:
  - Requires the signed-in user.
  - Blocks deletion while buyer orders, seller orders, cases, or buyer commission requests are still active.
  - Anonymizes account profile/shipping fields, clears notification preferences, removes saved searches/favorites/follows/blocks/cart/notifications, deactivates newsletter subscription, hides seller listings, disables seller commerce, scrubs seller profile PII, then deletes the Clerk user.
- Account settings now include a "Delete account" section with a typed `DELETE` confirmation and blocker display.
- `Order.buyerId` remains retained/set-null capable; order/tax/refund/dispute records are not hard-deleted.

### Upload privacy / EXIF stripping
- Added `/api/upload/image` (Node runtime, `sharp`) for JPEG/PNG/WebP uploads. It rotates by orientation and writes a re-encoded image to R2 without embedded metadata.
- `useR2Upload` routes JPEG/PNG/WebP image uploads through `/api/upload/image`; video/PDF use presigned direct upload followed by `/api/upload/verify` HEAD validation. GIF uploads are rejected until an animated-image sanitization path exists.
- `/api/upload/presign` now rejects JPEG/PNG/WebP direct presigns so crafted clients cannot bypass the metadata-stripping path.
- Blog editor image upload uses the processed image route for JPEG/PNG/WebP and rejects GIF uploads.
- Upload routes now enforce the banned-user guard through `ensureUserByClerkId`.
- Shared `uploadRatelimit` added instead of constructing a limiter inside the route on every request.

### Email and privacy alignment
- Privacy Policy updated from UploadThing to Cloudflare R2 and now discloses OpenAI image processing for listing review/alt text.
- Photo metadata section now matches implementation: JPEG/PNG/WebP metadata is stripped; GIF uploads are rejected; video/PDF metadata may remain.
- Transactional email wrapper now sends a plain-text alternative, strips CRLF/control characters from subjects, and only embeds followed-maker listing images from the configured R2 public URL.
- Admin email route now strips CRLF/control characters from subject, includes a plain-text alternative, includes physical mailing address, and sets List-Unsubscribe headers.

### Abuse and access hardening
- Checkout success page now requires a signed-in buyer and verifies `session_id` ownership against `Order.buyerId` or Stripe session `metadata.buyerId` before rendering receipt details or fallback-creating an order.
- Saved searches are rate-limited, capped at 25 per user, normalized, deduped, and reject min-price greater than max-price.
- Review helpful votes are rate-limited, use `ensureUser()`, and perform the toggle read/write inside the transaction with a P2002 fallback.
- Block/unblock is rate-limited and POST validates the target user exists and is not deleted.
- Vacation-mode updates are rate-limited.

### Verification
- `npx prisma generate` passed after schema update.
- `npx tsc --noEmit --incremental false` passed after this implementation pass.
- `npx prisma validate` passed.
- `npm run lint` passed with 29 warnings and 0 errors.
- `npm run build` passed outside the sandbox. The sandboxed build failed first due Turbopack's internal worker port bind restriction (`Operation not permitted`), not a code error.
- `DOTENV_CONFIG_PATH=.env node -r dotenv/config ./node_modules/.bin/prisma migrate deploy` applied `20260424153000_user_lifecycle_compliance` successfully.

## Opus Round 4 Actionable Fix Pass (2026-04-24)

Follow-up implementation pass for the Opus Round 4 findings after auditing each item against the current repo. Scope focused on launch-blocker and high/medium-priority items that were still real in code. No Prisma schema migration was required.

### Checkout/session safety
- Added a Redis-backed checkout session lock (`src/lib/checkoutSessionLock.ts`) for cart and single-listing checkout.
- Checkout locks are scoped to buyer/cart or buyer/listing and include a request payload hash so a stale session cannot be reused for a changed cart, address, shipping method, or rate.
- Matching in-progress sessions return HTTP 409; matching ready sessions return the existing Stripe `clientSecret` instead of reserving stock again.
- Stripe session metadata includes `checkoutLockKey`; the webhook releases locks on paid completion, expired checkout sessions, empty-cart fallback paths, and existing-order edge cases.
- Ready-state writes are compare-and-set guarded on the existing `preparing` lock and payload hash. A stale worker cannot overwrite a newer checkout attempt after the lock changes.
- Webhook lock release is session-bound after Stripe session creation. Completed/expired events for an old Stripe session cannot delete a newer checkout lock that reused the same buyer/cart or buyer/listing key.
- Existing atomic stock decrement remains the final oversell guard.

### Deferred side effects
- Replaced remaining `void (async () => ...)()` fire-and-forget patterns with Next.js `after()` in listing publish/unhide/availability paths, dashboard listing deletion, listing/blog creation and edit fan-out, seller broadcasts, stock back-in-stock notifications, and commission interest notifications.
- Deferred blocks keep request latency down while letting Next/Vercel track the work after the response.

### Listing deletion cleanup
- Added `softDeleteListingWithCleanup()` in `src/lib/listingSoftDelete.ts`.
- Seller/dashboard listing deletion now hides and privatizes listings while deleting related `Favorite`, `StockNotification`, and `CartItem` rows so saved items and carts do not retain broken soft-deleted listings.
- Order history remains preserved through `OrderItem` snapshots and listing references.

### UI polish and accessibility
- Added `public/og-image.jpg` (1200x630) and wired layout/blog metadata fallbacks so social shares no longer reference a missing image.
- Added a production service worker (`public/sw.js`) plus `ServiceWorkerRegister` for the existing PWA manifest/offline page. Navigation requests fall back to `/offline`; authenticated content is not broadly cached.
- Header main nav now has `aria-label="Main navigation"`.
- Shipping, seller onboarding/settings, profile, and commission forms now include appropriate `autoComplete` hints or explicitly opt out for non-personal fields.
- User-facing case badges use `caseStatusLabel()` instead of raw enum strings like `PENDING_CLOSE`.
- Replaced remaining `alert()` calls with the existing toast system; upload callbacks use a global `emitToast()` helper when hooks are unavailable.

### Social URL and commission lifecycle
- Seller social/profile URLs are normalized server-side, require `https://`, and use platform host allowlists for Instagram/Facebook/Pinterest/TikTok.
- Commission requests now get a 90-day `expiresAt`, open commission queries filter expired rows, expired detail/API reads return 404, and new seller interest is blocked after expiry.
- Added `/api/cron/commission-expire` and a Vercel cron entry to mark expired open commission requests as `EXPIRED`.

### Rate limits and performance
- Added shared authenticated mutation rate limiters for cart changes, case actions, and listing mutations.
- Applied rate limits to cart add/update, case escalate/mark-resolved, listing stock updates, and listing photo uploads.
- Batched quality-score listing updates into one raw SQL `UPDATE ... FROM (VALUES ...)` per batch instead of one update per listing.
- Documented that quality-score base weights sum to 1.0 but discovery bumps can intentionally raise the final score up to 1.20 before normalization/clamping decisions.
- Batched Stripe webhook low-stock checks with one `findMany` instead of one query per order item.

### Cart and sitemap behavior
- Cart API now computes the live listing/variant price and flags `priceChanged` when the stored cart price is stale.
- Cart UI displays the current price with an "Updated from" badge and uses live prices for displayed totals; checkout still performs server-side pricing validation.
- Sitemap listing/seller/blog/commission fetches now use the Google per-file limit of 50,000 URLs instead of silently dropping after 2,000, and commission sitemap entries exclude expired requests.
- The `/sitemap_index.xml` route at `src/app/sitemap_index.xml/route.ts` lists every chunk emitted by `generateSitemaps()`. Next.js reserves `/sitemap.xml` internally for the chunked metadata convention, so robots.txt advertises `/sitemap_index.xml` instead and crawlers follow it to discover all listing chunks.

### Onboarding resilience
- Seller onboarding server actions now return typed success/error results instead of throwing raw errors to the request boundary.
- Onboarding UI shows a friendly inline error and only advances steps after the server action succeeds.

### Verification
- `npx tsc --noEmit --incremental false` passed after the completed implementation pass.
- `npm run lint` passed after the completed implementation pass with 25 warnings and 0 errors.
- `npx prisma validate` passed after the completed implementation pass.
- `git diff --check` passed with no whitespace errors.
- `rg -n "void \(async" src/app src/components src/lib` returned no matches.
- `rg -n "alert\(" src/app src/components src/lib` returned only a security-comment example in `src/lib/json-ld.ts`, not a live browser alert.
- `public/og-image.jpg` verifies as a 1200x630 JPEG.
- Initial sandboxed `npm run build` failed because Turbopack could not bind its internal worker port under sandbox restrictions (`Operation not permitted`), not because of a TypeScript/application error.
- `npm run build` passed outside the sandbox after the implementation pass. The only build-time warnings were the existing middleware/proxy deprecation warning and pg SSL-mode advisory.

## Shipping / Label Integrity Hardening Pass (2026-04-24)

Focused continuation from the remaining 300-item audit backlog. Scope was limited to high-risk marketplace correctness around shipping quotes, label purchase, media URL validation, and stale signed checkout rates.

### Signed fallback shipping
- Removed the old client-side hardcoded `FALLBACK_RATE` path. Checkout no longer accepts an unsigned `objectId: "fallback"` payload.
- `/api/shipping/quote` now returns a signed fallback rate only after it has resolved the seller/listing context, package data, buyer postal code, and `SiteConfig.fallbackShippingCents`.
- Both checkout routes verify every selected shipping rate through `verifyRate()`, including fallback. Clients cannot force fallback shipping without a valid short-lived HMAC from `/api/shipping/quote`.
- Cart totals now treat signed fallback as a concrete quoted amount instead of showing "Calculated at checkout".
- `ShippingRateSelector` now fails closed on quote failure by clearing the selected rate and disabling checkout instead of silently selecting an unsigned fallback.

### Label purchase rate binding
- Added `OrderShippingRateQuote` with migration `20260424190000_order_shipping_rate_quotes`.
- Label re-quotes now persist the order-bound Shippo shipment id, the returned rate choices, and a 30-minute expiry.
- `/api/orders/[id]/label` only accepts caller-supplied `rateObjectId` values if they match the original fresh checkout rate or an unexpired persisted quote set for that exact order.
- Synthetic rates like `fallback` and `pickup` are explicitly rejected for label purchase.
- Expired quote rows for the order are cleaned opportunistically when a fresh label re-quote is created.

### Label purchase race and case guards
- Label purchase is blocked for refunded orders, pickup orders, terminal fulfillment states, and active cases (`OPEN`, `IN_DISCUSSION`, `PENDING_CLOSE`, `UNDER_REVIEW`).
- The label lock still uses `labelStatus = PURCHASED` before calling Shippo so concurrent requests cannot buy duplicate labels.
- If Shippo fails before purchase, the lock is reverted. If Shippo succeeds but a later DB write fails, the lock is intentionally left in place and the error is captured to Sentry, preventing duplicate label purchases at the cost of requiring manual/admin recovery.

### URL validation hardening
- Added `src/lib/urlValidation.ts` with origin-safe `isR2PublicUrl()` and `filterR2PublicUrls()` helpers.
- Replaced ad-hoc R2 `startsWith` write-path checks in listing photo upload, new listing creation, custom listing creation, reviews, commission reference images, and seller broadcasts.
- Custom listing photos now filter to valid R2 public URLs before create, matching normal listing behavior.

### Stale signed rate cleanup
- Buy Now checkout modal clears `selectedRate` on close. Re-open now forces a fresh quote instead of reusing an expired signed rate and failing HMAC verification.

### Verification
- `npx prisma generate` passed after schema update.
- `npx prisma validate` passed.
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint` passed with 25 warnings and 0 errors.
- `git diff --check` passed.
- `DOTENV_CONFIG_PATH=.env node -r dotenv/config ./node_modules/.bin/prisma migrate deploy` applied `20260424190000_order_shipping_rate_quotes` successfully to the configured Neon database.
- `npm run build` passed outside the sandbox. The only build-time warnings were the existing middleware/proxy deprecation warning and pg SSL-mode advisory.

## Round 4 Coverage Gap Fix Pass (2026-04-24)

Continuation of the 300-item audit backlog while Claude pass 5 was running. Scope was limited to no-migration fixes that were confirmed in the current repo and unlikely to conflict with concurrent work.

### Admin PIN and audit correctness
- Admin PIN enforcement now covers admin server-action POSTs to `/admin/*`, not only `/api/admin/*`. GET page loads still render the existing PIN gate, but mutating admin page POSTs require the signed httpOnly PIN cookie in middleware.
- Geo-blocking no longer relies on deprecated `request.geo`; middleware reads Vercel's `x-vercel-ip-country` header.
- `undoAdminAction()` now restores listing removals/holds to the `metadata.previousStatus` value when present instead of always restoring `ACTIVE`.
- Added audit log rows for `MARK_ORDER_REVIEWED`, `APPEND_ORDER_NOTE`, `DELETE_BROADCAST`, `APPROVE_BLOG_COMMENT`, and `DELETE_BLOG_COMMENT`.

### Security headers and runtime config
- Removed unused `https://cdnjs.cloudflare.com` from `script-src-elem`.
- Replaced broad `img-src https:` with explicit first-party/R2/CDN/Clerk/Stripe/map tile image origins.
- Added `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-site`.
- Added `maxDuration` and `preferredRegion = "iad1"` to Stripe webhook, Shippo quote, and checkout routes.
- Static legal pages (`/terms`, `/privacy`, `/accessibility`) now export `revalidate = 86400`.

### Notifications and messaging
- `NotificationBell` now covers every current Prisma `NotificationType`, including followed-maker listing/blog, seller broadcast, commission interest, and listing approval/rejection types.
- `createNotification()` now skips missing, banned, and soft-deleted users so suspended accounts do not continue accumulating bell notifications.
- Added a dedicated `messageStreamRatelimit` so SSE reconnects do not consume the normal message-send quota.
- Message SSE polling now starts immediately, then backs off from 3 seconds to 10 seconds when idle and to 15 seconds after errors instead of querying every second per connected user.
- Seller broadcast notification fan-out now runs in batches of 100 with `Promise.allSettled()` per batch instead of one unbounded `Promise.all()` over all followers.

### Seller analytics
- Seller analytics click-through rate now uses clicks divided by listing views; the previous implementation inverted the formula.
- Hourly view/click chart allocation now spreads daily aggregate counts evenly across elapsed buckets instead of dumping the remainder into the final hour.
- Dashboard labels now use "Gross Sales" where the amount is gross paid item revenue rather than net seller proceeds.

### Verification
- `npx tsc --noEmit` passed after the implementation pass.
- `npx tsc --noEmit --incremental false` passed.
- `npx prisma validate` passed.
- `git diff --check` passed.
- `npm run lint` passed with 25 warnings and 0 errors.
- Sandboxed `npm run build` hit the known Turbopack internal worker port restriction (`Operation not permitted`).
- `npm run build` passed outside the sandbox. The build confirmed `/terms`, `/privacy`, and `/accessibility` now show 1-day revalidation.

## Round 7 Deep Audit Hardening Pass (2026-04-24)

Continuation of the consolidated 475-finding Opus/Codex audit backlog. Scope focused on fixes that were still real after the prior Claude/Codex passes and were appropriate to implement before launch without waiting on attorney/vendor sign-off.

### Schema, retention, and webhook idempotency
- Added `StripeWebhookEvent` with begin/processed/failed helpers so retryable Stripe lifecycle events are idempotent.
- Added webhook handling for `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `charge.dispute.*`, and `payout.failed`.
- Narrowed the Stripe webhook `P2002` duplicate-session catch so unrelated unique-constraint bugs are no longer swallowed as duplicate webhooks.
- Removed duplicate cart cleanup outside the order-creation transaction.
- `account.updated` now considers `charges_enabled`, `payouts_enabled`, `details_submitted`, and disabled requirements before re-enabling a seller.
- Pinned retention-safe relation behavior: order item listing references are restricted, cases preserve order/user history, and user deletion cascades only through conversation/message/comment data where history loss is acceptable.
- Added unique schema coverage for Stripe payment intent and charge identifiers.

### Refund, label, and fulfillment correctness
- Seller refunds now use Stripe idempotency keys, keep the refund lock in place if the DB write fails after Stripe succeeds, capture orphaned-refund failures in Sentry, and restore stock with atomic increments.
- Staff case refunds now acquire the same atomic refund lock before calling Stripe and use an idempotency key.
- Label purchase locks now require the order to still be `PENDING` and not refunded, blocking label/refund and label/manual-fulfillment races.
- Fulfillment updates are rate-limited, block active cases/refunded orders, validate carrier/tracking input, and enforce shipping-vs-pickup state transitions.

### Marketplace visibility, abuse, and moderation
- Homepage, search suggestions, popular tags, popular blog tags, blog listings, and commission detail views now consistently exclude banned/deleted/vacation/charges-disabled sellers or banned/deleted authors where appropriate.
- Seller broadcasts now require an active seller account and reject banned/deleted users.
- Blog publishing now fails closed when the profanity check flags a published post.
- Blog comments reject banned/deleted authors, sanitize stored text, and hide comments/replies by banned/deleted authors.
- User reports now validate `MESSAGE_THREAD` and `BLOG_COMMENT` targets instead of accepting arbitrary target ids.
- Upload endpoints now require a seller profile for seller-owned media endpoints and return validation issue details for invalid presign requests.
- Soft-deleting a listing now blocks when active orders or active cases exist.

### Guild metrics and quality scoring
- Seller metrics now use a fixed day window instead of calendar-month rollover and exclude refunded orders from delivered/sales calculations.
- Empty on-time shipping and response-rate datasets now evaluate to 0 instead of vacuous 100%.
- Guild metric crons skip vacation sellers; the member-check cron no longer revokes Guild Masters directly.
- Admin Guild Member/Master approvals re-check eligibility server-side, notify on manual revokes, and reset metric-failure state on revoke/reinstate.
- Quality score calculations now exclude refunded orders and ineligible/banned/deleted/vacation/charges-disabled sellers, and the new-seller bonus is gated to sellers under 30 days old.

### UI, mobile, and lint cleanup
- Header mobile drawer now declares dialog semantics and focuses on open.
- Notification and report menus now expose menu state to assistive tech; report dropdown closes on Escape.
- Hero mosaic respects reduced motion; card hover zoom is limited to motion-safe devices.
- Favorite buttons now meet the 44px tap target.
- Message/review client ids fall back cleanly on older Safari without `crypto.randomUUID`.
- Search debounce clears on unmount.
- ZIP+4 input is accepted by the shipping form.
- Service worker no longer calls `skipWaiting()`/`clients.claim()`, reducing mid-checkout takeover risk.
- Straightforward unused-symbol lint warnings were removed; lint is down to 11 warnings / 0 errors.

### Verification
- `npx prisma validate` passed.
- `npx prisma generate` passed.
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint` passed with 11 warnings and 0 errors.
- Escalated `npm run build` passed.
- `npx dotenv-cli -e .env -- npx prisma migrate deploy` applied `20260424194500_webhook_idempotency_retention_constraints`.
- Sandboxed `npm run build` hit the known Turbopack local-port restriction; escalated `npm run build` passed.

## Round 7 Continuation Cleanup Pass (2026-04-24)

Second continuation pass after deploying `60a5957`, focused on smaller but still real audit backlog items that were safe to fix without product redesign.

### Dev and destructive-operation guards
- `prisma/seed.ts` now refuses to run unless non-production and `ALLOW_DESTRUCTIVE_SEED=true`, preventing accidental destructive seeding against a real database from local shells.
- `prisma/seed-bulk.ts` now requires `ALLOW_BULK_SEED=true`.
- `/api/dev/make-order` is now disabled unless running local non-Vercel development with `ENABLE_DEV_MAKE_ORDER=true`; preview/staging/prod deployments return 404.
- `/api/whoami` now returns 404 outside local development.
- `.env.example` documents `DIRECT_URL` and the local-only helper flags.

### Account-state and moderation edges
- Custom-order requests, commission creation, commission interest, and blog create/edit now reject soft-deleted users in addition to banned users.
- Commission interest now hides requests from banned/deleted buyers even if the request id is hit directly.
- Blog republishing from draft/archive to published is rate-limited with the same daily publish budget as new posts.
- Blog slug generation now fails after 100 collisions instead of looping indefinitely.
- `shouldSendEmail()` now also suppresses email for soft-deleted users.
- Case escalation via cron now uses the shared timing-safe `verifyCronRequest()` helper instead of direct string comparison.

### Report audit trail
- Added `UserReport.resolvedAt` and `resolvedById` plus a `resolvedBy` relation and index.
- Admin report resolution now stores the resolving admin and timestamp, in addition to the existing `RESOLVE_REPORT` admin audit log.

### Verification
- `npx prisma validate` passed.
- `npx prisma generate` passed.
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint` passed with 11 warnings and 0 errors.
- `npx dotenv-cli -e .env -- npx prisma migrate deploy` applied `20260424201500_user_report_resolution_metadata`.

## Round 7 Continuation Cleanup Pass 2 (2026-04-24)

Third continuation pass on the 475-finding audit backlog. Scope focused on high-confidence hardening and cleanup that did not require risky product redesign or another schema migration.

### Cart and checkout availability
- Cart add/update now block sellers that are banned, soft-deleted, vacationing, charges-disabled, or missing a Stripe account before cart state changes.
- Cart add now checks the existing cart item quantity before incrementing so repeated adds cannot exceed live stock or cart quantity limits.
- Cart update now revalidates listing status, private reservation ownership, seller availability, made-to-order quantity, and live stock before changing quantity.
- Cart and single checkout routes now explicitly block banned/soft-deleted seller accounts and reject out-of-stock `IN_STOCK` items before attempting stock reservation.
- Cart API now returns `sellerUnavailable`; the cart review step blocks unavailable sellers instead of letting buyers proceed to checkout errors.
- Cart checkout state now restores the shipping address and active checkout sessions from session storage on refresh; signed shipping rates are restored only if their token has not expired.
- Changing address or cart quantity clears signed shipping rates and checkout sessions so stale HMAC tokens are not reused.
- Buy Now checkout clears selected shipping rate/client secret whenever the address is changed from either address-navigation path.

### Public visibility and deleted-account consistency
- `publicListingWhere()`, `isPublicListing()`, and listing-detail visibility now treat soft-deleted seller users as non-public.
- Homepage, sitemap, map, about, metro browse, city/category browse, seller profile, and seller shop surfaces now include `deletedAt: null` where they already filtered `banned: false`.
- Public seller profile/shop pages noindex or 404 charges-disabled, banned, or deleted sellers as appropriate while still allowing owner access where needed.
- Auth helpers now reject soft-deleted local users in `ensureUserByClerkId()` and `ensureSeller()`.
- Review edits/replies, commission patch, message sends, and fulfillment updates now reject soft-deleted users in addition to banned users.
- Clerk sync now prefers Clerk's primary email address instead of blindly using the first email in the array.

### Upload and media cleanup
- Removed the old `src/utils/uploadthing.ts` compatibility shim and changed all upload components to import `R2UploadButton` directly.
- Removed the unused `ThreadStreamClient` component and its stale `/sse` EventSource path.
- Removed remaining `utfs.io` fallback URL construction in message/review upload handling; uploaded media now uses R2 URLs returned by the upload pipeline.
- Email image URL validation now uses shared exact-origin R2 validation instead of string-prefix checks.

### Performance, resilience, and operational cleanup
- Homepage featured-maker selection no longer fetches every Guild seller for weekly rotation; it counts eligible sellers and fetches one deterministic row.
- Homepage seller metadata queries were narrowed to active, non-deleted sellers and featured curated listings are constrained to the featured seller's own listings.
- Added `fetchWithTimeout()` and applied explicit timeouts to Shippo, OpenAI listing review/alt-text calls, and Nominatim reverse geocoding.
- Label purchase route now declares `maxDuration = 60` and `preferredRegion = "iad1"` like other checkout/shipping routes.
- `scripts/backfill-metros.ts` now requires `ALLOW_METRO_BACKFILL=true` and refuses production environments.
- `.env.example` now documents Neon pooled/direct URL shapes with `sslmode=verify-full` and the metro backfill guard.
- `DismissibleBanner` no longer reads `localStorage` during initial state creation, preventing SSR hydration mismatch.

### Verification
- `npx prisma validate` passed.
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint` passed with 10 warnings and 0 errors.
- Escalated `npm run build` passed. Build still warns that the local `.env` database URL uses `sslmode=require`; `.env.example` now documents `sslmode=verify-full`, and Vercel/local secrets should be updated outside git.

## Round 7 Continuation Cleanup Pass 3 (2026-04-24)

Small hardening pass after the deployed cart/media cleanup. Scope focused on low-risk audit leftovers and lint cleanliness without changing product behavior.

### Map and client-side safety
- `SellersMap` popups now use DOM nodes with `textContent` instead of interpolating seller names/cities into `setHTML()`. This removes a Maplibre popup XSS footgun if seller display data contains markup.
- `AllSellersMap` removed the remaining Maplibre `setHTML()` use and now builds popup DOM with text nodes and encoded seller links.
- `LocationPicker` search now uses an 8-second `AbortController` timeout for Nominatim lookups and catches failures cleanly. Users can still click/drag the map when search fails.
- `LocationPicker`, `MapCard`, and `SellersMap` hook dependencies were corrected instead of being suppressed.

### Lint cleanup
- Added explicit `@next/next/no-img-element` exceptions to the remaining intentional raw image uses: footer/header SVG logos and small user avatar thumbnails. This matches the existing convention used throughout listing cards, galleries, messages, and dashboard thumbnails.
- `npm run lint` now exits with zero ESLint warnings. It still prints a non-failing upstream `jsx-ast-utils` resolver notice for `TSNonNullExpression`.

### Verification
- `npx prisma validate` passed.
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint` passed with 0 ESLint warnings.
- `git diff --check` passed.

## Round 7 Continuation Cleanup Pass 4 (2026-04-24)

Follow-up audit pass against the remaining 300+ item backlog. This pass first re-checked the pasted findings against the current repo and skipped stale items that were already fixed in earlier commits. Scope focused on still-real accessibility/mobile issues, notification scalability, active-user enforcement gaps, and public seller visibility/copy consistency. No Prisma schema migration was required.

### Dialog, lightbox, and mobile sheet accessibility
- Added shared client utilities in `src/lib/dialogFocus.ts`:
  - `useDialogFocus()` traps Tab focus inside open dialogs, closes on Escape, and restores focus to the opener on close.
  - `useBodyScrollLock()` uses a reference-counted lock and preserves/restores scroll position; it locks both `html` and `body` and uses fixed-body positioning to behave better on iOS Safari.
- Applied the shared dialog handling to:
  - `CoverLightbox`
  - `ImageLightbox`
  - `ListingGallery`
  - `SellerGallery`
  - `Header` mobile drawer
  - `MobileFilterBar` filter and sort sheets
  - `BuyNowCheckoutModal`
- Mobile filter and sort sheets now have `role="dialog"`, `aria-modal="true"`, labels, focus trapping, and focus restoration.
- Removed remaining direct `document.body.style.overflow` modal locks from these components.
- Mobile geolocation in `MobileFilterBar` now has an 8-second timeout, a 5-minute cached-position allowance, and inline permission/failure messaging.

### Notification scalability and consistency
- Removed notification pruning from the `/api/notifications` polling path. The old minute-zero prune could create a thundering herd across active users.
- Added `GET /api/cron/notification-prune`, protected by `verifyCronRequest()`, to delete read notifications older than 90 days.
- Added the cron to `vercel.json` at `30 7 * * *`.
- `NotificationBell` now imports the generated Prisma `NotificationType` type instead of maintaining a hand-written enum copy.
- `NotificationBell` now uses `BroadcastChannel` to sync "mark read" and "mark all read" actions across open tabs.
- Notification read endpoints now use active-user guards and rate limiting where applicable:
  - `/api/notifications`
  - `/api/notifications/read-all`
  - `/api/notifications/[id]/read`

### Active-user enforcement hardening
- Stock notification subscribe/unsubscribe now uses `ensureUserByClerkId()` and blocks banned/deleted users.
- Stock notification subscribe now requires the listing to be public, active, visible, in-stock-type, and currently out of stock.
- Saved blog post save/unsave now treats banned/deleted users as unauthorized instead of allowing secondary actions.
- Favorite delete now uses the active-user guard.
- Account unblock server action now uses the active-user guard.
- Follow/unfollow DELETE now uses the active-user guard, matching follow POST.
- Message read/list/SSE stream endpoints now use the active-user guard so suspended/deleted users cannot continue reading message state through secondary endpoints.
- Onboarding server actions now reject banned/deleted users before mutating seller onboarding/profile data.

### Public map and buyer-facing copy cleanup
- Legacy `/sellers/map` now filters public pins to sellers who are charges-enabled, not on vacation, and whose user is not banned/deleted.
- `/map` metro browse links now only consider charges-enabled, non-vacation, non-banned/non-deleted makers.
- Buyer-facing fallback/copy changed from "Seller" to "Maker" in:
  - public map pins
  - listing detail fallback names
  - seller profile metadata/JSON-LD fallback names
  - browse list cards
  - cart seller group heading
  - buyer order list/detail receipt rows
  - checkout success receipt rows
- `src/lib/security.ts` newsletter CSRF note updated to reflect the existing newsletter rate limiter.

### Items re-checked and confirmed already fixed before this pass
- Remaining route-rate-limit findings for review replies, review edits, admin listing review, fulfillment updates, cart/case/stock/photo actions were stale; those routes already use project rate limiters.
- Notification type union missing new types was stale in behavior; all newer notification types were already handled. This pass still removed the manual type copy to avoid future drift.
- Header nav already had `aria-label="Main navigation"`.
- Admin email subject CRLF stripping was already implemented through `safeSubject()`.
- Case status labels were already centralized in `src/lib/caseLabels.ts`.
- `document.body.style.overflow` direct modal locks are now gone from the audited dialog/lightbox components.

### Verification
- `npx tsc --noEmit --incremental false` passed.
- `npx prisma validate` passed.
- `npm run lint` passed; output contains only the existing upstream `jsx-ast-utils` resolver notice and no ESLint warnings.

### Still open / separate future passes
- Legal/business blockers remain non-code: attorney sign-off, money-transmitter confirmation, INFORM/legal workflow alignment, and business insurance.
- Migration hygiene for already-applied raw/index migrations should be handled carefully after checking production `_prisma_migrations`.
- Larger refactors remain: webhook splitting, checkout route consolidation, constants centralization, email module split, and real test coverage.
- Performance passes still worth doing: seller analytics query consolidation, homepage/listing-page query reduction, browse SQL bounding boxes, and large-cron chunking.
- Accessibility/mobile items still worth separate manual QA: photo reorder touch ergonomics, MapLibre WebGL fallback, visualViewport handling for iOS keyboard, and portrait-photo gallery framing.

## Audit Pass — Rounds 1-7 Follow-Up Hardening (2026-04-24)

Read this section before continuing the remaining 300+ item audit queue. This pass intentionally avoided risky schema/migration rewrites and focused on high-confidence security, moderation, webhook, and operational fixes that could be verified immediately.

### Fixed in this pass
- **R2 URL validation now fails closed**: `isR2PublicUrl()` returns false when `CLOUDFLARE_R2_PUBLIC_URL` is missing instead of accepting arbitrary URLs.
- **Email preference checks fail closed**: `shouldSendEmail()` now returns false on DB/preference lookup failure, preventing opt-out bypasses for default-off/banned users.
- **Seller guard blocks banned users**: `ensureSeller()` now throws for banned local users before creating or returning seller profile access.
- **Admin PIN comparison hardened**: `/api/admin/verify-pin` now hashes both submitted and configured PINs and compares fixed-length digests with `timingSafeEqual`; implicit dev bypass now requires `ALLOW_DEV_ADMIN_PIN_BYPASS=true`.
- **Geo-block API bypass narrowed**: non-US traffic can bypass geo-blocking only for health, CSP reports, cron, Clerk webhook, and Stripe webhook routes, not every `/api/*` route.
- **Seller listing ACTIVE transitions hardened**: dashboard `setStatus` can no longer set `ACTIVE`; HIDDEN/SOLD reactivation now goes through `publishListingAction()` so AI/admin review cannot be bypassed by forged server-action posts.
- **Review edit photo validation**: review PATCH now requires edited photo URLs to be valid R2 public URLs and blocks banned reviewers.
- **Profile image validation**: seller avatar/banner/workshop image URLs must be R2 public URLs; social/website URL validation remains HTTPS-only with host checks for social platforms.
- **Verification portfolio URL validation**: portfolio links must be valid `https://` URLs before storing/rendering for admins.
- **Commission/custom-order banned and seller-state guards**: commission create/patch/interest and custom-order request routes now block banned users; commission interest requires seller Stripe charges enabled and vacation mode off; custom-order requests require seller not banned, not on vacation, charges enabled, and accepting custom orders.
- **Custom-order listing context verified**: custom-order request `listingId` must belong to the target seller and be active/public; client-supplied listing titles are no longer trusted.
- **Blog input hardening**: blog cover images must be uploaded Grainline/R2 images; videos must be HTTPS YouTube/Vimeo URLs; maker featured listing IDs are verified against owned active listings before storage; banned authors cannot create/edit posts.
- **Public blog banned-author filters**: `/blog`, `/blog/[slug]`, homepage blog blocks, seller profile blog blocks, and sitemap blog URLs now exclude banned/deleted authors.
- **Stripe API version pinned**: Stripe client now uses `2025-10-29.clover` instead of floating with the SDK default.
- **Webhook duplicate handling narrowed**: webhook catch now treats only `P2002` on `stripeSessionId` as duplicate delivery; other unique constraint bugs surface to Sentry/500.
- **Webhook event coverage improved**: `checkout.session.async_payment_succeeded` now enters the order creation flow; `account.updated` now requires charges, payouts, details submitted, and no disabled reason; basic `charge.refunded`, `charge.dispute.*`, and `payout.failed` handlers mark orders/sellers for review and notify where possible.
- **Unban no longer blind-restores payments**: `unbanUser()` now retrieves Stripe account state before restoring `chargesEnabled`; failed/incomplete accounts stay disabled and vacationed.
- **Seed scripts guarded**: `prisma/seed.ts` and `prisma/seed-bulk.ts` refuse to run when `NODE_ENV=production` or `VERCEL_ENV=production`.
- **Health check deepened**: `/api/health` now checks DB, Redis, and R2 instead of DB/Redis only.
- **Cron auth timing-safe helper**: cron routes now use `verifyCronRequest()` with digest + `timingSafeEqual` instead of raw string comparison.
- **User report validation**: user reports now require an existing non-deleted target user, restrict `targetType` to known values, require `targetType` + `targetId` together, and verify reported content belongs to the reported user.
- **Review vote floor**: helpful-count decrements now use `GREATEST(helpfulCount - 1, 0)` to avoid negative counts under races.
- **Message attachments**: message attachment URL checks now use shared R2 URL validation instead of `startsWith`.
- **Onboarding state hardening**: onboarding actions sanitize profile/policy text, validate avatar URLs through R2, prevent direct jumps beyond the next step, and prevent direct completion before step 5.

### Verification
- `npx tsc --noEmit --incremental false` ✅
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ (escalated build passed; sandboxed builds still hit Turbopack worker port restrictions)
- `npm run lint` ✅ with existing upstream `jsx-ast-utils` resolver notices only
- `npm run build` ✅ outside sandbox; sandbox build still fails on Turbopack internal worker port binding (`Operation not permitted`)
- `npx prisma validate` ✅
- `npm run lint` ✅ with existing warnings only
- `npm run build` ✅ when run outside sandbox; sandbox build fails on Turbopack internal worker port binding (`Operation not permitted`)

### Still open / needs separate migration pass
- Raw partial unique index migration `20260424_add_performance_indexes_v2` still is not represented cleanly in Prisma schema. Avoid changing applied migration names without verifying `_prisma_migrations` in production.
- Conversation/Message/Case/CaseMessage deletion semantics were pinned in `20260424194500_webhook_idempotency_retention_constraints`; keep future changes aligned with account-deletion/anonymization and order/case retention policy.
- Stripe webhook idempotency, `checkout.session.async_payment_failed`, and explicit `PAYMENT_DISPUTE` / `PAYOUT_FAILED` notification types were implemented in `20260424194500_webhook_idempotency_retention_constraints`.
- Legal/business items remain non-code blockers: attorney sign-off, money-transmitter confirmation, INFORM workflow/legal alignment, and business insurance.

## Audit Pass — Admin, Commission, Analytics Hardening (2026-04-24)

Read this together with the Rounds 1-7 follow-up section above. This pass focused on correctness items that did not require schema rewrites or payment-flow surgery.

### Fixed in this pass
- **Admin PIN brute-force budget tightened**: `/api/admin/verify-pin` now rate-limits by both staff user ID and source IP. A compromised session cannot rotate IPs for a fresh PIN budget, and one noisy IP cannot spray attempts across staff accounts.
- **Clerk local routes pinned**: `<ClerkProvider>` now sets `signInUrl="/sign-in"` and `signUpUrl="/sign-up"` so Clerk redirects stay on Grainline-owned routes instead of hosted defaults.
- **Footer metro visibility filter hardened**: footer metro links now require active public listings or sellers with `chargesEnabled=true`, `vacationMode=false`, and non-banned/non-deleted users.
- **Admin listing removal is no longer seller-unhideable**: `/api/admin/listings/[id]` now marks removed listings `REJECTED` + `isPrivate=true`, stores a rejection reason, and clears Favorites, StockNotifications, and CartItems pointing at the removed listing.
- **Admin listing undo preserves prior state**: `undoAdminAction()` now restores `previousStatus`, `previousIsPrivate`, and `previousRejectionReason` from audit metadata instead of blindly restoring a public listing state.
- **Admin undo error responses sanitized**: `/api/admin/audit/[id]/undo` now logs server-side details but returns only whitelisted user-safe messages.
- **Commission expiry notifies affected users**: `/api/cron/commission-expire` now processes expiring OPEN commission requests in an idempotent per-row update and notifies the buyer plus interested makers when a request expires.
- **Seller analytics exclude refunded orders**: overview, charts, repeat-buyer rate, processing time, cart-abandonment purchase matching, and top-listing totals now ignore orders with `sellerRefundId` set.
- **Top listing revenue query fixed**: top listing aggregation no longer sums `OrderItem` rows whose joined order is unpaid/refunded; sums and averages now count only paid non-refunded orders.
- **Analytics copy clarified**: seller analytics now labels revenue as “Sales” and explicitly notes that it is before fees and excludes refunded orders.

### Verification
- `npx tsc --noEmit --incremental false` ✅
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ with existing upstream `jsx-ast-utils` resolver notices only

### Still open / next good passes
- Stripe refund/dispute/label race hardening still deserves a dedicated payment-focused pass with careful webhook and idempotency review.
- Analytics still has lower-priority refinements: cart abandonment can overcount stale carts, and full net revenue after partial refunds needs per-seller refund allocation data to be mathematically exact.
- Larger performance work remains: homepage seller-rating query, listing detail round trips, browse geo/rating prefilters, and long-term metrics aggregation.
- Larger mobile/accessibility work remains: MapLibre no-WebGL fallback, touch-first photo reordering, and iOS visualViewport keyboard handling.

## Audit Pass — Payment Route Guard Rails + Homepage Accuracy (2026-04-25)

Read this with the two Rounds 1-7 follow-up sections above. This pass intentionally kept the existing refund idempotency/lock strategy and added guard rails around it instead of rewriting the payment flow.

### Fixed in this pass
- **Seller refund route rate-limited**: `POST /api/orders/[id]/refund` now uses `refundRatelimit` (10/hour/user, fail-closed) before reaching Stripe.
- **Staff case resolution rate-limited**: `POST /api/cases/[id]/resolve` now uses the same refund limiter with a case-resolution key, reducing accidental repeat submits and admin-session abuse.
- **Label purchase route rate-limited**: `POST /api/orders/[id]/label` now uses `labelPurchaseRatelimit` (10/hour/user, fail-closed) because Shippo label creation costs money and mutates fulfillment state.
- **Refund/case routes pinned for production runtime**: seller refunds and staff case resolution now export `maxDuration = 60` and `preferredRegion = "iad1"`, matching the other payment/Shippo-heavy routes.
- **Refund pending state surfaced correctly**: seller and staff refund paths now return a 409-style “refund is already being processed” message when `Order.sellerRefundId === "pending"` instead of describing it as a completed refund.
- **Seller refund errors sent to Sentry**: top-level seller refund failures now call `Sentry.captureException()` with `source=seller_refund`.
- **Label purchase blocks suspended sellers**: label ownership checks now reject banned/deleted users before loading seller/order details.
- **Label-cost reversal idempotency**: Stripe transfer reversals for label-cost clawback now use an idempotency key based on order, Shippo transaction/rate, and amount.
- **Label clawback failures captured**: Stripe label-cost reversal failures now go to Sentry with order/transfer/amount context instead of only `console.warn`.
- **Post-purchase label reconciliation note**: if Shippo label purchase succeeds but a later DB write fails, the route keeps `labelStatus=PURCHASED`, captures details in Sentry, and best-effort writes `reviewNeeded`, `reviewNote`, and known label fields so staff can reconcile manually without risking duplicate labels.
- **Homepage map pin filter tightened**: homepage seller map rows now exclude vacation-mode sellers.
- **Homepage “orders fulfilled” stat corrected**: the homepage stat now counts paid, non-refunded orders with `DELIVERED` or `PICKED_UP` fulfillment status instead of all paid orders.

### Verification
- `npx tsc --noEmit --incremental false` ✅
- `npx prisma validate` ✅
- `git diff --check` ✅

### Still open / next good passes
- External Stripe-dashboard refunds/disputes need continued webhook reconciliation review and manual-ops UX.
- Label purchase still needs a future first-class “manual reconciliation” admin queue; this pass only preserves state and marks orders for review.
- Larger query performance work remains: listing detail round trips, browse geo/rating prefilters, and metrics aggregation.
- Mobile/accessibility work remains: MapLibre fallback, touch-first photo reordering, and iOS keyboard/visualViewport handling.

## Audit Pass — Metrics Aggregation + Query Indexes (2026-04-25)

Read this with the Rounds 1-7 follow-up sections above. This pass focused on scale/correctness items that can be improved without changing the buyer/seller product flow.

### Fixed in this pass
- **Seller metrics no longer load full seller histories**: `calculateSellerMetrics()` now computes review count/average, completed order count, total sales, on-time shipment rate, and response rate with database aggregates/raw SQL instead of fetching every review, delivered order, shipped order, and conversation into application memory.
- **Guild sales metrics still exclude refunds**: the aggregate rewrite preserves the existing non-refunded delivered/picked-up order filter.
- **Response rate calculation excludes empty conversations**: the SQL rewrite counts buyer-initiated conversations only when the first message exists and was not sent by the seller.
- **Prisma schema aligned with existing review sort index**: `Review` now declares `@@index([listingId, createdAt])`, matching the raw performance index already created in `20260424_add_performance_indexes_v2`.
- **New supporting indexes added**: migration `20260425113000_add_metrics_query_indexes` adds `Conversation(createdAt)`, `Order(createdAt)`, `CaseMessage(caseId, createdAt)`, and `BlogComment(postId, createdAt)` indexes for admin sorts, metrics windows, and chronological thread/comment reads.
- **Fulfillment route runtime pinned**: `POST /api/orders/[id]/fulfillment` now exports `maxDuration = 30` and `preferredRegion = "iad1"` to match other payment/operations-heavy routes and reduce cross-region DB latency.

### Verification
- `npx tsc --noEmit --incremental false` ✅
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ with existing upstream `jsx-ast-utils` resolver notices only

### Still open / next good passes
- Listing detail still has multiple independent DB round trips and should get a dedicated query-shaping pass.
- Browse geo/rating filters still need bounding-box/prefilter work before large catalog scale.
- Seller analytics cart-abandonment math can still overcount stale carts; fixing it cleanly requires a more deliberate analytics pass.
- Mobile/accessibility items remain: MapLibre no-WebGL fallback, touch-first photo management, lightbox focus trapping, and iOS keyboard/visualViewport handling.

## Audit Pass — Media Regression + Archive UX + Visibility Filters (2026-04-25)

This pass was triggered by production-visible missing images (Meet a Maker banner showing alt text, missing listing/blog media) and follow-up review of Round 8 visibility regressions. The root issue was that previous CSP/R2 hardening was too narrow for older production media URLs.

### Fixed in this pass
- **Legacy R2 media restored without reopening arbitrary HTTPS images**: CSP now allows `https://*.r2.dev` for images/connect/media, preserving older Cloudflare R2 public bucket URLs while keeping `img-src` limited to first-party CDN, R2, Clerk, Stripe, and map tile hosts.
- **R2 URL validation supports all configured Grainline media origins**: `isR2PublicUrl()` now accepts `CLOUDFLARE_R2_PUBLIC_URL`, `R2_PUBLIC_URL`, `NEXT_PUBLIC_*` equivalents, comma-separated allowed-origin env vars, `https://cdn.thegrainline.com`, and legacy `*.r2.dev` public bucket URLs. It still rejects arbitrary HTTPS/CDN URLs.
- **Seller gallery images now use shared R2 validation**: `/dashboard/seller` filters `galleryImageUrls` with `filterR2PublicUrls()` before storing them.
- **Admin page access no longer shows raw JSON**: middleware now returns JSON 403 for admin API requests but redirects forbidden `/admin/*` page navigations to `/`.
- **Banned/deleted admins are blocked consistently**: admin middleware and admin layout now reject banned/deleted local users before rendering protected admin UI.
- **Soft-deleted listings are treated as archived in seller UI**: seller dashboard and shop now label `HIDDEN + isPrivate` listings as “Archived,” hide edit/preview/unhide/reactivation actions, and stop linking archived listing cards to public listing pages.
- **Archived listings cannot be edited by browser-back/direct URL**: listing edit page, photo reorder/delete, alt-text save, and update actions now refuse archived listings.
- **Archive action avoids user-facing crash paths**: seller shop archive action returns `{ ok, error }`; dashboard archive action catches cleanup failures instead of throwing a Next.js error page.
- **Account feed visibility hardened**: followed listings, blog posts, and broadcasts now require non-banned/non-deleted sellers with `chargesEnabled=true` and `vacationMode=false`.
- **Blog search visibility hardened**: `/api/blog/search` now excludes banned/deleted authors and maker posts from banned/deleted/vacation/charges-disabled seller profiles in both ranked full-text and standard Prisma query paths.
- **Similar listing filter completed**: raw SQL now requires seller users to be non-deleted in addition to non-banned.
- **Recently viewed respects blocks**: signed-in users no longer see listings from sellers they blocked or who blocked them in the recently-viewed endpoint.
- **ListingCard supports intentionally unlinked cards**: `href={null}` now renders image/title metadata without public listing links, used for archived owner-only shop cards.

### Verification
- `npx tsc --noEmit --incremental false` ✅
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ with existing upstream `jsx-ast-utils` resolver notices only
- `npm run build` ✅ when run outside sandbox; sandbox build fails on Turbopack internal worker port binding (`Operation not permitted`)

### Still open / next good passes
- The visible missing-image issue should be resolved by the CSP/R2 compatibility fix, but production should be checked after deployment against known older `*.r2.dev` media rows.
- Payment/webhook follow-up remains important: `checkout.session.completed` should use the new webhook idempotency table; `account.updated`, `payout.failed`, `charge.refunded`, and dispute handling need a careful Stripe-state semantics pass.
- Broader banned/deleted UX still needs a route-by-route sweep so suspended users get clean 403/redirect experiences instead of generic 500s.
- External image references in historical rows should eventually be audited/backfilled to the first-party CDN where possible.

## Audit Pass — Stripe Webhook Semantics + Account-State API UX (2026-04-25)

This pass continued the Rounds 1-8 audit queue and focused on payment correctness, webhook idempotency, suspended/deleted account behavior, and notification delivery hygiene.

### Fixed in this pass
- **Checkout completion uses webhook idempotency table**: `checkout.session.completed` and `checkout.session.async_payment_succeeded` now run through `processIdempotentEvent()`, matching the other Stripe webhook event handlers. Legacy `Order.stripeSessionId` uniqueness remains a second-line guard.
- **Stripe `account.updated` no longer over-disables sellers**: Grainline now mirrors Stripe `charges_enabled` into `SellerProfile.chargesEnabled`. Payout/requirements states are not collapsed into the buyer-facing purchase gate because Stripe separates “can accept charges” from payout operations.
- **`payout.failed` no longer takes sellers offline**: a failed payout now notifies the seller without setting `chargesEnabled=false` or `vacationMode=true`. This avoids shutting down a shop for transient payout/bank issues.
- **External refund reconciliation preserves local audit trail**: `charge.refunded` no longer overwrites a Grainline-tracked `sellerRefundId` with a Stripe-dashboard refund ID. It preserves local refund IDs and marks the order for review when an additional external refund is detected.
- **Stripe dispute notifications deduped by lifecycle event**: only `charge.dispute.created` creates the seller `PAYMENT_DISPUTE` notification. Later dispute updates still mark the order for review but do not spam the seller on every dispute lifecycle event.
- **Stripe disputes create/escalate cases**: `charge.dispute.created` now creates an `UNDER_REVIEW` case when the order has buyer/seller IDs and no case exists; an existing active case is moved to `UNDER_REVIEW`.
- **Typed suspended/deleted account errors**: `ensureUserByClerkId()` and `ensureUser()` now throw `AccountAccessError` with stable `ACCOUNT_SUSPENDED` / `ACCOUNT_DELETED` codes instead of generic `Error`.
- **Common API routes return clean 403 for suspended/deleted users**: cart add/update/get, case creation, favorites delete, follow/unfollow, message list/read/stream, notification read/read-all/list, and stock notification subscribe/unsubscribe now convert account-state failures to explicit 403 responses instead of generic 500s.
- **Clerk webhook no longer retries forever for banned/deleted users**: `user.created` / `user.updated` events for already banned/deleted local users are acknowledged without calling `ensureUserByClerkId()`.
- **Notification creation failures are observable**: `createNotification()` now captures failures to Sentry while still preserving non-blocking behavior.
- **Low-stock seller notifications deduped**: manual stock updates no longer create repeated `LOW_STOCK` notifications for the same listing within a 24-hour window.
- **Back-in-stock fan-out batched and cleaned up**: restock notifications now process active subscribers in batches, skip banned/deleted users, and delete fired `StockNotification` records so the same subscription does not fire repeatedly on future restocks.

### Verification
- `npx tsc --noEmit --incremental false` ✅
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ with existing upstream `jsx-ast-utils` resolver notices only
- `npm run build` ✅ when run outside sandbox; sandbox build fails on Turbopack internal worker port binding (`Operation not permitted`)

### Still open / next good passes
- Continue the route-by-route suspended/deleted UX sweep for pages and remaining lower-traffic APIs.
- Payment/admin operations still need a deeper case/refund/manual reconciliation workflow review, especially partial external refunds and staff-visible dispute state.
- Notification fan-out for followed-maker new listings/blog posts should receive the same batching and active-recipient filtering pattern.
- Larger performance work remains: listing detail query shaping, browse geo/rating prefilters, homepage query cleanup, and long-term analytics correctness.

## Audit Pass — Email Compliance, Follower Fan-Out, Guild Applications, Saved Searches (2026-04-25)

This pass continued the Rounds 1-8 audit queue after verifying the code paths directly. It targeted issues that were high-signal, bounded, and safe to ship without rewriting payment or listing flows.

### Fixed in this pass
- **List-Unsubscribe one-click compliance**: outbound email now uses a tokenized `/api/email/unsubscribe` endpoint in `List-Unsubscribe` headers instead of the generic sign-in-required `/unsubscribe` page.
- **Stateless unsubscribe tokens**: unsubscribe links are HMAC-signed over the recipient email using `UNSUBSCRIBE_SECRET` (falling back to existing webhook secrets if needed). The endpoint accepts Gmail/Yahoo one-click POSTs and does not require account sign-in.
- **Unsubscribe behavior**: one-click unsubscribe disables newsletter subscriptions, suppresses future direct sends, and sets every key in `VALID_EMAIL_PREFERENCE_KEYS` to `false`. This intentionally includes order/case/review-style email notifications after the later compliance hardening pass.
- **Admin-sent emails use the same one-click unsubscribe path**: `/api/admin/email` no longer advertises a generic unsubscribe URL in one-click headers.
- **Follower notification fan-out batched**: new listing, new blog, blog republish, and seller broadcast notifications now skip banned/deleted followers and process notifications in bounded batches instead of large `Promise.all()` bursts.
- **New-listing follower emails no longer silently cap at 500**: followed-maker new-listing emails are processed in email batches with per-recipient preference checks instead of slicing the follower list.
- **Guild Member application server action now enforces eligibility**: tampered server-action posts cannot enter the admin queue unless the seller meets listing count, completed non-refunded sales, account age, and long-running-case requirements.
- **Guild Member sales math fixed**: the verification page now sums `OrderItem.priceCents * quantity` on delivered/picked-up non-refunded orders instead of summing unit prices.
- **Guild Master application server action now enforces live metrics**: tampered posts cannot submit unless the seller is an active Guild Member and currently meets Guild Master requirements.
- **Guild Master business narrative persisted**: `MakerVerification.guildMasterCraftBusiness` stores the Guild Master application answer separately from the original Guild Member craft description, and admin review displays that field.
- **Verification portfolio URL validation hardened**: the dashboard verification actions now require optional portfolio URLs to be valid `https://` URLs before storage.
- **Saved searches preserve browse filter state**: saved searches now store listing type, ships-within-days, minimum rating, location lat/lng/radius, sort, min/max price, category, tags, and query.
- **Saved-search price cap aligned with listing reality**: saved-search API validation now accepts up to the listing maximum ($100,000) instead of rejecting saved searches above $1,000.
- **Saved-search privacy disclosure updated**: Privacy Policy saved-search language now lists the newly stored filter fields.
- **Common suspended/deleted account pages redirect cleanly**: account overview, orders, reviews, settings, checkout success, and seller settings now route account access failures to `/banned` instead of exposing a generic error page.
- **`ensureSeller()` now throws typed account-access errors**: seller-only pages can distinguish suspended/deleted account state from generic server failures.
- **Environment docs updated**: `.env.example` now documents `UNSUBSCRIBE_SECRET`.

### Verification
- `npx prisma generate` ✅
- `npx prisma migrate deploy` ✅ applied `20260425113000_add_metrics_query_indexes` and `20260425172000_extend_saved_search_and_verification_fields` to the configured database
- `npx tsc --noEmit --incremental false` ✅
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ with existing upstream `jsx-ast-utils` resolver notices only
- `npm run build` ✅ outside sandbox; sandbox build still fails on Turbopack internal worker port binding (`Operation not permitted`)

### Still open / next good passes
- Continue the suspended/deleted UX sweep for less common server actions and API routes not covered in this pass.
- Configure the Resend dashboard webhook to send `email.bounced`, `email.complained`, and `email.suppressed` events to `https://thegrainline.com/api/resend/webhook` with `RESEND_WEBHOOK_SECRET`.
- Larger notification delivery work remains: durable outbox/queue semantics for very large follower bases.
- Guild/admin performance can still be improved by caching verification metrics instead of calculating every applicant live in the admin queue.
- Saved-search alert emails remain a future feature; this pass only fixed saved-filter persistence and replay.

## Audit Pass — Resend Bounce/Complaint Suppression (2026-04-25)

This pass continued the email infrastructure items from the Rounds 1-8 audit. Saved-search alert emails were intentionally skipped per product direction.

### Fixed in this pass
- **Email suppression table added**: `EmailSuppression` stores normalized recipient emails that should no longer receive Grainline mail, with `BOUNCE`, `COMPLAINT`, or `MANUAL` reasons plus source/event metadata.
- **Resend webhook endpoint added**: `/api/resend/webhook` verifies Resend/Svix webhook signatures against the raw request body using `RESEND_WEBHOOK_SECRET`.
- **Bounce/complaint handling implemented**: `email.bounced`, `email.complained`, and `email.suppressed` events suppress all recipient addresses from that event.
- **Webhook replay protection implemented**: `ResendWebhookEvent` records every verified `svix-id`; processed events are ignored on replay, while stale failed attempts can retry after 5 minutes.
- **Transient delivery failures tracked**: `email.failed` and `email.delivery_delayed` increment `EmailFailureCount`; 3 failures in 30 days suppress the recipient with source `resend_transient_failure`.
- **Newsletter state synchronized**: suppressed emails are also marked inactive in `NewsletterSubscriber`, preventing later newsletter sends to bad/complaining addresses.
- **Outbound sends respect suppressions**: the shared transactional email sender skips suppressed recipients before calling Resend.
- **Admin direct emails respect suppressions**: `/api/admin/email` refuses to send to suppressed recipients and returns a clear 409 instead of attempting delivery.
- **Webhook route is reachable by providers**: middleware treats `/api/resend/webhook` like Stripe/Clerk webhooks for auth and geo-block bypass purposes.
- **Environment docs updated**: `.env.example` now documents `RESEND_WEBHOOK_SECRET`.

### Operational step
- In Resend, create a webhook for `https://thegrainline.com/api/resend/webhook`.
- Subscribe it to `email.bounced`, `email.complained`, `email.suppressed`, `email.failed`, and `email.delivery_delayed`.
- Add the webhook signing secret to Vercel as `RESEND_WEBHOOK_SECRET`.

### Verification
- `npx prisma generate` ✅
- `npx prisma migrate deploy` ✅ applied `20260425190000_email_suppressions` to the configured database
- `npx tsc --noEmit --incremental false` ✅
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ with existing upstream `jsx-ast-utils` resolver notices only
- `npm run build` ✅ outside sandbox; sandbox build still fails on Turbopack internal worker port binding (`Operation not permitted`)

### Still open / next good passes
- Continue the suspended/deleted UX sweep for less common server actions and API routes.
- Larger notification delivery work remains: durable outbox/queue semantics for very large follower bases.
- Saved-search alert emails remain intentionally skipped.

## Audit Pass — Account-State API UX Sweep (2026-04-25)

This pass continued the suspended/deleted account handling work. The goal was not to change authorization policy, but to make existing bans/deletions return explicit 403 responses or `/banned` redirects instead of generic 500s or inconsistent fallback states.

### Fixed in this pass
- **Shared API account-state response helper**: `accountAccessErrorResponse()` converts typed `AccountAccessError` failures into `{ error, code }` JSON with HTTP 403.
- **Checkout account-state failures are explicit**: single-listing checkout and seller-cart checkout now return 403 for suspended/deleted buyers instead of falling through to generic checkout-session errors.
- **Case action account-state failures are explicit**: case escalate, mark-resolved, message, and staff resolve routes now return clean 403s for suspended/deleted users.
- **Seller refund account-state failures are explicit**: seller refund route now returns a clean account-state 403 before generic refund error handling.
- **Upload account-state failures are explicit**: processed image uploads and presigned file uploads now return 403 for suspended/deleted users instead of unhandled route errors.
- **Seller analytics account-state failures are explicit**: analytics overview and recent-sales APIs now return 403 instead of generic 500s.
- **Seller operational account-state failures are explicit**: vacation mode and verification application routes now return 403 for suspended/deleted users.
- **Stripe Connect routes preserve behavior while adding account-state checks**: create/login-link routes now use `ensureUserByClerkId()` for ban/deletion enforcement, while still requiring an existing seller profile instead of auto-creating one.
- **Account APIs respect account state**: account deletion, notification preferences, shipping address GET/PUT, saved-search GET/POST/DELETE, block/unblock API, user report API, favorites POST, and review helpful vote now return clean account-state 403s.
- **Blocked users page uses shared page auth**: `/account/blocked` now redirects suspended/deleted accounts to `/banned`, matching the other account pages.

### Verification
- `npx tsc --noEmit --incremental false` ✅
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ with existing upstream `jsx-ast-utils` resolver notices only
- `npm run build` ✅ outside sandbox; sandbox build still fails on Turbopack internal worker port binding (`Operation not permitted`)

### Still open / next good passes
- Continue lower-priority server-action UX cleanup where actions throw errors directly instead of returning inline form state.
- Larger notification delivery work remains: durable outbox/queue semantics for very large follower bases.
- Payment/manual reconciliation work remains for external refunds, partial refunds, and disputes.

## Audit Pass — Media Origin Compatibility and Broken-Image Fallbacks (2026-04-25)

This pass responded to a production-visible media regression: the homepage "Meet a Maker" banner rendered only alt text ("Litter Shack workshop"), and several listing/blog images appeared missing after recent media/CSP hardening. The fix was intentionally scoped to display resilience and upload correctness; it does not try to fabricate missing R2 objects.

### Production diagnosis
- A read-only production media host audit found stored media across:
  - `cdn.thegrainline.com` for current R2/custom-domain uploads
  - `qu5gyczaki.ufs.sh` for legacy UploadThing media
  - `i.postimg.cc` for two legacy listing photos
- The live homepage contained both legacy `ufs.sh` media and `cdn.thegrainline.com/galleryImage/...` URLs.
- At least one first-party CDN URL returned a plain `Cache miss`, meaning the object is not publicly retrievable from the current CDN/bucket path. Code can hide that failure and prevent future dead URLs, but the missing object itself must be re-uploaded or reconciled in R2/Cloudflare.

### Fixed in this pass
- **Legacy UploadThing images are renderable again**: CSP now allows `https://utfs.io`, `https://ufs.sh`, and `https://*.ufs.sh` for image/media display.
- **Known legacy Postimg listing photos render**: CSP allows `https://i.postimg.cc` for display only. The URL validator does not accept Postimg for new uploaded media.
- **Media validator preserves trusted legacy URLs**: `isR2PublicUrl()` now accepts first-party CDN/R2 URLs plus legacy UploadThing URLs, so editing existing profile/blog records does not silently erase old valid images.
- **Display-only media policy added**: `isTrustedMediaUrl()` includes the display-only Postimg host for read surfaces while keeping mutation validation narrower.
- **Homepage hero mosaic no longer hardcodes `cdn.thegrainline.com`**: it now uses the shared trusted-media policy, so valid legacy R2/UploadThing media is not thrown away.
- **High-traffic surfaces use graceful image fallbacks**: `MediaImage` hides broken `<img>` failures and renders a stable fallback block instead of exposing alt text. Applied to homepage followed-maker cards, Meet a Maker banner/listing thumbnails, homepage blog cards, listing cards, seller banner/broadcast/blog cards, seller gallery, and blog listing/detail related cards.
- **Blog cover lightbox handles broken covers**: failed blog cover images now collapse to a neutral fallback instead of opening a broken lightbox.
- **Processed uploads verify public availability**: `/api/upload/image` now checks the returned public URL after writing to R2. If the object cannot be fetched from `CLOUDFLARE_R2_PUBLIC_URL`, the route returns a 502 instead of saving a dead media URL into forms/listings.

### Operational follow-up
- Investigate why existing `cdn.thegrainline.com/...` objects return `Cache miss`. Likely causes: old Vercel/Cloudflare envs wrote to a different bucket, the custom domain points at a different bucket, or some objects were lost/deleted after URL storage.
- Re-upload or repair the affected first-party CDN media rows. This pass prevents ugly rendering and new silent dead URLs, but it cannot recover objects that are absent from R2.

### Verification
- `npx tsc --noEmit --incremental false` ✅
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ with existing upstream `jsx-ast-utils` resolver notices only
- `npm run build` ✅ outside sandbox; sandbox build still fails on Turbopack internal worker port binding (`Operation not permitted`)

### Still open / next good passes
- Repair/re-upload the existing `cdn.thegrainline.com` media rows returning `Cache miss`.
- Continue lower-priority server-action UX cleanup where actions throw errors directly instead of returning inline form state.
- Larger notification delivery work remains: durable outbox/queue semantics for very large follower bases.
- Payment/manual reconciliation work remains for external refunds, partial refunds, and disputes.

## Audit Pass — Server-Action UX + Moderation Fail-Closed (2026-04-25)

This pass targeted a high-leverage cluster from the post-Round-7 audits: forms that still threw raw server-action errors into the global "Something splintered" boundary, silent client-side failures, and one remaining moderation fail-open path.

### Fixed in this pass
- **Shared inline server-action error display**: `ActionForm` now renders returned `{ ok: false, error }` messages above the form instead of only showing the success toast.
- **Create listing validation no longer crashes the page**: `/dashboard/listings/new` now returns inline errors for create-rate-limit, missing title/photos/price, invalid price bounds, stock validation, and processing-time validation.
- **Shop profile validation no longer crashes the page**: `/dashboard/profile` now returns inline display-name validation errors and returns `{ ok: true }` after a successful save so the shared action form can show a saved state.
- **Shop settings validation no longer crashes the page**: `/dashboard/seller` now returns inline errors for missing display name and public-map opt-in without an exact pin.
- **Blog create/edit validation no longer crashes the page**: blog post server actions now return inline errors for suspended accounts, publish rate limits, missing title/body, profanity on publish, unavailable post types, slug-generation failure, and invalid media URLs.
- **Blog form upload failures surface to the user**: blog cover upload errors now use the shared toast channel instead of `console.error`.
- **Custom listing validation no longer crashes the page**: `/dashboard/listings/custom` now returns inline errors for missing conversation context, missing Stripe setup, vacation mode, invalid conversation participation, tampered reserved buyer, and missing title/price.
- **Custom listings now pass through AI moderation**: private custom-order listings are reviewed before the buyer is notified. Held listings are moved to `PENDING_REVIEW` and opened in seller preview instead of silently sending a buyer a purchasable link.
- **AI listing review fails closed**: missing `OPENAI_API_KEY` or OpenAI/API/parsing errors now return `approved: false`, `confidence: 0`, and review flags, causing publish paths to hold listings for admin review instead of default-approving them.
- **Notification preference failures are visible**: `NotificationToggle` now checks non-2xx responses, reverts optimistic state, and shows toast errors.
- **Back-in-stock notification failures are visible**: `NotifyMeButton` now shows success/error toasts and handles non-2xx responses.
- **Follow/save failures are visible**: `FollowButton`, `SaveBlogButton`, and `SaveSearchButton` now parse API errors and show toast failures instead of silently doing nothing.
- **Toast cleanup and mobile placement improved**: toast timers are cleared on provider unmount, and the toast stack respects `safe-area-inset-bottom` on iOS devices.

### Verification
- `npx tsc --noEmit --incremental false` ✅

### Still open / next good passes
- Continue the remaining silent-failure sweep for less critical polling/search/header components where failures should be logged or surfaced deliberately.
- Continue payment/manual reconciliation work for external refunds, disputes, and partial-refund inventory semantics.
- Add durable notification/email outbox semantics for very large follower bases.
- Repair/re-upload the existing `cdn.thegrainline.com` media rows returning `Cache miss`.

## Audit Pass — Payment Reconciliation Ledger (2026-04-25)

This pass addressed the remaining Stripe manual-reconciliation gap: external refunds and dispute lifecycle events were visible only through mutable `Order.reviewNote` strings. Staff now get a durable per-order event ledger for Stripe refund/dispute webhooks.

### Fixed in this pass
- **Order payment event ledger added**: new `OrderPaymentEvent` model stores order-linked Stripe payment events with `stripeEventId` uniqueness, object IDs/types, event type, amount, currency, status, reason, description, and JSON metadata.
- **Migration added**: `20260425213000_order_payment_events` creates the ledger table and indexes by order/date, event type/date, and Stripe object ID.
- **Refund webhooks create durable rows**: `charge.refunded` now records a `REFUND` event for local Grainline refunds, external Stripe-dashboard refunds, and additional external refunds.
- **Refund reconciliation preserves local audit IDs**: local Grainline refund IDs are not overwritten by external Stripe-dashboard refunds. Additional external refunds raise `reviewNeeded` and preserve the local refund ID in event metadata.
- **Refund amount semantics improved**: each payment event displays the latest refund amount when Stripe provides it, while metadata stores cumulative `totalRefundedCents` for reconciliation.
- **Dispute lifecycle events create durable rows**: every `charge.dispute.*` event now records a `DISPUTE` payment event, while only `charge.dispute.created` opens/escalates a case and notifies the seller.
- **Admin order detail shows Stripe payment events**: `/admin/orders/[id]` now displays the most recent 25 payment events with event/object IDs, amount, status, reason, and timestamp.

### Verification
- `npx prisma generate` ✅
- `npx tsc --noEmit --incremental false` ✅
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npx prisma migrate deploy` ✅ (applied `20260425213000_order_payment_events`)
- `npm run build` ✅ (sandboxed build hit the known Turbopack local-port restriction; escalated build passed)

### Still open / next good passes
- Partial refund inventory remains intentionally conservative: Stripe/external partial refunds do not automatically restock because Stripe refund events are not line-item-specific.
- Seller-facing payout-failure banner remains a separate UX pass; current behavior sends a notification only.
- Continue remaining lower-risk silent-failure cleanup and notification outbox work.

## Audit Pass — Runtime Race + Metadata Hardening (2026-04-25)

This pass targeted still-valid findings from the post-Round-7 list that were bounded and correctness-focused: webhook retry edge cases, unsafe webhook metadata parsing, helper-level predicate bugs, and unbounded cron loops.

### Fixed in this pass
- **Stripe webhook retry claiming tightened**: failed Stripe webhook events can now be reclaimed only when `processingStartedAt` is cleared or stale. A non-null `lastError` alone no longer lets concurrent retries process the same event while another worker still owns it.
- **Webhook failure marking no longer masks the original error**: if `markStripeWebhookEventFailed()` itself fails, the webhook captures that marking failure to Sentry and still rethrows the original handler error.
- **Webhook metadata integer parsing hardened**: single-checkout quantity, expired-session quantity, checkout price metadata, quoted shipping amount, and shipping ETA days now use finite integer parsers instead of `Number(...)` / `Math.max(...)` paths that could turn tampered metadata into `NaN`.
- **Synthetic Shippo rate IDs no longer persist to orders**: checkout webhook normalization stores `null` for synthetic `"pickup"` and `"fallback"` rate IDs so order records do not look label-purchasable when no real Shippo rate exists.
- **`fetchWithTimeout()` now composes caller abort signals correctly**: timeout aborts still fire even when the caller supplies its own signal, while caller aborts also cancel the shared controller.
- **Open commission predicate composition fixed**: `openCommissionWhere(extra)` now combines caller filters with status/buyer/expiry guards via `AND`, preserving caller-provided `OR` filters instead of overwriting them.
- **Listing soft-delete cleanup moved into a serializable transaction**: active-order/case checks, hiding the listing, and cleanup of favorites/stock notifications/cart items now run together under serializable isolation.
- **Ban/unban state changes are atomic**: user ban state, seller profile gating, commission closure, and admin audit log writes now commit in one transaction. Unban likewise commits user restoration, Stripe-derived seller gating, and audit logging together.
- **Case auto-close cron is bounded**: each cron run now processes the oldest 100 stale `PENDING_CLOSE` cases and oldest 100 abandoned open cases instead of loading an unbounded result set.

### Verification
- `npx tsc --noEmit --incremental false` ✅
- `npx prisma validate` ✅
- `git diff --check` ✅

### Still open / next good passes
- Ban-time checkout-session expiry still needs a dedicated Redis/Stripe session design; this pass tightened ban persistence but did not attempt broad session cancellation.
- Partial refund inventory remains conservative; line-item refund/restock semantics need product design.
- Continue follower notification outbox work and remaining low-risk silent-failure cleanup.

## Audit Pass — Payout + Saved/Recent State Polish (2026-04-25)

This pass addressed smaller but still valid findings from the post-Round-7 backlog: payout failure visibility, recently-viewed state cleanup/rate limiting, saved-search abuse gaps, and sign-out race handling.

### Fixed in this pass
- **Seller payout failures are visible in settings**: `/dashboard/seller` now shows a red Stripe payout-failed banner when the seller has a recent `PAYOUT_FAILED` notification, instead of relying only on the notification bell.
- **Recently viewed endpoint is rate limited**: `/api/listings/recently-viewed` now uses the existing open search limiter by IP, closing the unauthenticated spam path for arbitrary CUID lookups.
- **Recently viewed cookies prune stale IDs**: the client now rewrites the cookie from the server-filtered response, removing stale, deleted, blocked, or no-longer-public listings after a successful refresh.
- **Recently viewed failures are no longer silent**: non-2xx responses and network failures now surface through the shared toast channel instead of an empty catch block.
- **Saved searches must contain meaningful criteria**: `/api/search/saved` now rejects empty `{}` or sort-only saved searches, preventing users or bots from filling the 25-search cap with meaningless rows.
- **Saved-search delete API is rate limited**: `DELETE /api/search/saved` now uses the same saved-search limiter as creation.
- **Dashboard saved-search deletion is gated**: the dashboard server action now rate-limits deletes and ignores banned/deleted users before deleting saved searches.
- **Header sign-out waits for Clerk completion**: both the mobile header drawer and avatar menu now await `signOut({ redirectUrl: "/" })`, avoiding races where navigation can interrupt sign-out.

### Verification
- `npx tsc --noEmit --incremental false` ✅
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding
- `npx dotenv-cli -e .env.local -e .env -- npx prisma migrate deploy` ✅ applied `20260426110000_cron_run_idempotency`

### Still open / next good passes
- Durable notification/email outbox semantics remain open for very large follower bases.
- Payout failure state is now visible through recent notifications; a persistent Stripe-account status model/resolution workflow could make this stronger later.
- Continue larger SEO, performance-index, and partial-refund inventory passes.

## Audit Pass — Guild Admin State Hardening (2026-04-25)

This pass focused on the Guild verification/admin cluster from the later audit rounds. The earlier application bypasses were already fixed in the current tree, so this pass closed adjacent stale-state and duplicate-side-effect risks in the admin review tools.

### Fixed in this pass
- **Admin verification actions block banned/deleted admins in depth**: the page-level `requireAdmin()` helper now redirects suspended/deleted admin accounts to `/banned`, matching middleware and admin layout behavior.
- **Guild Member approve/reject actions are idempotent**: approval/rejection now only proceeds while the verification row is still `PENDING`, preventing double-clicks or repeated server-action posts from creating duplicate notifications/audit logs.
- **Guild Master approve/reject actions are idempotent**: approval/rejection now only proceeds while the row is still `GUILD_MASTER_PENDING`.
- **Guild Member revocation now synchronizes verification state**: revoking a Guild Member moves the seller to `guildLevel: NONE`, clears runtime warning counters, and marks the verification row `REJECTED` with a staff revocation note.
- **Guild Master revocation clears stale Master state**: revoking a Guild Master now downgrades to Guild Member and clears `guildMasterApprovedAt`, `guildMasterAppliedAt`, `guildMasterReviewNotes`, metric warning state, and Master verification status.
- **Guild Member reinstatement synchronizes verification state**: reinstating a revoked member now restores `guildLevel: GUILD_MEMBER`, `isVerifiedMaker: true`, resets warning counters, and marks the verification row `APPROVED`.
- **Feature maker action is idempotent**: featuring a maker only sets a new 7-day feature window if they are not already actively featured, preventing double-clicks/stale forms from extending the window.
- **Unfeature maker action is idempotent**: unfeature now only writes/audits if the seller is currently featured.
- **Feature maker client handles errors**: the admin feature/unfeature button now uses the shared toast system and always resets loading state in `finally`.

### Verification
- `npx tsc --noEmit --incremental false` ✅
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

### Still open / next good passes
- Durable notification/email outbox semantics remain open for very large follower bases.
- Larger SEO slug/canonical work remains open.
- Partial refund line-item inventory semantics remain open and need product decisions.

## Audit Pass — Media Fallback + Query Index Polish (2026-04-25)

This pass addressed a visible production media regression and added only the missing high-value read indexes after confirming existing audit-requested indexes were already present.

### Fixed in this pass
- **Broken pre-hydration images now collapse to branded fallbacks**: `MediaImage` now checks `complete && naturalWidth === 0` after mount, so images that fail before React attaches `onError` no longer leave raw alt text visible.
- **Media fallbacks can chain to a second trusted source**: `MediaImage` now supports `fallbackSrc`, trying a secondary image before rendering the styled fallback block.
- **Listing cards fall back to the alternate listing photo**: if the primary card image is missing/dead, cards now try the secondary photo before showing the neutral placeholder.
- **Meet a Maker banner has a real fallback source**: the homepage banner now falls back to the featured maker's first featured listing photo, then workshop/avatar image, before using the gradient block.
- **Remaining query indexes added**: migration `20260425234500_audit_query_indexes` adds indexes for featured-maker lookup, Guild filtered lookup, listing quality score sorting, seller dashboard listing sort, buyer order timelines, fulfillment/admin order timelines, and unread notification timelines.

### Verification
- `npx prisma validate` ✅
- `npx tsc --noEmit --incremental false` ✅
- `git diff --check` ✅
- `npx prisma generate` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npx prisma migrate deploy` ✅ (applied `20260425234500_audit_query_indexes`)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

### Still open / next good passes
- Repair/re-upload existing `cdn.thegrainline.com` media rows that return `Cache miss`; code can now degrade gracefully, but missing objects still need data repair.
- Durable notification/email outbox semantics remain open for very large follower bases.
- Larger SEO slug/canonical work remains open.
- Partial refund line-item inventory semantics remain open and need product decisions.

## Audit Backlog Snapshot — Rounds 13-18 (2026-04-25)

The canonical open-findings list now lives in `audit_open_findings.md`. It consolidates the new Round 13-18/re-review findings, de-duplicates them where obvious, and groups them into fix-mode batches.

### Current estimate
- Raw audit findings across all rounds: ~750+.
- Practical unique actionable backlog after de-duplication: ~250-320 items.
- Launch-quality / critical-high engineering work still open: ~35-45 critical and ~80-110 high-priority items.
- Lower medium/low/product/legal work still open: ~140-180 items.

### Highest-priority batches
1. Email compliance and unsubscribe correctness.
2. Refund/payment race safety.
3. Listing moderation/state invariants.
4. Suspended/deleted account-state enforcement.
5. Cron/notification scale and idempotency.
6. GDPR export/deletion/data-retention completion.
7. Admin/dashboard multi-seller and moderation correctness.
8. Larger SEO/search/performance cleanup.

### Confirmed still-live examples
- Refund `"pending"` sentinel can still reach seller UI.

## Audit Fix Pass — One-Click Unsubscribe Hardening (2026-04-25)

This pass closed the confirmed Round 14/16 email-compliance regressions around one-click unsubscribe. The endpoint had existed, but the middleware blocked mail-provider POSTs, the footer link still pointed to the sign-in-gated `/unsubscribe` page, and unsubscribe only disabled three promotional preference keys.

### Fixed in this pass
- **One-click unsubscribe endpoint is public**: `/api/email/unsubscribe` is now in the public route matcher and allowed through the geo-block API allowlist so Gmail/Yahoo/Outlook POSTs do not hit Clerk.
- **One-click endpoint is rate-limited**: added a dedicated public `unsubscribeRatelimit` of 30 requests/hour per IP, using fail-closed rate limiting.
- **Unsubscribe tokens no longer reuse webhook secrets**: token signing now uses only `UNSUBSCRIBE_SECRET` or `EMAIL_UNSUBSCRIBE_SECRET`; Clerk/Stripe webhook-secret fallback was removed.
- **Unsubscribe tokens expire**: generated URLs now include an `issuedAt` timestamp, HMAC over `email:issuedAt`, a 90-day TTL, and a small future-clock-skew allowance.
- **GET unsubscribe returns HTML**: browser opens now show a simple success/error page instead of raw JSON.
- **POST unsubscribe remains machine-readable**: mail-provider one-click POSTs still receive JSON `{ ok: true }`.
- **Footer unsubscribe links are tokenized**: email templates now use a placeholder that `send()` replaces with the recipient-specific `/api/email/unsubscribe?...` URL before sending.
- **Unsubscribe disables all known email prefs**: `VALID_EMAIL_PREFERENCE_KEYS` now covers the full notification/email surface, and one-click unsubscribe sets every email preference key to `false`.
- **One-click unsubscribe suppresses future direct sends**: the handler now upserts `EmailSuppression` with reason `MANUAL` and source `one_click_unsubscribe`, so direct transactional/broadcast sends also respect the unsubscribe request.
- **Newsletter resubscribe checks suppression**: `/api/newsletter` now returns a suppressed response instead of reactivating an email that has opted out.

### Verification
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

### Still open / next good passes
- Refund `"pending"` UI/lock cleanup and broader refund race fixes.

## Audit Fix Pass — Bounded Text Column Caps (2026-04-27)

This pass closed the schema finding that bounded strings were still stored as unbounded PostgreSQL `text`.

### Fixed in this pass
- **Database caps added for structured strings**: user emails/names, shipping addresses, Stripe/Shippo/Resend IDs, currencies, statuses, URLs, notification titles/bodies, review/comment bodies with existing UI caps, case/message bodies, saved-search queries, blog metadata, seller broadcast text, commission request text, admin audit reasons, and report details now use `@db.VarChar(N)`.
- **Long-form content intentionally remains `Text`**: listing descriptions, profile stories, shop policies, blog post bodies, and ledger/debug descriptions were left uncapped at the DB type level to avoid truncating legitimate long-form content.
- **Migration added**: `20260427123000_bound_text_columns` applies the corresponding column type changes.
- **Open backlog updated**: `audit_open_findings.md` now marks the bounded text-column finding fixed.

### Verification
- `npx prisma validate` ✅
- `npx prisma generate` ✅
- `git diff --check` ✅
- `npx tsc --noEmit --incremental false` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm test` ✅
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding
- `npx vercel --prod` ✅ (`dpl_HiKxUzzQnuaCxKVAyfyzoyrtrMim`)

## Audit Fix Pass — Feed Retry, COOP Popup Compatibility, Media URL Tests (2026-04-27)

This pass closed the remaining code-actionable feed/COOP/media-test items from the medium/low backlog.

### Fixed in this pass
- **Feed load failures are actionable**: `/account/feed` now renders failed loads as an accessible alert with a retry button instead of a dead error message.
- **COOP no longer blocks payment/auth popups**: `Cross-Origin-Opener-Policy` is now `same-origin-allow-popups`, preserving Stripe/Clerk popup compatibility while retaining opener isolation for non-popup windows.
- **Media origin hardening is tested**: `tests/media-url.test.mjs` covers configured first-party media origins, legacy display origins, rejection of arbitrary `*.r2.dev`/lookalike hosts, trusted-display-only hosts, URL filtering, and R2 key extraction from configured public bases only.
- **Open backlog updated**: `audit_open_findings.md` now marks feed retry and COOP/R2 recheck fixed, and updates the CI test baseline coverage.

### Verification
- `git diff --check` ✅
- `npx tsc --noEmit --incremental false` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm test` ✅ (9 tests: shipping tokens + media URL/R2 key validation)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

## Audit Fix Pass — CI Environment Parity (2026-04-27)

This pass tightened GitHub Actions around the now-larger build/test surface.

### Fixed in this pass
- **CI declares the app's build/test secret surface**: `.github/workflows/ci.yml` now passes database, Clerk, Stripe, R2 public/private aliases, Upstash, Shippo, Resend, unsubscribe, OpenAI, admin, cron, Sentry, and app URL environment variables into the check job.
- **Postinstall remains disabled in CI install**: `npm ci --ignore-scripts` stays in place; Prisma generation runs explicitly in the next step.
- **Open backlog updated**: `audit_open_findings.md` now records CI env parity as fixed.

### Verification
- `git diff --check` ✅
- CI env parity smoke check ✅

## Audit Fix Pass — Cron Per-Record Isolation Sweep (2026-04-27)

This pass closed the remaining non-Guild cron isolation gap for cron routes that process user/business records with side effects.

### Fixed in this pass
- **Commission expiry isolates bad rows**: one failing commission request no longer aborts the entire `/api/cron/commission-expire` run. Per-request failures are captured to Sentry and returned as sanitized `{ requestId, code }` entries.
- **Case auto-close isolates bad rows**: one failing case no longer aborts the entire `/api/cron/case-auto-close` run. Pending-close and abandoned-open transitions use guarded `updateMany` predicates so concurrent user/admin mutations are respected.
- **Cron responses stay sanitized**: record-level responses include counts and error codes only; stack traces and paths stay in Sentry.
- **Open backlog updated**: `audit_open_findings.md` now marks the remaining per-record cron isolation sweep fixed for side-effecting record-processing crons.

### Verification
- `git diff --check` ✅
- `npx tsc --noEmit --incremental false` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm test` ✅ (9 tests)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

## Audit Fix Pass — Public URL Canonicals + Browse Robots (2026-04-27)

This pass addressed the remaining codeable SEO/canonical backlog without requiring a listing/seller slug schema migration.

### Fixed in this pass
- **Readable public listing URLs**: `publicListingPath()` emits `/listing/{id}--{slug}` paths, while the listing page still accepts legacy `/listing/{id}` URLs by extracting the database ID before querying.
- **Readable public seller URLs**: `publicSellerPath()` and `publicSellerShopPath()` emit `/seller/{id}--{slug}` and `/seller/{id}--{slug}/shop`; seller profile/shop pages accept both slugged and legacy CUID-only paths.
- **Canonical metadata moved to slugged paths**: listing, seller, and seller shop metadata point search engines at readable canonical URLs while preserving existing links.
- **Sitemap emits readable URLs**: listing and seller sitemap entries now include title/display-name slugs with last-modified data preserved.
- **Listing cards use readable URLs**: the shared card component links listing and seller cards through the same public path helpers.
- **Browse filter canonicals tightened**: browse search/filter/sort/pagination/location/tag variants are `noindex, follow` and canonicalize to `/browse` or the first-page category URL; only base browse and first-page category browse remain indexable.
- **Path helper tests added**: Node tests cover diacritic slug normalization, non-Latin fallback slugs, slugged listing/seller path generation, and legacy/slugged ID extraction.
- **Open backlog updated**: `audit_open_findings.md` now marks browse canonical/noindex fixed and CUID slug work partially closed for public canonical surfaces.

### Verification
- `git diff --check` ✅
- `npx tsc --noEmit --incremental false` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm test` ✅ (13 tests)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

## Audit Fix Pass — Public URL Link Cleanup (2026-04-27)

This follow-up widened the readable URL rollout from canonical metadata/cards into more user-visible surfaces.

### Fixed in this pass
- **Homepage and hero mosaic use readable listing/seller URLs**: maker feed cards, Meet a Maker links, featured listing tiles, and animated mosaic anchors now call the public path helpers.
- **Public editorial/map surfaces use readable URLs**: blog featured listings, blog maker author links, commission interested-maker links, metro maker cards, and map popups now emit slugged seller/listing paths where names are available.
- **Buyer-facing account/cart/order surfaces use readable listing URLs**: saved/reviewed/following/feed/cart/order/success links now prefer `/listing/{id}--{slug}` paths.
- **Transactional email CTAs use readable URLs**: custom-order-ready, back-in-stock, Guild approval, and first-listing emails now use slugged listing/seller paths.
- **Purchase and message redirects preserve readable URLs**: sign-in redirects for buy/add/notify flows and custom-order message cards now use the same listing path helper.

### Verification
- `git diff --check` ✅
- `npx tsc --noEmit --incremental false` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm test` ✅ (13 tests)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

## Audit Fix Pass — Public URL Link Cleanup II (2026-04-27)

This follow-up finished the known route-wide readable-link cleanup for app-generated listing/seller links that already have title/display-name context.

### Fixed in this pass
- **Notification payloads use readable URLs**: favorite, review, back-in-stock, custom-order, listing-approval, Guild approval, and followed-maker listing notifications now use public path helpers.
- **Seller listing creation flows redirect to readable URLs**: new listing, draft preview, custom listing preview, and edit-save redirects now preserve slugged listing paths.
- **Dashboard buyer/seller surfaces use readable links**: dashboard home, analytics, order detail/list, sales detail/list, seller settings, and profile public-link CTAs now emit readable listing/seller/shop paths.
- **Admin contextual links use readable paths where resolvable**: review queues, review admin, broadcast admin, report context links, and admin order detail now resolve known listing/seller labels before linking.
- **Legacy fallbacks remain**: ID-only admin report targets still fall back to legacy `/listing/{id}` or `/seller/{id}` when the target record cannot be resolved.

### Verification
- `rg` found no remaining app-generated raw listing/seller href or notification/email link patterns outside legacy fallbacks/revalidation paths.
- `git diff --check` ✅
- `npx tsc --noEmit --incremental false` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm test` ✅ (13 tests)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

## Audit Fix Pass — Admin Feedback Cleanup (2026-04-27)

This pass closed two remaining admin feedback gaps without changing admin permissions or verification criteria.

### Fixed in this pass
- **Guild Master approval failures surface inline**: `/admin/verification` now uses the shared `ActionForm` for Guild Master approvals. If live metrics fail server-side, the pending application card shows the exact failed requirements instead of silently no-oping.
- **Admin PIN lockout countdown updates live**: `AdminPinGate` now rerenders from the server `Retry-After` lockout clock instead of showing a static retry time until the lock expires.
- **Stale follow-up notes removed**: older "still open" notes for Guild Member inline failures, multi-seller admin order display, Sentry filtering, and AdminPinGate timing were updated to match the current code.

### Verification
- `git diff --check` ✅
- `npx tsc --noEmit --incremental false` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm test` ✅ (16 tests)

## Audit Fix Pass — Test Harness Expansion (2026-04-27)

This pass added dependency-light regression tests for two high-risk pure helper areas without requiring database fixtures.

### Fixed in this pass
- **Cron bearer auth is tested**: `tests/cron-auth.test.mjs` verifies that cron routes fail closed when `CRON_SECRET` is missing and accept only an exact `Bearer` token.
- **Listing variant resolution is tested**: `tests/listing-variants.test.mjs` covers variant price adjustment snapshots, stable variant keys, exactly-one-option-per-group validation, duplicate IDs, invalid IDs, and out-of-stock options.

### Verification
- `npm test` ✅ (21 tests)

## Audit Fix Pass — CI Test Harness Baseline (2026-04-27)

This pass addressed the early audit finding that the project had no real test suite. It intentionally starts with a small, dependency-light baseline that CI can run consistently.

### Fixed in this pass
- **`npm test` added**: the project now runs Node's built-in test runner with TypeScript stripping enabled for targeted unit tests.
- **CI test step added**: GitHub Actions now runs `npm test` between lint and build.
- **Shipping-rate token behavior covered**: `tests/shipping-token.test.mjs` verifies same-buyer signed-rate validation, cross-buyer replay rejection, tampered amount/context/postal rejection, expired tokens, and malformed tokens.
- **Open backlog updated**: `audit_open_findings.md` now marks the "zero real test suite" item as partially closed instead of unresolved.

### Verification
- `npm test` ✅

### Still open / next good passes
- Add route/integration coverage for payment, webhook, refund, and account-state paths.
- Add regression tests for unsubscribe token lifecycle and notification dedup once DB-backed test helpers exist.

## Audit Fix Pass — Seller Rating Summary for Browse Scale (2026-04-27)

This pass closed the browse rating-filter scale finding without changing buyer-facing filter semantics.

### Fixed in this pass
- **Persisted seller rating summaries**: added `SellerRatingSummary` with `averageRating`, `reviewCount`, and a rating/count index.
- **Existing reviews backfilled**: migration `20260427110000_seller_rating_summary` seeds summaries from current `Review -> Listing -> SellerProfile` data.
- **Browse rating filters avoid full review scans**: `/browse` now filters through `seller.ratingSummary` instead of running a grouped `Review` aggregate on every request.
- **Listing-card seller ratings avoid per-request aggregation**: browse and homepage cards read the summary table through `getSellerRatingMap()`.
- **Quality-score rating lookup avoids per-listing review aggregates**: the quality-score listing batch joins `SellerRatingSummary` instead of running a lateral review aggregate per listing.
- **Review mutations refresh summaries**: review create/edit/delete/admin-delete paths refresh the affected seller's summary, and admin review deletion now also removes associated R2 review photos.
- **Open backlog updated**: `audit_open_findings.md` now marks the browse rating filter review-scan item fixed.

### Verification
- `npx prisma validate` ✅
- `npx prisma generate` ✅
- `git diff --check` ✅
- `npx tsc --noEmit --incremental false` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm test` ✅
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

### Still open / next good passes
- Larger listing-detail query shaping remains open.
- Seller/listing slug and canonical URL strategy remains open.

## Audit Fix Pass — Promptless Admin Flows, Multi-Receipt Checkout, and Touch Targets (2026-04-26)

This pass closed several still-live lower/medium-priority backlog items after the production deploy for `2f0071c`.

### Fixed in this pass
- **Admin flows no longer use blocking browser prompts**: listing rejection, audit undo, and ban/unban now collect required reasons through inline forms with validation and cancel paths.
- **Blog markdown link insertion is promptless**: `MarkdownToolbar` now uses an inline URL field with Apply/Remove/Cancel controls while retaining safe-link normalization.
- **Checkout lock errors are explicit**: cart checkout APIs now tell buyers that an existing Stripe checkout reservation expires after up to 31 minutes.
- **Multi-seller checkout success shows all receipts**: cart completion passes all session IDs to `/checkout/success`; the success page renders every matching buyer order and shows a processing notice while remaining webhook-created orders arrive.
- **Small touch targets improved**: message attachment remove, gallery upload remove, commission reference-image remove, and message attachment controls now have larger interaction areas.
- **Mobile filter controls meet touch-target sizing**: filter/sort trigger buttons, sheet inputs/selects, and tag chips now have 44px minimum target sizing, with white trigger backgrounds so the bar does not visually merge into the page.
- **Open backlog updated**: `audit_open_findings.md` now marks the admin prompt, multi-seller receipt, markdown prompt, and checkout lock messaging items fixed or partially fixed where a larger cancel/release endpoint remains a product design.

### Verification
- `git diff --check` ✅
- `npx prisma validate` ✅
- `npx tsc --noEmit --incremental false` ✅

### Still open / next good passes
- Broader route-level skeleton polish can continue as pages evolve, but the main dynamic route groups now have baseline loading states.
- Larger SEO slug/canonical work and browse rating aggregate strategy remain open.

## Audit Fix Pass — Route Loading Skeleton Coverage (2026-04-26)

This pass closed the remaining loading-state coverage finding with a shared route skeleton.

### Fixed in this pass
- **Shared loading skeleton component added**: `PageLoadingSkeleton` supports grid, table/list, and detail layouts.
- **Main dynamic route groups now have loading states**: account, admin, blog, commission, dashboard, map, messages, and seller profile routes now render consistent skeletons while server data loads.
- **Onboarding avatar drafts persist across step navigation**: `ProfileAvatarUploader` supports an optional `storageKey`; the onboarding wizard uses session storage to preserve a step-1 uploaded avatar URL until the profile step is saved.
- **Open backlog updated**: `audit_open_findings.md` now marks loading skeleton coverage fixed for the major app surfaces.

### Verification
- `git diff --check` ✅
- `npx tsc --noEmit --incremental false` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)

### Still open / next good passes
- Larger SEO slug/canonical work and browse rating aggregate strategy remain open.

## Audit Fix Pass — Tracking Cookies, Search Scale, and Stale Backlog Cleanup (2026-04-26)

This pass closed several remaining Round 19-21 and stale audit-backlog items after verifying that many listed findings had already been fixed in code.

### Fixed in this pass
- **Listing analytics cookies no longer grow without bound**: `/api/listings/[id]/view` and `/api/listings/[id]/click` now use compact 24h aggregate httpOnly cookies (`viewed_listing_ids`, `clicked_listing_ids`) capped at 50 listing IDs each. Legacy per-listing cookies are migrated into the aggregate cookie and expired when encountered.
- **Search tag suggestions no longer unnest tags per request**: `/api/search/suggestions` and browse partial-tag matching now use cached `getPopularListingTags()` results instead of `Listing x unnest(tags)` scans on every request.
- **Guild cron revokes are stale-state guarded**: Guild Master and Guild Member cron revocations now use `updateMany` predicates on the current `guildLevel`; notifications/emails are skipped if an admin changed the seller state concurrently.
- **Blog featured listings are re-verified at render time**: blog post featured listings now pass through `publicListingWhere()` and seller-authored posts also re-check listing ownership by `sellerProfileId`.
- **TypeScript target updated**: `tsconfig.json` now targets `ES2022` instead of `ES2017`.
- **Launch checklist tightened**: production checklist now includes `UNSUBSCRIBE_SECRET`, `SENTRY_DSN`, `RESEND_WEBHOOK_SECRET`, and explicit Clerk/Stripe/Resend webhook endpoint/event requirements.
- **Stale backlog reconciled**: `audit_open_findings.md` now marks already-fixed items around admin forms, onboarding Stripe status, sitemap chunking, delayed payment methods, presign extension allowlists, health-check docs, reverse-geocode Redis throttling, and cron UTC documentation.

### Verification
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npx tsc --noEmit --incremental false` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; existing warnings only: middleware convention deprecation, pg SSL-mode advisory, edge-runtime static-generation warning.

### Still open / next good passes
- Add actual route tests for payment/webhook/refund/account-state flows.
- Browse rating filter still needs a materialized/aggregate strategy.
- Remaining product/legal decisions: partial-refund inventory semantics, seller public-content retention, insurance/INFORM/attorney sign-off.

## Audit Fix Pass — CI, Search Scale, and Locale Polish (2026-04-26)

This pass targeted remaining lower-risk backlog items after the production retention/payout deploy.

### Fixed in this pass
- **CI is blocking again**: `.github/workflows/ci.yml` now runs `npm ci --ignore-scripts`, Prisma generate, TypeScript, `npm run lint`, `npm run build`, and `npm audit --audit-level=high` without `continue-on-error`.
- **Popular listing tags share one cached query**: `src/lib/popularTags.ts` exposes `getPopularListingTags()` via `unstable_cache`; browse, home, and `/api/search/popular-tags` now reuse it instead of duplicating DB scans.
- **Search scale indexes added**: migration `20260426191000_search_scale_indexes` enables `pg_trgm` and adds GIN indexes for active listing title similarity, published blog title similarity, and listing tags.
- **Explicit locale formatting**: remaining app/component `toLocaleString()` and `toLocaleDateString()` calls without a locale were normalized to `en-US` so server/client rendering does not drift by host default locale.
- **Backlog updated**: `audit_open_findings.md` now marks the CI build/lint enforcement, popular tags shared cache, featured-maker cache, trigram indexes, and explicit-locale sweep as fixed.

### Verification
- `npx prisma validate` ✅
- `npx prisma generate` ✅
- `npx tsc --noEmit --incremental false` ✅
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing upstream jsx-ast-utils resolver notices only)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding
- `npm audit --audit-level=high` ✅ (moderate advisories remain documented/non-blocking)

## Audit Fix Pass — Retention, Payout Ledger, and Photo Mutation Hardening (2026-04-26)

This pass continued the remaining R19-R21 medium/high backlog after the scale and deletion passes.

### Fixed in this pass
- **Periodic fulfilled-order buyer PII pruning**: added `GET /api/cron/order-pii-prune`, protected by `verifyCronRequest()` and `CronRun`, scheduled daily at `45 7 * * *`. It removes buyer street/contact/gift-note fields from delivered/picked-up orders after 90 days, stamps `Order.buyerDataPurgedAt`, and uses bounded SQL batches.
- **Order views handle purged buyer data**: buyer, seller, and admin order detail views show a retention notice when shipping/contact details were purged instead of rendering partial addresses.
- **Durable payout failure ledger**: added `SellerPayoutEvent`; Stripe `payout.failed` now upserts a durable event row and still sends a `PAYOUT_FAILED` notification. Seller settings now reads recent payout failures from the ledger rather than relying only on dismissible notifications.
- **Refund/report notification types**: added `REFUND_ISSUED`, `ACCOUNT_WARNING`, and `LISTING_FLAGGED_BY_USER` to `NotificationType`; refund routes use `REFUND_ISSUED`, and listing reports create a deduped seller notification without exposing reporter identity.
- **Photo mutation hardening**: listing photo AI review has a dedicated `listingPhotoAiRatelimit`; manual alt-text saves are sanitized, capped to 200 chars, and constrained to the listing; photo reordering now only updates photos belonging to the edited listing.
- **Open backlog updated**: `audit_open_findings.md` now marks missing notification types, photo-AI rate limiting, periodic fulfilled-order PII pruning, and payout-failure durability as fixed or partially fixed where legal/product decisions remain.

### Verification
- `npx prisma format` ✅
- `npx prisma generate` ✅
- `npx prisma validate` ✅
- `npx tsc --noEmit --incremental false` ✅
- `git diff --check` ✅

## Audit Fix Pass — Round 22 GDPR + Fan-Out + Media Origin Cleanup (2026-04-26)

This pass continued the remaining R19-R21 backlog with concrete fixes across high/medium/low priority items.

### Fixed in this pass
- **Account deletion PII scrubbing widened**: `anonymizeUserAccount()` now scrubs deleted-user sent messages and case messages, buyer order contact/shipping/gift fields, review comments/photos, buyer commission request text/media/location, maker verification text/portfolio/review notes, report details, and seller listing text/photos/media.
- **Buyer order PII purge is auditable**: `Order.buyerDataPurgedAt` was added and stamped when buyer-side order PII is removed during account deletion.
- **Deleted account media cleanup**: account deletion now collects listing, seller profile, review, and commission media URLs and best-effort deletes matching R2 objects after the DB transaction. `extractR2KeyFromUrl()` supports all configured Grainline R2/CDN public origins, not only one env URL.
- **Block retention tightened**: deletion removes blocks created by the deleted user, but preserves records where other users blocked that account.
- **Follower fan-out concurrency bounded**: listing publish, blog publish/edit, seller broadcast, and back-in-stock fan-outs now use `mapWithConcurrency()` instead of large `Promise.allSettled()` bursts.
- **R2 origin acceptance narrowed**: write-path media validation no longer accepts arbitrary `*.r2.dev`; legacy R2 public origins must be explicitly configured via allowed R2 public URL env vars. CSP now emits configured R2/CDN origins instead of wildcard R2 media/connect sources.
- **Follow UI optimistic update**: `FollowButton` now updates immediately and rolls back on API/network failure.
- **Baseline focus-visible outline**: global CSS now provides a default focus-visible outline for interactive controls.
- **LocalDate locale fixed**: client-side date formatting uses explicit `en-US`.

### Migration
- `20260426162000_order_buyer_data_purged_at` adds `Order.buyerDataPurgedAt` and an index.

### Still open / next good passes
- Periodic old fulfilled-order PII pruning outside explicit account deletion.
- Durable notification/email outbox semantics for very large fan-outs.
- Product/legal retention schedule for cases, reports, order records, and preserved public content.

## Audit Fix Pass — Round 21 Verification + Scale Guardrails (2026-04-26)

This pass closed the live Round 21 regressions plus several earlier R19/R20 medium/high items that were still open in code.

### Fixed in this pass
- **Admin Guild Master verification no longer recalculates metrics for every applicant during page render**: `/admin/verification` now reads cached `SellerMetrics`; the approve server action still recalculates live metrics before changing status.
- **Guild metric period handling tightened**: `calculateSellerMetrics()` now uses calendar-month subtraction and scopes active case count to the metrics period instead of lifetime active cases.
- **Seller analytics corrected**: top-listing `avgPriceCents` is now quantity-weighted, and the duplicate legacy `viewToClickRatio` response field was removed in favor of `clickThroughRate`.
- **Delayed payment methods explicitly disabled**: both checkout session creation routes set `payment_method_types: ["card"]`; ACH/SEPA-style `payment_intent.processing` handlers are not needed for the current card-only product.
- **Account export endpoint added**: `/api/account/export` supports signed-in GET/POST JSON downloads with user, seller, listing, order, message, review, blog, cart, saved, follow, commission, case, and notification data. Seller-side sales exports omit buyer shipping/contact PII.
- **Reverse-geocode throttle made cross-lambda**: Nominatim calls now coordinate through Redis with a local fallback, preserving the 1 request/sec policy across serverless instances.
- **Review photo R2 cleanup added**: replacing or deleting review photos now attempts R2 object deletion after the DB mutation.
- **MapLibre bundle splitting extended**: seller profile pages now use `DynamicMapCard`; listing detail already did.
- **Featured maker fallback cached**: homepage featured maker selection is cached for one hour and invalidated when admins feature/unfeature a maker.
- **Onboarding UX tightened**: step 3 explicitly tells sellers Stripe is required before completing onboarding/publishing, and the Step 4 create-listing link advances persisted onboarding state.
- **Listing edit/delete AI review paths hardened**: edit and delete-photo re-review now use cover-order photos (`sortOrder asc`), not newest-upload order.
- **AI reactivation race guards added**: edit, photo-add/delete, and custom-listing activation paths use guarded `updateMany` with `updatedAt`/status checks before moving listings back to `ACTIVE`.
- **Substantive edit detection widened**: tags, materials, meta description, product dimensions, listing type, stock, shipping/processing windows, and variants now trigger AI re-review on active listings.
- **Photo-add alt-text cost reduced**: new photo alt text is generated only after an active listing is re-approved, not while held in pending review.
- **Cron retry deadlock fixed**: failed cron runs older than five minutes can be reclaimed by Vercel retry instead of returning `cron_run_already_claimed` forever.
- **Cron pool pressure reduced**: Guild metric cron seller concurrency was reduced from 5 to 3, capping the current `calculateSellerMetrics()` fan-out at 15 concurrent queries instead of 25.
- **Quality-score global means materialized**: added `SiteMetricsSnapshot`, `/api/cron/site-metrics-snapshot`, and quality-score reads from the snapshot instead of scanning global order/review facts during every quality-score run.
- **Sitemap listing chunking added**: `generateSitemaps()` now emits 5K-listing chunks instead of putting all listing URLs into one sitemap response.
- **Hot-path indexes added**: migration `20260426145000_hot_path_scale_indexes` adds partial/compound indexes for visible quality-score browse, buyer paid order timelines, message threads, banned/deleted user joins, and payment-event dispute lookups.

### Verification
- `git diff --check` ✅
- `npx prisma validate` ✅
- `npx prisma generate` ✅
- `npx tsc --noEmit --incremental false` ✅

### Still open / next good passes
- Switch `DATABASE_URL` in Vercel to the Neon pooler endpoint; keep `DIRECT_URL` direct for migrations.
- Durable notification/email outbox semantics for very large follower fan-outs.
- Broader GDPR scrubbing of old message/listing/order PII beyond the new export endpoint.
- Partial refund line-item inventory semantics still need a product decision.

## Audit Fix Pass — Admin/Dashboard Correctness Sweep (2026-04-26)

This pass closed several Round 13 admin/dashboard UX and data-integrity findings without schema changes.

### Fixed in this pass
- **Admin order actions return inline state**: `markReviewed` and `appendNote` now return `{ ok, error }` state through a client action form, avoiding raw server-action crash pages.
- **Order review notes are bounded**: note appends are capped at 2,000 characters each and 10,000 characters total per order.
- **Audit log is filterable**: `/admin/audit` now supports an action filter and preserves it through pagination.
- **Undo controls are explicit**: non-undoable audit actions render as `Not undoable`; undoability is centralized in `lib/audit`.
- **Admin undo is rate-limited**: `/api/admin/audit/[id]/undo` now uses the admin action rate limiter.
- **Vacation mode save errors surface**: the seller vacation form now shows failed saves and `Retry-After` rate-limit timing inline.
- **Inventory stock saves serialize per row**: the inventory UI blocks repeat saves/edits while a stock save is in flight.
- **Seller order subtotal is seller-scoped**: the seller order detail page now renders the seller-owned item subtotal instead of falling back to the full order item subtotal.
- **Admin sellers cannot self-feature**: `featureMaker` skips attempts to feature the current admin's own seller profile.
- **Open backlog updated**: `audit_open_findings.md` now marks the corresponding admin/dashboard bullets fixed.

### Verification
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

### Still open / next good passes
- GDPR deletion retention policy and long-term outbox semantics remain high-value future batches.

## Audit Fix Pass — Case/Message Safety Sweep (2026-04-26)

This pass closed several medium-priority client/server mismatch and spoofing findings around case workflows and message previews.

### Fixed in this pass
- **Case reply spinner cannot stick on empty responses**: `CaseReplyBox` now tolerates non-JSON/empty error responses and always clears loading on failure.
- **Open case form handles bad responses**: `OpenCaseForm` now handles empty/non-JSON error responses instead of throwing while loading.
- **Case description minimum is server-enforced**: `POST /api/cases` trims and rejects descriptions shorter than 20 characters, matching the client rule.
- **Inbox previews no longer infer structured cards from arbitrary JSON**: `/messages` selects `Message.kind` and only shows structured preview labels for persisted structured message kinds.
- **Markdown links reject unsafe protocols**: `MarkdownToolbar` normalizes `http`, `https`, `mailto`, and internal links, and rejects unsafe values such as `javascript:` before insertion.
- **Open backlog updated**: `audit_open_findings.md` now marks the corresponding medium/low findings fixed.

### Verification
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

## Audit Fix Pass — Resend Webhook Replay + Account Deletion Cleanup (2026-04-26)

This pass closed two contained email/privacy items from the Round 16-18 backlog.

### Fixed in this pass
- **Resend webhook replay protection**: `/api/resend/webhook` now records verified `svix-id` values in `ResendWebhookEvent`, ignores processed replays, and allows failed attempts to retry instead of double-processing.
- **Transient Resend failures tracked**: `email.failed` and `email.delivery_delayed` events update `EmailFailureCount`; 3 failures in 30 days suppress the recipient with source `resend_transient_failure`.
- **Newsletter suppression item verified stale**: `/api/newsletter` already checks `isEmailSuppressed(email)` before reactivating subscribers.
- **Admin PIN fallback item verified stale**: production admin PIN cookies already require `ADMIN_PIN_COOKIE_SECRET`; only non-production uses an ephemeral fallback.
- **Account deletion rejects Stripe Connect accounts**: `anonymizeUserAccount()` now attempts `stripe.accounts.reject(..., { reason: "other" })` before local seller anonymization/nulling and captures failures to Sentry.
- **Account deletion removes newsletter subscriber PII**: deletion now removes the `NewsletterSubscriber` row and keeps only an `EmailSuppression` record with reason `MANUAL` and source `account_deletion`.
- **Blog post cascade finding not reproduced**: existing migrations use `ON DELETE RESTRICT` for `BlogPost.authorId`, and account deletion anonymizes rather than hard-deletes the user row.
- **Deleted review authors anonymized in UI**: public reviews now render deleted reviewers as `Former buyer`, avoid deleted-email initials/avatar fallback, and hide report/block controls for already-deleted reviewer accounts.
- **Open backlog updated**: `audit_open_findings.md` now marks H24, H25, H27, H30, H31, and H33 as fixed, with H32 marked not reproduced.

### Verification
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding
- `npx prisma migrate deploy` ✅ applied `20260426083000_resend_webhook_replay_and_failures`

### Still open / next good passes
- Account export endpoint and broader GDPR scrubbing.
- Blog deleted-author public display policy.
- Refund tax/reverse-transfer accounting and refund idempotency.

## Audit Fix Pass — Account-State + Refund Accounting Sweep (2026-04-26)

This pass closed several high-priority leftovers from the Round 16-18 fix backlog.

### Fixed in this pass
- **Refund tax accounting was centralized in `createMarketplaceRefund()`**: this pass originally split tax from seller transfer reversal. That model was superseded on 2026-05-06 after Stripe test-mode replay showed split full refunds under-reverse manual `transfer_data.amount` destination-charge transfers. Current behavior is one full-charge `reverse_transfer` refund for connected-seller full refunds.
- **Refunds survive disconnected sellers**: if the seller profile no longer has a Stripe account, seller/case refunds fall back to a platform-funded refund and write a manual reconciliation note instead of getting stuck on the pending lock.
- **Post-Stripe orphan reconciliation remains route-owned**: the old multi-step partial-failure helper was removed on 2026-05-06 when refunds became single-step. If Stripe returns a refund ID and later DB work fails, the seller/case routes still mark the order for manual reconciliation before rethrowing.
- **Transactional email skips inactive accounts**: `src/lib/email.ts` now checks suppression and then skips recipients whose user account is banned or deleted before calling Resend.
- **Account-state enforcement widened**: blog save/unsave, listing stock mutation, review creation, and shipping quote now use the shared active-user guard. Previously verified guarded routes include notify/follow/refund/notifications/favorites/saved search.
- **Back-in-stock fan-out is idempotent**: stock restock notifications now claim subscribers with `DELETE ... RETURNING` before sending, preventing duplicate notifications under rapid restock races.
- **Cart checkout rejects stale prices**: `/api/cart/checkout-seller` compares live variant-adjusted price with the cart snapshot and returns HTTP 409 `PRICE_CHANGED` before Stripe session creation.
- **Open backlog updated**: `audit_open_findings.md` now marks C13, H3-H5, H9, and H10 fixed, and H6 not reproduced under the current single-refund invariant.

### Verification
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

### Still open / next good passes
- Cron idempotency/run keys.
- Account export endpoint and broader GDPR message/order/listing PII scrubbing.
- Remaining admin/dashboard correctness items.

## Audit Fix Pass — Cron Run Idempotency (2026-04-26)

This pass closed the Vercel retry/double-run risk for scheduled jobs.

### Fixed in this pass
- **Added durable cron run claims**: `CronRun` records one deterministic run ID per cron job per UTC hour.
- **All Vercel cron routes are guarded**: quality-score, guild-metrics, guild-member-check, case-auto-close, commission-expire, and notification-prune now claim a run before side effects.
- **Retries return skipped success**: a duplicate run in the same UTC-hour bucket returns `{ ok: true, skipped: true, reason: "cron_run_already_claimed" }` instead of replaying warnings, revocations, notifications, deletes, or quality-score writes.
- **Run outcomes are recorded**: successful jobs store a JSON result and `COMPLETED`; failed jobs store `FAILED` with a sanitized error message.
- **Open backlog updated**: `audit_open_findings.md` now marks H22 fixed.

### Verification
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

### Still open / next good passes
- Remaining cron per-record isolation outside the Guild cron routes.
- Account export endpoint and broader GDPR message/order/listing PII scrubbing.

## Audit Fix Pass — Cron Scale Guardrails (2026-04-25)

This pass closed the bounded cron memory and cleanup issues from the Round 16-18 backlog.

### Fixed in this pass
- **Quality-score cron no longer loads every active listing at once**: `src/lib/quality-score.ts` now cursor-paginates active, visible listings by listing ID and updates each score batch immediately.
- **Guild metrics cron no longer loads every Guild seller at once**: `/api/cron/guild-metrics` now cursor-paginates seller profiles in pages of 50 and processes only 5 sellers concurrently.
- **Guild member check cron no longer loads every Guild Member at once**: `/api/cron/guild-member-check` now uses the same 50-row cursor pages and bounded 5-seller concurrency.
- **Guild metrics per-seller failures are isolated**: one seller metric failure no longer stops the cron page; full details go to Sentry and the JSON response returns sanitized error codes only.
- **Guild member check per-seller failures are isolated**: revocation checks now return sanitized error codes and capture full failures to Sentry without stopping the whole run.
- **ListingViewDaily cleanup is chunked**: old analytics rows are deleted in 1,000-row SQL chunks instead of one unbounded `deleteMany`.
- **Notification prune is chunked**: read notifications older than 90 days are deleted in 1,000-row SQL chunks with a 45-second budget so the cron can resume on the next run instead of taking a long table lock.
- **Open backlog updated**: `audit_open_findings.md` now marks H19-H21 fixed, and H23 partially fixed for the Guild cron surfaces.

### Verification
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

### Still open / next good passes
- Cron idempotency run keys are still open across cron routes.
- Refund tax/reverse-transfer accounting decision.

## Audit Fix Pass — Fulfillment Case Race Guard (2026-04-25)

This pass closed the remaining fulfillment/case race from the Round 18 race-condition list.

### Fixed in this pass
- **Fulfillment updates now atomically reject active cases**: `POST /api/orders/[id]/fulfillment` keeps the existing preflight check for user-facing errors, but also includes `case IS NULL OR case.status NOT IN active statuses` in the `updateMany` predicate. If a buyer opens a case between the preflight read and the seller's fulfillment write, the update now returns a 409 instead of marking the order shipped/picked up.
- **Active case status list centralized**: the route now uses the Prisma `CaseStatus` enum for the OPEN / IN_DISCUSSION / PENDING_CLOSE / UNDER_REVIEW set.
- **Open backlog updated**: `audit_open_findings.md` now marks H18 fixed.

### Verification
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

### Still open / next good passes
- Refund tax/reverse-transfer accounting decision.
- Cron idempotency run keys across cron routes.

## Audit Fix Pass — Admin Destructive Role Gate (2026-04-25)

This pass closed the Round 16 high-priority role boundary finding for destructive admin actions.

### Fixed in this pass
- **Listing removal now requires ADMIN**: `DELETE /api/admin/listings/[id]` no longer accepts `EMPLOYEE`; employees can still use listing review approve/reject flows.
- **Review deletion now requires ADMIN**: `DELETE /api/admin/reviews/[id]` no longer accepts `EMPLOYEE`.
- **Open backlog updated**: `audit_open_findings.md` now marks H26 fixed.

### Verification
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

### Still open / next good passes
- Refund tax/reverse-transfer accounting decision.
- Admin PIN shared-IP limiter tuning.

## Audit Fix Pass — Admin PIN Shared-IP Limit Tuning (2026-04-25)

This pass closed the shared-office lockout issue in the admin PIN verifier.

### Fixed in this pass
- **Admin PIN user limiter remains strict**: each staff account still gets 5 attempts per 15 minutes.
- **Admin PIN IP limiter is now bot-flood scoped**: the source-IP limiter now uses a separate 50 attempts per 15 minutes bucket, preventing one shared office/network IP from locking every admin after five total attempts.
- **Open backlog updated**: `audit_open_findings.md` now marks H28 fixed.

### Verification
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

### Still open / next good passes
- Refund tax/reverse-transfer accounting is handled by marketplace split refunds; remaining refund work is limited to product decisions around partial line-item inventory.

## Audit Fix Pass — Notification Dedup + Saved Listing Visibility (2026-04-25)

This pass closed the shared notification dedup gap and one saved-items visibility issue from the later audit backlog.

### Fixed in this pass
- **Notification dedup is database-enforced**: `Notification` has a required `dedupKey` plus a unique constraint on `(userId, type, dedupKey)`, added by migrations `20260426043000_notification_dedup_keys` and `20260426143000_notification_dedup_not_null`.
- **`createNotification()` owns dedup semantics**: the helper computes a daily SHA-256 dedup key from recipient, type, and link; duplicate insert races return the existing notification instead of throwing or creating duplicates. Title/body are deliberately excluded so copy changes do not bypass dedup.
- **Favorites/follows no longer use fuzzy dedup**: removed route-local notification dedup based only on listing link or follower-name substring. Legitimate distinct users are no longer suppressed by imprecise text matching.
- **Saved listing count/cards share the same visibility filter**: `/account/saved` now hides private, draft/rejected/hidden, unpayable, vacation, banned/deleted-seller, and blocked-seller listings from both total count and card query so saved items do not link to broken or unavailable listings.
- **Open backlog updated**: `audit_open_findings.md` now marks H8 fixed and notes that `/account/saved` broken-link behavior is closed.

### Verification
- `npx prisma validate` ✅
- `npx prisma generate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)

### Still open / next good passes
- Durable notification/email outbox semantics for very large follower bases.

## Audit Fix Pass — Checkout Session Webhook Serialization (2026-04-25)

This pass closed the Stripe completed/expired session race and the duplicate completed-session side-effect path without changing checkout UX.

### Fixed in this pass
- **Completed checkout mutations are session-locked**: cart and single-listing completed checkout order-creation transactions now take `pg_advisory_xact_lock(913337, hashtext(sessionId))` before creating orders or marking listings sold out.
- **Expired/async-failed stock restore is session-locked**: `checkout.session.expired` and `checkout.session.async_payment_failed` restore stock inside the same advisory lock namespace and re-check `Order.stripeSessionId` after taking the lock.
- **Racing duplicate completed events skip side effects**: completed handlers now re-check for an existing order inside the locked transaction. If another delivery already created the order, the losing execution returns before buyer/seller notifications or emails.
- **Open backlog updated**: `audit_open_findings.md` now marks C10 and C11 fixed.

### Verification
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)

### Still open / next good passes
- Refund tax/reverse-transfer accounting decision.
- Refund idempotency key collision on identical partial refunds.
- Dispute/refund race checks.
- Broader GDPR account-deletion/export work.

## Audit Fix Pass — Seller Refund Dispute Guard (2026-04-25)

This pass closed the specific seller-refund/dispute race without changing normal refund behavior.

### Fixed in this pass
- **Seller refunds block on open Stripe disputes**: `/api/orders/[id]/refund` now checks the latest local `OrderPaymentEvent` with `eventType = DISPUTE` before claiming the refund lock.
- **Closed disputes remain refundable**: statuses `won`, `lost`, and `warning_closed` are treated as terminal; other dispute statuses return HTTP 409 with a clear message.
- **Open backlog updated**: `audit_open_findings.md` now marks H7 fixed.

### Verification
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)

### Still open / next good passes
- Refund tax/reverse-transfer accounting decision.
- Refund idempotency key collision on identical partial refunds.
- Broader GDPR account-deletion/export work.

## Audit Fix Pass — Refund Pending Lock Cleanup (2026-04-25)

This pass closed the confirmed refund `"pending"` sentinel leak and made refund locks recoverable. The remaining refund/payment work is still meaningful, but the specific UI leak and permanent-lock class are now addressed.

### Fixed in this pass
- **Refund locks now have timestamps**: added `Order.sellerRefundLockedAt` plus an index on `(sellerRefundId, sellerRefundLockedAt)` and migration `20260426032500_refund_lock_timestamps`.
- **Existing pending locks are timestamped by migration**: any existing `sellerRefundId = 'pending'` rows get `sellerRefundLockedAt = CURRENT_TIMESTAMP`, allowing normal stale-lock cleanup afterward.
- **Seller refund route reclaims stale locks**: `/api/orders/[id]/refund` clears `"pending"` locks older than 5 minutes before checking/claiming a refund slot.
- **Case resolve route reclaims stale locks**: `/api/cases/[id]/resolve` clears stale refund locks before resolving/refunding.
- **Daily cron reclaims stale locks**: `/api/cron/notification-prune` now also reports and releases stale refund locks.
- **All refund success/error paths clear lock timestamps**: successful seller refunds, case refunds, Stripe webhook refund confirmations, orphaned-refund reconciliation, and failed Stripe calls now set `sellerRefundLockedAt: null`.
- **Seller UI no longer leaks `pending` as a Stripe ID**: `SellerRefundPanel` renders `"Refund processing"` for the lock state and never shows `Stripe refund ID: pending`.
- **Buyer/seller order totals ignore pending locks**: order pages now treat only real refund IDs or case refund IDs as issued refunds.
- **Admin order view handles pending explicitly**: admin totals show `"Seller refund processing"` instead of a fake refund ID/amount.
- **Open backlog updated**: `audit_open_findings.md` now marks C1-C6 as fixed.

### Verification
- `npx prisma validate` ✅
- `npx prisma generate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding
- `npx prisma migrate deploy` ✅ (applied `20260426032500_refund_lock_timestamps`)

### Still open / next good passes
- Stripe refund tax/reverse-transfer accounting.
- Refund idempotency key collision on identical partial refunds.
- Dispute/refund race checks.
- Webhook completed/expired stock race serialization.

## Audit Fix Pass — Listing Moderation State Invariants (2026-04-25)

This pass closed the live listing-moderation gaps from the Round 13-18 backlog. The goal was to make all seller-controlled publish/edit/photo paths fail closed to review instead of briefly exposing unreviewed content.

### Fixed in this pass
- **New listings no longer go public before AI review**: `/dashboard/listings/new` now creates non-draft listings as `PENDING_REVIEW`; only AI-approved, zero-flag, confidence >= 0.8 listings are activated.
- **Custom listings no longer start as active before moderation**: `/dashboard/listings/custom` now creates private custom listings as `PENDING_REVIEW` and sends the buyer link only after AI approval. Held custom listings open only in seller preview.
- **Active listing edits fail closed**: `/dashboard/listings/[id]/edit` now moves ACTIVE listings to `PENDING_REVIEW` in the same update that saves substantive content changes, then reactivates only after AI approval.
- **Variant edits trigger moderation**: edit-page variant groups/options are normalized and compared, so changing seller-defined option labels/prices/availability now counts as substantive content change.
- **Photo additions are reviewed directly**: `POST /api/listings/[id]/photos` sends newly added URLs to AI instead of reviewing the first four old photos by sort order.
- **Photo edits/deletions fail closed**: image delete/re-review now leaves the listing in `PENDING_REVIEW` on AI errors or missing-photo states instead of leaving it active.
- **Banned/deleted sellers cannot mutate photos**: the listing photos route now checks the signed-in user row and joins ownership through a non-banned, non-deleted seller user.
- **Staff-removed listings cannot be resurrected by seller resubmit**: `publishListingAction` now rejects the staff-removal rejection reason and uses guarded `updateMany` writes with the original status + `updatedAt` to avoid admin reject/resubmit races. Keep the same guard on the fail-closed AI-error catch path.
- **Shop action errors are surfaced**: Unhide and Mark Available now return and display publish errors instead of silently showing "active" when the listing was sent to review or blocked.
- **Cross-page revalidation widened**: dashboard/shop status changes now revalidate the listing detail, seller profile, seller shop, dashboard, and browse surfaces.
- **IN_STOCK listings require positive stock**: new, edit, and custom listing server actions reject in-stock listings without stock quantity; AI activation paths also force `SOLD_OUT` if stock is zero/null as a defensive guard.
- **Open backlog updated**: `audit_open_findings.md` now marks C7, C8, H2, and H12-H17 as fixed.

### Verification
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

### Still open / next good passes
- Broader account-state enforcement sweep across follow/notify/notifications/blog/save routes.
- Refund/payment race fixes listed in the refund pass.

## Audit Fix Pass — Stripe Completed Checkout Account-State Recheck (2026-04-25)

This pass closed the remaining high-risk account-state gap in the Stripe completed checkout webhook. Checkout sessions can outlive seller account changes, so the webhook now re-checks the seller state at payment completion before normal order side effects.

### Fixed in this pass
- **Completed checkout re-checks seller state**: both cart and single-listing completed checkout paths now verify seller `user.banned`, `user.deletedAt`, `chargesEnabled`, and `stripeAccountId` before normal notifications/emails.
- **Invalid completed sessions are held for review**: if the seller became suspended/deleted/disconnected after session creation, the webhook creates a review-flagged order with a staff-facing note instead of sending normal seller/buyer order side effects.
- **Automatic refund attempted for invalid sessions**: invalid completed sessions attempt a full Stripe refund with `reverse_transfer: true`, using `blocked-checkout-refund:${sessionId}` as the Stripe idempotency key.
- **Reserved stock is restored after successful blocked-checkout refund**: the webhook restores stock from Stripe line-item metadata and reactivates `SOLD_OUT` listings when quantity is available again.
- **Refund/manual-review state is captured**: successful blocked-checkout refunds write `sellerRefundId`, `sellerRefundAmountCents`, clear refund locks, and keep `reviewNeeded=true`; refund failures are captured to Sentry and leave a manual reconciliation note.
- **Normal order notifications are skipped for invalid sessions**: the buyer gets a refund notification only after the blocked-checkout refund succeeds; seller sale notifications/emails and first-sale emails are skipped.
- **Completed checkout `SOLD_OUT` transition is atomic**: cart and single completed handlers now use guarded SQL updates instead of read-then-update status flips.
- **Messages route finding verified stale**: messages list/read/stream routes already use `ensureUserByClerkId()` and return typed account-access errors.
- **Open backlog updated**: `audit_open_findings.md` now marks C9, C12, H1, and H11 as fixed.

### Verification
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

### Still open / next good passes
- Webhook completed/expired session serialization with a PostgreSQL advisory lock.
- Duplicate completed webhook email/outbox idempotency.
- Refund tax/reverse-transfer accounting decision.
- Broader route-level account-state enforcement across follow/notify/notifications/blog/save.

## Audit Fix Pass — Admin Secret + Stripe Return URL Hardening (2026-04-25)

This pass closed two small confirmed high-risk items from the Round 16-18 verification list.

### Fixed in this pass
- **Admin PIN cookie no longer falls back to the PIN**: `src/lib/adminPin.ts` now signs with `ADMIN_PIN_COOKIE_SECRET` only. Non-production without that env uses an ephemeral per-process fallback; production without the env fails closed instead of treating the PIN as an HMAC secret.
- **Production env added**: `ADMIN_PIN_COOKIE_SECRET` was added to the Vercel Production environment.
- **Stripe Connect return URL blocks protocol-relative redirects**: `/api/stripe/connect/create` now accepts only same-origin app-relative paths, rejects `//host` and `/\host` forms, normalizes with `new URL()`, and falls back to `/dashboard/seller?onboarded=1`.
- **Production unsubscribe secret added**: `UNSUBSCRIBE_SECRET` was added to the Vercel Production environment so tokenized footer/header URLs are emitted in production.

### Verification
- `npx vercel env ls` ✅ confirmed `ADMIN_PIN_COOKIE_SECRET` and `UNSUBSCRIBE_SECRET` exist for Production.

### Still open / next good passes
- Refund `"pending"` UI/lock cleanup and broader refund race fixes.

## Audit Fix Pass — Map Fallback and Photo Touch Targets (2026-04-27)

This pass closed codeable mobile/accessibility backlog items without changing marketplace flows or data models.

### Fixed in this pass
- **MapLibre WebGL fallback**: `MapCard`, `MaplibreMap`, `SellersMap`, `AllSellersMap`, and `LocationPicker` now detect unsupported/blocked WebGL through a typed support wrapper and render a first-party fallback instead of a blank map.
- **Fallbacks keep navigation useful**: read-only map fallbacks show approximate coordinates plus OpenStreetMap links; seller map fallbacks expose top seller links; the location picker tells sellers to use address search when the map cannot initialize.
- **Map constructor failures fail visibly**: map components catch construction failures and switch to fallback UI instead of leaving an empty container.
- **Photo management controls are touch-sized**: listing creation and listing edit photo controls now use 44px-equivalent remove/reorder/alt/cover buttons with explicit ARIA labels.
- **Photo controls avoid mobile overflow**: reorder/action rows wrap on narrow cards instead of squeezing small buttons into a single line.

### Verification
- `git diff --check` ✅
- `npx tsc --noEmit --incremental false` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm test` ✅ (21 tests)

### Still open / next good passes
- Switch `DATABASE_URL` in Vercel to the Neon pooler endpoint; keep `DIRECT_URL` direct for migrations.
- Extend outbox semantics beyond high-volume follower/back-in-stock fan-outs if payment/case/order email retry semantics become a product requirement.
- Product/legal decisions: partial-refund inventory semantics, deleted-seller public content policy, and remaining retention schedule.

## Audit Fix Pass — Email Outbox First Slice (2026-04-27)

This pass adds durable delivery for the highest-volume email fan-outs without changing buyer checkout, refund, case, or order confirmation semantics.

### Fixed in this pass
- **EmailOutbox model added**: durable queued emails now persist recipient, optional user/preference context, subject, HTML body, dedup key, status, attempts, retry timing, and last error with indexes on drain and recipient history.
- **Outbox drain cron added**: `/api/cron/email-outbox` runs under cron bearer auth and `CronRun` idempotency, claims due rows, drains up to 50 emails with concurrency 5, retries transient failures with capped exponential backoff, recovers jobs stuck in `PROCESSING` for more than 10 minutes, and marks repeated failures dead after 10 attempts.
- **Rendered email helpers added**: back-in-stock and followed-maker-new-listing emails can now be rendered once, queued durably, and sent later through the existing suppression/account-state-aware email path.
- **Follower new-listing fan-out queued**: listing publish fan-out now writes one deduped outbox row per follower email instead of trying to send every follower email inline.
- **Back-in-stock fan-out queued**: stock restore fan-out keeps in-app notifications direct but queues subscriber emails with `back-in-stock:${listingId}:${subscriptionId}` dedup keys.
- **Queued preference checks fail closed**: queued non-transactional email rows store the relevant notification preference key and are skipped at drain time if the recipient opts out before the cron sends the job.
- **Transactional emails intentionally unchanged**: order/refund/case/payment emails remain direct because they are low-volume and often need immediate user feedback; extending the outbox there is a separate product/retry-semantics decision.

### Verification
- `npx prisma generate` ✅
- `npx prisma validate` ✅
- `git diff --check` ✅
- `npx tsc --noEmit --incremental false` ✅
- `npm test` ✅ (21 tests)
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; sandbox build still requires escalation for Turbopack local worker port binding

### Still open / next good passes
- Switch `DATABASE_URL` in Vercel to the Neon pooler endpoint; keep `DIRECT_URL` direct for migrations.
- Decide whether direct transactional mail needs outbox retry semantics or whether provider-level retries plus Sentry capture are sufficient.
- Product/legal decisions: partial-refund inventory semantics, deleted-seller public content policy, and remaining retention schedule.

## Audit Fix Pass — CI Build Gate and Pure Regression Tests (2026-04-27)

This pass closed a documentation/code mismatch around CI build enforcement and expanded the pure test baseline around two previously high-risk compliance/dedup helpers.

### Fixed in this pass
- **CI runs production build again**: `.github/workflows/ci.yml` now runs `npm run build` after tests and `npm audit --audit-level=high`, matching the documented CI baseline. Vercel still runs `prisma migrate deploy && npm run build` for production deploys.
- **Unsubscribe token logic isolated**: token creation, URL construction, normalization, expiry, and timing-safe verification now live in `src/lib/unsubscribeToken.ts`, keeping DB unsubscribe side effects separate from pure compliance logic.
- **Unsubscribe lifecycle tests added**: tests cover normalized emails, tokenized one-click URL shape, address/token tampering rejection, 90-day TTL enforcement, and future-issued token rejection.
- **Notification dedup key isolated**: daily dedup key generation now lives in `src/lib/notificationDedup.ts` and remains based only on UTC day, recipient, type, and link.
- **Notification dedup tests added**: tests verify stable same-action keys, separation across users/types/links/day buckets, and independence from mutable notification title/body copy.
- **Runtime DB SSL mode pinned**: `src/lib/db.ts` normalizes ambiguous `sslmode=require/prefer/verify-ca` runtime database URLs to `sslmode=verify-full`, preserving current security behavior before the next `pg` semantics change.
- **Database URL tests added**: pure tests cover SSL mode normalization without exposing or rewriting secret values.
- **Test baseline expanded**: `npm test` now runs 30 assertions across cron auth, listing variants, media URL/R2 keys, Sentry filtering, public paths, shipping tokens, unsubscribe tokens, notification dedup keys, and database URL normalization.

### Verification
- `git diff --check` ✅
- `npx tsc --noEmit --incremental false` ✅
- `npm test` ✅ (30 tests)
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)
- `npm run build` ✅ outside sandbox; previous Postgres SSL-mode warning no longer emitted

### Still open / next good passes
- Switch `DATABASE_URL` in Vercel to the Neon pooler endpoint; keep `DIRECT_URL` direct for migrations.
- Add route/integration coverage for payment, webhook, refund, account-state, and account export paths.
- Decide whether direct transactional mail needs outbox retry semantics or whether provider-level retries plus Sentry capture are sufficient.
- Product/legal decisions: partial-refund inventory semantics, deleted-seller public content policy, and remaining retention schedule.

## Audit Fix Pass — Account-State and Cron Retry Coverage (2026-04-28)

This pass continues the route/integration coverage backlog by isolating two high-risk route contracts into pure helpers that the Node test runner can load without Next or Prisma.

### Fixed in this pass
- **Account access error contract isolated**: `AccountAccessError`, `isAccountAccessError()`, and clean `{ status, body }` payload generation now live in `src/lib/accountAccessError.ts`. `ensureUser.ts` re-exports the same symbols for existing route imports.
- **Account-state response coverage added**: tests verify suspended and deleted account errors produce stable 403 payloads with machine-readable codes, while unrelated errors are not masked.
- **Cron retry reclaim rule isolated**: UTC cron run bucket generation and the five-minute failed-run reclaim predicate now live in `src/lib/cronRunState.ts`, keeping the retry-deadlock fix covered without importing Prisma.
- **Cron retry regression coverage added**: tests verify deterministic UTC hour buckets and that only failed runs older than the retry window are eligible for reclaim.
- **Test baseline expanded**: `npm test` now runs 70 assertions across 22 suites.

### Verification
- `npm test` ✅ (70 tests)
- `npx tsc --noEmit --incremental false` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notice only)

### Still open / next good passes
- Add deeper mocked route/integration coverage for payment webhook, refund route branching, and account export payload shape.
- Decide whether direct transactional mail needs outbox retry semantics or whether provider-level retries plus Sentry capture are sufficient.
- Product/legal decisions: partial-refund inventory semantics, deleted-seller public content policy, and remaining retention schedule.

## Audit Fix Pass — Account Export Download Contract (2026-04-28)

This pass tightens the account-export coverage gap by extracting the route's download formatting contract into a small helper that can be tested without mocking Clerk or Prisma.

### Fixed in this pass
- **Account export format helper added**: `src/lib/accountExportFormat.ts` owns the dated export filename, JSON download headers, no-store cache policy, and pretty JSON response construction.
- **Account export route uses the helper**: `/api/account/export` keeps the same behavior but delegates response formatting to the tested helper.
- **Account export regression coverage added**: tests verify deterministic filenames, `Content-Disposition`, `Content-Type`, `Cache-Control: no-store`, and stable pretty JSON output.
- **Test baseline expanded**: `npm test` now runs 73 assertions across 23 suites.

### Verification
- `npm test` ✅ (73 tests)
- `npx tsc --noEmit --incremental false` ✅
- `npm run lint` ✅ (passes; existing jsx-ast-utils notices only)

### Still open / next good passes
- Add deeper mocked route/integration coverage for payment webhook, refund route branching, and account export payload shape.
- Decide whether direct transactional mail needs outbox retry semantics or whether provider-level retries plus Sentry capture are sufficient.
- Product/legal decisions: partial-refund inventory semantics, deleted-seller public content policy, and remaining retention schedule.

## Audit Fix Pass — Cached Guild Approval and External Refund Accounting (2026-04-28)

This pass closes two live correctness gaps from the later audit rounds without changing public marketplace flows.

### Fixed in this pass
- **Admin Guild Master approval no longer recalculates live metrics**: `/admin/verification` now requires fresh cached `SellerMetrics` before rendering/enabling Guild Master approval. The server action also rejects missing or stale metrics instead of calling `calculateSellerMetrics()` on admin click.
- **Seller metrics freshness helper added**: cache freshness is centralized in `src/lib/metricsFreshness.ts` with a seven-day freshness window and far-future timestamp rejection.
- **External Stripe refunds excluded through the payment ledger**: because `Order` does not have a `chargeRefundId` field, all non-refunded-sales filters now use the durable `OrderPaymentEvent(eventType='REFUND')` ledger to exclude externally refunded Stripe orders.
- **Refund-aware surfaces aligned**: Guild Member eligibility, Guild Master metrics, quality-score conversion counts, `SiteMetricsSnapshot`, seller analytics, review eligibility, homepage order stats, listing deletion gates, account deletion active-order gates, seller refund locks, case refund locks, fulfillment changes, and shipping-label purchase locks all exclude ledger-refunded orders.
- **Regression coverage added**: `npm test` includes pure tests for seller metrics cache freshness.

### Verification
- `npm test` ✅ (43 tests)
- `git diff --check` ✅

### Still open / next good passes
- Switch `DATABASE_URL` in Vercel to the Neon pooler endpoint; keep `DIRECT_URL` direct for migrations.
- Add route/integration coverage for payment, webhook, refund, account-state, and account export paths.
- Decide whether direct transactional mail needs outbox retry semantics or whether provider-level retries plus Sentry capture are sufficient.
- Product/legal decisions: partial-refund inventory semantics, deleted-seller public content policy, and remaining retention schedule.
