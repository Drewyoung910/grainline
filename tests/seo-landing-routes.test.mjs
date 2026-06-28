import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("SEO landing route guardrails", () => {
  it("adds a canonical listing tag page backed by public listing visibility", () => {
    const page = source("src/app/tag/[slug]/page.tsx");

    assert.match(page, /normalizeTag\(rawSlug\)/);
    assert.match(page, /const requestedPage = parseBoundedPositiveIntParam\(sp\.page, 1, 500\)/);
    assert.match(page, /permanentRedirect\(`\$\{publicTagPath\(tag\)\}\$\{requestedPage > 1 \? `\?page=\$\{requestedPage\}` : ""\}`\)/);
    assert.match(page, /where: publicListingWhere\(\{/);
    assert.match(page, /tags: \{ has: tag \}/);
    assert.match(page, /getBlockedSellerProfileIdsFor\(meDbId\)/);
    assert.match(page, /getSellerRatingMap/);
    assert.match(page, /ListingCard/);
    assert.doesNotMatch(page, /status: "ACTIVE"/);
  });

  it("adds a canonical maker blog-author page without trusting slug-only identifiers", () => {
    const page = source("src/app/blog/author/[slug]/page.tsx");

    assert.match(page, /import \{ cache \} from "react"/);
    assert.match(page, /const getPublicBlogAuthor = cache\(async \(sellerProfileId: string\) =>/);
    assert.match(page, /extractRouteId\(slug\)/);
    assert.match(page, /publicBlogAuthorPath\(author\.id, author\.displayName\)/);
    assert.match(page, /activeSellerProfileWhere\(\{/);
    assert.match(page, /blogPosts: \{ some: publicBlogPostWhere\(\{ sellerProfileId \}\) \}/);
    assert.match(page, /publicBlogPostWhere\(\{ sellerProfileId: author\.id \}\)/);
    assert.match(page, /getBlockedUserIdsFor\(meDbId\)/);
    assert.ok(
      page.indexOf("getBlockedUserIdsFor(meDbId)") < page.indexOf("permanentRedirect("),
      "blocked author viewers should 404 before canonical slug redirects",
    );
    assert.match(page, /const requestedPage = parseBoundedPositiveIntParam\(sp\.page, 1, 500\)/);
    assert.match(page, /permanentRedirect\(`\$\{canonicalPath\}\$\{requestedPage > 1 \? `\?page=\$\{requestedPage\}` : ""\}`\)/);
    assert.match(page, /const page = Math\.min\(requestedPage, totalPages\)/);
    assert.doesNotMatch(page, /sellerProfileId: slug/);
  });

  it("wires discoverable author and tag links to canonical landing routes", () => {
    assert.match(source("src/components/BlogSearchBar.tsx"), /publicBlogAuthorPath\(s\.sellerProfileId, s\.label\)/);
    assert.match(source("src/app/blog/[slug]/page.tsx"), /publicBlogAuthorPath\(post\.sellerProfile\.id, authorName\)/);
    assert.match(source("src/app/listing/[id]/page.tsx"), /href=\{publicTagPath\(t\.toLowerCase\(\)\)\}/);
    assert.match(source("src/app/page.tsx"), /href=\{publicTagPath\(tag\)\}/);
    assert.match(source("src/middleware.ts"), /"\/tag\(\.\*\)"/);
  });

  it("keeps tag and author sitemap additions capped in the base sitemap", () => {
    const sitemap = source("src/app/sitemap.ts");

    assert.match(sitemap, /const TAG_LANDING_SITEMAP_LIMIT = 100/);
    assert.match(sitemap, /const BLOG_AUTHOR_LANDING_SITEMAP_LIMIT = 100/);
    assert.match(sitemap, /const BLOG_AUTHOR_LANDING_SOURCE_LIMIT = 500/);
    assert.match(sitemap, /getPopularListingTags\(TAG_LANDING_SITEMAP_LIMIT\)/);
    assert.match(sitemap, /take: BLOG_AUTHOR_LANDING_SOURCE_LIMIT/);
    assert.match(sitemap, /publicTagPath\(tag\)/);
    assert.match(sitemap, /publicBlogAuthorPath\(id, author\.displayName\)/);
    assert.match(sitemap, /assertSitemapEntryLimit\(\[/);
  });
});
