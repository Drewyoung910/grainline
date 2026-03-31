// src/app/api/blog/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { BlogPostType, BlogPostStatus } from "@prisma/client";

const POST_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverImageUrl: true,
  type: true,
  tags: true,
  publishedAt: true,
  readingTimeMinutes: true,
  author: { select: { name: true, imageUrl: true } },
  sellerProfile: { select: { displayName: true, avatarImageUrl: true } },
} as const;

type PostRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  type: BlogPostType;
  tags: string[];
  publishedAt: Date | null;
  readingTimeMinutes: number | null;
  author: { name: string | null; imageUrl: string | null };
  sellerProfile: { displayName: string; avatarImageUrl: string | null } | null;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const type = url.searchParams.get("type")?.trim() ?? "";
  const tagsParam = url.searchParams.get("tags") ?? "";
  const tags = tagsParam ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const sort = url.searchParams.get("sort") ?? (q ? "relevant" : "newest");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "12", 10), 50);
  const skip = (page - 1) * limit;

  const typeValid = type && (Object.values(BlogPostType) as string[]).includes(type);

  if (q && sort === "relevant") {
    // GIN full-text search — get IDs ranked by ts_rank
    type RankedRow = { id: string };
    const rankedRows = await prisma.$queryRaw<RankedRow[]>`
      SELECT id FROM "BlogPost"
      WHERE status = 'PUBLISHED'
        AND to_tsvector('english',
          coalesce(title, '') || ' ' ||
          coalesce(excerpt, '') || ' ' ||
          coalesce(body, '')
        ) @@ plainto_tsquery('english', ${q})
      ORDER BY ts_rank(
        to_tsvector('english',
          coalesce(title, '') || ' ' ||
          coalesce(excerpt, '') || ' ' ||
          coalesce(body, '')
        ),
        plainto_tsquery('english', ${q})
      ) DESC
      LIMIT 500
    `;

    const rankedIds = rankedRows.map((r) => r.id);

    if (rankedIds.length === 0) {
      return NextResponse.json({ posts: [], total: 0, page, totalPages: 0, relatedTags: [] });
    }

    // Fetch full records, applying type + tag filter
    const allPosts = await prisma.blogPost.findMany({
      where: {
        id: { in: rankedIds },
        ...(typeValid ? { type: type as BlogPostType } : {}),
        ...(tags.length > 0 ? { tags: { hasSome: tags } } : {}),
      },
      select: POST_SELECT,
    });

    // Re-order to match ranked order
    const byId = new Map(allPosts.map((p) => [p.id, p as PostRow]));
    const ordered = rankedIds.map((id) => byId.get(id)).filter((p): p is PostRow => !!p);
    const total = ordered.length;
    const posts = ordered.slice(skip, skip + limit);

    return NextResponse.json({ posts, total, page, totalPages: Math.ceil(total / limit), relatedTags: [] });
  }

  // Standard Prisma query (newest or alpha sort)
  const where = {
    status: BlogPostStatus.PUBLISHED,
    ...(typeValid ? { type: type as BlogPostType } : {}),
    ...(tags.length > 0 ? { tags: { hasSome: tags } } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { excerpt: { contains: q, mode: "insensitive" as const } },
            { tags: { hasSome: [q.toLowerCase()] } },
          ],
        }
      : {}),
  };

  const orderBy = sort === "alpha" ? { title: "asc" as const } : { publishedAt: "desc" as const };

  const [posts, total] = await Promise.all([
    prisma.blogPost.findMany({ where, orderBy, skip, take: limit, select: POST_SELECT }),
    prisma.blogPost.count({ where }),
  ]);

  return NextResponse.json({ posts, total, page, totalPages: Math.ceil(total / limit), relatedTags: [] });
}
