import { BlogPostStatus, Prisma } from "@prisma/client";

const PUBLIC_BLOG_SELLER_PROFILE_STATE = {
  chargesEnabled: true,
  stripeAccountSupported: true,
  vacationMode: false,
  ownerAccountActive: true,
} satisfies Prisma.SellerProfileWhereInput;

export function publicBlogPostWhere(extra: Prisma.BlogPostWhereInput = {}): Prisma.BlogPostWhereInput {
  return {
    AND: [
      {
        status: BlogPostStatus.PUBLISHED,
        publishedAt: { not: null, lte: new Date() },
        authorAccountActive: true,
        OR: [
          { sellerProfileId: null },
          {
            sellerProfile: PUBLIC_BLOG_SELLER_PROFILE_STATE,
          },
        ],
      },
      extra,
    ],
  };
}
