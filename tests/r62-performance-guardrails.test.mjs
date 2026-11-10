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

  it("keeps high-traffic card images responsive and dimensionally stable", () => {
    const listing = source("src/app/listing/[id]/page.tsx");
    const moreFrom = listing.slice(listing.indexOf("More from this maker"), listing.indexOf("Similar items"));
    assert.match(listing, /width=\{56\}[\s\S]*height=\{56\}[\s\S]*h-14 w-14/);
    assert.match(moreFrom, /<CardMediaImage[\s\S]*sizes="\(max-width: 639px\) 50vw, 25vw"/);
    assert.doesNotMatch(moreFrom, /originalUrl/);

    const home = source("src/app/page.tsx");
    // Spotlight avatar beside the name + also-featured avatar
    assert.equal(
      (home.match(/width=\{40\}\s*height=\{40\}\s*className="h-10 w-10/g) ?? []).length,
      2,
    );
    assert.match(home, /width=\{20\} height=\{20\} className="h-5 w-5/);

    const browse = source("src/app/browse/page.tsx");
    const listingCard = source("src/components/ListingCard.tsx");
    const cardMedia = source("src/components/CardMediaImage.tsx");
    assert.match(browse, /<ListingCard[\s\S]*variant="grid"/);
    assert.match(listingCard, /<CardMediaImage/);
    assert.match(listingCard, /sizes="\(max-width: 639px\) 50vw, \(max-width: 1023px\) 33vw, 25vw"/);
    assert.match(cardMedia, /<Image[\s\S]*fill[\s\S]*sizes=\{sizes\}/);
    assert.match(cardMedia, /onError=\{\(\) => setBypassOptimizer\(true\)\}/);
    assert.match(browse, /width=\{176\} height=\{220\} className="h-full w-full/);
  });
});
