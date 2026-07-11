import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("R62 performance guardrails", () => {
  it("keeps listing detail seller ratings on the cached summary table", () => {
    const text = source("src/app/listing/[id]/page.tsx");

    assert.match(text, /import \{ getSellerRatingMap \} from "@\/lib\/sellerRatingSummary"/);
    assert.match(text, /getSellerRatingMap\(\[listing\.sellerId\]\)/);
    assert.doesNotMatch(text, /sellerRatingAgg/);
    assert.doesNotMatch(text, /where:\s*\{\s*listing:\s*\{\s*sellerId: listing\.sellerId/s);
  });

  it("keeps high-traffic raw images dimensioned to reduce layout shift", () => {
    const listing = source("src/app/listing/[id]/page.tsx");
    assert.match(listing, /width=\{56\}[\s\S]*height=\{56\}[\s\S]*h-14 w-14/);
    assert.match(listing, /width=\{320\}[\s\S]*height=\{400\}[\s\S]*w-full h-full object-cover/);

    const home = source("src/app/page.tsx");
    // Spotlight identity-chip avatar + also-featured avatar (2026-07-11 layout)
    assert.match(home, /width=\{36\}[\s\S]*height=\{36\}[\s\S]*h-9 w-9/);
    assert.match(home, /width=\{40\}[\s\S]*height=\{40\}[\s\S]*h-10 w-10/);
    assert.match(home, /width=\{20\} height=\{20\} className="h-5 w-5/);

    const browse = source("src/app/browse/page.tsx");
    assert.match(browse, /width=\{288\}[\s\S]*height=\{144\}[\s\S]*h-36 w-full/);
    assert.match(browse, /width=\{176\} height=\{220\} className="h-full w-full/);
  });
});
