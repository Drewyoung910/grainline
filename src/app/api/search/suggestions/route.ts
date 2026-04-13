import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ListingStatus } from "@prisma/client";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import { searchRatelimit, getIP, rateLimitResponse, safeRateLimitOpen } from "@/lib/ratelimit";
import { auth } from "@clerk/nextjs/server";
import { getBlockedSellerProfileIdsFor } from "@/lib/blocks";

export async function GET(req: NextRequest) {
  const { success, reset } = await safeRateLimitOpen(searchRatelimit, getIP(req));
  if (!success) {
    return rateLimitResponse(reset, "Too many searches.");
  }
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ suggestions: [] });

  const { userId } = await auth();
  let meDbId: string | null = null;
  if (userId) {
    const meRow = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    meDbId = meRow?.id ?? null;
  }
  const blockedSellerIds = await getBlockedSellerProfileIdsFor(meDbId);

  const [listings, sellers, tagRows, fuzzyRows] = await Promise.all([
    // Exact title prefix / substring matches
    prisma.listing.findMany({
      where: {
        status: ListingStatus.ACTIVE,
        isPrivate: false,
        seller: { chargesEnabled: true },
        title: { contains: q, mode: "insensitive" },
        ...(blockedSellerIds.length > 0 ? { sellerId: { notIn: blockedSellerIds } } : {}),
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
    blockedSellerIds.length > 0
      ? prisma.$queryRaw<Array<{ tag: string; cnt: bigint }>>`
          SELECT tag, COUNT(*) as cnt
          FROM "Listing" l
          INNER JOIN "SellerProfile" sp ON sp.id = l."sellerId"
          , unnest(l.tags) as tag
          WHERE l.status = 'ACTIVE' AND l."isPrivate" = false AND sp."chargesEnabled" = true
            AND tag ILIKE ${`%${q}%`}
            AND l."sellerId" != ALL(${blockedSellerIds})
          GROUP BY tag ORDER BY cnt DESC LIMIT 2
        `
      : prisma.$queryRaw<Array<{ tag: string; cnt: bigint }>>`
          SELECT tag, COUNT(*) as cnt
          FROM "Listing" l
          INNER JOIN "SellerProfile" sp ON sp.id = l."sellerId"
          , unnest(l.tags) as tag
          WHERE l.status = 'ACTIVE' AND l."isPrivate" = false AND sp."chargesEnabled" = true AND tag ILIKE ${`%${q}%`}
          GROUP BY tag ORDER BY cnt DESC LIMIT 2
        `,

    // Fuzzy title suggestions via pg_trgm (similarity > 0.25)
    blockedSellerIds.length > 0
      ? prisma.$queryRaw<Array<{ title: string; sim: number }>>`
          SELECT DISTINCT l.title, similarity(l.title, ${q}) as sim
          FROM "Listing" l
          INNER JOIN "SellerProfile" sp ON sp.id = l."sellerId"
          WHERE l.status = 'ACTIVE' AND l."isPrivate" = false
            AND sp."chargesEnabled" = true
            AND similarity(l.title, ${q}) > 0.25
            AND l.title NOT ILIKE ${`%${q}%`}
            AND l."sellerId" != ALL(${blockedSellerIds})
          ORDER BY sim DESC LIMIT 2
        `
      : prisma.$queryRaw<Array<{ title: string; sim: number }>>`
          SELECT DISTINCT l.title, similarity(l.title, ${q}) as sim
          FROM "Listing" l
          INNER JOIN "SellerProfile" sp ON sp.id = l."sellerId"
          WHERE l.status = 'ACTIVE' AND l."isPrivate" = false
            AND sp."chargesEnabled" = true
            AND similarity(l.title, ${q}) > 0.25
            AND l.title NOT ILIKE ${`%${q}%`}
          ORDER BY sim DESC LIMIT 2
        `,
  ]);

  // Category suggestions: if query matches a category label, include the label
  const qLower = q.toLowerCase();
  const matchingCategoryValues = CATEGORY_VALUES.filter((v) =>
    CATEGORY_LABELS[v].toLowerCase().includes(qLower)
  );
  const categoryMatches = matchingCategoryValues.map((v) => CATEGORY_LABELS[v]);

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

  return NextResponse.json({
    suggestions: suggestions.slice(0, 8),
    blogs,
    categories: matchingCategoryValues.map((v) => ({
      value: v,
      label: CATEGORY_LABELS[v],
    })),
  });
}
