# Grainline

A woodworking marketplace built with Next.js, similar to Etsy/Amazon but focused on woodworking makers and their products. Sellers can list items, appear as pins on a local map, and receive payments via Stripe Connect.

## Tech Stack

- **Framework**: Next.js 16.2.1 (App Router), React 19, TypeScript
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

- **User** — authenticated account (linked to Clerk user ID); `role`: `USER | EMPLOYEE | ADMIN` (used for admin panel access control)
- **SellerProfile** — seller info, location (lat/lng for map), Stripe Connect account, shipping config; `onboardingStep Int @default(0)`, `onboardingComplete Boolean @default(false)` track wizard progress
- **Listing** — product for sale; status: `DRAFT | ACTIVE | SOLD | SOLD_OUT | HIDDEN`; `listingType`: `MADE_TO_ORDER | IN_STOCK`; includes `processingTimeMinDays`, `processingTimeMaxDays` (MADE_TO_ORDER only), `stockQuantity Int?` and `shipsWithinDays Int?` (IN_STOCK only); `isReadyToShip` fully removed. Also has `category Category?`, `viewCount Int @default(0)`, `clickCount Int @default(0)`. Stock is decremented at checkout (Stripe webhook) and restored on case refund resolution. Custom order fields: `isPrivate Boolean @default(false)`, `reservedForUserId String?` (back-relation `reservedForUser User? @relation("ReservedListings")`), `customOrderConversationId String?`.
- **Order** — purchase transaction with Stripe refs, shipping/tax amounts, fulfillment tracking, quoted address snapshot (`quotedTo*` fields), mismatch detection flag (`reviewNeeded`), Shippo label fields, `estimatedDeliveryDate`, and `processingDeadline` (see below)
- **OrderItem** — line items in an order
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

`Category` enum: `FURNITURE | KITCHEN | DECOR | TOOLS | TOYS | JEWELRY | ART | OUTDOOR | STORAGE | OTHER` — display labels in `src/lib/categories.ts` (`CATEGORY_LABELS`, `CATEGORY_VALUES`). **Always use `CATEGORY_VALUES.includes(raw)` to validate — never `Object.values(Category)` which crashes in RSC if Prisma enum is undefined at runtime.**

`ListingStatus` enum: `DRAFT | ACTIVE | SOLD | SOLD_OUT | HIDDEN`

`ListingType` enum: `MADE_TO_ORDER | IN_STOCK`

`LabelStatus` enum: `PURCHASED | EXPIRED | VOIDED`

`CaseReason` enum: `NOT_RECEIVED | NOT_AS_DESCRIBED | DAMAGED | WRONG_ITEM | OTHER`

`CaseStatus` enum: `OPEN | IN_DISCUSSION | PENDING_CLOSE | UNDER_REVIEW | RESOLVED | CLOSED`

`CaseResolution` enum: `REFUND_FULL | REFUND_PARTIAL | DISMISSED`

`NotificationType` enum (18 values): `NEW_MESSAGE | NEW_ORDER | ORDER_SHIPPED | ORDER_DELIVERED | CASE_OPENED | CASE_MESSAGE | CASE_RESOLVED | CUSTOM_ORDER_REQUEST | CUSTOM_ORDER_LINK | VERIFICATION_APPROVED | VERIFICATION_REJECTED | BACK_IN_STOCK | NEW_REVIEW | LOW_STOCK | NEW_FAVORITE | NEW_BLOG_COMMENT | BLOG_COMMENT_REPLY | NEW_FOLLOWER`

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
- Issues Stripe refund; for FULL also reverses the seller's transfer (non-fatal)
- Restores stock for IN_STOCK items on FULL refund
- Atomically resolves any open case as REFUND_FULL or REFUND_PARTIAL
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
- **ClickTracker** (`src/components/ClickTracker.tsx`) — "use client" `<li>` wrapper that fires `POST /api/listings/[id]/click` on click (fire-and-forget)
- **SaveSearchButton** (`src/components/SaveSearchButton.tsx`) — "use client", reads `useSearchParams`, POSTs to `/api/search/saved`; redirects to sign-in if not logged in
- **FilterSidebar** (`src/components/FilterSidebar.tsx`) — "use client", reads `useSearchParams`, uses `key={searchParams.toString()}` form trick for `defaultValue` sync

### Search suggestions / autocomplete

`GET /api/search/suggestions?q=` returns up to 8 deduplicated suggestions from 4 parallel queries:
1. Listing title substring matches (ILIKE)
2. Tag partial matches via `unnest(tags) ILIKE` (raw SQL, requires `pg_trgm` extension enabled)
3. Seller displayName matches
4. Fuzzy title matches via `similarity(title, q) > 0.25` (pg_trgm)

Plus category label matches from `CATEGORY_VALUES`.

`SearchBar` (`src/components/SearchBar.tsx`) — "use client" header component with 300ms debounce, dropdown, Escape/click-outside dismiss, `onMouseDown + e.preventDefault()` on suggestion buttons to avoid blur-before-click race.

### Analytics fields

- `viewCount` — incremented by `POST /api/listings/[id]/view` (24h `httpOnly` cookie deduplication). `ListingViewTracker` ("use client") fires this on mount from listing detail pages.
- `clickCount` — incremented by `POST /api/listings/[id]/click` (same cookie pattern). `ClickTracker` fires this on card click in browse.

