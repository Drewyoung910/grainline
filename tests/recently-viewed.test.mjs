import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { normalizeRecentlyViewedIds } = await import("../src/lib/recentlyViewed.ts");

describe("recently viewed cookie helpers", () => {
  it("keeps only unique non-empty string listing ids", () => {
    const ids = normalizeRecentlyViewedIds(["a", { id: "b" }, "b", "", 5, "a", "c"]);
    assert.deepEqual(ids, ["a", "b", "c"]);
  });

  it("caps the cookie payload to ten listing ids", () => {
    const ids = normalizeRecentlyViewedIds(Array.from({ length: 12 }, (_, index) => `listing-${index}`));
    assert.equal(ids.length, 10);
    assert.equal(ids.at(-1), "listing-9");
  });
});
