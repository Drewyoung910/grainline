import { BlogPostStatus, Prisma } from "@prisma/client";

type PublicBlogAuthorPresentationSource = Readonly<{
  authorName: string | null;
  authorImageUrl: string | null;
  authorSellerName: string | null;
  authorSellerAvatarUrl: string | null;
}>;

export function publicBlogAuthorPresentation(
  source: PublicBlogAuthorPresentationSource,
  fallbackName: string,
) {
  return Object.freeze({
    name: source.authorSellerName ?? source.authorName ?? fallbackName,
    imageUrl: source.authorSellerAvatarUrl ?? source.authorImageUrl ?? null,
  });
}

export function publicBlogPostWhere(extra: Prisma.BlogPostWhereInput = {}): Prisma.BlogPostWhereInput {
  return {
    AND: [
      {
        status: BlogPostStatus.PUBLISHED,
        publishedAt: { not: null, lte: new Date() },
        authorAccountActive: true,
        OR: [
          { sellerProfileId: null },
          { authorSellerPubliclyOrderable: true },
        ],
      },
      extra,
    ],
  };
}
