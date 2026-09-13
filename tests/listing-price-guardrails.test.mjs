import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  MAX_LISTING_PRICE_CENTS,
  listingPriceMaxError,
} = await import("../src/lib/listingPrice.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("listing price guardrails", () => {
  it("uses one listing price cap across listing write paths", () => {
    assert.equal(MAX_LISTING_PRICE_CENTS, 10_000_000);
    assert.equal(listingPriceMaxError(MAX_LISTING_PRICE_CENTS), null);
    assert.equal(listingPriceMaxError(MAX_LISTING_PRICE_CENTS + 1), "Price cannot exceed $100,000.");
  });

  it("applies the listing price cap to create, edit, and custom listings", () => {
    for (const path of [
      "src/app/dashboard/listings/new/page.tsx",
      "src/app/dashboard/listings/[id]/edit/page.tsx",
      "src/app/dashboard/listings/custom/page.tsx",
    ]) {
      const text = source(path);
      assert.match(text, /import \{ listingPriceMaxError \} from "@\/lib\/listingPrice"/);
      assert.match(text, /const priceMaxError = listingPriceMaxError\(priceCents\)/);
      assert.match(text, /if \(priceMaxError\) return \{ ok: false, error: priceMaxError \}/);
    }
  });

  it("keeps variant unit-price validation aligned with the listing cap", () => {
    const variants = source("src/lib/listingVariants.ts");
    assert.match(variants, /import \{ MAX_LISTING_PRICE_CENTS \} from "\.\/listingPrice\.ts"/);
    assert.match(variants, /export const MAX_VARIANT_UNIT_PRICE_CENTS = MAX_LISTING_PRICE_CENTS/);
  });
});