### Saved Searches

`SavedSearch` model stores `userId`, `query`, `category`, `minPrice`, `maxPrice`, `tags[]`. API: `POST/GET/DELETE /api/search/saved`. Dashboard (`/dashboard`) shows a "Saved Searches" section with browse link and delete button per entry.

## SEO (complete)

- **`metadataBase`** set to `https://grainline.co` in `src/app/layout.tsx`
- **Root metadata** (`layout.tsx`): full title template (`%s | Grainline`), description, keywords, OG (type, siteName, title, description, `/og-image.jpg` 1200×630), Twitter card
- **`generateMetadata`** on `listing/[id]`, `seller/[id]`, and `browse` pages — title, description, OG image, Twitter card; listing page also sets `other: { product:price:amount, product:price:currency }`
- **Canonical URLs** — `alternates: { canonical }` on listing, seller, and browse `generateMetadata` (browse varies by `q` / `category` / default)
- **JSON-LD** on listing pages: `Product` schema (name, description, images, sku, brand, offers with seller name, aggregateRating when reviews exist) + `BreadcrumbList` (Home → Category → Listing, or Home → Listing if no category)
- **LocalBusiness JSON-LD** on seller pages: name, description, url, `knowsAbout: "Handmade Woodworking"`, PostalAddress (city/state), GeoCoordinates (only when lat/lng set)
- **Sitemap** (`src/app/sitemap.ts`): homepage `priority: 1.0` daily, browse `0.9` daily, active listings `0.8` weekly with `updatedAt`, seller profiles `0.6` monthly with `updatedAt`; private routes excluded
- **robots.txt** (`src/app/robots.txt/route.ts`): allows all crawlers; disallows `/dashboard`, `/admin`, `/cart`, `/checkout`, `/api`; `Sitemap: https://grainline.co/sitemap.xml`
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
5. **Meet a Maker spotlight** — queries `isVerifiedMaker = true` first; falls back to most-reviewed seller via raw SQL join; `ScrollSection` fade-in
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
- **Guild Member** — `LaurelWreathIcon`: amber/gold two-branch wreath SVG (40×44 viewBox, ellipse leaves, ribbon tie, star dot at top)
- **Guild Master** — `HammerChiselIcon`: indigo crossed hammer + chisel SVG (40×40 viewBox)
- **Popup**: `createPortal`-based — renders at `document.body` to avoid `overflow:hidden` clipping; positioned below the badge button using `getBoundingClientRect()` + scroll offsets, clamped to viewport width; closes on outside click or Escape; "Learn more about Guild Verification →" link to `/terms#guild-verification-program`
- `showLabel={false}` → icon only (used on listing cards); `showLabel={true}` → icon + label text (used on profile/detail pages)
- `GuildLevelValue` type exported from the file

### Badge placement with props
| Surface | `showLabel` | `size` |
|---|---|---|
| Browse GridCard + ListCard seller chip | `false` | `16` |
| Homepage Fresh + Favorites cards | `false` | `16` |
| `SimilarItems` seller chip | `false` | `16` |
| Listing detail seller section | `true` | `18` |
| Seller profile header | `true` | `20` |
| Seller shop header | `true` | `20` |
| Dashboard verification page (section headers) | `false` | `20` |

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

**Still unbuilt (separate from Phases 1–3):**
- Seller analytics dashboard — reuses `SellerMetrics` model, no schema changes needed
- Monogram stamp picker (Phase 1 cosmetic): `guildStampStyle String?` on `SellerProfile`; 4 styles (serif/block/script/ornate); unique wax-seal stamp per Guild Master using shop initials + chosen style

## Similar Items (complete)

- **`GET /api/listings/[id]/similar`** — fetches current listing's category, tags, priceCents; queries up to 8 ACTIVE non-private listings within 50% price range; orders by tag-overlap count via `unnest(tags)` raw SQL; returns up to 6 results with photo, seller name, seller avatar. Two raw SQL paths (with/without category), falls back to Prisma category query if <3 tag-overlap results found.
- **`SimilarItems`** (`src/components/SimilarItems.tsx`) — `"use client"` component; fetches on mount; 3-col grid with skeleton loading state (3 animated placeholder cards); hides section entirely if 0 results returned
- **Listing detail page** — `<SimilarItems listingId={id} />` added before the reviews section

## Blog System (complete)

### Schema
- **`BlogPost`** — `slug` (unique), `title`, `body`, `excerpt?`, `coverImageUrl?`, `videoUrl?`, `authorId` → `User @relation("BlogPostsAuthored")`, `authorType BlogAuthorType` (`STAFF | MAKER`), `sellerProfileId?` → `SellerProfile` (for Maker posts), `type BlogPostType` (`STANDARD | MAKER_SPOTLIGHT | BEHIND_THE_BUILD | GIFT_GUIDE | WOOD_EDUCATION`), `status BlogPostStatus` (`DRAFT | PUBLISHED | ARCHIVED`), `featuredListingIds String[]`, `tags String[]`, `metaDescription?`, `readingTimeMinutes?`, `publishedAt?`; back-relation `comments BlogComment[]`
- **`BlogComment`** — `postId` → `BlogPost` (cascade), `authorId` → `User @relation("BlogCommentsAuthored")`, `body`, `approved Boolean @default(false)` (moderation required before appearing)
- **`NewsletterSubscriber`** — `email` (unique), `name?`, `subscribedAt`, `active Boolean`
- Back-relations: `User.blogPosts`, `User.blogComments`, `SellerProfile.blogPosts`; migration `20260327215946_add_blog_system`

