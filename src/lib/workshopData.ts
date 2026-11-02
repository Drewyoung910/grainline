// Database reads for the Workshop sidebar, overview and Listings page. Kept in
// one file so a change to how seller listings are read has one place to land.
import { cache } from "react";
import { ListingStatus, ListingType } from "@prisma/client";
import { sellerRefundOutcomes } from "@/lib/orderPaymentEventReadAuthority";
import { readSellerOrderSummaryPage } from "@/lib/orderParticipantReadAuthority";
import { ordersAwaitingFulfillment, workshopListingFilterStatus, type WorkshopListingFilter } from "@/lib/workshopQueue";
import {
  listingOwnerSummaryRows,
  listingOwnerWorkshopSummary,
} from "@/lib/listingOwnerAccess";

const ORDER_QUEUE_LIMIT = 50;
const RECENT_ORDER_ROWS = 4;
export const WORKSHOP_LISTINGS_PAGE_SIZE = 30;

// Shared by the sidebar and the overview within one request.
export const readWorkshopOrderQueue = cache(async (actorUserId: string) => {
  const page = await readSellerOrderSummaryPage({ actorUserId, limit: ORDER_QUEUE_LIMIT });
  const refundOutcomes = await sellerRefundOutcomes(actorUserId, page.rows.map((order) => order.id));
  const awaiting = ordersAwaitingFulfillment(page.rows, refundOutcomes);
  return {
    awaiting,
    // The window is the newest 50 orders, so a full window may hide older work.
    capped: page.rows.length === ORDER_QUEUE_LIMIT,
    recent: page.rows.slice(0, RECENT_ORDER_ROWS),
    refundOutcomes,
  };
});

const readWorkshopListingSummary = cache(listingOwnerWorkshopSummary);

export async function readWorkshopListingAttention(actorUserId: string) {
  const summary = await readWorkshopListingSummary(actorUserId);
  return {
    listingCount: summary.listingCount,
    underReview: summary.statusCounts.PENDING_REVIEW ?? 0,
    underReviewTitle: summary.underReviewTitle,
    rejected: summary.statusCounts.REJECTED ?? 0,
    lowStock: summary.lowStock,
  };
}

export async function readWorkshopListingFilterCounts(actorUserId: string) {
  const summary = await readWorkshopListingSummary(actorUserId);
  return {
    statusCounts: summary.statusCounts,
    inStock: summary.inStock,
  };
}

export async function readWorkshopListingsPage(
  actorUserId: string,
  filter: WorkshopListingFilter,
  page: number,
) {
  const status = workshopListingFilterStatus(filter) as ListingStatus | null;
  return listingOwnerSummaryRows(actorUserId, {
    status: status ?? undefined,
    listingType: filter === "stock" ? ListingType.IN_STOCK : undefined,
    includeArchived: false,
    skip: (page - 1) * WORKSHOP_LISTINGS_PAGE_SIZE,
    take: WORKSHOP_LISTINGS_PAGE_SIZE,
  });
}
