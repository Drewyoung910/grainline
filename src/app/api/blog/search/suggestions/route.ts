// src/app/api/blog/search/suggestions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { searchRatelimit, safeRateLimitOpen } from "@/lib/ratelimit";
import { truncateText } from "@/lib/sanitize";

export type BlogSuggestion = {
  type: "post" | "tag" | "author";
  label: string;
  slug?: string;
  tag?: string;
  sellerProfileId?: string;
};

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
  const rl = await safeRateLimitOpen(searchRatelimit, ip);
  if (!rl.success) return NextResponse.json({ suggestions: [] });

  const q = truncateText(req.nextUrl.searchParams.get("bq")?.trim() ?? "", 200);
  if (q.length < 2) return NextResponse.json({ suggestions: [] });

  const [postRows, tagRows, authorRows] = await Promise.all([
    // Fuzzy title matches
    prisma.$queryRaw<Array<{ slug: string; title: string }>>`
      SELECT bp.slug, bp.title
      FROM "BlogPost" bp
      INNER JOIN "User" u ON u.id = bp."authorId"
      WHERE bp.status = 'PUBLISHED'
        AND u.banned = false
        AND u."deletedAt" IS NULL
        AND similarity(bp.title, ${q}) > 0.2
      ORDER BY similarity(bp.title, ${q}) DESC
      LIMIT 5
    `,

    // Tag partial matches
    prisma.$queryRaw<Array<{ tag: string }>>`
      SELECT DISTINCT tag
      FROM "BlogPost" bp
      INNER JOIN "User" u ON u.id = bp."authorId",
           unnest(bp.tags) AS tag
      WHERE bp.status = 'PUBLISHED'
        AND u.banned = false
        AND u."deletedAt" IS NULL
        AND tag ILIKE ${`%${q}%`}
      LIMIT 5
    `,

    // Author / seller display name matches
    prisma.sellerProfile.findMany({
      where: {
        displayName: { contains: q, mode: "insensitive" },
        user: { banned: false, deletedAt: null },
      },
      select: { id: true, displayName: true },
      take: 3,
    }),
  ]);

  const suggestions: BlogSuggestion[] = [];
  const seen = new Set<string>();

  for (const r of postRows) {
    const key = `post:${r.slug}`;
    if (!seen.has(key)) {
      seen.add(key);
      suggestions.push({ type: "post", label: r.title, slug: r.slug });
    }
  }

  for (const r of tagRows) {
    const key = `tag:${r.tag.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      suggestions.push({ type: "tag", label: r.tag, tag: r.tag.toLowerCase() });
    }
  }

  for (const r of authorRows) {
    const key = `author:${r.displayName.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      suggestions.push({ type: "author", label: r.displayName, sellerProfileId: r.id });
    }
  }

  return NextResponse.json({ suggestions: suggestions.slice(0, 8) });
}
