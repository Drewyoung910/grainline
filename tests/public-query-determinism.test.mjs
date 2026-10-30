import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

function getMethodSource(path, method) {
  const text = source(path);
  const start = text.indexOf(`export async function ${method}`);
  assert.notEqual(start, -1, `${path} must define ${method}`);
  const rest = text.slice(start);
  const nextMethod = rest.search(/\nexport async function (GET|POST|PUT|PATCH|DELETE)\b/);
  return nextMethod === -1 ? rest : rest.slice(0, nextMethod);
}

describe("public query determinism", () => {
  it("keeps the materialized favorite ordering index aligned with public sorts", () => {
    const schema = source("prisma/schema.prisma");
    assert.match(
      schema,
      /@@index\(\[favoriteCount\(sort: Desc\), createdAt\(sort: Desc\), id\(sort: Desc\)\]\)/,
    );
  });

  it("applies blog relevant-search filters before the raw ranked cap", () => {
    const blogPage = source("src/app/blog/page.tsx");
    const blogSearch = source("src/app/api/blog/search/route.ts");

    assert.match(blogPage, /const typeSql = typeValid \? Prisma\.sql`AND "BlogPost"\.type = \$\{typeFilter\}::"BlogPostType"` : Prisma\.empty/);
    assert.match(blogPage, /const tagsSql = tagsFilter\.length > 0[\s\S]*"BlogPost"\.tags && ARRAY\[\$\{Prisma\.join\(tagsFilter\)\}\]::text\[\]/);
    assert.match(blogPage, /const authorSql = authorFilter \? Prisma\.sql`AND "BlogPost"\."sellerProfileId" = \$\{authorFilter\}` : Prisma\.empty/);
    assert.ok(blogPage.indexOf("${typeSql}") < blogPage.indexOf("LIMIT 500"));
    assert.ok(blogPage.indexOf("${tagsSql}") < blogPage.indexOf("LIMIT 500"));
    assert.ok(blogPage.indexOf("${authorSql}") < blogPage.indexOf("LIMIT 500"));
    assert.match(blogPage, /"BlogPost"\."publishedAt" DESC,\s*"BlogPost"\.id DESC/);

    assert.match(blogSearch, /const typeSql = typeValid \? Prisma\.sql`AND bp\.type = \$\{type\}::"BlogPostType"` : Prisma\.empty/);
    assert.match(blogSearch, /const tagsSql = tags\.length > 0[\s\S]*bp\.tags && ARRAY\[\$\{Prisma\.join\(tags\)\}\]::text\[\]/);
    assert.ok(blogSearch.indexOf("${typeSql}") < blogSearch.indexOf("LIMIT 500"));
    assert.ok(blogSearch.indexOf("${tagsSql}") < blogSearch.indexOf("LIMIT 500"));
    assert.match(blogSearch, /bp\."publishedAt" DESC,\s*bp\.id DESC/);
  });

  it("keeps public capped queries and score sorts stable on ties", () => {
    const home = source("src/app/page.tsx");
    const browse = source("src/app/browse/page.tsx");
    const sellerShop = source("src/app/seller/[id]/shop/page.tsx");
    const sellerPage = source("src/app/seller/[id]/page.tsx");
    const listingPage = source("src/app/listing/[id]/page.tsx");
    const tagPage = source("src/app/tag/[slug]/page.tsx");
    const metroPage = source("src/app/browse/[metroSlug]/page.tsx");
    const metroCategoryPage = source("src/app/browse/[metroSlug]/[category]/page.tsx");
    const blogDetail = source("src/app/blog/[slug]/page.tsx");
    const similar = source("src/app/api/listings/[id]/similar/route.ts");
    const similarMakers = source("src/components/SimilarMakers.tsx");
    const sellersMap = source("src/app/sellers/map/page.tsx");
    const publicMap = source("src/app/map/page.tsx");
    const makersMetro = source("src/app/makers/[metroSlug]/page.tsx");
    const sellerPublicMapAuthority = source(
      "prisma/migrations/20261019010000_prepare_seller_profile_public_map_authority/migration.sql",
    );
    const sellerPublicSimilarMakersAuthority = source(
      "prisma/migrations/20261019080000_prepare_seller_profile_public_similar_makers/migration.sql",
    );
    const sellerPublicFeaturedMakersAuthority = source(
      "prisma/migrations/20261019090000_prepare_seller_profile_public_featured_makers/migration.sql",
    );
    const sellerPublicMetroDirectoryAuthority = source(
      "prisma/migrations/20261019110000_prepare_seller_profile_public_metro_directory/migration.sql",
    );
    const sellerActorSimilarListingAuthority = source(
      "prisma/migrations/20261020235987_prepare_seller_profile_similar_listing_candidates/migration.sql",
    );

    assert.match(home, /sellerPublicFeaturedMakers\(\)/);
    assert.match(
      sellerPublicFeaturedMakersAuthority,
      /ORDER BY \(active\.profile\)\."featuredUntil" DESC,[\s\S]*\(active\.profile\)\.id ASC/,
    );
    assert.match(
      sellerPublicFeaturedMakersAuthority,
      /ORDER BY COALESCE\(summary\."reviewCount", 0\) DESC,[\s\S]*\(active\.profile\)\.id ASC[\s\S]*LIMIT 4/,
    );
    assert.match(home, /orderBy: \[\{ updatedAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(home, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(home, /orderBy: \[\{ qualityScore: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(home, /where: publicBlogPostWhere\(\{\s*\.\.\.\(blockedUserIds\.size > 0/);
    assert.match(home, /sellerProfileId: \{ notIn: blockedSellerIds \}/);
    assert.doesNotMatch(home, /status: "PUBLISHED",\s*author: \{ banned: false, deletedAt: null \}/);
    assert.match(home, /orderBy: \[\{ publishedAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(home, /featuredById = new Map\(featuredRows\.map\(\(listing\) => \[listing\.id, listing\]\)\)/);

    assert.match(browse, /\[\{ qualityScore: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /sort === "price_asc" \? \[\{ priceCents: "asc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /sort === "price_desc" \? \[\{ priceCents: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /sort === "popular" \? \[\{ favoriteCount: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /const featuredRows = await fetchListings\(\s*publicListingWhere\(\s*blockedSellerIds\.length > 0 \? \{ sellerId: \{ notIn: blockedSellerIds \} \} : \{\},\s*\),\s*\[\{ favoriteCount: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /const featured = await hydrateSellerCards\(meDbId, featuredRows\)/);
    assert.match(browse, /b\.listing\.createdAt\.getTime\(\) - a\.listing\.createdAt\.getTime\(\)/);
    assert.match(browse, /b\.listing\.id\.localeCompare\(a\.listing\.id\)/);

    for (const text of [sellerShop]) {
      assert.match(text, /sort === "price_asc" \? \[\{ priceCents: "asc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
      assert.match(text, /sort === "price_desc" \? \[\{ priceCents: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
      assert.match(text, /sort === "popular" \? \[\{ favoriteCount: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
      assert.match(text, /: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    }

    assert.match(sellerPage, /orderBy: \[\{ updatedAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(sellerPage, /orderBy: \[\{ sentAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(sellerPage, /orderBy: \[\{ publishedAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(sellerPage, /orderBy: \[\{ review: \{ createdAt: "desc" \} \}, \{ id: "desc" \}\]/);

    assert.match(listingPage, /orderBy: \[\{ qualityScore: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(listingPage, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);

    assert.match(tagPage, /orderBy: \[\{ qualityScore: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(metroPage, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(metroPage, /orderBy: \[\{ _count: \{ category: "desc" \} \}, \{ category: "asc" \}\]/);
    assert.match(metroPage, /orderBy: \[\{ name: "asc" \}, \{ slug: "asc" \}\]/);
    assert.match(metroPage, /href=\{`\/browse\?lat=\$\{metro\.latitude\}&lng=\$\{metro\.longitude\}&radius=50`\}/);
    assert.doesNotMatch(metroPage, /\/browse\?lat=\$\{metro\.id\}/);
    assert.match(metroPage, /const blockedSellerListingWhere: Prisma\.ListingWhereInput/);
    assert.match(metroPage, /const listingWhere = publicListingWhere\(\{[\s\S]*\.\.\.blockedSellerListingWhere/);
    assert.match(metroPage, /sellerPublicMetroCount\(meDbId, metro\.id, isMajorMetro, false\)/);
    assert.match(metroPage, /listings: \{ some: publicListingWhere\(blockedSellerListingWhere\) \}/);
    assert.match(metroPage, /listingCityMetros: \{ some: publicListingWhere\(blockedSellerListingWhere\) \}/);
    assert.match(metroCategoryPage, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(metroCategoryPage, /const \[metros, majorGroups, cityGroups\] = await Promise\.all/);
    assert.match(metroCategoryPage, /prisma\.listing\.groupBy\(\{[\s\S]*by: \["metroId", "category"\]/);
    assert.match(metroCategoryPage, /prisma\.listing\.groupBy\(\{[\s\S]*by: \["cityMetroId", "category"\]/);
    assert.doesNotMatch(metroCategoryPage, /for \(const metro of metros\)[\s\S]*await prisma\.listing\.groupBy/);
    for (const metroText of [metroPage, metroCategoryPage]) {
      assert.ok(
        metroText.indexOf("const [listings") < metroText.indexOf("ownerFavoriteListingIds(meDbId, listingIds)"),
        "metro favorites should be scoped after the capped page listings are known",
      );
      assert.match(metroText, /const listingIds = listings\.map\(\(listing\) => listing\.id\)/);
      assert.match(metroText, /ownerFavoriteListingIds\(meDbId, listingIds\)/);
    }
    assert.match(blogDetail, /orderBy: \[\{ publishedAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(makersMetro, /sellerPublicMetroStaticSlugs\(\)/);
    assert.match(makersMetro, /sellerPublicMetroMakers\(meDbId, metro\.id, isMajorMetro, 24\)/);
    assert.match(makersMetro, /sellerPublicNearbyMetros\(meDbId, metro\.id\)/);
    assert.doesNotMatch(makersMetro, /prisma\.sellerProfile/);
    assert.match(
      sellerPublicMetroDirectoryAuthority,
      /ORDER BY \([\s\S]*FROM public\."Follow" AS follower[\s\S]*\) DESC,\s*seller\.id ASC\s+LIMIT p_limit/,
    );
    assert.match(
      sellerPublicMetroDirectoryAuthority,
      /ORDER BY listing\."createdAt" DESC, listing\.id DESC\s+LIMIT 1/,
    );
    assert.match(
      sellerPublicMetroDirectoryAuthority,
      /ORDER BY candidates\.name ASC, candidates\.slug ASC/,
    );

    assert.match(similar, /sellerActorSimilarListingCandidates\(viewerUserId, id\)/);
    assert.match(similar, /b\.createdAt\.getTime\(\) - a\.createdAt\.getTime\(\)/);
    assert.match(similar, /b\.id\.localeCompare\(a\.id\)/);
    assert.match(sellerActorSimilarListingAuthority, /listing\."createdAt" DESC,\s*listing\.id DESC/);
    assert.match(sellerActorSimilarListingAuthority, /LEFT JOIN LATERAL/);
    assert.match(
      sellerActorSimilarListingAuthority,
      /row_number\(\) OVER \(\s*ORDER BY photo\."sortOrder" ASC, photo\.id ASC\s*\)/,
    );
    assert.doesNotMatch(sellerActorSimilarListingAuthority, /\(SELECT photo\.url FROM public\."Photo" AS photo/);

    assert.match(similarMakers, /sellerPublicSimilarMakers\(/);
    assert.doesNotMatch(similarMakers, /prisma\.sellerProfile/);
    assert.match(
      sellerPublicSimilarMakersAuthority,
      /ORDER BY listing\."qualityScore" DESC, listing\.id DESC/,
    );
    assert.match(
      sellerPublicSimilarMakersAuthority,
      /ORDER BY photo\."sortOrder" ASC\s+LIMIT 1/,
    );
    assert.match(
      sellerPublicSimilarMakersAuthority,
      /ORDER BY candidates\.scope_priority ASC,[\s\S]*candidates\."guildLevel"::public\."GuildLevel" DESC,[\s\S]*candidates\.follower_count DESC,[\s\S]*candidates\.id ASC\s+LIMIT p_limit/,
    );

    assert.match(sellersMap, /sellerPublicMapPoints\(meDbId, 500\)/);
    assert.match(sellerPublicMapAuthority, /ORDER BY seller\.id ASC\s+LIMIT p_limit/);
    assert.match(sellerPublicMapAuthority, /FROM public\."Block" AS relationship/);
    assert.match(publicMap, /const MAP_SELLER_POINT_LIMIT = 500/);
    assert.match(publicMap, /sellerPublicMapMetros\(meDbId\)/);
    assert.doesNotMatch(publicMap, /activeSellerProfileWhere|sellerProfiles:|sellerCityProfiles:/);
    assert.match(publicMap, /sellerPublicMapPoints\(\s*meDbId,\s*MAP_SELLER_POINT_LIMIT/);
    assert.match(sellerPublicMapAuthority, /ORDER BY seller\.id ASC\s+LIMIT p_limit/);
  });

  it("filters browse geo seller pre-pass by public seller and listing visibility", () => {
    const browse = source("src/app/browse/page.tsx");
    const sellerPublicBrowseAuthority = source(
      "prisma/migrations/20261019030000_prepare_seller_profile_public_browse_authority/migration.sql",
    );

    assert.match(browse, /sellerPublicBrowseNearbySellerIds\(/);
    assert.match(sellerPublicBrowseAuthority, /FROM public\."SellerProfile" AS seller/);
    assert.match(sellerPublicBrowseAuthority, /seller\."chargesEnabled" = true/);
    assert.match(sellerPublicBrowseAuthority, /seller\."stripeAccountSupported" = true/);
    assert.match(sellerPublicBrowseAuthority, /seller\."vacationMode" = false/);
    assert.match(sellerPublicBrowseAuthority, /seller\."ownerAccountActive" = true/);
    assert.doesNotMatch(sellerPublicBrowseAuthority, /JOIN "User"/);
    assert.match(sellerPublicBrowseAuthority, /FROM public\."Block" AS relationship/);
    assert.match(sellerPublicBrowseAuthority, /EXISTS \(\s*SELECT 1\s*FROM public\."Listing" AS listing/);
    assert.match(sellerPublicBrowseAuthority, /listing\."sellerId" = seller\.id/);
    assert.match(sellerPublicBrowseAuthority, /listing\.status::text = 'ACTIVE'/);
    assert.match(sellerPublicBrowseAuthority, /listing\."isPrivate" = false/);
    assert.match(sellerPublicBrowseAuthority, /seller\.lat/);
    assert.match(sellerPublicBrowseAuthority, /seller\.lng/);
    assert.match(sellerPublicBrowseAuthority, /ORDER BY public_points\.id ASC/);
  });

  it("orders equal-count public tag caps by tag", () => {
    const sellerPage = source("src/app/seller/[id]/page.tsx");
    const tagAuthority = source("prisma/migrations/20261019060000_prepare_seller_profile_public_marketplace_counts/migration.sql");

    assert.equal((tagAuthority.match(/ORDER BY pg_catalog\.count\(\*\) DESC, tags\.tag ASC/gu) ?? []).length, 3);
    assert.match(sellerPage, /getCachedPublicSellerTopTags\(seller\.id\)/);
    assert.match(source("src/lib/popularTags.ts"), /sellerPublicSellerTags\(sellerId, PUBLIC_SELLER_TOP_TAG_LIMIT\)/);
  });

  it("reuses cached popular blog tag rows outside full blog search", () => {
    const popularBlogTags = source("src/lib/popularBlogTags.ts");
    const blogPage = source("src/app/blog/page.tsx");
    const blogSuggestions = source("src/app/api/blog/search/suggestions/route.ts");

    assert.match(popularBlogTags, /export const getPopularBlogTagRows = unstable_cache/);
    assert.match(popularBlogTags, /tags: \[POPULAR_BLOG_TAGS_CACHE_TAG\]/);
    assert.match(blogPage, /getPopularBlogTagRows\(20\)/);
    assert.doesNotMatch(blogPage, /unnest\(bp\.tags\) as tag/);
    assert.match(blogSuggestions, /getPopularBlogTags\(200\)/);
    assert.doesNotMatch(blogSuggestions, /unnest\(bp\.tags\) AS tag/);
  });

  it("keeps public search suggestion caps stable on ties", () => {
    const searchSuggestions = source("src/app/api/search/suggestions/route.ts");
    const blogSuggestions = source("src/app/api/blog/search/suggestions/route.ts");
    const sellerPublicNameAuthority = source(
      "prisma/migrations/20261019040000_prepare_seller_profile_public_name_authority/migration.sql",
    );

    assert.match(searchSuggestions, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(searchSuggestions, /sellerPublicNameSuggestions\(meDbId, q, normalizedDisplayNameQuery, true, 2\)/);
    assert.match(sellerPublicNameAuthority, /ORDER BY seller\."displayNameNormalized" ASC, seller\.id ASC\s+LIMIT p_limit/);
    assert.match(
      searchSuggestions,
      /ORDER BY ranked\.sim DESC, ranked\.created_at DESC, ranked\.id DESC\s*LIMIT 2/,
    );
    assert.match(searchSuggestions, /ORDER BY similarity\(bp\.title, \$\{q\}\) DESC, bp\."publishedAt" DESC, bp\.id DESC\s*LIMIT 3/);

    assert.match(blogSuggestions, /ORDER BY similarity\(bp\.title, \$\{q\}\) DESC, bp\."publishedAt" DESC, bp\.id DESC\s*LIMIT 5/);
    assert.match(blogSuggestions, /getPopularBlogTags\(200\)[\s\S]*\.slice\(0, 5\)/);
    assert.match(blogSuggestions, /sellerPublicNameSuggestions\(meDbId, q, normalizedDisplayNameQuery, false, 3\)/);
    assert.match(sellerPublicNameAuthority, /ORDER BY seller\."displayNameNormalized" ASC, seller\.id ASC\s+LIMIT p_limit/);
  });

  it("keeps cached homepage featured makers on the bounded authority", () => {
    const homePage = source("src/app/page.tsx");
    const sellerAccess = source("src/lib/sellerProfilePublicAccess.ts");

    assert.match(homePage, /sellerPublicFeaturedMakers\(\)/);
    assert.match(homePage, /type FeaturedMaker = SellerPublicFeaturedMaker/);
    assert.doesNotMatch(homePage, /prisma\.sellerProfile/);
    assert.match(sellerAccess, /export type SellerPublicFeaturedMaker = Readonly/);
    assert.match(sellerAccess, /grainline_seller_public_featured_makers\(\)/);
  });

  it("keeps public fuzzy suggestions on indexable trigram predicates", () => {
    const searchSuggestions = source("src/app/api/search/suggestions/route.ts");
    const blogSuggestions = source("src/app/api/blog/search/suggestions/route.ts");

    for (const text of [searchSuggestions, blogSuggestions]) {
      assert.match(text, /set_config\('pg_trgm\.similarity_threshold'/);
      assert.match(text, /true\)/, "trigram threshold setting should be transaction-local");
      assert.match(text, /bp\.title % \$\{q\}/);
      assert.match(text, /similarity\(bp\.title, \$\{q\}\) > \$\{BLOG_FUZZY_SUGGESTION_MIN_SIMILARITY\}/);
      assert.doesNotMatch(text, /SET\s+pg_trgm\.similarity_threshold/i);
    }

    assert.match(searchSuggestions, /l\.title % \$\{q\}/);
    assert.match(searchSuggestions, /similarity\(l\.title, \$\{q\}\) > \$\{LISTING_FUZZY_SUGGESTION_MIN_SIMILARITY\}/);
  });

  it("keeps public blog pagination stable on standard sorts", () => {
    const blogPage = source("src/app/blog/page.tsx");
    const blogSearch = source("src/app/api/blog/search/route.ts");
    const blogApi = source("src/app/api/blog/route.ts");

    for (const text of [blogPage, blogSearch]) {
      assert.match(text, /sort === "alpha" \? \[\{ title: "asc" \}, \{ publishedAt: "desc" \}, \{ id: "desc" \}\] : \[\{ publishedAt: "desc" \}, \{ id: "desc" \}\]/);
    }
    assert.match(blogApi, /const orderBy: Prisma\.BlogPostOrderByWithRelationInput\[\] = \[\{ publishedAt: "desc" \}, \{ id: "desc" \}\]/);
  });

  it("bounds and tie-breaks remaining public capped query surfaces", () => {
    const home = source("src/app/page.tsx");
    const followPreparation = source(
      process.env.FOLLOW_PREPARATION_MIGRATION_PATH
        ? `${process.env.FOLLOW_PREPARATION_MIGRATION_PATH}/migration.sql`
        : "prisma/migrations/20261028020000_prepare_follow_authorities/migration.sql",
    );
    const tagPage = source("src/app/tag/[slug]/page.tsx");
    const authorPage = source("src/app/blog/author/[slug]/page.tsx");
    const customerPhotosPage = source("src/app/seller/[id]/customer-photos/page.tsx");
    const footerMetros = source("src/lib/footerMetros.ts");
    const publicSellerStats = source("src/lib/publicSellerStats.ts");
    const publicOrderAuthority = source(
      "prisma/migrations/20260901050000_prepare_order_public_aggregate_authority/migration.sql",
    );
    const sellerPublicFooterMetroAuthority = source(
      "prisma/migrations/20261019120000_prepare_seller_profile_public_footer_metros/migration.sql",
    );
    const blogCommentLimits = source("src/lib/blogCommentLimits.ts");
    const blogCommentApi = source("src/app/api/blog/[slug]/comments/route.ts");
    const blogDetail = source("src/app/blog/[slug]/page.tsx");
    const reviewsSection = source("src/components/ReviewsSection.tsx");

    const featuredBlockStart = home.indexOf("const featuredRows = await prisma.listing.findMany");
    const featuredBlockEnd = home.indexOf("const featuredById", featuredBlockStart);
    const featuredFetchBlock = home.slice(featuredBlockStart, featuredBlockEnd);
    assert.ok(featuredBlockStart >= 0 && featuredBlockEnd > featuredBlockStart);
    assert.doesNotMatch(featuredFetchBlock, /take:\s*3/);
    assert.match(home, /ownerFollowedSellerIds\(meDbId, 50\)/);
    assert.match(
      followPreparation,
      /grainline_follow_owner_target_ids[\s\S]*ORDER BY relationship\."createdAt" DESC, relationship\.id DESC[\s\S]*LIMIT p_limit/,
    );

    assert.match(tagPage, /const requestedPage = parseBoundedPositiveIntParam\(sp\.page, 1, 500\)/);
    assert.match(tagPage, /const page = Math\.min\(requestedPage, totalPages\)/);
    assert.match(tagPage, /skip: \(page - 1\) \* TAG_PAGE_SIZE/);
    assert.doesNotMatch(tagPage, /if \(page > totalPages\) return notFound\(\)/);

    assert.match(authorPage, /const requestedPage = parseBoundedPositiveIntParam\(sp\.page, 1, 500\)/);
    assert.match(authorPage, /const page = Math\.min\(requestedPage, totalPages\)/);
    assert.match(authorPage, /orderBy: \[\{ publishedAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(authorPage, /skip: \(page - 1\) \* AUTHOR_POST_PAGE_SIZE/);
    assert.doesNotMatch(authorPage, /if \(page > totalPages\) return notFound\(\)/);

    assert.match(customerPhotosPage, /const requestedPage = parseBoundedPositiveIntParam\(sp\.page, 1, 500\)/);
    assert.match(customerPhotosPage, /const page = Math\.min\(requestedPage, totalPages\)/);
    assert.match(customerPhotosPage, /orderBy: \[\{ review: \{ createdAt: "desc" \} \}, \{ id: "desc" \}\]/);
    assert.match(customerPhotosPage, /skip: \(page - 1\) \* PAGE_SIZE/);
    assert.match(customerPhotosPage, /Page \{page\} of \{totalPages\}/);

    assert.match(footerMetros, /sellerPublicFooterMetros\(\)/);
    assert.match(
      sellerPublicFooterMetroAuthority,
      /ORDER BY \([\s\S]*FROM public\."Listing" AS listing[\s\S]*\) DESC,\s*metro\.name ASC,\s*metro\.slug ASC\s+LIMIT 10/,
    );
    assert.match(publicSellerStats, /getPublicSellerOrderStats/u);
    assert.match(publicOrderAuthority, /ORDER BY source_order\."shippedAt" DESC, source_order\.id DESC/);
    assert.match(publicOrderAuthority, /LIMIT 30/);

    assert.match(blogCommentLimits, /TOP_LEVEL_BLOG_COMMENT_LIMIT = 100/);
    assert.match(blogCommentLimits, /BLOG_REPLY_COMMENT_LIMIT = 50/);
    assert.match(blogCommentLimits, /BLOG_NESTED_REPLY_COMMENT_LIMIT = 25/);
    for (const text of [blogCommentApi, blogDetail]) {
      assert.match(text, /orderBy: \[\{ createdAt: "asc" \}, \{ id: "asc" \}\]/);
      assert.match(text, /take: TOP_LEVEL_BLOG_COMMENT_LIMIT/);
      assert.match(text, /take: BLOG_REPLY_COMMENT_LIMIT/);
      assert.match(text, /take: BLOG_NESTED_REPLY_COMMENT_LIMIT/);
    }

    assert.match(reviewsSection, /const LISTING_REVIEW_DISPLAY_LIMIT = 100/);
    assert.match(reviewsSection, /function reviewOrderByForSort/);
    assert.match(reviewsSection, /return \[\{ helpfulCount: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(reviewsSection, /return \[\{ photos: \{ _count: "desc" \} \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(reviewsSection, /orderBy: reviewOrderByForSort\(sort\)/);
    assert.match(reviewsSection, /take: LISTING_REVIEW_DISPLAY_LIMIT/);
    assert.doesNotMatch(reviewsSection, /others\.slice\(\)\.sort/);
  });

  it("clamps public paged queries before fetching or rendering", () => {
    const browse = source("src/app/browse/page.tsx");
    const sellerShop = source("src/app/seller/[id]/shop/page.tsx");
    const blogPage = source("src/app/blog/page.tsx");
    const blogSearch = source("src/app/api/blog/search/route.ts");
    const blogApi = source("src/app/api/blog/route.ts");
    const commissionPage = source("src/app/commission/page.tsx");
    const commissionDetail = source("src/app/commission/[param]/page.tsx");
    const commissionApi = source("src/app/api/commission/route.ts");
    const commissionDetailApi = getMethodSource("src/app/api/commission/[id]/route.ts", "GET");

    assert.match(browse, /const relevantPage = Math\.min\(Math\.max\(pageNum, 1\), relevantTotalPages\)/);
    assert.match(browse, /const standardPage = Math\.min\(Math\.max\(pageNum, 1\), standardTotalPages\)/);
    assert.match(
      browse,
      /const listingRows = await fetchListings\(\s*where,\s*orderBy,\s*PAGE_SIZE,\s*\(standardPage - 1\) \* PAGE_SIZE,?\s*\)/s,
    );
    assert.match(browse, /listings = await hydrateSellerCards\(meDbId, listingRows\)/);

    assert.match(sellerShop, /const clampedPage = Math\.min\(Math\.max\(page, 1\), totalPages\)/);
    assert.match(sellerShop, /skip: \(clampedPage - 1\) \* PAGE_SIZE/);
    assert.match(sellerShop, /Page \{clampedPage\} of \{totalPages\}/);

    assert.match(blogPage, /const relevantPage = Math\.min\(Math\.max\(page, 1\), relevantTotalPages\)/);
    assert.match(blogPage, /const standardPage = Math\.min\(Math\.max\(page, 1\), standardTotalPages\)/);
    assert.match(blogPage, /const clampedPage = Math\.min\(Math\.max\(page, 1\), Math\.max\(1, totalPages\)\)/);
    assert.match(blogPage, /Page \{clampedPage\} of \{totalPages\}/);

    for (const text of [blogSearch, blogApi]) {
      assert.match(text, /const clampedPage = Math\.min\(Math\.max\(page, 1\), Math\.max\(1, totalPages\)\)/);
      assert.match(text, /page: clampedPage/);
    }

    assert.match(commissionPage, /const requestedPage = parseBoundedPositiveIntParam\(sp\.page, 1, 1000\)/);
    assert.doesNotMatch(commissionPage, /Number\.parseInt\(sp\.page/);
    assert.match(commissionPage, /page = Math\.min\(requestedPage, Math\.max\(1, Math\.ceil\(total \/ pageSize\)\)\)/);
    assert.match(commissionPage, /\(page - 1\) \* pageSize/);
    assert.match(commissionPage, /Page \{page\} of \{totalPages\}/);
    assert.match(commissionPage, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\],\s*skip: \(page - 1\) \* pageSize,\s*take: pageSize/);
    assert.match(commissionPage, /cr\."createdAt" DESC,\s*cr\.id DESC/);

    assert.match(commissionDetail, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\],\s*take: 500/);
    assert.match(commissionDetail, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\],\s*take: 20/);
    assert.match(commissionDetail, /publicCommissionInterestCounts\(\[request\.id\], meId\)/);
    assert.match(commissionDetail, /publicCommissionInterestCards\(request\.id, meId, COMMISSION_INTEREST_DISPLAY_LIMIT\)/);
    assert.doesNotMatch(commissionDetail, /sellerProfile: \{\s*chargesEnabled: true,\s*vacationMode: false,\s*user: \{ banned: false, deletedAt: null \}/s);

    assert.match(commissionApi, /const currentPage = Math\.min\(page, Math\.max\(1, Math\.ceil\(total \/ pageSize\)\)\)/);
    assert.match(commissionApi, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "asc" \}\]/);
    assert.match(commissionApi, /skip: \(currentPage - 1\) \* pageSize/);
    assert.match(commissionApi, /page: currentPage/);

    assert.match(commissionDetailApi, /prisma\.commissionRequest\.findFirst\(\{/);
    assert.match(commissionDetailApi, /where: openCommissionWhere\(\{[\s\S]*id,[\s\S]*buyerId: \{ notIn: \[\.\.\.blockedUserIds\] \}/);
    assert.doesNotMatch(commissionDetailApi, /prisma\.commissionRequest\.findUnique\(\{\s*where: \{ id \}/);
    assert.doesNotMatch(commissionDetailApi, /request\.buyer\.banned \|\| request\.buyer\.deletedAt/);
    assert.match(commissionDetailApi, /interests: interests\.map\(\(interest\) => \(\{/);
    assert.match(commissionDetailApi, /publicCommissionInterestCards\(request\.id, meId, COMMISSION_INTEREST_DISPLAY_LIMIT\)/);
  });

  it("normalizes public browse tag query params before filtering and preserving them", () => {
    const browse = source("src/app/browse/page.tsx");
    const filterSidebar = source("src/components/FilterSidebar.tsx");
    const mobileFilterBar = source("src/components/MobileFilterBar.tsx");

    assert.match(browse, /import \{ normalizeTags \} from "@\/lib\/tags"/);
    assert.match(browse, /const selectedTags = normalizeTags\(\s*rawTag == null \? \[\] : Array\.isArray\(rawTag\) \? rawTag : \[rawTag\],\s*10,\s*\)/);
    assert.match(browse, /where\.tags = \{ hasSome: selectedTags \}/);
    assert.doesNotMatch(browse, /selectedTags\.map\(\(t\) => t\.toLowerCase\(\)\)/);

    for (const component of [filterSidebar, mobileFilterBar]) {
      assert.match(component, /import \{ normalizeTags \} from "@\/lib\/tags"/);
      assert.match(component, /const selectedTags = normalizeTags\(searchParams\.getAll\("tag"\), 10\)/);
      assert.doesNotMatch(component, /const selectedTags = searchParams\.getAll\("tag"\)/);
    }
  });
});
