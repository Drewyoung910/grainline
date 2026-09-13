import { sanitizeText, truncateText } from "./sanitize.ts";

export type PhotoAltTextBackfillPhoto = {
  id: string;
  altText: string | null;
};

export function planPhotoAltTextBackfill(
  photos: PhotoAltTextBackfillPhoto[],
  altTexts: string[] | null | undefined,
) {
  if (!Array.isArray(altTexts) || altTexts.length === 0) return [];

  const updates: Array<{ id: string; altText: string }> = [];
  for (let i = 0; i < Math.min(photos.length, altTexts.length); i++) {
    const aiText = altTexts[i];
    if (aiText && !photos[i].altText) {
      const cleaned = truncateText(sanitizeText(aiText), 200);
      if (cleaned) updates.push({ id: photos[i].id, altText: cleaned });
    }
  }

  return updates;
}
