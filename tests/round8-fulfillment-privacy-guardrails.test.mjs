import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Round 8 fulfillment fraud-chain guardrails", () => {
  it("requires manual shipping tracking and moves shipped-order delivery confirmation to buyers", () => {
    const fulfillment = source("src/app/api/orders/[id]/fulfillment/route.ts");
    const buyerConfirm = source("src/app/api/orders/[id]/confirm-delivery/route.ts");
    const salesPage = source("src/app/dashboard/sales/[orderId]/page.tsx");
    const buyerPage = source("src/app/dashboard/orders/[id]/page.tsx");

    assert.match(fulfillment, /Tracking carrier is required/);
    assert.match(fulfillment, /Tracking number is required/);
    assert.match(fulfillment, /TRACKING_NUMBER_RE\.test\(trackingNumber\)/);
    assert.match(fulfillment, /BUYER_DELIVERY_CONFIRMATION_ERROR/);

    assert.match(buyerConfirm, /ensureUserByClerkId\(clerkId\)/);
    assert.match(buyerConfirm, /safeRateLimit\(fulfillmentRatelimit, `confirm-delivery:\$\{me\.id\}`\)/);
    assert.match(buyerConfirm, /buyerId: me\.id/);
    assert.match(buyerConfirm, /fulfillmentStatus: "SHIPPED"/);
    assert.match(buyerConfirm, /fulfillmentStatus: "DELIVERED"/);
    assert.match(buyerConfirm, /deliveredAt: new Date\(\)/);

    assert.doesNotMatch(salesPage, /name="action" value="delivered"/);
    assert.doesNotMatch(salesPage, /Mark delivered/);
    assert.match(buyerPage, /action=\{`\/api\/orders\/\$\{order\.id\}\/confirm-delivery`\}/);
    assert.match(buyerPage, /Confirm delivery/);
  });

  it("blocks account deletion for recent terminal orders inside the case window", () => {
    const accountDeletion = source("src/lib/accountDeletion.ts");

    assert.match(accountDeletion, /import \{ CASE_WINDOW_DAYS \} from "@\/lib\/caseCreateState"/);
    assert.match(accountDeletion, /ACCOUNT_DELETION_TERMINAL_ORDER_BLOCK_DAYS = CASE_WINDOW_DAYS/);
    assert.match(accountDeletion, /function accountDeletionFulfillmentBlockerSql\(terminalCutoff: Date\)/);
    assert.match(accountDeletion, /o\."fulfillmentStatus" = 'DELIVERED'[\s\S]*o\."deliveredAt" IS NULL OR o\."deliveredAt" >= \$\{terminalCutoff\}/);
    assert.match(accountDeletion, /o\."fulfillmentStatus" = 'PICKED_UP'[\s\S]*o\."pickedUpAt" IS NULL OR o\."pickedUpAt" >= \$\{terminalCutoff\}/);
    assert.match(accountDeletion, /within the case window/);
  });

  it("blocks listing soft-delete for recent terminal orders inside the case window", () => {
    const softDelete = source("src/lib/listingSoftDelete.ts");
    const handbook = source("src/app/seller-handbook/page.tsx");

    assert.match(softDelete, /import \{ CASE_WINDOW_DAYS \} from "@\/lib\/caseCreateState"/);
    assert.match(softDelete, /LISTING_SOFT_DELETE_TERMINAL_ORDER_BLOCK_DAYS = CASE_WINDOW_DAYS/);
    assert.match(softDelete, /function listingSoftDeleteOrderBlockerWhere/);
    assert.match(softDelete, /fulfillmentStatus: "DELIVERED"[\s\S]*deliveredAt: \{ gte: terminalCutoff \}/);
    assert.match(softDelete, /fulfillmentStatus: "PICKED_UP"[\s\S]*pickedUpAt: \{ gte: terminalCutoff \}/);
    assert.match(softDelete, /Cannot delete a listing with open, active, or recently fulfilled orders inside the case window/);
    assert.doesNotMatch(handbook, /within 90 days/);
    assert.match(handbook, /within the 30-day case window after/);
  });
});

