import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  BANNED_SELLER_REVIEW_NOTE,
  appendBannedSellerReviewNote,
  restoreOrderReviewStateAfterBan,
  reviewNoteSnapshot,
} = await import("../src/lib/banOrderReviewState.ts");

describe("ban order review state", () => {
  it("appends the banned-seller note once and records whether it changed the note", () => {
    assert.deepEqual(appendBannedSellerReviewNote(null), {
      reviewNote: BANNED_SELLER_REVIEW_NOTE,
      addedReviewNote: true,
    });
    assert.deepEqual(appendBannedSellerReviewNote(BANNED_SELLER_REVIEW_NOTE), {
      reviewNote: BANNED_SELLER_REVIEW_NOTE,
      addedReviewNote: false,
    });
    assert.deepEqual(appendBannedSellerReviewNote("Existing staff note"), {
      reviewNote: `Existing staff note\n\n${BANNED_SELLER_REVIEW_NOTE}`,
      addedReviewNote: true,
    });
  });

  it("restores the ban-added review note only when the current note matches the snapshot", () => {
    const snapshot = {
      previousReviewNeeded: false,
      ...reviewNoteSnapshot("Existing staff note"),
      addedReviewNote: true,
    };

    assert.deepEqual(
      restoreOrderReviewStateAfterBan({
        currentReviewNeeded: true,
        currentReviewNote: `Existing staff note\n\n${BANNED_SELLER_REVIEW_NOTE}`,
        snapshot,
      }),
      { reviewNeeded: false, reviewNote: "Existing staff note" },
    );
    assert.equal(
      restoreOrderReviewStateAfterBan({
        currentReviewNeeded: true,
        currentReviewNote: `Changed staff note\n\n${BANNED_SELLER_REVIEW_NOTE}`,
        snapshot,
      }),
      null,
    );
  });

  it("does not clear pre-existing ban notes that the ban action did not add", () => {
    assert.equal(
      restoreOrderReviewStateAfterBan({
        currentReviewNeeded: true,
        currentReviewNote: BANNED_SELLER_REVIEW_NOTE,
        snapshot: {
          previousReviewNeeded: true,
          ...reviewNoteSnapshot(BANNED_SELLER_REVIEW_NOTE),
          addedReviewNote: false,
        },
      }),
      null,
    );
  });
});
