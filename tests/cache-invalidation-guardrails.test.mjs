import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("public cache invalidation guardrails", () => {
  it("centralizes public seller visibility cache invalidation", () => {
    const cache = source("src/lib/searchCache.ts");

    assert.match(cache, /POPULAR_LISTING_TAGS_CACHE_TAG = "popular-listing-tags"/);
    assert.match(cache, /POPULAR_BLOG_TAGS_CACHE_TAG = "popular-blog-tags"/);
    assert.match(cache, /HOME_FEATURED_MAKER_CACHE_TAG = "home-featured-maker"/);
    assert.match(cache, /export function revalidatePublicSellerVisibilityCaches\(\)/);
    assert.ok(
      cache.indexOf("revalidateListingSearchCaches();") <
        cache.indexOf("revalidateFeaturedMakerCaches();"),
      "public seller invalidation should include listing/blog tags and featured makers",
    );
  });

  it("filters cached featured makers per viewer block state and bounds homepage staleness", () => {
    const home = source("src/app/page.tsx");

    assert.match(home, /tags: \[HOME_FEATURED_MAKER_CACHE_TAG\]/);
    assert.match(home, /revalidate: 300/);
    assert.match(home, /async function getFeaturedMakerBlock\(blockedSellerIds: string\[\] = \[\]\)/);
    assert.match(home, /const blocked = new Set\(blockedSellerIds\)/);
    assert.match(home, /\.filter\(\(maker\) => !blocked\.has\(maker\.id\)\)/);
    assert.match(home, /getFeaturedMakerBlock\(blockedSellerIds\)/);
  });

  it("invalidates seller visibility caches when account and payout state changes", () => {
    const ban = source("src/lib/ban.ts");
    const deletion = source("src/lib/accountDeletion.ts");
    const mirror = source("src/lib/stripeWebhookMirror.ts");
    const webhook = source("src/app/api/stripe/webhook/route.ts");
    const status = source("src/app/api/stripe/connect/status/route.ts");
    const create = source("src/app/api/stripe/connect/create/route.ts");
    const vacation = source("src/app/api/seller/vacation/route.ts");
    const sellerSettings = source("src/app/dashboard/seller/page.tsx");
    const onboarding = source("src/app/dashboard/onboarding/page.tsx");

    assert.match(ban, /revalidatePublicSellerVisibilityCaches\(\)/);
    assert.match(deletion, /revalidatePublicSellerVisibilityCaches\(\)/);
    assert.match(mirror, /revalidatePublicSellerVisibilityCaches\(\)/);
    assert.match(mirror, /expireOpenCheckoutSessionsForSeller/);
    assert.match(webhook, /account\.application\.deauthorized[\s\S]*revalidatePublicSellerVisibilityCaches\(\)/);
    assert.match(status, /mirrorStripeChargesEnabled\(\{[\s\S]*route: "\/api\/stripe\/connect\/status"/);
    assert.match(create, /mirrorStripeChargesEnabled\(\{[\s\S]*route: "\/api\/stripe\/connect\/create"/);
    assert.match(vacation, /data: \{ vacationMode, vacationReturnDate, vacationMessage \}[\s\S]*revalidatePublicSellerVisibilityCaches\(\)/);
    assert.match(sellerSettings, /mirrorStripeChargesEnabled\(\{[\s\S]*route: "\/dashboard\/seller"/);
    assert.doesNotMatch(sellerSettings, /data: \{ chargesEnabled \}/);
    assert.match(onboarding, /mirrorStripeChargesEnabled\(\{[\s\S]*route: "\/dashboard\/onboarding"/);
    assert.match(onboarding, /chargesEnabled = mirrorResult\.matched[\s\S]*mirrorResult\.chargesEnabled/);
    assert.doesNotMatch(onboarding, /data: \{ chargesEnabled \}/);
  });

  it("invalidates featured-maker caches when listing visibility or guild level changes", () => {
    const sellerShop = source("src/app/seller/[id]/shop/actions.ts");
    const sellerProfile = source("src/app/dashboard/profile/page.tsx");
    const adminReview = source("src/app/api/admin/listings/[id]/review/route.ts");
    const adminRemove = source("src/app/api/admin/listings/[id]/route.ts");
    const adminUndo = source("src/lib/audit.ts");
    const dashboard = source("src/app/dashboard/page.tsx");
    const newListing = source("src/app/dashboard/listings/new/page.tsx");
    const editListing = source("src/app/dashboard/listings/[id]/edit/page.tsx");
    const memberCron = source("src/app/api/cron/guild-member-check/route.ts");
    const metricsCron = source("src/app/api/cron/guild-metrics/route.ts");

    assert.match(sellerShop, /function revalidateListingSurfaces[\s\S]*revalidateListingSearchCaches\(\)/);
    assert.match(sellerShop, /function revalidateListingSurfaces[\s\S]*revalidateFeaturedMakerCaches\(\)/);
    assert.match(adminReview, /revalidateListingSearchCaches\(\)[\s\S]*revalidateFeaturedMakerCaches\(\)/);
    assert.match(adminRemove, /status: "REJECTED"[\s\S]*revalidateListingSearchCaches\(\)[\s\S]*revalidateFeaturedMakerCaches\(\)/);
    assert.match(adminUndo, /log\.action === 'BAN_USER'[\s\S]*revalidatePublicSellerVisibilityCaches\(\)/);
    assert.match(adminUndo, /log\.action === 'REMOVE_LISTING' \|\| log\.action === 'HOLD_LISTING'[\s\S]*revalidateListingSearchCaches\(\)[\s\S]*revalidateFeaturedMakerCaches\(\)/);
    assert.match(dashboard, /revalidateListingSearchCaches\(\)[\s\S]*revalidateFeaturedMakerCaches\(\)/);
    assert.match(newListing, /finalListing\?\.status === "ACTIVE"[\s\S]*revalidateListingSearchCaches\(\)[\s\S]*revalidateFeaturedMakerCaches\(\)/);
    assert.match(editListing, /revalidateListingSearchCaches\(\)[\s\S]*revalidateFeaturedMakerCaches\(\)/);
    assert.match(memberCron, /if \(!revoked\) return 0;[\s\S]*revalidateFeaturedMakerCaches\(\)/);
    assert.match(metricsCron, /if \(!revoked\) return \{ processed: 1, warned: 0, revokedMaster: 0 \};[\s\S]*revalidateFeaturedMakerCaches\(\)/);
    assert.match(sellerProfile, /import \{ revalidateFeaturedMakerCaches \} from "@\/lib\/searchCache"/);
    assert.match(sellerProfile, /updateSellerProfile[\s\S]*revalidateFeaturedMakerCaches\(\)[\s\S]*revalidatePath\("\/"\)/);
    assert.match(sellerProfile, /removeSellerAvatar[\s\S]*revalidateFeaturedMakerCaches\(\)[\s\S]*revalidatePath\("\/"\)/);
    assert.match(sellerProfile, /toggleFeaturedListing[\s\S]*revalidateFeaturedMakerCaches\(\)[\s\S]*revalidatePath\("\/"\)/);
  });

  it("invalidates featured-maker caches when review ratings change", () => {
    const reviewCreate = source("src/app/api/reviews/route.ts");
    const reviewUpdateDelete = source("src/app/api/reviews/[id]/route.ts");

    assert.match(reviewCreate, /import \{ revalidateFeaturedMakerCaches \} from "@\/lib\/searchCache"/);
    assert.match(reviewUpdateDelete, /import \{ revalidateFeaturedMakerCaches \} from "@\/lib\/searchCache"/);
    assert.match(reviewCreate, /refreshSellerRatingSummary\(orderItem\.listing\.sellerId, tx\)[\s\S]*revalidateFeaturedMakerCaches\(\)/);
    assert.match(reviewUpdateDelete, /refreshSellerRatingSummary\(r\.listing\.sellerId, tx\)[\s\S]*revalidateFeaturedMakerCaches\(\)[\s\S]*revalidatePath\(`\/listing\/\$\{r\.listingId\}`\)/);
    assert.match(reviewUpdateDelete, /refreshSellerRatingSummary\(review\.listing\.sellerId, tx\)[\s\S]*revalidateFeaturedMakerCaches\(\)[\s\S]*revalidatePath\(`\/listing\/\$\{review\.listingId\}`\)/);
  });

  it("avoids double caching public tag APIs and keeps why-grainline counts fresh", () => {
    const popularTags = source("src/app/api/search/popular-tags/route.ts");
    const popularBlogTags = source("src/app/api/search/popular-blog-tags/route.ts");
    const why = source("src/app/why-grainline/page.tsx");
    const docs = source("CLAUDE.md");

    assert.match(popularTags, /export const dynamic = "force-dynamic"/);
    assert.match(popularBlogTags, /export const dynamic = "force-dynamic"/);
    assert.doesNotMatch(popularTags, /export const revalidate/);
    assert.doesNotMatch(popularBlogTags, /export const revalidate/);
    assert.match(docs, /Popular tags API.*dynamic route backed by `unstable_cache` tag `popular-listing-tags`/);
    assert.match(docs, /Popular blog tags API.*dynamic route backed by `unstable_cache` tag `popular-blog-tags`/);
    assert.doesNotMatch(docs, /Popular tags API.*ISR 1hr cache/);
    assert.doesNotMatch(docs, /Popular blog tags API.*ISR 1hr cache/);
    assert.match(why, /export const revalidate = 300/);
  });

  it("invalidates listing search caches when stock-driven visibility flips", () => {
    const webhook = source("src/app/api/stripe/webhook/route.ts");
    const refund = source("src/app/api/orders/[id]/refund/route.ts");
    const caseResolve = source("src/app/api/cases/[id]/resolve/route.ts");
    const stockRestore = source("src/lib/checkoutStockRestore.ts");
    const stockRoute = source("src/app/api/listings/[id]/stock/route.ts");

    assert.match(webhook, /revalidateFeaturedMakerCaches,[\s\S]*revalidateListingSearchCaches,[\s\S]*revalidatePublicSellerVisibilityCaches,/);
    assert.match(webhook, /const soldOutCount = await tx\.\$executeRaw`[\s\S]*SET status = 'SOLD_OUT'/);
    assert.match(webhook, /listingSearchCacheInvalidationNeeded = Number\(soldOutCount\) > 0/);
    assert.match(webhook, /createdCartOrder\.listingSearchCacheInvalidationNeeded[\s\S]*revalidateListingSearchCaches\(\)[\s\S]*revalidateFeaturedMakerCaches\(\)/);
    assert.match(webhook, /createdSingleOrder\.listingSearchCacheInvalidationNeeded[\s\S]*revalidateListingSearchCaches\(\)[\s\S]*revalidateFeaturedMakerCaches\(\)/);

    assert.match(refund, /const refundWrite = await prisma\.\$transaction/);
    assert.match(refund, /const stockStatusUpdate = await tx\.listing\.updateMany/);
    assert.match(refund, /refundWrite\.stockStatusRestoredCount > 0[\s\S]*revalidateListingSearchCaches\(\)[\s\S]*revalidateFeaturedMakerCaches\(\)/);

    assert.match(caseResolve, /const caseWrite = await prisma\.\$transaction/);
    assert.match(caseResolve, /const stockStatusUpdate = await tx\.listing\.updateMany/);
    assert.match(caseResolve, /stockStatusRestoredCount > 0[\s\S]*revalidateListingSearchCaches\(\)[\s\S]*revalidateFeaturedMakerCaches\(\)/);

    assert.match(stockRestore, /import \{ revalidateFeaturedMakerCaches, revalidateListingSearchCaches \}/);
    assert.match(stockRestore, /return restoreReservedStockItems\(tx, items\)/);
    assert.match(stockRestore, /stockStatusRestoredCount > 0[\s\S]*revalidateListingSearchCaches\(\)[\s\S]*revalidateFeaturedMakerCaches\(\)/);

    assert.match(stockRoute, /import \{ revalidateFeaturedMakerCaches, revalidateListingSearchCaches \}/);
    assert.match(stockRoute, /listing\.status !== updated\.status[\s\S]*revalidateListingSearchCaches\(\)[\s\S]*revalidateFeaturedMakerCaches\(\)/);
  });
});