### Utilities (`src/lib/blog.ts`)
- `generateSlug(title)` — lowercase, spaces→hyphens, strip special chars
- `calculateReadingTime(body)` — word count ÷ 200, minimum 1
- `BLOG_TYPE_LABELS` — human-readable labels per `BlogPostType`
- `BLOG_TYPE_COLORS` — Tailwind badge color classes per type

### APIs
- `POST /api/newsletter` — upserts `NewsletterSubscriber`, no auth required
- `GET /api/blog` — paginated published posts, filterable by `type` and `tag`
- `GET /api/blog/[slug]/comments` — approved comments only
- `POST /api/blog/[slug]/comments` — auth required; creates comment with `approved: false`

### Components
- **`NewsletterSignup`** — client component; email + optional name; success state "You're on the list! 🎉"; client-side email format validation
- **`BlogCopyLinkButton`** — Web Share API with clipboard copy fallback
- **`BlogCommentForm`** — post comment with moderation notice, success state
- **`BlogPostForm`** — full create/edit form: title + slug preview, type select (staff: all types; makers: STANDARD + BEHIND_THE_BUILD only), UploadThing cover image upload, video URL, markdown body textarea with cheat sheet link, excerpt (200 char counter), meta description (160 char counter), comma-separated tags, featured listing checkboxes, status select

### Public pages
- **`/blog`** — gradient hero, type filter tab strip, featured post (large card, first result page 1 only), 12-per-page grid with cover image/badge/excerpt/author/date, pagination, `NewsletterSignup` at bottom; `generateMetadata`
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

`src/components/icons/index.tsx` — 55 named Feather-style outline SVG icon components. All icons accept `className?: string` and `size?: number` (default 20) props. Base SVG attrs: `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={1.5}`, `strokeLinecap="round"`.

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

**Used in:**
- `Header.tsx` — `MessageCircle` (signed-out messages link), `ShoppingBag` (cart)
- `seller/[id]/page.tsx` — `Instagram`, `Facebook`, `Pinterest`, `TikTok`, `Globe` replacing inline filled SVG paths
- `admin/layout.tsx` — `AlertTriangle` (Flagged Orders, Cases), `Package` (All Orders), `Shield` (Verification), `Edit` (Blog)
- `dashboard/page.tsx` — `Store` (Create listing), `User` (Shop Profile), `Package` (Shipping & Settings, My Orders), `Tag` (My Sales), `Grid` (Inventory), `MessageCircle` (Messages), `Edit` (My Blog), `Bell` (Notifications), `Sparkles` (Verified Maker badge)

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
- **`NotificationBell`** (`src/components/NotificationBell.tsx`) — `"use client"`; polls `GET /api/notifications` every 30s; shows `Bell` icon with red badge for unread count; dropdown list of recent notifications with title, body, timestamp, and link; "Mark all read" button; accepts `initialUnreadCount` prop (SSR hint)
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

`src/lib/email.ts` — 16 email functions with a sharp-edged HTML template (off-white `#FAFAF8` background, no `border-radius` anywhere, dark `#1C1C1A` header bar with Grainline wordmark, warm gray `#3D3D3A` body text, footer with unsubscribe link). `RESEND_API_KEY` guard: logs a warning and skips send if env var is missing — never crashes the app.

### Email functions

**Transactional:** `sendOrderConfirmedBuyer`, `sendOrderConfirmedSeller`, `sendOrderShipped`, `sendReadyForPickup`, `sendCaseOpened`, `sendCaseMessage`, `sendCaseResolved`, `sendCustomOrderRequest`, `sendCustomOrderReady`, `sendBackInStock`, `sendVerificationApproved`, `sendVerificationRejected`, `sendRefundIssued`

**Lifecycle:** `sendWelcomeBuyer`, `sendWelcomeSeller`, `sendFirstListingCongrats`, `sendFirstSaleCongrats`

### Wiring (14 locations, all wrapped in `try/catch`)

| File | Email(s) |
|---|---|
| `api/stripe/webhook/route.ts` | `sendOrderConfirmedBuyer`, `sendOrderConfirmedSeller`, `sendFirstSaleCongrats` (if seller order count = 1) |
| `api/orders/[id]/fulfillment/route.ts` | `sendOrderShipped` (action=shipped), `sendReadyForPickup` (action=ready_for_pickup) |
| `api/cases/route.ts` | `sendCaseOpened` |
| `api/cases/[id]/messages/route.ts` | `sendCaseMessage` to the other party |
| `api/cases/[id]/resolve/route.ts` | `sendCaseResolved` |
| `api/messages/custom-order-request/route.ts` | `sendCustomOrderRequest` |
| `dashboard/listings/custom/page.tsx` | `sendCustomOrderReady` |
| `api/listings/[id]/stock/route.ts` | `sendBackInStock` per subscriber |
| `admin/verification/page.tsx` | `sendVerificationApproved` / `sendVerificationRejected` |
| `api/orders/[id]/refund/route.ts` | `sendRefundIssued` |
| `api/clerk/webhook/route.ts` | `sendWelcomeBuyer` (user.created); `sendWelcomeSeller` if seller profile exists |
| `dashboard/listings/new/page.tsx` | `sendFirstListingCongrats` if listing count = 1 |

