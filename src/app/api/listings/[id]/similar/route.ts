// src/app/api/listings/[id]/similar/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { publicListingWhere } from "@/lib/listingVisibility";
import { getIP, rateLimitResponse, safeRateLimit, searchRatelimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

type SimilarRow = {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  status: string;
  listingType: string;
  stockQuantity: number | null;
  photoUrl: string | null;
  photoAltText: string | null;
  secondPhotoUrl: string | null;
  secondPhotoAltText: string | null;
  sellerDisplayName: string;
  sellerAvatarImageUrl: string | null;
  sellerGuildLevel: string | null;
  sellerId: string;
  sellerCity: string | null;
  sellerState: string | null;
  sellerAcceptingNewOrders: boolean;
  tagOverlap: bigint;
  categoryMatch: boolean;
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rate = await safeRateLimit(searchRatelimit, getIP(req));
    if (!rate.success) return rateLimitResponse(rate.reset, "Too many similar-listing requests.");

    const { id } = await params;

    const listing = await prisma.listing.findFirst({
      where: publicListingWhere({ id }),
      select: { category: true, tags: true, priceCents: true, title: true, sellerId: true },
    });
    if (!listing) return NextResponse.json({ listings: [] });

    const { category, tags, priceCents, title, sellerId } = listing;

    // Wide price range to get enough candidates
    const minPrice = Math.floor(priceCents * 0.1);
    const maxPrice = Math.ceil(priceCents * 10);

    // Get up to 24 candidates via raw SQL with tag overlap + category match scoring.
    // Exclude the same seller because "More from this maker" already covers
    // same-seller items above the "You might also like" carousel.
    const rows = await prisma.$queryRaw<SimilarRow[]>`
      SELECT
        l.id,
        l.title,
        l."priceCents",
        l.currency,
        l.status,
        l."listingType"::text AS "listingType",
        l."stockQuantity",
        (SELECT p.url FROM "Photo" p WHERE p."listingId" = l.id ORDER BY p."sortOrder" ASC LIMIT 1) AS "photoUrl",
        (SELECT p."altText" FROM "Photo" p WHERE p."listingId" = l.id ORDER BY p."sortOrder" ASC LIMIT 1) AS "photoAltText",
        (SELECT p.url FROM "Photo" p WHERE p."listingId" = l.id ORDER BY p."sortOrder" ASC LIMIT 1 OFFSET 1) AS "secondPhotoUrl",
        (SELECT p."altText" FROM "Photo" p WHERE p."listingId" = l.id ORDER BY p."sortOrder" ASC LIMIT 1 OFFSET 1) AS "secondPhotoAltText",
        sp."displayName" AS "sellerDisplayName",
        sp."avatarImageUrl" AS "sellerAvatarImageUrl",
        sp."guildLevel"::text AS "sellerGuildLevel",
        sp.id AS "sellerId",
        sp.city AS "sellerCity",
        sp.state AS "sellerState",
        sp."acceptingNewOrders" AS "sellerAcceptingNewOrders",
        COALESCE((SELECT COUNT(*) FROM unnest(l.tags) t WHERE t = ANY(${tags})), 0) AS "tagOverlap",
        (l.category = ${category ?? "OTHER"}::"Category") AS "categoryMatch"
      FROM "Listing" l
      JOIN "SellerProfile" sp ON sp.id = l."sellerId"
      WHERE
        l.id != ${id}
        AND l."sellerId" != ${sellerId}
        AND l.status = 'ACTIVE'
        AND l."isPrivate" = false
        AND l."priceCents" BETWEEN ${minPrice} AND ${maxPrice}
        AND sp."vacationMode" = false
        AND sp."chargesEnabled" = true
        AND (sp."stripeAccountVersion" IS NULL OR sp."stripeAccountVersion" = 'v2')
        AND EXISTS (
          SELECT 1 FROM "User" u
          WHERE u.id = sp."userId"
            AND u."banned" = false
            AND u."deletedAt" IS NULL
        )
      ORDER BY
        (l.category = ${category ?? "OTHER"}::"Category") DESC,
        COALESCE((SELECT COUNT(*) FROM unnest(l.tags) t WHERE t = ANY(${tags})), 0) DESC,
        ABS(l."priceCents" - ${priceCents}) ASC
      LIMIT 24
    `;

    // Score each candidate with weighted similarity
    const scored = rows.map((r) => {
      const tagScore = Number(r.tagOverlap) * 3; // 3 points per matching tag
      const catScore = r.categoryMatch ? 5 : 0;  // 5 points for same category
      const priceDistance = Math.abs(r.priceCents - priceCents) / Math.max(priceCents, 1);
      const priceScore = Math.max(0, 3 - priceDistance * 3); // 3 points for close price, 0 for far
      // Simple title word overlap
      const titleWords = new Set(title.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
      const rTitleWords = r.title.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const titleScore = rTitleWords.filter((w) => titleWords.has(w)).length * 2;
      const totalScore = tagScore + catScore + priceScore + titleScore;
      return { ...r, totalScore };
    });

    // Sort by total score descending and take the top TARGET. At launch the
    // marketplace is small enough that per-seller dedup leaves the carousel
    // half-empty; "More from this maker" already covers same-seller items
    // above this section, so allowing duplicates here is fine.
    scored.sort((a, b) => b.totalScore - a.totalScore);
    const TARGET = 12;
    const results = scored.slice(0, TARGET);

    return NextResponse.json({
      listings: results.map((r) => ({
        id: r.id,
        title: r.title,
        priceCents: r.priceCents,
        currency: r.currency,
        status: r.status,
        listingType: r.listingType,
        stockQuantity: r.stockQuantity,
        photoUrl: r.photoUrl,
        photoAltText: r.photoAltText,
        secondPhotoUrl: r.secondPhotoUrl,
        secondPhotoAltText: r.secondPhotoAltText,
        seller: {
          id: r.sellerId,
          displayName: r.sellerDisplayName,
          avatarImageUrl: r.sellerAvatarImageUrl,
          guildLevel: r.sellerGuildLevel,
          city: r.sellerCity,
          state: r.sellerState,
          acceptingNewOrders: r.sellerAcceptingNewOrders,
        },
      })),
    });
  } catch (err) {
    console.error("GET /api/listings/[id]/similar error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
