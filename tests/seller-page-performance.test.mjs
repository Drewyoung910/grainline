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
    assert.match(sellerPage, /featuredRows,/);
    assert.match(
      sellerPage,
      /seller\.featuredListingIds && seller\.featuredListingIds\.length > 0\s*\?\s*prisma\.listing\.findMany\(\{/,
    );
    assert.match(sellerPage, /getSellerRatingMap\(\[seller\.id\]\)/);
    assert.match(sellerPage, /getCachedPublicSellerStats\(seller\.id\)/);
  });

  it("keeps seller profile listing previews bounded without deriving total count from preview rows", () => {
    const sellerPage = source("src/app/seller/[id]/page.tsx");

    assert.match(sellerPage, /const SELLER_PROFILE_LISTING_PREVIEW_SIZE = 9/);
    assert.match(sellerPage, /take: SELLER_PROFILE_LISTING_PREVIEW_SIZE/);
    assert.match(sellerPage, /prisma\.listing\.count\(\{ where: publicListingWhere\(\{ sellerId: seller\.id \}\) \}\)/);
    assert.doesNotMatch(sellerPage, /const featuredRows = await prisma\.listing\.findMany\(\{/);
    assert.match(sellerPage, /where: publicListingWhere\(\{ sellerId: seller\.id, id: \{ in: seller\.featuredListingIds \} \}\)/);
    assert.match(sellerPage, /See all \{activePublicListingCount\}/);
    assert.doesNotMatch(sellerPage, /take: 100/);
    assert.doesNotMatch(sellerPage, /listings\.slice\(0, 9\)/);
    assert.doesNotMatch(sellerPage, /listings\.filter\(\(l\) => l\.status === "ACTIVE" && !l\.isPrivate\)\.length/);
  });

  it("keeps seller profile tag-filter links wired to the seller shop query", () => {
    const sellerPage = source("src/app/seller/[id]/page.tsx");
    const sellerShopPage = source("src/app/seller/[id]/shop/page.tsx");
    const sortSelect = source("src/app/seller/[id]/shop/SortSelect.tsx");

    assert.match(sellerPage, /publicSellerShopPath\(seller\.id, seller\.displayName\)\}\?tag=\$\{encodeURIComponent\(tag\)\}/);
    assert.match(sellerShopPage, /import \{ normalizeTag \} from "@\/lib\/tags"/);
    assert.match(sellerShopPage, /const tag = normalizeTag\(sp\.tag\)/);
    assert.match(sellerShopPage, /const tagFilter = tag \? \{ tags: \{ has: tag \} \} : \{\}/);
    assert.match(sellerShopPage, /publicListingWhere\(\{ sellerId, \.\.\.categoryFilter, \.\.\.tagFilter \}\)/);
    assert.match(sellerShopPage, /if \(t\) params\.set\("tag", t\)/);
    assert.match(sellerShopPage, /Tagged: \{tag\.replace/);
    assert.match(sortSelect, /tag: string \| null/);
    assert.match(sortSelect, /if \(tag\) params\.set\("tag", tag\)/);
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
    assert.match(publicSellerStats, /import \{ BLOCKING_REFUND_LEDGER_SQL \} from "@\/lib\/refundLedgerSql"/);
    assert.match(publicSellerStats, /SUM\(oi\.quantity\)/);
    assert.match(publicSellerStats, /o\."sellerRefundId" IS NULL/);
    assert.match(publicSellerStats, /\$\{BLOCKING_REFUND_LEDGER_SQL\}/);
    assert.match(publicSellerStats, /ORDER BY o\."shippedAt" DESC/);
    assert.match(publicSellerStats, /LIMIT 30/);
  });

  it("includes curated featured listings in saved-state hydration", () => {
    const sellerPage = source("src/app/seller/[id]/page.tsx");

    assert.match(
      sellerPage,
      /const listingIds = Array\.from\(new Set\(\[\s*\.\.\.listings\.map\(\(l\) => l\.id\),\s*\.\.\.featuredListings\.map\(\(l\) => l\.id\),\s*\]\)\)/,
    );
    assert.match(sellerPage, /where: \{ userId: meId, listingId: \{ in: listingIds \} \}/);
    assert.match(sellerPage, /initialSaved=\{savedSet\.has\(hero\.id\)\}/);
    assert.match(sellerPage, /initialSaved=\{savedSet\.has\(l\.id\)\}/);
  });

  it("shares seller loaders on public seller subroutes and avoids duplicate visibility queries", () => {
    const sellerShopPage = source("src/app/seller/[id]/shop/page.tsx");
    const customerPhotosPage = source("src/app/seller/[id]/customer-photos/page.tsx");

    for (const pageSource of [sellerShopPage, customerPhotosPage]) {
      assert.match(pageSource, /import \{ cache \} from "react"/);
      assert.match(pageSource, /isSupportedStripeAccountVersion\(seller\.stripeAccountVersion\)/);
      assert.equal(
        (pageSource.match(/prisma\.sellerProfile\.findUnique\(/g) ?? []).length,
        1,
        "metadata and page render should share one cached seller profile findUnique call",
      );
      assert.doesNotMatch(pageSource, /prisma\.sellerProfile\.findFirst\(\{\s*where: visibleSellerProfileWhere/);
      assert.doesNotMatch(pageSource, /prisma\.sellerProfile\.count\(\{\s*where: visibleSellerProfileWhere/);
    }

    assert.match(sellerShopPage, /const getSellerProfileForShopPage = cache\(async \(sellerId: string\) =>/);
    assert.match(sellerShopPage, /export async function generateMetadata[\s\S]*getSellerProfileForShopPage\(sellerId\)/);
    assert.match(sellerShopPage, /export default async function SellerShopPage[\s\S]*getSellerProfileForShopPage\(sellerId\)/);

    assert.match(customerPhotosPage, /const getSellerProfileForCustomerPhotosPage = cache\(async \(sellerId: string\) =>/);
    assert.match(customerPhotosPage, /export async function generateMetadata[\s\S]*getSellerProfileForCustomerPhotosPage\(sellerId\)/);
    assert.match(customerPhotosPage, /export default async function CustomerPhotosPage[\s\S]*getSellerProfileForCustomerPhotosPage\(sellerId\)/);
  });

  it("keeps independent seller-shop page reads grouped before paginated listing fetch", () => {
    const sellerShopPage = source("src/app/seller/[id]/shop/page.tsx");

    assert.match(
      sellerShopPage,
      /const \[seller, authResult\] = await Promise\.all\(\[\s*getSellerProfileForShopPage\(sellerId\),\s*auth\(\),\s*\]\)/,
    );
    assert.match(
      sellerShopPage,
      /const \[\s*\[followerCount, isFollowing\],\s*categoryGroups,\s*total,\s*\] = await Promise\.all\(\[/,
    );
    assert.ok(
      sellerShopPage.indexOf("prisma.listing.groupBy({") < sellerShopPage.indexOf("const totalPages ="),
      "seller shop category groups should be fetched in the shared pre-pagination batch",
    );
    assert.ok(
      sellerShopPage.indexOf("prisma.listing.count({ where })") < sellerShopPage.indexOf("const totalPages ="),
      "seller shop total count should be fetched in the shared pre-pagination batch",
    );
    assert.ok(
      sellerShopPage.indexOf("const totalPages =") < sellerShopPage.indexOf("const listings = await prisma.listing.findMany"),
      "seller shop listing fetch should still wait for page clamping",
    );
  });
});
