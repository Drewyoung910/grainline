import { BlogPostStatus, Prisma } from "@prisma/client";

export function publicBlogPostWhere(extra: Prisma.BlogPostWhereInput = {}): Prisma.BlogPostWhereInput {
  return {
    AND: [
      {
        status: BlogPostStatus.PUBLISHED,
        author: { banned: false, deletedAt: null },
        OR: [
          { sellerProfileId: null },
          {
            sellerProfile: {
              chargesEnabled: true,
              vacationMode: false,
              user: { banned: false, deletedAt: null },
            },
          },
        ],
      },
      extra,
    ],
  };
}
