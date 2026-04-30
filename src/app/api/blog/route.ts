// src/app/api/blog/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { BlogPostType, Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const type = searchParams.get("type");
  const tag = searchParams.get("tag");
  const parsedPage = parseInt(searchParams.get("page") ?? "1", 10);
  const page = Math.min(1000, Math.max(1, Number.isFinite(parsedPage) ? parsedPage : 1));
  const pageSize = 12;

  const where: Prisma.BlogPostWhereInput = { status: "PUBLISHED" };
  if (type && Object.keys(BlogPostType).includes(type)) where.type = type as BlogPostType;
  if (tag) where.tags = { has: tag };

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
