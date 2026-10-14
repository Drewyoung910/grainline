import { prisma } from "@/lib/db";

export async function syncGuildMemberListingThreshold(sellerProfileId: string) {
  await prisma.$queryRaw<Array<{ listingsBelowThresholdSince: Date | null }>>`
    SELECT public.grainline_seller_guild_listing_threshold_sync(
      ${sellerProfileId}
    ) AS "listingsBelowThresholdSince"
  `;
}
