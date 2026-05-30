import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const PUBLIC_SELLER_STATS_REVALIDATE_SECONDS = 5 * 60;
export const PUBLIC_SELLER_RECENT_SHIPPING_STATS_DAYS = 180;

export type PublicSellerStats = {
  soldCount: number;
  avgShipDays: number | null;
};

async function loadPublicSellerStats(sellerProfileId: string): Promise<PublicSellerStats> {
  const recentShippingCutoff = new Date(
    Date.now() - PUBLIC_SELLER_RECENT_SHIPPING_STATS_DAYS * MS_PER_DAY,
  );

  const [soldCount, shippingRows] = await Promise.all([
    prisma.orderItem.count({
      where: { listing: { sellerId: sellerProfileId }, order: { paidAt: { not: null } } },
    }),
    prisma.$queryRaw<Array<{ shippedCount: bigint; avgShipDays: number | null }>>`
      SELECT
        COUNT(*)::bigint AS "shippedCount",
        AVG(EXTRACT(EPOCH FROM (recent."shippedAt" - recent."paidAt")) / 86400.0)::float AS "avgShipDays"
      FROM (
        SELECT o."paidAt", o."shippedAt"
        FROM "Order" o
        WHERE o."paidAt" IS NOT NULL
          AND o."shippedAt" IS NOT NULL
          AND o."shippedAt" >= ${recentShippingCutoff}
          AND EXISTS (
            SELECT 1
            FROM "OrderItem" oi
            JOIN "Listing" l ON l.id = oi."listingId"
            WHERE oi."orderId" = o.id
              AND l."sellerId" = ${sellerProfileId}
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "OrderItem" oi
            JOIN "Listing" l ON l.id = oi."listingId"
            WHERE oi."orderId" = o.id
              AND l."sellerId" <> ${sellerProfileId}
          )
        ORDER BY o."shippedAt" DESC
        LIMIT 30
      ) recent
    `,
  ]);

  const shippingStats = shippingRows[0];
  const shippedCount = Number(shippingStats?.shippedCount ?? 0);
  const rawAvgShipDays =
    typeof shippingStats?.avgShipDays === "number" && Number.isFinite(shippingStats.avgShipDays)
      ? shippingStats.avgShipDays
      : null;

  return {
    soldCount,
    avgShipDays: shippedCount >= 3 && rawAvgShipDays != null
      ? Math.max(1, Math.round(rawAvgShipDays))
      : null,
  };
}

export const getCachedPublicSellerStats = unstable_cache(
  loadPublicSellerStats,
  ["public-seller-stats-v1"],
  { revalidate: PUBLIC_SELLER_STATS_REVALIDATE_SECONDS },
);
