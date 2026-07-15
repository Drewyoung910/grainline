import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("homepage deterministic query guardrails", () => {
  it("orders capped homepage map rows deterministically", () => {
    const home = source("src/app/page.tsx");
    const publicMapOptIn = home.indexOf("publicMapOptIn: true");
    const mapQueryStart = home.lastIndexOf("prisma.sellerProfile.findMany({", publicMapOptIn);
    const mapQueryEnd = home.indexOf("prisma.blogPost.findMany({", mapQueryStart);

    assert.notEqual(mapQueryStart, -1, "homepage map query should exist");
    assert.notEqual(mapQueryEnd, -1, "homepage map query should end before the blog query");
    const mapQuery = home.slice(mapQueryStart, mapQueryEnd);

    assert.match(mapQuery, /publicMapOptIn: true/);
    assert.ok(
      mapQuery.indexOf('orderBy: { id: "asc" }') < mapQuery.indexOf("take: 200"),
      "homepage map rows should have a stable order before the 200-row cap",
    );
  });

  it("keeps the static homepage hero free of decoration-only database work", () => {
    const home = source("src/app/page.tsx");

    assert.match(home, /src="\/hero-maple-cabinets\.jpg"/);
    assert.doesNotMatch(home, /HeroMosaic|mosaicListings|heroCollagePhotos/);
    assert.doesNotMatch(home, /getPopularListingTags|trendingTagsRaw|statsResults/);
    assert.doesNotMatch(home, /prisma\.listing\.count|prisma\.user\.count|paidStripeOrderWhere/);
  });

  it("keeps featured maker thumbnail listings on shared public visibility filters", () => {
    const home = source("src/app/page.tsx");
    const start = home.indexOf("async function getFeaturedMakerBlock");
    const block = home.slice(start, home.indexOf("const CATEGORIES", start));

    assert.match(block, /where: publicListingWhere\(\{\s*id: \{ in: maker\.featuredListingIds \},\s*sellerId: maker\.id,\s*photos: \{ some: \{\} \},\s*\}\),/);
    assert.match(block, /where: publicListingWhere\(\{\s*sellerId: maker\.id,\s*photos: \{ some: \{\} \},\s*\.\.\.\(existingIds\.length > 0 \? \{ id: \{ notIn: existingIds \} \} : \{\}\),\s*\}\),/);
    assert.doesNotMatch(block, /status: "ACTIVE"/);
    assert.doesNotMatch(block, /isPrivate: false/);
  });

  it("merges followed-maker listing and blog items by recency before slicing", () => {
    const home = source("src/app/page.tsx");

    assert.match(home, /import \{ compareAccountFeedItemsDesc \} from "@\/lib\/accountFeedCursor"/);
    assert.match(home, /prisma\.follow\.findMany\(\{[\s\S]*orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\][\s\S]*take: 50/);
    assert.match(home, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(home, /orderBy: \[\{ publishedAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(home, /kind: "listing", id: l\.id, date: l\.createdAt\.toISOString\(\)/);
    assert.match(home, /kind: "blog", id: p\.id, date: \(p\.publishedAt \?\? new Date\(0\)\)\.toISOString\(\)/);
    assert.match(home, /fromYourMakers = merged\.sort\(compareAccountFeedItemsDesc\)\.slice\(0, 6\)/);
    assert.doesNotMatch(home, /fromYourMakers = merged\.slice\(0, 6\)/);
  });
});