**Emails are live once `RESEND_API_KEY` + `EMAIL_FROM` env vars are set and the sending domain is verified in Resend.**

## Clerk User Sync Webhook (complete)

`src/app/api/clerk/webhook/route.ts` — verifies svix signature, handles `user.created` and `user.updated` events, upserts `User` record via `ensureUserByClerkId`, sends `sendWelcomeBuyer` on `user.created`. Route added to public matcher in `src/middleware.ts`.

**Deployment steps still required:**
1. Add `CLERK_WEBHOOK_SECRET` to Vercel environment variables
2. Clerk Dashboard → **Production** → Developers → Webhooks → Add Endpoint → `https://thegrainline.com/api/clerk/webhook` → events: `user.created`, `user.updated` → copy Signing Secret → paste as `CLERK_WEBHOOK_SECRET`

## Mobile Audit Round 2 (complete)

Second mobile fix pass (2026-03-29). Zero TypeScript errors.

### FilterSidebar (`src/components/FilterSidebar.tsx`)
- **Apply button fixed** — removed `onClick={() => setMobileOpen(false)}` from the submit button; the premature state update was unmounting the form before the browser could process the `method="get"` submission. Sheet now closes via the existing `searchParams` useEffect when the URL updates after navigation.
- Reset link's `onClick` also removed for the same reason.

### Header (`src/components/Header.tsx`)
- **Logo tap target** — added `flex items-center min-h-[44px]` to the logo `<Link>` for a proper 44px touch target on mobile.
- **Messages drawer row fixed** — the "Messages" text span was not navigable (only the `MessageIconLink` icon was a link). Restructured: `MessageIconLink` (icon + unread badge) stays as the icon, a sibling `<Link href="/messages">` covers the text label. Both elements are now independently navigable.

### Notifications API (`src/app/api/notifications/route.ts`)
- **Auto-cleanup** — on every `GET /api/notifications`, fire-and-forget `deleteMany` removes `read: true` notifications older than 90 days for the requesting user. Only read notifications are pruned; unread are never deleted.

### Dashboard listings (`src/app/dashboard/page.tsx`)
- "My Listings" section: `flex overflow-x-auto snap-x snap-mandatory` on mobile → `sm:grid sm:grid-cols-2 lg:grid-cols-3` on desktop. Each card gets `min-w-[220px] flex-none snap-start sm:min-w-0`.

### Seller profile (`src/app/seller/[id]/page.tsx`)
- **Featured Work**, **All Listings**, and **From the Workshop** (blog posts) sections all converted to the same pattern: horizontal scroll row on mobile (`flex overflow-x-auto snap-x snap-mandatory pb-4`), grid on tablet/desktop (`sm:grid` or `md:grid`). Min-width per card: 200–220px.

### Message interface
- **`src/components/MessageComposer.tsx`** — outer container changed to `sticky bottom-0 bg-white border-t` with `[padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]` for iPhone home-bar clearance. Send button: icon-only on mobile (paper-plane SVG), text label on `sm+`.
- **`src/components/ThreadMessages.tsx`** — message bubble max-width changed to `max-w-[85%] sm:max-w-[70%]`. Added `pb-4` to inner `<ul>`.
- **`src/app/messages/[id]/page.tsx`** — reduced padding: `p-4 sm:p-8`, `space-y-4 sm:space-y-6`.
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

- **`public/logo.svg`** — real vector wordmark logo from designer; transparent background, cream fill `#F2E6D8`; used in header and footer with `style={{ filter: 'brightness(0)' }}` to render as pure black on white background
- **`public/logo-mark.svg`** — grain lines swoosh mark only (4 curved fanning paths, `fill="currentColor"`); for use in Guild Master wax seal badge and other compact branding contexts
- **Header** (`src/components/Header.tsx`): desktop logo `h-7`, mobile logo `h-6`, hamburger drawer logo `h-6` — all `<img src='/logo.svg' alt='Grainline' style={{ filter: 'brightness(0)' }}`
- **Footer** (`src/app/layout.tsx`): `h-5` logo centered above Terms/Privacy links with `opacity: 0.4`

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

## Legal Pages (complete)

`/terms` and `/privacy` — both server components, publicly accessible (added to middleware public matcher), linked in site footer (`src/app/layout.tsx`). Both display a red **DRAFT — Under Attorney Review** banner. Both have a Table of Contents with anchor links and are mobile responsive / print-friendly.

### Terms of Service (`/terms`) — 21 sections

Key sections beyond boilerplate:
- **Section 4** (Maker Terms) — 18 subsections including: listing accuracy with no-guarantee-of-authenticity clause (4.4), listing removal rights (4.16), off-platform transaction prohibition (4.17), product liability (4.18), gift wrapping, independent contractor status, custom orders, response/shipping requirements
- **Section 6.4** — Marketplace facilitator sales tax: Texas Tax Code §151.0242 + all-states compliance; written certification to Makers that Grainline collects/remits on their behalf; 1099-K disclosure; Stripe Tax
- **Section 8** — Returns/refunds rewritten with 8.1–8.6 including seller-initiated refunds and "Grainline is not the seller" disclaimer
- **Section 9** — Case System rewritten with 30-day window, 48h seller response, $10k escalation note, binding arbitration cross-reference
- **Section 10** — Prohibited Activities: 24 items including fake accounts/bots for metric manipulation, coordinated rating inflation, off-platform solicitation, false product safety info
- **Section 13** — Disclaimers: 13.1 As-Is, 13.2 No Warranty for Listings, 13.3 No Warranty of Authenticity (all-caps), 13.4 Limitation of Liability (12-month fees / $100 cap)
- **Section 15** — Texas governing law, AAA binding arbitration, class action waiver, 30-day opt-out
- **Section 19** — Guild Verification Program: Guild Member + Guild Master badges, FTC disclosure, revocation policy
- **Section 20** — Force Majeure
- **Section 21** — Accessibility (WCAG 2.1 AA)

