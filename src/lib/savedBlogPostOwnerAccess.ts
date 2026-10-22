import { BlogPostType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withDbUserContext, type DbUserContextTransactionClient } from "@/lib/dbUserContext";

export type SavedBlogPostOwnerAccessClient = Pick<Prisma.TransactionClient, "savedBlogPost">;

export function ownerSavedBlogPostWhere(
  userId: string,
  where: Prisma.SavedBlogPostWhereInput = {},
): Prisma.SavedBlogPostWhereInput {
  return { AND: [{ userId }, where] };
}

export async function findOwnerSavedBlogPost(
  userId: string,
  blogPostId: string,
  db: SavedBlogPostOwnerAccessClient = prisma,
) {
  return db.savedBlogPost.findUnique({
    where: { userId_blogPostId: { userId, blogPostId } },
    select: { id: true },
  });
}

export async function upsertOwnerSavedBlogPost(
  userId: string,
  blogPostId: string,
  db: SavedBlogPostOwnerAccessClient = prisma,
) {
  return db.savedBlogPost.upsert({
    where: { userId_blogPostId: { userId, blogPostId } },
    create: { userId, blogPostId },
    update: {},
    select: { id: true },
  });
}

export async function deleteOwnerSavedBlogPost(
  userId: string,
  blogPostId: string,
  db: SavedBlogPostOwnerAccessClient = prisma,
) {
  return db.savedBlogPost.deleteMany({
    where: { userId, blogPostId },
  });
}

export async function ownerSavedBlogPostIdRows(
  userId: string,
  blogPostIds: string[],
  db: SavedBlogPostOwnerAccessClient = prisma,
) {
  if (blogPostIds.length === 0) return [] as Array<{ blogPostId: string }>;
  return db.savedBlogPost.findMany({
    where: ownerSavedBlogPostWhere(userId, { blogPostId: { in: blogPostIds } }),
    select: { blogPostId: true },
  });
}

type SavedBlogPostCountRow = { value: unknown };

type SavedBlogPostPageRow = {
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

async function readVisibleOwnerSavedBlogPostCount(
  client: DbUserContextTransactionClient,
) {
  const rows = await client.$queryRaw<SavedBlogPostCountRow[]>`
    SELECT * FROM public.grainline_seller_owner_saved_blog_post_count()
  `;
  const value = rows[0]?.value;
  if (
    rows.length !== 1
    || typeof value !== "bigint"
    || value < 0n
    || value > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error("Seller saved-blog count authority returned an invalid result");
  }
  return Number(value);
}

export function countVisibleOwnerSavedBlogPosts(userId: string) {
  return withDbUserContext(userId, readVisibleOwnerSavedBlogPostCount);
}

async function readOwnerSavedBlogPostPageRows(
  client: DbUserContextTransactionClient,
  take: number,
  skip: number,
) {
  const rows = await client.$queryRaw<SavedBlogPostPageRow[]>`
    SELECT *
      FROM public.grainline_seller_owner_saved_blog_post_page(
        ${take}::integer,
        ${skip}::integer
      )
  `;
  const posts = rows.map((row) => {
    if (
      !validId(row.blogPostId)
      || typeof row.slug !== "string"
      || row.slug.length < 1
      || row.slug.length > 255
      || typeof row.title !== "string"
      || row.title.length < 1
      || row.title.length > 200
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

export function ownerSavedBlogPostPageRows(
  userId: string,
  {
    skip,
    take,
  }: {
    skip: number;
    take: number;
  },
) {
  if (
    !Number.isSafeInteger(take)
    || take < 1
    || take > 24
    || !Number.isSafeInteger(skip)
    || skip < 0
    || skip > 23976
  ) {
    throw new RangeError("Seller saved-blog page is outside the supported range");
  }
  return withDbUserContext(userId, (client) =>
    readOwnerSavedBlogPostPageRows(client, take, skip));
}

export async function ownerSavedBlogPostExportRows(
  userId: string,
  db: SavedBlogPostOwnerAccessClient = prisma,
) {
  return db.savedBlogPost.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { blogPostId: true, createdAt: true, blogPost: { select: { title: true, slug: true } } },
  });
}
