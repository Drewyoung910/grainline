import { unstable_cache } from "next/cache";
import { getPublicSellerOrderStats } from "@/lib/orderPublicAggregateAuthority";

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

  const stats = await getPublicSellerOrderStats({
    sellerProfileId,
    recentShippingSince: recentShippingCutoff,
  });
  if (!stats) return { soldCount: 0, avgShipDays: null };

  return {
    soldCount: stats.soldCount,
    avgShipDays: stats.shippedCount >= 3 && stats.avgShipDays != null
      ? Math.max(1, Math.round(stats.avgShipDays))
      : null,
  };
}

export const getCachedPublicSellerStats = unstable_cache(
  loadPublicSellerStats,
  ["public-seller-stats-v1"],
  { revalidate: PUBLIC_SELLER_STATS_REVALIDATE_SECONDS },
);
