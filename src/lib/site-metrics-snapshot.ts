import { prisma } from "@/lib/db";

export type SiteMetricsSnapshotResult = {
  avgConversion: number;
  avgCtr: number;
  avgRating: number;
  calculatedAt: Date;
};

export async function calculateSiteMetricsSnapshot(): Promise<SiteMetricsSnapshotResult> {
  const [trafficRows, ratingRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        totalViews: bigint;
        totalOrders: bigint;
        totalClicks: bigint;
      }>
    >`
      WITH visible_listings AS (
        SELECT l.id, l."viewCount", l."clickCount"
        FROM "Listing" l
        JOIN "SellerProfile" sp ON sp.id = l."sellerId"
        JOIN "User" u ON u.id = sp."userId"
        WHERE l.status = 'ACTIVE'
          AND l."isPrivate" = false
          AND sp."chargesEnabled" = true
          AND sp."vacationMode" = false
          AND u.banned = false
          AND u."deletedAt" IS NULL
      )
      SELECT
        COALESCE((SELECT SUM("viewCount") FROM visible_listings), 0) AS "totalViews",
        COALESCE((SELECT SUM("clickCount") FROM visible_listings), 0) AS "totalClicks",
        COALESCE((
          SELECT COUNT(oi.id)
          FROM "OrderItem" oi
          JOIN "Order" o ON o.id = oi."orderId"
          JOIN visible_listings vl ON vl.id = oi."listingId"
          WHERE o."sellerRefundId" IS NULL
            AND o."paidAt" IS NOT NULL
        ), 0) AS "totalOrders"
    `,
    prisma.$queryRaw<Array<{ avgRating: number | null }>>`
      SELECT AVG(r."ratingX2")::float / 2.0 AS "avgRating"
      FROM "Review" r
      JOIN "Listing" l ON l.id = r."listingId"
      JOIN "SellerProfile" sp ON sp.id = l."sellerId"
      JOIN "User" u ON u.id = sp."userId"
      WHERE l.status = 'ACTIVE'
        AND l."isPrivate" = false
        AND sp."chargesEnabled" = true
        AND sp."vacationMode" = false
        AND u.banned = false
        AND u."deletedAt" IS NULL
    `,
  ]);

  const traffic = trafficRows[0];
  const totalViews = Number(traffic?.totalViews ?? 0);
  const totalOrders = Number(traffic?.totalOrders ?? 0);
  const totalClicks = Number(traffic?.totalClicks ?? 0);
  const calculatedAt = new Date();
  const payload = {
    avgConversion: totalViews > 0 ? totalOrders / totalViews : 0,
    avgCtr: totalViews > 0 ? totalClicks / totalViews : 0,
    avgRating: ratingRows[0]?.avgRating ?? 3.0,
    calculatedAt,
  };

  await prisma.siteMetricsSnapshot.upsert({
    where: { id: 1 },
    create: { id: 1, ...payload },
    update: payload,
  });

  return payload;
}

export async function getSiteMetricsSnapshot(): Promise<SiteMetricsSnapshotResult> {
  const snapshot = await prisma.siteMetricsSnapshot.findUnique({ where: { id: 1 } });
  if (snapshot) {
    return {
      avgConversion: snapshot.avgConversion,
      avgCtr: snapshot.avgCtr,
      avgRating: snapshot.avgRating,
      calculatedAt: snapshot.calculatedAt,
    };
  }
  return calculateSiteMetricsSnapshot();
}
