import { prisma } from "@/lib/db";

const FOUNDING_MAKER_CAP = 250;

/**
 * Idempotent + race-safe grant of the Founding Maker badge to a seller.
 *
 * Called whenever a listing transitions to ACTIVE. The first time a seller
 * has any ACTIVE listing AND the total number of Founding Makers is still
 * under the cap, they become a Founding Maker.
 *
 * Buyers never get the badge because buyers never create an ACTIVE listing.
 *
 * Safe to call from multiple code paths and concurrently. The transaction
 * does the count + assign atomically; the unique index on foundingMakerNumber
 * prevents accidental double-issue.
 */
export async function maybeGrantFoundingMaker(sellerProfileId: string): Promise<void> {
  try {
    // Cheap pre-check: bail if seller already has the badge.
    const seller = await prisma.sellerProfile.findUnique({
      where: { id: sellerProfileId },
      select: { id: true, isFoundingMaker: true },
    });
    if (!seller || seller.isFoundingMaker) return;

    // Confirm the seller has at least one ACTIVE listing right now.
    const activeListingCount = await prisma.listing.count({
      where: {
        sellerId: sellerProfileId,
        status: "ACTIVE",
        isPrivate: false,
      },
    });
    if (activeListingCount === 0) return;

    // Atomic count + assign. If two sellers race to be #250, only one wins
    // (the unique index also enforces this at the DB level).
    await prisma.$transaction(async (tx) => {
      const currentCount = await tx.sellerProfile.count({
        where: { isFoundingMaker: true },
      });
      if (currentCount >= FOUNDING_MAKER_CAP) return;

      // updateMany with isFoundingMaker:false guard so a parallel grant
      // can't re-grant to the same seller.
      await tx.sellerProfile.updateMany({
        where: { id: sellerProfileId, isFoundingMaker: false },
        data: {
          isFoundingMaker: true,
          foundingMakerNumber: currentCount + 1,
          foundingMakerAt: new Date(),
        },
      });
    });
  } catch (err) {
    // Non-fatal: the listing transition is the primary work, the badge is a bonus.
    if (process.env.NODE_ENV !== "production") {
      console.error("[founding-maker] grant failed", err);
    }
  }
}
