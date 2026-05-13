import { BlogPostStatus, Prisma } from "@prisma/client";

const SUPPORTED_STRIPE_CONNECT_ACCOUNT_VERSION = "v2";

const PUBLIC_BLOG_SELLER_PROFILE_STATE = {
  chargesEnabled: true,
  OR: [
    { stripeAccountVersion: null },
    { stripeAccountVersion: SUPPORTED_STRIPE_CONNECT_ACCOUNT_VERSION },
  ],
  vacationMode: false,
  user: { banned: false, deletedAt: null },
} satisfies Prisma.SellerProfileWhereInput;

export function publicBlogPostWhere(extra: Prisma.BlogPostWhereInput = {}): Prisma.BlogPostWhereInput {
  return {
    AND: [
      {
        status: BlogPostStatus.PUBLISHED,
        author: { banned: false, deletedAt: null },
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
