import { prisma } from "@/lib/db";

export async function syncGuildMemberListingThreshold(sellerProfileId: string) {
  await prisma.$executeRaw`
    UPDATE "SellerProfile" sp
    SET "listingsBelowThresholdSince" = CASE
      WHEN (
        SELECT COUNT(*)
        FROM "Listing" l
        WHERE l."sellerId" = sp.id
          AND l.status = 'ACTIVE'
          AND l."isPrivate" = false
      ) < 5 THEN COALESCE(sp."listingsBelowThresholdSince", NOW())
      ELSE NULL
    END
    WHERE sp.id = ${sellerProfileId}
  `;
}
