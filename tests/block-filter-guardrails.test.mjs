import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  blockedUserIdsFromRows,
  sellerProfileIdsFromRows,
} = await import("../src/lib/blockFilterState.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("block filter guardrails", () => {
  it("builds blocked user sets from both directions and excludes deleted participants", () => {
    const blocks = source("src/lib/blocks.ts");

    assert.match(blocks, /blockerId: meId/);
    assert.match(blocks, /blockedId: meId/);
    assert.match(blocks, /blocker: \{ deletedAt: null \}/);
    assert.match(blocks, /blocked: \{ deletedAt: null \}/);
    const blocked = blockedUserIdsFromRows({
      blockedByMe: [{ blockedId: "user_b" }, { blockedId: "user_c" }],
      blockingMe: [{ blockerId: "user_d" }, { blockerId: "user_b" }],
    });

    assert.deepEqual([...blocked].sort(), ["user_b", "user_c", "user_d"]);
  });

  it("derives blocked seller profile ids from blocked user ids", () => {
    const blocks = source("src/lib/blocks.ts");

    assert.match(blocks, /getBlockedSellerProfileIdsFor/);
    assert.match(blocks, /userId: \{ in: \[\.\.\.blockedUserIds\] \}/);
    assert.match(blocks, /sellerProfileIdsFromRows\(sellers\)/);
    assert.match(blocks, /getBlockedIdsFor/);
    assert.match(blocks, /blockedSellerIds: sellerProfileIdsFromRows\(sellers\)/);
    assert.deepEqual(sellerProfileIdsFromRows([{ id: "seller_1" }, { id: "seller_2" }]), [
      "seller_1",
      "seller_2",
    ]);
  });
});
