import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";

export const getPopularBlogTags = unstable_cache(
  async (limit = 8): Promise<string[]> => {
    const tags = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
      SELECT tag, COUNT(*) as count
      FROM "BlogPost" bp
      INNER JOIN "User" u ON u.id = bp."authorId"
      LEFT JOIN "SellerProfile" sp ON sp.id = bp."sellerProfileId"
      LEFT JOIN "User" seller_user ON seller_user.id = sp."userId",
           unnest(bp.tags) AS tag
      WHERE bp.status = 'PUBLISHED'
        AND u.banned = false
        AND u."deletedAt" IS NULL
        AND (
          bp."sellerProfileId" IS NULL
          OR (
            sp."chargesEnabled" = true
            AND sp."vacationMode" = false
            AND seller_user.banned = false
            AND seller_user."deletedAt" IS NULL
          )
        )
      GROUP BY tag
      ORDER BY count DESC
      LIMIT ${limit}
    `;

    return tags.map((r) => r.tag);
  },
  ["popular-blog-tags"],
  { revalidate: 3600, tags: ["popular-blog-tags"] },
);
