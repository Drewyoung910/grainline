import assert from "node:assert/strict";
import test from "node:test";

import {
  hasInvalidPublicCatalogPriceRange,
  isPublicCatalogTagCandidate,
} from "../src/lib/listingPublicCatalogFilter.ts";

test("catalog price bounds treat minimum above maximum as an empty search", () => {
  assert.equal(hasInvalidPublicCatalogPriceRange(2_000, 1_000), true);
  assert.equal(hasInvalidPublicCatalogPriceRange(1_000, 1_000), false);
  assert.equal(hasInvalidPublicCatalogPriceRange(1_000, 2_000), false);
  assert.equal(hasInvalidPublicCatalogPriceRange(undefined, 2_000), false);
  assert.equal(hasInvalidPublicCatalogPriceRange(1_000, undefined), false);
});

test("catalog tag candidates reject one malformed stored tag without rejecting the page", () => {
  assert.equal(isPublicCatalogTagCandidate("furniture"), true);
  assert.equal(isPublicCatalogTagCandidate("🪵".repeat(24)), true);
  assert.equal(isPublicCatalogTagCandidate("🪵".repeat(25)), false);
  assert.equal(isPublicCatalogTagCandidate(""), false);
  assert.equal(isPublicCatalogTagCandidate(null), false);
});
