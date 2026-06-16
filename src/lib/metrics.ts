// src/lib/metrics.ts
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  metricsPeriodStart,
  type SellerMetricsResult,
} from "@/lib/metricsState";
import { BLOCKING_REFUND_LEDGER_SQL } from "@/lib/refundLedgerSql";

const SELLER_METRICS_LOCK_NAMESPACE = 913344;

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

async function calculateSellerMetricsInTransaction(
  sellerProfileId: string,
  periodMonths: number,
  db: Prisma.TransactionClient,
): Promise<SellerMetricsResult> {
  const now = new Date();
  const periodStart = metricsPeriodStart(now, periodMonths);

  await db.$executeRaw`
    SELECT pg_advisory_xact_lock(${SELLER_METRICS_LOCK_NAMESPACE}, hashtext(${sellerProfileId}))
  `;

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
  const [reviewAgg, completedSalesRows, shippingRows, activeCaseCount, responseRows] =
    await Promise.all([
      db.review.aggregate({
        where: { listing: { sellerId: sellerProfileId } },
        _avg: { ratingX2: true },
        _count: { _all: true },
      }),

      db.$queryRaw<Array<{ completedOrderCount: bigint; totalSalesCents: bigint | null }>>`
        SELECT
          COUNT(DISTINCT o.id)::bigint AS "completedOrderCount",
          COALESCE(SUM(oi."priceCents" * oi.quantity), 0)::bigint AS "totalSalesCents"
        FROM "Order" o
        JOIN "OrderItem" oi ON oi."orderId" = o.id
        JOIN "Listing" l ON l.id = oi."listingId"
        WHERE l."sellerId" = ${sellerProfileId}
          AND o."fulfillmentStatus" IN ('DELIVERED', 'PICKED_UP')
          AND o."sellerRefundId" IS NULL
          ${BLOCKING_REFUND_LEDGER_SQL}
      `,

      db.$queryRaw<Array<{ shippedCount: bigint; onTimeCount: bigint }>>`
        SELECT
          COUNT(*)::bigint AS "shippedCount",
          COUNT(*) FILTER (WHERE o."shippedAt" <= o."processingDeadline")::bigint AS "onTimeCount"
        FROM "Order" o
        WHERE o."sellerRefundId" IS NULL
          ${BLOCKING_REFUND_LEDGER_SQL}
          AND o."shippedAt" IS NOT NULL
          AND o."shippedAt" >= ${periodStart}
          AND o."processingDeadline" IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM "OrderItem" oi
            JOIN "Listing" l ON l.id = oi."listingId"
            WHERE oi."orderId" = o.id
              AND l."sellerId" = ${sellerProfileId}
          )
      `,

      // Active (open) cases
      db.case.count({
        where: {
          sellerId: seller.userId,
          status: { notIn: ["RESOLVED", "CLOSED"] },
        },
      }),

      db.$queryRaw<Array<{ buyerInitiatedCount: bigint; sellerRespondedCount: bigint }>>`
        WITH seller_conversations AS (
          SELECT c.id
          FROM "Conversation" c
          WHERE (c."userAId" = ${seller.userId} OR c."userBId" = ${seller.userId})
            AND c."createdAt" >= ${periodStart}
        ),
        first_messages AS (
          SELECT DISTINCT ON (m."conversationId")
            m."conversationId",
            m.id AS "firstMessageId",
            m."senderId" AS "firstSenderId",
            m."createdAt" AS "firstMessageAt"
          FROM "Message" m
          JOIN seller_conversations sc ON sc.id = m."conversationId"
          ORDER BY m."conversationId", m."createdAt" ASC, m.id ASC
        ),
        buyer_initiated AS (
          SELECT
            fm."conversationId",
            fm."firstMessageId",
            fm."firstMessageAt"
          FROM first_messages fm
          WHERE fm."firstSenderId" <> ${seller.userId}
        ),
        seller_responses AS (
          SELECT DISTINCT bi."conversationId"
          FROM buyer_initiated bi
          JOIN "Message" reply ON reply."conversationId" = bi."conversationId"
            AND reply."senderId" = ${seller.userId}
            AND (
              reply."createdAt" > bi."firstMessageAt"
              OR (
                reply."createdAt" = bi."firstMessageAt"
                AND reply.id > bi."firstMessageId"
              )
            )
        )
        SELECT
          COUNT(bi."conversationId")::bigint AS "buyerInitiatedCount",
          COUNT(sr."conversationId")::bigint AS "sellerRespondedCount"
        FROM buyer_initiated bi
        LEFT JOIN seller_responses sr ON sr."conversationId" = bi."conversationId"
      `,
    ]);

  // Average rating (all-time)
  const reviewCount = reviewAgg._count._all;
  const averageRating =
    reviewCount > 0
      ? (reviewAgg._avg.ratingX2 ?? 0) / 2
      : 0;

  // Completed sales (all-time)
  const completedSales = completedSalesRows[0];
  const completedOrderCount = Number(completedSales?.completedOrderCount ?? 0);
  const totalSalesCents = Number(completedSales?.totalSalesCents ?? 0);

  // On-time shipping rate (period)
  // An order is on-time if shippedAt <= processingDeadline
  const shippingStats = shippingRows[0];
  const validShippedCount = Number(shippingStats?.shippedCount ?? 0);
  const onTimeCount = Number(shippingStats?.onTimeCount ?? 0);
  const onTimeShippingRate =
    validShippedCount > 0 ? onTimeCount / validShippedCount : 0;

  // Response rate (period)
  // Buyer-initiated = first message NOT from seller
  const responseStats = responseRows[0];
  const buyerInitiatedCount = Number(responseStats?.buyerInitiatedCount ?? 0);
  const sellerRespondedCount = Number(responseStats?.sellerRespondedCount ?? 0);
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
