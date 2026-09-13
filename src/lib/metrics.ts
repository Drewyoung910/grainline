// src/lib/metrics.ts
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  metricsPeriodStart,
  type SellerMetricsResult,
} from "@/lib/metricsState";
import { isSellerMetricsFresh } from "@/lib/metricsFreshness";
import { getSellerMessageResponseMetrics } from "@/lib/conversationMessageAuthority";
import { getCaseSellerActiveCount } from "@/lib/caseSellerAggregateAuthority";
import { readOrderSellerMetricsFacts } from "@/lib/orderSellerMetricsAuthority";

const SELLER_METRICS_LOCK_NAMESPACE = 913344;

export const SELLER_METRICS_SELECT = {
  sellerProfileId: true,
  calculatedAt: true,
  periodMonths: true,
  averageRating: true,
  reviewCount: true,
  onTimeShippingRate: true,
  responseRate: true,
  totalSalesCents: true,
  completedOrderCount: true,
  activeCaseCount: true,
  accountAgeDays: true,
} satisfies Prisma.SellerMetricsSelect;

export type CachedSellerMetrics = Prisma.SellerMetricsGetPayload<{
  select: typeof SELLER_METRICS_SELECT;
}>;

export {
  GUILD_MASTER_REQUIREMENTS,
  LISTING_VIEW_DAILY_RETENTION_DAYS,
  METRICS_PERIOD_DAYS_PER_MONTH,
  listingViewDailyRetentionCutoff,
  meetsGuildMasterRequirements,
  metricsPeriodStart,
  type SellerMetricsResult,
} from "@/lib/metricsState";

export async function calculateSellerMetrics(
  sellerProfileId: string,
  periodMonths = 3
): Promise<SellerMetricsResult> {
  return prisma.$transaction(
    (tx) => calculateSellerMetricsInTransaction(sellerProfileId, periodMonths, tx),
    { maxWait: 10_000, timeout: 30_000 },
  );
}

export function cachedSellerMetricsToResult(metrics: CachedSellerMetrics): SellerMetricsResult {
  return {
    sellerProfileId: metrics.sellerProfileId,
    calculatedAt: new Date(metrics.calculatedAt),
    periodMonths: metrics.periodMonths,
    averageRating: metrics.averageRating,
    reviewCount: metrics.reviewCount,
    onTimeShippingRate: metrics.onTimeShippingRate,
    responseRate: metrics.responseRate,
    totalSalesCents: Number(metrics.totalSalesCents),
    completedOrderCount: metrics.completedOrderCount,
    activeCaseCount: metrics.activeCaseCount,
    accountAgeDays: metrics.accountAgeDays,
  };
}

export async function getFreshSellerMetrics(
  sellerProfileId: string,
  periodMonths = 3,
  existingMetrics?: CachedSellerMetrics | null,
): Promise<SellerMetricsResult> {
  const metrics = existingMetrics === undefined
    ? await prisma.sellerMetrics.findUnique({
        where: { sellerProfileId },
        select: SELLER_METRICS_SELECT,
      })
    : existingMetrics;

  if (
    metrics &&
    metrics.sellerProfileId === sellerProfileId &&
    metrics.periodMonths === periodMonths &&
    isSellerMetricsFresh(metrics)
  ) {
    return cachedSellerMetricsToResult(metrics);
  }

  return refreshSellerMetricsAfterCacheMiss(sellerProfileId, periodMonths);
}

