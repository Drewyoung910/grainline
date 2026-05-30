import { prisma } from "@/lib/db";
import { blockingRefundLedgerWhere } from "@/lib/refundRouteState";
import { withSerializableRetry } from "@/lib/transactionRetry";
import { Prisma } from "@prisma/client";

const LISTING_SOFT_DELETE_ACTIVE_FULFILLMENT_STATUSES = ["PENDING", "READY_FOR_PICKUP", "SHIPPED"] as const;
export const LISTING_SOFT_DELETE_TERMINAL_ORDER_BLOCK_DAYS = 30;
const LISTING_SOFT_DELETE_ACTIVE_CASE_STATUSES = ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE", "UNDER_REVIEW"] as const;

function listingSoftDeleteOrderBlockerWhere(listingId: string, now = new Date()): Prisma.OrderWhereInput {
  const terminalCutoff = new Date(
    now.getTime() - LISTING_SOFT_DELETE_TERMINAL_ORDER_BLOCK_DAYS * 24 * 60 * 60 * 1000,
  );

  return {
    items: { some: { listingId } },
    sellerRefundId: null,
    paymentEvents: { none: blockingRefundLedgerWhere() },
    OR: [
      { fulfillmentStatus: { in: [...LISTING_SOFT_DELETE_ACTIVE_FULFILLMENT_STATUSES] } },
      {
        fulfillmentStatus: "DELIVERED",
        OR: [
          { deliveredAt: null },
          { deliveredAt: { gte: terminalCutoff } },
        ],
      },
      {
        fulfillmentStatus: "PICKED_UP",
        OR: [
          { pickedUpAt: null },
          { pickedUpAt: { gte: terminalCutoff } },
        ],
      },
      { case: { is: { status: { in: [...LISTING_SOFT_DELETE_ACTIVE_CASE_STATUSES] } } } },
    ],
  };
}

export async function softDeleteListingWithCleanup(listingId: string) {
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const activeOrderCount = await tx.order.count({
      where: listingSoftDeleteOrderBlockerWhere(listingId),
    });
    if (activeOrderCount > 0) {
      throw new Error("Cannot delete a listing with open, active, or recently fulfilled orders inside the case window.");
    }

    await tx.listing.update({
      where: { id: listingId },
      data: { status: "HIDDEN", isPrivate: true },
    });
    await tx.favorite.deleteMany({ where: { listingId } });
    await tx.stockNotification.deleteMany({ where: { listingId } });
    await tx.cartItem.deleteMany({ where: { listingId } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