### Privacy Policy (`/privacy`) — 13 sections

Key sections:
- **Section 2** — 11 subsections: account, profile, transaction, communications, usage, device, location (EXIF stripping disclosed), photo metadata, newsletter, cookies, third-party data
- **Section 4** — Sharing: Stripe, Clerk, Shippo, Resend, UploadThing, Sentry; tax authority sharing (marketplace facilitator); buyer-maker data restrictions; no sale/sharing for ads
- **Section 6** — Retention schedule: account (active + 30d), transactions (7yr), sales tax records (4yr per Texas Comptroller), 1099-K (7yr), messages (3yr), notifications (90d read)
- **Section 7** — Rights: universal rights + 7.2 California CCPA/CPRA, 7.3 Texas TDPSA (appeal right, 45-day response), 7.4 EU/EEA/UK GDPR (legal basis: contract + legitimate interests + consent; SCCs for US transfers)

## UptimeRobot Monitoring (complete)

UptimeRobot configured to ping thegrainline.com every 5 minutes. Alerts on downtime.

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
- Engagement stats (Listing Views, Conversion) are **range-aware** — uses `ListingViewDaily.aggregate` with `date: { gte, lte }`; CTR and Clicks cards removed from UI
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

**B — Engagement (8 stat cards)**: Listing Views (range-aware, from `ListingViewDaily`, subtitle "updates daily"), Conversion Rate (orders÷listing views, range-aware), Profile Visits (all-time from `profileViews`), Cart Abandoned (range-aware — items added but not purchased in same period), Saved/Favorites, Watching (stock notification subscribers), Repeat Buyer Rate (all-time), Avg Processing Time (order created → shipped). Note: Clicks and CTR cards removed. Chart views populate going forward only — no historical data before `ListingViewDaily` was added.

**C — Performance Chart**: SVG line chart (inline, no external lib); 9 time range pill selectors (Today / Yesterday / This week / Last 7 days / This month / Last 30 days / This year / Last 365 days / All time); metric selector tabs (Revenue / Orders / Views); colors: amber=revenue, indigo=orders, teal=views; area fill (10% opacity); dots shown for ≤20 points; invisible hit-target rects for >20 points; Y-axis uses `getYTicks(maxVal)` — no duplicates, whole numbers only, returns `[]` when maxVal=0; X-axis label thinning with rotation when >14 buckets; hover tooltip; "No data for this period" overlay when all values are zero

**D — Top Listings (top 8 by all-time revenue, showing 5)**: photo (80×80) + title + revenue/units row (no avg price) + engagement row (👁 views · 🖱 clicks · ♥ favorites · 🔔 watching · $/day)

**E — Guild Metrics**: range-independent metrics table (avg rating, on-time shipping, response rate, account age, open cases, completed sales); color-coded rates; Guild Master eligibility panel with human-readable failure descriptions

**F — Rating Over Time** (only shown if data exists): monthly list — `"Nov 2025: 4.8 ★ (3 reviews)"`

**G — Recent Sales**: last 10 paid orders table (date, item, buyer first name, amount, status badge); fetched from separate `/recent-sales` endpoint

### Dashboard + inventory listing stats
- **`/dashboard/page.tsx`** listings query: added `_count: { select: { favorites: true, stockNotifications: true } }` to include; each card shows `👁 X · 🖱 X · ♥ X · 🔔 X` below the status badge
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
- Returns `{ suggestions: Array<{ type: "post"|"tag"|"author", label, slug?, tag? }> }` up to 8 items

#### `BlogSearchBar` component (`src/components/BlogSearchBar.tsx`)
- `"use client"` — full-width search input with magnifying glass icon, 300ms debounce, dropdown with Post/Topic/Maker labels
- Clicking a post suggestion navigates to `/blog/[slug]`; tag → `/blog?tags=...`; author → `/blog?q=...`
- On submit: pushes `/blog?q=...&sort=relevant`; clear button when value non-empty

#### `/blog` page rewrite (`src/app/blog/page.tsx`)
- **searchParams**: now handles `q`, `type`, `tags` (comma-separated), `sort`, `page`
- `BlogSearchBar` rendered inside hero section
- **Sort tabs**: "Most Relevant" / "Newest" / "A–Z" shown only when `q` is active
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

### Commission Room Near Me crash
- Root cause: `$queryRaw` tagged template literal treats `${}` expressions as SQL parameters; the conditional `${categoryValid ? \`AND cr.category = '${categoryFilter}'\` : \`\`}` was being passed as a bound parameter value instead of raw SQL, causing a PostgreSQL syntax error
- Fix: rewrote both queries (data + count) using `$queryRawUnsafe` with positional parameters; added `LEAST(1.0, GREATEST(-1.0, ...))` clamping on `acos` arguments to prevent NaN

