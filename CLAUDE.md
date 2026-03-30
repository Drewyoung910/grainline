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
  components/        # Reusable React components
  lib/               # Utility modules (db, stripe, shippo, email, etc.)
prisma/
  schema.prisma      # Database schema
  migrations/        # Migration history
```

## Key Data Models

- **User** — authenticated account (linked to Clerk user ID); `role`: `USER | EMPLOYEE | ADMIN` (used for admin panel access control)
- **SellerProfile** — seller info, location (lat/lng for map), Stripe Connect account, shipping config
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

## Verified Maker Badge System (complete)

- **`MakerVerification` model** — `VerificationStatus` enum (`PENDING | APPROVED | REJECTED`); seller can apply (or reapply after rejection) via upsert; migration `20260327212938_add_maker_verification`
- **Seller application** — `src/app/dashboard/verification/page.tsx`: three states: green "You are a Verified Maker ✓" banner (already verified), amber "under review" banner (PENDING), application form (not applied or REJECTED). Form fields: craft description (max 500), years of experience, portfolio URL, handmade confirmation checkbox. Server action upserts `MakerVerification` with `PENDING` status and resets review fields on reapply.
- **`POST /api/verification/apply`** — auth + `ensureSeller`; upserts record; returns created/updated record
- **Admin queue** — `src/app/admin/verification/page.tsx`: PENDING applications sorted oldest-first; shows seller name, craft description, years, portfolio URL (clickable); Approve button uses `$transaction` to set `status = APPROVED` + `SellerProfile.isVerifiedMaker = true` + `verifiedAt = now()`; Reject form accepts optional review notes
- **Admin sidebar** — `src/app/admin/layout.tsx`: "Verification" link with amber pending-count badge (parallel query alongside cases count)
- **Dashboard nav** — `src/app/dashboard/page.tsx`: "✓ Verified Maker" green pill if verified; "Badge Application Pending" if PENDING; "Apply for Verified Badge" otherwise

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

- **Rate limiting** — Add `@upstash/ratelimit` on high-volume public routes (`/api/search/suggestions`, `/api/listings/[id]/view`, `/api/listings/[id]/click`) and auth-sensitive routes (`/api/reviews`)
- **Security headers** — Add `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` in `next.config.ts`
- **Input validation** — Add Zod schemas to validate and sanitize API request bodies (currently relies on manual type assertions and `.slice()` guards)

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

10. **Terms of service page** — `/terms` static page
11. **Privacy policy page** — `/privacy` static page
12. **Clerk webhook production setup** — see "Deployment steps" in Clerk User Sync Webhook section above
13. **Stripe live mode webhook** — register in Stripe live mode after identity verification clears; update `STRIPE_WEBHOOK_SECRET` in Vercel

### Seller tools

14. **Seller analytics dashboard** — views, clicks, conversion, revenue charts for sellers; `viewCount` and `clickCount` already tracked on `Listing`
15. **Vacation / workshop-closed mode** — seller can pause their shop with a banner shown on their profile and listings
16. **Seller onboarding flow** — guided first-time setup: set location, add first listing, connect Stripe

### Discovery & community

17. **Commission / wanted board** — public board where buyers post custom piece requests; sellers respond
18. **Following system** — buyers follow sellers; `NEW_FOLLOWER` notification type already in schema
19. **Blog subscriptions** — subscribe to a seller's blog; get notified on new posts
20. **Blog search** — search within blog posts
21. **Save / bookmark blog posts** — heart or bookmark a post for later

### Platform

22. **PWA setup** — `manifest.json`, service worker, offline fallback, home-screen install prompt; map `apple-touch-icon`

**TypeScript: zero `tsc --noEmit` errors** (all pre-existing errors resolved as of current codebase)

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

Clerk v7 handles auth. Public routes (no login required): `/`, `/browse`, `/listing/*`, `/seller/*`, `/sellers/*`, `/map/*`, `/sign-in`, `/sign-up`, `/api/whoami`, `/api/me`, `/api/reviews`, `/api/stripe/webhook` (called by Stripe servers — no Clerk session), `/api/clerk/webhook` (called by Clerk servers — no Clerk session), `/api/uploadthing` (UploadThing callback). Everything else (dashboard, cart, checkout, messages, orders) requires authentication.

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
