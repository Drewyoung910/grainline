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
    const browse = source("src/app/browse/page.tsx");
    const sellerShop = source("src/app/seller/[id]/shop/page.tsx");
    const similar = source("src/app/api/listings/[id]/similar/route.ts");
    const sellersMap = source("src/app/sellers/map/page.tsx");

    assert.match(browse, /\[\{ qualityScore: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /sort === "price_asc" \? \[\{ priceCents: "asc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /sort === "price_desc" \? \[\{ priceCents: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /sort === "popular" \? \[\{ favorites: \{ _count: "desc" \} \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /orderBy: \[\{ favorites: \{ _count: "desc" \} \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /b\.listing\.createdAt\.getTime\(\) - a\.listing\.createdAt\.getTime\(\)/);
    assert.match(browse, /b\.listing\.id\.localeCompare\(a\.listing\.id\)/);

    for (const text of [sellerShop]) {
      assert.match(text, /sort === "price_asc" \? \[\{ priceCents: "asc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
      assert.match(text, /sort === "price_desc" \? \[\{ priceCents: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
      assert.match(text, /sort === "popular" \? \[\{ favorites: \{ _count: "desc" \} \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
      assert.match(text, /: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    }

    assert.match(similar, /l\."createdAt" DESC,\s*l\.id DESC/);
    assert.match(similar, /b\.createdAt\.getTime\(\) - a\.createdAt\.getTime\(\)/);
    assert.match(similar, /b\.id\.localeCompare\(a\.id\)/);

    assert.ok(
      sellersMap.indexOf('orderBy: { id: "asc" }') < sellersMap.indexOf("take: 500"),
      "sellers map should order before the cap",
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
    assert.match(source("src/app/blog/page.tsx"), /ORDER BY count DESC, tag ASC/);
    assert.match(source("src/app/seller/[id]/page.tsx"), /ORDER BY COUNT\(\*\) DESC, tag ASC/);
  });

  it("keeps public search suggestion caps stable on ties", () => {
    const searchSuggestions = source("src/app/api/search/suggestions/route.ts");
    const blogSuggestions = source("src/app/api/blog/search/suggestions/route.ts");

    assert.match(searchSuggestions, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(searchSuggestions, /orderBy: \[\{ displayNameNormalized: "asc" \}, \{ id: "asc" \}\]/);
    assert.match(searchSuggestions, /ORDER BY sim DESC, latest_created_at DESC, latest_id DESC\s*LIMIT 2/);
    assert.match(searchSuggestions, /ORDER BY similarity\(bp\.title, \$\{q\}\) DESC, bp\."publishedAt" DESC, bp\.id DESC\s*LIMIT 3/);

    assert.match(blogSuggestions, /ORDER BY similarity\(bp\.title, \$\{q\}\) DESC, bp\."publishedAt" DESC, bp\.id DESC\s*LIMIT 5/);
    assert.match(blogSuggestions, /ORDER BY tag ASC\s*LIMIT 5/);
    assert.match(blogSuggestions, /orderBy: \[\{ displayNameNormalized: "asc" \}, \{ id: "asc" \}\]/);
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

  it("clamps public paged queries before fetching or rendering", () => {
    const browse = source("src/app/browse/page.tsx");
    const sellerShop = source("src/app/seller/[id]/shop/page.tsx");
    const blogPage = source("src/app/blog/page.tsx");
    const blogSearch = source("src/app/api/blog/search/route.ts");
    const blogApi = source("src/app/api/blog/route.ts");

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
  });
});
