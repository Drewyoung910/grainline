import { createHash } from "node:crypto";
import { truncateText } from "./sanitize.ts";

export const BANNED_SELLER_REVIEW_NOTE =
  "Seller account was banned after payment. Staff must review fulfillment and refund options before further action.";

export type BanReviewNoteSnapshot = {
  previousReviewNeeded: boolean;
  previousReviewNoteHash: string | null;
  previousReviewNoteLength: number;
  addedReviewNote?: boolean;
};

export function reviewNoteSnapshot(note: string | null) {
  if (!note) return { previousReviewNoteHash: null, previousReviewNoteLength: 0 };
  return {
    previousReviewNoteHash: createHash("sha256").update(note).digest("hex"),
    previousReviewNoteLength: Array.from(note).length,
  };
}

function reviewNoteMatchesSnapshot(
  note: string | null,
  snapshot: Pick<BanReviewNoteSnapshot, "previousReviewNoteHash" | "previousReviewNoteLength">,
) {
  const current = reviewNoteSnapshot(note);
  return (
    current.previousReviewNoteHash === snapshot.previousReviewNoteHash &&
    current.previousReviewNoteLength === snapshot.previousReviewNoteLength
  );
}

export function appendBannedSellerReviewNote(existing: string | null) {
  if (!existing) {
    return { reviewNote: BANNED_SELLER_REVIEW_NOTE, addedReviewNote: true };
  }
  if (existing.includes(BANNED_SELLER_REVIEW_NOTE)) {
    return { reviewNote: existing, addedReviewNote: false };
  }
  return {
    reviewNote: truncateText(`${existing}\n\n${BANNED_SELLER_REVIEW_NOTE}`, 5000),
    addedReviewNote: true,
  };
}

export function restoreOrderReviewStateAfterBan(input: {
  currentReviewNeeded: boolean;
  currentReviewNote: string | null;
  snapshot: BanReviewNoteSnapshot;
}) {
  if (input.snapshot.addedReviewNote === false) return null;

  if (
    input.currentReviewNote === BANNED_SELLER_REVIEW_NOTE &&
    reviewNoteMatchesSnapshot(null, input.snapshot)
  ) {
    return {
      reviewNeeded: input.snapshot.previousReviewNeeded,
      reviewNote: null,
    };
  }

  const suffix = `\n\n${BANNED_SELLER_REVIEW_NOTE}`;
  if (input.currentReviewNote?.endsWith(suffix)) {
    const previousNote = input.currentReviewNote.slice(0, -suffix.length);
    if (reviewNoteMatchesSnapshot(previousNote, input.snapshot)) {
      return {
        reviewNeeded: input.snapshot.previousReviewNeeded,
        reviewNote: previousNote,
      };
    }
  }

  return null;
}
