// src/lib/quality-score.ts
//
// Bayesian-dampened quality score for listings.
// Recalculated daily by /api/cron/quality-score.
//
// Formula:
//   score =
//     dampenedConversion * 0.25 +
//     sellerRating * 0.20 +
//     favNorm * 0.15 +
//     recency * 0.15 +
//     dampenedCtr * 0.10 +
//     guildBonus * 0.05 +
//     photoScore * 0.05 +
//     descScore * 0.05 +
//     newListingBump (0.15 for 14 days, linear decay to 0 by day 30) +
//     newSellerBonus (0.05 if seller has zero reviews) -
//     qualityPenalty (short description, low photo count, moderation flags)
//
// Base weights sum to 1.0. Discovery bumps are additive by design, so a
// brand-new zero-review listing can temporarily score up to 1.20.

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getSiteMetricsSnapshot } from "@/lib/site-metrics-snapshot";
import { qualityPenaltyForListing } from "@/lib/qualityScoreState";

const DAMPENING_C = 50;
const BATCH_SIZE = 200;

interface ListingRow {
  id: string;
  sellerId: string;
  viewCount: number;
  clickCount: number;
  favCount: bigint;
  orderCount: bigint;
  photoCount: bigint;
  hasAltText: boolean;
  descLength: number;
  aiReviewFlags: string[];
  createdAt: Date;
  sellerCreatedAt: Date;
  guildLevel: string;
  sellerAvgRating: number | null;
  sellerReviewCount: bigint;
}

interface GlobalMeans {
  avgConversion: number;
  avgCtr: number;
  avgRating: number;
}

async function computeGlobalMeans(): Promise<GlobalMeans> {
  const snapshot = await getSiteMetricsSnapshot();
  return {
    avgConversion: snapshot.avgConversion,
    avgCtr: snapshot.avgCtr,
    avgRating: snapshot.avgRating,
  };
}

async function fetchActiveListingBatch(cursorId: string | null): Promise<ListingRow[]> {
  const cursorPredicate = cursorId
    ? Prisma.sql`AND l.id > ${cursorId}`
    : Prisma.empty;

  return prisma.$queryRaw<ListingRow[]>(Prisma.sql`
    SELECT
      l.id,
      l."sellerId",
      l."viewCount",
      l."clickCount",
      COALESCE(fav.cnt, 0) AS "favCount",
      COALESCE(ord.cnt, 0) AS "orderCount",
      COALESCE(ph.cnt, 0) AS "photoCount",
      COALESCE(ph."hasAlt", false) AS "hasAltText",
      COALESCE(LENGTH(l.description), 0) AS "descLength",
      l."aiReviewFlags",
      l."createdAt",
      sp."createdAt" AS "sellerCreatedAt",
      sp."guildLevel",
      sr."averageRating" AS "sellerAvgRating",
      COALESCE(sr."reviewCount", 0) AS "sellerReviewCount"
    FROM "Listing" l
    JOIN "SellerProfile" sp ON sp.id = l."sellerId"
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt FROM "Favorite" f WHERE f."listingId" = l.id
    ) fav ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE oi."listingId" = l.id
        AND o."sellerRefundId" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "OrderPaymentEvent" ope
          WHERE ope."orderId" = o.id
            AND ope."eventType" = 'REFUND'
        )
    ) ord ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt,
             BOOL_OR(p."altText" IS NOT NULL AND p."altText" != '') AS "hasAlt"
      FROM "Photo" p WHERE p."listingId" = l.id
    ) ph ON true
    LEFT JOIN "SellerRatingSummary" sr ON sr."sellerProfileId" = l."sellerId"
    JOIN "User" u ON u.id = sp."userId"
    WHERE l.status = 'ACTIVE'
      AND l."isPrivate" = false
      AND sp."chargesEnabled" = true
      AND sp."vacationMode" = false
      AND u.banned = false
      AND u."deletedAt" IS NULL
      ${cursorPredicate}
    ORDER BY l.id ASC
    LIMIT ${BATCH_SIZE}
  `);
}