## Remaining Work

### Mobile audit round 3 (complete — deployed 2026-03-29)

All items done:
1. Search icon in mobile header → slide-down dropdown with transparent backdrop + `animate-slide-down`
2. `NotificationBell` added to mobile header (inside `<Show when="signed-in">`, `flex items-center` wrapper for vertical alignment)
3. Cart icon added to mobile header; cart row removed from hamburger drawer
4. Notifications link removed from hamburger drawer (bell now in header)
5. Bell vertical alignment fixed — `inline-flex items-center justify-center min-h-[44px] min-w-[44px]` wrapper
6. "Cart" text removed from desktop header — icon-only (badge preserved)
7. "Collectors" → "Buyers" rename in all user-facing copy (`page.tsx`, `sales/[orderId]/page.tsx`, `fulfillment/route.ts`)
8. "Browse all" categories tile confirmed correct — `href="/browse"` with no category param

### Infrastructure / legal

10. ~~**Terms of service page**~~ — complete, see "Legal Pages" section below
11. ~~**Privacy policy page**~~ — complete, see "Legal Pages" section below
12. **Clerk webhook production setup** — see "Deployment steps" in Clerk User Sync Webhook section above
13. **Stripe live mode webhook** — register in Stripe live mode after identity verification clears; update `STRIPE_WEBHOOK_SECRET` in Vercel

### Seller tools

14. ~~**Guild verification rebuild**~~ — Phases 1, 2, 3 complete (see Guild Verification Program section)
15. ~~**Seller analytics dashboard**~~ — complete, see "Seller Analytics Dashboard" section below
16. ~~**Vacation / workshop-closed mode**~~ — complete, see "Vacation Mode" section below
17. ~~**Seller onboarding flow**~~ — complete, see "Seller Onboarding Flow" section

### Discovery & community

18. ~~**Following system**~~ — complete, see "Following System" section below
19. ~~**Commission / wanted board**~~ — complete and live, see "Search Bar, Blog Search & Commission Room" section above
20. ~~**Blog subscriptions**~~ — complete: `FOLLOWED_MAKER_NEW_BLOG` notification sent when a followed maker publishes
21. **Blog search** — search within blog posts
22. ~~**Save / bookmark blog posts**~~ — complete, see "Following System" section below

### Platform

23. ~~**Rate limiting**~~ — complete (see Rate Limiting section; expanded 2026-03-31)
24. ~~**PWA setup**~~ — complete: manifest.json, icon-192.png, icon-512.png, offline page, metadata tags (see PWA section)

**TypeScript: zero `tsc --noEmit` errors** (all pre-existing errors resolved as of current codebase)

## Rate Limiting Expansion (complete — 2026-03-31)

Eight new Upstash Redis sliding-window limiters added to `src/lib/ratelimit.ts`:

| Limiter | Key | Limit | Applied to |
|---|---|---|---|
| `followRatelimit` | userId | 50 / 60 min | `POST/DELETE /api/follow/[sellerId]` |
| `saveRatelimit` | userId | 100 / 60 min | `POST /api/favorites` |
| `blogSaveRatelimit` | userId | 100 / 60 min | `POST/DELETE /api/blog/[slug]/save` |
| `commissionInterestRatelimit` | userId | 20 / 24 h | `POST /api/commission/[id]/interest` |
| `commissionCreateRatelimit` | userId | 5 / 24 h | `POST /api/commission` |
| `listingCreateRatelimit` | userId | 10 / 24 h | `createListing` server action |
| `profileViewRatelimit` | `${ip}:${listingId}` | 1 / 24 h | `POST /api/listings/[id]/view` (silent drop — no error returned) |
| `broadcastRatelimit` | sellerId | 1 / 7 d | `POST /api/seller/broadcast` (in addition to DB 7-day check) |

## Anti-Spam Guards (complete — 2026-03-31)

Server-side abuse prevention beyond rate limiting:

- **Self-follow blocked** — was already present in `api/follow/[sellerId]/route.ts`
- **Duplicate commission interest blocked** — was already present in `api/commission/[id]/interest/route.ts`
- **Self-review blocked** — **added** to `api/reviews/route.ts`: returns 400 if `listing.seller.userId === me.id`
- **Commission self-interest + status check** — was already present
- **Self-messaging blocked** — was already present in `messages/new/page.tsx` and `api/messages/custom-order-request/route.ts`

### Input sanitization (`src/lib/sanitize.ts`)

Two utilities created:
- `sanitizeText(input)` — strips HTML tags, `javascript:` protocol, event handler attributes; used on short fields
- `sanitizeRichText(input)` — strips `<script>`, `<iframe>`, `javascript:`, event handlers; used on long-form content

Applied at the DB boundary in:
- `dashboard/listings/new/page.tsx` — title (`sanitizeText`), description (`sanitizeRichText`)
- `dashboard/listings/[id]/edit/page.tsx` — title (`sanitizeText`), description (`sanitizeRichText`)
- `dashboard/seller/page.tsx` — displayName, tagline (`sanitizeText`); bio (`sanitizeRichText`)
- `api/commission/route.ts` — title (`sanitizeText`), description (`sanitizeRichText`)
- `api/reviews/route.ts` — comment text (`sanitizeRichText`)
- `api/seller/broadcast/route.ts` — message (`sanitizeRichText`)

