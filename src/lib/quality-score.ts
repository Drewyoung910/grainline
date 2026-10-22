// src/lib/quality-score.ts
//
// Bayesian-dampened quality score for listings.
// Recalculated daily by /api/cron/quality-score.
//
// Formula:
//   score =
//     dampenedConversion * 0.25 +
//     sellerRating * 0.20 +
//     favoriteSignal * 0.15 +
//     recency * 0.15 +
//     dampenedCtr * 0.10 +
//     guildBonus * 0.05 +
//     photoScore * 0.05 +
//     descScore * 0.05 +
//     newListingBump (0.15 for 14 days, linear decay to 0 by day 30) +
//     newSellerBonus (0.05 if seller has zero reviews and is <=30 days old) -
//     qualityPenalty (short description, low photo count, moderation flags)
//
// Base weights sum to 1.0. Discovery bumps are additive by design, so a
// brand-new zero-review listing can temporarily score up to 1.20.
// Engagement inputs are abuse-dampened: excess views without clicks/orders
// cannot indefinitely suppress conversion/CTR, and favorites need some
// engagement support before reaching their full ranking weight.

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getSiteMetricsSnapshot } from "@/lib/site-metrics-snapshot";
import {
  scoreQualityRow,
  type ListingQualityScoreRow,
  type QualityScoreGlobalMeans,
} from "./qualityScoreFormula.ts";
import { getPublicListingOrderCounts } from "@/lib/orderPublicAggregateAuthority";
import { userPublicListingFavoriteCounts } from "@/lib/userFollowerAccess";
import {
  sellerServiceQualityScoreBatch,
  sellerServiceZeroIneligibleQualityScores,
} from "@/lib/sellerProfileQualityScoreAccess";

const BATCH_SIZE = 200;

async function computeGlobalMeans(): Promise<QualityScoreGlobalMeans> {
  const snapshot = await getSiteMetricsSnapshot();
  return {
    avgConversion: snapshot.avgConversion,
    avgCtr: snapshot.avgCtr,
    avgRating: snapshot.avgRating,
  };
}

async function fetchActiveListingBatch(cursorId: string | null): Promise<ListingQualityScoreRow[]> {
  const rows = await sellerServiceQualityScoreBatch(cursorId, BATCH_SIZE);
  if (rows.length === 0) return [];
  const listingIds = rows.map((row) => row.id);
  const [orderCounts, favoriteCounts] = await Promise.all([
    getPublicListingOrderCounts(listingIds),
    userPublicListingFavoriteCounts(prisma, listingIds),
  ]);
  return rows.map((row) => ({
    ...row,
    favCount: favoriteCounts.get(row.id) ?? 0n,
    orderCount: orderCounts.get(row.id) ?? 0n,
  }));
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
      rows.map((row) => Prisma.sql`(${row.id}, ${scoreQualityRow(row, globals, now)})`),
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
  const zeroed = await sellerServiceZeroIneligibleQualityScores();

  return { updated, zeroed };
}
