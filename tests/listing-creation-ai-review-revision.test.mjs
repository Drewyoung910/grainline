import assert from "node:assert/strict";
import test from "node:test";

const { applyListingCreationAIReviewResult } = await import(
  "../src/lib/listingCreationAIReview.ts"
);

function listingClient(state) {
  return {
    listing: {
      async updateMany({ where, data }) {
        if (
          state.id !== where.id
          || state.sellerId !== where.sellerId
          || state.status !== where.status
          || state.updatedAt.getTime() !== where.updatedAt.getTime()
        ) {
          return { count: 0 };
        }
        Object.assign(state, data);
        return { count: 1 };
      },
    },
  };
}

test("creation-time AI approval cannot publish a newer listing revision", async () => {
  const reviewedAt = new Date("2026-10-27T12:00:00.000Z");
  const state = {
    id: "listing_1",
    sellerId: "seller_1",
    status: "PENDING_REVIEW",
    updatedAt: new Date("2026-10-27T12:00:01.000Z"),
    aiReviewFlags: ["prohibited content"],
    aiReviewScore: 0.1,
  };

  const result = await applyListingCreationAIReviewResult(listingClient(state), {
    listingId: state.id,
    sellerId: state.sellerId,
    reviewedUpdatedAt: reviewedAt,
    approved: true,
    flags: [],
    confidence: 0.99,
  });

  assert.deepEqual(result, { applied: false, activated: false });
  assert.equal(state.status, "PENDING_REVIEW");
  assert.deepEqual(state.aiReviewFlags, ["prohibited content"]);
  assert.equal(state.aiReviewScore, 0.1);
});

test("creation-time AI verdict applies to the exact reviewed revision", async () => {
  const reviewedAt = new Date("2026-10-27T12:00:00.000Z");
  const state = {
    id: "listing_1",
    sellerId: "seller_1",
    status: "PENDING_REVIEW",
    updatedAt: reviewedAt,
    aiReviewFlags: ["awaiting review"],
    aiReviewScore: 0,
  };

  const result = await applyListingCreationAIReviewResult(listingClient(state), {
    listingId: state.id,
    sellerId: state.sellerId,
    reviewedUpdatedAt: reviewedAt,
    approved: true,
    flags: [],
    confidence: 0.99,
  });

  assert.deepEqual(result, { applied: true, activated: true });
  assert.equal(state.status, "ACTIVE");
  assert.deepEqual(state.aiReviewFlags, []);
  assert.equal(state.aiReviewScore, 0.99);
});
