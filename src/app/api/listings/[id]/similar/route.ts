// src/app/api/listings/[id]/similar/route.ts
import { auth } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { publicListingWhere } from "@/lib/listingVisibility";
import { getIP, rateLimitResponse, safeRateLimit, searchRatelimit } from "@/lib/ratelimit";
import { getBlockedSellerProfileIdsFor } from "@/lib/blocks";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { logServerError } from "@/lib/serverErrorLogger";

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
  createdAt: Date;
  tagOverlap: bigint;
  categoryMatch: boolean;
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rate = await safeRateLimit(searchRatelimit, getIP(req));
    if (!rate.success) return privateResponse(rateLimitResponse(rate.reset, "Too many similar-listing requests."));

    const { id } = await params;

    const listing = await prisma.listing.findFirst({
      where: publicListingWhere({ id }),
      select: { category: true, tags: true, priceCents: true, title: true, sellerId: true },
    });
    if (!listing) return privateJson({ listings: [] });

    const { category, tags, priceCents, title, sellerId } = listing;
    const { userId } = await auth();
    let blockedSellerIds: string[] = [];
    if (userId) {
      const me = await prisma.user.findUnique({
        where: { clerkId: userId },
        select: { id: true, banned: true, deletedAt: true },
      });
      if (me?.banned || me?.deletedAt) {
        return privateJson({ error: "Account restricted" }, { status: 403 });
      }
      if (me) {
        blockedSellerIds = await getBlockedSellerProfileIdsFor(me.id);
      }
    }
    const blockedSellerPredicate = blockedSellerIds.length > 0
      ? Prisma.sql`AND l."sellerId" != ALL(${blockedSellerIds})`
      : Prisma.empty;

    // Wide price range to get enough candidates
    const minPrice = Math.floor(priceCents * 0.1);
    const maxPrice = Math.ceil(priceCents * 10);

    // Get up to 24 candidates via raw SQL with tag overlap + category match scoring.
    // Exclude the same seller because "More from this maker" already covers
    // same-seller items above the "You might also like" carousel.
    const rows = await prisma.$queryRaw<SimilarRow[]>(Prisma.sql`
      SELECT
        l.id,
        l.title,
        l."priceCents",
        l.currency,
        l.status,
        l."listingType"::text AS "listingType",
        l."stockQuantity",
        listing_photos."photoUrl",
        listing_photos."photoAltText",
        listing_photos."secondPhotoUrl",
        listing_photos."secondPhotoAltText",
        sp."displayName" AS "sellerDisplayName",
        sp."avatarImageUrl" AS "sellerAvatarImageUrl",
        sp."guildLevel"::text AS "sellerGuildLevel",
        sp.id AS "sellerId",
        sp.city AS "sellerCity",
        sp.state AS "sellerState",
        sp."acceptingNewOrders" AS "sellerAcceptingNewOrders",
        l."createdAt",
        COALESCE((SELECT COUNT(*) FROM unnest(l.tags) t WHERE t = ANY(${tags})), 0) AS "tagOverlap",
        (l.category = ${category ?? "OTHER"}::"Category") AS "categoryMatch"
      FROM "Listing" l
      JOIN "SellerProfile" sp ON sp.id = l."sellerId"
      LEFT JOIN LATERAL (
        SELECT
          MAX(photo_rows.url) FILTER (WHERE photo_rows.rn = 1) AS "photoUrl",
          MAX(photo_rows."altText") FILTER (WHERE photo_rows.rn = 1) AS "photoAltText",
          MAX(photo_rows.url) FILTER (WHERE photo_rows.rn = 2) AS "secondPhotoUrl",
          MAX(photo_rows."altText") FILTER (WHERE photo_rows.rn = 2) AS "secondPhotoAltText"
        FROM (
          SELECT
            p.url,
            p."altText",
            ROW_NUMBER() OVER (ORDER BY p."sortOrder" ASC, p.id ASC) AS rn
          FROM "Photo" p
          WHERE p."listingId" = l.id
          ORDER BY p."sortOrder" ASC, p.id ASC
          LIMIT 2
        ) photo_rows
      ) listing_photos ON true
      WHERE
        l.id != ${id}
        AND l."sellerId" != ${sellerId}
        ${blockedSellerPredicate}
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
        ABS(l."priceCents" - ${priceCents}) ASC,
        l."createdAt" DESC,
        l.id DESC
      LIMIT 24
    `);

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
    scored.sort((a, b) =>
      (b.totalScore - a.totalScore) ||
      (b.createdAt.getTime() - a.createdAt.getTime()) ||
      b.id.localeCompare(a.id)
    );
    const TARGET = 12;
    const results = scored.slice(0, TARGET);

    return privateJson({
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
    logServerError(err, { source: "listing_similar_route" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
