# Grainline

A woodworking marketplace built with Next.js, similar to Etsy/Amazon but focused on woodworking makers and their products. Sellers can list items, appear as pins on a local map, and receive payments via Stripe Connect.

## Design System

Visual standards for all UI work on this codebase. Do not deviate without explicit instruction.

### Colors

- **Page background**: `bg-[#F7F5F0]` (warm cream `#F7F5F0`) — creates contrast against `#ffffff` card surfaces
- **Card surface**: `bg-white` (`#ffffff`) — all card info sections, never `bg-stone-50` or any grey tint
- **Borders**: `border-stone-200/60` on cards; `border-neutral-200` on inputs and buttons
- **Text primary**: `text-neutral-900`; secondary: `text-neutral-500`; muted: `text-neutral-400`
- **Accent**: amber — `bg-amber-50`, `border-amber-200`, `text-amber-700` for highlights/badges

### Card Classes (defined in `src/app/globals.css`)

- **`.card-listing`** — listing cards: `background: #fff`, `border: 1px solid rgba(214,211,209,0.6)`, warm box-shadow `0 8px 30px rgba(28,25,23,0.04)`, `border-radius: 0.5rem` (8px), `overflow: hidden`, `hover:shadow-md`, `transition: box-shadow 0.2s`
- **`.card-section`** — content/info blocks: same border + shadow, no hover effect, no overflow:hidden

### Rounding

- **Cards**: `rounded-lg` (8px) via `.card-listing` / `.card-section`
- **Buttons & inputs**: `rounded-md` (6px) — enforced via `button { border-radius: 0.375rem }` global CSS base style in `globals.css`
- **Pills & tags**: `rounded-full` only — never on buttons or cards

### Typography

- **`.font-display`** — `font-family: Georgia, 'Times New Roman', serif; letter-spacing: -0.025em` — applies ONLY to `<h1>` page titles and `<h2>` section headings. Never on card text, prices, nav links, buttons, or metadata.
- **Section headings with `.font-display`**: Browse h1, Commission Room h1, My Account h1/h2s, Your Feed h1, Workshop h1, Messages h1, Listing detail "About this piece" / "Details" / "You might also like" h2s, Dashboard h2s

### Card Image Standards

- **Grid cards** (`card-listing`): `aspect-[4/3] object-cover` — no fixed heights
- **List card thumbnail** (browse list view): full-height left column (`relative w-40 sm:w-48` parent, `absolute inset-0 h-full w-full object-cover` image) — expands to match the text content height
- **Blog/feed cards**: `aspect-[4/3] object-cover`

### Purchase Panel (listing detail)

- Price: `text-3xl font-semibold`
- Buy Now: full-width black button, `rounded-md`, `py-3 min-h-[44px]`
- Add to Cart: full-width bordered button, `rounded-md`
- Seller card: 56px avatar, display name + GuildBadge, tagline, star rating + count, city/state with MapPin icon, "Visit Shop" + Follow + Message in a row

### Icons

- SVG icon components from `src/components/icons/` for all structural/navigational UI
- Category tiles: SVG icons at `size=28`, `bg-stone-100` tile, `text-stone-600` icon
- Section headings: clean `.font-display` serif text only — no inline icons (icons were removed from "Fresh from the Workshop" and "Buyer Favorites" headings for cleaner appearance)
- No emoji in headings or navigation

## Tech Stack

- **Framework**: Next.js 16.2.4 (App Router), React 19.2.5, TypeScript
- **Styling**: Tailwind CSS 4
- **Database**: PostgreSQL via Prisma ORM
- **Auth**: Clerk (`@clerk/nextjs`)
- **Payments**: Stripe + Stripe Connect (seller payouts)
- **File Upload**: UploadThing
- **Maps**: Leaflet / React-Leaflet
- **Email**: Resend
- **Shipping**: Shippo API (live rate quotes and label generation)
- **Error Tracking**: Sentry (error tracking + performance monitoring)

## Project Structure

```
src/
  app/               # Next.js App Router pages and API routes
    api/             # API endpoints (cart, orders, reviews, stripe, shipping, etc.)
    dashboard/       # Authenticated seller/buyer dashboard
    browse/          # Browse listings
    listing/[id]/    # Listing detail page
    cart/            # Shopping cart
    checkout/        # Checkout flow
    messages/        # Buyer/seller messaging
    map/             # All-sellers map view
    seller/[id]/     # Public seller profile
    sellers/         # Sellers directory
    account/         # Buyer account page (orders, saved items, settings)
    account/orders/  # Paginated full order history
  components/        # Reusable React components
  lib/               # Utility modules (db, stripe, shippo, email, etc.)
prisma/
  schema.prisma      # Database schema
  migrations/        # Migration history
```

## Key Data Models

- **User** — authenticated account (linked to Clerk user ID); `role`: `USER | EMPLOYEE | ADMIN` (used for admin panel access control); `banned Boolean @default(false)`, `bannedAt DateTime?`, `banReason String?`, `bannedBy String?` — ban fields set by admin
- **SellerProfile** — seller info, location (lat/lng for map), Stripe Connect account, shipping config; `onboardingStep Int @default(0)`, `onboardingComplete Boolean @default(false)` track wizard progress
- **Listing** — product for sale; status: `DRAFT | ACTIVE | SOLD | SOLD_OUT | HIDDEN | PENDING_REVIEW`; `listingType`: `MADE_TO_ORDER | IN_STOCK`; includes `processingTimeMinDays`, `processingTimeMaxDays` (MADE_TO_ORDER only), `stockQuantity Int?` and `shipsWithinDays Int?` (IN_STOCK only); `isReadyToShip` fully removed. Also has `category Category?`, `viewCount Int @default(0)`, `clickCount Int @default(0)`. Stock is decremented at checkout (Stripe webhook) and restored on case refund resolution. Custom order fields: `isPrivate Boolean @default(false)`, `reservedForUserId String?` (back-relation `reservedForUser User? @relation("ReservedListings")`), `customOrderConversationId String?`.
- **Order** — purchase transaction with Stripe refs, shipping/tax amounts, fulfillment tracking, quoted address snapshot (`quotedTo*` fields), mismatch detection flag (`reviewNeeded`), Shippo label fields, `estimatedDeliveryDate`, and `processingDeadline` (see below)
- **OrderItem** — line items in an order; `listingSnapshot Json?` — snapshot of listing data captured at checkout (title, description, priceCents, imageUrls, category, tags, sellerName, capturedAt)
- **AdminAuditLog** — `id`, `adminId` → `User @relation("AdminActions")`, `action`, `targetType`, `targetId`, `reason?`, `metadata Json @default("{}")`, `undone Boolean @default(false)`, `undoneAt?`, `undoneBy?`, `undoneReason?`, `createdAt`; `@@index([adminId])`, `@@index([targetType, targetId])`, `@@index([createdAt])`, `@@index([undone])`; back-relation `adminActions AdminAuditLog[] @relation("AdminActions")` on `User`. Migration: `20260401011017_ban_audit_ai_review_snapshot`
- **Cart / CartItem** — per-user shopping cart
- **Conversation / Message** — buyer-seller messaging, optionally tied to a listing; `Message` has `kind String?` for structured message types (`custom_order_request`, `custom_order_link`, `file`)
- **Review / ReviewPhoto / ReviewVote** — reviews with photos, seller replies, helpfulness voting
- **Favorite** — saved/bookmarked listings
- **SavedSearch** — per-user saved browse filters (query, category, minPrice, maxPrice, tags array); shown in dashboard; created via `POST /api/search/saved`
- **MakerVerification** — `id`, `sellerProfileId` (unique), `craftDescription`, `yearsExperience`, `portfolioUrl?`, `status VerificationStatus @default(PENDING)`, `reviewedById?`, `reviewNotes?`, `appliedAt`, `reviewedAt?`; back-relations on `SellerProfile` (optional 1:1) and `User` (`verificationReviews @relation("VerificationReviews")`). `VerificationStatus` enum: `PENDING | APPROVED | REJECTED`. Migration: `20260327212938_add_maker_verification`
- **BlogPost / BlogComment / NewsletterSubscriber** — see Blog System section below. Migrations: `20260327215946_add_blog_system`
- **Notification** — `id`, `userId` → `User`, `type NotificationType`, `title`, `body`, `link String?`, `read Boolean @default(false)`, `createdAt`; `@@index([userId, read])`; back-relation `notifications Notification[]` on `User`. Migration: `20260328_add_notifications` (planned; enum + model added). `createNotification(userId, type, title, body, link?)` helper in `src/lib/notifications.ts` wired in 14 places across the app.
- **SiteConfig** — singleton (id=1) storing `fallbackShippingCents` used when Shippo returns no rates
- **Case** — buyer dispute tied 1:1 to an Order; tracks `reason`, `status`, `resolution`, Stripe refund ID, `sellerRespondBy` deadline, `discussionStartedAt`, `escalateUnlocksAt`, `buyerMarkedResolved`, `sellerMarkedResolved`
- **CaseMessage** — threaded messages on a Case (buyer, seller, or staff)

Fulfillment enums: `FulfillmentMethod` (PICKUP | SHIPPING), `FulfillmentStatus` (PENDING | READY_FOR_PICKUP | PICKED_UP | SHIPPED | DELIVERED)

`Category` enum: `FURNITURE | KITCHEN | DECOR | TOOLS | TOYS | JEWELRY | ART | OUTDOOR | STORAGE | OTHER` — display labels in `src/lib/categories.ts` (`CATEGORY_LABELS`, `CATEGORY_VALUES`). **Always use `CATEGORY_VALUES.includes(raw)` to validate — never `Object.values(Category)` which crashes in RSC if Prisma enum is undefined at runtime.** Current display labels: TOOLS → "Home & Office", STORAGE → "Gifts" (updated 2026-04-01).

`ListingStatus` enum: `DRAFT | ACTIVE | SOLD | SOLD_OUT | HIDDEN | PENDING_REVIEW | REJECTED`

`ListingType` enum: `MADE_TO_ORDER | IN_STOCK`

`LabelStatus` enum: `PURCHASED | EXPIRED | VOIDED`

`CaseReason` enum: `NOT_RECEIVED | NOT_AS_DESCRIBED | DAMAGED | WRONG_ITEM | OTHER`

`CaseStatus` enum: `OPEN | IN_DISCUSSION | PENDING_CLOSE | UNDER_REVIEW | RESOLVED | CLOSED`

`CaseResolution` enum: `REFUND_FULL | REFUND_PARTIAL | DISMISSED`

`NotificationType` enum (22 values): `NEW_MESSAGE | NEW_ORDER | ORDER_SHIPPED | ORDER_DELIVERED | CASE_OPENED | CASE_MESSAGE | CASE_RESOLVED | CUSTOM_ORDER_REQUEST | CUSTOM_ORDER_LINK | VERIFICATION_APPROVED | VERIFICATION_REJECTED | BACK_IN_STOCK | NEW_REVIEW | LOW_STOCK | NEW_FAVORITE | NEW_BLOG_COMMENT | BLOG_COMMENT_REPLY | NEW_FOLLOWER | FOLLOWED_MAKER_NEW_LISTING | FOLLOWED_MAKER_NEW_BLOG | SELLER_BROADCAST | COMMISSION_INTEREST | LISTING_APPROVED | LISTING_REJECTED`

### Order — delivery estimate fields

`estimatedDeliveryDate` and `processingDeadline` are calculated in the Stripe webhook when an order is created:

