import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("seller profile and commission UI markup guardrails", () => {
  it("never nests ClickTracker's <li> inside another <li> or a bare <div>", () => {
    const clickTracker = source("src/components/ClickTracker.tsx");
    const sellerPage = source("src/app/seller/[id]/page.tsx");

    // ClickTracker supplies the list item itself, so callers must place it
    // directly in a <ul>/<ol>. li-in-li broke hydration (React error #418)
    // and a <div> parent showed a stray list bullet.
    assert.match(clickTracker, /<li className=\{className\} data-flip-id=\{flipId\} onClick=\{handleClick\}>/);
    assert.doesNotMatch(sellerPage, /<li\b[^>]*>\s*<ClickTracker\b/);
    assert.doesNotMatch(sellerPage, /<div\b[^>]*>\s*<ClickTracker\b/);

    const trackerOpenings = [...sellerPage.matchAll(/<ClickTracker\b/g)];
    // Featured and ordinary listings are map-rendered, so each source opening
    // represents a whole collection rather than one hard-coded card.
    assert.equal(trackerOpenings.length, 2);
    assert.match(
      sellerPage,
      /<ul\b[^>]*>\s*\{fallbackFeatured\.slice\(0, 3\)\.map\(\(listing\) => \(\s*<ClickTracker\b/,
    );
    assert.match(
      sellerPage,
      /<ul\b[^>]*>\s*\{listings\.map\(\(l\) => \(\s*<ClickTracker\b/,
    );
  });

  it("renders the maker bio once and hides controls with nothing to act on", () => {
    const sellerPage = source("src/app/seller/[id]/page.tsx");
    const reviews = source("src/components/ReviewsSection.tsx");
    const similarMakers = source("src/components/SimilarMakers.tsx");
    const commissionBoard = source("src/app/commission/page.tsx");
    const metroCommissions = source("src/app/commission/[param]/page.tsx");

    assert.doesNotMatch(sellerPage, />\s*\{seller\.bio\}\s*</);
    assert.equal(sellerPage.match(/<ExpandableText text=\{seller\.bio\}/g)?.length, 1);

    assert.match(reviews, /\{others\.length > 0 && \(\s*<div className="flex flex-wrap items-center gap-2 text-sm">/);
    assert.doesNotMatch(similarMakers, /state\.toUpperCase\(\)/);
    assert.match(similarMakers, /US_STATES\.find\(/);

    // The All / Near me toggle still only shows when "Near me" is possible.
    assert.match(commissionBoard, /\{hasLocation && \(\s*<div className="shrink-0 self-start lg:self-auto">\s*<SegmentedControl\s+label="Requests"/);
    assert.doesNotMatch(commissionBoard, /border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50/);
    assert.equal(
      commissionBoard.match(/"bg-\[#EFEAE0\] text-neutral-800 hover:bg-\[#E3DCCB\]"/g)?.length,
      2,
    );

    assert.equal(metroCommissions.match(/Post a request/g)?.length, 2);
    assert.match(metroCommissions, /\{count > 0 && \(\s*<div className="mb-10">\s*<Link\s+href="\/commission\/new"/);
  });

  it("keeps a maker's curated Featured Work when they pick fewer than three pieces", () => {
    const sellerPage = source("src/app/seller/[id]/page.tsx");

    assert.match(
      sellerPage,
      /if \(fallbackFeatured\.length === 0\) return null;/,
      "a maker's curated one- or two-piece feature set should not disappear",
    );
    assert.match(
      sellerPage,
      /if \(featuredListings\.length === 0 && fallbackFeatured\.length < 3\) return null;/,
      "only the automatic repeated-listings fallback should wait for a full row",
    );
  });
});
