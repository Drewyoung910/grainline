// Database reads for the Workshop sidebar, overview and Listings page. Kept in
// one file so a change to how seller listings are read has one place to land.
import { cache } from "react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sellerRefundOutcomes } from "@/lib/orderPaymentEventReadAuthority";
import { readSellerOrderSummaryPage } from "@/lib/orderParticipantReadAuthority";
import { ordersAwaitingFulfillment, workshopListingFilterStatus, type WorkshopListingFilter } from "@/lib/workshopQueue";

const ORDER_QUEUE_LIMIT = 50;
const RECENT_ORDER_ROWS = 4;
export const WORKSHOP_LISTINGS_PAGE_SIZE = 30;
const LOW_STOCK_MAX = 2;

// Shared by the sidebar and the overview within one request.
export const readWorkshopOrderQueue = cache(async (actorUserId: string) => {
  const page = await readSellerOrderSummaryPage({ actorUserId, limit: ORDER_QUEUE_LIMIT });
  const refundOutcomes = await sellerRefundOutcomes(actorUserId, page.rows.map((order) => order.id));
  const awaiting = ordersAwaitingFulfillment(page.rows, refundOutcomes);
  return {
    awaiting,
    // The window is the newest 50 orders, so a full window may hide older work.
    capped: page.rows.length === ORDER_QUEUE_LIMIT && awaiting.length === ORDER_QUEUE_LIMIT,
    recent: page.rows.slice(0, RECENT_ORDER_ROWS),
    refundOutcomes,
  };
});

export async function readWorkshopListingAttention(sellerProfileId: string) {
  const [underReview, rejected, lowStock] = await Promise.all([
    prisma.listing.findMany({
      where: { sellerId: sellerProfileId, archivedAt: null, status: "PENDING_REVIEW" },
      select: { title: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 50,
    }),
    prisma.listing.count({ where: { sellerId: sellerProfileId, archivedAt: null, status: "REJECTED" } }),
    prisma.listing.findMany({
      where: {
        sellerId: sellerProfileId,
        archivedAt: null,
        status: "ACTIVE",
        listingType: "IN_STOCK",
        stockQuantity: { gte: 1, lte: LOW_STOCK_MAX },
      },
      select: { title: true, stockQuantity: true },
      orderBy: [{ stockQuantity: "asc" }, { id: "asc" }],
      take: 3,
    }),
  ]);
  return {
    underReview: underReview.length,
    underReviewTitle: underReview[0]?.title ?? null,
    rejected,
    lowStock: lowStock.map((item) => ({ title: item.title, stockQuantity: item.stockQuantity ?? 0 })),
  };
}

function listingFilterWhere(sellerProfileId: string, filter: WorkshopListingFilter): Prisma.ListingWhereInput {
  const where: Prisma.ListingWhereInput = { sellerId: sellerProfileId, archivedAt: null };
  if (filter === "stock") return { ...where, listingType: "IN_STOCK" };
  const status = workshopListingFilterStatus(filter);
  return status ? { ...where, status: status as Prisma.ListingWhereInput["status"] } : where;
}

export async function readWorkshopListingFilterCounts(sellerProfileId: string) {
  const [statusRows, inStock] = await Promise.all([
    prisma.listing.groupBy({
      by: ["status"],
      where: { sellerId: sellerProfileId, archivedAt: null },
      _count: { _all: true },
    }),
    prisma.listing.count({ where: { sellerId: sellerProfileId, archivedAt: null, listingType: "IN_STOCK" } }),
  ]);
  return {
    statusCounts: Object.fromEntries(statusRows.map((row) => [row.status, row._count._all])) as Record<string, number>,
    inStock,
  };
}

export async function readWorkshopListingsPage(
  sellerProfileId: string,
  filter: WorkshopListingFilter,
  page: number,
) {
  return prisma.listing.findMany({
    where: listingFilterWhere(sellerProfileId, filter),
    select: {
      id: true,
      title: true,
      priceCents: true,
      currency: true,
      status: true,
      listingType: true,
      stockQuantity: true,
      isPrivate: true,
      viewCount: true,
      clickCount: true,
      favoriteCount: true,
      aiReviewFlags: true,
      reviewedByAdmin: true,
      createdAt: true,
      updatedAt: true,
      photos: { orderBy: { sortOrder: "asc" }, take: 1 },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * WORKSHOP_LISTINGS_PAGE_SIZE,
    take: WORKSHOP_LISTINGS_PAGE_SIZE,
  });
}
