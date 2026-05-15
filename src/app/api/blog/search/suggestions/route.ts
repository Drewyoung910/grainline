// src/app/api/blog/search/suggestions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getIP, searchRatelimit, safeRateLimitOpen } from "@/lib/ratelimit";
import { activeSellerProfileWhere } from "@/lib/sellerVisibility";
import {
  BLOG_FUZZY_SUGGESTION_MIN_SIMILARITY,
  normalizeSearchSuggestionQuery,
} from "@/lib/searchSuggestionState";

export type BlogSuggestion = {
  type: "post" | "tag" | "author";
  label: string;
  slug?: string;
  tag?: string;
  sellerProfileId?: string;
};

export async function GET(req: NextRequest) {
  const rl = await safeRateLimitOpen(searchRatelimit, getIP(req));
  if (!rl.success) return NextResponse.json({ suggestions: [] });

  const q = normalizeSearchSuggestionQuery(req.nextUrl.searchParams.get("bq"));
  if (q.length < 2) return NextResponse.json({ suggestions: [] });

  const [postRows, tagRows, authorRows] = await Promise.all([
    // Fuzzy title matches
    prisma.$queryRaw<Array<{ slug: string; title: string }>>`
      SELECT bp.slug, bp.title
      FROM "BlogPost" bp
      INNER JOIN "User" u ON u.id = bp."authorId"
      LEFT JOIN "SellerProfile" sp ON sp.id = bp."sellerProfileId"
      LEFT JOIN "User" seller_user ON seller_user.id = sp."userId"
      WHERE bp.status = 'PUBLISHED'
        AND u.banned = false
        AND u."deletedAt" IS NULL
        AND (
          bp."sellerProfileId" IS NULL
          OR (
            sp."chargesEnabled" = true
            AND (sp."stripeAccountVersion" IS NULL OR sp."stripeAccountVersion" = 'v2')
            AND sp."vacationMode" = false
            AND seller_user.banned = false
            AND seller_user."deletedAt" IS NULL
          )
        )
        AND similarity(bp.title, ${q}) > ${BLOG_FUZZY_SUGGESTION_MIN_SIMILARITY}
      ORDER BY similarity(bp.title, ${q}) DESC
      LIMIT 5
    `,

    // Tag partial matches
    prisma.$queryRaw<Array<{ tag: string }>>`
      SELECT DISTINCT tag
      FROM "BlogPost" bp
      INNER JOIN "User" u ON u.id = bp."authorId"
      LEFT JOIN "SellerProfile" sp ON sp.id = bp."sellerProfileId"
      LEFT JOIN "User" seller_user ON seller_user.id = sp."userId",
           unnest(bp.tags) AS tag
      WHERE bp.status = 'PUBLISHED'
        AND u.banned = false
        AND u."deletedAt" IS NULL
        AND (
          bp."sellerProfileId" IS NULL
          OR (
            sp."chargesEnabled" = true
            AND (sp."stripeAccountVersion" IS NULL OR sp."stripeAccountVersion" = 'v2')
            AND sp."vacationMode" = false
            AND seller_user.banned = false
            AND seller_user."deletedAt" IS NULL
          )
        )
        AND tag ILIKE ${`%${q}%`}
      LIMIT 5
    `,

    // Author / seller display name matches
    prisma.sellerProfile.findMany({
      where: activeSellerProfileWhere({
        displayName: { contains: q, mode: "insensitive" },
      }),
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