function scoreRow(row: ListingRow, globals: GlobalMeans, now: number): number {
  const views = row.viewCount ?? 0;
  const clicks = row.clickCount ?? 0;
  const orders = Number(row.orderCount);
  const favs = Number(row.favCount);
  const photos = Number(row.photoCount);

  // Dampened conversion rate
  const rawConversion = views > 0 ? orders / views : 0;
  const dampenedConversion =
    (views * rawConversion + DAMPENING_C * globals.avgConversion) /
    (views + DAMPENING_C);

  // Dampened CTR
  const rawCtr = views > 0 ? clicks / views : 0;
  const dampenedCtr =
    (views * rawCtr + DAMPENING_C * globals.avgCtr) / (views + DAMPENING_C);

  // Seller rating normalized to 0-1 (rating is 0-5)
  const rating = row.sellerAvgRating ?? globals.avgRating;
  const sellerRating = Math.min(1, Math.max(0, rating / 5));

  // Favorites normalized (cap at 50)
  const favNorm = Math.min(1, favs / 50);

  // Recency: gentle hyperbolic decay
  const ageMs = now - new Date(row.createdAt).getTime();
  const ageInDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));
  const recency = 1.0 / (1.0 + ageInDays / 60.0);

  // Guild bonus
  const guildBonus =
    row.guildLevel === "GUILD_MASTER"
      ? 1.0
      : row.guildLevel === "GUILD_MEMBER"
        ? 0.6
        : 0;

  // Photo score
  const photoScore =
    Math.min(1.0, photos / 4) * (row.hasAltText ? 1.0 : 0.8);

  // Description score
  const descScore = Math.min(1.0, (row.descLength ?? 0) / 200);

  // New listing bump: +0.15 for first 14 days, linear decay to 0 by day 30.
  // Gives new listings enough impressions to collect real engagement data.
  // Mirrors Etsy's "new listing boost" approach.
  const newListingBump =
    ageInDays <= 14
      ? 0.15
      : ageInDays <= 30
        ? 0.15 * (1.0 - (ageInDays - 14) / 16)
        : 0;

  // New seller bonus: +0.05 for sellers with zero reviews during their first
  // 30 days. This avoids permanently boosting old high-volume sellers that
  // have not yet collected reviews.
  // First-time sellers need more help than Guild Masters adding their 50th listing.
  // Disappears once the seller gets their first review.
  const sellerReviews = Number(row.sellerReviewCount ?? 0);
  const sellerAgeDays = Math.max(0, (now - new Date(row.sellerCreatedAt).getTime()) / (1000 * 60 * 60 * 24));
  const newSellerBonus = sellerReviews === 0 && sellerAgeDays <= 30 ? 0.05 : 0;

  // Weighted sum + discovery bumps. Penalties keep sparse/spammy listings from
  // being lifted by new-listing/new-seller boosts before they earn engagement.
  const score =
    dampenedConversion * 0.25 +
    sellerRating * 0.2 +
    favNorm * 0.15 +
    recency * 0.15 +
    dampenedCtr * 0.1 +
    guildBonus * 0.05 +
    photoScore * 0.05 +
    descScore * 0.05 +
    newListingBump +
    newSellerBonus;

  const penalty = qualityPenaltyForListing({
    descLength: row.descLength,
    photoCount: photos,
    aiReviewFlags: row.aiReviewFlags,
  });

  return Math.max(0, score - penalty);
}

export async function recalculateAllQualityScores(): Promise<{
  updated: number;
  zeroed: number;
}> {
  const globals = await computeGlobalMeans();
  const now = Date.now();
  let updated = 0;

  // Score active listings in cursor pages so the cron does not hold the full
  // Listing table in memory at marketplace scale.
  let cursorId: string | null = null;
  while (true) {
    const rows = await fetchActiveListingBatch(cursorId);
    if (rows.length === 0) break;

    const values = Prisma.join(
      rows.map((row) => Prisma.sql`(${row.id}, ${scoreRow(row, globals, now)})`),
    );
    await prisma.$executeRaw`
      UPDATE "Listing" AS l
      SET "qualityScore" = v.score::double precision
      FROM (VALUES ${values}) AS v(id, score)
      WHERE l.id = v.id::text
    `;

    updated += rows.length;
    cursorId = rows[rows.length - 1]?.id ?? null;
    if (rows.length < BATCH_SIZE) {
      break;
    }
  }

  // Zero out inactive/private listings
  const zeroed = await prisma.listing.updateMany({
    where: {
      OR: [
        { status: { not: "ACTIVE" } },
        { isPrivate: true },
        { seller: { chargesEnabled: false } },
        { seller: { vacationMode: true } },
        { seller: { user: { banned: true } } },
        { seller: { user: { deletedAt: { not: null } } } },
      ],
      qualityScore: { gt: 0 },
    },
    data: { qualityScore: 0 },
  });

  return { updated, zeroed: zeroed.count };
}
