import { unstable_cache } from "next/cache";
import { listingPublicCatalogCount } from "@/lib/listingPublicCatalogAccess";
import { sellerPublicMarketplaceCounts } from "@/lib/sellerProfilePublicAccess";
import { getPublicFulfilledOrderCount } from "@/lib/orderPublicAggregateAuthority";
import { getPublicActiveMemberCount } from "@/lib/userPublicIdentityAccess";

export const HOMEPAGE_STATS_REVALIDATE_SECONDS = 5 * 60;

export type HomepageStats = {
  pieces: number;
  makers: number;
  members: number;
  fulfilledOrders: number;
};

async function loadHomepageStats(): Promise<HomepageStats> {
  const [pieces, marketplaceCounts, members, fulfilledOrders] = await Promise.all([
    listingPublicCatalogCount(null, {}),
    sellerPublicMarketplaceCounts(),
    getPublicActiveMemberCount(),
    getPublicFulfilledOrderCount(),
  ]);

  return {
    pieces,
    makers: marketplaceCounts.activeSellerCount,
    members,
    fulfilledOrders,
  };
}

export const getCachedHomepageStats = unstable_cache(
  loadHomepageStats,
  ["homepage-stats-v1"],
  { revalidate: HOMEPAGE_STATS_REVALIDATE_SECONDS },
);
