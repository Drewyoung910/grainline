import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("public query determinism", () => {
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
    const sellersMap = source("src/app/sellers/map/page.tsx");
    const publicMap = source("src/app/map/page.tsx");
    const makersMetro = source("src/app/makers/[metroSlug]/page.tsx");

    assert.match(home, /orderBy: \[\{ featuredUntil: "desc" \}, \{ id: "asc" \}\]/);
    assert.match(home, /ORDER BY COALESCE\(srs\."reviewCount", 0\) DESC, sp\.id ASC/);
    assert.match(home, /orderBy: \[\{ updatedAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(home, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(home, /orderBy: \[\{ qualityScore: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(home, /where: publicBlogPostWhere\(\{\s*\.\.\.\(blockedUserIds\.size > 0/);
    assert.doesNotMatch(home, /status: "PUBLISHED",\s*author: \{ banned: false, deletedAt: null \}/);
    assert.match(home, /orderBy: \[\{ publishedAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(home, /featuredById = new Map\(featuredRows\.map\(\(listing\) => \[listing\.id, listing\]\)\)/);

    assert.match(browse, /\[\{ qualityScore: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /sort === "price_asc" \? \[\{ priceCents: "asc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /sort === "price_desc" \? \[\{ priceCents: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /sort === "popular" \? \[\{ favorites: \{ _count: "desc" \} \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /orderBy: \[\{ favorites: \{ _count: "desc" \} \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /const featured = await prisma\.listing\.findMany\(\{\s*where: publicListingWhere\(\s*blockedSellerIds\.length > 0 \? \{ sellerId: \{ notIn: blockedSellerIds \} \} : \{\},\s*\)/);
    assert.match(browse, /b\.listing\.createdAt\.getTime\(\) - a\.listing\.createdAt\.getTime\(\)/);
    assert.match(browse, /b\.listing\.id\.localeCompare\(a\.listing\.id\)/);

    for (const text of [sellerShop]) {
      assert.match(text, /sort === "price_asc" \? \[\{ priceCents: "asc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
      assert.match(text, /sort === "price_desc" \? \[\{ priceCents: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
      assert.match(text, /sort === "popular" \? \[\{ favorites: \{ _count: "desc" \} \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
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
    assert.match(metroCategoryPage, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    for (const metroText of [metroPage, metroCategoryPage]) {
      assert.ok(
        metroText.indexOf("const [listings") < metroText.indexOf("const favs = await prisma.favorite.findMany"),
        "metro favorites should be scoped after the capped page listings are known",
      );
      assert.match(metroText, /const listingIds = listings\.map\(\(listing\) => listing\.id\)/);
      assert.match(metroText, /where: \{ userId: meDbId, listingId: \{ in: listingIds \} \}/);
    }
    assert.match(blogDetail, /orderBy: \[\{ publishedAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(makersMetro, /orderBy: \[\{ profileViews: "desc" \}, \{ id: "asc" \}\]/);
    assert.match(makersMetro, /listings: \{[\s\S]*orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\][\s\S]*take: 1/);
    assert.match(makersMetro, /orderBy: \[\{ name: "asc" \}, \{ slug: "asc" \}\]/);
    assert.match(makersMetro, /getBlockedSellerProfileIdsFor\(meDbId\)/);
    assert.match(makersMetro, /const sellerWhere = activeSellerProfileWhere\(\{\s*\.\.\.blockedSellerWhere/);
    assert.match(makersMetro, /const visibleSellerWhere = activeSellerProfileWhere\(blockedSellerWhere\)/);
    assert.match(makersMetro, /sellerProfiles: \{ some: visibleSellerWhere \}/);
    assert.match(makersMetro, /sellerCityProfiles: \{ some: visibleSellerWhere \}/);

    assert.match(similar, /l\."createdAt" DESC,\s*l\.id DESC/);
    assert.match(similar, /b\.createdAt\.getTime\(\) - a\.createdAt\.getTime\(\)/);
    assert.match(similar, /b\.id\.localeCompare\(a\.id\)/);

    assert.match(sellersMap, /getBlockedSellerProfileIdsFor\(meDbId\)/);
    assert.match(sellersMap, /\.\.\.\(blockedSellerIds\.length > 0 \? \{ id: \{ notIn: blockedSellerIds \} \} : \{\}\)/);
    assert.ok(
      sellersMap.indexOf('orderBy: { id: "asc" }') < sellersMap.indexOf("take: 500"),
      "sellers map should order before the cap",
    );
    assert.match(publicMap, /const MAP_SELLER_POINT_LIMIT = 500/);
    assert.match(publicMap, /const visibleSellerWhere = activeSellerProfileWhere\(/);
    assert.match(publicMap, /sellerProfiles: \{\s*some: visibleSellerWhere/);
    assert.match(publicMap, /sellerCityProfiles: \{\s*some: visibleSellerWhere/);
    assert.match(publicMap, /\.\.\.visibleSellerWhere/);
    assert.ok(
      publicMap.indexOf('orderBy: { id: "asc" }') < publicMap.indexOf("take: MAP_SELLER_POINT_LIMIT"),
      "public map should order before the cap",
    );
  });

  it("filters browse geo seller pre-pass by public seller and listing visibility", () => {
    const browse = source("src/app/browse/page.tsx");
    const geoStart = browse.indexOf("const blockedSellerGeoSql");
    const geoEnd = browse.indexOf("sellerIdFilters.push(rows.map((r) => r.id));", geoStart);
    const geoBlock = browse.slice(geoStart, geoEnd);

    assert.match(geoBlock, /FROM "SellerProfile" sp/);
    assert.match(geoBlock, /INNER JOIN "User" u ON u\.id = sp\."userId"/);
    assert.match(geoBlock, /sp\."chargesEnabled" = true/);
    assert.match(geoBlock, /sp\."stripeAccountVersion" IS NULL OR sp\."stripeAccountVersion" = 'v2'/);
    assert.match(geoBlock, /sp\."vacationMode" = false/);
    assert.match(geoBlock, /u\.banned = false/);
    assert.match(geoBlock, /u\."deletedAt" IS NULL/);
    assert.match(geoBlock, /blockedSellerGeoSql/);
    assert.match(geoBlock, /EXISTS \(\s*SELECT 1\s*FROM "Listing" l/);
    assert.match(geoBlock, /l\."sellerId" = sp\.id/);
    assert.match(geoBlock, /l\.status = 'ACTIVE'::"ListingStatus"/);
    assert.match(geoBlock, /l\."isPrivate" = false/);
    assert.match(geoBlock, /sp\.lat::float/);
    assert.match(geoBlock, /sp\.lng::float/);
  });

  it("orders equal-count public tag caps by tag", () => {
    assert.match(source("src/lib/popularTags.ts"), /ORDER BY count DESC, tag ASC/);
    assert.match(source("src/lib/popularBlogTags.ts"), /ORDER BY count DESC, tag ASC/);
    assert.match(source("src/app/seller/[id]/page.tsx"), /ORDER BY COUNT\(\*\) DESC, tag ASC/);
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

    assert.match(searchSuggestions, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(searchSuggestions, /orderBy: \[\{ displayNameNormalized: "asc" \}, \{ id: "asc" \}\]/);
    assert.match(searchSuggestions, /ORDER BY sim DESC, latest_created_at DESC, latest_id DESC\s*LIMIT 2/);
    assert.match(searchSuggestions, /ORDER BY similarity\(bp\.title, \$\{q\}\) DESC, bp\."publishedAt" DESC, bp\.id DESC\s*LIMIT 3/);

    assert.match(blogSuggestions, /ORDER BY similarity\(bp\.title, \$\{q\}\) DESC, bp\."publishedAt" DESC, bp\.id DESC\s*LIMIT 5/);
    assert.match(blogSuggestions, /getPopularBlogTags\(200\)[\s\S]*\.slice\(0, 5\)/);
    assert.match(blogSuggestions, /orderBy: \[\{ displayNameNormalized: "asc" \}, \{ id: "asc" \}\]/);
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
    const tagPage = source("src/app/tag/[slug]/page.tsx");
    const authorPage = source("src/app/blog/author/[slug]/page.tsx");
    const customerPhotosPage = source("src/app/seller/[id]/customer-photos/page.tsx");
    const footerMetros = source("src/lib/footerMetros.ts");
    const publicSellerStats = source("src/lib/publicSellerStats.ts");
    const blogCommentLimits = source("src/lib/blogCommentLimits.ts");
    const blogCommentApi = source("src/app/api/blog/[slug]/comments/route.ts");
    const blogDetail = source("src/app/blog/[slug]/page.tsx");
    const reviewsSection = source("src/components/ReviewsSection.tsx");

    const featuredBlockStart = home.indexOf("const featuredRows = await prisma.listing.findMany");
    const featuredBlockEnd = home.indexOf("const featuredById", featuredBlockStart);
    const featuredFetchBlock = home.slice(featuredBlockStart, featuredBlockEnd);
    assert.ok(featuredBlockStart >= 0 && featuredBlockEnd > featuredBlockStart);
    assert.doesNotMatch(featuredFetchBlock, /take:\s*3/);
    assert.match(home, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\],\s*take: 50/);

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

    assert.match(footerMetros, /orderBy: \[\{ listings: \{ _count: "desc" \} \}, \{ name: "asc" \}, \{ slug: "asc" \}\]/);
    assert.match(publicSellerStats, /ORDER BY o\."shippedAt" DESC, o\.id DESC/);

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
    const commissionDetailApi = source("src/app/api/commission/[id]/route.ts");

    assert.match(browse, /const relevantPage = Math\.min\(Math\.max\(pageNum, 1\), relevantTotalPages\)/);
    assert.match(browse, /const standardPage = Math\.min\(Math\.max\(pageNum, 1\), standardTotalPages\)/);
    assert.match(browse, /fetchListings\(where, orderBy, PAGE_SIZE, \(standardPage - 1\) \* PAGE_SIZE, false\)/);

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
    assert.match(commissionDetail, /sellerProfile: activeSellerProfileWhere\(\)/);
    assert.match(commissionDetail, /orderBy: \[\{ createdAt: "asc" \}, \{ id: "asc" \}\],\s*take: COMMISSION_INTEREST_DISPLAY_LIMIT/);
    assert.doesNotMatch(commissionDetail, /sellerProfile: \{\s*chargesEnabled: true,\s*vacationMode: false,\s*user: \{ banned: false, deletedAt: null \}/s);

    assert.match(commissionApi, /const currentPage = Math\.min\(page, Math\.max\(1, Math\.ceil\(total \/ pageSize\)\)\)/);
    assert.match(commissionApi, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "asc" \}\]/);
    assert.match(commissionApi, /skip: \(currentPage - 1\) \* pageSize/);
    assert.match(commissionApi, /page: currentPage/);

    assert.match(commissionDetailApi, /orderBy: \[\{ createdAt: "asc" \}, \{ id: "asc" \}\]/);
    assert.doesNotMatch(commissionDetailApi, /orderBy: \{ createdAt: "asc" \}/);
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
