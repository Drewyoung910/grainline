import { prisma } from "@/lib/db";
import { sanitizeText, truncateText } from "@/lib/sanitize";

/**
 * Backfill empty Photo.altText with AI-generated alt texts.
 *
 * Only writes to photos that have no seller-provided alt text — never overwrites.
 * altTexts[i] is paired with photos[i] in `sortOrder` ascending order, matching the
 * order reviewListingWithAI received the image URLs.
 *
 * Failures are non-fatal and logged in non-production. Callers can ignore the
 * returned promise's resolved value.
 */
export async function backfillEmptyAltTexts(
  listingId: string,
  altTexts: string[] | null | undefined,
): Promise<void> {
  if (!Array.isArray(altTexts) || altTexts.length === 0) return;
  try {
    const photos = await prisma.photo.findMany({
      where: { listingId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, altText: true },
    });
    const updates: Array<Promise<unknown>> = [];
    for (let i = 0; i < Math.min(photos.length, altTexts.length); i++) {
      const aiText = altTexts[i];
      if (aiText && !photos[i].altText) {
        const cleaned = truncateText(sanitizeText(aiText), 200);
        if (cleaned) {
          updates.push(
            prisma.photo.update({
              where: { id: photos[i].id },
              data: { altText: cleaned },
            }),
          );
        }
      }
    }
    await Promise.all(updates);
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[ai-alt-text] Backfill failed:", e instanceof Error ? e.message : e);
    }
  }
}