- `processingDeadline` = order creation time + `maxProcessingDays` days (max of all items' `processingTimeMaxDays`, default 3)
- `estimatedDeliveryDate` = `processingDeadline` + `estDays` (from `shipping_rate_data.metadata.estDays` stored at checkout, default 7) + 3 grace days

`estDays` is stored in `shipping_rate_data.metadata` by both checkout routes alongside `objectId`.

### Order — Shippo label fields

These fields are written to `Order` after checkout completes (via the Stripe webhook):

| Field | Source |
|---|---|
| `shippoShipmentId` | Returned by `shippoRatesMultiPiece`, stored in Stripe session metadata, read in webhook |
| `shippoRateObjectId` | Rate's `objectId` stored in `shipping_rate_data.metadata` on Stripe, read from expanded `shipping_cost.shipping_rate.metadata.objectId` in webhook |
| `shippoTransactionId` | Set when a label is purchased via `POST /api/orders/[id]/label` |
| `labelUrl` | Shippo label PDF URL, written on label purchase |
| `labelCarrier` | Carrier for purchased label |
| `labelTrackingNumber` | Tracking number for purchased label |
| `labelPurchasedAt` | Timestamp of label purchase |
| `labelCostCents` | Cost of purchased label in cents |
| `labelStatus` | `LabelStatus` enum value |

## Label Purchase Flow

`POST /api/orders/[id]/label` (`src/app/api/orders/[id]/label/route.ts`) handles the full label purchase lifecycle:

1. **Auth** — verifies the requesting user is a seller who owns the order (same pattern as the fulfillment route).
2. **Guard rails** — returns 400 if `labelStatus = PURCHASED` or `fulfillmentStatus` is already `SHIPPED`, `DELIVERED`, or `PICKED_UP`.
3. **Rate resolution** — picks the rate objectId to use in this order:
   - Caller-supplied `rateObjectId` in the request body (used after a re-quote rate-picker selection) takes priority
   - Falls back to `order.shippoRateObjectId` if the order is under 5 days old
   - Otherwise triggers a re-quote (see below)
4. **Re-quote path** — calls `shippoRatesMultiPiece` using the order's saved `shipTo*` address and item dimensions, runs through `prioritizeAndTrim(rates, 4)`, persists the new `shippoShipmentId`, and returns `{ requiresRateSelection: true, rates }` with HTTP 202.
5. **Label purchase** — calls `POST /transactions/` on Shippo with `{ rate, label_file_type: "PDF", async: false }`. On success, writes all label fields to the Order and sets `fulfillmentStatus = SHIPPED`.
6. **Stripe clawback** — calls `stripe.transfers.createReversal(order.stripeTransferId, { amount: labelCostCents })` to deduct the label cost from the seller's payout. Wrapped in try/catch so a Stripe failure doesn't roll back a successful label purchase.

### LabelSection UI (`src/components/LabelSection.tsx`)

Client component rendered in the seller order detail page (`src/app/dashboard/sales/[orderId]/page.tsx`) for non-pickup shipping orders. Three render states:

- **Purchased** — green "Download Label" button opening `labelUrl` in a new tab, plus carrier, tracking number, and purchase timestamp.
- **Rate picker** (shown after a 202 re-quote response) — radio list of up to 4 rates showing carrier, service, estimated days, and cost. Confirming a selection re-calls the label route with `{ rateObjectId }`.
- **Default** (no label yet, order not yet shipped) — "Purchase Label" button with an estimated cost note derived from `shippingAmountCents`.

The existing "Mark as Shipped" manual tracking form remains below, under the heading "Already shipped? Enter tracking manually".

## Case / Dispute System

Five API routes handle the full case lifecycle:

| Route | Who | What |
|---|---|---|
| `POST /api/cases` | Buyer | Opens a case. Validates buyer owns order, delivery date is in the past, no existing case. Sets `sellerRespondBy` to 48h from now. Creates Case + initial CaseMessage. |
| `POST /api/cases/[id]/messages` | Buyer, seller, or staff | Adds a message to the thread. Blocks on RESOLVED/CLOSED cases. When seller posts first reply on OPEN case: sets `IN_DISCUSSION`, `discussionStartedAt`, `escalateUnlocksAt = now + 48h`. |
| `POST /api/cases/[id]/escalate` | Buyer/seller (if `escalateUnlocksAt` past) or staff/CRON_SECRET | `id="all"` bulk-escalates OPEN cases past `sellerRespondBy` (staff/cron only). Single ID: buyer/seller may escalate after `escalateUnlocksAt`; sets `UNDER_REVIEW`. |
| `POST /api/cases/[id]/mark-resolved` | Buyer or seller | Marks their side resolved. First call → `PENDING_CLOSE`. Both calls → `RESOLVED` with `DISMISSED`. |
| `POST /api/cases/[id]/resolve` | EMPLOYEE or ADMIN | Accepts `resolution` + optional `refundAmountCents`. Issues Stripe refund (full with `reason: "fraudulent"`, partial by amount). Stamps `stripeRefundId`, sets case RESOLVED, flags order `reviewNeeded`. |

### Seller self-service refund

`POST /api/orders/[id]/refund` lets sellers issue refunds directly:
- Auth: verifies requesting user is a seller who owns items in the order
- Body: `{ type: "FULL" | "PARTIAL", amountCents?: number }`
- Issues Stripe refund with `refund_application_fee: true` + `reverse_transfer: true` — proportional platform fee returned to seller, refund comes from seller's Stripe balance (not platform). Manual `transfers.createReversal` removed (handled by `reverse_transfer` flag).
- Restores stock for IN_STOCK items on FULL refund
- Atomically resolves any open case as REFUND_FULL or REFUND_PARTIAL

**Refund flags** (audited 2026-04-15): both refund routes (`/api/orders/[id]/refund` + `/api/cases/[id]/resolve`) now include `refund_application_fee: true` and `reverse_transfer: true`. Without these, platform keeps fee on refunds (unfair to seller) and refund comes from platform balance (wrong).

**Gift wrap fee**: excluded from platform fee base — gift wrap is a seller-provided service added as separate Stripe line item. Platform fee applies only to product items.
- Stamps `order.sellerRefundId`, `order.sellerRefundAmountCents`, `reviewNeeded = true`

`SellerRefundPanel` client component (`src/components/SellerRefundPanel.tsx`) is rendered in the seller order detail page above fulfillment actions. Shows already-issued refund notice if `sellerRefundId` is set; otherwise offers Full Refund / Partial Refund buttons.

### CaseStatus flow

`OPEN` → (seller replies) → `IN_DISCUSSION` → (one party marks resolved) → `PENDING_CLOSE` → (other party confirms) → `RESOLVED`

Either party may escalate to `UNDER_REVIEW` once `escalateUnlocksAt` (48h after discussion starts) has passed. Staff/cron may escalate at any time.

Listing type and availability is surfaced on listing pages: green "In Stock (N available)" badge for IN_STOCK with quantity > 0, red "Out of Stock" badge (buy buttons disabled) for IN_STOCK with quantity = 0 or status SOLD_OUT, "Made to order — ships in X–Y days" (or plain "Made to order") for MADE_TO_ORDER. Sellers set it via `ListingTypeFields` client component (`src/components/ListingTypeFields.tsx`) in the create/edit listing forms. `ProcessingTimeFields.tsx` has been replaced.

## Case / Dispute UI (complete)

All case UI is implemented end-to-end:

- **Buyer** — `src/app/dashboard/orders/[id]/page.tsx`: "Open a Case" button (via `OpenCaseForm`) when eligible; case thread + `CaseReplyBox` for OPEN/IN_DISCUSSION/PENDING_CLOSE; `CaseMarkResolvedButton` for IN_DISCUSSION/PENDING_CLOSE; `CaseEscalateButton` when `escalateUnlocksAt` has passed; "Waiting for seller" message when buyer has marked resolved
- **Seller** — `src/app/dashboard/sales/[orderId]/page.tsx`: status banner (amber=OPEN, blue=IN_DISCUSSION, teal=PENDING_CLOSE, purple=UNDER_REVIEW); full message thread; `CaseReplyBox` for OPEN/IN_DISCUSSION/PENDING_CLOSE; `CaseMarkResolvedButton` + `CaseEscalateButton`; "Waiting for buyer" message; `SellerRefundPanel` above fulfillment actions
- **Admin** — `src/app/admin/cases/page.tsx`: paginated queue sorted active-first, status filter tabs (including IN_DISCUSSION and PENDING_CLOSE), count badge in sidebar (`layout.tsx` counts OPEN+IN_DISCUSSION+PENDING_CLOSE+UNDER_REVIEW); `src/app/admin/cases/[id]/page.tsx`: full detail with `CaseResolutionPanel` (full refund, partial refund, dismiss) and staff reply box

Client components: `OpenCaseForm`, `CaseReplyBox`, `CaseResolutionPanel`, `CaseEscalateButton`, `CaseMarkResolvedButton`, `SellerRefundPanel`

## Search & Browse

The browse page (`src/app/browse/page.tsx`) is a full-featured search experience:

- **Filters**: category select, listing type (IN_STOCK / MADE_TO_ORDER), ships-within days, min/max price, sort (relevance / newest / price / popular), tags (via URL `tag=` params), location radius (Haversine raw SQL on SellerProfile lat/lng), min rating
- **Relevance sort**: fetches up to 200 results, scores in JS (`favCount×0.3 + viewCount×0.1 + recency×0.2 − soldOut×0.5`), then paginates
- **Standard sorts**: Prisma pagination; `popular` uses `{ favorites: { _count: 'desc' } }`
- **No-results**: shows featured listings (most favorited), popular tag suggestions, browse-all link
- **Layout**: two-column flex — `FilterSidebar` (sticky aside, mobile drawer) + main grid; grid/list toggle via `view` URL param
- **ClickTracker** (`src/components/ClickTracker.tsx`) — "use client" `<li>` wrapper that fires `POST /api/listings/[id]/click` on click (fire-and-forget). Used on: browse grid/list cards, homepage Fresh from the Workshop cards, homepage Buyer Favorites cards, homepage From Your Makers listing cards, `SimilarItems`, seller profile Featured Work cards, seller profile All Listings cards, seller shop grid cards, account saved items scroll row, account/saved listings grid
- **SaveSearchButton** (`src/components/SaveSearchButton.tsx`) — "use client", reads `useSearchParams`, POSTs to `/api/search/saved`; redirects to sign-in if not logged in
- **FilterSidebar** (`src/components/FilterSidebar.tsx`) — "use client", reads `useSearchParams`, uses `key={searchParams.toString()}` form trick for `defaultValue` sync

### Search suggestions / autocomplete

`GET /api/search/suggestions?q=` returns up to 8 deduplicated suggestions from 4 parallel queries:
1. Listing title substring matches (ILIKE) — filtered `seller: { chargesEnabled: true }`
2. Tag partial matches via `unnest(tags) ILIKE` (raw SQL, `INNER JOIN "SellerProfile" sp ON sp.id = l."sellerId"`, `AND sp."chargesEnabled" = true`)
3. Seller displayName matches — not filtered by chargesEnabled (sellers appear regardless)
4. Fuzzy title matches via `similarity(title, q) > 0.25` (pg_trgm) — same `INNER JOIN` + chargesEnabled filter

Plus category label matches from `CATEGORY_VALUES`.

`SearchBar` (`src/components/SearchBar.tsx`) — "use client" header component with 300ms debounce, dropdown, Escape/click-outside dismiss, `onMouseDown + e.preventDefault()` on suggestion buttons to avoid blur-before-click race. **Suggestions trigger at 2 characters** (was 3). **Popular tags on focus**: when the input is focused and empty, fetches `GET /api/search/popular-tags` (ISR 1hr, top 8 by active listing count) and shows them as a "Popular searches" section above regular suggestions; loaded once per session (`popularLoaded` guard).

`GET /api/search/popular-tags` — public route, ISR cached 1 hour (`export const revalidate = 3600`); raw SQL `unnest(tags)` grouped by count on ACTIVE non-private listings; returns `{ tags: string[] }` (up to 8). Used only by `SearchBar`.

`GET /api/search/popular-blog-tags` — public route, ISR cached 1 hour; raw SQL `unnest(tags)` grouped by count on PUBLISHED blog posts; returns `{ tags: string[] }` (up to 8). Used by `BlogSearchBar` — shows popular blog topics, not listing tags.

**Category suggestions** — `GET /api/search/suggestions` now also returns `categories: { value, label }[]` (structured, for routing to `/browse?category=VALUE`). Category labels remain in the flat `suggestions` string array for backward compatibility. `SearchBar` renders a "Categories" section in the dropdown between popular tags and text suggestions. `BlogSearchBar` shows popular blog topics on focus (navigating to `/blog?bq=...&sort=relevant`).

### Analytics fields

- `viewCount` — incremented by `POST /api/listings/[id]/view` (24h `httpOnly` cookie deduplication). `ListingViewTracker` ("use client") fires this on mount from listing detail pages.
- `clickCount` — incremented by `POST /api/listings/[id]/click` (same cookie pattern). `ClickTracker` fires this on card click in browse and all other listing card surfaces (see ClickTracker entry above).

### Saved Searches

`SavedSearch` model stores `userId`, `query`, `category`, `minPrice`, `maxPrice`, `tags[]`. API: `POST/GET/DELETE /api/search/saved`. Dashboard (`/dashboard`) shows a "Saved Searches" section with browse link and delete button per entry.

## SEO (complete)

- **`metadataBase`** set to `https://thegrainline.com` in `src/app/layout.tsx`
- **Root metadata** (`layout.tsx`): full title template (`%s | Grainline`), description, keywords, OG (type, siteName, title, description, `/og-image.jpg` 1200×630), Twitter card
- **`generateMetadata`** on `listing/[id]`, `seller/[id]`, and `browse` pages — title, description, OG image, Twitter card; listing page also sets `other: { product:price:amount, product:price:currency }`
- **Canonical URLs** — `alternates: { canonical }` on listing, seller, and browse `generateMetadata` (browse varies by `q` / `category` / default)
- **JSON-LD** on listing pages: `Product` schema (name, description, images, sku, brand, offers with seller name, aggregateRating when reviews exist) + `BreadcrumbList` (Home → Category → Listing, or Home → Listing if no category)
- **LocalBusiness JSON-LD** on seller pages: name, description, url, `knowsAbout: "Handmade Woodworking"`, PostalAddress (city/state), GeoCoordinates (only when lat/lng set)
- **Sitemap** (`src/app/sitemap.ts`): homepage `priority: 1.0` daily, browse `0.9` daily, active listings `0.8` weekly with `updatedAt`, seller profiles `0.6` monthly with `updatedAt`; private routes excluded
- **robots.txt** (`src/app/robots.txt/route.ts`): allows all crawlers with `Crawl-delay: 10`; disallows `/dashboard`, `/admin`, `/cart`, `/checkout`, `/api`; blocks AI training bots (GPTBot, ClaudeBot, CCBot, Google-Extended, anthropic-ai, MJ12bot, SemrushBot); rate-limits AhrefsBot (`Crawl-delay: 60`); `Sitemap: https://thegrainline.com/sitemap.xml`
- **Photo filename tip** in new and edit listing forms (below uploader/photos section)

## Seller Profile Personalization (complete)

### Schema additions
- **24 new `SellerProfile` fields**: `tagline`, `bannerImageUrl`, `workshopImageUrl`, `storyTitle`, `storyBody`, `instagramUrl`, `facebookUrl`, `pinterestUrl`, `tiktokUrl`, `websiteUrl`, `yearsInBusiness`, `acceptsCustomOrders`, `acceptingNewOrders`, `customOrderTurnaroundDays`, `offersGiftWrapping`, `giftWrappingPriceCents`, `returnPolicy`, `customOrderPolicy`, `shippingPolicy`, `featuredListingIds`, `galleryImageUrls`, `isVerifiedMaker`, `verifiedAt`
- **`SellerFaq` model** — `id`, `sellerProfileId`, `question`, `answer`, `sortOrder`, `createdAt`; `@@index([sellerProfileId, sortOrder])`; back-relation `faqs SellerFaq[]` on `SellerProfile`
- **`Order` fields**: `giftNote String?`, `giftWrapping Boolean @default(false)`
- Migration: `20260327190830_expand_seller_profile`

### UploadThing endpoints added
- `bannerImage` — 1 file, max 4MB, auth required
- `galleryImage` — 10 files, max 4MB each, auth required

### New components
- `ProfileBannerUploader` — client component for banner upload; shows current image or gradient placeholder; hidden input passes URL to parent form
- `ProfileWorkshopUploader` — same pattern for workshop photo (uses `galleryImage` endpoint)
- `CharCounter` — controlled textarea with live character counter

### Dashboard profile page (`/dashboard/profile`)
Seven sections with a single `updateSellerProfile` server action for fields A–F; separate server actions `addFaq`, `deleteFaq`, `toggleFeaturedListing`:
- **A. Shop Identity** — banner upload, display name, tagline (max 100), years in business
- **B. Your Story** — bio (max 500, char counter), story title, story body (max 2000, char counter), workshop photo
- **C. Social Links** — Instagram, Facebook, Pinterest, TikTok, website URLs
- **D. Shop Policies** — return policy, custom order policy, shipping policy, FAQ list with add/delete
- **E. Custom Orders & Availability** — acceptsCustomOrders toggle, acceptingNewOrders toggle, turnaround days
- **F. Gift Wrapping** — offersGiftWrapping toggle, price in dollars (stored as cents)
- **G. Featured Listings** — active listings grid, click to feature/unfeature (max 6), star badge on featured

### Public seller profile (`/seller/[id]`) redesigned
- Full-width banner image (or gradient placeholder) + seller avatar (`absolute bottom-0 translate-y-1/2`, `ring-4 ring-white`, h-24 w-24) overlapping banner
- Display name, tagline, city/state, verified maker badge (amber, "✓ Verified Maker") if `isVerifiedMaker`
- Social links as icon components (20×20, `title` tooltip, opens in new tab) — `Instagram`, `Facebook`, `Pinterest`, `TikTok`, `Globe` from `@/components/icons`
- Years in business, shop rating, custom order acceptance badges
- Featured Work grid (fetched in `featuredListingIds` order)
- Story section (title + body + workshop photo)
- Bio section
- Pickup area map (existing)
- Shop Policies accordion (`<details>`/`<summary>`) — return, custom order, shipping
- FAQ accordion
- Gallery image grid
- All listings grid
- `generateMetadata` uses `tagline` as fallback description; OG image prefers `bannerImageUrl` then `avatarImageUrl`

## Seller Avatar System (complete)

- **`SellerProfile.avatarImageUrl String?`** — custom uploaded avatar separate from Clerk `imageUrl`; migration `20260327193147_add_seller_avatar`
- **`ProfileAvatarUploader`** — client component using `galleryImage` endpoint; shows preview circle or placeholder; hidden input passes URL to form
- Avatar source priority everywhere: `seller.avatarImageUrl ?? seller.user?.imageUrl` — applied consistently in:
  - `/seller/[id]/page.tsx` (large banner-overlap avatar)
  - `src/app/browse/page.tsx` (seller chip on listing cards)
  - `src/app/listing/[id]/page.tsx` (seller chip on listing detail)
  - `src/app/page.tsx` (homepage most-saved and fresh-finds seller chips)
  - `src/app/dashboard/saved/page.tsx` (saved items seller chips)
- **Audited all avatar rendering sites** (2026-04-13): all seller-context avatars confirmed to use `avatarImageUrl ?? user.imageUrl` priority; buyer-only contexts (`User.imageUrl` alone) confirmed correct
- **Shop profile fallback preview** (`/dashboard/profile`): below `ProfileAvatarUploader`, shows the Clerk avatar (`user.imageUrl`) labeled "Current photo from Manage Account — used as fallback if no custom photo is uploaded above.". Query updated to `include: { user: { select: { imageUrl: true } } }`
- **Remove custom avatar** (2026-04-13): `removeSellerAvatar()` server action in `/dashboard/profile/page.tsx` sets `avatarImageUrl: null` and calls `revalidatePath`; "Remove custom photo" button shown as a ConfirmButton form only when `fullSeller.avatarImageUrl` is non-null; `ProfileAvatarUploader` has `key={fullSeller.avatarImageUrl ?? "none"}` to force remount on removal

## Gift Notes & Gift Wrapping at Checkout (complete)

- **Schema**: `Order.giftNote String?`, `Order.giftWrapping Boolean @default(false)`, `Order.giftWrappingPriceCents Int?`; migrations `20260327190830_expand_seller_profile`, `20260327200559_add_gift_wrapping_price`
- **`GiftNoteSection`** — controlled client component; "This is a gift" checkbox reveals gift note textarea (max 200 chars) and optional gift wrapping checkbox (shows seller's price if set); `onChange(note, wrapping)` callback
- **Cart page** — per-seller `giftBySeller` state; passes `giftNote`, `giftWrapping`, `giftWrappingPriceCents` in checkout request body
- **Checkout routes** (`checkout-seller`, `checkout/single`) — if `giftWrapping && giftWrappingPriceCents > 0`, appends "Gift Wrapping" Stripe line item; all three values passed through session metadata
- **Stripe webhook** — reads gift fields from metadata; saves to Order on create
- **Order detail pages** — amber "🎁 Gift order" box shown to both buyer (`/dashboard/orders/[id]`) and seller (`/dashboard/sales/[orderId]`) when `giftNote` or `giftWrapping` is set

## Notify When Back In Stock (complete)

- **`StockNotification` model** — `id`, `listingId`, `userId`, `createdAt`; `@@unique([listingId, userId])`; back-relations on `Listing` and `User`; migration `20260327194638_add_gift_and_stock_notification`
- **`POST /api/listings/[id]/notify`** — auth required; upserts `StockNotification` record; returns `{ subscribed: true }`
- **`DELETE /api/listings/[id]/notify`** — auth required; deletes record; returns `{ subscribed: false }`
- **`NotifyMeButton`** — client component; shown on listing detail when `isOutOfStock && !isOwnListing`; toggles subscription; redirects to sign-in if not logged in; shows "🔔 You'll be notified…" + unsubscribe link when subscribed
- Restock email (`sendBackInStock`) wired in `PATCH /api/listings/[id]/stock/route.ts` — sends to each subscriber when status transitions `SOLD_OUT → ACTIVE`; only fires once Resend domain is verified

## Homepage Personality Upgrades (complete)

`src/app/page.tsx` fully redesigned with 9 sections in order:

1. **Hero** — `min-h-screen` `bg-gradient-to-br from-amber-50 to-stone-100`; large heading; trending tag chips (raw SQL `unnest(tags)` top 5); centered `SearchBar`; "Browse the Workshop" + "Find Makers Near You" CTAs; bouncing chevron scroll indicator (`animate-bounce`, `absolute bottom-8`)
2. **Stats bar** — thin `border-b` strip; makers count fixed to `prisma.sellerProfile.count({ where: { listings: { some: { status: ACTIVE } } } })` (only active-listing sellers); "X pieces listed · X active makers · X orders fulfilled"; wrapped in `ScrollSection` for fade-in
3. **Find Makers Near You** — full-width `bg-stone-50 border-b` section; heading + subheading; `MakersMapSection` (now accepts optional `heading`/`subheading` props, falls back to defaults); replaces old "Made Near You" at bottom
4. **Shop by Category** — 5 categories + "Browse all →" tile; `overflow-x-auto` horizontal scroll on mobile, `grid-cols-6` on desktop; `ScrollSection` fade-in
5. **Meet a Maker spotlight** — 3-tier selection: (1) admin-featured (`featuredUntil > now()`) takes priority, (2) weekly deterministic rotation among all Guild Members/Masters aligned to Monday–Sunday calendar weeks (same anchor used for "Maker of the Week" pill), (3) most-reviewed seller fallback. Two-column desktop layout (`lg:grid-cols-2`) — left: amber "Maker of the Week" pill, avatar, GuildBadge, tagline, location, rating, bio (120 chars), "Visit Their Workshop" button; right: 3-column grid of up to 3 featured listing cards (curated `featuredListingIds[]` first, then most recent ACTIVE). Banner `h-48`. Right column hidden if no active listings. `ScrollSection` fade-in
6. **Fresh from the Workshop 🪵** — horizontal scroll row (`overflow-x-auto flex snap-x snap-mandatory`), 6 cards, `w-56 flex-none` per card; `ScrollSection` fade-in
7. **Collector Favorites ❤️** — same horizontal scroll pattern, 6 cards; `ScrollSection` fade-in
8. **Stories from the Workshop** — 3-col grid of blog post cards; `ScrollSection` fade-in
9. **Newsletter signup** — full-width `bg-amber-50 border-t` section; uses `NewsletterSignup` component; `ScrollSection` fade-in

`RecentlyViewed` removed from homepage (still present on `/browse`).

## Tone & Copy (complete)

- **Sellers → Makers** in all user-facing UI text (map subtitle, listing "Message maker", order pages, pickup coordination text — variable/API/URL names unchanged)
- **Order status personality banners** — neutral card shown at top of both buyer (`/dashboard/orders/[id]`) and seller (`/dashboard/sales/[orderId]`) order detail pages:
  - Buyer: "Your maker is preparing your piece" / "Your piece is on its way! 🚚" / "Delivered — enjoy your piece! 🎉" / "Ready for pickup!" / "Picked up — enjoy!"
  - Seller: "New order — time to get crafting! 🪵" / "Shipped — nice work!" / "Delivered — another happy collector!" / "Ready for pickup!" / "Picked up — great work!"
- **Empty states with personality** across: browse ("No pieces found…"), dashboard listings ("Your workshop is empty — list your first piece and start selling"), buyer orders ("No orders yet — find something you love in the browse page"), sales ("No orders yet — your first sale is right around the corner 🪵"), saved items ("Nothing saved yet — start hearting pieces you love while browsing"), messages ("No conversations yet — reach out to a maker about their work"), reviews ("No reviews yet — be the first to share your experience")
- **Custom 404** (`src/app/not-found.tsx`) — "Looks like this page got sanded down." with "Browse the Workshop" + "Go Home" buttons
- **Custom error** (`src/app/error.tsx`) — `"use client"`, "Something splintered." with "Try again" (calls `reset`) + "Go Home" buttons
- **`acceptingNewOrders` indicator** — amber pill "Not accepting new orders" / "Maker currently not accepting new orders" shown on browse cards (grid + list) and listing detail page when `seller.acceptingNewOrders === false`

## Custom Order System (complete)

### Schema additions
- **`Listing`**: `isPrivate Boolean @default(false)`, `reservedForUserId String?` (→ `User @relation("ReservedListings")`), `customOrderConversationId String?`
- **`Message`**: `kind String?` — structured message type; values: `custom_order_request`, `custom_order_link`
- **`User`**: `reservedListings Listing[] @relation("ReservedListings")` back-relation
- Migration: `20260327204512_add_custom_order_system`

### Entry points (three places to request a custom order)
1. **Seller profile** (`/seller/[id]`) — "🔨 Request a Custom Piece" amber button shown when `seller.acceptsCustomOrders && meId && meId !== seller.userId`; sign-in link if logged out
2. **Listing detail** (`/listing/[id]`) — "Request Something Similar" panel below buy buttons when `seller.acceptsCustomOrders && !isOwnListing && !reservedForOther`; sign-in link if logged out
3. **Message thread** — `custom_order_request` card has "Create Custom Listing →" button for the seller (shown when `m.senderId !== meId`)

### `CustomOrderRequestForm` (`src/components/CustomOrderRequestForm.tsx`)
Self-contained `"use client"` component with trigger button + modal overlay:
- **Fields**: description (required, max 500), dimensions (optional), budget in USD (optional), timeline select (no rush / 2 months / 1 month / 2 weeks)
- **On submit**: `POST /api/messages/custom-order-request` → success state with "View Conversation" button that navigates to `/messages/[conversationId]`
- Accepts `triggerLabel` and `triggerClassName` props so server components can import and render it directly

### `POST /api/messages/custom-order-request`
- Auth required; validates `sellerUserId` and `description`
- Upserts conversation (same canonical sort + race-safe logic as `/messages/new`)
- Creates `Message` with `kind: "custom_order_request"`, `body`: JSON with `description`, `dimensions`, `budget`, `timeline`, `timelineLabel`, `listingId`, `listingTitle`
- Returns `{ conversationId }`

### Custom listing creation (`/dashboard/listings/custom`)
URL: `/dashboard/listings/custom?conversationId=[id]&buyerId=[id]`
- Seller-only page (uses `ensureSeller()`)
- Shows buyer's `custom_order_request` details at top (amber reference card)
- Form mirrors new listing form; hidden fields: `conversationId`, `reservedForUserId`
- `createCustomListing` server action: creates listing with `isPrivate: true`, `reservedForUserId`, `customOrderConversationId`; sends `custom_order_link` message back (JSON body: `listingId`, `title`, `priceCents`, `currency`); redirects to `/messages/[conversationId]`

### ThreadMessages rendering (`src/components/ThreadMessages.tsx`)
- `Msg` type gains `kind?: string | null`
- `custom_order_request` → amber card with description, dimensions, budget, timeline; seller sees "Create Custom Listing →" link
- `custom_order_link` → white card with listing title, price, "Purchase This Piece →" link to `/listing/[id]`
- `kind` added to all message selects: server page, `/api/messages/[id]/list`, `/api/messages/[id]/stream`

### Private listing enforcement
- Browse, homepage, search suggestions, tag counts all add `isPrivate: false` to Prisma queries and raw SQL (`AND "isPrivate" = false`)
- Listing detail page: `reservedForOther` hides buy buttons and shows "custom piece reserved for another buyer" notice; `reservedForMe` shows "🎨 This piece was made just for you!" amber banner and buy buttons display normally
- `/api/listings/[id]/stock` PATCH: private listings are not promoted to `ACTIVE` when restocked

## Guild Verification Program (Phases 1, 2, 3 complete)

Two-tier badge system replacing the old single "Verified Maker" badge.

### Schema additions
- **`GuildLevel` enum** — `NONE | GUILD_MEMBER | GUILD_MASTER`
- **`VerificationStatus` additions** — `GUILD_MASTER_PENDING | GUILD_MASTER_APPROVED | GUILD_MASTER_REJECTED` (keeping existing `PENDING | APPROVED | REJECTED` for Guild Member)
- **`SellerProfile` additions**: `guildLevel GuildLevel @default(NONE)`, `guildMemberApprovedAt DateTime?`, `guildMasterApprovedAt DateTime?`, `guildMasterAppliedAt DateTime?`, `guildMasterReviewNotes String?`
- Migration: `20260330181203_add_guild_levels`
- `isVerifiedMaker` boolean retained on SellerProfile for legacy compatibility; set to `true` on Guild Member approval

### `GuildBadge` component (`src/components/GuildBadge.tsx`)
- `"use client"` — accepts `level: GuildLevelValue`, `showLabel?: boolean` (default `false`), `size?: number` (default `18`)
- Returns `null` if level is `"NONE"`
- `WREATH_D` (full single path from `gold-laurel-wreath.svg`, viewBox 1200x1200), `BADGE_VIEWBOX`, `STAR_POINTS` (5-point polygon, r_out=235, r_in=94, center 600,595 — slightly oversized to fully cover baked-in star) — module-level constants shared by both icons. Star rendered with `strokeWidth={30} strokeLinejoin="round"` for rounded points. No subpath splitting. `useId()` for hydration-safe gradient IDs.
- **Guild Member** — `LaurelWreathIcon`: earthy green wreath (`#5B7553 → #3F5D3A → #1F3A1E`, pine/oak tones) + bronze star polygon overlay (`#E8B86D → #B8860B → #8B6914`). Label text color `#14532d` (green-900).
- **Guild Master** — `StarWreathIcon` (replaces `HammerChiselIcon`): gold wreath (`#FFD700 → #D4AF37 → #B8960C`) + diamond star polygon overlay — cut-gemstone palette (`#FAFBFF → #D8DCE8 → #A0A8BC`). Both polygons same position/size, different gradients. Label text color `#B8960C`.
- Popup descriptions: original legally-reviewed language (profile standing disclaimer for Member; historical performance disclaimer for Master). Popup icon size 48px.
- **Popup**: `createPortal`-based — renders at `document.body` to avoid `overflow:hidden` clipping; positioned below the badge button using `getBoundingClientRect()` + scroll offsets, clamped to viewport width; closes on outside click or Escape; "Learn more about Guild Verification →" link to `/terms#guild-verification-program`. Opacity gating: popup starts at `opacity:0`, transitions to `opacity:1` after position calculated via `getBoundingClientRect` — eliminates top-left flash on open.
- `showLabel={false}` → icon only (used on listing cards); `showLabel={true}` → icon + label text (used on profile/detail pages)
- `GuildLevelValue` type exported from the file

### Badge placement with props

Status badges (Made to order / Ready to ship / Out of stock) removed from listing cards — redundant noise. Only visible on listing detail page. Guild badge: 40px, right-aligned in metadata area via two-column flex layout (`flex-1 min-w-0` for text, `flex-none` for badge), vertically centered against metadata block. No photo overlay. FavoriteButton heart wrapped in `bg-black/30 rounded-full p-1.5 backdrop-blur-sm` for visibility on all photo backgrounds. SimilarItems no longer shows a badge (too cluttered). Browse list-view ListCard keeps an inline 22px badge next to seller name.

LaurelWreathIcon and HammerChiselIcon default sizes both bumped to 32.

| Surface | `showLabel` | `size` |
|---|---|---|
| ListingCard metadata right column | `false` | `40` |
| Browse ListCard inline (list view only) | `false` | `22` |
| Commission interested makers | `false` | `22` |
| Makers metro directory | `false` | `22` |
| Listing detail seller section | `true` | `32` |
| Homepage Meet a Maker | `true` | `32` |
| Seller profile header | `true` | `36` |
| Seller shop header | `true` | `36` |
| Dashboard verification page (section headers) | `true` | `28` |

### Seller dashboard (`/dashboard/verification`)
Two sections:
- **Section A (Guild Member)**: Active (green) if `guildLevel !== NONE`; Under Review (amber) if `status === PENDING`; **eligibility checklist** otherwise showing ✓/✗ for each requirement (active listings ≥ 5, completed sales ≥ $250, account age ≥ 30 days, no cases open > 60 days) + profile completeness as ○ recommendation; application form shown only when all 4 criteria met
- **Section B (Guild Master)**: Only shown if `isMemberActive`; Active (indigo) if `guildLevel === GUILD_MASTER`; Under Review if `status === GUILD_MASTER_PENDING`; application form otherwise (business description, portfolio, standards checkbox)
- `applyForGuildMaster` server action updates `MakerVerification.status = GUILD_MASTER_PENDING` and `SellerProfile.guildMasterAppliedAt` in a `$transaction`

### Admin queue (`/admin/verification`)
Four sections:
1. **Guild Member Applications** (PENDING) — visual 8-item review checklist (profile photo, bio, listings, policies, no red flags, craft description authenticity, portfolio check, sales requirement); functional **admin override checkbox** ("Override $250 sales requirement"); `approveGuildMember(formData)` reads `verificationId` + `adminOverride` from form; when override checked, sets `reviewNotes = "Admin override: $250 sales requirement waived"` on approval; Reject with notes
2. **Guild Master Applications** (GUILD_MASTER_PENDING) — Approve (sets `guildLevel = GUILD_MASTER`, `guildMasterApprovedAt`) / Reject (sets `guildMasterReviewNotes`)
3. **Active Guild Members** — Revoke Badge (sets `guildLevel = NONE`, `isVerifiedMaker = false`)
4. **Active Guild Masters** — Revoke Guild Master (sets `guildLevel = GUILD_MEMBER`)
- All approve/reject send `VERIFICATION_APPROVED` / `VERIFICATION_REJECTED` notifications and emails

### API route (`/api/verification/apply`)
Server-side eligibility enforcement mirrors dashboard check — returns 400 with specific error messages if any of the 4 criteria fail (e.g. "You need $X more in sales").

### Terms page Section 19.2
Updated to remove "identity verification" language; now lists: completed profile, ≥5 active listings, $250 in completed sales, good account standing, reviewed by Grainline staff.

### Dashboard nav (`/dashboard`)
- `guildLevel === GUILD_MASTER` → indigo "Guild Master" pill
- `guildLevel === GUILD_MEMBER` → amber "Guild Member" pill
- `status === PENDING` → "Guild Badge Pending"
- Otherwise → "Apply for Guild Badge"

### Build fix
`package.json` build script updated to `"prisma generate && next build"` so Vercel always regenerates the Prisma client before compiling TypeScript.

### Phase 1 — complete (badge icon images still pending)
- Badge icons are functional SVGs (laurel wreath for Guild Member, hammer+chisel for Guild Master) — user may provide custom image replacements later
- Monogram stamp picker not yet built (see "Still unbuilt" under Phase 3)

### Phase 2 — complete

Migration: `20260330195257_seller_metrics_and_first_response`

- **`shippedAt DateTime?`** on `Order` — was already present from fulfillment work; set in both label route and fulfillment route when order ships
- **`firstResponseAt DateTime?`** on `Conversation` — set in `sendMessage` server action (`messages/[id]/page.tsx`) when the first reply is sent in a conversation where the other person sent the opening message
- **`SellerMetrics` model** — `id`, `sellerProfileId` (unique → SellerProfile cascade), `calculatedAt`, `periodMonths @default(3)`, `averageRating`, `reviewCount`, `onTimeShippingRate`, `responseRate`, `totalSalesCents`, `completedOrderCount`, `activeCaseCount`, `accountAgeDays`; back-relation `sellerMetrics SellerMetrics?` on `SellerProfile`
- **`calculateSellerMetrics(sellerProfileId, periodMonths=3)`** in `src/lib/metrics.ts` — computes all 9 metrics in parallel Prisma queries, upserts to `SellerMetrics`; also exports `meetsGuildMasterRequirements(metrics)` returning per-criteria booleans + `allMet`, and `GUILD_MASTER_REQUIREMENTS` constants
- **Guild Master requirements**: averageRating ≥ 4.5, reviewCount ≥ 25, onTimeShippingRate ≥ 95%, responseRate ≥ 90%, accountAgeDays ≥ 180, totalSalesCents ≥ $1,000, activeCaseCount = 0
- **Dashboard verification** (`/dashboard/verification`) — Section B now calls `calculateSellerMetrics()` on load when seller is Guild Member and hasn't been approved yet; shows live metrics vs requirements checklist (✓/✗ per criterion); application form only rendered when `masterCriteria.allMet === true`; falls back to static requirements list if metrics unavailable
- **Admin verification** (`/admin/verification`) — Guild Master Applications section fetches live metrics for each pending applicant via `Promise.allSettled`; each card shows an indigo "Live Metrics" panel with 8 metrics (avg rating, reviews, on-time shipping, response rate, account age, total sales, open cases, orders) with ✓/✗ indicators and "All requirements met" / "Some requirements not met" header badge

### Phase 3 — complete

Migration: `20260330201226_guild_phase3_revoke_tracking`

**Schema additions** on `SellerProfile`: `consecutiveMetricFailures Int @default(0)`, `lastMetricCheckAt DateTime?`, `metricWarningSentAt DateTime?`, `listingsBelowThresholdSince DateTime?`

**`vercel.json`** — two crons registered:
- `GET /api/cron/guild-metrics` — `0 9 1 * *` (monthly, 1st at 9am UTC)
- `GET /api/cron/guild-member-check` — `0 8 * * *` (daily, 8am UTC)

Both routes protected by `Authorization: Bearer CRON_SECRET` header.

**`src/app/api/cron/guild-metrics/route.ts`** — monthly Guild Master revocation:
- Fetches all `GUILD_MEMBER` + `GUILD_MASTER` sellers
- Processes in batches of 10 via `Promise.all`
- Guild Master pass: resets `consecutiveMetricFailures = 0`, clears `metricWarningSentAt`
- Guild Master fail (1st time): increments `consecutiveMetricFailures = 1`, sets `metricWarningSentAt`, sends `VERIFICATION_REJECTED` notification + `sendGuildMasterWarningEmail` listing which criteria failed
- Guild Master fail (2nd consecutive): revokes to `GUILD_MEMBER`, resets counters, sends notification + `sendGuildMasterRevokedEmail`
- Guild Member sellers: just updates `lastMetricCheckAt` (revocation handled by daily cron)
- Returns `{ processed, warned, revokedMaster, errors[] }`

**`src/app/api/cron/guild-member-check/route.ts`** — daily Guild Member revocation:
- Two checks per seller: (1) case `OPEN | IN_DISCUSSION | PENDING_CLOSE` with `createdAt < 90 days ago`; (2) `listingsBelowThresholdSince < 30 days ago`
- On revocation: sets `guildLevel = NONE`, `isVerifiedMaker = false`, sends notification + `sendGuildMemberRevokedEmail` with reason
- Returns `{ revokedMember, errors[] }`

**`listingsBelowThresholdSince` tracking** — set/cleared in three places:
- `api/listings/[id]/stock/route.ts` — after quantity update (via `syncListingsThreshold` helper)
- `dashboard/page.tsx` `setStatus()` — after hide/unhide
- `dashboard/page.tsx` `deleteListing()` — after delete

**Email functions** added to `src/lib/email.ts`: `sendGuildMasterWarningEmail` (lists failed criteria), `sendGuildMasterRevokedEmail`, `sendGuildMemberRevokedEmail` (includes reason string)

**Dashboard verification** (`/dashboard/verification`) — Guild Master section now shows:
- Amber warning banner with 30-day deadline if `metricWarningSentAt` is set
- Last check date + "Next check: 1st of next month" info block (shown for both Guild Member and Guild Master)

**Remaining infrastructure step:** Add `CRON_SECRET` env var to Vercel (generate with `openssl rand -hex 32`). Both cron routes return 401 without it.

**Guild system additions (complete — 2026-04-01):**
- **Reapplication after revocation** — `dashboard/verification/page.tsx`: sellers with `guildLevel === "NONE"` and no pending application see the eligibility checklist and form (upsert action handles both first-time and re-applications). Guild Master: added rejection notice when `isMasterRejected && !guildMasterReviewNotes`.
- **Admin reinstatement** — `admin/verification/page.tsx`: new `reinstateGuildMember` server action sets `guildLevel = "GUILD_MEMBER"`, `isVerifiedMaker = true`, logs `REINSTATE_GUILD_MEMBER` audit entry. New "Revoked Guild Members" section shows sellers with `guildMemberApprovedAt` set but `guildLevel = "NONE"`.
- **Admin feature maker** — `admin/verification/page.tsx`: `FeatureMakerButton` client component (`src/components/admin/FeatureMakerButton.tsx`) on Active Guild Member and Guild Master rows. `featureMaker` server action sets `featuredUntil = now + 7 days`, logs `FEATURE_MAKER` to AdminAuditLog, revalidates `/admin/verification` and `/`. `unfeatureMaker` clears `featuredUntil`, logs `UNFEATURE_MAKER`. `SellerProfile.featuredUntil DateTime?` — migration `20260414002700_add_seller_featured_until`.

**Still unbuilt (separate from Phases 1–3):**
- Monogram stamp picker (Phase 1 cosmetic): `guildStampStyle String?` on `SellerProfile`; 4 styles (serif/block/script/ornate); unique wax-seal stamp per Guild Master using shop initials + chosen style

## Similar Items (redesigned 2026-04-15)

- **`GET /api/listings/[id]/similar`** — weighted similarity scoring. Fetches up to 20 candidates via raw SQL, scores each with: tag overlap (3 pts/match), same category (5 pts), price proximity (0-3 pts, closer = more), title word overlap (2 pts/shared word). Returns up to 12 sorted by total score. Wide price range (10%-1000%) to fill section even with few listings. Returns full `ListingCardData` shape (id, title, priceCents, currency, status, listingType, stockQuantity, photoUrl, secondPhotoUrl, seller object).
- **`SimilarItems`** (`src/components/SimilarItems.tsx`) — `"use client"` component; fetches on mount; horizontal scroll row using `ScrollFadeRow` + `ListingCard` (same card style as browse/homepage). Skeleton loading shows 4 placeholder cards. Hides section entirely if 0 results.
- **Listing detail page** — `<SimilarItems listingId={id} />` in "You might also like" section

## Blog System (complete)

### Schema
- **`BlogPost`** — `slug` (unique), `title`, `body`, `excerpt?`, `coverImageUrl?`, `videoUrl?`, `authorId` → `User @relation("BlogPostsAuthored")`, `authorType BlogAuthorType` (`STAFF | MAKER`), `sellerProfileId?` → `SellerProfile` (for Maker posts), `type BlogPostType` (`STANDARD | MAKER_SPOTLIGHT | BEHIND_THE_BUILD | GIFT_GUIDE | WOOD_EDUCATION`), `status BlogPostStatus` (`DRAFT | PUBLISHED | ARCHIVED`), `featuredListingIds String[]`, `tags String[]`, `metaDescription?`, `readingTimeMinutes?`, `publishedAt?`; back-relation `comments BlogComment[]`
- **`BlogComment`** — `postId` → `BlogPost` (cascade), `authorId` → `User @relation("BlogCommentsAuthored")`, `body`, `approved Boolean @default(false)` (moderation required before appearing)
- **`NewsletterSubscriber`** — `email` (unique), `name?`, `subscribedAt`, `active Boolean`
- Back-relations: `User.blogPosts`, `User.blogComments`, `SellerProfile.blogPosts`; migration `20260327215946_add_blog_system`

### Utilities (`src/lib/blog.ts`)
- `generateSlug(title)` — lowercase, spaces→hyphens, strip special chars
- `calculateReadingTime(body)` — word count ÷ 200, minimum 1
- `BLOG_TYPE_LABELS` — human-readable labels per `BlogPostType`; `WOOD_EDUCATION` label is "Workshop Tips" (updated 2026-04-01)
- `BLOG_TYPE_COLORS` — Tailwind badge color classes per type

### APIs
- `POST /api/newsletter` — upserts `NewsletterSubscriber`, no auth required
- `GET /api/blog` — paginated published posts, filterable by `type` and `tag`
- `GET /api/blog/[slug]/comments` — approved comments only
- `GET /api/blog/[slug]/comments` — returns top-level comments (`parentId: null`) with their approved replies nested under `replies[]`
- `POST /api/blog/[slug]/comments` — auth required; creates comment with `approved: false`; accepts optional `parentId`; depth enforced server-side (level 4+ flattens to level 3 by attaching to parent's parent); sends `BLOG_COMMENT_REPLY` notification to effective parent author (if different from replier), or `NEW_BLOG_COMMENT` to post author for top-level comments

### `BlogComment` self-relation (migration `20260413191812_add_blog_comment_replies`)
- `parentId String?`, `parent BlogComment? @relation("CommentReplies", ...)`, `replies BlogComment[] @relation("CommentReplies")`; `@@index([parentId])`
- **3-level threading** (updated 2026-04-13): depth enforced server-side only — no additional migration needed. Level 1 (root) → Level 2 (reply) → Level 3 (reply to reply). Attempts to reply at level 4+ flatten to level 3 (POST attaches to the level-2 parent instead). GET returns root comments with 2 levels of nested approved replies via `replies: { include: { replies: { ... } } }`.
- **Avatar priority in comments** (2026-04-13): `AUTHOR_SELECT` const in `api/blog/[slug]/comments/route.ts` includes `sellerProfile: { select: { avatarImageUrl: true } }` at all 3 nesting levels; GET response mapped to add `avatarUrl = sellerProfile?.avatarImageUrl ?? imageUrl` per comment/reply/level-3-reply; `blog/[slug]/page.tsx` and `BlogReplyToggle.tsx` interfaces updated to include `sellerProfile?` on author and use `avatarUrl` for rendering

### Components
- **`NewsletterSignup`** — client component; email + optional name; success state "You're on the list! 🎉"; client-side email format validation
- **`BlogCopyLinkButton`** — Web Share API with clipboard copy fallback
- **`BlogCommentForm`** — `"use client"`; props: `slug`, `parentId?`, `onCancel?`, `placeholder?`; sends parentId in POST body when provided; success state shows "Close" button when `onCancel` provided; button label: "Post reply" vs "Post comment"
- **`BlogReplyToggle`** (`src/components/BlogReplyToggle.tsx`) — `"use client"`; renders level-2 replies indented with `pl-8 border-l border-neutral-100`; each level-2 reply has its own Reply button (separate `showingReplyId` state) and its level-3 replies at `pl-10 border-l border-neutral-100`; no Reply button on level-3 comments; root Reply button adds level-2 replies; hidden entirely if no replies and not signed in
- **`BlogPostForm`** — full create/edit form: title + slug preview, type select (staff: all types; makers: STANDARD + BEHIND_THE_BUILD only), cover image upload, video URL, **TipTap WYSIWYG body editor** (bold appears bold, headings appear as headings — replaced plain markdown textarea), excerpt (200 char counter), meta description (160 char counter), comma-separated tags, featured listing checkboxes, status select. Blog body stored as markdown (`tiptap-markdown` handles rich text ↔ markdown conversion). Dependencies: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-image`, `@tiptap/pm`, `tiptap-markdown`.
- **`MarkdownToolbar`** (`src/components/MarkdownToolbar.tsx`) — TipTap-based WYSIWYG editor with toolbar buttons: Bold, Italic, Strikethrough, H2, H3, Bullet list, Ordered list, Blockquote, Code block, Link, Image, Horizontal rule. Active state highlighting on toolbar buttons. Hidden `<input name="body">` contains markdown for formData submission. `key={defaultValues.body}` on the component forces TipTap re-initialization when editing a different post. CSS placeholder via `data-placeholder` attribute in globals.css.

### Public pages
- **`/blog`** — gradient hero, type filter tab strip, featured post (large card, first result page 1 only), 12-per-page grid with cover image/badge/excerpt/author/date, pagination, `NewsletterSignup` at bottom; `generateMetadata`. Blog listing page card avatars also resolve `author.sellerProfile.avatarImageUrl ?? author.imageUrl` (author select includes `sellerProfile: { select: { avatarImageUrl, displayName } }`).
- **`/blog/[slug]`** — `generateMetadata` (OG image from `coverImageUrl`); breadcrumb; type badge + reading time + date; author card (Maker links to seller profile); full-width cover image; YouTube/Vimeo iframe embed (extracts ID from URL); markdown body rendered via `marked`; social share (Twitter, Facebook, `BlogCopyLinkButton`); "Featured in this post" listing cards; `NewsletterSignup`; comment list (approved only) + `BlogCommentForm` for signed-in users; related posts (same type or overlapping tags)

### Dashboard
- **`/dashboard/blog`** — author's posts list with type/status badges, edit/delete/view actions
- **`/dashboard/blog/new`** — create form via `BlogPostForm`; `createBlogPost` server action generates unique slug (appends `-2`, `-3` etc. on collision), calculates reading time, sets `authorType` and `sellerProfileId`, sets `publishedAt` if PUBLISHED
- **`/dashboard/blog/[id]/edit`** — pre-filled `BlogPostForm`; `updateBlogPost` server action sets `publishedAt` on first publish transition, nulls it on unpublish

### Admin (`/admin/blog`)
- Pending comments queue at top with approve/delete actions; all posts list with author, status, pending comment count badge; Blog link in admin sidebar with unapproved comment count badge

### Integrations
- **Seller profile** (`/seller/[id]`) — "From the Workshop" section: up to 3 most recent published posts by this seller, shown as cards with cover image, type badge, title, excerpt, date
- **Homepage** (`/`) — "Stories from the Workshop" section: 3 most recent published posts, fetched in parallel with other homepage data; "Read more stories →" link to `/blog`
- **Sitemap** — `/blog` index at priority 0.8 daily; all published posts at priority 0.7 weekly with `updatedAt`
- **Header nav** — "Blog" link added to main nav

## Icon Library (complete)

`src/components/icons/index.tsx` — 64 named Feather-style outline SVG icon components (63 original + `Rss` added for Following/Feed nav). All icons accept `className?: string` and `size?: number` (default 20) props. Base SVG attrs: `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={1.5}`, `strokeLinecap="round"`. **No emoji in structural/navigational UI. Category tiles use SVG icons at `size=28`. Section headings use `.font-display` serif text only — the `Logs` and `Heart` icons were removed from "Fresh from the Workshop" and "Buyer Favorites" headings for a cleaner appearance.**

**Exports** (grouped):
- Shopping/Commerce: `ShoppingBag`, `Tag`, `Gift`
- User/Account: `Heart`, `User`, `Store`
- Messaging: `MessageCircle`, `Bell`
- Status: `CheckCircle`, `XCircle`, `Check`, `X`, `AlertTriangle`, `Info`
- Orders/Shipping: `Package`, `Truck`
- Reviews: `Star`
- Config: `Settings`
- Craft/Tools: `Wrench`, `Hammer`, `Leaf`
- Analytics: `BarChart`
- Web/Globe: `Globe`
- Social brands (simplified outline): `Instagram`, `Facebook`, `Pinterest`, `TikTok`
- Navigation: `ArrowLeft`, `ArrowRight`, `ChevronDown`, `ChevronUp`, `ChevronLeft`, `ChevronRight`, `Menu`
- Actions: `Plus`, `Trash`, `Edit`, `Share`, `Copy`, `Download`, `Upload`
- Visibility: `Eye`, `EyeOff`
- Time/Location: `Clock`, `MapPin`
- Trust/Security: `Shield`
- Search/Filter/View: `Search`, `Filter`, `Grid`, `List`
- Media/Files: `Camera`, `Image`, `Video`, `File`
- Special: `Sparkles`, `Repeat`
- **Category icons**: `Armchair` (Furniture), `Utensils` (Kitchen), `Candle` (Decor), `Toy` (Toys), `TreePine` (Outdoor), `Palette` (Art), `Gem` (Jewelry), `Box` (Storage), `Logs` (available but not used in section headers)
- **Feed**: `Rss`

**Used in:**
- `Header.tsx` — `MessageCircle` (signed-out messages link), `ShoppingBag` (cart), `Rss` (feed link)
- `seller/[id]/page.tsx` — `Instagram`, `Facebook`, `Pinterest`, `TikTok`, `Globe` replacing inline filled SVG paths
- `admin/layout.tsx` — `AlertTriangle` (Flagged Orders, Cases), `Package` (All Orders), `Shield` (Verification), `Edit` (Blog)
- `dashboard/page.tsx` — `Store` (Create listing), `User` (Shop Profile), `Package` (Shipping & Settings, My Orders), `Tag` (My Sales), `Grid` (Inventory), `MessageCircle` (Messages), `Edit` (My Blog), `Bell` (Notifications), `Sparkles` (Verified Maker badge), `BarChart` (Analytics)

## In-Site Notifications (complete)

### Schema
- **`NotificationType`** enum — 18 values (see enum section above)
- **`Notification`** model — `id`, `userId` → `User`, `type`, `title`, `body`, `link String?`, `read Boolean @default(false)`, `createdAt`; `@@index([userId, read])`

### Helper
`src/lib/notifications.ts` — `createNotification(userId, type, title, body, link?)` inserts a Notification row. All calls must be `await`ed (un-awaited calls may be killed before completion in serverless). Called in 19 places:
- Stripe webhook: `NEW_ORDER` (buyer + seller on order created, both cart and single/buy-now paths), `ORDER_SHIPPED` (buyer on manual mark-shipped), `LOW_STOCK` (seller when purchase drops IN_STOCK qty to 1 or 2 — both cart and single paths)
- Fulfillment API: `ORDER_DELIVERED` (buyer when seller marks delivered)
- Cases API: `CASE_OPENED` (seller), `CASE_MESSAGE` (other party), `CASE_RESOLVED` (buyer)
- Messages thread (`messages/[id]/page.tsx` `sendMessage` action): `NEW_MESSAGE` (recipient)
- Reviews API: `NEW_REVIEW` (seller)
- Custom order request API: `CUSTOM_ORDER_REQUEST` (seller)
- Custom listing creation: `CUSTOM_ORDER_LINK` (buyer)
- Stock restore/update (`api/listings/[id]/stock/route.ts`): `BACK_IN_STOCK` (subscribers via StockNotification), `LOW_STOCK` (seller when manually setting stock to 1 or 2)
- Maker verification approve/reject: `VERIFICATION_APPROVED` / `VERIFICATION_REJECTED` (seller)
- Favorites (`api/favorites/route.ts` POST): `NEW_FAVORITE` (listing owner) — **note**: `FavoriteButton` uses REST routes (`POST /api/favorites`, `DELETE /api/favorites/[listingId]`), not the `toggleFavorite` server action
- Blog comments API: `NEW_BLOG_COMMENT` (post author)

**Full audit completed 2026-03-28**: All 19 call sites confirmed using DB `User.id` (not Clerk session ID), all awaited, all links verified correct from recipient's perspective. 11 missing `await`s fixed across 9 files in earlier audit pass.

**Auto-mark-as-read**: `messages/[id]/page.tsx` server-side load marks any unread `NEW_MESSAGE` notifications whose `link` contains `/messages/[id]` as read, clearing the bell badge when the conversation is opened.

**Notification copy uses real names** (updated 2026-03-28): All notification titles/bodies use `name ?? email.split('@')[0] ?? 'Someone'` fallback chain. Fixed in 8 files: `api/favorites/route.ts`, `actions/toggleFavorite.ts`, `api/cases/route.ts` (CASE_OPENED), `api/cases/[id]/messages/route.ts` (CASE_MESSAGE), `api/messages/custom-order-request/route.ts` (CUSTOM_ORDER_REQUEST), `api/reviews/route.ts` (NEW_REVIEW), `api/blog/[slug]/comments/route.ts` (NEW_BLOG_COMMENT), `messages/[id]/page.tsx` (NEW_MESSAGE). Two files also had their `me` select expanded to include `name` and `email`: `custom-order-request` and `blog/[slug]/comments`.

**`ensureUser` P2002 fix** (2026-03-28): `src/lib/ensureUser.ts` now catches Prisma `P2002` unique constraint on email update and retries without the email field — fixes favorites (and any other `ensureUser` call) for accounts sharing an email with another DB row (e.g. admin accounts).

### API routes
- `GET /api/notifications` — auth required; returns up to 20 unread + 10 recent read notifications for the signed-in user
- `POST /api/notifications/mark-read` — auth required; body `{ ids?: string[] }` (omit to mark all read); updates `read = true`

### Components & pages
- **`NotificationBell`** (`src/components/NotificationBell.tsx`) — `"use client"`; polls `GET /api/notifications` every **5 minutes** (300000ms — was 30s; reduced 10x to cut Vercel CPU); shows `Bell` icon with red badge for unread count; dropdown list of recent notifications with title, body, timestamp, and link; "Mark all read" button; accepts `initialUnreadCount` prop (SSR hint). **Mobile positioning**: `fixed inset-x-4 top-14` on mobile (spans full width with 16px margins); `md:absolute md:right-0 md:top-8` on desktop
- **`/dashboard/notifications`** (`src/app/dashboard/notifications/page.tsx`) — full paginated notification history; "Mark all read" server action; grouped by read/unread; links to relevant pages
- **`UnreadBadge`** (`src/components/UnreadBadge.tsx`) — small red dot/count badge, reused by `NotificationBell`
- `NotificationBell` rendered in `Header.tsx` inside `<Show when="signed-in">`, replacing the static bell placeholder

## Recently Viewed (complete)

- **`src/lib/recentlyViewed.ts`** — client-side cookie utility (`rv` key, 30-day expiry, max 10 IDs, deduped); `getRecentlyViewed(): string[]` and `addRecentlyViewed(listingId: string): void` using `document.cookie` directly
- **`RecentlyViewedTracker`** (`src/components/RecentlyViewedTracker.tsx`) — `"use client"`, calls `addRecentlyViewed` on mount, renders `null`; added to `listing/[id]/page.tsx` alongside `ListingViewTracker`
- **`GET /api/listings/recently-viewed`** — accepts `?ids=id1,id2,...` (max 10), returns only ACTIVE non-private listings in requested order; fields: `id`, `title`, `priceCents`, `currency`, `photoUrl`, `sellerDisplayName`, `sellerAvatarImageUrl`
- **`RecentlyViewed`** (`src/components/RecentlyViewed.tsx`) — `"use client"`, reads cookie on mount, fetches API, horizontal scrollable row of up to 6 cards (photo, title, price, seller chip), animated skeleton loading, hides if empty
- Added to browse page (`/browse`) in `<Suspense>` below listings grid (removed from homepage in restructure)

## Request Custom Order in Thread (complete)

- **`ThreadCustomOrderButton`** (`src/components/ThreadCustomOrderButton.tsx`) — `"use client"` wrapper around `CustomOrderRequestForm` with amber pill styling (`🎨 Request Custom Order`)
- **`messages/[id]/page.tsx`** — fetches `otherSellerProfile` (`acceptsCustomOrders`) alongside conversation query; renders `ThreadCustomOrderButton` in the thread header next to the other participant's name when `otherSellerProfile.acceptsCustomOrders === true`

## Scroll Animations (complete)

- **`src/hooks/useInView.ts`** — `"use client"` hook using `IntersectionObserver` (threshold 0.08); fires once when element enters viewport then disconnects; returns `{ ref, inView }`
- **`src/components/ScrollSection.tsx`** — `"use client"` wrapper; applies `opacity-0 translate-y-6 → opacity-100 translate-y-0` with `transition-all duration-700 ease-out` on scroll; used for every homepage section below the hero

## Email System (complete)

`src/lib/email.ts` — 18 email functions with a sharp-edged HTML template (off-white `#FAFAF8` background, no `border-radius` anywhere, dark `#1C1C1A` header bar with Grainline wordmark, warm gray `#3D3D3A` body text, footer with unsubscribe link). `RESEND_API_KEY` guard: logs a warning and skips send if env var is missing — never crashes the app.

### Email functions

**Transactional:** `sendOrderConfirmedBuyer`, `sendOrderConfirmedSeller`, `sendOrderShipped`, `sendReadyForPickup`, `sendCaseOpened`, `sendCaseMessage`, `sendCaseResolved`, `sendCustomOrderRequest`, `sendCustomOrderReady`, `sendBackInStock`, `sendVerificationApproved`, `sendVerificationRejected`, `sendRefundIssued`

**Notification:** `sendNewMessageEmail` — fires on new message with 5-minute active-conversation throttle (skipped if recipient replied in last 5 mins); respects `EMAIL_NEW_MESSAGE` preference. `sendNewReviewEmail` — fires on new review with rating display; respects `EMAIL_NEW_REVIEW` preference.

**Lifecycle:** `sendWelcomeBuyer`, `sendWelcomeSeller`, `sendFirstListingCongrats`, `sendFirstSaleCongrats`

### Wiring (16 locations, all wrapped in `try/catch`)

| File | Email(s) |
|---|---|
| `api/stripe/webhook/route.ts` | `sendOrderConfirmedBuyer` (always); `sendOrderConfirmedSeller` (respects `EMAIL_NEW_ORDER`); `sendFirstSaleCongrats` (always, if count = 1) |
| `api/orders/[id]/fulfillment/route.ts` | `sendOrderShipped` (action=shipped), `sendReadyForPickup` (action=ready_for_pickup) — always |
| `api/cases/route.ts` | `sendCaseOpened` (respects `EMAIL_CASE_OPENED`) |
| `api/cases/[id]/messages/route.ts` | `sendCaseMessage` (respects `EMAIL_CASE_MESSAGE`) |
| `api/cases/[id]/resolve/route.ts` | `sendCaseResolved` (respects `EMAIL_CASE_RESOLVED`) |
| `api/messages/custom-order-request/route.ts` | `sendCustomOrderRequest` (respects `EMAIL_CUSTOM_ORDER`) |
| `dashboard/listings/custom/page.tsx` | `sendCustomOrderReady` (respects `EMAIL_CUSTOM_ORDER`) |
| `api/listings/[id]/stock/route.ts` | `sendBackInStock` per subscriber — always |
| `admin/verification/page.tsx` | `sendVerificationApproved` / `sendVerificationRejected` — always |
| `api/orders/[id]/refund/route.ts` | `sendRefundIssued` — always |
| `api/clerk/webhook/route.ts` | `sendWelcomeBuyer` (user.created) — always |
| `dashboard/listings/new/page.tsx` | `sendFirstListingCongrats` (always, if count=1); `sendNewListingFromFollowedMakerEmail` per follower (respects `EMAIL_FOLLOWED_MAKER_NEW_LISTING`) |
| `messages/[id]/page.tsx` | `sendNewMessageEmail` (respects `EMAIL_NEW_MESSAGE`, 5-min throttle) |
| `api/reviews/route.ts` | `sendNewReviewEmail` (respects `EMAIL_NEW_REVIEW`) |

**Emails are live once `RESEND_API_KEY` + `EMAIL_FROM` env vars are set and the sending domain is verified in Resend.**

### Email Notification Preferences (complete — 2026-04-01)

`shouldSendEmail(userId, prefKey)` in `src/lib/notifications.ts` — centralized preference check before all non-transactional email sends.
- **Default ON**: sends unless user sets `prefs[key] = false`
- **Default OFF** (`EMAIL_SELLER_BROADCAST`, `EMAIL_NEW_FOLLOWER`): only sends if `prefs[key] = true`

All non-transactional email sends wrapped with `shouldSendEmail`. Transactional emails (order confirmations, shipping, refunds, welcome, lifecycle, verification) are never gated.

## Clerk User Sync Webhook (complete)

`src/app/api/clerk/webhook/route.ts` — verifies svix signature, handles `user.created` and `user.updated` events, upserts `User` record via `ensureUserByClerkId`, sends `sendWelcomeBuyer` on `user.created`. Route added to public matcher in `src/middleware.ts`.

**`User.imageUrl` sync**: `imageUrl: image_url ?? null` is passed to `ensureUserByClerkId` before the event-type branch, so `User.imageUrl` stays in sync with Clerk's `image_url` for **both** `user.created` and `user.updated` events. No separate sync logic needed — this is already handled.

**Deployment steps still required:**
1. Add `CLERK_WEBHOOK_SECRET` to Vercel environment variables
2. Clerk Dashboard → **Production** → Developers → Webhooks → Add Endpoint → `https://thegrainline.com/api/clerk/webhook` → events: `user.created`, `user.updated` → copy Signing Secret → paste as `CLERK_WEBHOOK_SECRET`

## MobileFilterBar (complete — 2026-04-13)

**Problem**: Making the filter button `sticky` inside the browse page's flex container failed in iOS Safari because listing cards use `rounded-2xl overflow-hidden`, which creates new stacking contexts that render over `position: sticky` elements in the same container.

**Fix**: Extracted all mobile filter UI into a new `src/components/MobileFilterBar.tsx` component, positioned as a **sibling** of the listings flex container (not inside it), so listing card stacking contexts cannot interfere.

- `sticky top-0 z-30 bg-[#F7F5F0] border-b` — always visible at top of viewport on mobile
- Bottom sheet uses `createPortal(sheet, document.body)` to escape all ancestor stacking contexts
- `mounted` state guards `createPortal` against SSR/hydration mismatch
- Accepts `popularTags: string[]` prop; duplicates all form state from `FilterSidebar`
- `md:hidden` on the sticky bar; sheet also has `md:hidden` — desktop unaffected
- **Sort button** added next to Filter button — opens separate small sort-only sheet via `createPortal`; label shows current sort (e.g. "Sort: Newest"); options navigate to `/browse?sort=...` preserving all other params; sort still present inside main Filters sheet too
- **Sheet sizing reverted to max-h-[85vh] (main filters) and max-h-[50vh] (sort)** — sheets auto-size to content; short sheets look short, long sheets scroll. iOS safe-area inset for home indicator is correct behavior; no pb override needed.
- **Sticky wrapper uses `top-[2px]` + `pt-3`** to prevent button outline clip — pulls bar 2px below viewport top; buttons have `mt-[2px]` for additional inset
- **Header stacking context raised to `z-[50]`** (was `z-30`) — the `<header>` element itself creates a CSS stacking context; because the drawer backdrop and panel are children of that context, raising the header's z-index is the only way to make them paint above sticky elements (which are z-30 in the root context). Backdrop raised to `z-[1000]`, panel to `z-[1001]` within the header's stacking context.

**FilterSidebar changes**: Removed mobile button block, mobile sheet, `mobileOpen` state, Escape key effect, body scroll lock effect, and `activeFilterCount`. Desktop `<aside>` unchanged.

**Applied to**: `src/app/browse/page.tsx` — `<MobileFilterBar popularTags={popularTags} />` inserted before the flex container in both the main render and the no-results early return. Metro browse pages not applicable (no FilterSidebar).

## Mobile Audit Round 2 (complete)

Second mobile fix pass (2026-03-29). Zero TypeScript errors.

### FilterSidebar (`src/components/FilterSidebar.tsx`)
- **Apply button fixed** — removed `onClick={() => setMobileOpen(false)}` from the submit button; the premature state update was unmounting the form before the browser could process the `method="get"` submission. Sheet now closes via the existing `searchParams` useEffect when the URL updates after navigation.
- Reset link's `onClick` also removed for the same reason.

### Header (`src/components/Header.tsx`)
- **Logo tap target** — added `flex items-center min-h-[44px]` to the logo `<Link>` for a proper 44px touch target on mobile.
- **Messages drawer row fixed** — the "Messages" text span was not navigable (only the `MessageIconLink` icon was a link). Restructured: `MessageIconLink` (icon + unread badge) stays as the icon, a sibling `<Link href="/messages">` covers the text label. Both elements are now independently navigable.

### Notifications API (`src/app/api/notifications/route.ts`)
- **Auto-cleanup** — on `GET /api/notifications`, fire-and-forget `deleteMany` removes `read: true` notifications older than 90 days. **Runs only when `getMinutes() === 0`** (~1/60th of requests) — was running on every poll, a 60x unnecessary write load. Only read notifications are pruned; unread are never deleted.

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

## Listing Card Design (complete)

All listing cards share a consistent sharp-edged design:
- **No rounded corners** — `rounded-xl` / `rounded-lg` removed from card containers and list-view thumbnails
- **Light gray border** — `border border-neutral-200` (not plain `border` which renders as black/dark in some Tailwind configs)
- **Warm gray info section** — title/price/seller row has `bg-stone-50` background to visually separate from the photo

Applied in:
- `src/app/browse/page.tsx` — `GridCard` (container + info/seller divs), `ListCard` (container + thumbnail), no-results featured items
- `src/app/page.tsx` — Fresh from the Workshop + Buyer Favorites horizontal scroll cards; blog post cards
- `src/components/SimilarItems.tsx` — card list items + skeleton placeholders

## FavoriteButton Coverage (complete)

`FavoriteButton` is present on every listing card surface. Sign-out is handled: clicking while unauthenticated receives a 401 and redirects to `/sign-in?redirect_url=<current-path>`.

| Surface | File | `initialSaved` source |
|---|---|---|
| Browse grid + list | `src/app/browse/page.tsx` | `savedSet` (server query) |
| Homepage Fresh / Buyer Favorites | `src/app/page.tsx` | `saved` Set (server query) |
| Seller profile — Featured Work | `src/app/seller/[id]/page.tsx` | `savedSet` (server query via `meId`) |
| Seller profile — All Listings | `src/app/seller/[id]/page.tsx` | `savedSet` (server query via `meId`) |
| Similar Items | `src/components/SimilarItems.tsx` | `false` (client component, no server query) |

Card containers use `<div className="relative">` wrapping the photo Link; `FavoriteButton` sits outside the Link to avoid nested-interactive-element violation. The button's own `absolute right-3 top-3 z-10` handles positioning.

## Seller Shop Page (complete)

`/seller/[id]/shop` — dedicated paginated listing grid for a seller's shop. Deployed 2026-03-29.

- **Files**: `src/app/seller/[id]/shop/page.tsx` (server component), `src/app/seller/[id]/shop/SortSelect.tsx` ("use client" dropdown)
- **URL params**: `?category=` (filter by Category enum), `?sort=newest|price_asc|price_desc|popular`, `?page=` (1-based, 20/page)
- **Category tabs** — "All" + one pill per category the seller actually has ACTIVE listings in (via `groupBy`); active tab is filled `bg-neutral-900 text-white`; horizontal scroll on mobile
- **Sort dropdown** (`SortSelect.tsx`) — client component; on change, pushes new URL preserving current category; options: Newest / Price: Low to High / Price: High to Low / Most Popular
- **Grid** — `grid-cols-2 md:grid-cols-3 lg:grid-cols-4`; cards: `border border-neutral-200`, `bg-stone-50` info section, `FavoriteButton` with `savedSet` server query
- **Pagination** — Prev / `Page X of Y` / Next links; only shown when `totalPages > 1`
- **Empty state** — category-aware message when no listings match
- **Header bar** — seller avatar + name + "← Back to profile" link + Verified Maker badge
- **`generateMetadata`** — canonical URL, title, description
- **Entry points**:
  - `src/app/seller/[id]/page.tsx` All Listings section: shows first 8, "See all N pieces →" link in header; "See all N pieces →" button below when >8
  - `src/app/dashboard/page.tsx` My Listings section: "View My Shop →" link next to heading
- **Sitemap** — seller profiles now use `flatMap` to emit both `/seller/[id]` and `/seller/[id]/shop` at priority 0.6 monthly
- **FavoriteButton** covered: `savedSet` server query for signed-in users; `initialSaved={false}` fallback for signed-out (401 → redirect)
- **Owner view** (2026-04-13): `isOwner = userId === seller.user.clerkId`; seller query includes `user: { select: { clerkId: true } }`. Owner sees ALL listings regardless of status + chargesEnabled; buyers see ACTIVE + chargesEnabled only (unchanged). Category tabs for owner show categories from all statuses. Each owner-view card shows a status badge below (Draft=gray, Hidden=gray, Under Review=amber, Sold=neutral, Sold Out=neutral) and an "Edit →" link to `/dashboard/listings/[id]/edit`.
- **Owner status filter tabs** (2026-04-13): second row of smaller tabs below category tabs, shown to owner only; tabs: All / Active / Draft / Hidden / Sold Out / Sold / Under Review; `?status=` URL param; status AND'd with category in where clause; category groupBy also filtered by status; empty states have "Create listing →" and "View all listings" links per status
- **`ShopListingActions`** (`src/app/seller/[id]/shop/ShopListingActions.tsx`) — `"use client"` with `useTransition` + inline toast; Publish (DRAFT/HIDDEN → `publishListingAction`, toasts "Published!" or "Sent for review."), Hide (ACTIVE → HIDDEN), Unhide (HIDDEN → ACTIVE, notifies followers; blocked for REJECTED), Resubmit for Review (REJECTED → `publishListingAction`), Mark sold (ACTIVE → SOLD), Delete (all except PENDING_REVIEW), Edit link always present
- **`src/app/seller/[id]/shop/actions.ts`** — server actions: `hideListingAction`, `unhideListingAction`, `markSoldAction`, `markAvailableAction`, `deleteListingAction`, `publishListingAction`; all verify ownership via `getOwnedListing`; `syncThreshold` mirrors dashboard Guild Member tracking; `publishListingAction` runs `reviewListingWithAI` + `logAdminAction` identically to new listing creation flow; returns `{ status: "ACTIVE" | "PENDING_REVIEW" } | { error: string }` — returns `{ error }` instead of throwing on chargesEnabled failure because Next.js server actions mask thrown error messages in production. Client checks `"error" in result` before checking `result.status`.

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
| Dev-only routes | ✅ `/api/dev/make-order` returns 403 in production (`NODE_ENV === "production"`) |
| File uploads | ✅ All UploadThing endpoints require auth via middleware (throws if no Clerk userId) |

### Remaining security improvements (not urgent)

- **Rate limiting** — ✅ Complete — `@upstash/ratelimit` with sliding window on 7 routes (see Rate Limiting section below)
- **Security headers** — Add `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` in `next.config.ts`
- **Input validation** — Add Zod schemas to validate and sanitize API request bodies (currently relies on manual type assertions and `.slice()` guards)

## Logo & Branding (complete)

- **`public/logo.svg`** — original designer SVG; cream fill `#F2E6D8`; kept unmodified as source
- **`public/logo-espresso.svg`** — production logo with `fill="#2C1F1A"` (espresso) baked directly into the SVG path; no CSS filter needed. Created via `sed` from `logo.svg`. CSS filter approach abandoned — unreliable across browsers/contexts.
- **`public/logo-mark.svg`** — grain lines swoosh mark only (4 curved fanning paths, `fill="currentColor"`); for use in Guild Master wax seal badge and other compact branding contexts
- **Espresso brand color**: `#2C1F1A` — used on logos (`logo-espresso.svg`), hero primary CTA (`bg-[#2C1F1A]`), and hero secondary CTA border/text. Hover variant: `#3A2A24`. Applied only to brand moments (logos, hero CTAs); body text and UI elements remain neutral-900.
- **Header** (`src/components/Header.tsx`): desktop logo `h-8`, mobile logo `h-7`, hamburger drawer logo `h-7` — all use `src="/logo-espresso.svg"` with no filter
- **Footer** (`src/app/layout.tsx`): `h-5` logo using `logo-espresso.svg` with `opacity-40` Tailwind class
- **Hero CTAs** (`src/app/page.tsx`): primary "Browse the Workshop" — `bg-[#2C1F1A] hover:bg-[#3A2A24] text-white rounded-full`; secondary "Find Makers Near You" — `border-2 border-[#2C1F1A] bg-transparent text-[#2C1F1A] hover:bg-[#2C1F1A] hover:text-white rounded-full`

## Rate Limiting (complete)

`src/lib/ratelimit.ts` — Upstash Redis sliding-window rate limiters via `@upstash/ratelimit`. All limiters have `analytics: true` (viewable in Upstash console).

**Upstash database**: `major-toad-67912.upstash.io`
**Required env vars**: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (set in Vercel production + preview + development + `.env.local`)

| Route | Limiter | Key | Limit |
|---|---|---|---|
| `GET /api/search/suggestions` | `searchRatelimit` | IP | 30 / 10s |
| `POST /api/listings/[id]/view` | `viewRatelimit` | IP | 20 / 60s |
| `POST /api/listings/[id]/click` | `clickRatelimit` | IP | 20 / 60s |
| `POST /api/reviews` | `reviewRatelimit` | User ID | 5 / 60s |
| `POST /api/cart/checkout` | `checkoutRatelimit` | User ID | 10 / 60s |
| `POST /api/cart/checkout/single` | `checkoutRatelimit` | User ID | 10 / 60s |
| `GET /api/messages/[id]/stream` | `messageRatelimit` | User ID | 30 / 60s |

IP-keyed routes use `getIP(request)` (reads `x-forwarded-for`, falls back to `127.0.0.1`). User-keyed routes use Clerk `userId` directly. All return HTTP 429 on limit exceeded.

### Redis failover strategy

All `.limit()` calls are wrapped in one of two helpers from `src/lib/ratelimit.ts` — never the raw `.limit()` method directly:

- **`safeRateLimit(limiter, key)`** — **fail closed**: if Redis is unavailable, the request is rejected (returns `{ success: false }`). Used for all state-mutating routes where abuse has real cost: checkout, reviews, favorites, blog save, follow/unfollow, commission create/interest, broadcast, listing creation, messages stream.
- **`safeRateLimitOpen(limiter, key)`** — **fail open**: if Redis is unavailable, the request is allowed through. Used only for non-critical read-path analytics where a brief outage should not break the UX: view tracking (both global IP limiter and per-IP+listing dedup), click tracking, search suggestions.

## Seller Onboarding Flow (complete)

A 5-step guided wizard at `/dashboard/onboarding` that walks new makers through shop setup.

### Schema additions (migration `20260330222832_seller_onboarding`)
- **`SellerProfile.onboardingStep Int @default(0)`** — tracks the wizard step the seller is on (0–5)
- **`SellerProfile.onboardingComplete Boolean @default(false)`** — when `true`, the wizard is skipped; all existing sellers were backfilled to `true` in the migration

### Auto-redirect
`src/app/dashboard/page.tsx` fetches `onboardingComplete` and `onboardingStep` alongside the `guildLevel` query. If `!onboardingComplete`, redirects to `/dashboard/onboarding` before rendering.

### Onboarding page (`/dashboard/onboarding`)
Server component (`src/app/dashboard/onboarding/page.tsx`) — calls `ensureSeller()`, queries full seller fields, redirects back to `/dashboard` if already complete, then renders `<OnboardingWizard>` with props.

### Wizard steps
- **Step 0 — Welcome**: greeting with maker name, "Get Started →" button
- **Step 1 — Your Profile (20%)**: display name, tagline, bio, avatar upload (uses `ProfileAvatarUploader`)
- **Step 2 — Your Shop (40%)**: city, state, years in business, return policy, shipping policy, accepts custom orders toggle
- **Step 3 — Get Paid (60%)**: Stripe Connect button (green checkmark if already connected); "Connect Stripe →" calls `/api/stripe/connect/create` with `{ returnUrl: "/dashboard/onboarding" }` so user returns to step 4 after Stripe onboarding
- **Step 4 — Your First Listing (80%)**: "Create a Listing →" link to `/dashboard/listings/new`; shows green checkmark if listings already exist
- **Step 5 — Done! (100%)**: checklist summary of completed vs skipped steps; "Go to My Dashboard →" calls `completeOnboarding()` which sets `onboardingComplete = true` and redirects to `/dashboard`

### Files
- `src/app/dashboard/onboarding/actions.ts` — `saveStep1`, `saveStep2`, `advanceStep(targetStep)`, `completeOnboarding`
- `src/app/dashboard/onboarding/OnboardingWizard.tsx` — `"use client"` wizard; local `step` state starts at `initialStep`; each step uses `onSubmit` handlers calling server actions
- `src/app/dashboard/onboarding/page.tsx` — server component wrapper

### Stripe connect route update
`POST /api/stripe/connect/create` now accepts optional `{ returnUrl: "/path" }` in the request body (relative paths only for security). Falls back to `/seller/payouts?onboarded=1` if not provided.

### Progress persistence
Each "Save & Continue" or "Skip" calls `advanceStep(n)` which writes `onboardingStep` to the DB. If the seller navigates away and returns to `/dashboard/onboarding`, they resume at their saved step.

## Sentry Error Tracking (complete)

Installed via Sentry wizard. Session replay disabled (bundle size trade-off).

### Files created by wizard
- `sentry.client.config.ts` — browser-side Sentry init
- `sentry.server.config.ts` — Node.js server-side Sentry init
- `sentry.edge.config.ts` — Edge runtime Sentry init
- `src/instrumentation.ts` — Next.js instrumentation hook (imports server/edge configs)
- `src/instrumentation-client.ts` — Next.js client instrumentation hook
- `src/app/global-error.tsx` — top-level error boundary that reports to Sentry

### Features enabled
- Error tracking (unhandled exceptions + manual `Sentry.captureException`)
- Tracing / performance monitoring
- Logs integration

### Environment variables
- `NEXT_PUBLIC_SENTRY_DSN` — public DSN, set in Vercel
- `SENTRY_AUTH_TOKEN` — build-time source map upload token, set in Vercel
- `.env.sentry-build-plugin` — local auth token file (gitignored)

### Tooling
- Sentry MCP configured for Claude Code and VS Code — enables AI-assisted error investigation directly from the Sentry dashboard

## Legal Pages (complete — updated 2026-04-01)

`/terms` and `/privacy` — both server components, publicly accessible (added to middleware public matcher), linked in site footer (`src/app/layout.tsx`). Both display a red **DRAFT — Under Attorney Review** banner. Both have a Table of Contents with anchor links and are mobile responsive / print-friendly.

### Terms of Service (`/terms`) — 33 sections, 60+ subsections

Comprehensive legal update deployed 2026-04-01 (commit 6537bf6). 426 insertions across both files. 40+ changes covering payment infrastructure, federal compliance, consumer protection, product safety, and general provisions.

**Section 4 — Maker Terms (25 subsections):**
- 4.4 — AI review acknowledgment (review ≠ verification of claims/safety/accuracy)
- 4.5 — Fee grandfathering (changes apply only to orders placed after effective date)
- 4.15 — Content license expanded to cover paid advertising, social media, email campaigns, third-party marketing
- 4.18 — Product liability: insurance required for Toys/Kitchen categories, recommended for all others; CPSIA compliance for children's products; food-safe finish disclosure for Kitchen; Prop 65 warnings for California shipments; recall notification obligation
- 4.19 — Public profile data disclosure
- 4.20 — Makers Map location handling
- 4.21 — IP warranty (no infringement of patents/copyrights/trademarks/trade secrets/rights of publicity; likeness consent for identifiable persons)
- 4.22 — Identity verification (Grainline's right to verify via third-party services, public records, or document requests)
- 4.23 — Business licenses and compliance (seller's responsibility for all permits/registrations)
- 4.24 — Listing content requirements (original photography only; FTC Made in USA Labeling Rule compliance)
- 4.25 — Seller warranties (Magnuson-Moss Warranty Act compliance for any written warranty)

**Section 5 — Buyer Terms:**
- 5.6 — FCBA-compliant chargeback language (softened from "must use Case System first" to "agree to attempt resolution"; explicit FCBA rights acknowledgment)
- 5.8 — Chargeback Rights (new — explicit FCBA and state consumer protection law acknowledgment)

**Section 6 — Payments:**
- 6.3 — Payout timing defers to Stripe's schedule (not Grainline's guarantee)
- 6.5 — Tax disclaimer (no accuracy guarantee; not liable for underpayment/overpayment)
- 6.8 — Payment Collection Agent (Grainline as limited agent via Stripe Connect; buyer payment to Stripe = payment to Maker; no fiduciary relationship)
- 6.9 — Payment Reserves and Holds (right to delay/hold payouts for risk, fraud, chargebacks)

**Section 7 — Shipping:**
- 7.10 — Domestic Shipping Only (replaced Cross-Border Orders; US-only)
- 7.11 — Package Theft and Delivery Confirmation (carrier-confirmed delivery = fulfilled; Case System for disputes)
- 7.12 — Hazardous Materials in Shipping (DOT 49 CFR compliance for regulated materials)

**Section 8 — Returns/Refunds:**
- 8.4 — Chargeback fee ($15) allocation + FCBA rights acknowledgment
- 8.6 — Liability cap harmonized with Section 13.4 (removed conflicting "transaction amount" cap)

**Section 9 — Disputes:**
- 9.4 — Case re-review process (7-day request window, 14-day response, re-review decision final and binding)
- 9.8 — Time Calculations (calendar time default; business days = Mon–Fri excl. federal holidays; UTC for server-side deadlines)

**Section 14 — Indemnification:** Data protection indemnification bullet added (misuse of buyer personal data)

**Section 15 — Governing Law:** 15.3 — Injunctive relief carve-out (public injunctive relief not waived by class action waiver)

**Section 16 — Termination:**
- Voluntary deletion with pending obligations (must fulfill orders, pending payouts processed)
- Surviving sections updated: 4.15, 4.21, 6, 9, 10, 11, 13, 14, 15, 20, 22.6, 25.5, 27.8, 33
- Account Dormancy (24-month inactivity → 60-day notice → archive/restrict/delete; unclaimed property law compliance)

**Section 24 — Blog:** 24.1 — FTC Endorsement Guides disclosure requirement for blog posts with material connections

**Section 27 — Reviews:** 27.6 — CRFA-compliant review removal (removed "or for any other reason" catch-all; now limited to Terms violations, prohibited content, or valid legal complaints)

**Section 28 — Messaging:** 28.6 — Gift Notes (content standards apply; no pre-moderation)

**Section 31 — Geographic Restrictions:** US-only (Canada removed)

**Section 33 — General Provisions:**
- 33.4 — Full E-SIGN Act compliance (hardware/software requirements, right to withdraw consent, right to paper copies, withdrawal doesn't invalidate prior communications)
- 33.7 — Notices (email delivery, 24-hour deemed receipt, legal process address)
- 33.8 — Limitation Period (1-year statute of limitations)
- 33.9 — Third-Party Beneficiaries (none)
- 33.10 — Construction (no contra proferentem; "including" = "without limitation")
- 33.11 — Feedback and Suggestions (IP assignment to Grainline)
- 33.12 — Arbitration Fees (AAA Consumer Rules; Grainline pays if costs prohibitive)
- 33.13 — INFORM Consumers Act (high-volume seller ID/bank/contact verification; 10-day verification; annual recertification; buyer-facing reporting mechanism)

### Privacy Policy (`/privacy`) — 13 sections

**Section 4 — Sharing:**
- 4.1 — Shippo sub-processor disclosure (carriers: USPS, UPS, FedEx)
- 4.1 — Resend email tracking pixel disclosure (open tracking, click tracking, disable via image loading)
- 4.3 — Law enforcement procedures (compliance with valid legal process; user notification when permitted; right to challenge overbroad requests)
- 4.4 — Business transfer 30-day advance notice + deletion opt-out during notice period
- 4.9 — Data Visible Between Sellers (commission interest visibility, follower counts, cross-purchase reviews)

**Section 5 — Cookies:**
- 5.1 — Individual cookie inventory by name: Clerk auth, Cloudflare __cf_bm, Stripe, rate-limiting, recently-viewed (with purpose, provider, expiry)
- 5.3 — Do Not Track vs. Global Privacy Control: DNT not honored (no standard); GPC honored per state law (Colorado, Maryland, Minnesota)

**Section 7 — Rights:**
- Seller data portability expanded (listings, order history, analytics, Guild data; buyer PII excluded)
- 7.5 — Additional US State Privacy Rights (17 states listed: VA, CO, CT, UT, IA, TN, MT, OR, DE, MD, MN, NE, NH, NJ, IN, KY, RI; 30–45 day response; appeal rights)

**Section 9 — Security:** Data breach notification timing harmonized: Texas "as quickly as possible"; California 72-hour AG notification for 500+ affected; most stringent applicable timeline

**Section 10 — International Transfers:** US-only framing ("Platform is intended for use within the United States")

### Known Issues (to fix before launch)

- **Terms 6.3 redundant sentence** — "Payout timing is governed by Stripe's standard payout schedule." appears before the replacement sentence. Delete the first sentence. *(Commit c7bde34 fixed this)*
- **Privacy Section 10 duplicate paragraph** — "By using the Platform, you consent..." and "If you access the Platform from outside the United States, you consent..." were back to back. First deleted. *(Commit c7bde34 fixed this)*
- **TOC clutter** — Both TOCs showed inline subsection names next to main section titles. Simplified to main section titles only. *(Commit c7bde34 fixed this)*
- **Duplicate Feedback clause** — Section 11.6 and Section 33.11 both assign user feedback IP to Grainline. Attorney should decide which to keep (recommend keeping 33.11, removing 11.6).
- **Section 8.3 vs 9.4 inconsistency** — 8.3 said case decisions are "final and binding on both parties"; 9.4 allows a 7-day re-review. *(Fixed — 8.3 now reads "final, subject to the re-review process described in Section 9.4")*

### Phase 2 — Deferred Items (after attorney review)

These items were identified in a comprehensive 196-item attorney discussion list but deferred from the implementation round. They should be addressed after the attorney meeting:

**Terms additions (medium priority):** seller death/incapacitation, seller bankruptcy, platform shutdown/wind-down, commission room expiration timeframe, maker-to-maker transaction roles, cooperative/multi-person shop definition, minimum/maximum listing price, seller non-compete/price parity, seller-to-seller dispute mechanism, recall obligation framework, local pickup liability confirmation, CITES/Lacey Act for protected wood, food contact surface self-certification field, seller return policy as binding contract clarification

**Attorney judgment calls (critical):** money transmitter licensing (federal felony risk — must confirm Stripe Connect exemption), arbitration venue (Travis vs. Brazos County), "venue only" defense strength given AI review/Guild badges/recommendations, clickwrap vs. browsewrap (enforceability of arbitration clause), IC classification risk level, Section 230 and AI review liability, product liability as marketplace (Amazon precedent), unlimited one-way indemnification (unconscionability risk), UCC Article 2 gap (seller warranties to buyer)

### Pre-Launch Blockers (legal/business)

- ✅ Texas LLC filed
- ✅ EIN obtained
- ✅ Business bank account opened
- ✅ Business address — Registered Agents Inc., 5900 Balcones Drive STE 100, Austin, TX 78731 (filled in Terms + Privacy)
- ✅ DMCA agent registration — DMCA-1071504, registered 2026-04-14, designated agent Joseph Young c/o Registered Agents Inc.
- ✅ Neon database password rotation
- ✅ Texas marketplace facilitator registration — completed 2026-04-18. Taxpayer number assigned. Quarterly filing; first return due 2026-07-20. Must file even with zero sales.
- ✅ Apple Pay domain registration — `thegrainline.com` added to Stripe Payment method domains. Console warning resolved.
- ✅ `www.thegrainline.com` — 308 permanent redirect to bare domain configured in Vercel. SSL certificate provisioned.
- ✅ Operating agreement — not legally required for single-member LLC in Texas but recommended. Template sufficient for solo launch.
- Attorney sign-off on Terms and Privacy Policy (remove DRAFT banner)
- Clickwrap implementation (attorney decides if browsewrap acceptable)
- Money transmitter licensing confirmation from attorney
- Stripe live mode webhook (after switching to live mode)
- Clerk webhook production setup (`CLERK_WEBHOOK_SECRET` + register endpoint)
- Trademark Class 035 filing (post-launch optional, ~$350)
- Business insurance — general liability + cyber liability + marketplace product liability (post-launch)

### Canada Expansion Guide

A standalone guide exists for re-adding Canada when demand justifies it (~1–2 days of work, requires attorney meeting first). Key items: PIPEDA cookie consent, Quebec French language requirements (Bill 96), Canadian provincial consumer protection conflicts with arbitration clause, GST/HST registration, cross-border shipping/customs, currency conversion. Middleware change is one line; legal and compliance changes are the bulk of the work.

## UptimeRobot Monitoring (complete)

UptimeRobot configured to ping `https://thegrainline.com/api/health` every 10 minutes. `/api/health` is a static endpoint (`force-static`, no DB, no auth, <5ms response). NotificationBell polls reduced to 10min (600000ms). UnreadBadge polls reduced to 10min (600000ms, was 15s).

## UX Restructuring (complete — 2026-03-30)

### Navigation changes
- **"Dashboard" → "Workshop"** in all nav links and the dashboard page heading
- **Workshop link** only shown in header for users with a seller profile (`hasSeller` flag from `GET /api/me`)
- **"My Account" link** added to both desktop and mobile nav for all signed-in users → `/account`
- **Cart icon** always visible (signed-out users go to `/cart` which shows a sign-in prompt)
- **`GET /api/me`** now returns `{ role, hasSeller }` — `hasSeller` is `true` if the user has a `SellerProfile` row

### Mobile drawer fixes
- **X close button** — added `relative z-[60]` so it sits above the backdrop overlay
- **Messages row** — replaced the complex div/MessageIconLink combo with a single `<Link href="/messages">` wrapping a `MessageCircle` icon + "Messages" text. The unread badge is still available on the desktop `MessageIconLink` icon
- **Drawer styling** (2026-04-02) — `rounded-l-2xl overflow-hidden` on drawer panel; `pb-[calc(1rem+env(safe-area-inset-bottom))]` on bottom avatar container for iPhone home indicator clearance
- **Signed-out fetch cleanup** (2026-04-02) — `loadMe` replaced with unified `loadAll`; cart and notification fetches only fire when signed in (gates on `/api/me` success) — eliminates 401/404 console noise for signed-out users

### Blog now public
- `/blog` and `/blog/(.*)` added to `isPublic` in `src/middleware.ts`
- `/api/blog(.*)` and `/api/search(.*)` also added as public — blog viewing + search suggestions require no auth
- Writing requires `ensureSeller()` (unchanged); commenting requires auth (handled in API route, unchanged)

### Onboarding redirect fix
- `dashboard/page.tsx` redirect to `/dashboard/onboarding` now only fires when `sellerProfile` exists AND `onboardingComplete === false`
- Pure buyers who land on `/dashboard` (which calls `ensureSeller()` and creates a profile) will still be redirected to onboarding — the fix prevents any edge case where `guildSeller` is null from triggering a redirect

### Stripe Connect — real account status check
- `dashboard/onboarding/page.tsx` now calls `stripe.accounts.retrieve(stripeAccountId)` when a Stripe account ID exists
- Passes `hasStripeAccount: boolean` and `chargesEnabled: boolean` to `OnboardingWizard`
- Wizard Step 3 now shows three states:
  1. **No account** → "Connect Stripe →" button
  2. **Account exists but `charges_enabled = false`** → amber warning card + "Continue Stripe Setup →" button
  3. **Account fully connected (`charges_enabled = true`)** → green "Stripe Connected ✓" banner

### `/account` page (new)
`src/app/account/page.tsx` — server component for all signed-in users:
- **Header** — avatar, name, email
- **My Orders** — 5 most recent orders with thumbnail, title, total, status badge, "View" link; "View all orders →" to `/account/orders`
- **Saved Items** — horizontal scroll row of 6 most recently favorited listings
- **Account Settings** — shows name/email with note to update via Clerk
- **Your Workshop** (sellers only) — active listing count, completed order count, links to `/dashboard`, `/dashboard/blog`, `/dashboard/blog/new`

### `/account/orders` page (new)
`src/app/account/orders/page.tsx` — paginated full order history (20/page) with order items, totals, tracking numbers, status badges, and per-order detail links.

## Vacation Mode (complete — 2026-03-31)

Sellers can pause their shop while away. Migration: `20260331000843_vacation_mode`

### Schema additions on `SellerProfile`
- `vacationMode Boolean @default(false)` — whether vacation mode is currently active
- `vacationReturnDate DateTime?` — optional expected return date shown to buyers
- `vacationMessage String?` — optional message to buyers (max 200 chars)

### Dashboard seller settings (`/dashboard/seller`)
- New **Vacation Mode** card at top of page, rendered by `VacationModeForm` (`"use client"` component)
- Toggle switch to enable/disable vacation mode
- Enabling shows a warning banner (existing orders unaffected, buyers can still message you) with confirm/cancel
- When ON: optional return date picker + optional vacation message textarea (200 char limit)
- Save calls `POST /api/seller/vacation` which updates the three fields

### Dashboard home (`/dashboard`)
- Amber banner when vacation mode is active: "Your listings are hidden and new orders are blocked." + return date (if set) + "Turn off vacation mode →" link to `/dashboard/seller`

### Listing suppression
- **Browse** (`/browse`): `seller: { vacationMode: false }` added to main `where` clause
- **Homepage** (`/`): added to both "Fresh from the Workshop" and "Collector Favorites" queries
- **Similar items** (`/api/listings/[id]/similar`): `AND sp."vacationMode" = false` added to both raw SQL paths; `seller: { vacationMode: false }` added to Prisma fallback

### Checkout + cart blocking
- **`POST /api/cart/add`** — returns 400 if `listing.seller.vacationMode` is true
- **`POST /api/cart/checkout`** — returns 400 if the seller is on vacation
- **`POST /api/cart/checkout/single`** — returns 400 if the seller is on vacation

### Public profile notices
- **`/seller/[id]`** — amber banner above the banner image when `seller.vacationMode === true`; shows return date and vacation message if set; "Browse other makers →" link
- **`/seller/[id]/shop`** — same amber banner above the header bar

## Seller Analytics Dashboard (complete — 2026-03-31, metrics cleanup 2026-03-31)

`/dashboard/analytics` — **client component** (`"use client"`). Fetches data from `GET /api/seller/analytics?range=` on mount and on range change. Shows loading skeletons while fetching.

### Schema addition
- **`SellerProfile.profileViews Int @default(0)`** — incremented fire-and-forget on every `GET /seller/[id]` page load; migration `20260331010407_seller_profile_views`

### Schema addition (migration `20260331022628_listing_view_daily`)
- **`ListingViewDaily`** — `id`, `listingId` → `Listing`, `sellerProfileId` → `SellerProfile`, `date DateTime` (midnight UTC), `views Int @default(0)`, `clicks Int @default(0)`; `@@unique([listingId, date])`, `@@index([sellerProfileId, date])`, `@@index([date])`; back-relations `viewDailies ListingViewDaily[]` on both `Listing` and `SellerProfile`

### View/click tracking (updated)
- **`POST /api/listings/[id]/view`** — after incrementing `listing.viewCount`, fire-and-forgets an upsert on `ListingViewDaily` for today's bucket (increment `views`). **Listing views = times listing detail page was opened** (not card impressions).
- **`POST /api/listings/[id]/click`** — same pattern for `clicks`; `clicks` field retained on `ListingViewDaily` for future use but no longer surfaced in analytics UI
- Both routes first `findUnique` to get `sellerId` (needed for `sellerProfileId` on create)
- **Impression tracking (Intersection Observer) intentionally deferred** — not worth the complexity until sellers request it

### API routes
- **`GET /api/seller/analytics`** — accepts `?range=today|yesterday|week|last7|month|last30|year|last365|alltime`; returns full analytics JSON including overview, engagement, chart data (with all time buckets), top listings, rating over time, guild metrics; `chartGrouping` is `'hour'` for today/yesterday, `'day'` for week/last7/month/last30, `'month'` for year/last365, `'year'` for alltime; all DB queries use raw SQL for bucketing; guild metrics auto-recalculated if stale (>24h). Rating-over-time SQL uses `AVG(r."ratingX2") / 2.0` (Review stores `ratingX2` not `rating`). `alltime` start date uses seller's `createdAt` so year buckets are accurate.
- Engagement stats are **range-aware** — uses `ListingViewDaily.aggregate` with `date: { gte, lte }`; Listing Clicks + Click-through Rate (views/clicks, null when no click data) restored to UI
- **Conversion rate**: `number | null` — `null` when `totalViews === 0` but orders exist (tracking wasn't active yet); capped at 100%; `0` when both are 0. Frontend displays "—" for null
- **Click-through Rate** (CTR): views ÷ clicks — `null` when `totalClicks === 0`; capped at 100%; frontend displays "—" for null
- Cart abandonment is range-aware: Prisma `cartItem.findMany` + `orderItem.findMany` in the same date range; listings purchased in range are excluded from abandonment count
- Chart `views` buckets populated from real `ListingViewDaily` data: day grouping by YYYY-MM-DD; month grouping by YYYY-MM; year grouping by YYYY; hour grouping distributes daily total evenly across elapsed hours (today: hours 0–currentHour; yesterday: all 24)
- **`GET /api/seller/analytics/recent-sales`** — returns last 10 paid orders for this seller's items (split from main route to keep range-change responses fast)

### Data retention
- Monthly guild-metrics cron (`/api/cron/guild-metrics`) deletes `ListingViewDaily` records older than 2 years at the end of each run

### Bucket generation (API)
- **`generateHourBuckets`** — always generates all 24 hours (0–23); views/clicks distributed evenly across elapsed hours (today: currentHour+1; yesterday: 24)
- **`generateWeekBuckets`** — "week" range only; always 7 buckets Mon–Sun with labels 'Mon', 'Tue', …, 'Sun'
- **`generateDayBuckets`** — used for last7/month/last30; uses actual date range with 'Mar 15' style labels
- **`generateMonthBuckets`** — short month labels only ('Jan', 'Feb', etc.) — used for year/last365
- **`generateYearBuckets`** — used for alltime; yields one bucket per calendar year labeled '2025', '2026', etc.
- All bucket generators produce the full set of buckets first, then merge DB results in — zero values fill gaps

### Analytics nav
- "Analytics" button in Workshop nav (BarChart icon, links to `/dashboard/analytics`)

### Page sections (A–G)

**A — Overview (4 stat cards)**: Total Revenue, Total Orders, Avg Order Value, Active Listings — all range-aware except Active Listings (always current)

**B — Engagement (10 stat cards)**: Listing Views, Listing Clicks (range-aware), Click-through Rate (views÷clicks, "—" when null), Conversion Rate (orders÷views, "—" when null — null when view tracking wasn't yet active), Profile Visits (all-time from `profileViews`), Cart Abandoned (range-aware), Saved/Favorites (range-filtered, label "new saves this period"), Watching (range-filtered, label "new watchers this period"), Repeat Buyer Rate (all-time), Avg Processing Time (range-filtered via `createdAt`, label "order to shipped · this period"). `repeatBuyerRate` and `profileViews` intentionally remain all-time. Chart views populate going forward only — no historical data before `ListingViewDaily` was added.

**C — Performance Chart**: SVG line chart (inline, no external lib); 9 time range pill selectors; metric selector tabs (Revenue / Orders / Views); colors: revenue `#D97706` (amber-600), orders `#4F46E5` (indigo-600), views `#0D9488` (teal-600); gradient area fill via `<linearGradient>` (15% → 0% opacity); dashed gridlines (`strokeDasharray="4 4"`, `opacity={0.5}`); hollow dots for ≤20 points (white fill, colored stroke, strokeWidth=2); invisible hit-target rects for >20 points; **interactive active data point**: on hover/tap, shows a vertical dashed guide line (stone-300, `strokeDasharray="3 3"`) + enlarged hollow dot (r=6, white fill, colored stroke) at the hovered point; mouse leave on SVG clears active state; both `onMouseEnter` and `onClick` on hit rects for mobile tap support; white card tooltip (`bg-white border border-stone-200/60 rounded-lg shadow-md`); Y-axis uses `getYTicks(maxVal)`; X-axis label thinning with rotation when >14 buckets; "No data for this period" overlay when all values are zero

**D — Top Listings (top 8 by all-time revenue, showing 5)**: photo (80×80) + title + revenue/units row (no avg price) + engagement row (👁 views · 🖱 clicks · ♥ favorites · 🔔 watching · $/day)

**E — Guild Metrics**: range-independent metrics table (avg rating, on-time shipping, response rate, account age, open cases, completed sales); color-coded rates; Guild Master eligibility panel with human-readable failure descriptions

**F — Rating Over Time** (only shown if data exists): monthly list — `"Nov 2025: 4.8 ★ (3 reviews)"`

**G — Recent Sales**: last 10 paid orders table (date, item, buyer first name, amount, status badge); fetched from separate `/recent-sales` endpoint

### Dashboard + inventory listing stats
- **`/dashboard/page.tsx`** listings query: added `_count: { select: { favorites: true, stockNotifications: true } }` to include; each card shows `👁 X · 🖱 X · ♥ X · 🔔 X` below the status badge; `take: 6` (most recently updated) added (2026-04-13)
- **`/dashboard/inventory/page.tsx`** query: same `_count` addition; `InventoryRow.tsx` type extended with `viewCount`, `clickCount`, `_count`; stats row shown below price

## Following System (complete — 2026-03-31)

Migration: `20260331053935_following_system`

### Schema additions
- **`Follow`** — `id`, `followerId` → `User @relation("UserFollows")`, `sellerProfileId` → `SellerProfile`; `@@unique([followerId, sellerProfileId])`, `@@index([sellerProfileId])`, `@@index([followerId])`; back-relations `follows Follow[] @relation("UserFollows")` on `User`, `followers Follow[]` on `SellerProfile`
- **`SavedBlogPost`** — `id`, `userId` → `User`, `blogPostId` → `BlogPost`; `@@unique([userId, blogPostId])`, `@@index([userId])`, `@@index([blogPostId])`; back-relations `savedBlogPosts SavedBlogPost[]` on `User`, `savedBy SavedBlogPost[]` on `BlogPost`
- **`SellerBroadcast`** — `id`, `sellerProfileId` → `SellerProfile`, `message`, `imageUrl?`, `sentAt`, `recipientCount`; `@@index([sellerProfileId])`, `@@index([sentAt])`; back-relation `broadcasts SellerBroadcast[]` on `SellerProfile`
- **`NotificationType` additions**: `FOLLOWED_MAKER_NEW_LISTING`, `FOLLOWED_MAKER_NEW_BLOG`, `SELLER_BROADCAST`

### API routes
- **`GET/POST/DELETE /api/follow/[sellerId]`** — GET: returns `{ following, followerCount }` (auth optional); POST: upserts Follow, sends `NEW_FOLLOWER` notification to seller, returns `{ following: true, followerCount }`; DELETE: removes Follow. Added to middleware public list for GET.
- **`GET/POST /api/seller/broadcast`** — POST: creates `SellerBroadcast`, fire-and-forgets `SELLER_BROADCAST` notifications to all followers; GET: paginates the seller's broadcast history (10/page)
- **`GET/POST/DELETE /api/blog/[slug]/save`** — GET: returns `{ saved }` (auth optional); POST/DELETE: upserts/deletes `SavedBlogPost`

### Components
- **`FollowButton`** (`src/components/FollowButton.tsx`) — `"use client"`; props: `sellerProfileId`, `sellerUserId`, `initialFollowing`, `initialCount`, `size?: 'sm'|'md'`; optimistic toggle; 401 → redirect to sign-in; shows "Follow · N" or "Following ✓ · N"
- **`SaveBlogButton`** (`src/components/SaveBlogButton.tsx`) — `"use client"`; bookmark icon (filled amber when saved, outline when not); props: `slug`, `initialSaved`; 401 → redirect to sign-in
- **`BroadcastComposer`** (`src/components/BroadcastComposer.tsx`) — `"use client"`; textarea + send button; fetches/displays past broadcasts on mount; shows follower count

### FollowButton placement
- `/seller/[id]` — in the maker's name row (hidden for own profile)
- `/seller/[id]/shop` — in the shop header bar (`size="sm"`)
- `/listing/[id]` — below the seller's acceptingNewOrders badge (hidden for own listing)
- `/account/following` — on each followed-maker card (`size="sm"`)

### SaveBlogButton placement
- `/blog` — overlaid on each grid card (`absolute top-2 right-2 z-10`)
- `/blog/[slug]` — next to the post title (`flex items-start gap-3`)
- `/account/saved?tab=posts` — overlaid on each saved post card

### Notifications sent
- New listing from followed maker → `FOLLOWED_MAKER_NEW_LISTING` to all followers (fire-and-forget in `dashboard/listings/new/page.tsx`; first 500 followers also receive `sendNewListingFromFollowedMakerEmail`)
- New published blog post from followed maker → `FOLLOWED_MAKER_NEW_BLOG` to all followers (fire-and-forget in `dashboard/blog/new/page.tsx`)
- Seller broadcast → `SELLER_BROADCAST` to all followers (fire-and-forget in `/api/seller/broadcast`)

### Pages
- **`/account/feed`** — unified feed of listings, blog posts, and broadcasts from followed sellers (last 90 days); sorted newest-first; paginated 20/page; empty state with "Find Makers to Follow" CTA
- **`/account/following`** — list of all followed makers with avatar, tagline, location, follower/listing counts, follow date, and inline `FollowButton` to unfollow
- **`/account/saved`** — tabbed page (Listings | Blog Posts); replaces `/dashboard/saved` (which now redirects here); listings tab mirrors old saved page; posts tab shows `SavedBlogPost` records with `SaveBlogButton` for unsaving
- **`/dashboard/seller`** — "Shop Updates" section at bottom with `BroadcastComposer`
- **`/admin/broadcasts`** — paginated list of all broadcasts with text search, delete action, seller name/email, recipient count, timestamp

### Homepage "From Your Makers"
Shown only when the signed-in user follows ≥ 3 makers. Fetches up to 6 recent listings + blog posts from followed sellers (last 30 days). Horizontal scroll row identical to Fresh/Favorites sections. "See full feed →" link to `/account/feed`. Section renders before "Stories from the Workshop".

### Nav additions
- `Rss` icon added to `src/components/icons/index.tsx`
- Desktop header: RSS icon link to `/account/feed` (signed-in only), between "My Account" and notification bell
- Mobile drawer: "Your Feed" link with `Rss` icon between "Messages" and "Workshop"

## Following System Bug Fixes (complete — 2026-03-31)

Post-deployment bug fixes and gap fills:

### Crash fix — `/account/feed`
- Root cause: nested `<Link>` (anchor) elements inside listing/blog feed cards caused React 19 hydration errors ("something splintered")
- Fix: restructured listing/blog cards — outer `<Link>` wraps photo only; title/price/date in a second sibling `<Link>`; seller chip is an independent `<Link>` (no nesting)
- Broadcast cards were unaffected (already used a `<div>` wrapper)

### `/account/page.tsx` additions
- Added `followCount` to parallel `Promise.all` query
- New "Following" section showing maker count + "View feed →" + "Manage →" links
- "View all saved →" link corrected from `/dashboard/saved` to `/account/saved`
- Sections renumbered 1–6

### Broadcast rate limiting (`/api/seller/broadcast/route.ts`)
- Added 7-day rate limit: returns 429 with "Next available: [date]" message if last broadcast < 7 days ago
- Notification link changed from `/seller/[id]` to `/account/feed` (followers land on feed)
- Added `sellersOnly` body param: filters `Follow` query to followers who have a `sellerProfile`

### `BroadcastComposer.tsx` updates
- Shows 429 rate limit error message with date
- Added "Send to: All followers / Sellers only" radio toggle

### `SaveBlogButton.tsx` — icon visibility
- Both saved/unsaved states now use white icon with `drop-shadow(0 1px 2px rgba(0,0,0,0.5))` so bookmark is visible on dark cover images

### Homepage "From Your Makers" position
- Moved from before "Stories from the Workshop" to the TOP of the main content section (first item after the map, before Shop by Category)

### Follower notifications on status change (`dashboard/page.tsx`)
- `setStatus` now notifies followers via `FOLLOWED_MAKER_NEW_LISTING` when a listing transitions from non-ACTIVE → ACTIVE (fire-and-forget)
- `createNotification` import added

### Follower notifications on blog publish (`dashboard/blog/[id]/edit/page.tsx`)
- `updateBlogPost` now notifies followers via `FOLLOWED_MAKER_NEW_BLOG` on first publish (non-PUBLISHED → PUBLISHED) for maker posts with a `sellerProfileId` (fire-and-forget)
- `createNotification` import added

### `/account/following/page.tsx` — latest listing
- Added `listings` to Prisma select: top 1 ACTIVE non-private listing with photo, title, price
- Renders a small thumbnail (40×40) + title + price below stats row; shows "No active listings" when empty

### `/seller/[id]/page.tsx` — latest broadcast card
- Queries `prisma.sellerBroadcast.findFirst` for most recent broadcast
- Shows a teal "📢 Shop Update" card above Featured Work if broadcast is < 30 days old

## Search Bar, Blog Search & Commission Room (complete — 2026-03-31)

### Header search bar — always visible on desktop
- Removed `showSearch` condition that limited the search bar to `/` and `/browse`
- Now rendered with `hidden md:flex flex-1 max-w-[400px]` on every page in the desktop header

### Header declutter + avatar sync (complete — 2026-04-01)
- **Desktop nav reduced** from 12+ items to: Logo, Search, Browse, Blog, Commission Room, bell, messages, cart, avatar dropdown
- **`UserButton` replaced** with `UserAvatarMenu` (`src/components/UserAvatarMenu.tsx`) — custom click-to-open dropdown; avatar uses `avatarImageUrl ?? imageUrl ?? clerkUser.imageUrl` priority (seller custom avatar, Clerk fallback); avatar img has `rounded-full` on both trigger button and dropdown header avatar
- **Items in avatar dropdown**: My Account, Workshop (sellers only), Your Feed, Admin (admin/employee only), Manage Account (opens Clerk profile modal via `openUserProfile()`), Sign Out. Dropdown shows avatar + name at top.
- **Settings removed from dropdown** — accessible via "Notification preferences →" link on `/account` page instead
- **Clerk account access**: "Manage Account" button calls `openUserProfile()` from `useClerk()` — gives full Clerk profile modal (password, email, connected accounts)
- **Clerk modal z-index** (2026-04-02): `globals.css` adds `z-index: 9999 !important` on `.cl-modalContent`, `.cl-userProfileModal`, `[data-clerk-portal]` and `min-width: min(90vw, 800px)` on `.cl-userProfile-root` — fixes modal rendering behind site UI and left-sidebar clipping. `UserAvatarMenu` dropdown changed from `z-50` to `z-[200]`.
- **`/api/me`** now returns `name`, `imageUrl`, `avatarImageUrl` so the header dropdown renders the correct avatar without an extra Clerk API call
- Mobile drawer unchanged — My Account, Messages, Your Feed, Workshop, Admin remain as drawer links; drawer footer now shows `UserAvatarMenu` + name
- **`UserAvatarMenu` `dropDirection` prop** — `"down"` (default, desktop) or `"up"`; prop still exists but drawer no longer uses it
- **Mobile drawer bottom** — replaced `UserAvatarMenu` with inline avatar display + "Manage Account" and "Sign Out" buttons; `openUserProfile()` and `signOut()` called directly via `useClerk()` — avoids dropdown clipping by `overflow-hidden` on the drawer panel; Clerk modal opens as a portal above everything

### Search submit buttons (complete — 2026-04-02)
- **`SearchBar.tsx`** and **`BlogSearchBar.tsx`**: pill shape uses an **outer div** approach — `rounded-full overflow-hidden border bg-white focus-within:ring-2 focus-within:ring-neutral-300` clips both the input and button into the pill naturally. The `<input>` has **no border, no border-radius, no focus ring** of its own (`bg-transparent flex-1 focus:outline-none`). The submit button uses `rounded-r-full` and fills the right cap. This prevents double-border or broken pill shape.
- **Button height**: outer div uses `items-stretch` (not `items-center`) so the submit button fills the full height of the pill without needing fixed `py-` padding — button has `px-4` only.
- **User avatar button** (`UserAvatarMenu.tsx`): `rounded-full overflow-hidden bg-transparent border-0 p-0 cursor-pointer` — eliminates grey square/border artifact behind profile picture. `<img>` has `block` to remove inline baseline gap.
- Mobile search icon dropdown unchanged

### Blog Search System

#### GIN full-text indexes (migration `20260331171540_blog_search_indexes`)
- `@@index([title])` and `@@index([tags])` added to `BlogPost` schema (standard B-tree)
- Raw SQL GIN indexes added manually to migration: `BlogPost_search_idx` on `to_tsvector('english', title || excerpt || body)` for `ts_rank` relevance sorting; `BlogPost_tags_gin_idx` on `tags` array (note: Prisma drops `BlogPost_tags_gin_idx` on subsequent migrations — only B-tree `BlogPost_tags_idx` survives; full-text GIN index stays since Prisma doesn't manage it)

#### `GET /api/blog/search` (`src/app/api/blog/search/route.ts`)
- Query params: `?q=`, `?type=`, `?tags=` (comma-separated), `?sort=newest|relevant|alpha`, `?page=`, `?limit=12`
- When `q` + `sort=relevant`: raw SQL GIN `ts_rank` search returns ranked IDs, then Prisma fetches full records with type/tag filter; re-ordered by rank
- Otherwise: standard Prisma `contains` + `hasSome` query; `publishedAt desc` or `title asc`
- Returns `{ posts, total, page, totalPages, relatedTags }`

#### `GET /api/blog/search/suggestions` (`src/app/api/blog/search/suggestions/route.ts`)
- Three parallel queries: post titles via `similarity() > 0.2`, tags via `unnest ILIKE`, seller display names via `contains`
- **Blog search suggestions tag query**: uses `unnest(tags) AS tag` in the `FROM` clause, then filters on the `tag` column in `WHERE` — PostgreSQL does not allow `unnest()` directly in a `WHERE` clause
- Returns `{ suggestions: Array<{ type: "post"|"tag"|"author", label, slug?, tag? }> }` up to 8 items

#### `BlogSearchBar` component (`src/components/BlogSearchBar.tsx`)
- `"use client"` — full-width search input with magnifying glass icon, 300ms debounce, dropdown with Post/Topic/Maker labels
- Clicking a post suggestion navigates to `/blog/[slug]`; tag → `/blog?tags=...`; author → `/blog?bq=...`
- On submit: pushes `/blog?bq=...&sort=relevant`; clear button when value non-empty
- **Uses `?bq=` URL param** (not `?q=`) to avoid collision with header `SearchBar` which uses `?q=`. Suggestions fetch uses `?bq=`. Affected files: `BlogSearchBar.tsx`, `blog/page.tsx` (`sp.bq`), `api/blog/search/route.ts`, `api/blog/search/suggestions/route.ts`.

#### `/blog` page rewrite (`src/app/blog/page.tsx`)
- **searchParams**: now handles `bq` (blog search query), `type`, `tags` (comma-separated), `sort`, `page`
- `BlogSearchBar` rendered inside hero section
- **Sort tabs**: "Most Relevant" / "Newest" / "A–Z" shown only when `bq` is active
- **Active tag chips**: shown below tabs with × to remove individual tags
- **Search results header**: "X results for 'oak' in Maker Spotlights" composite label
- **"Browse by Topic" tag cloud**: shown below newsletter when no active search; 20 most-used tags via raw SQL `unnest`; 3 size tiers based on count ratio
- **No results state**: shows fallback tag cloud for discovery
- Featured post suppressed when searching

#### Blog post detail — related posts (`src/app/blog/[slug]/page.tsx`)
- **"More from the Workshop"** — 3-column grid of related posts (same type or overlapping tags, excluding current post); already implemented

#### Main site search updated (`SearchBar.tsx` + `src/app/api/search/suggestions/route.ts`)
- `/api/search/suggestions` now runs a 4th parallel query: blog title trigram similarity (`> 0.15`, limit 3); returns `{ suggestions: string[], blogs: [{slug, title}] }`
- `SearchBar.tsx` updated: handles new response shape; renders blog results below a divider with amber **"Post"** badge; clicking navigates to `/blog/[slug]`

### Commission Room (complete — nav-active as of 2026-03-31)

#### Schema (migration `20260331172348_commission_room`)
- **`CommissionStatus` enum**: `OPEN | IN_PROGRESS | FULFILLED | CLOSED | EXPIRED`
- **`CommissionRequest`** — `id`, `buyerId` → `User @relation("CommissionRequests")`, `title`, `description`, `category Category?`, `budgetMinCents?`, `budgetMaxCents?`, `timeline?`, `referenceImageUrls String[]`, `status CommissionStatus @default(OPEN)`, `interestedCount`, `expiresAt?`, `createdAt`, `updatedAt`; `@@index([buyerId])`, `@@index([status, createdAt])`, `@@index([category])`
- **`CommissionInterest`** — `id`, `commissionRequestId`, `sellerProfileId`, `conversationId?`, `createdAt`; `@@unique([commissionRequestId, sellerProfileId])`; `@@index([sellerProfileId])`
- **`COMMISSION_INTEREST`** added to `NotificationType` enum
- Back-relations: `commissionRequests CommissionRequest[] @relation("CommissionRequests")` on `User`; `commissionInterests CommissionInterest[]` on `SellerProfile`

#### API routes
- **`GET/POST /api/commission`** — GET: paginated OPEN requests with category filter; POST: auth required, creates request (validates title ≤100, description ≤1000)
- **`GET/PATCH /api/commission/[id]`** — GET: full detail with interests; PATCH: owner-only status update to FULFILLED or CLOSED
- **`POST /api/commission/[id]/interest`** — seller auth required; creates `CommissionInterest`, upserts conversation (canonical sort, race-safe), increments `interestedCount`, sends `COMMISSION_INTEREST` notification to buyer; returns `{ conversationId, alreadyInterested }`

#### Pages
- **`/commission`** — public board; category filter tabs; request cards with title, truncated description, budget, timeline, first reference image thumbnail, buyer first name + avatar, time ago, interest count; `CommissionInterestButton` for sellers; "Post a Request" button
- **`/commission/new`** — client component; form: title (100 chars), description (1000 chars + counter), category dropdown, budget min/max dollar inputs, timeline text, reference image upload (UploadButton, up to 3); redirects to `/commission` on success
- **`/commission/[id]`** — full description, reference images gallery, budget/timeline/category meta, buyer first name + avatar, interested makers list (avatar + name + GuildBadge + seller profile link), owner "Mark as Fulfilled" / "Close Request" buttons (via `MarkStatusButtons` client component); sign-in prompt for unsigned-out sellers
- **`/account/commissions`** — buyer's requests list with status badges, interest counts, edit/view links; "Post a Request" CTA

#### Client components
- **`CommissionInterestButton`** — optimistic toggle; 401 → redirect sign-in; redirects to `/messages/[conversationId]` on success
- **`MarkStatusButtons`** — owner-only FULFILLED / CLOSED buttons using PATCH API

#### Navigation & discoverability
- `COMMISSION_ROOM_ENABLED = true` in `Header.tsx`; nav links shown in both desktop nav and mobile drawer
- **Middleware**: `/commission` and `/commission/((?!new)[^/]+)` added as public routes; `/commission/new` and `/account/commissions` require auth (default protected matcher)
- **Sitemap**: `/commission` at priority 0.7 daily; individual open commission request pages at priority 0.5 weekly with `updatedAt`

#### SEO (complete — 2026-04-01)
- **Commission index** (`/commission`): `metadata` updated to `title: "Custom Woodworking Commissions — Find a Maker | Grainline"` with a description mentioning posting requests and matching with local/national makers
- **Commission detail** (`/commission/[id]`): `generateMetadata` updated with:
  - Title pattern: `[Title] — [City, State] | Custom Woodworking Commission` (or "Ships Anywhere" for national requests)
  - Description: first 120 chars of description + budget range + interested count (capped at 160 chars)
  - `alternates.canonical` and OpenGraph tags
  - JSON-LD `Service` schema injected via `<script type="application/ld+json">`: includes `name`, `description` (first 160 chars), `url`, `provider` (Grainline org), `areaServed` (city/state from buyer's seller profile, or "United States" for national), `category: "Custom Woodworking"`, `offers.@type: "AggregateOffer"` with `lowPrice`/`highPrice` (when set), `priceCurrency: "USD"`, `offerCount: interestedCount`
- Main query now selects `isNational` and `buyer.sellerProfile.{ city, state }` for location resolution

#### Improvements (2026-03-31)
- **Explainer banner** always shown at top of commission board: "How the Commission Room works" (amber card)
- **Better empty state**: heading + description + filled "Post a Request →" button
- **`ImageLightbox` component** (`src/components/ImageLightbox.tsx`) — `"use client"`; thumbnail grid (96×96) + fullscreen modal with keyboard navigation (Arrow keys, Escape), body scroll lock, prev/next buttons, counter; used on commission detail page
- **Interested seller notifications** — PATCH handler in `api/commission/[id]/route.ts` now notifies all sellers who expressed interest when buyer marks FULFILLED or CLOSED; uses `COMMISSION_INTEREST` notification type
- **Interested seller avatars** — `/account/commissions` shows up to 3 stacked avatars + count on each request card
- **Commission Room link** on listing detail page — inside the "Want something custom?" panel, adds "post a request in the Commission Room" link
- **`/account/page.tsx`** — new "Commission Requests" section linking to `/account/commissions` and `/commission`
- **`/account/commissions`** — query expanded to include up to 3 interested seller avatars per request

## Feed Improvements (complete — 2026-03-31)

Post-deployment round 2 fixes and enhancements:

### `/admin/broadcasts` crash fix
- Root cause: inline `onClick={(e) => { if (!confirm(...)) e.preventDefault() }}` on a `<button>` inside a server component — React 19 RSC cannot serialize inline event handler functions
- Fix: extracted delete button into `src/app/admin/broadcasts/DeleteBroadcastButton.tsx` (`"use client"` component); receives `id` and `action` (server action) as props; `page.tsx` passes `deleteBroadcast` server action as a prop

### `SaveBlogButton.tsx` — amber fill when saved
- Saved state now uses amber fill (`fill="#F59E0B"`, `stroke="#D97706"`) with drop shadow — visually distinct from the white unsaved outline on any background
- Unsaved state keeps white outline with drop shadow (unchanged)

### `/account/feed` — infinite scroll with cursor-based API
- **`src/app/api/account/feed/route.ts`** — new protected API route; cursor-based pagination (`?cursor=[ISO timestamp]&limit=20`, 20 items per batch); fetches listings + blog posts + broadcasts from followed sellers in parallel; merges and sorts by date desc; returns `{ items: FeedItem[], nextCursor: string | null, hasMore: boolean }`; 90-day cutoff on first load, cursor filter on subsequent pages; `guildLevel` included on listing/blog items; broadcasts mapped to `broadcastImageUrl` to avoid collision with listing `imageUrl`
- **`src/app/account/feed/FeedClient.tsx`** — new `"use client"` component; `IntersectionObserver` with `rootMargin: "300px"` sentinel triggers next page load before user reaches bottom; skeleton loading state (5 animated placeholder cards); empty state with "Browse Makers →" CTA; error banner with retry; "You're all caught up!" end-of-feed message; `FeedCard` renders listing (amber "New Listing" badge), blog (indigo "New Post" badge), and broadcast (teal "📢 Shop Update") cards with `timeAgo()` relative timestamp helper
- **`src/app/account/feed/page.tsx`** — rewritten as thin server auth wrapper; checks Clerk session, redirects to sign-in if unauthenticated, renders `<FeedClient />`; all data fetching moved client-side

## Listing Page Overhaul (complete — 2026-03-31)

Full redesign of `src/app/listing/[id]/page.tsx`. Zero TypeScript errors. Deployed.

### Layout changes
- **Breadcrumb** at top: Browse › Category › Title (each segment is a link)
- **`max-w-6xl`** container (wider than before)
- **`lg:grid-cols-2`** two-column layout (left = gallery, right = purchase panel)
- **Description** moved below the two-column area into its own `"About this piece"` section
- **Details table** below description: category (linked), listing type, processing, ships from
- **Map** moved below details (still shows pickup area)
- **"You might also like"** heading added above `SimilarItems`

### `ListingGallery` component (`src/components/ListingGallery.tsx`)
- `"use client"` — manages active photo index + lightbox state
- Main photo: `height: 500px`, `cursor-zoom-in`, photo counter overlay (`1 / N`)
- Click main photo → opens full lightbox with keyboard nav (Arrow keys + Escape)
- Horizontal scrollable thumbnail row below main photo; active thumbnail has `border-neutral-900` highlight
- Lightbox: prev/next buttons, close, counter

### `DescriptionExpander` component (`src/components/DescriptionExpander.tsx`)
- `"use client"` — desktop always shows full text; mobile truncates at 300 chars with "Read more" toggle

### `SellerGallery` component (`src/components/SellerGallery.tsx`)
- `"use client"` — keeps the existing grid layout on seller profile; adds click-to-open lightbox

### `CoverLightbox` component (`src/components/CoverLightbox.tsx`)
- `"use client"` — wraps any single image in a clickable button that opens a fullscreen lightbox; used on blog post cover and seller workshop image

### Purchase panel improvements
- **Price**: `text-3xl font-semibold`
- **Stock status**: rectangular badge (not pill), `In Stock · N available` / `Out of Stock` / `Made to order`
- **Buy buttons**: Buy Now first (full-width black), Add to Cart second (full-width bordered)
- **Gift wrapping notice** shown if seller offers it
- **Seller card**: 56px avatar, display name + Guild badge, tagline, seller star rating + count, city/state with pin icon, "Visit Shop" + Follow + Message buttons in a row

### UI Polish Pass (2026-04-01)
- Main photo: `rounded-lg overflow-hidden` on container
- Thumbnails: `rounded-md` on each thumbnail button
- Status badges ("Made to order", "In Stock", "Out of Stock"): changed from rectangular to `rounded-full` pills
- Purchase panel consolidated: "Want something custom?" panel and seller info card moved inside the main purchase panel as one continuous `card-section bg-white` card, separated by `border-t` dividers
- Tags: changed from square to `rounded-full` pills matching browse/hero tag styling
- Panel background: `bg-stone-50/50` → `card-section bg-white` (design system: never bg-stone-50 or any grey tint on card surfaces)

### SEO
- `generateMetadata` title: `{ absolute: "[Listing Title] by [Seller Name] — Grainline" }`

### Image Lightbox — wired everywhere
- **Review photos** (`ReviewsSection.tsx`) — `ImageLightbox` replaces `<a>` links for both "my review" and all other reviews
- **Seller gallery** (`seller/[id]/page.tsx`) — `SellerGallery` component (grid layout preserved, click opens lightbox)
- **Seller workshop image** (`seller/[id]/page.tsx`) — `CoverLightbox` component
- **Blog post cover** (`blog/[slug]/page.tsx`) — `CoverLightbox` component

## Commission System Improvements (complete — 2026-03-31)

### Part 3: Commission Chat Card
- **`Message.isSystemMessage Boolean @default(false)`** added to schema; migration `20260331182743_message_system_flag_commission_location`
- **`/api/commission/[id]/interest/route.ts`** — after creating conversation, fire-and-forgets a system message with `kind: "commission_interest_card"` containing: `commissionId`, `commissionTitle`, `sellerName`, `budgetMinCents`, `budgetMaxCents`, `timeline`
- **`ThreadMessages.tsx`** — renders `commission_interest_card` kind as a distinct card: gray left border in teal (`border-l-4 border-teal-400`), "📋 Commission Interest" header, seller name in bold, request title, budget, timeline, "View full request →" link

### Part 4: Commission Location Features
- **Schema** additions on `CommissionRequest`: `isNational Boolean @default(true)`, `lat Float?`, `lng Float?`, `radiusMeters Int? @default(80000)`; same migration as above
- **`/commission/new`** — "Who can see this request?" radio toggle (All makers nationwide / Local makers only); sends `isNational` to API; local scope error shown if buyer has no location set
- **`POST /api/commission`** — reads `isNational`; for local scope: fetches buyer's `sellerProfile.lat/lng`, returns 400 if not set, stores `lat`, `lng`, `isNational: false` on the record
- **Commission board** (`/commission/page.tsx`):
  - `?tab=near` URL param — "Near Me" tab only shown when viewer has location set (from their seller profile)
  - Near Me tab: Haversine raw SQL query; local non-national requests sorted first, then nationals; 80km radius
  - Distance badge on cards: `📍 X mi away` (green pill, shown when `!isNational && distanceMeters < 80000`)
  - `buildHref` preserves the `tab` param across pagination/category changes
  - Near Me SQL rewritten as `$queryRawUnsafe` with positional parameters ($1–$7) to fix crash from conditional SQL fragments in tagged template literal; `LEAST/GREATEST` clamps acos input to prevent NaN

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

## User Ban System (complete — 2026-04-01)

### Schema additions on `User`
- `banned Boolean @default(false)`, `bannedAt DateTime?`, `banReason String?`, `bannedBy String?` — set/cleared by admin ban actions
- `adminActions AdminAuditLog[] @relation("AdminActions")` — back-relation

### `AdminAuditLog` model
Full audit trail for admin actions with 24-hour undo window. Fields: `action` (string enum like `BAN_USER`, `APPROVE_LISTING`, etc.), `targetType`, `targetId`, `reason?`, `metadata Json`, `undone Boolean`, `undoneAt?`, `undoneBy?`, `undoneReason?`. Migration: `20260401011017_ban_audit_ai_review_snapshot`.

### Utilities (`src/lib/`)
- **`audit.ts`** — `logAdminAction(...)` upserts an `AdminAuditLog` row; `undoAdminAction({ logId, adminId, reason })` validates 24h window, performs action-specific rollback (BAN_USER → unban + restore Stripe/vacation; REMOVE_LISTING/HOLD_LISTING → restore ACTIVE), marks log undone, creates `UNDO_*` audit entry
- **`ban.ts`** — `banUser({ userId, adminId, reason })`: sets banned fields, calls `sellerProfile.updateMany({ chargesEnabled: false, vacationMode: true })`, closes open commission requests, logs `BAN_USER` action; `unbanUser(...)`: clears banned fields, restores Stripe if account exists, logs `UNBAN_USER`

### API routes
- `POST /api/admin/users/[id]/ban` — ADMIN only; bans user with reason; blocks self-ban and admin-to-admin ban
- `DELETE /api/admin/users/[id]/ban` — ADMIN only; unbans user
- `POST /api/admin/audit/[id]/undo` — ADMIN only; undoes action within 24h window
- `PATCH /api/admin/listings/[id]/review` — ADMIN/EMPLOYEE; `action: "approve"` → ACTIVE + `LISTING_APPROVED` notification; `action: "reject"` → HIDDEN + `LISTING_REJECTED` notification + reason required

### Enforcement
- **Browse** (`/browse/page.tsx`): `seller: { user: { banned: false } }` added to main query
- **Homepage** (`/page.tsx`): same filter on Fresh from Workshop + Collector Favorites
- **Similar items** (`/api/listings/[id]/similar`): banned filter on both raw SQL paths + Prisma fallback
- **Seller profile** (`/seller/[id]`): redirects to `/not-found` if `seller.user.banned`
- **`ensureUser`**: throws `"Your account has been suspended. Contact support@thegrainline.com"` if user is banned (sign-in fails gracefully)
- **`/banned` page** (`src/app/banned/page.tsx`): branded suspension page with support email; `robots: { index: false }`

### Client components
- **`BanUserButton`** — `window.prompt` for reason, optimistic toggle, POST/DELETE to ban route
- **`UndoActionButton`** — shows "Undo" within 24h, "Expired" after; `window.prompt` for reason
- **`ReviewListingButtons`** — Approve (no reason needed) / Reject (prompts for reason); calls `PATCH /api/admin/listings/[id]/review`; calls `router.refresh()` on success

### `LISTING_APPROVED` and `LISTING_REJECTED` notification types
Added to `NotificationType` enum. Sent to seller on admin approve/reject. `createNotification` preference check applies (type string `"LISTING_APPROVED"` / `"LISTING_REJECTED"`).

## AI Listing Review (complete — 2026-04-01)

### Schema additions on `Listing`
- `aiReviewFlags String[] @default([])` — flags returned by AI review
- `aiReviewScore Float?` — confidence score from AI (0.0–1.0)
- `reviewedByAdmin Boolean @default(false)` — set to true on admin approve/reject
- `reviewedAt DateTime?` — timestamp of admin review

### `PENDING_REVIEW` and `REJECTED` listing statuses
`PENDING_REVIEW`: listings held for admin review. Hidden from all public surfaces. Visible to seller (amber "Under Review" badge) and admins in `/admin/review`.

`REJECTED`: **SECURITY FIX (2026-04-15)** — admin-rejected listings now use `REJECTED` status (was `HIDDEN`, which let sellers click "Unhide" to bypass moderation). `rejectionReason String?` field added to Listing model. Migration: `20260415050609_add_rejected_listing_status`.

- **Seller sees**: red "Rejected" badge on dashboard + shop page; rejection reason banner on edit page; "Resubmit for Review" button (triggers full AI review again) + Edit + Delete. No Unhide button.
- **`unhideListingAction`** (shop): blocks `REJECTED` status (returns early).
- **`markAvailableAction`** (shop): blocks `REJECTED` status (returns early).
- **`setStatus`** (dashboard/page.tsx): blocks `REJECTED` → `ACTIVE` and `REJECTED` → `HIDDEN` transitions (returns early). REJECTED listings show Edit, Preview, Resubmit, Delete on My Listings — no Hide/Unhide/Mark sold.
- **`ResubmitButton`** (`src/components/ResubmitButton.tsx`): "use client" component; calls `publishListingAction` with `useTransition`; shows inline toast. Used on dashboard My Listings for REJECTED status.
- **`publishListingAction`**: clears `rejectionReason` on re-publish; runs full AI review flow.
- **Admin approve** (`/api/admin/listings/[id]/review`): Zod schema fixed — `reason` changed from `.optional()` to `.nullish()` (accepts `null` from `JSON.stringify`). Clears `rejectionReason: null` when approving. Handles PENDING_REVIEW and REJECTED → ACTIVE.
- **Admin reject** (`/api/admin/listings/[id]/review`): sets `status: 'REJECTED'`, saves `rejectionReason`, sends `LISTING_REJECTED` notification with reason.
- **Public surfaces**: seller profile listing query fixed — was `where: { sellerId }` (no status filter, showed REJECTED/HIDDEN/DRAFT on public page). Now uses allowlist: `status: { in: ["ACTIVE", "SOLD", "SOLD_OUT"] }`. All other public queries already filtered by ACTIVE.
- **`DismissibleBanner`** (`src/components/DismissibleBanner.tsx`): "use client" wrapper; localStorage persistence keyed to rejected listing IDs (`dismissed-rejected-ids`). Reappears when a NEW listing gets rejected (new ID not in dismissed set).
- **Full audit (2026-04-15)**: 15 status-change locations found. All 4 seller-accessible paths to ACTIVE check for REJECTED. Admin paths (approve, undo) intentionally bypass.

### `reviewListingWithAI` (`src/lib/ai-review.ts`)
- **Model**: gpt-4o-mini with vision, temperature 0.1, max 300 tokens
- **Text review**: 13 explicit prohibited categories (counterfeit goods, unlicensed IP like Disney/Marvel/sports logos, regulated goods like firearms/tobacco/cannabis/Rx, weapons as weapons, adult content, hate symbols, protected species, medical claims, services disguised as goods, digital-only, mass-produced/dropshipped, scams/spam, non-woodworking primary goods)
- **Image review** (strict mode): up to 4 images at `detail: "low"` (~85 tokens/image). Rejects: graphics/logos/SVGs/clipart instead of product photos, headshots/portraits without visible product, stock photos, mismatched product images, sexualized content. Single-image listings rejected if image doesn't clearly show described product. When in doubt: reject (seller can resubmit with proper photos). Includes worked examples of both violations and valid listings in prompt.
- **Description quality**: under 20 chars or no product info → flag `low-quality-description` (new sellers get pass); 3+ listings with very low quality → reject; missing description → always reject.
- **Signature**: optional `imageUrls?: string[]` param — backward compatible; callers pass first 4 photo URLs from listing. Returns `{ approved, flags, confidence, reason }`.
- **Leniency**: 0-2 listing count = benefit of doubt on borderline cases, 3+ = standard strictness. Always reject clear violations regardless of seller experience.
- **Fallback**: returns `approved: true` on any error (API down, rate limit, no key) with manual review flag. Gracefully returns `{ approved: true, confidence: 1 }` if `OPENAI_API_KEY` env var is missing.
- **Error logging**: `console.error` on catch for debugging
- **Cost**: ~$0.0006 per listing with 4 images (~85 tokens per low-detail image)
- **Callers**: `dashboard/listings/new/page.tsx` (passes `imageUrls.slice(0, 4)` from form data) and `seller/[id]/shop/actions.ts` (`publishListingAction` — fetches first 4 photos via `prisma.photo.findMany`)
- **Duplicate detection**: `sellerId` (required) added to function signature. Before OpenAI call, counts listings with same title (case-insensitive) from same seller in last 24h. 2+ = auto-reject with `duplicate-listing` + `possible-spam` flags, bypasses OpenAI entirely (saves tokens). Uses SellerProfile ID (`seller.id`), not User ID. Duplicate check wrapped in try/catch — non-fatal on error, continues to AI review.

### Listing creation flow (`dashboard/listings/new/page.tsx`)
After `prisma.listing.create()`, AI review runs async in a try/catch:
1. Fetches seller's total listing count
2. Calls `reviewListingWithAI()`
3. `shouldHold = !aiResult.approved || aiResult.flags.length > 0 || aiResult.confidence < 0.8` — only auto-approves when AI returns approved:true AND zero flags AND confidence >= 0.8. Any flag, low confidence, or rejection → PENDING_REVIEW for admin. AI errors also default to PENDING_REVIEW (not ACTIVE).
4. If hold: updates listing to `PENDING_REVIEW`, saves `aiReviewFlags` + `aiReviewScore`, logs `AI_HOLD_LISTING` audit entry
5. If not held: listing stays `ACTIVE` — only when AI fully clears with no concerns

Dashboard shows amber "Under Review" badge + top-of-section banner when any listings are pending.

### Listing edit re-review
AI re-review triggers on ACTIVE listings when any substantive content changes. Three trigger points:

1. **Text field edits** (`dashboard/listings/[id]/edit/page.tsx` `updateListing`): title, description, category, or price (>50% change). Low-risk changes (tags, shipping, dimensions) do not trigger.
2. **Image additions** (`api/listings/[id]/photos/route.ts`): any new photos added to ACTIVE listing triggers re-review with the new image set.
3. **Image deletions** (`dashboard/listings/[id]/edit/page.tsx` `deletePhoto`): removing a photo from ACTIVE listing triggers re-review with remaining images.

All three paths use the same threshold: `!approved || flags.length > 0 || confidence < 0.8` → PENDING_REVIEW. AI errors also send to admin queue. Non-fatal on infrastructure errors (listing stays ACTIVE only if try/catch catches a non-AI error).

- Scope: only ACTIVE listings. Edits to DRAFT, PENDING_REVIEW, REJECTED, HIDDEN, SOLD, SOLD_OUT skip re-review.
- Cover photo reorder (`setCoverPhoto`) does not trigger re-review (same images, different order — lower risk).

### Admin review queue (`/admin/review`)
- Shows all `PENDING_REVIEW` listings ordered oldest-first
- Card shows thumbnail, title, seller name, price, date, "First listing" badge, AI flags list, confidence %
- Approve → ACTIVE + seller notification + clear rejectionReason; Reject → REJECTED + seller notification + reason required
- Count badge in admin sidebar and mobile nav

## Listing Snapshot at Purchase (complete — 2026-04-01)

**`OrderItem.listingSnapshot Json?`** — captured at checkout in both `/api/cart/checkout/route.ts` and `/api/cart/checkout/single/route.ts`. Contains:
```json
{
  "title": "...",
  "description": "...",
  "priceCents": 4500,
  "imageUrls": ["https://..."],
  "category": "FURNITURE",
  "tags": ["walnut", "handmade"],
  "sellerName": "...",
  "capturedAt": "2026-04-01T..."
}
```
Useful for order history display, dispute resolution, and archival even if the listing is later edited or deleted.

## Admin Pages (complete — 2026-04-01)

### `/admin/users`
Paginated user table with URL-param search (`?q=` by email or name). Shows name, email, role badge, join date, ban status (with reason and date). Ban/Unban button via `BanUserButton`. ADMIN-only access. 30 users/page.

### `/admin/audit`
Paginated audit log (30/page). Action column color-coded (BAN_USER=red, UNBAN_USER/APPROVE=green, HOLD/AI_HOLD=amber). Shows admin name/email, target type+ID, reason, timestamp. Undo button (within 24h) via `UndoActionButton`.

### `/admin/review`
Review queue for `PENDING_REVIEW` listings. Oldest-first. "First listing" badge, AI flags, confidence score. Approve/Reject via `ReviewListingButtons`. Count badge in sidebar + mobile nav. ADMIN or EMPLOYEE access.

### `/admin/reports`
Reports show reason + details inline. Each report card now includes a contextual link based on `targetType`:
- `SELLER` → "View seller →" to `/seller/[targetId]`
- `LISTING` → "View listing →" to `/listing/[targetId]`
- `MESSAGE_THREAD` → "View thread →" to `/messages/[targetId]`
- `BLOG_POST` → "View post →" to `/blog/[targetId]`
- null → no link shown

### Admin layout + mobile nav updates
- Desktop sidebar: added Review Queue (with `pendingReviewCount` badge), Users, Audit Log links
- Mobile nav: added same three tabs with badge support
- `Eye` icon used for Review Queue, `User` for Users, `Shield` for Audit Log (already imported)
- `pendingReviewCount` added to parallel `Promise.all` in layout; passed to `AdminMobileNav`

### `UserReport` schema (2026-04-13)
Added `targetType String?` and `targetId String?` to `UserReport` model. Migration: `20260413200254_add_user_report_target`. `BlockReportButton` accepts optional `targetType` and `targetId` props and includes them in the POST body. Report API route (`/api/users/[id]/report`) reads and saves both fields. Wired on:
- `seller/[id]/page.tsx` → `targetType="SELLER" targetId={seller.id}`
- `messages/[id]/page.tsx` → `targetType="MESSAGE_THREAD" targetId={id}` (conversation ID)
- `listing/[id]/page.tsx` → `targetType="LISTING" targetId={listing.id}` (added BlockReportButton to seller card, gated on `meId && !isOwnListing`)

## Metro Geography Infrastructure (complete — 2026-04-01)

Data layer for city-level SEO pages. No page routes yet — pages are built in the next session.

### `Metro` model (`prisma/schema.prisma`)
- `id`, `slug` (unique, e.g. `"austin-tx"`), `name`, `state`, `latitude`, `longitude`, `radiusMiles Int @default(45)`, `isActive Boolean @default(true)`, `createdAt`, `updatedAt`
- **Self-relation**: `parentMetroId String?` → `Metro?` (child metros roll up to a parent major metro). A metro with no parent is a major metro.
- Back-relations on `Listing`, `CommissionRequest`, and `SellerProfile` (both `metro` and `cityMetro` variants)
- Migration: `20260401060322_add_metro_geography`

### Two-tier structure
- **Major metros** — no parent (e.g. `austin-tx`, `houston-tx`, `dallas-tx`)
- **Child metros** — point to a parent (e.g. `katy-tx → houston-tx`, `round-rock-tx → austin-tx`)
- A point matches a metro when it falls within that metro's `radiusMiles` radius (Haversine)

### Fields added
- `Listing`: `metroId String?` (major metro), `cityMetroId String?` (specific child metro)
- `CommissionRequest`: same two fields
- `SellerProfile`: same two fields
- All set automatically on create; left null if outside all metro areas or if geo-mapping fails

### Seed data (`prisma/seeds/metros.ts`)
20 Texas metros: 7 major (Austin, Houston, Dallas, San Antonio, Fort Worth, College Station, Waco) + 13 children. Run with:
```
npx dotenv-cli -e .env -- npx ts-node --transpile-only prisma/seeds/metros.ts
```

### `src/lib/geo-metro.ts`
- **`findNearestMetro(lat, lng)`** — checks child metros first (more specific), then majors; returns `{ cityMetro, majorMetro }` within radius
- **`mapToMetros(lat, lng)`** — **legacy function**, do not use in new code; kept for reference only. Use `findOrCreateMetro` instead.
- **`findOrCreateMetro(lat, lng)`** — **primary mapping function** for all new code: calls `findNearestMetro` first; if no metro found within radius, calls `reverseGeocode` (Nominatim, ≥1.1s throttle, US-only) to get city/state, then `prisma.metro.upsert` to auto-create a new metro at that location with slug format `city-name-xx`. Logs `[geo-metro] Auto-created metro: ${slug}` to Vercel logs. Returns `{ metroId, cityMetroId }` — always non-throwing (wrapped in try/catch at every call site).
- **`isMetroSlug(slug)`** — returns `true` if slug matches `/^[a-z][a-z0-9-]+-[a-z]{2}$/`; used in dynamic routes to distinguish metro slugs from CUIDs

### `src/lib/reverse-geocode.ts`
- **`reverseGeocode(lat, lng)`** — calls Nominatim (OpenStreetMap) reverse geocoding API; `User-Agent: Grainline/1.0 (thegrainline.com)`; enforces ≥1.1s between requests (Nominatim policy); extracts city from `address.city|town|village|hamlet`; returns `{ city, state, stateCode }` or `null` on failure/non-US result
- **Throttle**: module-level `lastRequestTime` variable; `throttledFetch` adds delay if < 1100ms has elapsed since last call (Nominatim policy: max 1 req/sec)
- All 50 US state names → two-letter codes in `STATE_CODES` map; returns `null` for non-US results

### Auto-mapping on create
- **Listings** (`dashboard/listings/new/page.tsx`) — after `prisma.listing.create`, fetches seller's lat/lng, calls `findOrCreateMetro`, updates listing. Non-fatal try/catch.
- **Commission requests** (`api/commission/route.ts`) — after create, if `lat`/`lng` set (local scope requests), calls `findOrCreateMetro`. Non-fatal try/catch.
- **Seller profile settings** (`dashboard/seller/page.tsx`) — after `prisma.sellerProfile.update`, if lat/lng is set, calls `findOrCreateMetro` and updates `metroId`/`cityMetroId`. Non-fatal try/catch.

### Backfill script (`scripts/backfill-metros.ts`)
One-time script — finds all existing listings, commissions, and seller profiles with coordinates but no `metroId`. For each coordinate, uses inline `resolveMetros` first; if nothing found, calls Nominatim and auto-creates the metro. Run with:
```
npx dotenv-cli -e .env -- npx ts-node --transpile-only scripts/backfill-metros.ts
```
Result on first run: 4 sellers, 20 listings updated; 0 commissions (none had local coordinates).

### Metro slug format
`<city-name>-<two-letter-state>` — all lowercase, hyphens for spaces (e.g. `the-woodlands-tx`). `isMetroSlug()` validates this format using `/^[a-z][a-z0-9-]+-[a-z]{2}$/`.

## City SEO Pages (complete — 2026-04-01)

Built on top of the metro geography infrastructure. All pages are public (middleware updated).

### Route structure and conflict resolution

| Route | File | Notes |
|---|---|---|
| `/browse/[metroSlug]` | `src/app/browse/[metroSlug]/page.tsx` | City listings grid |
| `/browse/[metroSlug]/[category]` | `src/app/browse/[metroSlug]/[category]/page.tsx` | City + category filter |
| `/commission/[param]` | `src/app/commission/[param]/page.tsx` | **Merged route** — see below |
| `/makers/[metroSlug]` | `src/app/makers/[metroSlug]/page.tsx` | City sellers directory |

**Commission route conflict resolution**: `/commission/[id]` (CUID) and `/commission/[metroSlug]` (metro slug) would be the same dynamic segment. Solution: single `[param]` route at `src/app/commission/[param]/page.tsx` that calls `isMetroSlug(param)` at the top. If true → renders metro commissions page. If false → renders existing commission detail page (original `[id]` logic). The old `src/app/commission/[id]/` directory was deleted; `MarkStatusButtons.tsx` was moved to `[param]/`.

### Query logic
- **Major metro** (no `parentMetroId`): queries by `metroId = metro.id` — captures all listings in the area including child cities
- **Child metro**: queries by `cityMetroId = metro.id` — shows only items mapped to that specific city

### generateStaticParams — content-gated
Each route only generates static params for metros that have at least 1 active listing/seller/commission. Empty metros are excluded from static generation and the sitemap. If navigated to directly, the page renders an empty-city variant with a commission CTA.

### Metadata per city page

**Browse**: `Handmade Woodworking in [City], [State] | Grainline` — description pulls live listing/seller counts

**Commission metro**: `Custom Woodworking Commissions in [City], [State] | Grainline`

**Makers**: `Woodworkers & Furniture Makers in [City], [State] | Grainline`

All have `alternates.canonical` and OpenGraph tags.

### JSON-LD structured data
- **Browse + commission metro**: `ItemList` schema with up to 10 `ListItem` entries (name, URL, image, offer price)
- **Makers**: `ItemList` of `LocalBusiness` entries with address, description, and `knowsAbout: "Handmade Woodworking"`
- **All city pages**: `BreadcrumbList` — Home → Browse/State → State → City

### Unique intro copy
- Browse with content: "Discover X handmade pieces from Y local makers in City, State. From custom furniture to kitchen accessories, connect directly with makers in the City area."
- Browse empty: "Custom woodworking in City — makers coming soon. Post a commission request…"
- Commission, Makers: similar dynamic patterns pulling live counts

### Nearby areas internal linking
- Major metro page: shows child metros that have content (e.g. Austin → Round Rock, Cedar Park…)
- Child metro page: shows siblings (same parent) + parent metro
- Only metros with active listings/sellers shown. Creates a crawlable geographic link network.

### National browse page additions
- **"Browse by city"** section added at the bottom of `/browse` — grouped by major metro with children listed under each. Only shows metros with active listings. Crawlable `<a>` links for Google discovery.

### Sitemap priorities

| Route | Priority | Frequency |
|---|---|---|
| `/browse/[metroSlug]` — major metro | 0.8 | weekly |
| `/browse/[metroSlug]` — child metro | 0.6 | weekly |
| `/browse/[metroSlug]/[category]` | 0.5 | weekly |
| `/makers/[metroSlug]` | 0.6 | monthly |
| `/commission/[metroSlug]` | 0.6 | weekly |

Only metros with active listings/sellers/commissions are included. `BASE_URL` corrected from `grainline.co` → `https://thegrainline.com` across the entire sitemap.

### Internal linking (SEO crawl graph)

- **Listing detail** → links to `/browse/[metro]` ("Browse all pieces in [City]") in Details section
- **Commission detail** → links to `/commission/[metro]` ("More commissions in [City]") in the aside
- **Seller profile** → links to `/makers/[metro]` ("More makers in [City]") near the location chip
- **Nearby areas** on city pages creates a dense geographic crawl graph (major → children, child → siblings + parent)
- **National `/browse`** has "Browse by city" section at bottom with all metros grouped by major metro

### Dynamic footer

`src/app/layout.tsx` footer queries `Metro` for all `isActive` metros with at least 1 active listing; renders them as linked text under "Browse by City". Only present on pages that use the root layout (all public pages).

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
- `formatSnippet` function: detects JSON message bodies by shape (commission interest card, custom order request, custom listing link) — fixes garbled JSON previews in conversation list
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

## Social Features (2026-04-10)

### Block/Report Users
- `Block` model + `UserReport` model added to schema; migration: `add_block_report`
- Block enforcement: `sendMessage` server action checks `Block` table before sending — returns `{ ok: false, error: "blocked" }`
- Block enforcement: follow API rejects if either user has blocked the other
- `POST/DELETE /api/users/[id]/block` — upsert/delete Block record
- `POST /api/users/[id]/report` — creates UserReport; rate limited 5/hr (`reportRatelimit`)
- `reportRatelimit` added to `src/lib/ratelimit.ts`
- `BlockReportButton` (`src/components/BlockReportButton.tsx`) — ••• menu with block/unblock + report with reason + details; wired into `seller/[id]/page.tsx` and `messages/[id]/page.tsx`; **dropdown direction fix** (2026-04-13): `triggerRef = useRef<HTMLButtonElement>()` on trigger, `getBoundingClientRect()` in `handleOpen()` measures position before opening, `openUpward ? "bottom-full mb-1" : "top-full mt-1"` classes applied; report label: "Report this listing" (LISTING), "Report this conversation" (MESSAGE_THREAD), "Report [name]" (default)
- `POST /api/admin/reports/[id]/resolve` — marks resolved, logs `RESOLVE_REPORT` to audit

### My Reviews
- `src/app/account/reviews/page.tsx` — buyer's review history with listing photo, stars, comment, seller reply
- Linked from `account/page.tsx` as new Section 4

### Admin Reports Queue
- `src/app/admin/reports/page.tsx` — unresolved reports with reporter/reported names, reason, resolve button; reported user name is a Link to `/admin/users?q=<email>` for quick lookup
- `ResolveReportButton` (`src/components/admin/ResolveReportButton.tsx`) + resolve API route
- Reports link added to admin sidebar + mobile nav

## Admin Capabilities (2026-04-10)

- DELETE /api/admin/reviews/[id] — hard delete review; logged as DELETE_REVIEW in AdminAuditLog
- DELETE /api/admin/listings/[id] — soft delete (status=HIDDEN); logged as REMOVE_LISTING; no migration needed
- POST /api/admin/email — ADMIN-only; rate limited 10/hr via adminEmailRatelimit; Resend email with Grainline template
- adminEmailRatelimit added to src/lib/ratelimit.ts (slidingWindow 10/1h)
- src/app/admin/reviews/page.tsx — all reviews list with delete buttons (100 most recent)
- DeleteReviewButton, DeleteListingButton, AdminEmailForm in src/components/admin/
- AdminEmailForm: expand/collapse pattern, collapses after successful send
- Admin sidebar + mobile nav updated with Reviews link

## Shared ListingCard Component (complete — refactor)

`src/components/ListingCard.tsx` — `"use client"` shared card component used across all listing grid/scroll surfaces. Zero visual changes from prior inline implementations.

### `ListingCardData` type
```ts
export type ListingCardData = {
  id, title, priceCents, currency, status, listingType, stockQuantity?,
  photoUrl, seller: { id, displayName, avatarImageUrl, guildLevel, city, state, acceptingNewOrders },
  rating?: { avg, count } | null
}
```

### Props
- `listing: ListingCardData`
- `initialSaved: boolean`
- `variant: "grid" | "scroll"` — grid: full `card-listing` with seller chip + GuildBadge + acceptingNewOrders badge; scroll: compact `w-full` card for horizontal scroll rows

### Migrated call sites (7 total)
| File | Variant | Notes |
|---|---|---|
| `browse/page.tsx` | `grid` | Inside `GridCard` wrapper which provides its own ClickTracker; outer ClickTracker removed from call site |
| `page.tsx` (homepage) | `scroll` | Fresh from the Workshop + Buyer Favorites horizontal rows; ClickTracker stays at call site as `<li>` |
| `account/saved/page.tsx` | `grid` | Added `listingType`, `stockQuantity`, `guildLevel`, `city`, `state`, `acceptingNewOrders` to Prisma select |
| `seller/[id]/shop/page.tsx` | `grid` | Seller chip data from page-level `seller` object |
| `seller/[id]/page.tsx` | `grid` | Featured Work + All Listings; seller chip data from page-level `seller` object |
| `browse/[metroSlug]/page.tsx` | `grid` | Added `status`, `listingType`, `stockQuantity`, `city`, `state`, `acceptingNewOrders` to Prisma select |
| `browse/[metroSlug]/[category]/page.tsx` | `grid` | Same field additions |

### ClickTracker nesting rule
`ClickTracker` renders as a `<li>`. When the component providing the card (e.g. `GridCard` in browse) includes its own `ClickTracker`, the outer `<ClickTracker>` at the call site must be removed. For scroll-variant cards, `ClickTracker` stays at the call site and `ListingCard` renders an inner `<div>`.

## Block Filtering (complete — 2026-04-13)

Mutual block filtering applied to all public surfaces. When user A blocks user B (or is blocked by B), neither can see the other's content anywhere on the platform.

### Utility (`src/lib/blocks.ts`)
- **`getBlockedUserIdsFor(meId)`** — queries `Block` table bidirectionally, returns `Set<string>` of all user IDs that are either blocking or blocked by the given user
- **`getBlockedSellerProfileIdsFor(meId)`** — calls `getBlockedUserIdsFor`, maps user IDs to SellerProfile IDs

### Pattern rules
- Prisma: `...(list.length > 0 ? { field: { notIn: list } } : {})` — never passes `notIn: []`
- Raw SQL: skip when empty; use `!= ALL(${array})` template parameter when non-empty
- Never applied to admin surfaces or order history

### Surfaces covered (12)

| Surface | File | What changes |
|---|---|---|
| Browse | `browse/page.tsx` | `sellerId: { notIn: blockedSellerIds }` on main query; preserved through sellerIdFilters merge |
| Homepage | `page.tsx` | `fresh`, `topSaved`, `fromYourMakers` recentListings/recentPosts |
| Seller profile | `seller/[id]/page.tsx` | Returns "not available" page with "Browse other makers →" (not 404) |
| Messages inbox | `messages/page.tsx` | Post-fetch `convos.filter()` by other participant |
| Blog index | `blog/page.tsx` | `authorId: { notIn: [...] }` in `baseFilters` — applies to both GIN + standard query paths |
| Blog post | `blog/[slug]/page.tsx` | `notFound()` if post author is in blocked set |
| Feed API | `api/account/feed/route.ts` | Filters `sellerIds` from follows before all three parallel queries |
| Makers map | `map/page.tsx` | `id: { notIn: blockedSellerIds }` on sellerProfile query |
| Search suggestions | `api/search/suggestions/route.ts` | Prisma `listings` query + two conditional raw SQL paths (tagRows, fuzzyRows) |
| Metro browse | `browse/[metroSlug]/page.tsx` + `[metroSlug]/[category]/page.tsx` | `sellerId: { notIn: blockedSellerIds }` in `listingWhere` |
| Commission board | `commission/page.tsx` | Standard Prisma path: `buyerId: { notIn: [...] }`; near-me raw SQL path: post-filter `rawResults` (added `u.id AS "buyerId"` to SELECT) |
| Reviews | `ReviewsSection.tsx` + `listing/[id]/page.tsx` | Added `blockedUserIds?: string[]` prop; `reviewerId: { notIn: blockedUserIds }` on review query |
| Homepage MakersMapSection | `page.tsx` | `id: { notIn: blockedSellerIds }` on mapRows sellerProfile query |
| Homepage Stories (blog) | `page.tsx` | `authorId: { notIn: [...blockedUserIds] }` on recentBlogPosts query; added `getBlockedUserIdsFor` import |
| Listing detail | `listing/[id]/page.tsx` | Returns "not available" page (not 404) if seller user is in blocked set |
| Saved items | `account/saved/page.tsx` | `listing: { sellerId: { notIn: blockedSellerIds } }` on favorites query |

### `/account/blocked` page (complete — 2026-04-13)
- `src/app/account/blocked/page.tsx` — server component; lists all blocks WHERE `blockerId = me.id` (only blocks YOU created); shows avatar + name per row; Unblock button submits to server action
- `src/app/account/blocked/actions.ts` — `unblockUser(blockedId)` server action; verifies ownership before `deleteMany`; `revalidatePath("/account/blocked")`
- Form uses `action={unblockUser.bind(null, b.blockedId)}` pattern (no inline closure)
- Linked from `/account` page inside the My Reviews section (same card, `block` links)
- Card layout matches `/account/reviews` exactly (`card-section p-4 flex gap-4`)

### Auth pattern for server components
When auth() was positioned after the queries that need block filtering, it was moved to before those queries. The resolved `meDbId` is reused in downstream savedSet / favorites logic to eliminate redundant DB lookups.

## Bug Fixes (2026-04-13)

Seven bugs fixed across seller shop, dashboard, and blog pages. Zero TypeScript errors. Deployed.

- **Remove custom photo button did nothing** (`dashboard/profile/page.tsx`): Root cause was nested `<form>` elements — the remove button was inside `<form action={removeSellerAvatar}>` nested inside `<form action={updateSellerProfile}>`. HTML discards inner forms; the button submitted the outer form instead. Fix: extracted `RemoveAvatarButton.tsx` (`"use client"`) with `type="button"` that calls the server action directly and calls `router.refresh()` to force RSC re-render.

- **Dashboard listing cards not clickable** (`dashboard/page.tsx`): Non-draft listings (ACTIVE, HIDDEN, SOLD, SOLD_OUT, PENDING_REVIEW) had no clickable link on photo or title. Fixed by wrapping photo in `<Link href={/listing/${l.id}}>` and title text in a separate `<Link>` for non-DRAFT statuses. DRAFT listings keep only the existing "Preview →" link.

- **Shop page draft cards missing preview banner** (`seller/[id]/shop/page.tsx`, `components/ListingCard.tsx`): Added `href?: string` prop to `ListingCard`; `listingHref = href ?? /listing/${l.id}`. Shop page passes `href={/listing/${l.id}?preview=1}` for owner+DRAFT listings.

- **publishListingAction missing chargesEnabled check** (`seller/[id]/shop/actions.ts`, `ShopListingActions.tsx`): Added `chargesEnabled` guard BEFORE the try/catch in `publishListingAction` so it throws to the client. Added try/catch to the Publish button's `startTransition` handler in `ShopListingActions.tsx` — shows error message as toast (e.g. "Connect your bank account in Shop Settings to publish.").

- **SOLD listings had no way to relist** (`seller/[id]/shop/actions.ts`, `ShopListingActions.tsx`): Added `markAvailableAction` (sets ACTIVE, syncThreshold, revalidates shop + dashboard). Added "Mark available" button shown for SOLD status only.

- **HIDDEN listings showed both Publish and Unhide** (`ShopListingActions.tsx`): Rewrote per-status button logic. Final matrix: ACTIVE → Hide, Mark sold, Delete; HIDDEN → Unhide, Delete; DRAFT → Publish, Delete; PENDING_REVIEW → (nothing, Edit only); SOLD → Mark available, Delete; SOLD_OUT → Delete. Edit link always shown. Delete hidden from PENDING_REVIEW only.

- **Blog post author avatar used Clerk image only** (`blog/[slug]/page.tsx`): Added `sellerProfile: { select: { avatarImageUrl, displayName } }` to the `author` select. Updated resolution: `authorAvatar = post.author.sellerProfile?.avatarImageUrl ?? post.author.imageUrl`; `authorName = post.author.sellerProfile?.displayName ?? post.author.name ?? "Staff"`. No layout changes.

## Pending Tasks

### Code Change Safety Rules
- NEVER remove or modify existing functionality unless explicitly told to
- Before editing any file, read the ENTIRE file first — not just the section you're changing
- After making changes to a file, verify that ALL existing features in that file still work (event handlers, API calls, JSX elements)
- If you're adding a new component or feature to a file, do NOT delete or restructure existing code in that file
- Run `npx tsc --noEmit` after every file change, not just at the end
- When replacing a component (e.g., UserButton → UserDropdown), verify ALL functionality of the old component is preserved in the new one

**TypeScript: zero `tsc --noEmit` errors** (maintained as of 2026-04-01)

### Immediate / deploy blockers

1. **CSP enforcement** — ✅ **Complete (2026-04-02)** — enforced; `clerk.thegrainline.com` added to `script-src-elem`, header changed to `Content-Security-Policy`
2. **Clerk webhook production setup** — add `CLERK_WEBHOOK_SECRET` to Vercel; register `https://thegrainline.com/api/clerk/webhook` in Clerk Dashboard → Production → Webhooks (events: `user.created`, `user.updated`)
3. **Stripe live mode webhook** — register after identity verification clears; update `STRIPE_WEBHOOK_SECRET` in Vercel with live mode signing secret

### QA / pre-launch

4. **OWASP ZAP scan** — run against preview deployment before go-live
5. **End-to-end checkout testing** — 10 purchases in Stripe test mode covering: single item, multi-item cart, gift wrapping, made-to-order, pickup, custom order flow
6. **Rotate Neon database password** — credentials were visible in terminal output; rotate in Neon dashboard + update Vercel env vars
7. **Add noindex to dev data** — add `robots: { index: false }` to test listings / seller profiles before Google indexes fake data

### Platform features

8. **Wax seal stamp** (Guild Master exclusive, post-launch) — `guildStampStyle String?` on `SellerProfile`; 4 styles (serif/block/script/ornate); monogram + `logo-mark.svg` — defer until post-launch

### Legal / business

- **Rotate Neon database password** — credentials were visible in terminal output; rotate in Neon dashboard + update Vercel env vars **(LAUNCH BLOCKER)**
- **Attorney review** of Terms / Privacy — budget $1,500–$3,000; bring 5-page pre-launch checklist + 196-item attorney discussion list **(LAUNCH BLOCKER)**
- **EIN** ✅ obtained
- **Business bank account** ✅ opened
- **Business address** ✅ — Registered Agents Inc., 5900 Balcones Drive STE 100, Austin, TX 78731
- **DMCA agent registration** ✅ — DMCA-1071504, registered 2026-04-14
- **Texas marketplace facilitator registration** — required before collecting sales tax **(LAUNCH BLOCKER)**
- **Operating agreement** — create at attorney meeting **(LAUNCH BLOCKER)**
- **Clickwrap implementation** — build checkbox before account creation; attorney decides if required for launch
- **Trademark Class 035** filing — ~$350; clearance search first (conflict risk with "Grainline Studio")
- **Business insurance** — general liability ($30–60/mo) + cyber liability + marketplace product liability
- Fix Terms 6.3 redundant sentence — delete "Payout timing is governed by Stripe's standard payout schedule." *(fixed in c7bde34)*
- Fix Privacy Section 10 duplicate paragraph — delete "By using the Platform, you consent..." paragraph *(fixed in c7bde34)*
- Clean up both TOCs — remove inline subsection references, show main section titles only *(fixed in c7bde34)*
- Resolve duplicate Feedback clause — 11.6 vs 33.11; attorney decides which to keep

### SEO

17. **Google Search Console** — verify domain ownership, submit `https://thegrainline.com/sitemap.xml`
18. **`metadataBase`** ✅ corrected to `https://thegrainline.com` in `layout.tsx`

### Process

**Every Claude Code session must update CLAUDE.md at the end** — add or update sections for all features built, all bugs fixed, all schema/API/UI changes made. Keep CLAUDE.md as the authoritative reference for the current state of the codebase.

## Security Hardening (complete — 2026-03-31)

### Rate limiting — 15 routes total

All limiters live in `src/lib/ratelimit.ts` (Upstash Redis sliding-window). All 429 responses use `rateLimitResponse(reset, message)` helper — returns human-readable retry time ("a moment" / "N minutes" / "N hours" / "tomorrow at HH:MM AM") + `Retry-After` + `X-RateLimit-Reset` headers.

| Limiter | Key | Limit | Applied to |
|---|---|---|---|
| `searchRatelimit` | IP | 30 / 10 s | `GET /api/search/suggestions` |
| `viewRatelimit` | IP | 20 / 60 s | `POST /api/listings/[id]/view` |
| `clickRatelimit` | IP | 20 / 60 s | `POST /api/listings/[id]/click` |
| `reviewRatelimit` | userId | 5 / 60 s | `POST /api/reviews` |
| `checkoutRatelimit` | userId | 10 / 60 s | `POST /api/cart/checkout`, `checkout/single` |
| `messageRatelimit` | userId | 30 / 60 s | `GET /api/messages/[id]/stream` |
| `followRatelimit` | userId | 50 / 60 min | `POST/DELETE /api/follow/[sellerId]` |
| `saveRatelimit` | userId | 100 / 60 min | `POST /api/favorites` |
| `blogSaveRatelimit` | userId | 100 / 60 min | `POST/DELETE /api/blog/[slug]/save` |
| `commissionInterestRatelimit` | userId | 20 / 24 h | `POST /api/commission/[id]/interest` |
| `commissionCreateRatelimit` | userId | 5 / 24 h | `POST /api/commission` |
| `listingCreateRatelimit` | userId | 20 / 24 h | `createListing` server action |
| `profileViewRatelimit` | `${ip}:${listingId}` | 1 / 24 h | `POST /api/listings/[id]/view` (silent drop — no 429 returned) |
| `broadcastRatelimit` | sellerId | 1 / 7 d | `POST /api/seller/broadcast` (in addition to DB 7-day check) |
| `caseCreateRatelimit` | userId | 5 / 24 h | `POST /api/cases` |
| `caseMessageRatelimit` | userId | 30 / 60 min | `POST /api/cases/[id]/messages` |
| `customOrderRequestRatelimit` | userId | 10 / 24 h | `POST /api/messages/custom-order-request` |
| `stripeLoginLinkRatelimit` | userId | 10 / 60 min | `POST /api/stripe/connect/login-link` |
| `markReadRatelimit` | userId | 60 / 60 min | `POST /api/notifications/read-all` (fail open — silent success on limit) |

### Spam prevention guards

All blocked actions return 400; spam attempts for self-actions are also logged to Sentry via `logSecurityEvent()` in `src/lib/security.ts`.

| Guard | Where | Status |
|---|---|---|
| Self-review blocked | `api/reviews/route.ts` | Added + Sentry logged |
| Self-follow blocked | `api/follow/[sellerId]/route.ts` | Present + Sentry logged |
| Own-commission interest blocked | `api/commission/[id]/interest/route.ts` | Present + Sentry logged |
| Duplicate commission interest blocked | DB `@@unique` constraint | Present |
| Commission interest on non-OPEN request | `api/commission/[id]/interest/route.ts` | Present |
| Self-messaging blocked | `messages/new/page.tsx`, `api/messages/custom-order-request` | Present |
| Reviewing own listing blocked | `api/reviews/route.ts` | Present (same as self-review) |

### Input sanitization (`src/lib/sanitize.ts`)

- `sanitizeText(input)` — strips HTML tags, `javascript:` protocol, event handler attributes; used on short fields
- `sanitizeRichText(input)` — strips `<script>`, `<iframe>`, `javascript:`, event handlers; used on long-form content

Applied at DB boundary: listing title/description (new + edit), seller displayName/tagline/bio, commission title/description, review text, broadcast messages.

### Numeric validation

Price: ≥ $0, ≤ $100,000 · Stock: non-negative · Processing time: ≤ 365 days · Commission budget: min ≤ max, non-negative.

### Sentry security tracking (`src/lib/security.ts`)

`logSecurityEvent(event, details)` — Sentry breadcrumb for all events; `captureEvent` for `ownership_violation` and `spam_attempt`.

### Bot prevention — `chargesEnabled`

Migration `20260331205748_charges_enabled`: `chargesEnabled Boolean @default(false)` on `SellerProfile`. Browse, homepage Fresh/Favorites, similar items, and seller shop all filter `seller.chargesEnabled: true`. Dashboard shows amber "Connect Stripe" warning when false. Stripe Connect callback (`api/stripe/connect/create`) sets `chargesEnabled = account.charges_enabled`. All 7 existing sellers backfilled to `true` via `scripts/backfill-charges-enabled.ts`.

### Clerk security settings (configured in Clerk dashboard)

- Bot protection via Cloudflare Turnstile — enabled
- Disposable email blocking — enabled
- Email subaddress blocking — enabled
- Strict user enumeration protection — enabled
- Account lockout policy — enabled

## PWA Setup (complete — 2026-03-31)

- **`public/manifest.json`** — name, short_name, description, start_url, display: standalone, background_color `#FAFAF8`, theme_color `#1C1917`, shortcuts (Browse, My Account), categories (shopping, lifestyle)
- **`public/icon-192.png`** and **`public/icon-512.png`** — generated from `public/logo.svg` via `sharp`; regenerated with `#1C1917` dark background so logo is visible on all surfaces (192×192 and 512×512)
- **`public/favicon.png`** — copy of `icon-192.png`; used as the browser tab favicon (replaces `favicon.ico` which was the Vercel default triangle)
- **`src/app/layout.tsx`** — `icons: { icon: "/favicon.png", apple: "/icon-192.png" }`; also has `manifest`, `appleWebApp`, `formatDetection`, `viewport` with `themeColor`
- **`src/app/offline/page.tsx`** — server component; logo + "You're offline" heading + "Try again" link (`<a href="/">`)

## Security Headers (complete — 2026-03-31)

`next.config.ts` updated with `headers()` async function applying to all routes (`source: '/(.*)'`):

| Header | Value |
|---|---|
| `X-DNS-Prefetch-Control` | `on` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(self)` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |

**CSP status**: `Content-Security-Policy` (**enforced** as of 2026-04-02). Previously report-only; switched after fixing missing `https://clerk.thegrainline.com` in `script-src-elem` which caused 3K Sentry CSP violation events. Violations continue to be logged to `/api/csp-report` and Sentry under tag `csp_violation`.

## chargesEnabled Backfill (hotfix — 2026-03-31)

The `chargesEnabled Boolean @default(false)` field caused all existing sellers to fail the new filter, blanking browse. Two rounds of backfill were needed:
- **Round 1**: `scripts/backfill-charges-enabled.ts` — updated sellers with `stripeAccountId` (2 sellers). Browse still showed 0 — active listings belonged to dev sellers without Stripe.
- **Round 2**: `updateMany` with no `where` clause — set all 7 existing sellers to `true`. Going forward, only brand-new sellers need to complete Stripe Connect to appear publicly.

**Stripe webhook now handles `account.updated`**: When Stripe notifies of a seller account status change, `chargesEnabled` is synced automatically. If a seller's account is disabled, Sentry is notified via `logSecurityEvent`. `account.application.deauthorized` clears `stripeAccountId` and sets `chargesEnabled = false` when a seller disconnects the platform.

## Content Security Policy (enforced — 2026-04-02)

`Content-Security-Policy` is **enforced** in `next.config.ts` as of 2026-04-02. Was report-only; switched after fixing missing `https://clerk.thegrainline.com` in `script-src-elem` (was causing 3K Sentry CSP violation events from Clerk's custom domain scripts).

**Violation reporting**: `POST /api/csp-report` — public route (in middleware `isPublic`); logs to Sentry breadcrumbs; captures Sentry events for `script` and `frame` directive violations; logs to console in dev mode.

**Directives summary**:

| Directive | Key allowed sources |
|---|---|
| `script-src` | `'self' 'unsafe-inline' 'unsafe-eval'` (Next.js hydration requires both) |
| `script-src-elem` | `'self' 'unsafe-inline'` + `clerk.com *.clerk.accounts.dev *.clerk.com clerk.thegrainline.com js.stripe.com cdnjs.cloudflare.com` (note: `clerk.thegrainline.com` was missing here before, causing 3K violations) |
| `style-src` | `'self' 'unsafe-inline'` |
| `img-src` | `'self' data: blob: https:` (HTTPS only — HTTP removed) |
| `font-src` | `'self' data: fonts.gstatic.com` |
| `connect-src` | `'self'` + Clerk, Stripe (`api` + `hooks`), UploadThing, Sentry, Upstash, OpenStreetMap, `wss://*.clerk.*` |
| `frame-src` | `'self'` + Stripe (`js` + `hooks`), Clerk |
| `worker-src` | `'self' blob:` |
| `media-src` | `'self'` |
| `object-src` | `'none'` |
| `form-action` | `'self'` + Clerk (`*.clerk.accounts.dev *.clerk.com`) |
| `frame-ancestors` | `'self'` (equivalent to `X-Frame-Options: SAMEORIGIN`) |

**CSP maintenance**: When adding new third-party services, add their domains to `next.config.ts` `securityHeaders`. Any violations in production appear in Sentry under tag `csp_violation`.

## Business (2026-04-01, updated 2026-04-14)

- **Texas LLC filed** ✅
- **EIN obtained** ✅
- **Business bank account opened** ✅
- **Business address** ✅ — Registered Agents Inc., 5900 Balcones Drive STE 100, Austin, TX 78731; filled in Terms + Privacy (was "[YOUR ADDRESS]")
- **DMCA agent registration** ✅ — DMCA-1071504, registered 2026-04-14
- **Geo-block**: US-only (Canada removed from middleware + Terms + Privacy)
- **Operating agreement**: create at attorney meeting — LAUNCH BLOCKER
- **Texas marketplace facilitator registration**: required before sales tax collection — LAUNCH BLOCKER
- **Attorney review**: budget $1,500–$3,000; bring pre-launch checklist + 196-item discussion list — LAUNCH BLOCKER
- **Trademark Class 035 filing**: ~$350 when ready (clearance search needed — "Grainline Studio" conflict)
- **Business insurance**: general liability + cyber liability + marketplace product liability

## External Services & Vendors

### DMCA Designated Agent
- Registration: DMCA-1071504
- Service Provider: Grainline LLC (258 Roehl Rd, Yorktown TX 78164 — matches LLC Certificate of Formation)
- Designated Agent: Joseph Young c/o Registered Agents Inc., 5900 Balcones Drive STE 100, Austin TX 78731
- Email: legal@thegrainline.com
- Update at: copyright.gov DMCA Designated Agent Directory

### Texas Registered Agent
- Registered Agents Inc.
- 5900 Balcones Drive STE 100, Austin, TX 78731
- Used for: LLC Certificate of Formation, DMCA agent address, Terms/Privacy contact address
- Annual fee paid

### Cloudflare Email Routing (set up 2026-04-14)
- Domain: thegrainline.com
- Routing addresses (all forward to drewyoung910@gmail.com):
  - legal@thegrainline.com (DMCA, legal notices)
  - support@thegrainline.com (general support)
  - hello@thegrainline.com
  - abuse@thegrainline.com
- MX records: route1.mx.cloudflare.net, route2.mx.cloudflare.net, route3.mx.cloudflare.net
- Existing Resend setup unaffected (Resend uses send.thegrainline.com subdomain for outbound only)

## Geo-Blocking (complete — 2026-04-01, US-only updated 2026-04-01)

US only (Canada removed to align with Terms of Service Section 31). Implemented in `src/middleware.ts` at the top of the middleware function body, before auth checks.

- Reads `request.geo?.country` (populated by Vercel edge in production; `undefined` in local dev — geo-blocking never fires locally)
- Non-US requests are redirected to `/not-available`
- `/not-available` is in `isPublic` so the redirect doesn't loop through auth
- Static assets (`/_next`, `/favicon`, `/logo`, `/icon`, `/manifest`, `/robots`, `/sitemap`) are allowed through without redirect
- **All `/api` routes bypass geo-blocking** — webhooks (Stripe, Clerk) and API calls originate from servers, not browsers, so geo-checking would break them
- **`src/app/not-available/page.tsx`** — branded page with logo, "Not available in your region" heading, brief explanation, VPN note; `robots: { index: false }` metadata

## Notification Preferences (complete — 2026-04-01)

Sellers and buyers can control which in-site notifications they receive.

### Schema
- **`User.notificationPreferences Json @default("{}")`** — stores a `Record<string, boolean>` where `false` means opted out. Migration: `20260401003152_notification_preferences`

### `createNotification` — preference check
Before inserting a notification, fetches the recipient's `notificationPreferences` and returns `null` (skips create) if `prefs[type] === false`. Never throws — preference failures don't break the main flow.

### Settings page (`/account/settings`)
- Server component; auth required
- Queries `notificationPreferences` + `sellerProfile` presence
- `DEFAULT_OFF` types (default to off unless explicitly enabled): `SELLER_BROADCAST`, `NEW_FAVORITE`, `NEW_BLOG_COMMENT`, `BLOG_COMMENT_REPLY`, `EMAIL_SELLER_BROADCAST`, `EMAIL_NEW_FOLLOWER`
- **In-App Notifications** (5 groups):
  - **From Makers You Follow** (3): `FOLLOWED_MAKER_NEW_LISTING`, `FOLLOWED_MAKER_NEW_BLOG`, `SELLER_BROADCAST` (default OFF)
  - **Orders & Cases** (6): `NEW_ORDER`, `ORDER_SHIPPED`, `ORDER_DELIVERED`, `CASE_OPENED` (sellers), `CASE_MESSAGE`, `CASE_RESOLVED`
  - **Your Shop** (sellers, 8): `NEW_MESSAGE`, `NEW_REVIEW`, `NEW_FOLLOWER`, `CUSTOM_ORDER_REQUEST`, `CUSTOM_ORDER_LINK`, `COMMISSION_INTEREST`, `NEW_FAVORITE` (default OFF), `LISTING_APPROVED`/`LISTING_REJECTED` (always-on labels)
  - **Blog** (sellers, 2): `NEW_BLOG_COMMENT` (default OFF), `BLOG_COMMENT_REPLY` (default OFF)
- **Email Notifications** (10 toggleable types, 4 subgroups):
  - Messages & Orders: `EMAIL_NEW_MESSAGE`, `EMAIL_NEW_ORDER` (sellers), `EMAIL_CUSTOM_ORDER` (sellers)
  - Cases & Reviews: `EMAIL_CASE_OPENED` (sellers), `EMAIL_CASE_MESSAGE`, `EMAIL_CASE_RESOLVED`, `EMAIL_NEW_REVIEW` (sellers)
  - From Makers: `EMAIL_FOLLOWED_MAKER_NEW_LISTING`, `EMAIL_SELLER_BROADCAST` (default OFF)
  - Your Shop (sellers): `EMAIL_NEW_FOLLOWER` (default OFF)
- Linked from Account Settings section on `/account` as "Notification preferences →"
- **NotificationBell** `markAllRead` button always visible in dropdown (removed `unreadCount > 0` condition); styled `text-xs text-neutral-500 hover:text-neutral-800 underline`

### `NotificationToggle` component (`src/components/NotificationToggle.tsx`)
- `"use client"` — optimistic toggle (immediate UI update, revert on error)
- Calls `POST /api/account/notifications/preferences` with `{ type, enabled }`

### Preferences API (`/api/account/notifications/preferences`)
- Auth required; reads current prefs JSON, sets `prefs[type] = enabled`, writes back via `prisma.user.update`

## Performance Improvements (complete — 2026-04-02)

- **Notification polling** (`NotificationBell.tsx`): 30s → 5 min → 10 min (600000ms). `UnreadBadge.tsx` default: 15s → 10 min (600000ms). Combined ~40x reduction from original polling rates.
- **Notification cleanup prune**: `GET /api/notifications` only runs `deleteMany` when `getMinutes() === 0` — ~1/60th of requests instead of every poll (60x reduction in unnecessary DB writes)
- **Browse `getSellerRatingMap` N+1 fixed**: replaced 2 sequential Prisma queries + in-memory join with a single SQL `JOIN` (`AVG(r."ratingX2")::float / 2.0`, `GROUP BY l."sellerId"`) — eliminates a full extra round trip on every browse page load
- **Popular tags API** (`GET /api/search/popular-tags`): ISR 1hr cache, raw SQL unnest; search bar shows top 8 listing tags on focus when input is empty — one fetch per session, cached at CDN edge
- **Popular blog tags API** (`GET /api/search/popular-blog-tags`): ISR 1hr cache, raw SQL unnest from `BlogPost.tags` where `status = 'PUBLISHED'`; `BlogSearchBar` uses this endpoint (not `/api/search/popular-tags`) — shows popular blog topics, not listing tags
- **Search suggestions trigger at 2 chars** (was 3) — faster discoverability
- **`NotificationBell` gated on sign-in state**: `useUser().isSignedIn` checked before any fetch — no 404 polls for signed-out users
- **Header `cart:updated` listener gated on `isLoggedIn`**: only fires `loadCartCount` when `loadAll` confirmed sign-in — eliminates signed-out cart 401s on add-to-cart events
- **`UserAvatarMenu` dropdown z-index confirmed** at `z-[200]`; Clerk modal CSS overrides confirmed in `globals.css` (`z-index: 9999`, `min-width: min(90vw, 800px)`)
- **ISR not applied** — block filtering requires per-user server rendering on all public listing/browse pages. Per-user caching is the correct future optimization when traffic justifies it.
- **`/api/health`** — static endpoint (`force-static`, no DB, no auth) for UptimeRobot monitoring

## Input Validation — Zod (complete — 2026-04-01)

All 33 API route files that accept request bodies now use **Zod** for schema validation. Schemas are colocated at the top of each route file (not in a shared file). Validation runs immediately after auth + rate-limit checks, before any database calls.

**Pattern used in every route:**
```ts
import { z } from "zod";

const MySchema = z.object({
  field: z.string().min(1).max(200),
  optionalField: z.number().positive().optional(),
});

export async function POST(request: Request) {
  // 1. auth check
  // 2. rate limit check
  // 3. Zod parse
  let body;
  try {
    body = MySchema.parse(await request.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // 4. database calls using body.field (typed and validated)
}
```

**Standard constraints applied:**
- Prices in cents: `z.number().int().min(0).max(10000000)` (max $100,000)
- Text fields: `.max(N)` matching existing `.slice(0, N)` guards
- Enums: `z.enum([...])` with literal values from the route's existing logic
- IDs: `z.string().min(1)`
- Booleans: `z.boolean()` (not strings)
- Arrays: `z.array(...).max(N)` with reasonable limits

**Skipped routes** (no request body parsing):
- `src/app/api/stripe/webhook/route.ts` — reads raw body for HMAC verification
- `src/app/api/clerk/webhook/route.ts` — reads raw body for svix verification
- `src/app/api/csp-report/route.ts` — logging sink, no state mutation, body structure is browser-defined
- `src/app/api/cart/checkout/route.ts` — POST accepts no body (reads cart from DB by session)

## CSRF Audit (complete — 2026-04-01)

All Next.js API routes are implicitly CSRF-safe for browser requests because Clerk's middleware enforces SameSite cookies and the App Router does not set CORS headers by default. Full audit documented in `src/lib/security.ts` (block comment at top of file).

**Public POST/PATCH/DELETE routes (no `auth()` call) and why each is safe:**

| Route | Reason safe |
|---|---|
| `POST /api/stripe/webhook` | Stripe-Signature HMAC verification; no session cookie |
| `POST /api/clerk/webhook` | Svix signature verification; no session cookie |
| `POST /api/csp-report` | Read-only logging sink; no state mutation |
| `POST /api/newsletter` | Low-risk public subscription; email address upsert only |
| `POST /api/listings/[id]/view` | Analytics-only increment; deduped via httpOnly cookie |
| `POST /api/listings/[id]/click` | Analytics-only increment; no sensitive mutation |

All other POST/PATCH/DELETE routes call `auth()` and return 401 before any data access.

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
- **Sentry `sendDefaultPii: true`** — Server and edge Sentry configs were sending Clerk session cookies to Sentry on every error. Changed to `false`. Client config unchanged (no cookies).
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
- **next 16.2.1 → 16.2.4** — fixes Server Components DoS (GHSA-q4gf-8mx6-v5v3). Crafted request crashes Vercel instance.

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
- `hono` CVEs (transitive via `@prisma/dev`) — not in production runtime, dev tooling only
- `Conversation`/`Message` lack `onDelete: Cascade` — will matter for GDPR account deletion
- `UserReport` missing `resolvedAt`/`resolvedById` fields — audit trail gap

### Post-audit review fixes (2026-04-18)
- **Cron routes added to `isPublic`** — `/api/cron(.*)` was missing from middleware's public list. Vercel Cron couldn't reach the guild-metrics and guild-member-check routes because Clerk middleware blocked them before the `CRON_SECRET` check could run. Now functional.
- **Browse price cap raised $100K → $500K** — high-value custom furniture (dining tables, commissioned pieces) was being filtered out. Upper bound kept to prevent abuse via absurd values in PostgreSQL queries.
- **Notification preference keys: shared constant** — `VALID_PREFERENCE_KEYS` exported from `src/lib/notifications.ts` as single source of truth. Preferences API imports it instead of duplicating 34 strings. Adding new notification types now requires updating only one file.
- **`$queryRawUnsafe` security comment** — Added rationale comment to `src/app/commission/page.tsx` explaining why `$queryRawUnsafe` is used and confirming all user input is bound via positional parameters.

### Deployment rule
**Always run `prisma migrate deploy` BEFORE `vercel --prod`** for migrations that add columns or constraints. Index-only migrations are safe to apply after deploy (queries are slower but correct). The pattern: `npx dotenv-cli -e .env -- npx prisma migrate deploy` → verify → `npx vercel --prod`.

### Infrastructure improvements (2026-04-18)
- **`.github/dependabot.yml`** — weekly npm security updates; minor/patch grouped into single PR; major version bumps ignored (require manual review); 10 open PR limit. Would have caught the Clerk 7.0.7 auth bypass CVE automatically.
- **`.github/workflows/ci.yml`** — runs `prisma generate` → `npx tsc --noEmit` → `npm audit` (informational, `continue-on-error: true`) on every PR and push to main. Node 22. `prisma generate` is required before `tsc` because Prisma 7.7 changed the client generation output. Audit is informational — Dependabot PRs surface actionable fixes.

### Dependency upgrades (via Dependabot PR #2, 2026-04-18)
- Prisma 7.6.0 → 7.7.0, Stripe SDK 19.0 → 19.3, React 19.2.4 → 19.2.5
- @sentry/nextjs 10.46 → 10.49, maplibre-gl 5.22 → 5.23, resend 6.1 → 6.12, svix 1.89 → 1.90
- AWS SDK (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) and type definition updates
- **Stripe `apiVersion`**: removed explicit `"2025-09-30.clover"` from `src/lib/stripe.ts` — SDK 19.3 changed the valid type union. Now uses the SDK's default API version.
- **`tsconfig.json`**: excluded `prisma/seed.ts`, `prisma/seed-bulk.ts`, `prisma/seeds`, and `scripts` directories from tsc. Prisma 7.7 changed PrismaClient import behavior which broke seed file compilation. These are build-only scripts, not runtime code.
- **Webhook oversell detection** — both cart and single-listing webhook paths now log `[OVERSELL]` via `console.error` when pre-decrement stock was insufficient for the ordered quantity. Shows in Vercel logs and Sentry breadcrumbs. No schema change (Order.notes doesn't exist). Oversold orders require manual seller review and potential refund.
- **Neon connection pooler** — TODO comment in `prisma/schema.prisma` documenting when to switch to pooled connection string (`-pooler` hostname). Current `PrismaPg` adapter in `src/lib/db.ts` uses direct connection via `DATABASE_URL`. Switch when concurrent connections exceed ~50.

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

## Stock Reservation System (2026-04-18)

Stock is now reserved at checkout time (session creation), not at payment time (webhook). Eliminates the oversell race condition where two concurrent buyers could both pay for the last item.

### Flow
1. **Checkout route** (both `checkout/single` and `checkout-seller`): atomic SQL `UPDATE "Listing" SET "stockQuantity" = "stockQuantity" - qty WHERE id = X AND "stockQuantity" >= qty`. If 0 rows affected → 400 "not enough stock". Two concurrent buyers can't both reserve the last item — the SQL WHERE guard is atomic at the database level.
2. **`checkout.session.completed` webhook**: stock already decremented. Just checks if SOLD_OUT status needed. No decrement.
3. **`checkout.session.expired` webhook** (NEW): restores reserved stock. Single-item: reads `listingId` + `quantity` from session metadata. Cart: retrieves `line_items.data.price.product` from Stripe (expanded) to get `listingId` per line item. Also restores ACTIVE status if listing was SOLD_OUT with stock > 0.
4. **Session expiry**: `expires_at` set to 30 minutes (was Stripe's 24h default). Stock shouldn't be held longer than necessary.

### Validation ordering (critical invariant)
**Stock reservation MUST be the last validation before `stripe.checkout.sessions.create`.** All 400-return paths (chargesEnabled, offersGiftWrapping, HMAC verification, listing status, isPrivate, self-purchase, vacation mode) must precede the reservation. If a validation returns 400 after stock is reserved but before a session is created, there is no session to expire and no webhook to restore the stock — it is permanently lost. This was a critical bug found in the post-implementation audit and fixed by reordering.

### Error handling
- **Stripe session creation failure**: both checkout routes track reservations (`reservedListingId`/`reservedQuantity` for single, `reservedItems[]` for cart) and restore stock in the `catch` block. Without this, stock would be permanently lost on Stripe outages.
- **Cart partial batch failure**: if reserving item B fails after item A was reserved, item A's stock is restored before returning 400.
- **Expired + completed race**: expired handler checks `prisma.order.findFirst({ where: { stripeSessionId } })` before restoring — if the order exists (payment completed), stock is NOT restored.
- **line_items expansion**: webhook uses `"line_items.data.price.product"` (not just `"line_items"`) to access `product.metadata.listingId`. Without the product expansion, `price.product` is a string ID, not an object with metadata.
- **expires_at = 31 minutes** (not 30): Stripe's minimum is exactly 30 minutes. Clock skew between `Date.now()` and Stripe's server could reject sessions at the 30-minute boundary. 1-minute buffer is standard practice.

### Stripe webhook setup required
Add `checkout.session.expired` to your Stripe webhook events:
Stripe Dashboard → Developers → Webhooks → endpoint → Add events → `checkout.session.expired`

Without this, expired sessions won't trigger stock restoration. Stock reserved by abandoned checkouts would be permanently held until manual adjustment.

### Seller experience
- Sellers see nothing when stock is reserved or restored. No notifications.
- Sellers only see NEW_ORDER notifications after payment is confirmed (unchanged).
- If a reservation causes stock to hit 0, the listing shows "Out of Stock" to other buyers during the 30-minute window. If the session expires, stock restores and the listing becomes available again automatically.

### Post-implementation audit (2026-04-18)
- **Stale `grainline.co` domain fixed** — 7 files had the old domain in canonical URLs and JSON-LD structured data (blog, browse, listing detail, seller profile, seller shop). All updated to `thegrainline.com`. Google was receiving wrong canonical URLs on every crawl.
- **Debug `console.log` removed** — 3 in webhook (debug output), 5 in `toggleFavorite` action (user ID/role logging). `console.error` calls retained for legitimate error logging.
- **TipTap XSS pipeline verified safe** — pasted HTML in TipTap is preserved in the markdown body, but `sanitize-html` strips all dangerous elements (`<script>`, event handlers, `javascript:` URIs) at render time on the blog detail page. End-to-end safe.

### Known stock reservation limitations (not bugs — documented)
- **Seller manual restock during live session** — if a seller edits `stockQuantity` via the dashboard while a checkout session holds a reservation, the expired webhook adds back the reserved amount on top of the seller's manual value. Stock can exceed the seller's intended amount. Requires unusual seller + buyer timing.
- **Multi-seller cart partial failure** — if cart checkout creates sessions sequentially and seller B fails after seller A succeeded, seller A's stock is held for 31 minutes until session expiry. Buyer sees an error and cannot retry until expiry. Acceptable at launch volume.
- **Missed expired webhook** — if Stripe never delivers `checkout.session.expired` (outage, 3-day retry exhaustion), stock is permanently held. No self-healing cron exists. Mitigation: Stripe's webhook reliability is >99.99%. A nightly reconciliation cron could be added post-launch if this becomes an issue.
- **`cart/add` allows adding reserved-but-not-sold items** — a listing with all stock reserved (stockQuantity=0, status=ACTIVE) can still be added to cart. Checkout creation is the enforcement point, where the atomic SQL `WHERE stockQuantity >= qty` blocks the buyer.

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
- **Favorites** — `NEW_FAVORITE` notifications check for existing notification with same `type` + `link` within 24 hours before creating. Prevents spam on favorite/unfavorite toggle cycles.
- **Follows** — `NEW_FOLLOWER` notifications check for existing notification with same `type` + follower name within 24 hours. Prevents spam on follow/unfollow/refollow.

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

## Scalability Optimizations (2026-04-18)

### Smart notification polling
`NotificationBell` uses adaptive polling instead of a fixed interval:
- **Active tab + recent activity**: poll every 60 seconds
- **Active tab + idle > 5 min**: poll every 5 minutes
- **Background tab** (`document.visibilityState === "hidden"`): poll every 15 minutes
- **Tab refocused**: immediate fetch + reschedule
- **Dropdown opened**: immediate fetch (unchanged)

Activity tracked via `lastActivityRef` (useRef, not state) — `mousemove`, `keydown`, `click` listeners with 10-second throttle. No re-renders on activity detection. The `setTimeout`-based scheduler reads the ref directly to determine the next interval.

### Homepage query deduplication
- `getBlockedIdsFor()` (new, `src/lib/blocks.ts`) returns both `blockedUserIds` (Set) and `blockedSellerIds` (string[]) in a single Block table query. Homepage previously called `getBlockedSellerProfileIdsFor()` + `getBlockedUserIdsFor()` separately, which queried the Block table twice per page load for logged-in users. Other pages that only need one set still use the individual functions.
- MapPoints query: added `take: 200` limit (was unlimited — serialized all opted-in sellers into the RSC payload). Added `user: { banned: false }` filter.

### Neon connection pooler
Documented in `prisma/schema.prisma`. `DATABASE_URL` should use Neon's pooled endpoint (`-pooler` suffix in hostname) for runtime. `DIRECT_URL` uses the direct endpoint for migrations (PgBouncer doesn't support DDL). Both configured in `prisma.config.ts`. Switch `DATABASE_URL` in Vercel env vars to the pooler endpoint — zero code changes needed.

### Pagination audit (2026-04-21)
Safety caps added to 12 previously unbounded `findMany` queries. These prevent full-table scans at scale without requiring full pagination UI:

| Page | Query | Cap |
|---|---|---|
| `dashboard/inventory` | Seller's IN_STOCK listings | `take: 100` |
| `messages` | Conversations inbox | `take: 50` |
| `dashboard/blog` | Author's blog posts | `take: 50` |
| `account/following` | Followed sellers | `take: 50` |
| `account/commissions` | Buyer's commission requests | `take: 30` |
| `account/blocked` | Blocked users | `take: 50` |
| `admin/reports` | Open reports | `take: 50` |
| `admin/blog` | All posts + pending comments | `take: 50` + `take: 30` |
| `admin/verification` | 4 application/member queries | `take: 50` each |
| `seller/[id]` profile | All seller listings | `take: 100` |
| `dashboard` | Saved searches | `take: 20` |

Already paginated (no change needed): `dashboard/sales` (PAGE_SIZE=25), `dashboard/notifications` (PAGE_SIZE=20), `dashboard/orders` (take:20), `admin/audit` (perPage), `admin/broadcasts` (pageSize), `account/saved` (PAGE_SIZE=24), `account/orders` (PAGE_SIZE=20), `browse` (paginated), `seller/shop` (paginated), `blog` (paginated), `admin/cases` (paginated), `admin/orders` (paginated), `admin/users` (paginated), `account/feed` (cursor-based).

Real pagination (PAGE_SIZE + Prev/Next) should be added per page as row counts grow past the safety caps.

### UTC timestamp fixes (2026-04-21)
5 server-side `toLocaleString()` calls replaced with `LocalDate` client component (renders in buyer/seller's local timezone instead of Vercel's UTC):
- `dashboard/sales/[orderId]` — order date, case message timestamps, pickup time
- `dashboard/sales` — order list date
- `checkout/success` — receipt date
- `dashboard/notifications` — notification timestamps

### Other fixes (2026-04-21)
- `checkout/success`: wrapped `stripe.checkout.sessions.retrieve` in try/catch — invalid/expired session_id redirects to `/cart` instead of showing error page
- Both checkout routes: `NEXT_PUBLIC_APP_URL` fallback to `"https://thegrainline.com"` (prevents `undefined/checkout/success` URL on missing env var)

### Remaining Batch 2 items (not yet done)
- Fix `getSellerRatingMap` N+1 on homepage (single JOIN like browse page)
- Parallelize featured maker + seller ratings + logged-in user data queries

## Remaining Security Gaps

| Gap | Status |
|---|---|
| CSP enforcement | ✅ Enforced (2026-04-02) — `clerk.thegrainline.com` added to `script-src-elem`, header switched to `Content-Security-Policy` |
| Stripe `account.updated` / `deauthorized` | ✅ Complete — handlers added to webhook |
| Geo-blocking | ✅ Complete — US only via Vercel edge geo |
| Notification preferences | ✅ Complete — `/account/settings` with toggles |
| Zod input validation | ✅ Complete — all request-body API routes |
| CSRF audit | ✅ Complete — documented in `src/lib/security.ts` |
| Redis rate limit failover | ✅ Complete — `safeRateLimit` / `safeRateLimitOpen` wrappers |
| Cloudflare WAF free tier active (DDoS protection) | Pro WAF ($20/mo) deferred until revenue justifies |
| `X-Powered-By` header removal | ✅ Complete (2026-04-03) — `poweredByHeader: false` in `next.config.ts` |
| OWASP ZAP scan | ✅ Complete (2026-04-03) — 0 high, 0 medium findings; 2 low (missing `Permissions-Policy` on API routes — headers already set globally) |
| Neon database password rotation | ✅ Complete (2026-04-18) — rotated in Neon dashboard, `DATABASE_URL` + `DIRECT_URL` updated in Vercel (all environments) and local `.env` |
| `.env.save` / `.env.production` cleanup | ✅ Deleted (2026-04-18) — contained live secrets. Both were gitignored but sitting unencrypted on disk. |
| `SHIPPING_RATE_SECRET` in Preview | ✅ Complete (2026-04-18) — added via Vercel dashboard. Preview deploys can now run checkout flows. |
| Apple Pay domain registration | ✅ Complete (2026-04-18) — `thegrainline.com` added to Stripe Payment method domains |
| `www` redirect | ✅ Complete (2026-04-18) — 308 permanent redirect `www.thegrainline.com` → `thegrainline.com` in Vercel. SSL provisioned. |

### Security Maintenance Rules

**NEVER put secrets in CLAUDE.md or any tracked file.** This includes passwords, API keys, tokens, DSNs, connection strings, and secret values — even old/rotated ones. Referencing env var *names* (e.g. `SHIPPING_RATE_SECRET`) is fine; referencing their *values* is not. If a secret needs to be documented, write `[REDACTED]` and describe where to find it (e.g. "in Vercel env vars" or "in Neon dashboard"). This rule applies to all Claude Code output — never echo, log, grep for, or display credential values in conversation responses.

**Set-and-forget infrastructure** (already done — do not touch unless there's a breach):
- Upstash Redis rate limiters — `safeRateLimit` (fail-closed, used for mutations) vs `safeRateLimitOpen` (fail-open, used for analytics)
- Clerk security settings: bot protection, disposable email blocking, email subaddress blocking, strict enumeration protection, lockout policy
- `chargesEnabled` filter on all public listing queries — prevents ghost sellers
- Stripe `account.updated` and `account.application.deauthorized` webhook handlers

**Checklist for every new API route:**
1. Is it public? If no → add `auth()` as the first check, return 401 before any DB access
2. Add it to `isPublic` in `middleware.ts` only if truly auth-free
3. If it mutates state → add a rate limiter from `src/lib/ratelimit.ts` using `safeRateLimit` (all mutation routes now have rate limits)
4. If it accepts a request body → add a Zod schema at the top of the file
5. If it's public and mutates state → document why it's CSRF-safe in `src/lib/security.ts`

**CSP update procedure** (when adding a new third-party):
1. Add the domain to `next.config.ts` `securityHeaders` in the relevant directive
2. Deploy in report-only mode first; check Sentry for new violations
3. Once clean, enforce by changing `Content-Security-Policy-Report-Only` → `Content-Security-Policy`

**npm audit cadence**: Run `npm audit` after every major dependency upgrade. Fix moderate/high vulnerabilities unless they are in transitive deps with no available fix (document the reason in a comment). Do NOT run `npm audit fix --force`.

## Production Deployment

- **Live at**: [thegrainline.com](https://thegrainline.com) — deployed to Vercel, DNS via Cloudflare
- **Next.js** 16.2.4 (upgraded from 16.2.1 — CVE-2025-55182 + GHSA-q4gf-8mx6-v5v3)
- **Clerk** v7.2.3 (upgraded from 7.0.7 — GHSA-vqx2-fgx2-5wq9 middleware bypass fix)
- **Stripe SDK** 19.3 (explicit `apiVersion` removed — uses SDK default)
- **Prisma** 7.7.0 (upgraded from 7.6.0 via Dependabot)
- **React** 19.2.5, **@sentry/nextjs** 10.49, **maplibre-gl** 5.23, **resend** 6.12
- **All ESLint/build errors fixed** — zero `any` types, all `<a>` → `<Link>`, unescaped entities fixed, unused imports removed
- **Stripe webhook** fully working in test mode — root cause of prior failure was webhook registered in live mode while app uses test keys (`sk_test_`); fixed by importing the webhook destination into test mode via Stripe Workbench. All notifications confirmed working: NEW_ORDER, NEW_FAVORITE, NEW_MESSAGE, NEW_REVIEW, LOW_STOCK, ORDER_DELIVERED. Webhook handler updated to handle Workbench Snapshot thin-event format (detects thin payload by key count ≤ 3, retrieves full event via `stripe.events.retrieve`).
- **⚠️ Live mode webhook still needed** — when switching to live mode (after Stripe identity verification clears), register a new webhook destination in Stripe Dashboard → **Live mode** → Developers → Webhooks → `https://thegrainline.com/api/stripe/webhook`, then update `STRIPE_WEBHOOK_SECRET` in Vercel with the live mode signing secret.
- **Stripe identity verification** submitted (2–3 business day review window as of 2026-03-27)
- **Clerk user sync webhook** built (`src/app/api/clerk/webhook/route.ts`); needs `CLERK_WEBHOOK_SECRET` in Vercel + endpoint registered in Clerk dashboard (see Clerk User Sync Webhook section)
- **Email system** fully live — Resend domain verified for thegrainline.com (auto-configure), `RESEND_API_KEY` + `EMAIL_FROM` added to Vercel, DMARC record added to Cloudflare DNS. Buyer and seller order confirmation emails confirmed working. Spam deliverability being addressed via DMARC + domain reputation warmup.

## Auth & Middleware

Clerk v7 handles auth. Public routes (no login required): `/`, `/browse`, `/listing/*`, `/seller/*`, `/sellers/*`, `/map/*`, `/blog/*`, `/sign-in`, `/sign-up`, `/api/whoami`, `/api/me`, `/api/reviews`, `/api/blog/*`, `/api/search/*`, `/api/stripe/webhook` (called by Stripe servers — no Clerk session), `/api/clerk/webhook` (called by Clerk servers — no Clerk session), `/api/uploadthing` (UploadThing callback). Protected routes (auth required): `/account`, `/account/orders`, `/dashboard/*`, `/cart`, `/checkout/*`, `/messages/*`, `/orders/*`. Everything else requires authentication.

**Clerk v7 component API** — `SignedIn`/`SignedOut` no longer exist; use `<Show when="signed-in">` / `<Show when="signed-out">` from `@clerk/nextjs`. The `fallback` prop on `Show` replaces paired `SignedOut` blocks. `afterSignOutUrl` is set on `<ClerkProvider>`, not `<UserButton>`. Any component using `useSearchParams()` must be inside a `<Suspense>` boundary.

Helper utilities:
- `src/lib/ensureUser.ts` — resolves Clerk session to a DB User
- `src/lib/ensureSeller.ts` — resolves Clerk session to a DB SellerProfile

## Payments

Stripe Connect is used so sellers receive payouts directly. Stripe webhook handler is at `src/app/api/stripe/webhook/route.ts`. The `stripe` client lives in `src/lib/stripe.ts`.

**Platform fee: 5%** of item subtotal (excluding shipping and taxes), applied as `application_fee_amount` in all four checkout routes. Note: shipping cannot be included in fee because `application_fee_amount` is fixed at session creation and shipping amount depends on buyer's selection during checkout.

**CHECKOUT REBUILD — Phase 1 complete**: User model now has `shippingName`, `shippingLine1`, `shippingLine2`, `shippingCity`, `shippingState`, `shippingPostalCode`, `shippingPhone` fields (migration: `add_user_shipping_address`). `GET /api/account/shipping-address` returns saved address. `PUT /api/account/shipping-address` saves address (Zod validated: 2-letter state, 5-digit zip, sanitized text). Both routes auth-required, rate-limited via `shippingAddressRatelimit` (30/10min per userId).

**CHECKOUT REBUILD — Phase 2 complete**: `ShippingAddressForm` component at `src/components/ShippingAddressForm.tsx`. Loads saved address from `GET /api/account/shipping-address` on mount (signed-in users). 50-state `<select>` dropdown. Client-side field validation with inline error messages. "Save this address" checkbox (default on, signed-in only) — calls `PUT /api/account/shipping-address` best-effort on submit. Loading skeleton while fetching. Calls `onConfirm(address)` on valid submit.

**CHECKOUT REBUILD — Phase 3 complete**: `ShippingRateSelector` component at `src/components/ShippingRateSelector.tsx`. Fetches rates from `POST /api/shipping/quote` on mount for a given `sellerId` + `ShippingAddress`. Auto-selects cheapest rate. Renders selectable rate rows (radio button style, amber highlight on selected). Falls back to `FALLBACK_RATE` (`objectId="fallback"`) on error — non-blocking, parent handles gracefully. `src/types/checkout.ts` updated with `FALLBACK_RATE` constant and `isFallbackRate()` helper.

**CHECKOUT REBUILD — Phase 4 complete**: Cart page restructured into 3 steps: review → address (`ShippingAddressForm`) → payment (existing per-seller checkout buttons, pre-filled with confirmed address). Step indicator breadcrumb on all steps. URL state via `router.replace(?step=)` — browser back button exits cart (intentional; use in-page Back/Change buttons). Mount-time URL restoration with empty dep array (mount only, eslint-disable). Safety guard redirects to address if payment reached without address. `destBySeller` pre-filled in `onConfirm` callback — all 5 fields (`useCalculated: true`, `postal`, `state`, `city`, `country`) for all cart sellerIds. `renderSellerSections(showCheckoutButtons)` helper extracts shared seller section JSX — Step 1 shows items without checkout buttons, Step 3 shows items with checkout buttons + address summary header. Gift notes render inside per-seller sections on both steps. Existing checkout flow preserved end-to-end. Phase 5 next: update checkout-seller + single routes to accept selectedRate + return clientSecret; add ShippingRateSelector to Step 3; replace per-seller buttons with embedded checkout; set explicit transfer_data.amount + on_behalf_of.

**`on_behalf_of` REMOVED** (2026-04-15): was causing tax to flow to seller instead of platform. Removed from all 4 routes. Platform absorbs Stripe processing fees (~2.9% + 30¢) — covered by the 5% platform fee.

**Product tax code**: `txcd_99999999` (General - Tangible Personal Property) set on all product line items + gift wrapping. Was defaulting to `txcd_10000000` (Electronically Supplied Services — wrong for physical handmade goods).

**CHECKOUT REBUILD — Phase 5 complete** (2026-04-16):
- `checkout-seller` route rewritten: new payload schema (`shippingAddress` + `selectedRate` objects), `ui_mode: "embedded"`, returns `clientSecret`, explicit `transfer_data.amount` excludes tax (items + shipping + giftwrap - 5% fee), `on_behalf_of` intentionally deferred (fee allocation decision pending Terms update), `automatic_tax` with `liability: { type: "self" }`
- `shipping_address_collection` removed from checkout-seller — address collected in cart UI
- Webhook: `reverseTaxIfNeeded` removed (no longer needed — explicit `transfer_data.amount` retains tax on platform automatically). Address now read from session metadata with fallback to Stripe fields for legacy sessions. Per-seller cart cleanup added AFTER `$transaction` (non-fatal).
- CSP updated: `checkout.stripe.com` added to `frame-src` and `connect-src` (required for embedded checkout iframe)
- Quote route: falls back to cart lookup by `userId` when `cartId` absent; now returns Shippo `objectId` per rate
- `ShippingRateSelector`: real `objectId` preferred, `AbortController` on fetch, `useCallback` removed
- `EmbeddedCheckoutPanel` component created (`src/components/EmbeddedCheckoutPanel.tsx`)
- Cart page: 4-step flow (review/address/shipping/payment), `destBySeller` removed, `selectedRates` + `clientSecrets` state added, `sessionStorage` backup for payment step, multi-seller sequential payment via embedded checkout
- `/api/cart/checkout/single` NOT updated (Phase 6 — `BuyNowButton.tsx` still calls it with old payload)
- New Order fields: `quotedToName String?`, `quotedToPhone String?` (migration: `add_order_quoted_to_name_phone`)
- Historical fields retained: `taxReversalId`, `taxReversalAmountCents` (no longer written)
- ENV required: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- Post-deploy fixes: `checkoutRatelimit` rate limiter restored; Sentry capture in catch block; `setSelectedRates({})` on "Change" button in Step 3; `redirect_on_completion: "if_required"` so `onComplete` fires for card payments; `onComplete` extracts session ID from last client secret (`split("_secret_")[0]`) and redirects to `/checkout/success?session_id=...`
- **Success page now distinguishes embedded vs hosted checkout** via `taxRetainedAtCreation` metadata flag (`"true"` on all Phase 5 embedded sessions). **Embedded sessions**: single re-query for webhook-created order; friendly "Payment successful! 🎉 Your order is being processed and will appear in your orders momentarily." fallback with "View my orders" + "Keep shopping" buttons if webhook hasn't fired yet; **NO fallback `order.create`** (webhook is the authoritative order creator for embedded flow, and racing it causes P2002 unique-constraint errors on `stripeSessionId`). **Hosted sessions** (legacy Buy Now / `/api/checkout`): existing fallback order creation preserved with P2002 try/catch so webhook race still resolves to the webhook-created order. Final behavior: (1) order found on first query → full receipt in both flows; (2) embedded + found on second query → full receipt; (3) embedded + still not found → "Payment successful" message; (4) hosted + not found → fallback create with P2002 catch → full receipt.
- **Fixed shipping receipt display** — success page and Stripe webhook both now use `s.shipping_cost?.amount_subtotal` (pre-tax) instead of `amount_total` when writing `Order.shippingAmountCents`. `amount_total` includes tax on shipping which is already counted in the tax line, causing the receipt to double-count shipping tax.
- **Fixed order timestamp display** — new `src/components/LocalDate.tsx` (`"use client"`) renders `new Date(date).toLocaleString()` on the client so buyer's browser timezone is used. Server components (like `/dashboard/orders` and `/dashboard/orders/[id]`) otherwise run `toLocaleString()` in the server's timezone (UTC on Vercel), displaying stale/wrong times. Applied to order createdAt, pickupReadyAt, and case message timestamps.
- Phase 6 next: Buy Now modal + checkout/single update

**CHECKOUT REBUILD — Phase 6 complete** (2026-04-16):
- `BuyNowCheckoutModal` (`src/components/BuyNowCheckoutModal.tsx`): new 3-step modal (Address → Shipping → Payment) reusing `ShippingAddressForm`, `ShippingRateSelector`, `EmbeddedCheckoutPanel`, `GiftNoteSection`. Sign-in gate on button click (redirects to `/sign-in?redirect_url=`). Payment state resets on close (address + rate preserved for quick re-open; `clientSecret` nulled because Stripe session expires). Escape key + backdrop click close handlers. Order summary shows items + shipping; tax shown as "Calculated at payment".
- `BuyNowButton` (`src/components/BuyNowButton.tsx`): thin wrapper — click opens modal via `useState`; uses `useUser()` from Clerk for sign-in check. Old inline ZIP/state form removed entirely. New required props: `listingTitle`, `listingImageUrl`, `sellerName`, `sellerId`, `priceCents`; optional `quantity`, `offersGiftWrapping`, `giftWrappingPriceCents`.
- `/api/cart/checkout/single` rewritten: new Zod payload (`shippingAddress` + `selectedRate` nested objects matching cart route), `ui_mode: "embedded"`, `redirect_on_completion: "if_required"`, explicit `transfer_data.amount = itemsSubtotal + shipping + giftWrap − 5% platformFee` (excludes tax — platform retains tax), returns `{ clientSecret }`. `taxRetainedAtCreation: "true"` metadata flag set. Sentry import added. Preserves rate limiter, `chargesEnabled` pre-flight guard, `statement_descriptor_suffix` derivation. Removed `shipping_address_collection`, `billing_address_collection`, `application_fee_amount`, `success_url`/`cancel_url`, old Shippo re-quote logic, old `to*` Zod fields. Fallback rate: if buyer picks `isFallbackRate(selectedRate)` (objectId `"fallback"`), reads `SiteConfig.fallbackShippingCents` (default $15) for the transfer calculation.
- `ShippingRateSelector`: added `quoteBodyExtra?: Record<string, string>` prop for single-item mode (Buy Now passes `{ mode: "single", listingId }`). `quoteBodyStr = JSON.stringify(…)` stable dep for `useEffect`. Cart call site unchanged (omits prop → default cart behavior preserved).
- Legacy routes deleted: `src/app/api/checkout/route.ts` (entire directory removed) and `src/app/api/cart/checkout/route.ts`. Zero UI callers confirmed before deletion. Preserved: `/api/cart/checkout/single` (Buy Now) and `/api/cart/checkout-seller` (cart).
- Webhook: no change needed — both paths (cart + listingId) already write `quotedToName` and `quotedToPhone` from Phase 5.
- Quote route: no change needed — single-mode branch already returns `objectId` per rate (Phase 5 unified mapping).
- Listing page (`src/app/listing/[id]/page.tsx`): only call site updated with new props; no Prisma query change (seller fields already fully included via `seller: { include: { user: true } }`).
- Phase 7 deferred: `on_behalf_of` (Terms update needed), Apple Pay domain registration, billing address prefill (Stripe Customer objects).

**Security fixes post-Phase 6** (2026-04-16):
- `checkout/single` reads gift wrap price from `listing.seller.giftWrappingPriceCents` (server-side), no longer accepts client input for this field. `giftWrappingPriceCents` removed from `CheckoutSingleSchema` and from `BuyNowCheckoutModal` fetch body. Prevents buyer from paying $0 gift wrap while seller's real price is charged downstream.
- Listing status/privacy guards added to `checkout/single`: rejects with 400 if `listing.status !== "ACTIVE"` (blocks DRAFT, SOLD, SOLD_OUT, HIDDEN, PENDING_REVIEW, REJECTED); rejects with 400 if `listing.isPrivate && listing.reservedForUserId !== me.id` (blocks direct-POST purchase of custom/reserved listings). Note: `Listing.soldAt` and `isPublished` fields do not exist in the schema — `status === "SOLD"` is covered by the ACTIVE-only check.
- `BuyNowButton`: `isLoaded` gate (`useUser()` → `{ isSignedIn, isLoaded }`) with `disabled={!isLoaded}` on the button element. Prevents Clerk hydration race where `isSignedIn` is briefly `undefined` and signed-in users get redirected to `/sign-in` if they click immediately on page load.

**Phase 6.5 — HMAC-signed shipping rate tokens + security parity** (2026-04-16):
- `src/lib/shipping-token.ts`: `signRate()` + `verifyRate()` using HMAC-SHA256. `timingSafeEqual` for comparison (not `===`, which is a timing-attack footgun). Expiry checked BEFORE HMAC compute. Canonical field-ordered input string `${objectId}:${amountCents}:${displayName}:${carrier}:${estDays}:${contextId}:${buyerPostal}:${expiresAt}` (no `JSON.stringify` — key ordering not guaranteed stable across refactors). 30-min TTL. Fails loud if `SHIPPING_RATE_SECRET` is missing.
- `/api/shipping/quote`: signs each rate with `contextId` (sellerId for cart, listingId for buy-now) and `buyerPostal`. **`toPostal` is now required** (tightened Zod from `.optional().nullable()` to `.min(1).max(20)`) — the "10001" NYC default was removed because it would cause every signature to mismatch at checkout verification. Rate response adds `token` + `expiresAt` fields.
- `src/types/checkout.ts`: `SelectedShippingRate` gains `token: string` + `expiresAt: number`. `FALLBACK_RATE` updated with `token: "fallback"` + `expiresAt: 0` (intentionally invalid HMAC; bypassed via `isFallbackRate()` before `verifyRate()` is called).
- Both checkout routes (`/api/cart/checkout-seller` and `/api/cart/checkout/single`): `verifyRate()` called after Zod parsing and before Stripe session creation. Fallback rates bypass verification via `isFallbackRate()` and use `SiteConfig.fallbackShippingCents` instead of the client-provided amount. `contextId` is `body.sellerId` in checkout-seller and `body.listingId` in checkout/single (concrete `const`, NOT `??` fallback — TypeScript catches misuse).
- **Security parity for `checkout-seller`**: the same gift-wrap, status, and isPrivate fixes that were applied to checkout/single are now applied here. Server-side gift wrap price from `sellerItems[0].listing.seller.giftWrappingPriceCents` (client input removed from Zod). `offersGiftWrapping` guard (400 reject). `status !== "ACTIVE"` guard per cart item (blocks DRAFT, SOLD, SOLD_OUT, HIDDEN, PENDING_REVIEW, REJECTED). `isPrivate && reservedForUserId !== me.id` guard per cart item.
- **`checkout/single`**: `offersGiftWrapping` guard added (400 reject). `offersGiftWrapping` added to seller select.
- `ShippingRateSelector`: `QuoteRate` type gains optional `token`/`expiresAt`. `toSelectedRate` uses `r.token ?? ""` (NOT `?? "fallback"`) — unsigned rates fail HMAC verification loudly with 400, rather than silently downgrading to `SiteConfig.fallbackShippingCents` via `isFallbackRate()` match. Failure is a surfaced bug, not a silent price change.
- **ENV**: `SHIPPING_RATE_SECRET` (server-only, 64 hex chars). Set in Vercel Production and Development. Preview requires manual dashboard setup (CLI required git-branch scoping). Secret rotation invalidates all outstanding tokens; in-flight buyers see "Shipping rates have expired" error (30-min max impact window). `.env.example` committed with placeholder (gitignore exception added: `!.env.example`).
- Status codes: 422 "Unprocessable Entity" for expired tokens (semantically correct), 400 for tampered/invalid tokens.

**Statement descriptor suffix**: all 4 routes add `statement_descriptor_suffix` from seller displayName (uppercase, alphanumeric, max 22 chars). Conditional spread — skipped if empty to prevent checkout breakage. Shows seller name on buyer's card statement to reduce chargebacks.

**Pre-flight chargesEnabled guard** (added 2026-04-15): all four checkout routes verify `seller.chargesEnabled && seller.stripeAccountId` BEFORE calling `stripe.checkout.sessions.create()`. Returns 400 "seller not accepting orders" if incomplete.

All four checkout routes:
- `src/app/api/checkout/route.ts` — legacy single item
- `src/app/api/cart/checkout/route.ts` — cart (single-seller enforced)
- `src/app/api/cart/checkout-seller/route.ts` — per-seller cart split
- `src/app/api/cart/checkout/single/route.ts` — single item from cart (buy-now)

Terms page (`/terms`) reflects 5% in sections 4.5 and 6.2.

**Automatic tax**: `automatic_tax: { enabled: true }` on all four routes. Tax stays with platform per Stripe marketplace facilitator default (no explicit `transfer_data.amount` — Stripe auto-excludes tax from seller transfer).

**chargesEnabled enforcement** (audited 2026-04-15): all paths that can make a listing public check `seller.chargesEnabled`:
- `publishListingAction` (shop) — returns error
- `createListing` (new listing) — redirects to error
- Edit re-review (`dashboard/listings/[id]/edit`) — reverts listing to DRAFT if seller lost chargesEnabled
- Photo add re-review (`api/listings/[id]/photos`) — same DRAFT revert
- All four checkout routes — pre-flight guard returns 400

### Seller Location & Map Opt-In (complete — 2026-04-03)
- **`SellerLocationSection.tsx`** — `"use client"` component; fully controlled checkbox state; wraps `LocationPicker` + `publicMapOptIn` checkbox
- **Privacy**: sellers with radius > 0 show approximate circle on seller/listing pages; cannot appear on makers map — checkbox force-unchecked and disabled with amber warning when `miles > 0`
- **Server action** enforces `radiusMeters = 0` when `publicMapOptIn = true` (unchanged at lines 53–58 of `dashboard/seller/page.tsx`)
- `dashboard/seller/page.tsx`: `LocationPicker` + inline checkbox replaced with `<SellerLocationSection>`

### Stripe Connect Dashboard Access (complete — 2026-04-01)
- **`POST /api/stripe/connect/login-link`** — seller auth required; calls `stripe.accounts.createLoginLink(stripeAccountId)`; returns `{ url }` for one-time Express dashboard link; opens in new tab
- **`StripeLoginButton`** (`src/app/dashboard/seller/StripeLoginButton.tsx`) — `"use client"`; renders "Go to Stripe Dashboard →" button when `hasStripeAccount=true`; handles loading/error states
- **`StripeConnectButton`** (`src/app/dashboard/seller/StripeConnectButton.tsx`) — `"use client"`; calls `POST /api/stripe/connect/create` with `returnUrl: "/dashboard/seller"`; works for sellers who skipped Stripe during onboarding; replaces static `<a href="/dashboard/onboarding">` link
- **"Payouts & Banking" section** on `/dashboard/seller`: three-state logic using both `chargesEnabled` and `stripeAccountId`: (1) both present → "✓ Stripe Connected" + `StripeLoginButton` + draft prompt; (2) `stripeAccountId` present but `chargesEnabled` false → "⚠ Stripe setup incomplete" + `StripeConnectButton` to resume; (3) neither → "Connect Stripe" + `StripeConnectButton` to start. `chargesEnabled` is the source of truth for full connection — `stripeAccountId` alone is insufficient (`stripeAccountId` is set when onboarding starts; `chargesEnabled` only becomes true when Stripe webhook confirms the account on `account.updated`)
- **Draft prompt** shown in fully-connected state when `draftCount > 0` — amber card with count and link to `/dashboard/inventory`
- **`/dashboard/seller` page title** changed from "Seller Profile" → "Shop Settings"

### Listing Visibility Rules (complete — 2026-04-02)
- **Listing detail page** (`/listing/[id]`) — returns 404 for non-connected sellers (`!listing.seller.chargesEnabled`) unless the viewer is the seller themselves (checked via `listing.seller.user?.clerkId === userId`)
- **Preview bypass** (`?preview=1`) — if `preview=1` AND the authenticated user is the listing's own seller (`listing.seller.user?.clerkId === userId`), all visibility/chargesEnabled/block checks are skipped and the listing renders normally regardless of status. An amber banner reads "Preview mode — this is how your listing appears to buyers. It is not yet published." Dashboard shows "Preview →" link for DRAFT/HIDDEN/PENDING_REVIEW listings opening in a new tab.
- **`generateMetadata`** returns `robots: { index: false, follow: false }` for non-connected seller listings — prevents Google from indexing them
- **All public surfaces filter `chargesEnabled: true`**: browse, homepage, similar items, search suggestions (Prisma + raw SQL), sitemap — listings from non-connected sellers are completely private to the seller only

Cart checkout supports multi-seller orders (splits into separate Stripe sessions per seller) and single-item buy-now.

## Shipping

Shippo integration (`src/lib/shippo.ts`) provides live rate quotes and label generation. Sellers can configure flat-rate or calculated shipping. Package dimensions are stored per listing and per seller profile (defaults). Packing logic is in `src/lib/packing.ts`.

`shippoRatesMultiPiece` returns `{ shipmentId, rates[] }`. Each rate includes `objectId` (the Shippo rate object ID). Both checkout routes (`checkout-seller` and `checkout/single`) pass `shipmentId` through Stripe session metadata and embed each rate's `objectId` in `shipping_rate_data.metadata`. The Stripe webhook reads these back and writes `shippoShipmentId` and `shippoRateObjectId` to the `Order` record, enabling label purchase later without re-quoting.

When Shippo returns no usable rates, `checkout/single` falls back to `SiteConfig.fallbackShippingCents` (default $15.00). The `checkout-seller` route falls back to the seller's flat-rate / pickup options.

## Maps (Maplibre GL)

All maps use Maplibre GL JS v5 with OpenFreeMap tiles (free, no API key, OpenStreetMap data). Migration from Leaflet complete 2026-04-03.

### Components
- `MaplibreMap.tsx` — single pin display map; `LeafletMap.tsx` re-exports it for backward compat
- `SellersMap.tsx` — multiple seller pins with popups
- `AllSellersMap.tsx` — full map with built-in GeoJSON clustering (no plugin needed)
- `MakersMapSection.tsx` — wrapper with geolocation button; wraps `AllSellersMap`
- `MapCard.tsx` — single pin or radius circle; privacy jitter via seeded PRNG preserved verbatim; accepts `className` prop
- `LocationPicker.tsx` — interactive draggable marker + address search via Nominatim

### Tile Provider
OpenFreeMap: `https://tiles.openfreemap.org/styles/liberty`
Free, no API key, no usage limits, OSM data

### Attribution
Maplibre automatically shows © OpenStreetMap contributors bottom-right. Legally required, cannot be removed.

### Key implementation notes
- `getClusterExpansionZoom`: Promise-based (v5 API) — use async/await NOT callback style
- `clusterId` cast: `features[0].properties?.cluster_id as number`
- `LocationPicker`: `map.panTo()` in both click and dragend handlers so viewport follows marker
- `LocationPicker` `drawCircle`: takes map as explicit parameter to avoid TypeScript closure narrowing
- `LocationPicker` radius circle: `map.once("idle", () => drawCircle(map))` fallback if style not yet loaded
- `LocationPicker`: accepts `onMilesChange?: (miles: number) => void` — fires on range slider change
- `LocationPicker`: marker hidden (`display: none`) when `meters > 0` — circle replaces pin for privacy
- `MapCard`: `scrollZoom.disable()` + `NavigationControl` — pannable/zoomable, no scroll hijack
- `MapCard`: `className` prop with default `"h-48 w-full rounded-xl border overflow-hidden"`
- `MapCard` jitter: `xmur3`/`mulberry32`/`seededRand`/`jitterAround` copied verbatim from Leaflet version
- `AllSellersMap`: unclustered sellers rendered as `Marker` pins; rebuilt on `sourcedata` + `moveend` (NOT render loop); deduplication via `Set<string>` to handle tile boundary duplicates; cleanup removes all markers before `map.remove()`
- `MakersMapSection`: `AllSellersMap` container wrapped in `rounded-2xl overflow-hidden`
- Maplibre popup global CSS in `globals.css`: `border-radius: 10px`, `padding: 12px 14px`, `box-shadow`, `font-family: inherit`
- Makers map queries (`/page.tsx` homepage + `/map/page.tsx`) require `chargesEnabled: true` — sellers without Stripe connected do not appear on the map even if they opted in

### Migration from Leaflet
Removed: `leaflet`, `react-leaflet`, `@types/leaflet`
Added: `maplibre-gl`
Clustering: native GeoJSON source `cluster: true` — no `leaflet.markercluster` plugin needed
Radius circles: GeoJSON Polygon 64-point approximation
CSP: removed `unpkg.com` from both `script-src-elem` and `connect-src`; added `https://tiles.openfreemap.org` to `connect-src`

## File Uploads (Cloudflare R2)

Files upload directly from browser to Cloudflare R2 via presigned URLs — no server bottleneck, zero egress fees. UploadThing (`uploadthing`, `@uploadthing/react`) removed as of 2026-04-02.

### Architecture
- `POST /api/upload/presign` — auth required; Zod-validates type/size/count; returns presigned PUT URL + public URL; generates key: `{endpoint}/{userId}/{timestamp}-{random}.{ext}`
- Browser PUTs file directly to R2 using the presigned URL
- `src/lib/r2.ts` — R2 S3-compatible client (`@aws-sdk/client-s3`)
- `src/hooks/useR2Upload.ts` — upload hook; uploads files sequentially; returns `UploadedFile[]` with both `url` and `ufsUrl` fields (`ufsUrl` is alias for `url` — backward compat with 13 consumer components that access `file.ufsUrl`)
- `src/components/R2UploadButton.tsx` — drop-in `UploadButton` replacement; handles `content.button` as ReactNode or render function `({ ready }) => ReactNode`; accepts `onUploadProgress`, `appearance.allowedContent` for backward compat
- `src/utils/uploadthing.ts` — re-exports R2 equivalents under old UploadThing names; 11 of 13 consumers needed zero changes
- `src/components/ReviewPhotosPicker.tsx` — updated to use `useR2Upload` directly (old `useUploadThing` positional-arg signature incompatible)

### Endpoints
| Endpoint | Max size | Max count |
|---|---|---|
| `listingImage` | 8MB | 8 |
| `messageImage` | 8MB | 6 |
| `messageFile` (PDF) | 8MB | 4 |
| `messageAny` | 8MB | 6 |
| `reviewPhoto` | 8MB | 6 |
| `listingVideo` | 128MB | 1 |
| `bannerImage` | 4MB | 1 |
| `galleryImage` | 4MB | 10 |

### R2 CORS Policy
Must be set in Cloudflare R2 bucket settings → CORS Policy:
```json
[{ "AllowedOrigins": ["https://thegrainline.com", "http://localhost:3000"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["Content-Type", "Content-Length"], "MaxAgeSeconds": 3600 }]
```

### Environment Variables
`CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET_NAME`, `CLOUDFLARE_R2_PUBLIC_URL`

### Database migration (one-time, after deploy)
```
npx dotenv-cli -e .env.local -- npx ts-node --transpile-only scripts/migrate-uploadthing-to-r2.ts
```
Clears UploadThing URLs from: seller profile images, listing photos, review photos, blog post covers, commission reference images. Does NOT touch `User.imageUrl` (Clerk avatar URLs).

## npm audit status (2026-04-02)

All UploadThing-related vulnerabilities resolved — `uploadthing` and `@uploadthing/react` removed. `npm audit` reports 0 vulnerabilities.

## Prisma 7 Migration (complete — 2026-03-31)

Upgraded from Prisma 6.16.2 → 7.6.0. Zero TypeScript errors; zero build errors.

### Breaking changes in Prisma 7

`url` and `directUrl` properties are no longer supported in the `datasource` block of `schema.prisma`. Database connection is now split:
- **Migrations/introspection**: defined in `prisma.config.ts` via `defineConfig({ datasource: { url } })`
- **Runtime client**: passed via a `@prisma/adapter-pg` driver adapter to `new PrismaClient({ adapter })`

### Files changed

**`prisma/schema.prisma`** — removed `url` and `directUrl` from datasource:
```prisma
datasource db {
  provider = "postgresql"
}
```

**`prisma.config.ts`** (new) — migration/introspection URL (uses `DIRECT_URL` for direct connection, falls back to `DATABASE_URL`):
```ts
import { defineConfig } from "prisma/config"
export default defineConfig({
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
})
```

**`src/lib/db.ts`** — now creates a `PrismaPg` adapter with the pooled `DATABASE_URL` and passes it to `PrismaClient`:
```ts
import { PrismaPg } from "@prisma/adapter-pg"
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
export const prisma = new PrismaClient({ adapter, log: [...] })
```

**New package**: `@prisma/adapter-pg` + `pg` + `@types/pg` added to dependencies.

### No query API changes
`findUnique`, `findFirst`, `findMany` and all other query methods behave identically in Prisma 7. The 347 query call sites needed no changes.

## CI/CD

**CI pipeline**: GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `main` and every PR:
1. `npm ci` (clean install)
2. `npx prisma generate` (required before tsc — Prisma 7.7 client generation)
3. `npx tsc --noEmit` (type check — blocks PR on failure)
4. `npm audit` (informational, `continue-on-error: true` — does not block)

**Dependabot** (`.github/dependabot.yml`): weekly PRs every Monday for npm minor/patch updates. Major version bumps are ignored (require manual review). Minor/patch updates are grouped into a single PR. Limit: 10 open PRs.

**Deployment**: `npx vercel --prod` from the CLI. For schema migrations: always run `npx dotenv-cli -e .env -- npx prisma migrate deploy` BEFORE `vercel --prod`.

## Commands

```bash
npm run dev        # Start dev server
npm run build      # Production build (runs prisma generate first)
npm run lint       # ESLint
npx prisma migrate dev   # Apply a new migration (uses prisma.config.ts for DB URL)
npx prisma studio        # Open Prisma Studio
```

## Homepage Visual Updates (2026-04-03)

### Amber warmth pass
Full amber color pass on `src/app/page.tsx`:
- Hero gradient: `from-amber-100 via-amber-50 to-stone-50` (richer amber start)
- Stats bar: `bg-amber-50` with `text-amber-300` separator dots
- Map section: `bg-amber-50/40`
- Category tiles: `bg-amber-50 border-amber-100 text-amber-700`
- Browse-all tile: `bg-amber-50/50 border-amber-200`
- Meet a Maker section: `bg-amber-50/60 border border-amber-100`
- Main content area wrapped in `bg-gradient-to-b from-amber-50/20 via-white to-white`

Also applied amber gradient to browse (`src/app/browse/page.tsx`) and listing detail (`src/app/listing/[id]/page.tsx`) pages: `bg-gradient-to-b from-amber-100/60 via-amber-50/30 to-white min-h-screen` on both `<main>` elements.

### Hero photo mosaic (merged to main — 2026-04-03)

**New component**: `src/components/HeroMosaic.tsx` — `"use client"` dual-row infinite scroll background mosaic:
- Row 1 scrolls left (`animate-scroll-left`), Row 2 scrolls right (`animate-scroll-right`)
- Photos duplicated for seamless CSS loop (`[...row1Base, ...row1Base]` at `width: 200%`)
- `blur-[4px] scale-105` on each photo for soft background effect
- `gap-px` between photos (no visible gap)
- **Overlay layers** (z-order from bottom up):
  1. Light warm amber overlay: `from-amber-900/20 via-amber-800/10 to-amber-900/20` (z-10)
  2. Top fade (h-32): `from-white/50 to-transparent` — blends into header (z-20)
  3. Bottom fade (h-24): `from-[#F7F5F0]/60 to-transparent` — blends into stats bar (z-20)
- Photos rendered as `tabIndex={-1} aria-hidden="true"` links (decorative, not navigable)

**CSS animations** added to `src/app/globals.css`:
```css
@keyframes scroll-left  { 0% { transform: translateX(0); }    100% { transform: translateX(-50%); } }
@keyframes scroll-right { 0% { transform: translateX(-50%); } 100% { transform: translateX(0); } }
.animate-scroll-left  { animation: scroll-left  40s linear infinite; }
.animate-scroll-right { animation: scroll-right 40s linear infinite; }
```

**Homepage data fetch** (`src/app/page.tsx`): 7th `Promise.all` query fetches 16 most recent ACTIVE non-private listings (`orderBy: { createdAt: "desc" }`), selecting `id` + first photo `url`. CDN URLs filtered (`cdn.thegrainline.com` only). Threshold: ≥12 real photos required to activate mosaic; falls back to amber gradient below that.

**Adaptive hero**: when mosaic active, hero section is `bg-[#1C1C1A]` (espresso), `min-h-[60vh]` (shorter than before — removed `min-h-screen`); h1, p, tags, and CTAs switch to white/glass variants. The "Browse the Workshop" CTA uses white text on dark background; "Find Makers Near You" becomes a white-bordered ghost button.

**Glass `SearchBar` variant**: `SearchBar` accepts `variant?: "default" | "glass"` prop. Glass variant: `bg-white/15 backdrop-blur-sm border-white/40`, white text + placeholder, submit button `bg-white/20`. Passed as `<SearchBar variant={mosaicPhotos.length >= 12 ? "glass" : "default"} />` in hero.

**Header**: `bg-white` → `bg-gradient-to-b from-amber-50 to-white` for subtle warmth on all pages.

## Bad Word Filter (complete — 2026-04-21)

`src/lib/profanity.ts` — simple word-list profanity filter using whole-word `\b` regex boundaries. Prevents false positives like "class" matching "ass" or "passionate" matching "ass".

- **`containsProfanity(text)`** — returns `{ flagged: boolean; matches: string[] }`
- **Log-only** — does not block submissions; logs `console.error("[PROFANITY] ...")` with matched words
- **Word list**: common profanity, slurs (racial, homophobic, ableist), sexual terms, harassment phrases ("kill yourself", "kys")
- **Applied to 4 routes** (after Zod parse, before DB create):
  1. `POST /api/reviews` — checks `comment` text
  2. `POST /api/blog/[slug]/comments` — checks `body` text
  3. `POST /api/commission` — checks `title + description`
  4. `POST /api/reviews/[id]/reply` — checks seller reply text

## Seller Preferred Carriers (complete — 2026-04-21)

Sellers can restrict shipping quotes to specific carriers.

### Schema
- **`SellerProfile.preferredCarriers String[] @default([])`** — list of preferred carrier names (e.g. `["UPS", "USPS"]`); empty = show all carriers
- Migration: `20260421232433_add_preferred_carriers`

### Seller settings UI (`/dashboard/seller`)
- "Preferred carriers" checkbox group (UPS, USPS, FedEx, DHL) added below the "Use calculated shipping" toggle in the Shipping & Tax section
- Helper text: "Only show rates from selected carriers. Leave all unchecked to show all available carriers."
- Server action reads `formData.getAll("preferredCarriers")` and saves to profile

### Quote route filtering (`POST /api/shipping/quote`)
- `preferredCarriers` added to seller select in both cart and single mode queries
- Carrier filter applied to raw Shippo rates BEFORE the `.map()` that signs them (before HMAC signing, so filtered rates never get signed unnecessarily)
- Uses case-insensitive `.includes()` matching (e.g. "usps" matches "USPS" in carrier name)
- Local pickup option always passes through regardless of carrier preferences

## Reporting & Admin Email (2026-04-21)

### Report buttons on reviews and blog comments
- **Reviews** — `BlockReportButton` added to each review in `ReviewsSection.tsx` with `targetType: "REVIEW"`. Gated on `meId !== reviewer.id` (can't report your own review). Positioned after the date.
- **Blog comments** — `BlockReportButton` added to top-level comments in `blog/[slug]/page.tsx` and L2/L3 replies in `BlogReplyToggle.tsx` with `targetType: "BLOG_COMMENT"`. `BlogReplyToggle` accepts new `meId` prop.
- **Report labels** — `BlockReportButton` now shows "Report this review" and "Report this comment" for the new target types.
- **Admin reports** — batch-resolves `REVIEW` → `listingId` and `BLOG_COMMENT` → post `slug` for contextual links ("View listing" / "View post") in the admin reports queue.

### Reporting coverage (complete)
| Surface | targetType | Component |
|---|---|---|
| Seller profiles | `SELLER` | `BlockReportButton` on `/seller/[id]` |
| Listings | `LISTING` | `BlockReportButton` on `/listing/[id]` |
| Message threads | `MESSAGE_THREAD` | `BlockReportButton` in `/messages/[id]` |
| Reviews | `REVIEW` | `BlockReportButton` in `ReviewsSection` |
| Blog comments | `BLOG_COMMENT` | `BlockReportButton` in blog detail + `BlogReplyToggle` |

### Admin email to any user
- **`AdminEmailForm`** — accepts optional `defaultTo` (pre-fills email) and `defaultOpen` (auto-expands) props. Renders a "To" email input when no `userId` is provided.
- **Admin email API** — Zod schema now accepts `userId` OR `email` (refined: at least one required). Handles both lookup paths.
- **Admin users page** — "Email" link per user row navigates to `?email=user@example.com`. Standalone `AdminEmailForm` renders at the top of the page when the email param is present, auto-opened with pre-filled recipient.

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
