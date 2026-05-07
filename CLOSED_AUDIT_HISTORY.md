# Closed Audit History

Completed audit/pass log sections moved out of `CLAUDE.md` on 2026-05-06. This file is historical traceability only; active architecture, schema, environment, helper ownership, and behavioral rules stay in `CLAUDE.md`.

## Archived Sections Index

- Mobile Audit Round 2 (complete)
- Mobile Audit (complete)
- Security Audit (complete — 2026-03-30)
- SEO & Styling Audit Fixes (complete — 2026-04-16)
- Styling Audit (2026-04-22/23)
- Security + Financial Audit Fixes (2026-04-23)
- Audit Hardening Pass (2026-04-23)
- Final Audit Cleanup (2026-04-23)
- Comprehensive Audit Fix Pass (2026-04-23)
- Codex Audit Fix Takeover (2026-04-24)
- Opus 4.7 Audit Compliance Pass (2026-04-24)
- Opus Round 4 Actionable Fix Pass (2026-04-24)
- Round 4 Coverage Gap Fix Pass (2026-04-24)
- Round 7 Deep Audit Hardening Pass (2026-04-24)
- Round 7 Continuation Cleanup Pass (2026-04-24)
- Round 7 Continuation Cleanup Pass 2 (2026-04-24)
- Round 7 Continuation Cleanup Pass 3 (2026-04-24)
- Round 7 Continuation Cleanup Pass 4 (2026-04-24)
- Comprehensive Security Audit (2026-04-17)
- Second Security Audit (2026-04-18)
- Full Site Card/Divider Audit + Fixes (2026-04-22)
- Site-Wide Border Audit + Final Fixes (2026-04-22)
- SEO Comprehensive Audit (2026-04-22)
- Audit Pass — Rounds 1-7 Follow-Up Hardening (2026-04-24)
- Audit Pass — Admin, Commission, Analytics Hardening (2026-04-24)
- Audit Pass — Payment Route Guard Rails + Homepage Accuracy (2026-04-25)
- Audit Pass — Metrics Aggregation + Query Indexes (2026-04-25)
- Audit Pass — Media Regression + Archive UX + Visibility Filters (2026-04-25)
- Audit Pass — Stripe Webhook Semantics + Account-State API UX (2026-04-25)
- Audit Pass — Email Compliance, Follower Fan-Out, Guild Applications, Saved Searches (2026-04-25)
- Audit Pass — Resend Bounce/Complaint Suppression (2026-04-25)
- Audit Pass — Account-State API UX Sweep (2026-04-25)
- Audit Pass — Media Origin Compatibility and Broken-Image Fallbacks (2026-04-25)
- Audit Pass — Server-Action UX + Moderation Fail-Closed (2026-04-25)
- Audit Pass — Payment Reconciliation Ledger (2026-04-25)
- Audit Pass — Runtime Race + Metadata Hardening (2026-04-25)
- Audit Pass — Payout + Saved/Recent State Polish (2026-04-25)
- Audit Pass — Guild Admin State Hardening (2026-04-25)
- Audit Pass — Media Fallback + Query Index Polish (2026-04-25)
- Audit Backlog Snapshot — Rounds 13-18 (2026-04-25)
- Audit Fix Pass — One-Click Unsubscribe Hardening (2026-04-25)
- Audit Fix Pass — Bounded Text Column Caps (2026-04-27)
- Audit Fix Pass — Feed Retry, COOP Popup Compatibility, Media URL Tests (2026-04-27)
- Audit Fix Pass — CI Environment Parity (2026-04-27)
- Audit Fix Pass — Cron Per-Record Isolation Sweep (2026-04-27)
- Audit Fix Pass — Public URL Canonicals + Browse Robots (2026-04-27)
- Audit Fix Pass — Public URL Link Cleanup (2026-04-27)
- Audit Fix Pass — Public URL Link Cleanup II (2026-04-27)
- Audit Fix Pass — Admin Feedback Cleanup (2026-04-27)
- Audit Fix Pass — Test Harness Expansion (2026-04-27)
- Audit Fix Pass — CI Test Harness Baseline (2026-04-27)
- Audit Fix Pass — Seller Rating Summary for Browse Scale (2026-04-27)
- Audit Fix Pass — Promptless Admin Flows, Multi-Receipt Checkout, and Touch Targets (2026-04-26)
- Audit Fix Pass — Route Loading Skeleton Coverage (2026-04-26)
- Audit Fix Pass — Tracking Cookies, Search Scale, and Stale Backlog Cleanup (2026-04-26)
- Audit Fix Pass — CI, Search Scale, and Locale Polish (2026-04-26)
- Audit Fix Pass — Retention, Payout Ledger, and Photo Mutation Hardening (2026-04-26)
- Audit Fix Pass — Round 22 GDPR + Fan-Out + Media Origin Cleanup (2026-04-26)
- Audit Fix Pass — Round 21 Verification + Scale Guardrails (2026-04-26)
- Audit Fix Pass — Admin/Dashboard Correctness Sweep (2026-04-26)
- Audit Fix Pass — Case/Message Safety Sweep (2026-04-26)
- Audit Fix Pass — Resend Webhook Replay + Account Deletion Cleanup (2026-04-26)
- Audit Fix Pass — Account-State + Refund Accounting Sweep (2026-04-26)
- Audit Fix Pass — Cron Run Idempotency (2026-04-26)
- Audit Fix Pass — Cron Scale Guardrails (2026-04-25)
- Audit Fix Pass — Fulfillment Case Race Guard (2026-04-25)
- Audit Fix Pass — Admin Destructive Role Gate (2026-04-25)
- Audit Fix Pass — Admin PIN Shared-IP Limit Tuning (2026-04-25)
- Audit Fix Pass — Notification Dedup + Saved Listing Visibility (2026-04-25)
- Audit Fix Pass — Checkout Session Webhook Serialization (2026-04-25)
- Audit Fix Pass — Seller Refund Dispute Guard (2026-04-25)
- Audit Fix Pass — Refund Pending Lock Cleanup (2026-04-25)
- Audit Fix Pass — Listing Moderation State Invariants (2026-04-25)
- Audit Fix Pass — Stripe Completed Checkout Account-State Recheck (2026-04-25)
- Audit Fix Pass — Admin Secret + Stripe Return URL Hardening (2026-04-25)
- Audit Fix Pass — Map Fallback and Photo Touch Targets (2026-04-27)
- Audit Fix Pass — Email Outbox First Slice (2026-04-27)
- Audit Fix Pass — CI Build Gate and Pure Regression Tests (2026-04-27)
- Audit Fix Pass — Account-State and Cron Retry Coverage (2026-04-28)
- Audit Fix Pass — Account Export Download Contract (2026-04-28)
- Audit Fix Pass — Cached Guild Approval and External Refund Accounting (2026-04-28)

## Archived Sections

## Mobile Audit Round 2 (complete)

Second mobile fix pass (2026-03-29). Zero TypeScript errors.

### FilterSidebar (`src/components/FilterSidebar.tsx`)
- **Apply button fixed** — removed `onClick={() => setMobileOpen(false)}` from the submit button; the premature state update was unmounting the form before the browser could process the `method="get"` submission. Sheet now closes via the existing `searchParams` useEffect when the URL updates after navigation.
- Reset link's `onClick` also removed for the same reason.

### Header (`src/components/Header.tsx`)
- **Logo tap target** — added `flex items-center min-h-[44px]` to the logo `<Link>` for a proper 44px touch target on mobile.
- **Messages drawer row fixed** — the "Messages" text span was not navigable (only the `MessageIconLink` icon was a link). Restructured: `MessageIconLink` (icon + unread badge) stays as the icon, a sibling `<Link href="/messages">` covers the text label. Both elements are now independently navigable.

### Notifications API (`src/app/api/notifications/route.ts`)
- **Auto-cleanup moved to cron** — notification polling no longer performs cleanup writes. `GET /api/cron/notification-prune` deletes read notifications older than 90 days in bounded SQL chunks; unread notifications are retained until read or account deletion.

### Dashboard listings (`src/app/dashboard/page.tsx`)
- "My Listings" section: `flex overflow-x-auto snap-x snap-mandatory` on mobile → `sm:grid sm:grid-cols-2 lg:grid-cols-3` on desktop. Each card gets `min-w-[220px] flex-none snap-start sm:min-w-0`.
- **Preview → link**: shown next to Edit for DRAFT, HIDDEN, and PENDING_REVIEW listings; links to `/listing/[id]?preview=1` in a new tab

### Seller profile (`src/app/seller/[id]/page.tsx`)
- **Featured Work**, **All Listings**, and **From the Workshop** (blog posts) sections all converted to the same pattern: horizontal scroll row on mobile (`flex overflow-x-auto snap-x snap-mandatory pb-4`), grid on tablet/desktop (`sm:grid` or `md:grid`). Min-width per card: 200–220px.

### Message interface
- **`src/components/MessageComposer.tsx`** — outer container changed to `sticky bottom-0 bg-white border-t` with `[padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]` for iPhone home-bar clearance. Send button: icon-only on mobile (paper-plane SVG), text label on `sm+`.
- **`src/components/ThreadMessages.tsx`** — message bubble max-width changed to `max-w-[85%] sm:max-w-[70%]`. Added `pb-4` to inner `<ul>`. **Scroll fix**: thread auto-scrolls to latest messages on load using direct `boxRef.current.scrollTop = scrollHeight` (not `scrollIntoView`, which scrolled the whole page). `requestAnimationFrame` wraps scroll calls to ensure DOM has settled. **Thread avatars**: other participant's 32px avatar shown to the left of their messages, bottom-aligned (`flex items-end gap-2`). Only the last consecutive message in a run from that person gets the avatar; earlier messages in the run get an invisible `w-8` spacer. System messages (`commission_interest_card`, `custom_order_request`, `custom_order_link`, `isSystemMessage: true`) never get an avatar.
- **`src/app/messages/[id]/page.tsx`** — reduced padding: `p-4 sm:p-8`, `space-y-4 sm:space-y-6`. **Thread header restructured into two rows for mobile**: Row 1 has `← Inbox` back link + participant avatar + name. Row 2 (indented, `flex-wrap`) has action buttons (Request Custom Order, Archive/Unarchive). Archive button changed from `rounded-full` to `rounded-md`. Listing reference card changed from `rounded-xl` to `rounded-lg`.
- **`src/app/messages/page.tsx`** — conversation list timestamp hidden on mobile (`hidden sm:block`).


## Mobile Audit (complete)

Full responsive audit and fix pass across all key pages (2026-03-29). Zero TypeScript errors.

### Header (`src/components/Header.tsx`)
- Mobile (< `md`): shows logo + cart icon + hamburger only
- Hamburger opens a right-slide drawer (`animate-slide-in-right`, `w-72 max-w-[85vw]`): search bar (home/browse only), Browse, Blog, Messages (with `MessageIconLink` unread badge), Notifications link (with count fetched in Header state), Cart with count, Dashboard, Admin (role-gated), `UserButton` at bottom
- Drawer closes on Escape, backdrop click, or navigation (`pathname`/`searchParams` effect)
- Body scroll locked while drawer open

### Filter Sidebar (`src/components/FilterSidebar.tsx`)
- Mobile: sidebar hidden; sticky "Filters (N)" button with `Filter` icon and active-filter count badge
- Clicking opens bottom sheet (`animate-slide-up`, `max-h-[85vh]`, drag handle, Apply/Close buttons)
- Active filter count computed from all current URL params
- Desktop: sidebar unchanged

