import { prisma } from "@/lib/db";
import { planPhotoAltTextBackfill } from "@/lib/photoAltTextBackfillState";

export {
  planPhotoAltTextBackfill,
  type PhotoAltTextBackfillPhoto,
} from "@/lib/photoAltTextBackfillState";

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
    const updates = planPhotoAltTextBackfill(photos, altTexts).map((update) =>
      prisma.photo.update({
        where: { id: update.id },
        data: { altText: update.altText },
      }),
    );
    await Promise.all(updates);
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[ai-alt-text] Backfill failed:", e instanceof Error ? e.message : e);
    }
  }
}
