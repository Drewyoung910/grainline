import { Prisma } from "@prisma/client";
import { withDbUserContext } from "@/lib/dbUserContext";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import { logServerError } from "@/lib/serverErrorLogger";

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
 * Failures are non-fatal and logged with sanitized operational context. Callers
 * can ignore the returned promise's resolved value.
 */
export async function backfillEmptyAltTexts(
  actorUserId: string,
  listingId: string,
  altTexts: string[] | null | undefined,
  reviewedImageUrls: readonly string[],
): Promise<void> {
  if (
    !Array.isArray(altTexts)
    || altTexts.length === 0
    || reviewedImageUrls.length === 0
    || reviewedImageUrls.length > 10
  ) return;
  const cleanedAltTexts = reviewedImageUrls.map((_, index) => {
    const candidate = altTexts[index];
    return candidate ? truncateText(sanitizeText(candidate), 200) : "";
  });
  if (!cleanedAltTexts.some(Boolean)) return;
  try {
    await withDbUserContext(actorUserId, async (client) => {
      const altTextsSql = Prisma.sql`ARRAY[${Prisma.join(cleanedAltTexts)}]::text[]`;
      const reviewedUrlsSql = Prisma.sql`ARRAY[${Prisma.join([...reviewedImageUrls])}]::text[]`;
      const rows = await client.$queryRaw<Array<{ updated_count: unknown }>>(Prisma.sql`
        SELECT public.grainline_listing_owner_alt_text_backfill(
          ${listingId}::text,
          ${altTextsSql},
          ${reviewedUrlsSql}
        ) AS updated_count
      `);
      const updatedCount = rows[0]?.updated_count;
      if (
        rows.length !== 1
        || typeof updatedCount !== "number"
        || !Number.isSafeInteger(updatedCount)
        || updatedCount < 0
        || updatedCount > 10
      ) {
        throw new Error("Listing alt-text backfill authority returned an invalid result");
      }
    });
  } catch (error) {
    logServerError(error, {
      source: "photo_alt_text_backfill",
      level: "warning",
      extra: { listingId },
    });
  }
}
