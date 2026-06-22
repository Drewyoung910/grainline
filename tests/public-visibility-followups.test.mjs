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

  it("applies viewer block filters to public blog comment reads", () => {
    const blogPage = read("src/app/blog/[slug]/page.tsx");
    const commentsRoute = read("src/app/api/blog/[slug]/comments/route.ts");

    assert.match(blogPage, /import \{ getBlockedIdsFor \} from "@\/lib\/blocks"/);
    assert.match(commentsRoute, /import \{ getBlockedUserIdsFor \} from "@\/lib\/blocks"/);

    for (const [path, source] of [
      ["blog page", blogPage],
      ["blog comments API", commentsRoute],
    ]) {
      assert.match(source, /function visibleBlogCommentWhere\(blockedUserIds: string\[\]\)/, `${path} must share comment visibility filters`);
      assert.match(source, /author: \{ banned: false, deletedAt: null \}/, `${path} must filter inactive comment authors`);
      assert.match(source, /authorId: \{ notIn: blockedUserIds \}/, `${path} must filter blocked comment authors`);
      assert.match(source, /where: \{ \.\.\.commentVisibilityWhere,/, `${path} must apply comment visibility to top-level reads`);
      assert.match(source, /where: commentVisibilityWhere/, `${path} must apply comment visibility to reply reads`);
    }

    assert.match(commentsRoute, /post\.authorId && blockedUserIds\.includes\(post\.authorId\)/);
  });

  it("filters blocked makers from blog detail related surfaces", () => {
    const blogPage = read("src/app/blog/[slug]/page.tsx");

    assert.match(blogPage, /const \{ blockedUserIds, blockedSellerIds: blockedSellerIdList \} = await getBlockedIdsFor\(meId\)/);
    assert.match(blogPage, /const viewerBlogPostWhere = \(extra: Prisma\.BlogPostWhereInput = \{\}\) =>/);
    assert.match(blogPage, /authorId: \{ notIn: blockedUserIds \}/);
    assert.match(blogPage, /sellerProfileId: \{ notIn: blockedSellerIds \}/);
    assert.match(blogPage, /const featuredSellerFilter: Prisma\.ListingWhereInput =/);
    assert.match(blogPage, /sellerId: \{ notIn: blockedSellerIds \}/);
    assert.match(blogPage, /where: viewerBlogPostWhere\(\{\s*id: \{ not: post\.id \}/);
  });

  it("keeps listing review aggregates aligned with visible review filters", () => {
    const reviewsSection = read("src/components/ReviewsSection.tsx");

    assert.match(reviewsSection, /const blockedReviewerFilter: Prisma\.ReviewWhereInput =/);
    assert.match(reviewsSection, /const visibleReviewWhere: Prisma\.ReviewWhereInput = \{[\s\S]*listingId,[\s\S]*reviewer: \{ banned: false, deletedAt: null \},[\s\S]*\.\.\.blockedReviewerFilter,[\s\S]*\};/);
    assert.match(reviewsSection, /prisma\.review\.aggregate\(\{\s*where: visibleReviewWhere,/);
    assert.match(reviewsSection, /prisma\.review\.findMany\(\{\s*where: \{\s*\.\.\.visibleReviewWhere,/);
  });

  it("keeps public listing-card queries on top-level select allowlists", () => {
    const browsePage = read("src/app/browse/page.tsx");
    const homePage = read("src/app/page.tsx");
    const listingPage = read("src/app/listing/[id]/page.tsx");
    const sellerPage = read("src/app/seller/[id]/page.tsx");
    const sellerShopPage = read("src/app/seller/[id]/shop/page.tsx");
    const tagPage = read("src/app/tag/[slug]/page.tsx");

    for (const [path, source] of [
      ["browse", browsePage],
      ["homepage", homePage],
      ["listing detail", listingPage],
      ["seller profile", sellerPage],
      ["seller shop", sellerShopPage],
      ["tag landing", tagPage],
    ]) {
      assert.doesNotMatch(source, /include:\s*\{\s*photos:/, `${path} should not fetch full Listing rows for cards`);
      assert.doesNotMatch(source, /Prisma\.ListingInclude/, `${path} should not type public Listing card payloads as includes`);
      assert.match(source, /(?:select:\s*\{|const (?:sellerProfileListingCardSelect|homeListingCardSelect|TAG_LISTING_SELECT) = \{)[\s\S]*?id: true,[\s\S]*?title: true,[\s\S]*?priceCents: true,/);
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
    assert.match(sellerShopPage, /const blockedUserIds = await getBlockedUserIdsFor\(meId\)/);
    assert.match(sellerShopPage, /!isOwner && blockedUserIds\.has\(seller\.userId\)/);
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
    assert.match(followRoute, /return privateJson\(\{ error: "Blocked" \}, \{ status: 403 \}\)/);
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