### Browse page (`src/app/browse/page.tsx`)
- Both main and no-results layouts changed from `flex` row to `flex flex-col md:flex-row` so the filter button stacks above listings on mobile

### Admin panel (`src/app/admin/layout.tsx` + `src/components/AdminMobileNav.tsx`)
- Mobile: sidebar hidden; new `AdminMobileNav` client component renders a horizontal scrollable tab strip above content
- Tabs: Orders, Cases, Flagged, Verify, Blog — active tab highlighted via `usePathname`; amber badge dots for counts
- Layout changed to `flex-col md:flex-row`; content padding `p-4 md:p-8`

### Dashboard nav (`src/app/dashboard/page.tsx`)
- Button container: `grid grid-cols-2 sm:flex sm:flex-wrap`
- Each button: `flex-col sm:flex-row`, larger icon (20px) on mobile, smaller (16px) on desktop, `min-h-[56px]` on mobile for 44px+ tap targets

### Listing detail (`src/app/listing/[id]/page.tsx`)
- Price: bumped to `text-2xl font-semibold`
- Buy buttons: own row, `w-full` on mobile with `py-3 min-h-[44px]`, `sm:w-auto` on desktop
- Additional photo thumbnails: `flex overflow-x-auto snap-x snap-mandatory` on mobile → `sm:grid sm:grid-cols-4` on desktop

### globals.css (`src/app/globals.css`)
- `text-size-adjust: 100%; font-size: max(16px, 1em)` on all `input`, `textarea`, `select` — prevents iOS auto-zoom on focus
- `@keyframes slide-in-right` → `.animate-slide-in-right` for header drawer
- `@keyframes slide-up` → `.animate-slide-up` for filter bottom sheet


## Security Audit (complete — 2026-03-30)

Full audit of all 51 API routes. 49/51 already secure; 2 vulnerabilities fixed and deployed.

### Fixes applied

**`/api/shipping/quote` (POST)** — Added `auth()` + cart ownership verification
- Previously: no authentication required; cart looked up by opaque UUID with no ownership check
- Fix: `auth()` returns 401 for unauthenticated callers; in cart mode, added `if (cart.userId !== me.id) return 403`
- Risk mitigated: unauthenticated Shippo API abuse (cost), and theoretically reading another user's cart-linked data

**`/api/checkout` (POST)** — Added three missing guards on the legacy direct-checkout route
- `listing.status !== "ACTIVE"` → 400 (blocked buying drafts, sold, hidden listings)
- `listing.isPrivate && listing.reservedForUserId !== me.id` → 400 (private/reserved listings only for intended buyer)
- `listing.seller.userId === me.id` → 400 (blocked self-purchase, a Stripe ToS violation and fraud vector)
- Note: the main cart checkout routes (`/api/cart/checkout`, `/api/cart/checkout/single`) already had these checks

### Security posture

| Layer | Status |
|---|---|
| Authentication | ✅ Clerk on all sensitive routes; 401 before any data access |
| Authorization / ownership | ✅ All user-scoped mutations verify DB `userId` match; IDOR not possible |
| SQL injection | ✅ Prisma ORM — parameterized queries throughout; raw SQL only for analytics aggregations (read-only, no user input in table names) |
| Webhook integrity | ✅ Stripe HMAC signature verification; Clerk Svix signature verification |
| Role-based access | ✅ `EMPLOYEE | ADMIN` required for case resolution and admin panel; checked against DB role, not cookie |
| HTTPS | ✅ Enforced by Vercel / Cloudflare |
| Dev-only routes | ✅ `/api/dev/make-order` returns 404 unless local non-Vercel development and `ENABLE_DEV_MAKE_ORDER=true` |
| File uploads | ✅ R2 upload endpoints require auth in-route, validate endpoint/type/size, rate limit presigns, and strip EXIF for JPEG/PNG/WebP processed uploads |

### Remaining security improvements (not urgent)

- **Rate limiting** — ✅ Complete — `@upstash/ratelimit` with sliding windows across checkout, cart, messages, reviews, listing mutations, uploads, admin actions, cases, shipping, newsletter, and other mutation paths.
- **Security headers** — ✅ Complete — CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP, and CORP are configured in `next.config.ts`.
- **Input validation** — ✅ Broad coverage — API request bodies use Zod schemas on audited mutation routes; keep this as a checklist item for any new route.


## SEO & Styling Audit Fixes (complete — 2026-04-16)

Six fixes applied across SEO gaps and card-section styling consistency. Zero TypeScript errors.

### SEO FIX 1: "More from this maker" on listing detail
- `src/app/listing/[id]/page.tsx` — added `moreFromSeller` query (up to 4 ACTIVE non-private listings from same seller, ordered by `qualityScore desc`, excluding current listing) to the existing `Promise.all` alongside rating aggregates
- New section rendered between "About this piece"/"Details"/"Shop Policies" and "You might also like" (SimilarItems): 2x4 grid of seller's other listings with rounded photo, title, price
- Creates strong internal links between a seller's listings, improving crawl depth and cross-sell

### SEO FIX 2: Blocked pages return 404 instead of thin 200
- `src/app/listing/[id]/page.tsx` — blocked-seller check now calls `notFound()` instead of rendering a thin `<main>` with "This listing is not available" (was indexable 200 with zero content)
- `src/app/seller/[id]/page.tsx` — same fix for blocked seller profiles

### SEO FIX 3: Browse category title redundancy removed
- `src/app/browse/page.tsx` `generateMetadata` — category title changed from `${label} — Handmade Woodworking` (redundant "Handmade X — Handmade Woodworking") to `Handmade ${label} | Grainline`
- Search results title changed from `Search results for "${q}"` to `${q} — Handmade Woodworking | Grainline` (adds brand, removes generic prefix)

### SEO FIX 4: Blog OG image fallback
- `src/app/blog/[slug]/page.tsx` `generateMetadata` — when no `coverImageUrl` exists, OG images now fall back to `https://thegrainline.com/og-image.jpg` instead of `undefined`
- Twitter card images also use the same fallback

### SEO FIX 5: Seller profile city browse link
- `src/app/seller/[id]/page.tsx` — added a second link below "More makers in [City]" that reads "Browse [City], [State] listings →" linking to `/browse/[metroSlug]`
- Creates bidirectional internal links between seller profiles and city browse pages

### STYLING FIX 6: card-section/card-listing migration (9 files)
Replaced raw `rounded-xl border` / `rounded-xl border bg-white` / `border border-neutral-200` with design system classes:

| File | What changed |
|---|---|
| `checkout/success/page.tsx` | Receipt section: `rounded-xl border bg-white` → `card-section` |
| `blog/[slug]/page.tsx` | Featured listing cards + related post cards: `rounded-xl border overflow-hidden hover:shadow-sm` → `card-listing` |
| `commission/[param]/page.tsx` | Empty state container: `border border-neutral-200 p-8` → `card-section p-8` |
| `account/feed/FeedClient.tsx` | Skeleton cards: `border border-neutral-200` → `card-section` |
| `dashboard/verification/page.tsx` | Eligibility checklist, application forms, metrics info boxes: 6 instances of `rounded-xl border` → `card-section` |
| `admin/broadcasts/page.tsx` | Empty state + broadcast cards: `rounded-xl border` → `card-section` |
| `admin/blog/page.tsx` | Pending comment cards + empty state: `rounded-xl border bg-white` → `card-section` |
| `admin/verification/page.tsx` | Empty states, application cards, seller rows: 7 instances of `rounded-xl border` → `card-section` |


## Styling Audit (2026-04-22/23)

### LocationPicker (`src/components/LocationPicker.tsx`)
- Search input: `border border-neutral-200 rounded-md text-sm`
- Search button: `border border-neutral-200 rounded-md hover:bg-neutral-50`
- Map container: `border border-neutral-200` (was bare `border` = black)
- Lat/lng readonly inputs: `border border-neutral-200 rounded-md text-sm`

### MapCard (`src/components/MapCard.tsx`)
- Default className: `border border-neutral-200` (was bare `border` = black outline)

### Seller settings pickup location label
- `block text-sm mb-2` → `block text-sm font-medium text-neutral-700 mb-2`

### Loading skeletons (`browse/loading.tsx`, `listing/[id]/loading.tsx`)
- No borders on skeleton cards — `rounded-2xl bg-neutral-200` photo placeholders
- `max-w-[1600px]` width matching live pages


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
- ~~**Clickwrap on sign-up**~~ — DONE as technical implementation: `/sign-up` gates Clerk sign-up behind Terms/Privacy acceptance and stores `termsAcceptedAt`/`termsVersion` metadata. Attorney still reviews final legal wording.
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


## Comprehensive Security Audit (2026-04-17)

Full-codebase audit across 79 API routes, 8 parallel audit passes. 44 findings identified and fixed in a single commit. Zero TypeScript errors. All fixes deployed to production.

### Critical fixes
- **Blog XSS** — `marked.parse()` output was rendered via `dangerouslySetInnerHTML` with no sanitization. Initially fixed with `isomorphic-dompurify`, but jsdom has an ESM/CJS incompatibility that crashes Vercel's serverless runtime ("Failed to load external module jsdom"). Replaced with `sanitize-html` (pure JS, no jsdom dependency). Same tag/attribute allowlist: 28+ allowed tags, 8 attribute groups, `http`/`https`/`mailto` schemes only. File: `src/app/blog/[slug]/page.tsx`.
- **JSON-LD XSS** — All 12 `dangerouslySetInnerHTML={{ __html: JSON.stringify(...) }}` instances across 6 files were vulnerable to script-tag breakout via user-controlled strings (e.g. listing title `</script><script>alert(1)`). `JSON.stringify` does NOT escape `</`. New `src/lib/json-ld.ts` exports `safeJsonLd()` which replaces `<` with `\u003c` (valid JSON, browser-safe). Applied to all JSON-LD script tags: listing detail, seller profile, makers, commission, metro browse, metro+category browse.
- **Stock oversell race** — Webhook used `Math.max(0, staleQty - qty)` which is not atomic under concurrent webhooks. Replaced with raw SQL `GREATEST(0, "stockQuantity" - qty)` (floor at 0, prevents negative stock). Both cart and single-listing webhook paths fixed. File: `src/app/api/stripe/webhook/route.ts`.
- **No stock check at checkout** — Neither checkout route validated `stockQuantity >= requested quantity` for IN_STOCK items. Added guards to both `checkout-seller` and `checkout/single`. Buyers now get 400 "Not enough stock" instead of a Stripe session for unavailable items.
- **Private listings on seller profile** — `src/app/seller/[id]/page.tsx` listing query had no `isPrivate: false` filter. Custom order listings reserved for specific buyers appeared publicly. Fixed.
- **Attachment URL phishing** — `sendMessage` accepted arbitrary URLs in message attachments with no domain validation. Added R2 origin prefix check (`CLOUDFLARE_R2_PUBLIC_URL`). Non-R2 URLs are silently skipped. File: `src/app/messages/[id]/page.tsx`.

