import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  isRetryableAnonymousCartMergeStatus,
  mergeAnonymousCartItemsToAccount,
} = await import("../src/lib/anonymousCartMerge.ts");

function item(lineKey, title = lineKey) {
  return {
    lineKey,
    listingId: `listing_${lineKey}`,
    quantity: 1,
    selectedVariantOptionIds: [],
    addedAt: 1,
    snapshot: {
      title,
      sellerId: "seller_1",
      sellerName: "North Thread",
      priceCents: 12000,
    },
  };
}

describe("anonymous cart merge durability", () => {
  it("classifies auth, rate limit, and server failures as retryable", () => {
    for (const status of [undefined, null, 401, 408, 409, 425, 429, 500, 503, 599]) {
      assert.equal(isRetryableAnonymousCartMergeStatus(status), true, `status ${status} should retry`);
    }
    for (const status of [400, 403, 404, 410, 413, 422]) {
      assert.equal(isRetryableAnonymousCartMergeStatus(status), false, `status ${status} should be terminal`);
    }
  });

  it("preserves only retryable failed lines after a mixed merge", async () => {
    const items = [item("ok"), item("gone", "Sold-out chair"), item("retry", "Walnut shelf")];
    const result = await mergeAnonymousCartItemsToAccount(items, async (cartItem) => {
      if (cartItem.lineKey === "ok") return { ok: true };
      if (cartItem.lineKey === "gone") return { ok: false, status: 400, error: "This listing is not available." };
      return { ok: false, status: 503, error: "Please try again in a moment." };
    });

    assert.equal(result.mergedCount, 1);
    assert.equal(result.rejectedCount, 1);
    assert.equal(result.retryableFailure, true);
    assert.deepEqual(result.remainingItems.map((cartItem) => cartItem.lineKey), ["retry"]);
    assert.deepEqual(result.errors, ["This listing is not available.", "Please try again in a moment."]);
  });

  it("keeps thrown add failures retryable without losing successful lines", async () => {
    const items = [item("ok"), item("network")];
    const result = await mergeAnonymousCartItemsToAccount(items, async (cartItem) => {
      if (cartItem.lineKey === "ok") return { ok: true };
      throw new Error("offline");
    });

    assert.equal(result.mergedCount, 1);
    assert.equal(result.rejectedCount, 0);
    assert.equal(result.retryableFailure, true);
    assert.deepEqual(result.remainingItems.map((cartItem) => cartItem.lineKey), ["network"]);
    assert.deepEqual(result.errors, ["Saved cart items could not be restored right now."]);
  });
});
