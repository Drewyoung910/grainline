import { sanitizeText, truncateText } from "./sanitize.ts";

export type PhotoAltTextBackfillPhoto = {
  id: string;
  url: string;
  altText: string | null;
};

export function planPhotoAltTextBackfill(
  photos: PhotoAltTextBackfillPhoto[],
  altTexts: string[] | null | undefined,
  reviewedImageUrls: readonly string[],
) {
  if (!Array.isArray(altTexts) || altTexts.length === 0) return [];
  if (
    photos.length !== reviewedImageUrls.length
    || photos.some((photo, index) => photo.url !== reviewedImageUrls[index])
  ) {
    return [];
  }

  const updates: Array<{ id: string; url: string; altText: string }> = [];
  for (let i = 0; i < Math.min(photos.length, altTexts.length); i++) {
    const aiText = altTexts[i];
    if (aiText && !photos[i].altText) {
      const cleaned = truncateText(sanitizeText(aiText), 200);
      if (cleaned) updates.push({ id: photos[i].id, url: photos[i].url, altText: cleaned });
    }
  }

  return updates;
}
