import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";

export const PUBLIC_SELLER_TOP_TAG_LIMIT = 8;

export const getPopularListingTags = unstable_cache(
  async (limit = 12): Promise<string[]> => {
    const rows = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
      SELECT tag, COUNT(*) AS count
      FROM "Listing" l
      INNER JOIN "SellerProfile" sp ON sp.id = l."sellerId"
      INNER JOIN "User" u ON u.id = sp."userId",
           unnest(l.tags) AS tag
      WHERE l.status = 'ACTIVE'
        AND l."isPrivate" = false
        AND sp."chargesEnabled" = true
        AND (sp."stripeAccountVersion" IS NULL OR sp."stripeAccountVersion" = 'v2')
        AND sp."vacationMode" = false
        AND u.banned = false
        AND u."deletedAt" IS NULL
      GROUP BY tag
      ORDER BY count DESC, tag ASC
      LIMIT ${limit}
    `;

    return rows.map((row) => row.tag);
  },
  ["popular-listing-tags"],
  { revalidate: 3600, tags: ["popular-listing-tags"] },
);

export const getCachedPublicSellerTopTags = unstable_cache(
  async (sellerId: string): Promise<string[]> => {
    const rows = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
      SELECT tag, COUNT(*) AS count
      FROM "Listing" l
      INNER JOIN "SellerProfile" sp ON sp.id = l."sellerId"
      INNER JOIN "User" u ON u.id = sp."userId",
           unnest(l.tags) AS tag
      WHERE l."sellerId" = ${sellerId}
        AND l.status = 'ACTIVE'
        AND l."isPrivate" = false
        AND sp."chargesEnabled" = true
        AND (sp."stripeAccountVersion" IS NULL OR sp."stripeAccountVersion" = 'v2')
        AND sp."vacationMode" = false
        AND u.banned = false
        AND u."deletedAt" IS NULL
      GROUP BY tag
      ORDER BY count DESC, tag ASC
      LIMIT ${PUBLIC_SELLER_TOP_TAG_LIMIT}
    `;

    return rows.map((row) => row.tag);
  },
  ["public-seller-top-tags-v1"],
  { revalidate: 3600, tags: ["popular-listing-tags"] },
);