async function refreshSellerMetricsAfterCacheMiss(
  sellerProfileId: string,
  periodMonths: number,
): Promise<SellerMetricsResult> {
  return prisma.$transaction(
    async (tx) => {
      await lockSellerMetricsRefresh(tx, sellerProfileId);

      const metrics = await tx.sellerMetrics.findUnique({
        where: { sellerProfileId },
        select: SELLER_METRICS_SELECT,
      });

      if (
        metrics &&
        metrics.sellerProfileId === sellerProfileId &&
        metrics.periodMonths === periodMonths &&
        isSellerMetricsFresh(metrics)
      ) {
        return cachedSellerMetricsToResult(metrics);
      }

      return calculateSellerMetricsWithoutLock(sellerProfileId, periodMonths, tx);
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

async function lockSellerMetricsRefresh(
  db: Prisma.TransactionClient,
  sellerProfileId: string,
) {
  await db.$executeRaw`
    SELECT pg_advisory_xact_lock(${SELLER_METRICS_LOCK_NAMESPACE}, hashtext(${sellerProfileId}))
  `;
}

async function calculateSellerMetricsInTransaction(
  sellerProfileId: string,
  periodMonths: number,
  db: Prisma.TransactionClient,
): Promise<SellerMetricsResult> {
  await lockSellerMetricsRefresh(db, sellerProfileId);
  return calculateSellerMetricsWithoutLock(sellerProfileId, periodMonths, db);
}

async function calculateSellerMetricsWithoutLock(
  sellerProfileId: string,
  periodMonths: number,
  db: Prisma.TransactionClient,
): Promise<SellerMetricsResult> {
  const now = new Date();
  const periodStart = metricsPeriodStart(now, periodMonths);

  const seller = await db.sellerProfile.findUnique({
    where: { id: sellerProfileId },
    select: { userId: true, createdAt: true },
  });
  if (!seller) throw new Error(`SellerProfile not found: ${sellerProfileId}`);

  const accountAgeDays = Math.floor(
    (now.getTime() - new Date(seller.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  // Keep metrics aggregation in the database. Loading full order/review/message
  // histories works at launch size, but it falls over exactly when seller
  // metrics become most important.
  const [reviewAgg, orderFacts, activeCaseCount, responseRows] =
    await Promise.all([
      db.review.aggregate({
        where: { listing: { sellerId: sellerProfileId } },
        _avg: { ratingX2: true },
        _count: { _all: true },
      }),

      readOrderSellerMetricsFacts(sellerProfileId, periodStart, db),

      getCaseSellerActiveCount(sellerProfileId, db),

      getSellerMessageResponseMetrics(seller.userId, periodStart, db),
    ]);

  // Average rating (all-time)
  const reviewCount = reviewAgg._count._all;
  const averageRating =
    reviewCount > 0
      ? (reviewAgg._avg.ratingX2 ?? 0) / 2
      : 0;

  // Completed sales (all-time)
  if (!orderFacts || orderFacts.sellerProfileId !== sellerProfileId) {
    throw new Error("Order seller-metrics authority returned no matching seller");
  }
  const completedOrderCount = orderFacts.completedOrderCount;
  const totalSalesCents = orderFacts.totalSalesCents;

  // On-time shipping rate (period)
  // An order is on-time if shippedAt <= processingDeadline
  const validShippedCount = orderFacts.shippedCount;
  const onTimeCount = orderFacts.onTimeCount;
  const onTimeShippingRate =
    validShippedCount > 0 ? onTimeCount / validShippedCount : 0;

  // Response rate (period)
  // Buyer-initiated = first message NOT from seller
  const responseStats = responseRows;
  const buyerInitiatedCount = responseStats?.buyerInitiatedCount ?? 0;
  const sellerRespondedCount = responseStats?.sellerRespondedCount ?? 0;
  const responseRate =
    buyerInitiatedCount > 0 ? sellerRespondedCount / buyerInitiatedCount : 0;

  const result: SellerMetricsResult = {
    sellerProfileId,
    calculatedAt: now,
    periodMonths,
    averageRating,
    reviewCount,
    onTimeShippingRate,
    responseRate,
    totalSalesCents,
    completedOrderCount,
    activeCaseCount,
    accountAgeDays,
  };

  // Persist to DB (upsert)
  const dbPayload = {
    calculatedAt: result.calculatedAt,
    periodMonths: result.periodMonths,
    averageRating: result.averageRating,
    reviewCount: result.reviewCount,
    onTimeShippingRate: result.onTimeShippingRate,
    responseRate: result.responseRate,
    totalSalesCents: result.totalSalesCents,
    completedOrderCount: result.completedOrderCount,
    activeCaseCount: result.activeCaseCount,
    accountAgeDays: result.accountAgeDays,
  };
  await db.sellerMetrics.upsert({
    where: { sellerProfileId },
    create: { sellerProfileId, ...dbPayload },
    update: dbPayload,
  });

  return result;
}
