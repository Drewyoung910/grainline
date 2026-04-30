import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { resolvedInterestedCount } = await import("../src/lib/commissionInterestCount.ts");

describe("commission interest counts", () => {
  it("prefers the live relation count over a denormalized counter", () => {
    assert.equal(
      resolvedInterestedCount({
        interestedCount: 12,
        _count: { interests: 3 },
      }),
      3,
    );
  });

  it("falls back to the stored count for legacy callers without _count", () => {
    assert.equal(resolvedInterestedCount({ interestedCount: 7 }), 7);
    assert.equal(resolvedInterestedCount({}), 0);
  });
});