### UploadThing file validation
All endpoints already had `maxFileSize` and image type restrictions configured. No changes needed.

### Ownership checks audit
All critical ownership checks were already present:
- Edit listing: Prisma query filters by `seller.user.clerkId === userId` (implicit ownership)
- Commission PATCH: `buyerId !== me.id` check present
- Messages: `other.id === me.id` self-message guard present
- Delete listing: `seller.userId !== me.id` check present

## PWA Setup (complete — 2026-03-31)

- **`public/manifest.json`** — name, short_name, description, start_url, display: standalone, background_color `#FAFAF8`, theme_color `#1C1917`, shortcuts (Browse, My Account), categories (shopping, lifestyle)
- **`public/icon-192.png`** and **`public/icon-512.png`** — generated from `public/logo.svg` via `sharp`
- **`src/app/layout.tsx`** — added `manifest: '/manifest.json'`, `appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Grainline' }`, `formatDetection: { telephone: false }`, and a separate `viewport` export with `themeColor: '#1C1917'`
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

**CSP status**: `Content-Security-Policy-Report-Only` is now active (see "CSP Report-Only Mode" section below). A full `Content-Security-Policy` was added and immediately rolled back earlier because it broke Clerk UI components. The report-only header collects violations without blocking anything. See `src/app/api/csp-report/route.ts` for the violation endpoint wired to Sentry.

**`experimental.serverActions.bodySizeLimit`**: Added then removed — not needed and can break certain Next.js 16 build configurations.

## Security Hardening Round 2 (complete — 2026-03-31)

### Rate limit responses with retry timing
`src/lib/ratelimit.ts`: Added `rateLimitResponse(reset: number, customMessage?: string): Response` helper. Computes human-readable retry time from the Upstash `reset` timestamp (milliseconds): "a moment" / "N minutes" / "N hours" / "tomorrow at HH:MM AM". Returns 429 with `Retry-After` and `X-RateLimit-Reset` headers. All rate-limited routes updated to destructure `reset` from `ratelimit.limit()` and call `rateLimitResponse(reset, '...')`.

Routes updated: `api/follow/[sellerId]` (POST+DELETE), `api/blog/[slug]/save` (POST+DELETE), `api/commission/[id]/interest`, `api/commission`, `api/seller/broadcast`, `api/search/suggestions`, `api/reviews`, `api/cart/checkout`, `api/cart/checkout/single`, `api/favorites`. View/click routes remain silent (no error response).

### Listing creation rate limit
Increased from `slidingWindow(10, "24 h")` to `slidingWindow(20, "24 h")`.

### Stripe Connect required for public listings
Migration `20260331205748_charges_enabled`: `chargesEnabled Boolean @default(false)` added to `SellerProfile`.

`chargesEnabled` is set to `account.charges_enabled` in:
- `api/stripe/connect/create/route.ts` — on account retrieve/create
- `dashboard/onboarding/page.tsx` — on Stripe account status check

`chargesEnabled: true` added to seller `where` filters in: `browse/page.tsx`, `page.tsx` (Fresh + Favorites), `api/listings/[id]/similar/route.ts` (both raw SQL paths + Prisma fallback), `seller/[id]/shop/page.tsx`.

**Dashboard banner** — amber "Your listings are not visible to buyers yet / Connect Stripe →" shown in `dashboard/page.tsx` when `!sellerProfile.chargesEnabled`.

### PWA icons fix
`public/icon-192.png` and `public/icon-512.png` regenerated with `#1C1917` dark background and logo centered at 65% of icon size (visible on all backgrounds). `layout.tsx` updated to use `icons: { apple: "/icon-192.png" }`.

### Mobile notification bell fix
`NotificationBell.tsx`: dropdown now `right-0 max-w-[calc(100vw-1rem)] overflow-y-auto max-h-[80vh]` — no longer clipped on small screens.

### Analytics listing views subtitle
`dashboard/analytics/page.tsx`: Listing Views card now shows two-line subtitle: "times your listing page was opened" + smaller "each visitor counted once per day · updates daily".

### Raw SQL injection audit (all clear)
| File | Verdict |
|---|---|
| `api/seller/analytics/route.ts` | ✅ SAFE — all `$queryRaw` tagged templates |
| `api/listings/[id]/similar/route.ts` | ✅ SAFE — all `$queryRaw` tagged templates |
| `commission/page.tsx` | ✅ CONDITIONALLY SAFE — `$queryRawUnsafe` but `categoryFilter` validated via `CATEGORY_VALUES.includes()` before use |
| `api/blog/search/route.ts` | ✅ SAFE — all `$queryRaw` tagged templates |

### Numeric input validation
Added guards (throw Error in server actions, 400 in API routes) for:
- Price: must be ≥ $0, ≤ $100,000 — `listings/new`, `listings/[id]/edit`
- Stock quantity: must be ≥ 0 — `listings/new`, `listings/[id]/edit`
- Processing time: must be ≤ 365 days — `listings/new`, `listings/[id]/edit`
- Commission budget: must be ≥ $0, max ≥ min — `api/commission` POST

