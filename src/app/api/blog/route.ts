// src/app/api/blog/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { BlogPostType, Prisma } from "@prisma/client";
import { publicBlogPostWhere } from "@/lib/blogVisibility";
import { getBlockedIdsFor } from "@/lib/blocks";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { getIP, rateLimitResponse, safeRateLimit, searchRatelimit } from "@/lib/ratelimit";
import { truncateText } from "@/lib/sanitize";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { success, reset } = await safeRateLimit(searchRatelimit, getIP(req));
  if (!success) return rateLimitResponse(reset, "Too many blog requests.");

  const { searchParams } = req.nextUrl;
  const type = searchParams.get("type");
  const tag = truncateText(searchParams.get("tag")?.trim() ?? "", 64);
  const page = parseBoundedPositiveIntParam(searchParams.get("page"), 1, 1000);
  const pageSize = 12;
  const orderBy: Prisma.BlogPostOrderByWithRelationInput[] = [{ publishedAt: "desc" }, { id: "desc" }];
  const { userId } = await auth();
  let meDbId: string | null = null;
  if (userId) {
    try {
      const me = await ensureUserByClerkId(userId);
      meDbId = me.id;
    } catch (err) {
      const accountResponse = accountAccessErrorResponse(err);
      if (accountResponse) return accountResponse;
      throw err;
    }
  }
  const { blockedUserIds, blockedSellerIds } = await getBlockedIdsFor(meDbId);
  const blockedUserIdList = [...blockedUserIds];

  const where: Prisma.BlogPostWhereInput = publicBlogPostWhere({
    ...(type && Object.keys(BlogPostType).includes(type) ? { type: type as BlogPostType } : {}),
    ...(tag ? { tags: { has: tag } } : {}),
    ...(blockedUserIdList.length > 0 ? { authorId: { notIn: blockedUserIdList } } : {}),
    ...(blockedSellerIds.length > 0
      ? { OR: [{ sellerProfileId: null }, { sellerProfileId: { notIn: blockedSellerIds } }] }
      : {}),
  });

  const total = await prisma.blogPost.count({ where });
  const totalPages = Math.ceil(total / pageSize);
  const clampedPage = Math.min(Math.max(page, 1), Math.max(1, totalPages));

  const posts = await prisma.blogPost.findMany({
    where,
    orderBy,
    skip: (clampedPage - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      coverImageUrl: true,
      type: true,
      tags: true,
      readingTimeMinutes: true,
      publishedAt: true,
      authorType: true,
      author: { select: { id: true, name: true, imageUrl: true } },
      sellerProfile: { select: { id: true, displayName: true, avatarImageUrl: true } },
      _count: { select: { comments: { where: { approved: true } } } },
    },
  });

  return NextResponse.json({ posts, total, page: clampedPage, pageSize });
}
