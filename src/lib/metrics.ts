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

  // Run all queries in parallel
  const [reviews, completedOrders, shippedOrders, activeCaseCount, conversations] =
    await Promise.all([
      // All reviews on this seller's listings (all-time)
      prisma.review.findMany({
        where: { listing: { sellerId: sellerProfileId } },
        select: { ratingX2: true },
      }),

      // Completed orders (DELIVERED or PICKED_UP) — all-time
      prisma.order.findMany({
        where: {
          items: { some: { listing: { sellerId: sellerProfileId } } },
          fulfillmentStatus: { in: ["DELIVERED", "PICKED_UP"] },
          sellerRefundId: null,
        },
        select: {
          items: {
            where: { listing: { sellerId: sellerProfileId } },
            select: { priceCents: true, quantity: true },
          },
        },
      }),

      // Orders shipped within the period (for on-time shipping rate)
      prisma.order.findMany({
        where: {
          items: { some: { listing: { sellerId: sellerProfileId } } },
          sellerRefundId: null,
          shippedAt: { not: null, gte: periodStart },
          processingDeadline: { not: null },
        },
        select: { shippedAt: true, processingDeadline: true },
      }),

      // Active (open) cases
      prisma.case.count({
        where: {
          sellerId: seller.userId,
          status: { notIn: ["RESOLVED", "CLOSED"] },
        },
      }),

      // Conversations in the period (for response rate)
      prisma.conversation.findMany({
        where: {
          OR: [{ userAId: seller.userId }, { userBId: seller.userId }],
          createdAt: { gte: periodStart },
        },
        select: {
          userAId: true,
          userBId: true,
          firstResponseAt: true,
          messages: {
            take: 1,
            orderBy: { createdAt: "asc" },
            select: { senderId: true },
          },
        },
      }),
    ]);

  // Average rating (all-time)
  const reviewCount = reviews.length;
  const averageRating =
    reviewCount > 0
      ? reviews.reduce((sum, r) => sum + r.ratingX2, 0) / (reviewCount * 2)
      : 0;

  // Completed sales (all-time)
  const completedOrderCount = completedOrders.length;
  const totalSalesCents = completedOrders.reduce(
    (sum, o) => sum + o.items.reduce((s, i) => s + i.priceCents * i.quantity, 0),
    0
  );

  // On-time shipping rate (period)
  // An order is on-time if shippedAt <= processingDeadline
  const validShipped = shippedOrders.filter((o) => o.shippedAt && o.processingDeadline);
  const onTimeCount = validShipped.filter(
    (o) => new Date(o.shippedAt!) <= new Date(o.processingDeadline!)
  ).length;
  const onTimeShippingRate =
    validShipped.length > 0 ? onTimeCount / validShipped.length : 0;

  // Response rate (period)
  // Buyer-initiated = first message NOT from seller
  const buyerInitiated = conversations.filter(
    (c) => c.messages[0]?.senderId !== seller.userId
  );
  const sellerResponded = buyerInitiated.filter((c) => c.firstResponseAt !== null);
  const responseRate =
    buyerInitiated.length > 0 ? sellerResponded.length / buyerInitiated.length : 0;

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
