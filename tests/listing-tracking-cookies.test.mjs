import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { parseTrackingIds } = await import("../src/lib/listingTrackingCookies.ts");

describe("listing tracking cookie helpers", () => {
  it("deduplicates parsed tracking ids before applying the cookie cap", () => {
    const ids = parseTrackingIds("a,b,a, c ,,b,d");

    assert.deepEqual(ids, ["a", "b", "c", "d"]);
  });

  it("caps unique tracking ids at the aggregate cookie limit", () => {
    const ids = Array.from({ length: 60 }, (_, index) => `id-${index}`).join(",");

    assert.equal(parseTrackingIds(ids).length, 50);
  });
});
