import { prisma } from "@/lib/db";
import { getPublicMarketplaceListingMetrics } from "@/lib/orderPublicAggregateAuthority";

export type SiteMetricsSnapshotResult = {
  avgConversion: number;
  avgCtr: number;
  avgRating: number;
  calculatedAt: Date;
};

export async function calculateSiteMetricsSnapshot(): Promise<SiteMetricsSnapshotResult> {
  const [traffic, ratingRows] = await Promise.all([
    getPublicMarketplaceListingMetrics(),
    prisma.$queryRaw<Array<{ avgRating: number | null }>>`
      SELECT AVG(r."ratingX2")::float / 2.0 AS "avgRating"
      FROM "Review" r
      JOIN "Listing" l ON l.id = r."listingId"
      JOIN "SellerProfile" sp ON sp.id = l."sellerId"
      JOIN "User" u ON u.id = sp."userId"
      WHERE l.status = 'ACTIVE'
        AND l."isPrivate" = false
        AND sp."chargesEnabled" = true
        AND (sp."stripeAccountVersion" IS NULL OR sp."stripeAccountVersion" = 'v2')
        AND sp."vacationMode" = false
        AND u.banned = false
        AND u."deletedAt" IS NULL
    `,
  ]);

  const totalViews = traffic.totalViews;
  const totalOrders = traffic.totalOrders;
  const totalClicks = traffic.totalClicks;
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
