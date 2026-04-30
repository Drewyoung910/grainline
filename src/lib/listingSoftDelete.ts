import { prisma } from "@/lib/db";
import { blockingRefundLedgerWhere } from "@/lib/refundRouteState";
import { withSerializableRetry } from "@/lib/transactionRetry";
import { Prisma } from "@prisma/client";

export async function softDeleteListingWithCleanup(listingId: string) {
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const activeOrderCount = await tx.order.count({
      where: {
        items: { some: { listingId } },
        sellerRefundId: null,
        paymentEvents: { none: blockingRefundLedgerWhere() },
        OR: [
          { fulfillmentStatus: { in: ["PENDING", "READY_FOR_PICKUP", "SHIPPED"] } },
          { case: { is: { status: { in: ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE", "UNDER_REVIEW"] } } } },
        ],
      },
    });
    if (activeOrderCount > 0) {
      throw new Error("Cannot delete a listing with open orders or active cases.");
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
