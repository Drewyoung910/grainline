import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

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

export async function countVisibleOwnerSavedBlogPosts(
  userId: string,
  blogPostWhere: Prisma.BlogPostWhereInput,
  db: SavedBlogPostOwnerAccessClient = prisma,
) {
  return db.savedBlogPost.count({
    where: ownerSavedBlogPostWhere(userId, { blogPost: blogPostWhere }),
  });
}

export async function ownerSavedBlogPostPageRows(
  userId: string,
  {
    blogPostWhere,
    skip,
    take,
  }: {
    blogPostWhere: Prisma.BlogPostWhereInput;
    skip: number;
    take: number;
  },
  db: SavedBlogPostOwnerAccessClient = prisma,
) {
  return db.savedBlogPost.findMany({
    where: ownerSavedBlogPostWhere(userId, { blogPost: blogPostWhere }),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
    select: {
      blogPost: {
        select: {
          id: true,
          slug: true,
          title: true,
          excerpt: true,
          coverImageUrl: true,
          type: true,
          readingTimeMinutes: true,
          publishedAt: true,
          author: { select: { name: true, imageUrl: true } },
          sellerProfile: { select: { displayName: true, avatarImageUrl: true } },
        },
      },
    },
  });
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