### Sentry security event tracking (`src/lib/security.ts`)
`logSecurityEvent(event, details)` logs breadcrumb for all events; captures Sentry event for `ownership_violation` and `spam_attempt`. Wired in:
- Self-follow attempt: `api/follow/[sellerId]` → `spam_attempt`
- Self-review attempt: `api/reviews` → `spam_attempt`
- Own-commission interest: `api/commission/[id]/interest` → `spam_attempt`

## chargesEnabled Backfill (hotfix — 2026-03-31)

The `chargesEnabled Boolean @default(false)` field added in the previous session caused all existing sellers to fail the new `chargesEnabled: true` filter, blanking the browse page and homepage listings.

**Root cause**: The field was new with a `false` default, so all pre-existing sellers (who had already connected Stripe before the field existed) had `chargesEnabled = false`.

**Fix (round 1)**: `scripts/backfill-charges-enabled.ts` — sets `chargesEnabled = true` for sellers with `stripeAccountId IS NOT NULL`. Updated 2 sellers.

**Fix (round 2)**: Browse still showed 0 listings — the 19 active listings all belonged to sellers without Stripe (dev/seed accounts). Updated backfill to set `chargesEnabled = true` for ALL existing sellers (`updateMany` with no `where` clause). 7 sellers updated. Going forward, only brand-new sellers created after this date need to connect Stripe to appear publicly.

**Going forward**: New sellers must complete Stripe Connect via `/api/stripe/connect/create` to get `chargesEnabled = true` set (that route calls `stripe.accounts.retrieve` and writes `account.charges_enabled`). The filter now correctly blocks sellers with no Stripe account from appearing publicly.

**Known gap**: The Stripe webhook does not handle `account.updated` events, so if a seller's Stripe account is later suspended, `chargesEnabled` won't auto-flip to `false`. Future improvement: add `account.updated` handler in `api/stripe/webhook/route.ts`.

## CSP Report-Only Mode (active — 2026-03-31)

`Content-Security-Policy-Report-Only` header is active in `next.config.ts`. Violations are logged but nothing is blocked. Once enough real-world traffic has been observed with no violations, change the header key to `Content-Security-Policy` to enforce it.

**Violation reporting**: `POST /api/csp-report` (`src/app/api/csp-report/route.ts`) — public route (in middleware `isPublic`); logs violations as Sentry breadcrumbs; captures Sentry events for `script` and `frame` directive violations; also logs to console in dev mode.

**Allowed external domains**: Clerk (`*.clerk.com`, `*.clerk.accounts.dev`), Stripe (`js.stripe.com`, `hooks.stripe.com`, `api.stripe.com`), UploadThing (`*.uploadthing.com`, `utfs.io`), Sentry (`*.sentry.io`, `*.ingest.sentry.io`), Upstash (`major-toad-67912.upstash.io`), OpenStreetMap (`nominatim.openstreetmap.org`, `*.tile.openstreetmap.org`).

**CSP maintenance**: When adding new third-party services, add their domains to the CSP value in `next.config.ts`. After observing zero violations in Sentry for 7+ days, switch to enforcement mode by renaming the header key to `Content-Security-Policy`. Do NOT add `unsafe-eval` to `script-src` in enforce mode without careful testing.

## Production Deployment

- **Live at**: [thegrainline.com](https://thegrainline.com) — deployed to Vercel, DNS via Cloudflare
- **Next.js upgraded** to 16.2.1 (security patch for CVE-2025-55182)
- **Clerk upgraded** to v7: `SignedIn`/`SignedOut` replaced with `<Show when="signed-in/out">` component; `afterSignOutUrl` moved from `<UserButton>` to `<ClerkProvider afterSignOutUrl="/">`; `<Header>` wrapped in `<Suspense>` in layout due to `useSearchParams()` requirement
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

Cart checkout supports multi-seller orders (splits into separate Stripe sessions per seller) and single-item buy-now.

## Shipping

Shippo integration (`src/lib/shippo.ts`) provides live rate quotes and label generation. Sellers can configure flat-rate or calculated shipping. Package dimensions are stored per listing and per seller profile (defaults). Packing logic is in `src/lib/packing.ts`.

`shippoRatesMultiPiece` returns `{ shipmentId, rates[] }`. Each rate includes `objectId` (the Shippo rate object ID). Both checkout routes (`checkout-seller` and `checkout/single`) pass `shipmentId` through Stripe session metadata and embed each rate's `objectId` in `shipping_rate_data.metadata`. The Stripe webhook reads these back and writes `shippoShipmentId` and `shippoRateObjectId` to the `Order` record, enabling label purchase later without re-quoting.

When Shippo returns no usable rates, `checkout/single` falls back to `SiteConfig.fallbackShippingCents` (default $15.00). The `checkout-seller` route falls back to the seller's flat-rate / pickup options.

## Maps

Leaflet is used for all map views. Sellers with a set location appear as pins on the map. Key components:
- `LeafletMap.tsx` — base map
- `SellersMap.tsx` / `AllSellersMap.tsx` — seller-pin overlays
- `LocationPicker.tsx` — lets sellers set their location
- `MakersMapSection.tsx` — homepage/browse map section

## File Uploads

UploadThing handles image (and video) uploads for listings and reviews. Config is in `src/app/api/uploadthing/`.

## Commands

```bash
npm run dev        # Start dev server
npm run build      # Production build
npm run lint       # ESLint
npx prisma migrate dev   # Apply a new migration
npx prisma studio        # Open Prisma Studio
```
