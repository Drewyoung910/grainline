import assert from "node:assert/strict";
import test from "node:test";

const { applyVersionBoundListingAiReviewTransition } = await import(
  "../src/lib/listingAiReviewTransition.ts"
);

function fakeClient(current) {
  return {
    listing: {
      async updateMany({ where, data }) {
        const matches = current.id === where.id
          && current.sellerId === where.sellerId
          && current.status === where.status
          && current.updatedAt.getTime() === where.updatedAt.getTime();
        if (!matches) return { count: 0 };
        Object.assign(current, data, { updatedAt: new Date(current.updatedAt.getTime() + 1) });
        return { count: 1 };
      },
    },
  };
}

test("a stale AI approval cannot activate content from a newer resubmission", async () => {
  const reviewedAt = new Date("2026-11-02T12:00:00.000Z");
  const current = {
    id: "listing_1",
    sellerId: "seller_1",
    status: "PENDING_REVIEW",
    updatedAt: new Date("2026-11-02T12:01:00.000Z"),
    title: "edited after review began",
  };

  const applied = await applyVersionBoundListingAiReviewTransition(fakeClient(current), {
    listingId: current.id,
    sellerId: current.sellerId,
    reviewedAt,
    status: "ACTIVE",
    flags: [],
    score: 0.99,
  });

  assert.equal(applied, false);
  assert.equal(current.status, "PENDING_REVIEW");
  assert.equal(current.title, "edited after review began");
});

test("the AI transition applies once to the exact reviewed listing version", async () => {
  const reviewedAt = new Date("2026-11-02T12:00:00.000Z");
  const current = {
    id: "listing_1",
    sellerId: "seller_1",
    status: "PENDING_REVIEW",
    updatedAt: reviewedAt,
  };

  const applied = await applyVersionBoundListingAiReviewTransition(fakeClient(current), {
    listingId: current.id,
    sellerId: current.sellerId,
    reviewedAt,
    status: "ACTIVE",
    flags: [],
    score: 0.99,
  });

  assert.equal(applied, true);
  assert.equal(current.status, "ACTIVE");
});

test("an authority returning more than one updated row fails closed", async () => {
  const client = { listing: { updateMany: async () => ({ count: 2 }) } };
  await assert.rejects(
    applyVersionBoundListingAiReviewTransition(client, {
      listingId: "listing_1",
      sellerId: "seller_1",
      reviewedAt: new Date("2026-11-02T12:00:00.000Z"),
      status: "ACTIVE",
      flags: [],
      score: 0.99,
    }),
    /invalid row count/,
  );
});