### High fixes
- **checkout-seller: vacationMode** — Route was missing vacation check (checkout/single had it). Added guard after chargesEnabled check.
- **checkout-seller: self-purchase** — Route was missing buyer === seller check. Added guard (Stripe ToS violation).
- **Refund double-refund race** — `sellerRefundId` null-check and Stripe call were not atomic. Added `prisma.order.updateMany({ where: { sellerRefundId: null } })` atomic lock with rollback on failure. Also added partial refund amount cap against order total. File: `src/app/api/orders/[id]/refund/route.ts`.
- **Case resolve: Stripe refund outside transaction** — Stripe refund issued before DB transaction; failure orphans the refund. Added try/catch with `ORPHANED REFUND` console.error for manual reconciliation. Added partial refund cap. File: `src/app/api/cases/[id]/resolve/route.ts`.
- **Label purchase double-purchase race** — Read-check guard for `labelStatus !== "PURCHASED"` races under concurrent requests. Added atomic `$executeRaw` UPDATE with WHERE condition + rollback on Shippo failure. File: `src/app/api/orders/[id]/label/route.ts`.
- **listingSnapshot never written** — `OrderItem.listingSnapshot` was always null despite being documented. Added snapshot capture (title, description, priceCents, imageUrls, category, tags, sellerName, capturedAt) to both webhook order creation paths. Expanded single-listing query to include snapshot fields.
- **Sentry `sendDefaultPii: true`** — Server, edge, and client configs now set `sendDefaultPii: false`; Sentry log forwarding is disabled with `enableLogs: false`; DSNs are read from env instead of source literals.
- **Sitemap leaks private listings** — `src/app/sitemap.ts` had no `isPrivate: false` filter. Private listing IDs were published in sitemap.xml. Fixed.
- **Custom listing `reservedForUserId` not validated** — `dashboard/listings/custom/page.tsx` accepted any `reservedForUserId` without verifying it matched the other conversation participant. Added validation.

