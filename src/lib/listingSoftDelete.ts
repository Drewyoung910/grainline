import { prisma } from "@/lib/db";
import { withSerializableRetry } from "@/lib/transactionRetry";
import { CASE_WINDOW_DAYS } from "@/lib/caseCreateState";
import { Prisma } from "@prisma/client";
import { getListingOrderArchiveBlocked } from "@/lib/orderEligibilityAuthority";

export const LISTING_SOFT_DELETE_TERMINAL_ORDER_BLOCK_DAYS = CASE_WINDOW_DAYS;

export async function softDeleteListingWithCleanup(listingId: string, actorUserId: string) {
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const blocked = await getListingOrderArchiveBlocked({
      actorUserId,
      listingId,
      now: new Date(),
    }, tx);
    if (blocked == null) {
      throw new Error("Listing not found.");
    }
    if (blocked) {
      throw new Error("Cannot delete a listing with open, active, or recently fulfilled orders inside the case window.");
    }

    const listing = await tx.listing.updateMany({
      where: {
        id: listingId,
        seller: { userId: actorUserId },
      },
      data: { status: "HIDDEN", isPrivate: true },
    });
    if (listing.count !== 1) {
      throw new Error("Listing state changed; refresh and try again.");
    }
    await tx.favorite.deleteMany({ where: { listingId } });
    await tx.stockNotification.deleteMany({ where: { listingId } });
    await tx.cartItem.deleteMany({ where: { listingId } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
