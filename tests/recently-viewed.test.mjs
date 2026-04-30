import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { normalizeRecentlyViewedIds, recentlyViewedAuthTransition } = await import("../src/lib/recentlyViewed.ts");

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

  it("clears recently viewed state on sign-out or user switch", () => {
    assert.deepEqual(
      recentlyViewedAuthTransition({ previousUserId: "user_a", currentUserId: null }),
      { shouldClear: true, nextUserId: null },
    );
    assert.deepEqual(
      recentlyViewedAuthTransition({ previousUserId: "user_a", currentUserId: "user_b" }),
      { shouldClear: true, nextUserId: "user_b" },
    );
    assert.deepEqual(
      recentlyViewedAuthTransition({ previousUserId: "user_a", currentUserId: "user_a" }),
      { shouldClear: false, nextUserId: "user_a" },
    );
    assert.deepEqual(
      recentlyViewedAuthTransition({ previousUserId: null, currentUserId: "user_a" }),
      { shouldClear: false, nextUserId: "user_a" },
    );
  });
});
