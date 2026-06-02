import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const { savedListingFavoriteWhere } = await import("../src/lib/savedListingVisibility.ts");

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("public visibility follow-ups", () => {
  it("keeps account dashboard saved listings on the shared saved-page filter", () => {
    const accountPage = read("src/app/account/page.tsx");
    assert.match(accountPage, /savedListingFavoriteWhere\(me\.id, blockedSellerIds\)/);
  });

  it("validates favorite targets through public listing detail visibility", () => {
    const favoritesRoute = read("src/app/api/favorites/route.ts");
    assert.match(favoritesRoute, /publicListingDetailWhere\(\{ id: listingId \}\)/);
    assert.doesNotMatch(favoritesRoute, /favorite\.upsert\(\{[\s\S]*create: \{ userId: me\.id, listingId \}[\s\S]*findUnique\(\{[\s\S]*where: \{ id: listingId \}/);
  });

  it("keeps listing detail related listings and review aggregates on public visibility filters", () => {
    const listingPage = read("src/app/listing/[id]/page.tsx");

    assert.match(listingPage, /import \{ canViewListingDetail, isPublicListingDetail, publicListingWhere \}/);
    assert.match(listingPage, /const visibleListingReviewWhere = \{[\s\S]*?reviewer: \{ banned: false, deletedAt: null \},[\s\S]*?\.\.\.blockedReviewerFilter,/);
    assert.match(listingPage, /prisma\.review\.aggregate\(\{\s*where: visibleListingReviewWhere,/);
    assert.match(listingPage, /prisma\.review\.findMany\(\{\s*where: visibleListingReviewWhere,/);
    assert.match(listingPage, /prisma\.listing\.findMany\(\{\s*where: publicListingWhere\(\{\s*sellerId: listing\.sellerId,\s*id: \{ not: listing\.id \},\s*\}\),/);
  });

  it("keeps public listing-card queries on top-level select allowlists", () => {
    const browsePage = read("src/app/browse/page.tsx");
    const listingPage = read("src/app/listing/[id]/page.tsx");
    const sellerPage = read("src/app/seller/[id]/page.tsx");
    const sellerShopPage = read("src/app/seller/[id]/shop/page.tsx");

    for (const [path, source] of [
      ["browse", browsePage],
      ["listing detail", listingPage],
      ["seller profile", sellerPage],
      ["seller shop", sellerShopPage],
    ]) {
      assert.doesNotMatch(source, /include:\s*\{\s*photos:/, `${path} should not fetch full Listing rows for cards`);
      assert.match(source, /select:\s*\{[\s\S]*?id: true,[\s\S]*?title: true,[\s\S]*?priceCents: true,/);
    }
  });

  it("keeps public owner checks off Clerk ids when local seller user ids are selected", () => {
    const listingPage = read("src/app/listing/[id]/page.tsx");
    const sellerPage = read("src/app/seller/[id]/page.tsx");
    const sellerShopPage = read("src/app/seller/[id]/shop/page.tsx");
    const visibility = read("src/lib/listingVisibility.ts");

    assert.doesNotMatch(listingPage, /user: \{ select: \{ id: true/);
    assert.match(listingPage, /const sellerUserId = listing\.seller\.userId/);
    assert.match(listingPage, /blockedUserIds\.has\(listing\.seller\.userId\)/);

    for (const source of [sellerPage, sellerShopPage]) {
      assert.doesNotMatch(source, /clerkId: true/);
      assert.match(source, /const isOwner = !!meId && seller\.userId === meId/);
    }
    assert.match(visibility, /listing\.seller\.userId === viewer\.dbUserId/);
  });

  it("allows sellers to clear their workshop gallery explicitly", () => {
    const uploader = read("src/components/GalleryUploader.tsx");
    const profilePage = read("src/app/dashboard/profile/page.tsx");
    assert.match(uploader, /name="galleryImageUrlsTouched"/);
    assert.match(profilePage, /galleryImageUrlsTouched \? \{ galleryImageUrls, galleryAltTexts \} : \{\}/);
  });

  it("builds saved listing filters with only public active or sold-out listings", () => {
    assert.deepEqual(savedListingFavoriteWhere("user_1", ["seller_2"]), {
      userId: "user_1",
      listing: {
        AND: [
          {
            status: { in: ["ACTIVE", "SOLD_OUT"] },
            isPrivate: false,
            seller: {
              chargesEnabled: true,
              OR: [
                { stripeAccountVersion: null },
                { stripeAccountVersion: "v2" },
              ],
              vacationMode: false,
              user: { banned: false, deletedAt: null },
            },
          },
          { sellerId: { notIn: ["seller_2"] } },
        ],
      },
    });
  });

  it("cleans up follow rows if a block races the follow write", () => {
    const followRoute = read("src/app/api/follow/[sellerId]/route.ts");

    assert.match(followRoute, /const blockAfterFollow = await prisma\.block\.findFirst/);
    assert.match(followRoute, /await prisma\.follow\.deleteMany\(\{\s*where: \{ followerId: me\.id, sellerProfileId: sellerProfile\.id \}/s);
    assert.match(followRoute, /return NextResponse\.json\(\{ error: "Blocked" \}, \{ status: 403 \}\)/);
    assert.ok(
      followRoute.indexOf("const blockAfterFollow") > followRoute.indexOf("await prisma.follow.upsert"),
      "follow route must re-check block state after the follow write",
    );
    assert.ok(
      followRoute.indexOf("const followerCount", followRoute.indexOf("const blockAfterFollow")) >
        followRoute.indexOf("const blockAfterFollow"),
      "follow route must not count or notify until the post-write block recheck passes",
    );
  });
});
