import { BlogPostType } from "@prisma/client";

export type SavedBlogPostPageRow = {
  blogPostId: unknown;
  slug: unknown;
  title: unknown;
  excerpt: unknown;
  coverImageUrl: unknown;
  type: unknown;
  readingTimeMinutes: unknown;
  publishedAt: unknown;
  authorName: unknown;
  authorImageUrl: unknown;
  authorSellerName: unknown;
  authorSellerAvatarUrl: unknown;
  sellerProfileId: unknown;
  sellerDisplayName: unknown;
  sellerAvatarImageUrl: unknown;
};

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/.test(value);
}

export function parseOwnerSavedBlogPostPageRows(
  rows: readonly SavedBlogPostPageRow[],
  take: number,
) {
  const posts = rows.map((row) => {
    if (
      !validId(row.blogPostId)
      || typeof row.slug !== "string"
      || row.slug.length < 1
      || row.slug.length > 255
      || typeof row.title !== "string"
      || Array.from(row.title).length < 1
      || Array.from(row.title).length > 200
      || !nullableString(row.excerpt)
      || !nullableString(row.coverImageUrl)
      || !Object.values(BlogPostType).includes(row.type as BlogPostType)
      || !(row.readingTimeMinutes === null
        || (Number.isSafeInteger(row.readingTimeMinutes) && Number(row.readingTimeMinutes) >= 0))
      || !(row.publishedAt instanceof Date)
      || Number.isNaN(row.publishedAt.getTime())
      || !nullableString(row.authorName)
      || !nullableString(row.authorImageUrl)
      || !nullableString(row.authorSellerName)
      || !nullableString(row.authorSellerAvatarUrl)
      || !(row.sellerProfileId === null || validId(row.sellerProfileId))
      || !nullableString(row.sellerDisplayName)
      || !nullableString(row.sellerAvatarImageUrl)
      || (row.sellerProfileId === null
        && (row.sellerDisplayName !== null || row.sellerAvatarImageUrl !== null))
      || (row.sellerProfileId !== null && row.sellerDisplayName === null)
    ) {
      throw new Error("Seller saved-blog page authority returned an invalid result");
    }
    return Object.freeze({
      blogPost: Object.freeze({
        id: row.blogPostId,
        slug: row.slug,
        title: row.title,
        excerpt: row.excerpt,
        coverImageUrl: row.coverImageUrl,
        type: row.type as BlogPostType,
        readingTimeMinutes: row.readingTimeMinutes as number | null,
        publishedAt: row.publishedAt,
        authorName: row.authorName,
        authorImageUrl: row.authorImageUrl,
        authorSellerName: row.authorSellerName,
        authorSellerAvatarUrl: row.authorSellerAvatarUrl,
        sellerProfileId: row.sellerProfileId,
        sellerProfile: row.sellerProfileId === null ? null : Object.freeze({
          displayName: row.sellerDisplayName!,
          avatarImageUrl: row.sellerAvatarImageUrl,
        }),
      }),
    });
  });
  if (
    posts.length > take
    || new Set(posts.map(({ blogPost }) => blogPost.id)).size !== posts.length
  ) {
    throw new Error("Seller saved-blog page authority returned invalid cardinality");
  }
  return Object.freeze(posts);
}
