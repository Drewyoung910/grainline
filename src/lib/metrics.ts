// src/lib/metrics.ts
import { prisma } from "@/lib/db";

export type SellerMetricsResult = {
  sellerProfileId: string;
  calculatedAt: Date;
  periodMonths: number;
  averageRating: number;
  reviewCount: number;
  onTimeShippingRate: number;
  responseRate: number;
  totalSalesCents: number;
  completedOrderCount: number;
  activeCaseCount: number;
  accountAgeDays: number;
};

// Guild Master requirements
export const GUILD_MASTER_REQUIREMENTS = {
  averageRating: 4.5,
  reviewCount: 25,
  onTimeShippingRate: 0.95,
  responseRate: 0.90,
  accountAgeDays: 180,
  totalSalesCents: 100_000, // $1,000
  activeCaseCount: 0,
};

export function meetsGuildMasterRequirements(m: SellerMetricsResult): {
  ratingMet: boolean;
  reviewsMet: boolean;
  shippingMet: boolean;
  responseMet: boolean;
  ageMet: boolean;
  salesMet: boolean;
  casesMet: boolean;
  allMet: boolean;
} {
  const ratingMet = m.averageRating >= GUILD_MASTER_REQUIREMENTS.averageRating;
  const reviewsMet = m.reviewCount >= GUILD_MASTER_REQUIREMENTS.reviewCount;
  const shippingMet = m.onTimeShippingRate >= GUILD_MASTER_REQUIREMENTS.onTimeShippingRate;
  const responseMet = m.responseRate >= GUILD_MASTER_REQUIREMENTS.responseRate;
  const ageMet = m.accountAgeDays >= GUILD_MASTER_REQUIREMENTS.accountAgeDays;
  const salesMet = m.totalSalesCents >= GUILD_MASTER_REQUIREMENTS.totalSalesCents;
  const casesMet = m.activeCaseCount <= GUILD_MASTER_REQUIREMENTS.activeCaseCount;
  const allMet = ratingMet && reviewsMet && shippingMet && responseMet && ageMet && salesMet && casesMet;
  return { ratingMet, reviewsMet, shippingMet, responseMet, ageMet, salesMet, casesMet, allMet };
}

export async function calculateSellerMetrics(
  sellerProfileId: string,
  periodMonths = 3
): Promise<SellerMetricsResult> {
  const periodStart = new Date(Date.now() - periodMonths * 30 * 24 * 60 * 60 * 1000);

  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerProfileId },
    select: { userId: true, createdAt: true },
  });
  if (!seller) throw new Error(`SellerProfile not found: ${sellerProfileId}`);

  const accountAgeDays = Math.floor(
    (Date.now() - new Date(seller.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  // Keep metrics aggregation in the database. Loading full order/review/message
  // histories works at launch size, but it falls over exactly when seller
  // metrics become most important.
  const [reviewAgg, completedSalesRows, shippingRows, activeCaseCount, responseRows] =
    await Promise.all([
      prisma.review.aggregate({
        where: { listing: { sellerId: sellerProfileId } },
        _avg: { ratingX2: true },
        _count: { _all: true },
      }),

      prisma.$queryRaw<Array<{ completedOrderCount: bigint; totalSalesCents: bigint | null }>>`
        SELECT
          COUNT(DISTINCT o.id)::bigint AS "completedOrderCount",
          COALESCE(SUM(oi."priceCents" * oi.quantity), 0)::bigint AS "totalSalesCents"
        FROM "Order" o
        JOIN "OrderItem" oi ON oi."orderId" = o.id
        JOIN "Listing" l ON l.id = oi."listingId"
        WHERE l."sellerId" = ${sellerProfileId}
          AND o."fulfillmentStatus" IN ('DELIVERED', 'PICKED_UP')
          AND o."sellerRefundId" IS NULL
      `,

      prisma.$queryRaw<Array<{ shippedCount: bigint; onTimeCount: bigint }>>`
        SELECT
          COUNT(*)::bigint AS "shippedCount",
          COUNT(*) FILTER (WHERE o."shippedAt" <= o."processingDeadline")::bigint AS "onTimeCount"
        FROM "Order" o
        WHERE o."sellerRefundId" IS NULL
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
      prisma.case.count({
        where: {
          sellerId: seller.userId,
          status: { notIn: ["RESOLVED", "CLOSED"] },
        },
      }),

      prisma.$queryRaw<Array<{ buyerInitiatedCount: bigint; sellerRespondedCount: bigint }>>`
        SELECT
          COUNT(*)::bigint AS "buyerInitiatedCount",
          COUNT(*) FILTER (WHERE c."firstResponseAt" IS NOT NULL)::bigint AS "sellerRespondedCount"
        FROM "Conversation" c
        JOIN LATERAL (
          SELECT m."senderId"
          FROM "Message" m
          WHERE m."conversationId" = c.id
          ORDER BY m."createdAt" ASC
          LIMIT 1
        ) first_msg ON true
        WHERE (c."userAId" = ${seller.userId} OR c."userBId" = ${seller.userId})
          AND c."createdAt" >= ${periodStart}
          AND first_msg."senderId" <> ${seller.userId}
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
    calculatedAt: new Date(),
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
  await prisma.sellerMetrics.upsert({
    where: { sellerProfileId },
    create: { sellerProfileId, ...dbPayload },
    update: dbPayload,
  });

  return result;
}
