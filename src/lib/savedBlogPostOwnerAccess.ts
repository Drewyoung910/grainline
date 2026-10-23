import type { Prisma } from "@prisma/client";
import { publicBlogPostWhere } from "@/lib/blogVisibility";
import { withDbUserContext, type DbUserContextTransactionClient } from "@/lib/dbUserContext";
import { buildOwnerSavedBlogPostExportRows } from "@/lib/savedBlogPostExport";
import {
  parseOwnerSavedBlogPostPageRows,
  type SavedBlogPostPageRow,
} from "@/lib/savedBlogPostPageState";

export type SavedBlogPostOwnerAccessClient = DbUserContextTransactionClient;

export function ownerSavedBlogPostWhere(
  userId: string,
  where: Prisma.SavedBlogPostWhereInput = {},
): Prisma.SavedBlogPostWhereInput {
  return { AND: [{ userId }, where] };
}

async function readOwnerSavedBlogPost(
  userId: string,
  blogPostId: string,
  db: SavedBlogPostOwnerAccessClient,
) {
  return db.savedBlogPost.findUnique({
    where: { userId_blogPostId: { userId, blogPostId } },
    select: { id: true },
  });
}

export function findOwnerSavedBlogPost(userId: string, blogPostId: string) {
  return withDbUserContext(userId, (db) =>
    readOwnerSavedBlogPost(userId, blogPostId, db));
}

async function insertOwnerSavedBlogPost(
  userId: string,
  blogPostId: string,
  db: SavedBlogPostOwnerAccessClient,
) {
  const result = await db.savedBlogPost.createMany({
    data: [{ userId, blogPostId }],
    skipDuplicates: true,
  });
  if (result.count !== 0 && result.count !== 1) {
    throw new Error("Saved-blog insert returned invalid cardinality");
  }
  return readOwnerSavedBlogPost(userId, blogPostId, db);
}

export function saveOwnerSavedBlogPost(userId: string, blogPostId: string) {
  return withDbUserContext(userId, (db) =>
    insertOwnerSavedBlogPost(userId, blogPostId, db));
}

async function removeOwnerSavedBlogPost(
  userId: string,
  blogPostId: string,
  db: SavedBlogPostOwnerAccessClient,
) {
  return db.savedBlogPost.deleteMany({
    where: { userId, blogPostId },
  });
}

export function deleteOwnerSavedBlogPost(userId: string, blogPostId: string) {
  return withDbUserContext(userId, (db) =>
    removeOwnerSavedBlogPost(userId, blogPostId, db));
}

async function readOwnerSavedBlogPostIdRows(
  userId: string,
  blogPostIds: string[],
  db: SavedBlogPostOwnerAccessClient,
) {
  if (blogPostIds.length === 0) return [] as Array<{ blogPostId: string }>;
  return db.savedBlogPost.findMany({
    where: ownerSavedBlogPostWhere(userId, { blogPostId: { in: blogPostIds } }),
    select: { blogPostId: true },
  });
}

export function ownerSavedBlogPostIdRows(userId: string, blogPostIds: string[]) {
  if (blogPostIds.length === 0) return Promise.resolve([] as Array<{ blogPostId: string }>);
  return withDbUserContext(userId, (db) =>
    readOwnerSavedBlogPostIdRows(userId, blogPostIds, db));
}

type SavedBlogPostCountRow = { value: unknown };

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
  return parseOwnerSavedBlogPostPageRows(rows, take);
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

async function readOwnerSavedBlogPostExportRows(
  userId: string,
  db: SavedBlogPostOwnerAccessClient,
) {
  const savedRows = await db.savedBlogPost.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { blogPostId: true, createdAt: true },
  });
  const targetIds = savedRows.map(({ blogPostId }) => blogPostId);
  const publicTargets = targetIds.length === 0
    ? []
    : await db.blogPost.findMany({
        where: publicBlogPostWhere({ id: { in: targetIds } }),
        select: { id: true, title: true, slug: true },
      });
  return buildOwnerSavedBlogPostExportRows(savedRows, publicTargets);
}

export function ownerSavedBlogPostExportRows(userId: string) {
  return withDbUserContext(userId, (db) =>
    readOwnerSavedBlogPostExportRows(userId, db));
}

export function deleteAllOwnerSavedBlogPosts(
  userId: string,
  db: SavedBlogPostOwnerAccessClient,
) {
  return db.savedBlogPost.deleteMany({ where: { userId } });
}
