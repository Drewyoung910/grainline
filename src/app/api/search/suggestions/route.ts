import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ListingStatus } from "@prisma/client";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import { searchRatelimit, getIP } from "@/lib/ratelimit";

export async function GET(req: NextRequest) {
  const { success } = await searchRatelimit.limit(getIP(req));
  if (!success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ suggestions: [] });

  const [listings, sellers, tagRows, fuzzyRows] = await Promise.all([
    // Exact title prefix / substring matches
    prisma.listing.findMany({
      where: {
        status: ListingStatus.ACTIVE,
        isPrivate: false,
        title: { contains: q, mode: "insensitive" },
      },
      select: { title: true },
      take: 4,
      orderBy: { createdAt: "desc" },
    }),

    // Seller name matches
    prisma.sellerProfile.findMany({
      where: { displayName: { contains: q, mode: "insensitive" } },
      select: { displayName: true },
      take: 2,
    }),

    // Partial tag matches via unnest
    prisma.$queryRaw<Array<{ tag: string; cnt: bigint }>>`
      SELECT tag, COUNT(*) as cnt
      FROM "Listing", unnest(tags) as tag
      WHERE status = 'ACTIVE' AND "isPrivate" = false AND tag ILIKE ${`%${q}%`}
      GROUP BY tag
      ORDER BY cnt DESC
      LIMIT 2
    `,

    // Fuzzy title suggestions via pg_trgm (similarity > 0.25)
    prisma.$queryRaw<Array<{ title: string; sim: number }>>`
      SELECT DISTINCT title, similarity(title, ${q}) as sim
      FROM "Listing"
      WHERE status = 'ACTIVE' AND "isPrivate" = false
        AND similarity(title, ${q}) > 0.25
        AND title NOT ILIKE ${`%${q}%`}
      ORDER BY sim DESC
      LIMIT 2
    `,
  ]);

  // Category suggestions: if query matches a category label, include the label
  const qLower = q.toLowerCase();
  const categoryMatches = CATEGORY_VALUES.filter((v) =>
    CATEGORY_LABELS[v].toLowerCase().includes(qLower)
  ).map((v) => CATEGORY_LABELS[v]);

  // Blog post title suggestions
  const blogRows = await prisma.$queryRaw<Array<{ slug: string; title: string }>>`
    SELECT slug, title
    FROM "BlogPost"
    WHERE status = 'PUBLISHED'
      AND similarity(title, ${q}) > 0.15
    ORDER BY similarity(title, ${q}) DESC
    LIMIT 3
  `;

  const seen = new Set<string>();
  const suggestions: string[] = [];
  const blogs: Array<{ slug: string; title: string }> = [];

  function add(s: string | null | undefined) {
    const trimmed = (s ?? "").trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) return;
    seen.add(trimmed.toLowerCase());
    suggestions.push(trimmed);
  }

  for (const l of listings) add(l.title);
  for (const row of tagRows) add(row.tag);
  for (const cat of categoryMatches) add(cat);
  for (const seller of sellers) add(seller.displayName);
  for (const row of fuzzyRows) add(row.title);

  for (const b of blogRows) {
    blogs.push({ slug: b.slug, title: b.title });
  }

  return NextResponse.json({ suggestions: suggestions.slice(0, 8), blogs });
}
