import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

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
    assert.match(blocks, /for \(const block of blockedByMe\) ids\.add\(block\.blockedId\)/);
    assert.match(blocks, /for \(const block of blockingMe\) ids\.add\(block\.blockerId\)/);
  });

  it("derives blocked seller profile ids from blocked user ids", () => {
    const blocks = source("src/lib/blocks.ts");

    assert.match(blocks, /getBlockedSellerProfileIdsFor/);
    assert.match(blocks, /userId: \{ in: \[\.\.\.blockedUserIds\] \}/);
    assert.match(blocks, /return sellers\.map\(s => s\.id\)/);
    assert.match(blocks, /getBlockedIdsFor/);
    assert.match(blocks, /return \{ blockedUserIds, blockedSellerIds: sellers\.map\(s => s\.id\) \}/);
  });
});