describe("Round 8 public profile privacy guardrails", () => {
  it("keeps public SellerProfile RSC projections narrow and avoids seller email fallbacks", () => {
    const listing = source("src/app/listing/[id]/page.tsx");
    const seller = source("src/app/seller/[id]/page.tsx");
    const browse = source("src/app/browse/page.tsx");

    assert.doesNotMatch(listing, /seller:\s*\{\s*include:/);
    assert.doesNotMatch(seller, /include:\s*\{\s*user:/);
    assert.doesNotMatch(browse, /seller:\s*\{\s*include:/);
    assert.doesNotMatch(listing, /email: true/);
    assert.doesNotMatch(listing, /seller\.user\?\.email/);
    assert.doesNotMatch(listing, /clerkId: true/);
    assert.doesNotMatch(listing, /sellerClerkId/);
    assert.match(listing, /const sellerName = listing\.seller\.displayName \?\? "Maker"/);
  });

  it("applies viewer privacy filters to public structured data and customer photos", () => {
    const listing = source("src/app/listing/[id]/page.tsx");
    const seller = source("src/app/seller/[id]/page.tsx");
    const customerPhotos = source("src/app/seller/[id]/customer-photos/page.tsx");
    const similar = source("src/app/api/listings/[id]/similar/route.ts");

    assert.match(listing, /reviewer: \{ banned: false, deletedAt: null \}/);
    assert.match(listing, /reviewerId: \{ notIn: \[\.\.\.blockedUserIds\] \}/);
    assert.match(seller, /seller\.publicMapOptIn && !radiusMeters && lat != null && lng != null/);
    assert.match(seller, /allowLocalPickup: true/);
    assert.match(seller, /const showPickupMap = seller\.allowLocalPickup && lat != null && lng != null/);
    assert.match(seller, /\{showPickupMap && \(/);
    assert.match(listing, /allowLocalPickup: true/);
    assert.match(listing, /const showPickupMap = listing\.seller\.allowLocalPickup && lat != null && lng != null/);
    assert.match(listing, /\{showPickupMap && \(/);
    assert.match(seller, /reviewer: \{ banned: false, deletedAt: null \}/);
    assert.doesNotMatch(seller, /select: \{ listingId: true, reviewerId: true/);
    assert.match(customerPhotos, /reviewer: \{ banned: false, deletedAt: null \}/);
    assert.match(customerPhotos, /reviewerId: \{ notIn: \[\.\.\.blockedUserIds\] \}/);
    assert.doesNotMatch(customerPhotos, /select: \{ listingId: true, reviewerId: true/);
    assert.match(seller, /function safeSellerSocialUrl/);
    assert.match(seller, /normalizePublicHttpsUrl\(value, 2048\)/);
    assert.match(seller, /const sameAs = socialLinks\.map\(\(link\) => link\.url\)/);
    assert.match(seller, /latestBroadcast\?\.imageUrl && isFirstPartyMediaUrl\(latestBroadcast\.imageUrl\)/);
    assert.match(seller, /src=\{latestBroadcastImageUrl\}/);
    assert.match(similar, /safeRateLimit\(searchRatelimit, getIP\(req\)\)/);
  });

  it("does not expose exact coordinates in the MapCard fallback for radius-protected maps", () => {
    const mapCard = source("src/components/MapCard.tsx");
    const mapFallback = source("src/components/MapFallback.tsx");

    assert.match(mapCard, /const privacyRadiusMeters = typeof radiusMeters === "number" && radiusMeters > 0 \? radiusMeters : null/);
    assert.match(mapCard, /lat=\{hasPrivacyRadius \? null : lat\}/);
    assert.match(mapCard, /lng=\{hasPrivacyRadius \? null : lng\}/);
    assert.match(mapCard, /Exact pickup details are private/);
    assert.match(mapFallback, /const hasCoordinates = typeof lat === "number" && typeof lng === "number"/);
    assert.match(mapFallback, /Approximate coordinates:/);
    assert.match(mapFallback, /Open in OpenStreetMap/);
  });
});

describe("Round 8 compliance copy guardrails", () => {
  it("does not claim unimplemented retention, GPC, or INFORM workflows as currently built", () => {
    const privacy = source("src/app/privacy/page.tsx");
    const notAvailable = source("src/app/not-available/page.tsx");
    const terms = source("src/app/terms/page.tsx");
    const strategy = source("STRATEGY.md");

    assert.doesNotMatch(privacy, /We honor GPC signals/);
    assert.doesNotMatch(privacy, /Messages between users are retained for <strong>3 years<\/strong>/);
    assert.doesNotMatch(privacy, /lifetime of the request plus 1 year/);
    assert.doesNotMatch(privacy, /seller analytics \(views, clicks, conversion data\), and Guild program data/);
    assert.match(privacy, /OpenFreeMap/);
    assert.match(privacy, /Cloudflare Email Routing/);
    assert.doesNotMatch(notAvailable, /United States and Canada/);
    assert.doesNotMatch(notAvailable, /Canadian maker or buyer/);
    assert.match(notAvailable, /only available in the United States/);

    assert.doesNotMatch(terms, /Grainline will verify this information within\s*10 days/);
    assert.doesNotMatch(terms, /currently 3 years/);
    assert.match(terms, /retained according to the\s+retention practices described in the Privacy Policy/);
    assert.match(terms, /may require additional verification, recertification, or\s*buyer-facing disclosures/);
    assert.match(strategy, /INFORM Consumers Act high-volume seller workflow/);
    assert.match(strategy, /has not built a dedicated high-volume seller threshold tracker/);
  });
});
