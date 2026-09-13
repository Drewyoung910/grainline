import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  reviewNoteSnapshot,
} = await import("../src/lib/banOrderReviewState.ts");

describe("ban order review state", () => {
  it("creates privacy-preserving UTF-8 note fingerprints for legacy metadata", () => {
    assert.deepEqual(reviewNoteSnapshot(null), {
      previousReviewNoteHash: null,
      previousReviewNoteLength: 0,
    });
    assert.deepEqual(reviewNoteSnapshot(""), {
      previousReviewNoteHash: null,
      previousReviewNoteLength: 0,
    });
    assert.deepEqual(reviewNoteSnapshot("Existing staff note"), {
      previousReviewNoteHash: "feeb26c681914983a994ef56f77456f34f1cc0ea1158921341df3777bef81cae",
      previousReviewNoteLength: 19,
    });
  });
});