### Medium fixes
- **Webhook cart quantity desync (fix #11)** — Webhook read live cart `it.quantity` for OrderItem creation and stock decrement, but a buyer could modify cart quantities via `/api/cart/update` between Stripe session creation and webhook execution. Order records would show different quantities than what was paid. Fix: webhook now expands `line_items` from the Stripe session, builds a `paidItemMap` (listingId → {quantity, priceCents}), and uses those authoritative values instead of live cart data. Cart is still read for listing metadata (title, photos, seller) and snapshot fields, but quantity and price come from Stripe.
- **Stock decrement floor at 0** — Upgraded from Prisma `{ decrement }` to raw SQL `GREATEST(0, "stockQuantity" - qty)`. Under concurrent webhooks, `{ decrement }` is atomic but can go negative (e.g. two buyers both buy the last item, both webhooks fire, stock goes to -1). The `GREATEST(0, ...)` floor prevents negative stock while still marking SOLD_OUT.
- **Low-stock notification accuracy** — Both cart and single-listing webhook paths now re-read `stockQuantity` from DB after the decrement (not from the stale pre-decrement query). Prevents false low-stock notifications under concurrent purchases.
- **Stale cart price** — `checkout-seller` used `CartItem.priceCents` (snapshot from add-time) instead of live `listing.priceCents`. Changed `unit_amount` and `itemsSubtotalCents` to use `i.listing.priceCents`.
- **displayName max 200 vs Stripe 100** — Zod `displayName` max was 200 in both checkout routes; Stripe's `display_name` limit is 100. Tightened to `.max(100)`.
- **Rate limiters added** — 7 new limiters wired into 8 routes: `shippingQuoteRatelimit` (quote), `newsletterRatelimit` (newsletter, IP-keyed), `blogCommentRatelimit` (comments), `notifyRatelimit` (stock notifications), `stripeConnectRatelimit` (connect/create + connect/dashboard), `clickDedupRatelimit` (per-IP+listing 24h dedup on click endpoint).
- **/api/health in isPublic** — UptimeRobot was getting 401s. Added to middleware public list.
- **Case resolve: partial refund stock restore** — Changed condition from `resolution !== "DISMISSED"` to `resolution === "REFUND_FULL"`. Partial refunds no longer restore full inventory (consistent with seller refund route).
- **Seller email leak** — `cart/route.ts` used `seller?.user?.email` as `sellerName` fallback. Removed; now falls back to `"Seller"`.
- **`buyer: true` over-fetch** — 4 files (sales detail, sales list, buyer order detail, checkout success) fetched entire User row including `shippingPhone`, `notificationPreferences`, `banReason`. Narrowed to `{ id, name, email, imageUrl }`.
- **cart/add: no status check** — DRAFT/SOLD/HIDDEN listings could be added to cart. Added `status !== "ACTIVE"` guard.
- **cart/update: no stock validation** — Buyer could set quantity to 50 when 1 in stock. Added IN_STOCK quantity check.
- **Custom order request: target not verified as seller** — Route checked User existence but not SellerProfile or `acceptsCustomOrders`. Added both checks.
- **Admin verification: 6 actions missing audit log** — `approveGuildMember`, `rejectGuildMember`, `approveGuildMaster`, `rejectGuildMaster`, `revokeMember`, `revokeMaster` now all call `logAdminAction`.
- **Click endpoint: missing per-listing 24h dedup** — View endpoint had `profileViewRatelimit` per IP+listing; click endpoint only had global IP limit. Added `clickDedupRatelimit` with same pattern.
- **Edit listing: priceCents=0 allowed** — Create blocked `<= 0` but edit only blocked `< 0`. Changed to `<= 0`.

### Low fixes
- **Fulfillment state machine** — No backwards transition guard. Added `validTransitions` map; returns 400 for invalid transitions (e.g., DELIVERED → SHIPPED).
- **Admin email HTML injection** — `body.replace(/\n/g, "<br/>")` with no escaping. Added `&`, `<`, `>` escaping before `<br/>` conversion.
- **Webhook P2002 handling** — Concurrent duplicate webhook delivery caused unhandled P2002 → 500 → noisy retry loop. Added P2002 detection in outer catch, returns 200.
- **Webhook payment_status** — Missing `s.payment_status !== "paid"` assertion after session re-retrieval. Added defense-in-depth check.
- **Banned user messaging** — `sendMessage` didn't check `me.banned`. Added guard returning `{ ok: false, error: "suspended" }`.
- **`/api/whoami` sessionId** — Public endpoint returned Clerk `sessionId`. Removed from response.
- **Self-favorite** — Seller could favorite own listings (+1 to relevance score). Added seller ownership check before upsert.
- **`console.log` in favorites** — Debug statements logging internal DB user IDs and roles to Vercel logs. Removed.
- **Sentry tracesSampleRate** — Was `1` (100%) in all 3 configs. Changed to `0.1` (10%) to reduce cost/quota usage.


## Second Security Audit (2026-04-18)

Focused audit on code paths NOT covered by the prior 44-finding audit. 6 agents scanned seller dashboard actions, review/follow/block edge cases, search/browse/listing detail, cron/email/notifications, account pages, and infrastructure/deps/config.

### Critical fixes
- **@clerk/nextjs 7.0.7 → 7.2.3** — fixes middleware route protection bypass (GHSA-vqx2-fgx2-5wq9). Attacker could access `/dashboard`, `/admin`, etc. without auth.
- **@clerk/nextjs 7.2.3 → 7.3.0** (2026-05-01) — fixes authorization bypass when combining organization/billing/reverification checks (GHSA-w24r-5266-9c3c). Lockfile-only bump via `npm audit fix`; the package.json `^7.2.3` caret range already covered 7.3.0. Affected transitive packages: `@clerk/shared 4.8.2 → 4.9.0`, `@clerk/backend 3.2.13 → 3.4.4`, `@clerk/react 6.4.2 → 6.5.0`. CI's `npm audit --audit-level=high` had been red for ~24h before the patch.
- **next 16.2.1 → 16.2.4** — fixes Server Components DoS (GHSA-q4gf-8mx6-v5v3). Crafted request crashes Vercel instance.
- **Dependency audit overrides (2026-05-05)** — `@hono/node-server` is overridden to 1.19.13 to clear Prisma dev-tooling middleware-bypass advisories without downgrading Prisma, and `postcss` is pinned/overridden to 8.5.10 so Next's nested vulnerable 8.4.31 copy is deduped. `npm audit --audit-level=moderate` reports zero vulnerabilities after this override pass.

### High fixes
- **Banned seller listings via direct URL** — `listing/[id]/page.tsx` had no `seller.user.banned` check. Added `notFound()` after chargesEnabled check. Contrast: `seller/[id]/page.tsx` already had this.
- **CSP frame-src** — YouTube (`youtube-nocookie.com`) and Vimeo (`player.vimeo.com`) added for blog video embeds. R2 CDN added to `media-src`. Unused `fonts.gstatic.com` removed from `font-src`.

### Medium fixes
- **Edit listing page info disclosure** — `dashboard/listings/[id]/edit/page.tsx` loaded any listing by ID with no auth. Now uses `findFirst` with `seller: { user: { clerkId } }` ownership filter.
- **toggleFeaturedListing** — No ownership check; any listing ID could be featured. Added `prisma.listing.count({ where: { id, sellerId } })` guard.
- **CRON_SECRET undefined bypass** — Both cron routes compared `Bearer ${undefined}` which an attacker could match. Changed to fail-closed: `if (!cronSecret || bearer !== cronSecret)`.
- **Broadcast imageUrl** — Accepted any string. Changed Zod to `z.string().url().regex(/^https:\/\//)`.
- **Notification preferences allowlist** — `type` field accepted arbitrary strings; users could silence always-on notifications like `LISTING_APPROVED`. Changed to `z.enum([...34 valid keys...])`.
- **Browse input bounds** — `q` capped at 200 chars; `pageNum` capped at 500; `minPrice`/`maxPrice` clamped to `[0, 500000]` (raised from 100K to 500K for high-value custom furniture).
- **Blog search rate limiting** — Both `/api/blog/search` and `/api/blog/search/suggestions` now have IP-based `searchRatelimit` + 200-char query cap.

### Low fixes
- **Review edit/reply sanitization** — PATCH review and seller reply were missing `sanitizeRichText()` (POST had it). Added to both.
- **Profile text field sanitization** — `dashboard/profile/page.tsx` `updateSellerProfile` was missing `sanitizeText`/`sanitizeRichText` on tagline, bio, storyBody, policies (the `dashboard/seller` version had them). Added.
- **Gift wrap price bounds** — No min/max validation. Clamped to `[0, $100]` (10000 cents).
- **Seller/listing page user over-fetch** — `seller/[id]/page.tsx` narrowed from `user: true` (13 fields) to 5 fields. `listing/[id]/page.tsx` narrowed from `user: true` to 5 fields.
- **Follow re-notification** — `NEW_FOLLOWER` notification fired on every follow POST (including re-follows via upsert update branch). Added `findUnique` check; notification only sent on new follows.
- **Admin email try/catch** — `resend.emails.send()` was called without try/catch. Wrapped.
- **Saved posts block filter** — Blog posts tab on `/account/saved` was missing `blockedSellerIds` filter. Added.
- **Following listing count** — `_count.listings` included DRAFT/HIDDEN/PRIVATE. Changed to `{ where: { status: "ACTIVE", isPrivate: false } }`.
- **Case thread staff email** — Case message author email leaked to buyers for EMPLOYEE/ADMIN authors. Now shows "Grainline Staff" instead.

### Database indexes (migration `20260416120000_add_performance_indexes`)
- `Order(paidAt)` — analytics range queries
- `Order(fulfillmentStatus)` — dashboard/admin order filters
- `SavedSearch(userId)` — user's saved searches lookup
- `Case(buyerId)` — buyer order detail case lookup
- `Case(status, createdAt)` — admin cases queue sort
- `CaseMessage(caseId)` — case thread message loading
- `Notification(read, createdAt)` — cleanup cron and read/unread filtering

### Known remaining items (not security-critical)
- `defu` prototype pollution (transitive via Prisma) — build-time only, not runtime. Prisma upgraded to 7.7 but `defu` fix requires upstream `c12` update.
- `Conversation`/`Message` lack `onDelete: Cascade` — will matter for GDPR account deletion
- `UserReport` missing `resolvedAt`/`resolvedById` fields — audit trail gap

### Post-audit review fixes (2026-04-18)
- **Cron routes added to `isPublic`** — `/api/cron(.*)` was missing from middleware's public list. Vercel Cron couldn't reach the guild-metrics and guild-member-check routes because Clerk middleware blocked them before the `CRON_SECRET` check could run. Now functional.
- **Browse price cap raised $100K → $500K** — high-value custom furniture (dining tables, commissioned pieces) was being filtered out. Upper bound kept to prevent abuse via absurd values in PostgreSQL queries.
- **Notification preference keys: shared constant** — `VALID_PREFERENCE_KEYS` exported from `src/lib/notifications.ts` as single source of truth. Preferences API imports it instead of duplicating 34 strings. Adding new notification types now requires updating only one file.
- **`$queryRawUnsafe` security comment** — Added rationale comment to `src/app/commission/page.tsx` explaining why `$queryRawUnsafe` is used and confirming all user input is bound via positional parameters.

### Deployment rule
**Always run `prisma migrate deploy` BEFORE `vercel --prod`** for migrations that add columns or constraints. Index-only migrations are safe to apply after deploy (queries are slower but correct). Production Vercel builds now enforce this with `vercel.json` `buildCommand`: production runs `npx prisma migrate deploy` before `npm run build`. Manual deploy pattern remains: `npx dotenv-cli -e .env -- npx prisma migrate deploy` → verify → `npx vercel --prod`.

### Infrastructure improvements (2026-04-18)
- **`.github/dependabot.yml`** — weekly npm security updates; minor/patch grouped into single PR; major version bumps ignored (require manual review); 10 open PR limit. Would have caught the Clerk 7.0.7 auth bypass CVE automatically.
- **`.github/workflows/ci.yml`** — runs `prisma generate` → `npx tsc --noEmit` → `npm audit` (informational, `continue-on-error: true`) on every PR and push to main. Node 22. `prisma generate` is required before `tsc` because Prisma 7.7 changed the client generation output. Audit is informational — Dependabot PRs surface actionable fixes.

### Dependency upgrades (via Dependabot PR #2, 2026-04-18)
- Prisma 7.6.0 → 7.7.0, Stripe SDK 19.0 → 19.3, React 19.2.4 → 19.2.5
- @sentry/nextjs 10.46 → 10.49, maplibre-gl 5.22 → 5.23, resend 6.1 → 6.12, svix 1.89 → 1.90
- AWS SDK (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) and type definition updates
- **Stripe `apiVersion`**: `src/lib/stripe.ts` pins `"2025-10-29.clover"` explicitly. Keep CLAUDE.md and the Stripe client in sync whenever the SDK/API version changes.
- **`tsconfig.json`**: excluded `prisma/seed.ts`, `prisma/seed-bulk.ts`, `prisma/seeds`, and `scripts` directories from tsc. Prisma 7.7 changed PrismaClient import behavior which broke seed file compilation. These are build-only scripts, not runtime code.
- **Webhook oversell detection** — both cart and single-listing webhook paths now log `[OVERSELL]` via `console.error` when pre-decrement stock was insufficient for the ordered quantity. Shows in Vercel logs and Sentry breadcrumbs. No schema change (Order.notes doesn't exist). Oversold orders require manual seller review and potential refund.
- **Neon connection pooler** — TODO comment in `prisma/schema.prisma` documenting when to switch to pooled connection string (`-pooler` hostname). Current `PrismaPg` adapter in `src/lib/db.ts` uses direct connection via `DATABASE_URL`. Switch when concurrent connections exceed ~50.


## Full Site Card/Divider Audit + Fixes (2026-04-22)

### Part A: Card-section applied to 15+ pages
Every remaining content container across the site now uses `card-section` or `card-listing` instead of raw `border border-neutral-200 rounded-xl`. All dividers use `border-neutral-100` (light grey) instead of default dark:

**Order pages**: buyer detail, seller detail, buyer list, seller list — all containers, receipt sections, item lists, case threads, fulfillment sections.
**Dashboard**: nav buttons, listing cards, profile form sections, FAQ items, featured listings.
**Account**: saved items (listings + blog posts), commissions, settings (all 8 preference sections).
**Public**: commission room, blog page (tag cloud, pagination), cart (seller sections, summary, dividers).
**Components**: FilterSidebar, MobileFilterBar (sheet headers, tag pills), NotificationBell (outer border removed — shadow only).

### Part B: Notification toggle mobile sizing
`NotificationToggle.tsx`: added `min-w-[44px] shrink-0` to prevent flexbox from compressing toggle buttons to varying sizes based on label text length on mobile.

### Part C: Message preview timestamp fix
New `MessageTime.tsx` client component replaces server-side `formatWhen()` in the messages inbox. Server-side `toLocaleString()` rendered UTC on Vercel — now renders in the user's local timezone. Also fixed `account/orders/page.tsx` timestamps with existing `LocalDate` component.

### Part D: Order list refund display
All three order list pages (buyer dashboard, seller sales, account orders) now show `Refund: -$X.XX` in red when `sellerRefundAmountCents > 0`. Added `sellerRefundAmountCents` to the account orders query.

### Part E: Refund max excludes tax
`SellerRefundPanel` now accepts `maxRefundCents` prop (items + shipping, excluding tax). Helper text added: "Tax is refunded automatically by Stripe in proportion to the refund amount." Seller sales detail page computes and passes the correct max.


## Site-Wide Border Audit + Final Fixes (2026-04-22)

### Border color consistency (16 files, ~35 edits)
Every remaining bare `border-b`, `border-t`, and `divide-y` across the site now has an explicit color class. No more inherited dark borders:
- All dividers: `border-neutral-100` (light grey)
- All button/container borders: `border-neutral-200`
- Files fixed: listing detail, checkout success, seller profile, commission detail, admin pages (cases/flagged/orders/verification), blog detail, seller settings, dashboard verification, map, metro browse, browse, homepage, makers, profile edit, custom order form

### Message thread query limit
`take: 200` added to both `messages/[id]/page.tsx` and `api/messages/[id]/list/route.ts`. Prevents unbounded query on long conversations (was loading all messages with no limit).

### Blog image upload error handling
`MarkdownToolbar.tsx` image upload catch block now shows `alert("Image upload failed. The file may be too large (max 4MB).")` instead of silently failing.

### Server-side dates → LocalDate (3 files)
Replaced `toLocaleDateString()` with `LocalDate` client component in:
- `dashboard/orders/[id]`: shippedAt, estimatedDeliveryDate (3 instances)
- `dashboard/sales/[orderId]`: processingDeadline, estimatedDeliveryDate
- `seller/[id]`: vacation return date, broadcast date, blog post dates


## SEO Comprehensive Audit (2026-04-22)

### noindex on private pages (30 files)
Added `robots: { index: false, follow: false }` to all server component pages under `/dashboard/*` (17), `/account/*` (9), `/messages/*` (3), and `/checkout/success`. Prevents Google from indexing "Sign in required" pages and wasting crawl budget. Client components (`dashboard/analytics`, `cart`) are already blocked by `robots.txt` Disallow rules.

### Structured data additions
- **Homepage**: Organization JSON-LD (name, url, logo, description) + WebSite JSON-LD with SearchAction targeting `/browse?q={search_term_string}`. Enables Google sitelinks search box and brand knowledge panel.
- **Blog posts**: Article JSON-LD with headline, description, image, datePublished, dateModified, author (Person), publisher (Organization with logo). Enables rich snippets, Google Discover, and news carousel.
- **Listing detail**: Product availability now mapped dynamically — `InStock` (active + stock > 0), `OutOfStock` (sold out), `PreOrder` (made to order). Was hardcoded to "InStock" regardless of status.
- **Seller profile**: `aggregateRating` (ratingValue + reviewCount) added to LocalBusiness JSON-LD when reviews exist. `sameAs` array of social URLs (Instagram, Facebook, Pinterest, TikTok, website) added.

### Sitemap additions
Added `/terms` (monthly, 0.3), `/privacy` (monthly, 0.3), `/map` (weekly, 0.5). `/blog` was already present.

### Alt text improvements
- Homepage Meet a Maker banner: `alt=""` → `alt="${displayName} workshop"`
- ListingGallery thumbnails: `alt=""` → `alt="${altText ?? title} — photo N"`

### SEO coverage summary
| Feature | Status |
|---|---|
| Sitemap | ✅ Complete — all public pages, listings, sellers, blog posts, commissions, metro pages, terms, privacy, map |
| Robots.txt | ✅ Blocks /dashboard, /admin, /cart, /checkout, /api, AI bots |
| Canonical URLs | ✅ On all 14 public page types |
| OpenGraph | ✅ Root layout + per-page on listings, sellers, blog, browse, commission |
| JSON-LD Product | ✅ On listings with dynamic availability + aggregateRating |
| JSON-LD LocalBusiness | ✅ On seller profiles with aggregateRating + sameAs |
| JSON-LD Article | ✅ On blog posts with author + publisher + dates |
| JSON-LD Organization | ✅ On homepage |
| JSON-LD WebSite + SearchAction | ✅ On homepage (sitelinks search box) |
| JSON-LD BreadcrumbList | ✅ On listings, metro browse, metro makers, metro+category |
| JSON-LD ItemList | ✅ On metro browse pages |
| JSON-LD Service | ✅ On commission detail pages |
| noindex on private pages | ✅ 30 pages |
| Alt text on images | ✅ Gallery photos use altText ?? title. Key images have meaningful alt. |
| metadataBase | ✅ https://thegrainline.com |


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


## Additional Archived Implementation Logs

- Bug Fix Session (complete — 2026-03-31)
- UI Polish Summary (complete — 2026-04-01)
- ListingCard Redesign (complete — 2026-04-09)
- Layout & Polish Pass (complete — 2026-04-09)
- Mobile Mosaic + Card Layout + Gradient Fix (2026-04-09)
- Message + Mobile Fixes (2026-04-10)
- Listing Page + UX Polish (2026-04-10)
- Bug Fixes (2026-04-13)
- Listing Form + UX Fixes (2026-04-22)
- Homepage Styling Pass (2026-04-22)
- Wider Layout Pass (2026-04-22/23)
- Drag-and-Drop Fix (2026-04-23)
- Performance Optimization — Batch 1 (2026-04-18)
- Blog & Commission Room UX Fixes (2026-04-18)
- UI Polish — Emoji Removal + Fixes (2026-04-21)
- Local Pickup + Display Name Warning (2026-04-21)
- Data Integrity & UX Fixes (2026-04-21)
- Notification & Email Fixes (2026-04-21)
- UX Fixes Batch — Order Management, Blog, Counts (2026-04-21)
- Styling Consistency Pass (2026-04-22)
- Visual Polish — Hover Fix + Dividers + Dashboard (2026-04-22)
- Final Polish Batch (2026-04-22)
- Photo Management + AI Alt Text + SEO + UX (2026-04-22)

## Bug Fix Session (complete — 2026-03-31)

Nine bugs fixed across listing page, commission room, and seller profile.

### Listing Gallery — lightbox not opening on click
- Root cause: hover overlay `div` (absolute inset-0) was intercepting click events before they reached the `img` tag (which had `onClick`)
- Fix: moved `onClick` to the outer container `div` for reliable click handling; added `pointer-events-none` to the decorative hover overlay

### Lightbox z-index — appears under Leaflet map
- Leaflet tiles render at z-index 200+; lightbox was `z-[200]` causing map to overlap
- Fix: all four lightbox components (`ListingGallery`, `ImageLightbox`, `SellerGallery`, `CoverLightbox`) updated to `z-[9999]`

### Leaflet map z-index — listing page
- Leaflet establishes a stacking context that can overlap other elements
- Fix: map section in `listing/[id]/page.tsx` wrapped in `<div style={{ position: 'relative', zIndex: 0 }}>`

### Mobile swipe support for lightboxes
- Added `touchStartX` / `touchEndX` `useRef` + `onTouchStart`/`onTouchEnd` handlers to `ListingGallery`, `ImageLightbox`, and `SellerGallery`; minimum 50px swipe threshold

### Main photo swipe — changes active index without opening lightbox
- `ListingGallery` main photo container (`src/components/ListingGallery.tsx`): added separate `mainTouchStartX` ref + `mainSwiped` boolean ref
- `handleMainTouchStart` / `handleMainTouchEnd` on the outer container: swipe ≥ 50px → changes `activeIndex` (prev/next photo); sets `mainSwiped = true`
- `onClick` checks `mainSwiped.current` before opening lightbox — if a swipe just occurred, resets the flag and returns early; a tap (< 10px movement) lets the click fire normally and opens the lightbox

### Workshop/story section layout (seller profile)
- Removed workshop image (`CoverLightbox`) from inside the story section
- Story section now only contains `storyTitle` + `storyBody` text
- New "From the Workshop" gallery section renders both `workshopImageUrl` and `galleryImageUrls` via updated `SellerGallery` component

### SellerGallery — combined images
- Updated `SellerGallery` to accept `workshopImageUrl?: string | null` and `images?: string[]`; internally merges them: `[workshopImageUrl, ...images].filter(Boolean)`
- All event handlers and lightbox state updated to use `allImages` length

### Workshop Gallery — dashboard seller settings
- New `GalleryUploader` client component (`src/components/GalleryUploader.tsx`) — shows existing images grid with remove buttons, UploadButton (galleryImage endpoint), hidden inputs per URL
- Added gallery upload section to `dashboard/seller/page.tsx` with heading "Workshop Gallery" and 8-photo max
- `updateSellerProfile` server action now reads `formData.getAll("galleryImageUrls")` and saves to `galleryImageUrls` field

### Duplicate "You might also like" heading
- `SimilarItems` component had its own `<h2>You Might Also Like</h2>` while listing page also had one
- Fix: removed `<h2>` from inside `SimilarItems`; outer `<section>` in listing page retains the heading

### Description field in new listing form
- Added `<textarea name="description">` (6 rows, 2000 char max) between title and price fields in `dashboard/listings/new/page.tsx`; server action already read and saved the field

### Draft system (2026-04-13)
- **Save as Draft button**: uses HTML button `name="saveAsDraft" value="true"` — no client component needed; Publish button uses `value="false"`; `createListing` reads `formData.get("saveAsDraft") === "true"` as FIRST line
- **Listing status**: `status: saveAsDraft ? "DRAFT" : "ACTIVE"` in `prisma.listing.create`
- **Draft redirect**: when `saveAsDraft`, redirects immediately to `/dashboard` after geo-metro mapping — skips ALL side effects (AI review, emails, follower notifications, syncListingsThreshold)
- **chargesEnabled gate**: if `!saveAsDraft && !seller.chargesEnabled` → `redirect("/dashboard/listings/new?error=stripe")`; page shows inline red error when `searchParams.error === "stripe"`; amber banner always shown when `!seller.chargesEnabled` (regardless of error param)
- **Save as Draft always works** regardless of chargesEnabled — sellers can draft listings before connecting Stripe

### Commission Room Near Me crash
- Root cause: `$queryRaw` tagged template literal treats `${}` expressions as SQL parameters; the conditional `${categoryValid ? \`AND cr.category = '${categoryFilter}'\` : \`\`}` was being passed as a bound parameter value instead of raw SQL, causing a PostgreSQL syntax error
- Fix: rewrote both queries (data + count) using `$queryRawUnsafe` with positional parameters; added `LEAST(1.0, GREATEST(-1.0, ...))` clamping on `acos` arguments to prevent NaN
- **Commission Near Me raw SQL**: category filter uses positional parameters (`$8` in select, `$4` in count) — never string interpolation. Direct string interpolation was causing a `$4` syntax error when a category was selected (parameter numbering shifted). Select and count use different variables (`categoryConditionSelect` / `categoryConditionCount`) because their param counts differ.


## UI Polish Summary (complete — 2026-04-01)

Full visual polish pass across all pages. All changes were CSS/class-only (no logic or feature changes).

### Global
- Body background: `bg-[#F7F5F0]` (warm cream) — set on `<body>` in `layout.tsx`
- Global button base: `button { border-radius: 0.375rem }` in `globals.css` (overridden by `.rounded-full` for pills)
- Horizontal scroll containers: `pb-0` — eliminates cream strip at bottom of scroll rows

### Homepage (`src/app/page.tsx`)
- Removed `<Logs>` icon from "Fresh from the Workshop" heading; removed `<Heart>` icon from "Buyer Favorites" heading — clean serif text only
- Card info sections: `bg-stone-50` → `bg-white` on all horizontal scroll cards
- Section spacing: `space-y-16` → `space-y-10` on main content container (eliminates oversized gaps)
- "From Your Makers" scroll row: `pb-2` → `pb-0`
- Scroll container `bg-white` added to Fresh from the Workshop `<ul>`, Buyer Favorites `<ul>`, and From Your Makers `<ul>` — prevents page cream background from showing through gaps between cards
- **Alternating warm section backgrounds**: "Meet a Maker" and "Stories from the Workshop" `ScrollSection` wrappers get `bg-amber-50/30 rounded-xl px-4 py-6 -mx-4` for subtle warm tint (hero, stats bar, map, newsletter sections unchanged)
- Category tiles updated: TOOLS → "Home & Office" (`Box` icon), STORAGE → "Gifts" (`Gift` icon), added ART (`Palette`), OUTDOOR (`TreePine`); removed OTHER; now 8 tiles + "Browse all" (9 total); grid updated to `sm:grid-cols-9`

### Browse (`src/app/browse/page.tsx`)
- h1 "Browse": added `font-display`
- ListCard thumbnail: changed from fixed `w-28 h-28` square → full-height left column (`relative w-40 sm:w-48`, `absolute inset-0 h-full w-full object-cover`)
- ClickTracker wrapper: removed `p-4` so image bleeds to card edges

### Listing detail (`src/app/listing/[id]/page.tsx`)
- Buy Now, Sign-in-to-buy, Add to Cart, Visit Shop, Message maker buttons: all got `rounded-md`
- Section headings "About this piece", "Details", "You might also like": all got `font-display`

### Account page (`src/app/account/page.tsx`)
- h1 + all h2 section headings: added `font-display`
- Order list: `<ul className="space-y-3">` → `<ul className="card-section divide-y divide-neutral-100">` with borderless `<li>` items
- Following/Commission/Settings/Workshop sections: `border border-neutral-200` → `card-section`
- Saved items cards: `border border-neutral-200` → `card-listing`; info div: `bg-stone-50` → `bg-white`
- Saved items scroll row: `pb-2` → `pb-0`
- Saved items scroll container: `<div>` → `<ul>` with `bg-white`; cards wrapped in `ClickTracker`; Link moved inside ClickTracker to avoid nested-interactive violation

### Account saved (`src/app/account/saved/page.tsx`)
- Listing card `<li>`: → `card-listing hover:shadow-md`
- Image: fixed `h-40` → `aspect-[4/3] object-cover`
- Info div: `bg-stone-50` → `bg-white`

### Feed (`src/app/account/feed/FeedClient.tsx`)
- h1 "Your Feed": added `font-display`
- Listing and blog FeedCards: `border border-neutral-200` → `card-listing`; images → `aspect-[4/3] object-cover`; info divs: `bg-stone-50` → `bg-white`
- Broadcast FeedCard: `border border-teal-200 bg-teal-50` → `card-section`; neutralized header border and text colors; kept teal only on "📢 Shop Update" badge text

### Messages inbox (`src/app/messages/page.tsx`)
- h1 "Messages": added `font-display`
- `formatSnippet` function: uses persisted `Message.kind` for structured message previews (commission interest card, custom order request, custom listing link) instead of inferring from arbitrary JSON body shape.
- Mobile filter buttons: `flex flex-wrap gap-2` for proper wrapping on small screens
- Search input: `rounded-md` border container

### Account page polish (2026-04-01)
- Workshop action buttons: added `rounded-md` per design system button standard
- Order list, sections: `card-section` class applied consistently

### Commission Room (`src/app/commission/page.tsx`)
- h1: added `font-display`
- Explainer banner: softened from solid amber to `border border-amber-200/60 rounded-lg`
- "Post a Request" buttons (header + empty state): added `rounded-md`

### Dashboard (`src/app/dashboard/page.tsx`)
- h1 "Workshop — [name]": added `font-display`
- "My Listings" and "Saved Searches" h2s: added `font-display`


## ListingCard Redesign (complete — 2026-04-09)

Single-file redesign applied to `src/components/ListingCard.tsx`, propagating to all migrated call sites:
- Photo: `rounded-2xl overflow-hidden aspect-square group-hover:scale-105` — square crop, rounded, subtle zoom on hover
- No card border or bg-white background — text floats on page background
- Title: `line-clamp-1` (single line, truncated with ellipsis) — prevents height mismatches between cards in grid/scroll rows
- Single star rating: `★ 4.8 (12)` replaces five-star StarsInline on all cards
- City/state location line below price
- Status badges (Made to order / Ready to ship) removed from cards — only on listing detail page
- Seller name as plain text link (no avatar chip)
- GuildBadge: 40px right-aligned in metadata area via two-column flex layout
- FavoriteButton: no background circle — grey heart shape behind white outline for visibility, `drop-shadow` for depth on all photo backgrounds
- Browse grid gap: `gap-x-4 gap-y-8`
- scroll ul bg-white removed from homepage Fresh + Favorites containers (already absent)
- Five-star StarsInline preserved on listing detail page only


## Layout & Polish Pass (complete — 2026-04-09)

- Browse + Listing: gradient moved outside max-w constraint — now full-screen width
- All listing surfaces: max-w-6xl → max-w-7xl (1280px)
- Browse grid: xl:grid-cols-4 (4 columns on very wide screens only)
- Browse FilterSidebar: sticky top-4 self-start
- ListingCard: seller avatar removed — seller name as plain text link
- ListingCard: hover photo swap — shows second listing photo on hover when available
- ListingCard: `secondPhotoUrl?: string | null` added to `ListingCardData` type
- Homepage scroll rows: `ScrollFadeRow` component (`src/components/ScrollFadeRow.tsx`) wraps Fresh, Favorites, From Your Makers. Right edge fade always visible; left edge fade only appears after `scrollLeft > 0` via `data-scrolled` attribute. CSS in `globals.css` `.scroll-fade-edges`.
- From Your Makers: bg-white removed from scroll ul for consistency
- Browse + page.tsx photo queries: `take: 2` to enable hover swap


## Mobile Mosaic + Card Layout + Gradient Fix (2026-04-09)

- HeroMosaic: style={{ width: "200%" }} → w-max on both rows — fixes mobile showing only 3 photos
- Browse gradient: softened to from-amber-50/30 via-amber-50/10 to match header seamlessly
- ListingCard: badge moved to photo overlay bottom-left (bg-black/70 solid, green/amber text)
- ListingCard: metadata collapsed to 3 lines — title / price+rating inline / location·seller
- ListingCard: fixed nested Link bug — location+seller row is a sibling div not inside listing Link


## Message + Mobile Fixes (2026-04-10)

- seller/[id]/page.tsx: featured/all listings use w-[200px]/w-[220px] flex-none — fixes mobile card stretch with aspect-square
- ActionForm.tsx: useEffect dependency [state?.ok] → [state] — fixes repeat sends not clearing MessageComposer
- MessageComposer.tsx: actionform:ok handler explicitly resets textarea DOM value + height — fixes emoji residue after send
- ThreadMessages.tsx: 500ms fallback setTimeout after initial requestAnimationFrame scroll — fixes mobile loading at top of thread
- MessageComposer: Enter sends, Shift+Enter newline, auto-grow up to 160px max-height, resets to single row after send
- ThreadMessages: text-left inside bubbles, break-words, desktop-only card styling (mobile full-bleed), pb-8 on scroll container
- ThreadMessages: break-all (was break-words) to break mid-word on long strings; scroll-after-send uses 200ms setTimeout to wait for DOM render
- Map page: initialZoom = 3, AllSellersMap default center [-96, 38] zoom 3 (full US view)


## Listing Page + UX Polish (2026-04-10)

- listing/[id]/page.tsx: Shop Policies accordion added before SimilarItems — shows returnPolicy, shippingPolicy, customOrderPolicy; no query change (seller fully included already)
- page.tsx: Hero text changed to "Buy handmade. Buy local. Buy quality." with updated subheading
- globals.css: scroll-fade-edges updated — right fade always visible, left fade only when `data-scrolled="true"` (set by `ScrollFadeRow` component on scroll)
- src/app/about/page.tsx: About page with live stats, story sections, maker + buyer CTAs; added to isPublic middleware and footer


## Bug Fixes (2026-04-13)

Seven bugs fixed across seller shop, dashboard, and blog pages. Zero TypeScript errors. Deployed.

- **Remove custom photo button did nothing** (`dashboard/profile/page.tsx`): Root cause was nested `<form>` elements — the remove button was inside `<form action={removeSellerAvatar}>` nested inside `<form action={updateSellerProfile}>`. HTML discards inner forms; the button submitted the outer form instead. Fix: extracted `RemoveAvatarButton.tsx` (`"use client"`) with `type="button"` that calls the server action directly and calls `router.refresh()` to force RSC re-render.

- **Dashboard listing cards not clickable** (`dashboard/page.tsx`): Non-draft listings (ACTIVE, HIDDEN, SOLD, SOLD_OUT, PENDING_REVIEW) had no clickable link on photo or title. Fixed by wrapping photo in `<Link href={/listing/${l.id}}>` and title text in a separate `<Link>` for non-DRAFT statuses. DRAFT listings keep only the existing "Preview →" link.

- **Shop page draft cards missing preview banner** (`seller/[id]/shop/page.tsx`, `components/ListingCard.tsx`): Added `href?: string` prop to `ListingCard`; `listingHref = href ?? /listing/${l.id}`. Shop page passes `href={/listing/${l.id}?preview=1}` for owner+DRAFT listings.

- **publishListingAction missing chargesEnabled check** (`seller/[id]/shop/actions.ts`, `ShopListingActions.tsx`): Added `chargesEnabled` guard BEFORE the try/catch in `publishListingAction` so it throws to the client. Added try/catch to the Publish button's `startTransition` handler in `ShopListingActions.tsx` — shows error message as toast (e.g. "Connect your bank account in Shop Settings to publish.").

- **SOLD listings had no way to relist** (`seller/[id]/shop/actions.ts`, `ShopListingActions.tsx`): Added `markAvailableAction` (sets ACTIVE, syncThreshold, revalidates shop + dashboard). Added "Mark available" button shown for SOLD status only.

- **HIDDEN listings showed both Publish and Unhide** (`ShopListingActions.tsx`): Rewrote per-status button logic. Final matrix: ACTIVE → Hide, Mark sold, Delete; HIDDEN → Unhide, Delete; DRAFT → Publish, Delete; PENDING_REVIEW → (nothing, Edit only); SOLD → Mark available, Delete; SOLD_OUT → Delete. Edit link always shown. Delete hidden from PENDING_REVIEW only.

- **Blog post author avatar used Clerk image only** (`blog/[slug]/page.tsx`): Added `sellerProfile: { select: { avatarImageUrl, displayName } }` to the `author` select. Updated resolution: `authorAvatar = post.author.sellerProfile?.avatarImageUrl ?? post.author.imageUrl`; `authorName = post.author.sellerProfile?.displayName ?? post.author.name ?? "Staff"`. No layout changes.


## Listing Form + UX Fixes (2026-04-22)

### Schema additions (migration `20260422231209_add_listing_seo_fields`)
- `Listing.metaDescription String?` — custom SEO meta description (160 chars max)
- `Listing.materials String[]` — comma-separated materials list (e.g. walnut, maple, brass hardware)
- `Listing.productLengthIn Float?`, `productWidthIn Float?`, `productHeightIn Float?` — actual product dimensions in inches (separate from packaged dimensions used for shipping)

### Edit listing redirect
- `updateListing` server action now calls `redirect(/listing/${listingId})` after saving — previously stayed on the edit page

### Character counters
- `CharCounter` component updated with `required` prop and design system border styling
- New `InputCharCounter` export for single-line text inputs with character count
- Applied to: Title (100 chars), Description (2000 chars), Meta description (160 chars) on both create and edit pages

### Wider content width
- `seller/[id]/page.tsx` and `seller/[id]/shop/page.tsx`: `max-w-6xl` → `max-w-7xl`
- Homepage and browse already used `max-w-7xl`

### AI_HOLD_LISTING removed from audit log
- `logAdminAction` call with `AI_HOLD_LISTING` removed from `dashboard/listings/new/page.tsx` — AI review hold is automated and shouldn't clutter the admin audit trail

### Loading skeletons modernized
- `browse/loading.tsx`: removed `border` from skeleton cards, added `rounded-2xl` photo placeholders, wider `max-w-7xl`, 4-column grid
- `listing/[id]/loading.tsx`: same treatment

### Edit listing page styling
- All inputs: `border border-neutral-200 rounded-md` (was `border rounded`)
- Labels: `text-sm font-medium text-neutral-700` (was `text-sm`)
- Listing type and packaged dims sections: `card-section p-4` (was `border rounded p-3`)

### TagsInput styling
- Border: `border border-neutral-200` (was bare `border`)

### Notification preferences split
- `/account/settings` now shows ONLY buyer-relevant preferences (From Makers You Follow, Orders & Cases, buyer email prefs)
- Seller notification preferences moved to `/dashboard/seller` under new "Shop Notifications" section with in-app and email subsections
- Link from `/account/settings` to `/dashboard/seller` for sellers

### AI alt text backfill fix
- `ai-review.ts`: both the no-API-key early return and the catch block now explicitly return `altTexts: []` — prevents `undefined` from silently skipping alt text backfill

### Edit page photo management (`EditPhotoGrid` component)
- New `src/components/EditPhotoGrid.tsx` — "use client" component with:
  - HTML5 drag-and-drop reorder (drag photos between positions)
  - Arrow button reorder (fallback for mobile/accessibility)
  - Inline alt text editing per photo with "Save alt texts" button
  - Delete photos with X button
  - "Make cover" to move any photo to first position
  - Toast notifications for all actions
- Replaced the old server-rendered photo grid + separate `ActionForm` for alt texts
- Old server actions `deletePhoto`, `saveAltTexts`, `setCoverPhoto` replaced with `reorderPhotos`, `deletePhotoAction`, `saveAltTextsAction`

### Alt text input styling (both create + edit)
- Placeholder: "Describe this image (e.g. 'Hand-carved walnut dining table')"
- Helper text: "Alt text improves visibility in Google Image Search"
- Consistent styling across `PhotoManager` and `EditPhotoGrid`

### Materials and dimensions on listing detail
- Materials shown in Details table when present (comma-separated)
- Product dimensions shown as `L × W × H` in inches when present
- `generateMetadata` uses `metaDescription` when available, falls back to `description.slice(0, 160)`


## Homepage Styling Pass (2026-04-22)

### Map section
- Removed double-border (homepage wrapper + MakersMapSection inner border)
- `MakersMapSection.tsx`: `rounded-3xl border bg-white` → `rounded-2xl bg-stone-50` (warm, no border)
- "Use my location" button: `bg-[#2C1F1A] hover:bg-[#3A2A24]` (espresso brand color, was amber/orange)
- "Open Makers Map" button: `border-neutral-300 bg-white hover:bg-neutral-50`

### Categories
- Tiles: `bg-amber-50 hover:bg-amber-100` with `text-amber-700` icons, no borders
- "Browse all" tile: same amber styling with arrow icon

### Meet a Maker
- Outer card: `bg-stone-50 rounded-2xl` (was `bg-white shadow-sm border`)
- Featured listings: `rounded-xl` photos floating on warm background (was `card-listing` with borders)
- Tagline: added `border-l-2 border-amber-300 pl-3` accent for visual emphasis
- "Visit Their Workshop" button: espresso `bg-[#2C1F1A]` (matches hero)


## Wider Layout Pass (2026-04-22/23)

All major public-facing and dashboard pages widened to `max-w-[1600px]` (was `max-w-7xl`/1280px):
- Homepage (all content sections below hero)
- Browse (both main and no-results variants, metro browse sections)
- Listing detail
- Seller profile + seller shop
- Blog index
- Commission room
- Makers map pages
- Dashboard (home, analytics, sales, inventory, blog)
- Account (home, orders, saved items)
- Admin (reports, reviews)

Pages intentionally kept narrow: messages, checkout, cart, blog post detail, about, terms/privacy, profile editing, blog writing, onboarding.


## Drag-and-Drop Fix (2026-04-23)

Both `PhotoManager` and `EditPhotoGrid` drag handlers rewritten:
- `e.dataTransfer.effectAllowed = "move"` + `dropEffect = "move"` — tells browser this is a move operation
- `e.dataTransfer.setDragImage(img, 50, 50)` — drag ghost shows only the photo thumbnail, not the entire card with buttons
- `e.preventDefault()` in `handleDrop` — prevents browser from navigating to dragged content
- `select-none` on `<li>` — prevents text selection during drag
- `draggable={false}` on child `<div>` elements — prevents child elements from being independently draggable (was causing "connected to text below" bug)
- `handleDragStart` and `handleDrop` capture `from`/`to` into local variables before nulling refs — prevents race condition


## Performance Optimization — Batch 1 (2026-04-18)

### Image loading
- **`loading="lazy"`** added to 15 image locations across ListingCard (all listing grids/scroll rows), HeroMosaic (all except first 6 — 3 per row visible above fold), RecentlyViewed, FeedClient (listings, blog, broadcasts), browse featured/list-view, homepage Meet a Maker (banner + avatar), homepage blog covers + author avatars, homepage From Your Makers cards. Previously: 0 images had lazy loading; all ~51 homepage images loaded eagerly.
- **R2 cache headers**: `CacheControl: "public, max-age=31536000, immutable"` set on all new uploads via `PutObjectCommand` in `src/app/api/upload/presign/route.ts`. Keys include timestamp+random suffix so they are content-addressed and never change. Previously: no cache headers — images may have been re-fetched from R2 origin on every visit. Note: existing images uploaded before this change still lack cache headers; they would need a one-time migration script to set headers on existing R2 objects.

### JavaScript bundle
- **Maplibre GL lazy-loaded** via `next/dynamic({ ssr: false })` in `MakersMapSection.tsx`. Defers ~1MB maplibre-gl JS bundle until the map section hydrates client-side (below the fold on most viewports). Loading skeleton shown while JS loads. Previously: statically imported — every homepage visitor downloaded the full map library.
- **Maplibre CSS removed from `globals.css`** (was `@import 'maplibre-gl/dist/maplibre-gl.css'` — 68KB parsed on every page of the entire site). CSS import moved into each map component individually (AllSellersMap, LocationPicker, SellersMap, MapCard, MaplibreMap). With dynamic import, CSS is code-split and only loaded when a map renders. Non-map pages (browse, listing detail, cart, checkout, account, blog) pay zero CSS cost.

### CSS animations
- **ScrollSection `transition-all` → `transition-[opacity,transform]`** — previously told the browser to watch all CSS properties for changes on every scroll-triggered fade-in animation, causing unnecessary style recalculation. Now only transitions the two properties that actually change.

### Batch 2 (planned, not yet implemented)
- Deduplicate `getBlockedUserIdsFor` call (called twice per homepage load for logged-in users)
- Fix `getSellerRatingMap` N+1 on homepage (single JOIN like browse page already does)
- Parallelize featured maker + seller ratings + logged-in user data queries
- Add `take: 200` limit on mapPoints query (currently serializes all opted-in sellers into RSC payload)

### Batch 3 (planned, requires external service)
- Cloudflare Image Resizing (`?width=400&format=webp`) for responsive image delivery
- Or `next/image` with custom R2 loader
- `fetchpriority="high"` on LCP images


## Blog & Commission Room UX Fixes (2026-04-18)

- **`@tailwindcss/typography` installed** — `@plugin "@tailwindcss/typography"` in `globals.css`. Blog post body `prose` classes now functional: paragraph spacing, styled headings, blockquotes, code blocks, lists. Previously all `prose-*` classes were no-ops since blog launch (plugin was never installed).
- **Blog comment thread borders** — `border-neutral-100` → `border-neutral-300` on L2/L3 reply indent lines in `BlogReplyToggle.tsx`. Threading hierarchy now visible (was white-on-white).
- **Blog cover images** — fixed `h-44` → `aspect-[16/9]` on grid cards. Consistent proportions regardless of source image shape.
- **Blog featured post label** — amber "Featured" badge added above the type badge on the hero card. Previously the featured post was larger but had no label.
- **Commission reference image disclaimer** — added to create form: "Only upload images you own or have permission to share. Reference images are visible to makers who view your request." Addresses the legal gap where buyers upload Pinterest/Google images with no guidance.
- **Commission interest button** — upgraded from `text-xs border-only` to `text-sm rounded-md bg-neutral-900` filled button. Primary conversion action is now visible and tappable on mobile. Confirmed state also restyled.
- **Commission reference images** — 64px → 96px with `rounded-lg` on board cards. Reference images are the most compelling visual element on a commission request; they were barely visible before.


## UI Polish — Emoji Removal + Fixes (2026-04-21)

### Emoji → Icons (80+ instances, 28 files)
All emoji replaced with SVG icon components from `src/components/icons/` or plain text:
- Dashboard stats `👁🖱♥🔔` → `Eye`/`Heart`/`Bell` icon components + "clicks" text
- Gift labels `🎁` → `Gift` icon; Shipping `🚚` → `Truck` icon
- Custom order `🎨🔨` → `Palette`/`Hammer` icons; Location `📍` → `MapPin` icon
- Decorative `🪵🪚🎉📢📋` → icon components or removed entirely
- Message snippets `🖼📄📎` → plain text ("Photo", "PDF", "Attachment")
- Error/404 pages → `Wrench`/`Logs` icons; Onboarding → `Hammer` icon
- Unicode characters `★☆✓✗✕•○` are NOT emoji — these were kept as-is

### Other UI fixes
- **Cart label**: "Grand total (items only)" → "Subtotal (items only)" (shipping not yet calculated at that step)
- **TipTap toolbar**: transaction listener forces re-render so `isActive()` reflects current state immediately after toggling bold/italic/etc.
- **ListingGallery mobile**: `style={{ height: "500px" }}` → `h-[350px] sm:h-[400px] md:h-[500px]`. Was portrait-cropping on mobile (500px tall × 375px wide).
- **Back buttons**: "Back to Sales" / "Back to Orders" links added to order detail pages
- **Refund button**: partial refund confirm changed from `bg-neutral-900` → `bg-red-600` (destructive action color match)
- **R2UploadButton**: error state added — shows user-facing error message on upload failure, clears on retry/success


## Local Pickup + Display Name Warning (2026-04-21)

### Local Pickup as a Shipping Option
- **Quote route** (`/api/shipping/quote`): injects "Local Pickup (Free)" as a synthetic $0 rate when `seller.allowLocalPickup === true`. HMAC-signed via `signRate()` with `objectId: "pickup"`. Shows first in the ShippingRateSelector radio list via `unshift`.
- **Checkout flow**: no changes needed. Buyer still enters address (Stripe requires it for tax calculation). The `$0` shipping rate flows through HMAC verification and Stripe session creation unchanged.
- **Webhook detection**: already handles pickup — `shippingTitle.toLowerCase().includes("pickup")` matches "Local Pickup (Free)" and sets `fulfillmentMethod: "PICKUP"`.
- **Fulfillment**: pickup orders follow the existing `ready_for_pickup → picked_up` status flow with notifications + emails (fixed earlier in this session).
- **Seller setup**: `allowLocalPickup` toggle in Shop Settings (`/dashboard/seller`). No new fields needed.

### Display Name Soft Uniqueness Warning
- **On save** (`/dashboard/profile` server action): case-insensitive `findFirst` checks for another seller with the same `displayName`. Save always proceeds (soft warning, not hard block).
- **UI**: if duplicate found, redirects to `?warning=duplicate-name`. Amber banner suggests adding location/specialty (e.g. "Oak & Iron Woodworks — Austin").
- **No DB constraint** — display names are not unique at the schema level. This is a UX nudge, not enforcement. Multiple sellers can still have identical names (like Etsy).

### Shipping options variability (documented, no fix needed)
- Shippo API returns live carrier rates that fluctuate in real-time. The `street1: "Placeholder"` in the quote route does not affect rate accuracy (rates are zip-to-zip based). Residential/commercial classification may be slightly off but is buyer-favorable. This is normal carrier API behavior, not a bug.


## Data Integrity & UX Fixes (2026-04-21)

### Security & data integrity
- **Map page** — added `vacationMode: false` + `user: { banned: false }` filters. Vacation/banned sellers no longer appear as map pins.
- **SellerRefundPanel** — hidden when the case already has `stripeRefundId` (admin refund). Prevents double-refund via the seller panel after admin already resolved.
- **Seller rating** — now includes private/custom listing reviews. Previous query filtered by public listing IDs only, excluding all custom work reviews from the seller's average. Changed to query by `listing.sellerId` directly.
- **Case API** — blocks case creation when `fulfillmentStatus === "PENDING"`. Buyers must wait until the order has shipped/been prepared.

### Display & count accuracy
- **Homepage maker count** — filters `chargesEnabled: true`, `vacationMode: false`, `user: { banned: false }`. Was counting all sellers with an ACTIVE listing including banned/vacation.
- **Sales list total** — uses `mySubtotalCents` (this seller's items only) instead of `order.itemsSubtotalCents` (all sellers). Was inflated for multi-seller orders.
- **"See all N pieces"** on seller profile — counts only ACTIVE + non-private listings. Was including SOLD/SOLD_OUT that buyers can't see on the shop page.
- **"In Stock · null available"** — fixed to show "In Stock" without count when `stockQuantity` is null.

### Seller dashboard
- **Guild badge revocation explanation** — both cron routes now update `MakerVerification.status` to `REJECTED`/`GUILD_MASTER_REJECTED` on revocation. Dashboard shows "Your Guild badge was revoked" banner with re-apply guidance.
- **Mark delivered** — button only visible when `fulfillmentStatus === "SHIPPED"` (was always visible regardless of status).
- **Mark sold** — only available from ACTIVE/SOLD_OUT (was allowing DRAFT → SOLD). Guard added to both dashboard and shop actions.
- **Inventory badges** — DRAFT, HIDDEN, Under Review, and Rejected listings now show status badges in the inventory view (were silently bucketed as "Active").
- **Restock HIDDEN → ACTIVE** — documented limitation: restocking always promotes to ACTIVE; seller must re-hide manually if the listing was previously HIDDEN.
- **displayName sanitization** — `sanitizeText()` applied on profile page (was already applied on seller settings page).

### Buyer experience
- **Cart unavailable items** — cart API now returns listing `status` and `sellerVacationMode`. Cart page shows inline warnings ("This item is no longer available" / "Maker is on vacation") and disables "Continue to shipping" when unavailable items are present.
- **Browse filter conflict** — `shipsFilter` no longer overwrites explicit `typeFilter`. Searching for `type=MADE_TO_ORDER&ships=3` no longer returns IN_STOCK results.

### Makers page
- **Zero-listing sellers excluded** — query now requires `listings: { some: { status: "ACTIVE", isPrivate: false } }`.
- **Banner image** — card image now uses `seller.bannerImageUrl` first, falling back to most recent listing photo, then placeholder. Was always using listing photo even when banner was set.

### Low-priority UX improvements
- **"Message Buyer"** — links to `/messages/new?to=buyerId` (was linking to inbox)
- **Inventory stale UI** — `router.refresh()` after stock save so status badges update immediately
- **Old orders $0.00** — fallback to `items.reduce(priceCents * quantity)` when subtotal fields are 0
- **Messages "Sent" tab** — renamed to "Awaiting Reply" (was misleading — filtered by "last message was mine")
- **Order item 404 links** — non-ACTIVE listings render as plain text instead of clickable links to deleted/hidden pages
- **Browse no-results featured** — added `chargesEnabled + vacationMode + banned` seller filters
- **Browse popular tags** — same seller safety filters added
- **About page "Become a Maker"** — links to `/sign-up` for signed-out users, `/dashboard` for signed-in
- **`sendWelcomeSeller`** — confirmed NOT dead code (called in Clerk webhook on `user.created`)
- **Multi-seller success page** — deferred. Only shows last seller's receipt. Fixing requires checkout flow refactor; other orders visible via "View my orders".

### Final homepage safety audit (2026-04-21)
- **Mosaic photo query** — added `seller: { chargesEnabled, vacationMode: false, banned: false }` (banned/vacation seller photos could appear in hero background)
- **Featured maker fallback SQL** — added SellerProfile + User JOINs with safety filters (banned most-reviewed seller could be featured in Meet a Maker spotlight)
- **From Your Makers** — added seller safety filters to both `recentListings` and `recentBlogPosts` queries

### Dead code identified (not removed — low priority)
- `src/app/actions/toggleFavorite.ts` — orphaned server action; `FavoriteButton` uses REST routes. Zero import sites.
- `src/app/api/checkout/route.ts` — legacy single-item checkout was deleted in Phase 6. If this still exists, it's unreferenced dead code.


## Notification & Email Fixes (2026-04-21)

### Approval gating
- **Listing follower notifications** — gated on `finalListing.status === "ACTIVE"` after AI review. PENDING_REVIEW listings no longer trigger `FOLLOWED_MAKER_NEW_LISTING` notifications or emails. Previously, followers received notifications linking to 404 pages.
- **Blog comment notifications** — moved from POST handler (fires on creation with `approved: false`) to the `approveComment` server action in `src/app/admin/blog/page.tsx`. `NEW_BLOG_COMMENT` and `BLOG_COMMENT_REPLY` now fire only when an admin approves the comment.

### Notification dedup
- **Shared helper** — `createNotification()` owns notification dedup. It writes a database-enforced daily `dedupKey` based on UTC day + recipient + type + link, so copy changes in title/body do not bypass dedup.
- **Favorites/follows** — route-local fuzzy dedup was removed. Legitimate distinct users are no longer suppressed by follower-name substring or listing-link-only checks.

### Fulfillment notification matrix (complete)
| Action | Status | In-app notification | Email |
|---|---|---|---|
| `shipped` | SHIPPED | `ORDER_SHIPPED` to buyer | `sendOrderShipped` |
| `delivered` | DELIVERED | `ORDER_DELIVERED` to buyer | `sendOrderDelivered` (NEW) |
| `ready_for_pickup` | READY_FOR_PICKUP | `ORDER_SHIPPED` to buyer (NEW) | `sendReadyForPickup` |
| `picked_up` | PICKED_UP | `ORDER_DELIVERED` to buyer (NEW) | — |

### Other fixes
- **Staff case messages** — now notify both buyer AND seller (was buyer only). Staff role detected via `me.role`. Buyer link → `/dashboard/orders/`, seller link → `/dashboard/sales/`.
- **Seller refund notification** — `CASE_RESOLVED` notification sent to buyer with refund amount when seller issues a refund via `/api/orders/[id]/refund`.
- **Email subject escaping** — `safeSubject()` helper strips `<>"'&` from user names/titles in 6 email subjects.
- **Email img src escaping** — `safeImgUrl()` validates HTTPS + escapes quotes before inserting into `<img src>`.


## UX Fixes Batch — Order Management, Blog, Counts (2026-04-21)

### Order management
- **SellerNotesForm** (`src/components/SellerNotesForm.tsx`) — new client component replaces raw HTML form POST for order notes. Uses `fetch()` with "Saving..." / "Saved!" feedback. Keeps text in textarea after save (persistent notes).
- **Carrier dropdown** — replaced free-text carrier input with `<select>` (UPS, USPS, FedEx, DHL, Other). Eliminates case sensitivity issues and typos.
- **OrderTimeline refund step** — when `sellerRefundId` exists, a "Refund issued" step with a red dot and the refund amount is appended to the timeline. Applied to both buyer and seller order detail pages.
- **Review images in admin** — admin reviews page and account reviews page now query and display review photo thumbnails.

### Blog
- **Featured blog card image** — `h-56` → `aspect-[16/9]` for consistent proportions on mobile.
- **SaveBlogButton on homepage** — added to each blog card in "Stories from the Workshop" section. Saved state queried via `SavedBlogPost` for signed-in users.
- **SaveBlogButton on featured blog card** — added to the featured post card on `/blog`.

### Counts & naming
- **About page seller count** — added `vacationMode: false`, `user: { banned: false }`, `listings: { some: { status: "ACTIVE" } }` filters. Added member count (`prisma.user.count({ where: { banned: false } })`).
- **Homepage stats bar** — added member count between "active makers" and "orders fulfilled".
- **"From Your Makers" → "Makers You Follow"** — renamed for clarity.

### Already done (no changes needed)
- Blog card hover states — already covered by `.card-listing:hover` CSS rule
- Upload error handling — R2UploadButton already has `uploadError` state with user-facing messages
- Fulfillment button gating — already working via status-based JSX visibility + route redirect


## Styling Consistency Pass (2026-04-22)

### Card surface unification
All card surfaces across the site now use the design system's `card-section` class (warm shadow + subtle border) instead of raw `border border-neutral-200 rounded-lg/xl`:
- **Dashboard orders** — order cards + empty state
- **Dashboard sales** — order cards + empty state
- **Messages inbox** — conversation list + empty state
- **Dashboard nav buttons** — all 12 buttons (Your Shop + Your Account), now with `hover:shadow-md transition-shadow`
- **Commission room** — empty state
- **Account page** — section empty states
- **Blog page** — featured card + no-results state

### Visual consistency fixes
- **Mosaic animation seam** — `translateX(-50%)` → `translateX(-50.05%)` in both keyframes. Sub-pixel overlap hides the vertical line where the duplicated row meets itself.
- **SearchBar button** — added `rounded-none` to the submit button. The outer `rounded-full overflow-hidden` container clips it; the global `button { border-radius }` rule was creating visible inner-left corners.
- **"Makers You Follow" cards** — `h-36` fixed height → `aspect-square`, `rounded-2xl overflow-hidden`, hover lift effect. Matches ListingCard modern look.
- **Meet a Maker featured listings** — added `hover:shadow-lg hover:-translate-y-1 transition-all` hover lift.


## Visual Polish — Hover Fix + Dividers + Dashboard (2026-04-22)

### ListingCard hover fix
Removed `hover:shadow-lg hover:-translate-y-1` from outer container. Hover now ONLY zooms the photo via `group-hover:scale-105`. No card emergence effect — text floats on the page background with no white card appearing around it. This matches the design intent of "floating cards" not "contained cards."

### Light dividers (site-wide)
All heavy default borders replaced with `border-neutral-100`:
- NotificationBell dropdown: header, list dividers, footer
- Messages inbox: conversation list dividers
- UserAvatarMenu dropdown: container, header, section separator
- Header hamburger drawer: top and bottom borders

### SearchBar button seamless
Added `style={{ borderRadius: 0 }}` inline on the submit button. The global `button { border-radius: 0.375rem }` CSS rule was overriding Tailwind's `rounded-none` in v4 cascade. Inline style guarantees no inner corners.

### Dashboard pages → card-section
- Analytics: all 14+ stat/chart/table containers
- Inventory: list containers + empty states + dividers
- Blog: post list + empty state
- Seller settings: Shop Updates section

### Mosaic seam
Increased overlap from `-50.05%` to `-50.1%` in both keyframes.


## Final Polish Batch (2026-04-22)

### Styling
- **Notifications page** — `card-section` + `divide-neutral-100`
- **OrderTimeline** — `card-section` container
- **Order/sales item photos** — removed black border outline (kept rounded + object-cover)
- **Saved page** — "Back to My Account" link with ArrowLeft icon
- **Browse FilterSidebar** — consistent `rounded-md border border-neutral-200` on all inputs/selects, `accent-neutral-900` on radios, proper Apply/Reset button styling
- **List view thumbnails** — forced `aspect-square` on thumbnail containers (was non-square)
- **Featured blog card** — `aspect-[16/9] overflow-hidden` (was using original image proportions)
- **Cart mobile** — `flex-wrap gap-2` on price/qty/remove row + `shrink-0` on prices. Prevents overlap on large amounts.

### Functionality
- **Blog toolbar image upload** — Image button now opens a file picker, uploads to R2 via presign route, and inserts the public URL into the editor. Replaces the URL prompt. Link button unchanged.
- **Refund max** — restored full order total (items + shipping + tax) as the maximum refundable amount. Stripe allows refunding the full charge. Helper text about tax proportional refund kept.

### Alt Text for Images (SEO)
- **Schema**: `altText String?` added to both `Photo` and `ReviewPhoto` models. Migration: `20260422042621_add_photo_alt_text`.
- **ListingGallery** — main photo and lightbox use `photo.altText ?? title` for alt attribute.
- **Listing edit page** — alt text input field below each photo thumbnail. "Save alt texts" server action updates each photo's `altText` field. Ownership guard on the save action.
- **ActionForm** — `id` prop support added for form-attribute linking.


## Photo Management + AI Alt Text + SEO + UX (2026-04-22)

### Photo management on create listing
New `PhotoManager` component (`src/components/PhotoManager.tsx`) replaces `ImagesUploader` on the create listing page:
- Upload photos via existing R2 pipeline
- Reorder with left/right arrow buttons
- Delete with X button
- "Cover" badge on first photo, "Make cover" button on others
- Alt text input per photo (max 200 chars, placeholder "Describe this image for SEO...")
- Hidden inputs serialize ordered URLs + alt texts as JSON for form submission
- Server action reads `imageAltTextsJson` and saves to `Photo.altText` on creation

### AI-generated alt text
`reviewListingWithAI` in `src/lib/ai-review.ts` now returns `altTexts?: string[]` — 10-20 word SEO-friendly descriptions per image. GPT-4o-mini already receives images for safety review; alt text is near-zero additional cost (~$0.00015/image). After listing creation, AI alt texts backfill photos that have no seller-provided alt text. Seller's manual alt text always takes priority. `max_tokens` increased from 300 to 500 to accommodate the alt text array.

### Review JSON-LD (SEO)
Top 5 reviews added to Product JSON-LD on listing detail pages. Each review includes `Review` type with author, datePublished, reviewRating, and reviewBody (truncated to 200 chars). Enables Google's review carousel in search results.

### FAQ schema on commission pages (SEO)
`FAQPage` JSON-LD on `/commission` with 3 Q&As: how commissions work, pricing, timelines. Enables Google's FAQ rich snippets (expandable Q&A in search results).

### Blog search by maker
Clicking a maker name in blog search suggestions now navigates to `?author=sellerProfileId` (was text search by name only). Blog page filters by `sellerProfileId` when the `author` URL param is present. Suggestions API returns `sellerProfileId` for author-type suggestions.

### Gift wrap display in cart
Gift wrapping now shows as a separate line item in the cart order summary (shipping step) with the total cost across all sellers. Previously the price was only shown in the GiftNoteSection toggle.

### Section rename
"Stories from the Workshop" → "From the Blog" on the homepage.

### Notification preferences split
Settings page (`/account/settings`) now has two distinct sections:
- **"Your notifications"** (all users): From Makers You Follow, Orders & Cases, buyer email prefs
- **"Shop notifications"** (sellers only): Your Shop, Blog, seller email prefs
`CUSTOM_ORDER_LINK` and `COMMISSION_INTEREST` moved from seller to buyer section (they're buyer-facing notifications).
