import { prisma } from "@/lib/db";
import { getPublicMarketplaceListingMetrics } from "@/lib/orderPublicAggregateAuthority";
import { sellerPublicMarketplaceRatingAverage } from "@/lib/sellerProfilePublicAccess";

export type SiteMetricsSnapshotResult = {
  avgConversion: number;
  avgCtr: number;
  avgRating: number;
  calculatedAt: Date;
};

export async function calculateSiteMetricsSnapshot(): Promise<SiteMetricsSnapshotResult> {
  const [traffic, avgRating] = await Promise.all([
    getPublicMarketplaceListingMetrics(),
    sellerPublicMarketplaceRatingAverage(),
  ]);

  const totalViews = traffic.totalViews;
  const totalOrders = traffic.totalOrders;
  const totalClicks = traffic.totalClicks;
  const calculatedAt = new Date();
  const payload = {
    avgConversion: totalViews > 0 ? totalOrders / totalViews : 0,
    avgCtr: totalViews > 0 ? totalClicks / totalViews : 0,
    avgRating: avgRating ?? 3.0,
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
