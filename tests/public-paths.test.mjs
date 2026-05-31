import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  extractRouteId,
  publicListingPath,
  publicSellerPath,
  publicSellerShopPath,
  slugifyPathSegment,
} = await import("../src/lib/publicPaths.ts");

const source = readFileSync("src/lib/publicPaths.ts", "utf8");

describe("public path helpers", () => {
  it("normalizes readable path segments with diacritics", () => {
    assert.equal(slugifyPathSegment("Café Crème Cutting Board"), "cafe-creme-cutting-board");
    assert.equal(slugifyPathSegment("  Walnut   & Oak  "), "walnut-oak");
  });

  it("falls back to stable hash slugs for non-Latin labels", () => {
    const first = slugifyPathSegment("家具");
    const second = slugifyPathSegment("家具");
    assert.match(first, /^item-[a-z0-9]+$/);
    assert.equal(first, second);
  });

  it("uses a wider stable hash for non-readable fallback slugs", () => {
    assert.match(source, /FNV_64_OFFSET/);
    assert.match(source, /FNV_64_PRIME/);
    assert.match(source, /FNV_64_MASK/);
    assert.doesNotMatch(source, /2166136261|16777619|>>> 0/);
  });

  it("builds slugged listing and seller paths while preserving the database id prefix", () => {
    assert.equal(publicListingPath("clisting123", "Café Table"), "/listing/clisting123--cafe-table");
    assert.equal(publicSellerPath("cseller123", "Miller & Sons"), "/seller/cseller123--miller-sons");
    assert.equal(publicSellerShopPath("cseller123", "Miller & Sons"), "/seller/cseller123--miller-sons/shop");
  });

  it("extracts ids from legacy and slugged route segments", () => {
    assert.equal(extractRouteId("clisting123"), "clisting123");
    assert.equal(extractRouteId("clisting123--cafe-table"), "clisting123");
  });

  it("rejects malformed slug-only route segments instead of querying them as ids", () => {
    assert.equal(extractRouteId("--evil-slug"), "");
    assert.equal(extractRouteId("../evil"), "");
    assert.equal(extractRouteId(""), "");
  });
});
