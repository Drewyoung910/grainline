import { createHash } from "node:crypto";

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
