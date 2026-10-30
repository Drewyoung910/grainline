import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("public visibility follow-ups", () => {
  it("keeps account dashboard saved listings on the owner-bound authority", () => {
    const accountPage = read("src/app/account/page.tsx");
    assert.match(accountPage, /sellerOwnerSavedListingPage\(me\.id, 6, 0\)/);
    assert.doesNotMatch(accountPage, /prisma\.favorite|savedListingFavoriteWhere|blockedSellerIds/);
  });

  it("validates and writes favorites through the atomic owner authority", () => {
    const favoritesRoute = read("src/app/api/favorites/route.ts");
    assert.match(favoritesRoute, /addOwnerFavorite\(me\.id, listingId\)/);
    assert.doesNotMatch(favoritesRoute, /prisma\.favorite|prisma\.block|sellerPublicFavoriteTarget/);
  });

  it("keeps listing detail related listings and review aggregates on public visibility filters", () => {
    const listingPage = read("src/app/listing/[id]/page.tsx");

    assert.match(listingPage, /import \{ canViewListingDetail, isPublicListingDetail, publicListingWhere \}/);
    assert.match(listingPage, /const visibleListingReviewWhere = \{[\s\S]*?reviewerAccountActive: true,[\s\S]*?\.\.\.blockedReviewerFilter,/);
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
      assert.match(source, /authorAccountActive: true/, `${path} must filter inactive comment authors`);
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
    assert.match(blogPage, /sellerPublicRecentlyViewedListings\(meId, post\.featuredListingIds\)/);
    assert.match(blogPage, /sellerId: post\.sellerProfileId/);
    assert.match(blogPage, /\.filter\(\(\{ id \}\) => !makerListingIds \|\| makerListingIds\.has\(id\)\)/);
    assert.match(blogPage, /where: viewerBlogPostWhere\(\{\s*id: \{ not: post\.id \}/);
  });

  it("keeps listing review aggregates aligned with visible review filters", () => {
    const reviewsSection = read("src/components/ReviewsSection.tsx");

    assert.match(reviewsSection, /const blockedReviewerFilter: Prisma\.ReviewWhereInput =/);
    assert.match(reviewsSection, /const visibleReviewWhere: Prisma\.ReviewWhereInput = \{[\s\S]*listingId,[\s\S]*reviewerAccountActive: true,[\s\S]*\.\.\.blockedReviewerFilter,[\s\S]*\};/);
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

  it("derives seller profile tag chips from cached public seller tag counts", () => {
    const sellerPage = read("src/app/seller/[id]/page.tsx");
    const popularTags = read("src/lib/popularTags.ts");

    assert.match(sellerPage, /import \{ getCachedPublicSellerTopTags \} from "@\/lib\/popularTags"/);
    assert.match(sellerPage, /getCachedPublicSellerTopTags\(seller\.id\)/);
    assert.doesNotMatch(sellerPage, /function topListingTags/);
    assert.doesNotMatch(sellerPage, /select: \{ tags: true \}/);
    assert.match(popularTags, /export const PUBLIC_SELLER_TOP_TAG_LIMIT = 8/);
    assert.match(popularTags, /export const getCachedPublicSellerTopTags = unstable_cache\(/);
    assert.match(popularTags, /sellerPublicSellerTags\(sellerId, PUBLIC_SELLER_TOP_TAG_LIMIT\)/);
    assert.match(popularTags, /sellerPublicListingTags\(limit\)/);
    assert.doesNotMatch(popularTags, /prisma\.\$queryRaw|JOIN "SellerProfile"|JOIN "User"/);
    assert.match(popularTags, /tags: \["popular-listing-tags"\]/);
  });

  it("keeps public owner checks off Clerk ids when local seller user ids are selected", () => {
    const listingPage = read("src/app/listing/[id]/page.tsx");
    const sellerPage = read("src/app/seller/[id]/page.tsx");
    const sellerShopPage = read("src/app/seller/[id]/shop/page.tsx");
    const customerPhotosPage = read("src/app/seller/[id]/customer-photos/page.tsx");
    const reviewsSection = read("src/components/ReviewsSection.tsx");
    const visibility = read("src/lib/listingVisibility.ts");

    assert.doesNotMatch(listingPage, /user: \{ select: \{ id: true/);
    assert.match(listingPage, /const sellerUserId = listing\.seller\.userId/);
    assert.match(listingPage, /blockedUserIds\.has\(listing\.seller\.userId\)/);

    for (const source of [sellerPage, sellerShopPage]) {
      assert.doesNotMatch(source, /clerkId: true/);
      assert.match(source, /const isOwner = seller\.viewerIsOwner/);
      assert.doesNotMatch(source, /seller\.userId/);
    }
    assert.match(sellerPage, /sellerPublicViewTarget\(seller\.id\)/);
    assert.match(sellerShopPage, /getSellerProfileForShopPage\(meId, sellerId\)/);
    assert.match(visibility, /listing\.seller\.userId === viewer\.dbUserId/);

    assert.doesNotMatch(customerPhotosPage, /clerkId: true/);
    assert.match(customerPhotosPage, /sellerPublicCustomerPhotoHeader\(meId, sellerId\)/);
    assert.doesNotMatch(customerPhotosPage, /prisma\.sellerProfile/);
    assert.match(reviewsSection, /sellerName: string;/);
    assert.match(reviewsSection, /sellerAvatarUrl: string \| null;/);
    assert.match(reviewsSection, /viewerIsSeller: boolean;/);
    assert.doesNotMatch(reviewsSection, /prisma\.sellerProfile/);
    assert.doesNotMatch(reviewsSection, /select: \{ seller: \{ select: \{ userId: true \} \} \}/);
    assert.match(reviewsSection, /!r\.sellerReply && viewerIsSeller/);
  });

  it("resolves analytics ownership to local ids and fails closed for missing local users", () => {
    for (const routePath of [
      "src/app/api/listings/[id]/click/route.ts",
      "src/app/api/listings/[id]/view/route.ts",
    ]) {
      const source = read(routePath);
      assert.match(source, /const viewer = userId \? await userIdByClerkId\(prisma, userId\) : null/);
      assert.match(source, /if \(userId && !viewer\) return telemetryJson\(\{ ok: true, skipped: true \}\)/);
      assert.match(source, /sellerOwnerCore\(viewerUserId\)/);
      assert.match(source, /sellerId: \{ not: viewerSellerProfileId \}/);
      assert.doesNotMatch(source, /seller: \{ user: \{ clerkId:/);
    }
  });

  it("allows sellers to clear their workshop gallery explicitly", () => {
    const uploader = read("src/components/GalleryUploader.tsx");
    const profilePage = read("src/app/dashboard/profile/page.tsx");
    assert.match(uploader, /name="galleryImageUrlsTouched"/);
    assert.match(profilePage, /galleryImageUrlsTouched \? \{ galleryImageUrls, galleryAltTexts \} : \{\}/);
  });

  it("keeps saved listing count and page reads on one owner-bound visibility authority", () => {
    const savedPage = read("src/app/account/saved/page.tsx");
    const access = read("src/lib/sellerSavedListingAccess.ts");
    const migration = read(
      "prisma/migrations/20261020040000_prepare_seller_profile_account_feed_cards/migration.sql",
    );

    assert.match(savedPage, /sellerOwnerSavedListingCount\(me\.id\)/);
    assert.match(savedPage, /sellerOwnerSavedListingPage\([\s\S]*me\.id,[\s\S]*PAGE_SIZE,/);
    assert.doesNotMatch(savedPage, /prisma\.favorite|savedListingFavoriteWhere/);
    assert.match(access, /grainline_seller_owner_saved_listing_count\(\)/);
    assert.match(access, /grainline_seller_owner_saved_listing_page\(/);
    assert.match(migration, /favorite\."userId" = request_user_id/g);
    assert.match(migration, /listing\.status::text IN \('ACTIVE', 'SOLD_OUT'\)/g);
    assert.match(migration, /listing\."isPrivate" = false/g);
    assert.match(migration, /seller\."vacationMode" = false/g);
    assert.match(migration, /public\."Block" AS relationship/g);
  });

  it("cleans up follow rows if a block races the follow write", () => {
    const followRoute = read("src/app/api/follow/[sellerId]/route.ts");
    const followMigration = read(
      "prisma/migrations/20261019170000_prepare_seller_profile_follow_authority/migration.sql",
    );

    assert.match(followRoute, /createSellerFollow\(me\.id, sellerId\)/);
    assert.doesNotMatch(followRoute, /prisma\.(block|follow)/);
    assert.match(followRoute, /return privateJson\(\{ error: "Blocked" \}, \{ status: 403 \}\)/);
    assert.ok(
      followMigration.indexOf("grainline_user_block_pair_lock(target_user_id)")
        < followMigration.indexOf('INSERT INTO public."Follow"'),
      "follow creation must take the shared block-pair lock before inserting",
    );
    assert.ok(
      followMigration.indexOf('FROM public."Block" AS relationship')
        < followMigration.indexOf('INSERT INTO public."Follow"'),
      "follow creation must reject reciprocal blocks while holding the pair lock",
    );
  });
});
