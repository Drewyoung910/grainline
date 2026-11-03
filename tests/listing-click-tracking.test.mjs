import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { isListingNavigationHref } = await import("../src/lib/listingClickTracking.ts");

describe("listing click tracking", () => {
  it("counts only same-site listing destinations", () => {
    const base = "https://thegrainline.com/browse";
    assert.equal(isListingNavigationHref("/listing/abc-handmade-chair", base), true);
    assert.equal(isListingNavigationHref("https://thegrainline.com/listing/abc?from=home", base), true);
    assert.equal(isListingNavigationHref("/seller/maker", base), false);
    assert.equal(isListingNavigationHref("https://example.com/listing/abc", base), false);
    assert.equal(isListingNavigationHref("not a valid % URL", base), false);
  });

  it("requires the clicked element to belong to a listing link", () => {
    const tracker = readFileSync("src/components/ClickTracker.tsx", "utf8");
    assert.match(tracker, /target\.closest<HTMLAnchorElement>\("a\[href\]"\)/);
    assert.match(tracker, /event\.currentTarget\.contains\(link\)/);
    assert.match(tracker, /isListingNavigationHref/);
    assert.match(tracker, /keepalive: true/);
  });
});
