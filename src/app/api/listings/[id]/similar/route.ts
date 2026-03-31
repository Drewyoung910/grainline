// src/app/api/listings/[id]/similar/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

type SimilarRow = {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  photoUrl: string | null;
  sellerDisplayName: string;
  sellerAvatarImageUrl: string | null;
  sellerGuildLevel: string | null;
  overlapCount: bigint;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const listing = await prisma.listing.findUnique({
      where: { id },
      select: { category: true, tags: true, priceCents: true },
    });
    if (!listing) return NextResponse.json({ listings: [] });

    const { category, tags, priceCents } = listing;
    const minPrice = Math.floor(priceCents * 0.5);
    const maxPrice = Math.ceil(priceCents * 1.5);

    // Try tag-overlap ordering via raw SQL when we have tags and a category
    if (tags.length > 0 && category) {
      const rows = await prisma.$queryRaw<SimilarRow[]>`
        SELECT
          l.id,
          l.title,
          l."priceCents",
          l.currency,
          (SELECT p.url FROM "Photo" p WHERE p."listingId" = l.id ORDER BY p."sortOrder" ASC LIMIT 1) AS "photoUrl",
          sp."displayName" AS "sellerDisplayName",
          sp."avatarImageUrl" AS "sellerAvatarImageUrl",
          sp."guildLevel"::text AS "sellerGuildLevel",
          (SELECT COUNT(*) FROM unnest(l.tags) t WHERE t = ANY(${tags})) AS "overlapCount"
        FROM "Listing" l
        JOIN "SellerProfile" sp ON sp.id = l."sellerId"
        WHERE
          l.id != ${id}
          AND l.status = 'ACTIVE'
          AND l."isPrivate" = false
          AND l."priceCents" BETWEEN ${minPrice} AND ${maxPrice}
          AND l.category = ${category}::"Category"
          AND sp."vacationMode" = false
        ORDER BY "overlapCount" DESC
        LIMIT 8
      `;

      const withOverlap = rows.filter((r) => Number(r.overlapCount) > 0).slice(0, 6);

      if (withOverlap.length >= 3) {
        return NextResponse.json({
          listings: withOverlap.map((r) => ({
            id: r.id,
            title: r.title,
            priceCents: r.priceCents,
            currency: r.currency,
            photoUrl: r.photoUrl,
            sellerDisplayName: r.sellerDisplayName,
            sellerAvatarImageUrl: r.sellerAvatarImageUrl,
            sellerGuildLevel: r.sellerGuildLevel,
          })),
        });
      }
    }

    // Tag-overlap without category filter (when no category)
    if (tags.length > 0 && !category) {
      const rows = await prisma.$queryRaw<SimilarRow[]>`
        SELECT
          l.id,
          l.title,
          l."priceCents",
          l.currency,
          (SELECT p.url FROM "Photo" p WHERE p."listingId" = l.id ORDER BY p."sortOrder" ASC LIMIT 1) AS "photoUrl",
          sp."displayName" AS "sellerDisplayName",
          sp."avatarImageUrl" AS "sellerAvatarImageUrl",
          sp."guildLevel"::text AS "sellerGuildLevel",
          (SELECT COUNT(*) FROM unnest(l.tags) t WHERE t = ANY(${tags})) AS "overlapCount"
        FROM "Listing" l
        JOIN "SellerProfile" sp ON sp.id = l."sellerId"
        WHERE
          l.id != ${id}
          AND l.status = 'ACTIVE'
          AND l."isPrivate" = false
          AND l."priceCents" BETWEEN ${minPrice} AND ${maxPrice}
          AND sp."vacationMode" = false
        ORDER BY "overlapCount" DESC
        LIMIT 8
      `;

      const withOverlap = rows.filter((r) => Number(r.overlapCount) > 0).slice(0, 6);

      if (withOverlap.length >= 3) {
        return NextResponse.json({
          listings: withOverlap.map((r) => ({
            id: r.id,
            title: r.title,
            priceCents: r.priceCents,
            currency: r.currency,
            photoUrl: r.photoUrl,
            sellerDisplayName: r.sellerDisplayName,
            sellerAvatarImageUrl: r.sellerAvatarImageUrl,
            sellerGuildLevel: r.sellerGuildLevel,
          })),
        });
      }
    }

    // Fallback: same category (if set), price range, sorted by recency
    if (!category) return NextResponse.json({ listings: [] });

    const fallback = await prisma.listing.findMany({
      where: {
        id: { not: id },
        status: "ACTIVE",
        isPrivate: false,
        category,
        priceCents: { gte: minPrice, lte: maxPrice },
        seller: { vacationMode: false },
      },
      select: {
        id: true,
        title: true,
        priceCents: true,
        currency: true,
        photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
        seller: { select: { displayName: true, avatarImageUrl: true, guildLevel: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 6,
    });

    return NextResponse.json({
      listings: fallback.map((l) => ({
        id: l.id,
        title: l.title,
        priceCents: l.priceCents,
        currency: l.currency,
        photoUrl: l.photos[0]?.url ?? null,
        sellerDisplayName: l.seller.displayName,
        sellerAvatarImageUrl: l.seller.avatarImageUrl,
        sellerGuildLevel: l.seller.guildLevel,
      })),
    });
  } catch (err) {
    console.error("GET /api/listings/[id]/similar error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
