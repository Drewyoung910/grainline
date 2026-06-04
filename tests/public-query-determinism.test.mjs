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
    const similar = source("src/app/api/listings/[id]/similar/route.ts");
    const sellersMap = source("src/app/sellers/map/page.tsx");

    assert.match(browse, /\[\{ qualityScore: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(browse, /b\.listing\.createdAt\.getTime\(\) - a\.listing\.createdAt\.getTime\(\)/);
    assert.match(browse, /b\.listing\.id\.localeCompare\(a\.listing\.id\)/);

    assert.match(similar, /l\."createdAt" DESC,\s*l\.id DESC/);
    assert.match(similar, /b\.createdAt\.getTime\(\) - a\.createdAt\.getTime\(\)/);
    assert.match(similar, /b\.id\.localeCompare\(a\.id\)/);

    assert.ok(
      sellersMap.indexOf('orderBy: { id: "asc" }') < sellersMap.indexOf("take: 500"),
      "sellers map should order before the cap",
    );
  });

  it("orders equal-count public tag caps by tag", () => {
    assert.match(source("src/lib/popularTags.ts"), /ORDER BY count DESC, tag ASC/);
    assert.match(source("src/lib/popularBlogTags.ts"), /ORDER BY count DESC, tag ASC/);
    assert.match(source("src/app/blog/page.tsx"), /ORDER BY count DESC, tag ASC/);
    assert.match(source("src/app/seller/[id]/page.tsx"), /ORDER BY COUNT\(\*\) DESC, tag ASC/);
  });
});
