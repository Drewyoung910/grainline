// src/app/api/blog/search/suggestions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export type BlogSuggestion = {
  type: "post" | "tag" | "author";
  label: string;
  slug?: string;
  tag?: string;
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("bq")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ suggestions: [] });

  const [postRows, tagRows, authorRows] = await Promise.all([
    // Fuzzy title matches
    prisma.$queryRaw<Array<{ slug: string; title: string }>>`
      SELECT slug, title
      FROM "BlogPost"
      WHERE status = 'PUBLISHED'
        AND similarity(title, ${q}) > 0.2
      ORDER BY similarity(title, ${q}) DESC
      LIMIT 5
    `,

    // Tag partial matches
    prisma.$queryRaw<Array<{ tag: string }>>`
      SELECT DISTINCT unnest(tags) as tag
      FROM "BlogPost"
      WHERE status = 'PUBLISHED'
        AND unnest(tags) ILIKE ${`%${q}%`}
      LIMIT 5
    `,

    // Author / seller display name matches
    prisma.sellerProfile.findMany({
      where: { displayName: { contains: q, mode: "insensitive" } },
      select: { displayName: true },
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
      suggestions.push({ type: "author", label: r.displayName });
    }
  }

  return NextResponse.json({ suggestions: suggestions.slice(0, 8) });
}
