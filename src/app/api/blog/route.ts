// src/app/api/blog/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { BlogPostType, Prisma } from "@prisma/client";
import { publicBlogPostWhere } from "@/lib/blogVisibility";
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

  const where: Prisma.BlogPostWhereInput = publicBlogPostWhere({
    ...(type && Object.keys(BlogPostType).includes(type) ? { type: type as BlogPostType } : {}),
    ...(tag ? { tags: { has: tag } } : {}),
  });

  const [posts, total] = await Promise.all([
    prisma.blogPost.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      skip: (page - 1) * pageSize,
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
    }),
    prisma.blogPost.count({ where }),
  ]);

  return NextResponse.json({ posts, total, page, pageSize });
}
