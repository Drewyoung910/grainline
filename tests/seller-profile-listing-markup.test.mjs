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
    assert.match(clickTracker, /<li className=\{className\} onClick=\{handleClick\}>/);
    assert.doesNotMatch(sellerPage, /<li\b[^>]*>\s*<ClickTracker\b/);
    assert.doesNotMatch(sellerPage, /<div\b[^>]*>\s*<ClickTracker\b/);

    const trackerOpenings = [...sellerPage.matchAll(/<ClickTracker\b/g)];
    assert.ok(trackerOpenings.length >= 6);
    for (const { index } of trackerOpenings) {
      const before = sellerPage
        .slice(0, index)
        .trimEnd()
        .replace(/\{[\w.]+\.map\(\([^)]*\) => \($/, "")
        .trimEnd();
      assert.match(
        before,
        /(<ul\b[^<>]*>|<\/ClickTracker>)$/,
        `ClickTracker at offset ${index} must sit directly in a <ul>`,
      );
    }
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

    assert.match(commissionBoard, /\{hasLocation && \(\s*<div className="flex gap-1 mb-6 border-b border-neutral-100">/);
    assert.doesNotMatch(commissionBoard, /border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50/);
    assert.equal(
      commissionBoard.match(/"bg-\[#EFEAE0\] text-neutral-800 hover:bg-\[#E3DCCB\]"/g)?.length,
      2,
    );

    assert.equal(metroCommissions.match(/Post a Commission Request/g)?.length, 2);
    assert.match(metroCommissions, /\{count > 0 && \(\s*<div className="mb-10">\s*<Link\s+href="\/commission\/new"/);
  });
});
