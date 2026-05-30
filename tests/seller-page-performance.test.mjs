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
    assert.doesNotMatch(sellerPage, /prisma\.sellerProfile\.findFirst\(\{\s*where: visibleSellerProfileWhere/);
  });

  it("keeps independent seller-page queries grouped in one parallel batch", () => {
    const sellerPage = source("src/app/seller/[id]/page.tsx");

    assert.match(sellerPage, /const \[\s*\[followerCount, isFollowing\],[\s\S]*customerPhotoTotal,\s*\] = await Promise\.all\(\[/);
    assert.match(sellerPage, /prisma\.sellerBroadcast\.findFirst/);
    assert.match(sellerPage, /prisma\.blogPost\.findMany/);
    assert.match(sellerPage, /prisma\.listing\.findMany/);
    assert.match(sellerPage, /getSellerRatingMap\(\[seller\.id\]\)/);
    assert.match(sellerPage, /prisma\.orderItem\.count/);
  });

  it("keeps public shipping-speed stats scoped to recent shipped orders", () => {
    const sellerPage = source("src/app/seller/[id]/page.tsx");

    assert.match(sellerPage, /const RECENT_SHIPPING_STATS_DAYS = 180/);
    assert.match(sellerPage, /const recentShippingCutoff = new Date\(nowMs - RECENT_SHIPPING_STATS_DAYS \* MS_PER_DAY\)/);
    assert.match(sellerPage, /shippedAt: \{ not: null, gte: recentShippingCutoff \}/);
    assert.match(sellerPage, /orderBy: \{ shippedAt: "desc" \}/);
    assert.match(sellerPage, /take: 30/);
  });
});
