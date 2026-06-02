import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("seller public page query guardrails", () => {
  it("shares the seller profile loader between metadata and page render", () => {
    const sellerPage = source("src/app/seller/[id]/page.tsx");

    assert.match(sellerPage, /import \{ cache \} from "react"/);
    assert.match(sellerPage, /const getSellerProfileForPublicPage = cache\(async \(sellerId: string\) =>/);
    assert.match(sellerPage, /export async function generateMetadata[\s\S]*getSellerProfileForPublicPage\(sellerId\)/);
    assert.match(sellerPage, /export default async function SellerPublicPage[\s\S]*getSellerProfileForPublicPage\(sellerId\)/);
    assert.equal(
      (sellerPage.match(/prisma\.sellerProfile\.findUnique\(/g) ?? []).length,
      1,
      "metadata and page render should not duplicate the seller profile findUnique call",
    );
    assert.doesNotMatch(sellerPage, /prisma\.sellerProfile\.findFirst\(\{\s*where: visibleSellerProfileWhere/);
  });

  it("keeps independent seller-page queries grouped in one parallel batch", () => {
    const sellerPage = source("src/app/seller/[id]/page.tsx");

    assert.match(sellerPage, /const \[\s*\[followerCount, isFollowing\],[\s\S]*customerPhotoTotal,\s*\] = await Promise\.all\(\[/);
    assert.match(sellerPage, /prisma\.sellerBroadcast\.findFirst/);
    assert.match(sellerPage, /prisma\.blogPost\.findMany/);
    assert.match(sellerPage, /prisma\.listing\.findMany/);
    assert.match(sellerPage, /getSellerRatingMap\(\[seller\.id\]\)/);
    assert.match(sellerPage, /getCachedPublicSellerStats\(seller\.id\)/);
  });

  it("keeps public sold and shipping-speed stats behind a cross-request cache", () => {
    const sellerPage = source("src/app/seller/[id]/page.tsx");
    const publicSellerStats = source("src/lib/publicSellerStats.ts");

    assert.doesNotMatch(sellerPage, /prisma\.orderItem\.count/);
    assert.doesNotMatch(sellerPage, /prisma\.order\.findMany/);
    assert.doesNotMatch(sellerPage, /recentShipped/);

    assert.match(publicSellerStats, /import \{ unstable_cache \} from "next\/cache"/);
    assert.match(publicSellerStats, /PUBLIC_SELLER_RECENT_SHIPPING_STATS_DAYS = 180/);
    assert.match(publicSellerStats, /PUBLIC_SELLER_STATS_REVALIDATE_SECONDS = 5 \* 60/);
    assert.match(publicSellerStats, /export const getCachedPublicSellerStats = unstable_cache\(/);
    assert.match(publicSellerStats, /prisma\.orderItem\.count/);
    assert.match(publicSellerStats, /ORDER BY o\."shippedAt" DESC/);
    assert.match(publicSellerStats, /LIMIT 30/);
  });
});
