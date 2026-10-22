import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("homepage deterministic query guardrails", () => {
  it("orders capped homepage map rows deterministically", () => {
    const home = source("src/app/page.tsx");
    const authority = source(
      "prisma/migrations/20261019010000_prepare_seller_profile_public_map_authority/migration.sql",
    );

    assert.match(home, /sellerPublicMapPoints\(meDbId, 200\)/);
    assert.doesNotMatch(home, /prisma\.sellerProfile\.findMany\([\s\S]*publicMapOptIn/u);
    assert.match(authority, /ORDER BY seller\.id ASC[\s\S]*LIMIT p_limit/u);
  });

  it("keeps the static homepage hero free of decoration-only database work", () => {
    const home = source("src/app/page.tsx");

    assert.match(home, /src="\/hero-maple-cabinets\.jpg"/);
    assert.doesNotMatch(home, /HeroMosaic|mosaicListings|heroCollagePhotos/);
    assert.doesNotMatch(home, /getPopularListingTags|trendingTagsRaw|statsResults/);
    assert.doesNotMatch(home, /prisma\.listing\.count|prisma\.user\.count|paidStripeOrderWhere/);
    assert.match(home, /getCachedHomepageStats\(\)/);
  });

  it("loads homepage statistics through one short-lived trusted cache", () => {
    const stats = source("src/lib/homepageStats.ts");
    const authority = source(
      "prisma/migrations/20260901050000_prepare_order_public_aggregate_authority/migration.sql",
    );

    assert.match(stats, /import \{ unstable_cache \} from "next\/cache"/);
    assert.match(stats, /HOMEPAGE_STATS_REVALIDATE_SECONDS = 5 \* 60/);
    assert.match(stats, /await Promise\.all\(\[/);
    assert.match(stats, /prisma\.listing\.count\(\{ where: publicListingWhere\(\) \}\)/);
    assert.match(stats, /sellerPublicMarketplaceCounts\(\)/);
    assert.match(stats, /makers: marketplaceCounts\.activeSellerCount/);
    assert.doesNotMatch(stats, /prisma\.sellerProfile\./);
    assert.match(stats, /import \{ getPublicActiveMemberCount \} from "@\/lib\/userPublicIdentityAccess"/);
    assert.match(stats, /getPublicActiveMemberCount\(\)/);
    assert.doesNotMatch(stats, /prisma\.user\.(count|findMany|findFirst|findUnique)\(/);
    assert.match(stats, /getPublicFulfilledOrderCount\(\)/);
    assert.match(authority, /source_order\."sellerRefundId" IS NULL/);
    assert.match(authority, /source_order\."paymentRefundBlocked" = false/);
    assert.doesNotMatch(stats, /paymentEvents:|blockingRefundLedgerWhere|OrderPaymentEvent/);
    assert.match(authority, /'DELIVERED'::public\."FulfillmentStatus"/);
    assert.match(authority, /'PICKED_UP'::public\."FulfillmentStatus"/);
    assert.match(stats, /\["homepage-stats-v1"\]/);
    assert.match(stats, /revalidate: HOMEPAGE_STATS_REVALIDATE_SECONDS/);
  });

  it("keeps featured maker thumbnail listings on shared public visibility filters", () => {
    const home = source("src/app/page.tsx");
    const start = home.indexOf("async function getFeaturedMakerBlock");
    const block = home.slice(start, home.indexOf("const CATEGORIES", start));

    assert.match(block, /where: publicListingWhere\(\{\s*id: \{ in: \[\.\.\.maker\.featuredListingIds\] \},\s*sellerId: maker\.id,\s*photos: \{ some: \{\} \},\s*\}\),/);
    assert.match(block, /where: publicListingWhere\(\{\s*sellerId: maker\.id,\s*photos: \{ some: \{\} \},\s*\.\.\.\(existingIds\.length > 0 \? \{ id: \{ notIn: existingIds \} \} : \{\}\),\s*\}\),/);
    assert.doesNotMatch(block, /status: "ACTIVE"/);
    assert.doesNotMatch(block, /isPrivate: false/);
  });

  it("merges followed-maker listing and blog items by recency before slicing", () => {
    const home = source("src/app/page.tsx");

    assert.match(home, /import \{ compareAccountFeedItemsDesc \} from "@\/lib\/accountFeedCursor"/);
    assert.match(home, /prisma\.follow\.findMany\(\{[\s\S]*orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\][\s\S]*take: 50/);
    assert.match(home, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(home, /orderBy: \[\{ publishedAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(home, /kind: "listing", id: l\.id, date: l\.createdAt\.toISOString\(\)/);
    assert.match(home, /kind: "blog", id: p\.id, date: \(p\.publishedAt \?\? new Date\(0\)\)\.toISOString\(\)/);
    assert.match(home, /fromYourMakers = merged\.sort\(compareAccountFeedItemsDesc\)\.slice\(0, 6\)/);
    assert.doesNotMatch(home, /fromYourMakers = merged\.slice\(0, 6\)/);
  });
});
