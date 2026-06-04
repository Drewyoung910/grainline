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
import { BLOCKING_REFUND_LEDGER_SQL } from "@/lib/refundLedgerSql";

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
  const cursorPredicate = cursorId
    ? Prisma.sql`AND l.id > ${cursorId}`
    : Prisma.empty;

  return prisma.$queryRaw<ListingQualityScoreRow[]>(Prisma.sql`
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
      SELECT COUNT(*) AS cnt
      FROM "Favorite" f
      JOIN "User" fu ON fu.id = f."userId"
      WHERE f."listingId" = l.id
        AND fu.banned = false
        AND fu."deletedAt" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "Block" b
          WHERE (b."blockerId" = fu.id AND b."blockedId" = sp."userId")
             OR (b."blockerId" = sp."userId" AND b."blockedId" = fu.id)
        )
    ) fav ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE oi."listingId" = l.id
        AND o."sellerRefundId" IS NULL
        ${BLOCKING_REFUND_LEDGER_SQL}
        AND NOT EXISTS (
          SELECT 1 FROM "OrderPaymentEvent" ope
          WHERE ope."orderId" = o.id
            AND ope."eventType" = 'DISPUTE'
            AND (ope.status IS NULL OR LOWER(ope.status) NOT IN ('won', 'warning_closed'))
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
      AND (sp."stripeAccountVersion" IS NULL OR sp."stripeAccountVersion" = 'v2')
      AND sp."vacationMode" = false
      AND u.banned = false
      AND u."deletedAt" IS NULL
      ${cursorPredicate}
    ORDER BY l.id ASC
    LIMIT ${BATCH_SIZE}
  `);
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
