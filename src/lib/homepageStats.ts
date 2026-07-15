import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { publicListingWhere } from "@/lib/listingVisibility";
import { activeSellerProfileWhere } from "@/lib/sellerVisibility";
import { paidStripeOrderWhere } from "@/lib/orderTrust";
import { blockingRefundLedgerWhere } from "@/lib/refundRouteState";

export const HOMEPAGE_STATS_REVALIDATE_SECONDS = 5 * 60;

export type HomepageStats = {
  pieces: number;
  makers: number;
  members: number;
  fulfilledOrders: number;
};

async function loadHomepageStats(): Promise<HomepageStats> {
  const [pieces, makers, members, fulfilledOrders] = await Promise.all([
    prisma.listing.count({ where: publicListingWhere() }),
    prisma.sellerProfile.count({
      where: activeSellerProfileWhere({
        listings: { some: publicListingWhere() },
      }),
    }),
    prisma.user.count({
      where: { banned: false, deletedAt: null },
    }),
    prisma.order.count({
      where: {
        ...paidStripeOrderWhere(),
        sellerRefundId: null,
        paymentEvents: { none: blockingRefundLedgerWhere() },
        fulfillmentStatus: { in: ["DELIVERED", "PICKED_UP"] },
      },
    }),
  ]);

  return { pieces, makers, members, fulfilledOrders };
}

export const getCachedHomepageStats = unstable_cache(
  loadHomepageStats,
  ["homepage-stats-v1"],
  { revalidate: HOMEPAGE_STATS_REVALIDATE_SECONDS },
);
