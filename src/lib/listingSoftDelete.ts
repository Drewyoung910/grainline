import { prisma } from "@/lib/db";

export async function softDeleteListingWithCleanup(listingId: string) {
  const activeOrderCount = await prisma.order.count({
    where: {
      items: { some: { listingId } },
      sellerRefundId: null,
      OR: [
        { fulfillmentStatus: { in: ["PENDING", "READY_FOR_PICKUP", "SHIPPED"] } },
        { case: { is: { status: { in: ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE", "UNDER_REVIEW"] } } } },
      ],
    },
  });
  if (activeOrderCount > 0) {
    throw new Error("Cannot delete a listing with open orders or active cases.");
  }

  await prisma.$transaction([
    prisma.favorite.deleteMany({ where: { listingId } }),
    prisma.stockNotification.deleteMany({ where: { listingId } }),
    prisma.cartItem.deleteMany({ where: { listingId } }),
    prisma.listing.update({
      where: { id: listingId },
      data: { status: "HIDDEN", isPrivate: true },
    }),
  ]);
}
