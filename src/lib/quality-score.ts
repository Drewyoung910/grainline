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
//     newSellerBonus (0.05 if seller has zero reviews)

import { prisma } from "@/lib/db";

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
  createdAt: Date;
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
  // Compute site-wide averages across all active non-private listings
  const rows = await prisma.$queryRaw<
    Array<{
      totalViews: bigint;
      totalOrders: bigint;
      totalClicks: bigint;
      listingCount: bigint;
    }>
  >`
    SELECT
      COALESCE(SUM(l."viewCount"), 0) AS "totalViews",
      COALESCE(
        (SELECT COUNT(*) FROM "OrderItem" oi
         JOIN "Listing" il ON oi."listingId" = il.id
         WHERE il.status = 'ACTIVE' AND il."isPrivate" = false),
        0
      ) AS "totalOrders",
      COALESCE(SUM(l."clickCount"), 0) AS "totalClicks",
      COUNT(l.id) AS "listingCount"
    FROM "Listing" l
    WHERE l.status = 'ACTIVE' AND l."isPrivate" = false
  `;

  const r = rows[0];
  const totalViews = Number(r?.totalViews ?? 0);
  const totalOrders = Number(r?.totalOrders ?? 0);
  const totalClicks = Number(r?.totalClicks ?? 0);

  const avgConversion = totalViews > 0 ? totalOrders / totalViews : 0;
  const avgCtr = totalViews > 0 ? totalClicks / totalViews : 0;

  // Global average seller rating
  const ratingRows = await prisma.$queryRaw<Array<{ avgRating: number | null }>>`
    SELECT AVG(r."ratingX2")::float / 2.0 AS "avgRating"
    FROM "Review" r
  `;
  const avgRating = ratingRows[0]?.avgRating ?? 3.0;

  return { avgConversion, avgCtr, avgRating };
}

async function fetchAllActiveListings(): Promise<ListingRow[]> {
  return prisma.$queryRaw<ListingRow[]>`
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
      l."createdAt",
      sp."guildLevel",
      sr."avgRating" AS "sellerAvgRating",
      COALESCE(sr."reviewCount", 0) AS "sellerReviewCount"
    FROM "Listing" l
    JOIN "SellerProfile" sp ON sp.id = l."sellerId"
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt FROM "Favorite" f WHERE f."listingId" = l.id
    ) fav ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt FROM "OrderItem" oi WHERE oi."listingId" = l.id
    ) ord ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt,
             BOOL_OR(p."altText" IS NOT NULL AND p."altText" != '') AS "hasAlt"
      FROM "Photo" p WHERE p."listingId" = l.id
    ) ph ON true
    LEFT JOIN LATERAL (
      SELECT AVG(r."ratingX2")::float / 2.0 AS "avgRating",
             COUNT(r.id) AS "reviewCount"
      FROM "Review" r
      JOIN "Listing" rl ON r."listingId" = rl.id
      WHERE rl."sellerId" = l."sellerId"
      HAVING COUNT(r.id) > 0
    ) sr ON true
    WHERE l.status = 'ACTIVE' AND l."isPrivate" = false
  `;
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

  // New seller bonus: +0.05 for sellers with zero reviews.
  // First-time sellers need more help than Guild Masters adding their 50th listing.
  // Disappears once the seller gets their first review.
  const sellerReviews = Number(row.sellerReviewCount ?? 0);
  const newSellerBonus = sellerReviews === 0 ? 0.05 : 0;

  // Weighted sum + discovery bumps
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

  return score;
}

export async function recalculateAllQualityScores(): Promise<{
  updated: number;
  zeroed: number;
}> {
  const globals = await computeGlobalMeans();
  const rows = await fetchAllActiveListings();
  const now = Date.now();

  // Score all active non-private listings
  const updates: { id: string; score: number }[] = rows.map((row) => ({
    id: row.id,
    score: scoreRow(row, globals, now),
  }));

  // Batch update active listings
  let updated = 0;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((u) =>
        prisma.listing.update({
          where: { id: u.id },
          data: { qualityScore: u.score },
        })
      )
    );
    updated += batch.length;
  }

  // Zero out inactive/private listings
  const zeroed = await prisma.listing.updateMany({
    where: {
      OR: [
        { status: { not: "ACTIVE" } },
        { isPrivate: true },
      ],
      qualityScore: { gt: 0 },
    },
    data: { qualityScore: 0 },
  });

  return { updated, zeroed: zeroed.count };
}
