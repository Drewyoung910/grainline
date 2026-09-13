import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { POPULAR_BLOG_TAGS_CACHE_TAG } from "@/lib/searchCache";

export type PopularBlogTag = {
  tag: string;
  count: number;
};

export const getPopularBlogTagRows = unstable_cache(
  async (limit = 8): Promise<PopularBlogTag[]> => {
    const tags = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
      SELECT tag, COUNT(*) as count
      FROM "BlogPost" bp
      INNER JOIN "User" u ON u.id = bp."authorId"
      LEFT JOIN "SellerProfile" sp ON sp.id = bp."sellerProfileId"
      LEFT JOIN "User" seller_user ON seller_user.id = sp."userId",
           unnest(bp.tags) AS tag
      WHERE bp.status = 'PUBLISHED'
        AND bp."publishedAt" IS NOT NULL
        AND bp."publishedAt" <= NOW()
        AND u.banned = false
        AND u."deletedAt" IS NULL
        AND (
          bp."sellerProfileId" IS NULL
          OR (
            sp."chargesEnabled" = true
            AND (sp."stripeAccountVersion" IS NULL OR sp."stripeAccountVersion" = 'v2')
            AND sp."vacationMode" = false
            AND seller_user.banned = false
            AND seller_user."deletedAt" IS NULL
          )
        )
      GROUP BY tag
      ORDER BY count DESC, tag ASC
      LIMIT ${limit}
    `;

    return tags.map((r) => ({ tag: r.tag, count: Number(r.count) }));
  },
  ["popular-blog-tag-rows"],
  { revalidate: 3600, tags: [POPULAR_BLOG_TAGS_CACHE_TAG] },
);

export async function getPopularBlogTags(limit = 8): Promise<string[]> {
  return (await getPopularBlogTagRows(limit)).map((r) => r.tag);
}
