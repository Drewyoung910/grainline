export const QUALITY_SCORE_SHORT_DESCRIPTION_CHARS = 50;
export const QUALITY_SCORE_MIN_PHOTO_COUNT = 2;

export const QUALITY_SCORE_PENALTIES = {
  missingDescription: 0.08,
  shortDescription: 0.04,
  missingPhotos: 0.08,
  lowPhotoCount: 0.04,
  moderationFlags: 0.08,
} as const;

const NON_PENALTY_AI_REVIEW_FLAGS = new Set(["pending-ai-review"]);

export function qualityPenaltyForListing(input: {
  descLength: number | null | undefined;
  photoCount: number | null | undefined;
  aiReviewFlags: string[] | null | undefined;
}) {
  const descLength = Math.max(0, input.descLength ?? 0);
  const photoCount = Math.max(0, input.photoCount ?? 0);
  const flags = (input.aiReviewFlags ?? [])
    .map((flag) => flag.trim())
    .filter((flag) => flag && !NON_PENALTY_AI_REVIEW_FLAGS.has(flag));

  let penalty = 0;
  if (descLength === 0) {
    penalty += QUALITY_SCORE_PENALTIES.missingDescription;
  } else if (descLength < QUALITY_SCORE_SHORT_DESCRIPTION_CHARS) {
    penalty += QUALITY_SCORE_PENALTIES.shortDescription;
  }

  if (photoCount === 0) {
    penalty += QUALITY_SCORE_PENALTIES.missingPhotos;
  } else if (photoCount < QUALITY_SCORE_MIN_PHOTO_COUNT) {
    penalty += QUALITY_SCORE_PENALTIES.lowPhotoCount;
  }

  if (flags.length > 0) {
    penalty += QUALITY_SCORE_PENALTIES.moderationFlags;
  }

  return penalty;
}
