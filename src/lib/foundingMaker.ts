import { prisma } from "@/lib/db";
import { publicListingWhere } from "@/lib/listingVisibility";
import { logServerError } from "@/lib/serverErrorLogger";

const FOUNDING_MAKER_CAP = 250;
const FOUNDING_MAKER_LOCK_NAMESPACE = 913337;
const FOUNDING_MAKER_LOCK_KEY = 250;

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
 * takes a short Postgres advisory lock around max-number assignment so a burst
 * of simultaneous seller grants cannot exhaust a fixed retry count. The unique
 * index on foundingMakerNumber remains the database backstop.
 */
export async function maybeGrantFoundingMaker(sellerProfileId: string): Promise<void> {
  try {
    // Cheap pre-check: bail if seller already has the badge.
    const seller = await prisma.sellerProfile.findUnique({
      where: { id: sellerProfileId },
      select: { id: true, isFoundingMaker: true },
    });
    if (!seller || seller.isFoundingMaker) return;

    // Cheap pre-check: avoid taking the assignment lock if no public listing exists.
    const activeListingCount = await prisma.listing.count({
      where: publicListingWhere({ sellerId: sellerProfileId }),
    });
    if (activeListingCount === 0) return;

    // Assign from the current max number instead of count+1 so deleted/gapped
    // numbers are never reused. The advisory lock serializes only this tiny
    // assignment window and avoids silently dropping eligible sellers during a
    // high-concurrency publish burst.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(${FOUNDING_MAKER_LOCK_NAMESPACE}, ${FOUNDING_MAKER_LOCK_KEY})
      `;

      const stillEligible = await tx.listing.count({
        where: publicListingWhere({ sellerId: sellerProfileId }),
      });
      if (stillEligible === 0) return;

      const currentMax = await tx.sellerProfile.aggregate({
        where: { isFoundingMaker: true },
        _max: { foundingMakerNumber: true },
      });
      const nextNumber = (currentMax._max.foundingMakerNumber ?? 0) + 1;
      if (nextNumber > FOUNDING_MAKER_CAP) return;

      await tx.sellerProfile.updateMany({
        where: { id: sellerProfileId, isFoundingMaker: false },
        data: {
          isFoundingMaker: true,
          foundingMakerNumber: nextNumber,
          foundingMakerAt: new Date(),
        },
      });
    }, { maxWait: 5000, timeout: 10000 });
  } catch (err) {
    // Non-fatal: the listing transition is the primary work, the badge is a bonus.
    logServerError(err, {
      level: "warning",
      source: "founding_maker_grant",
      extra: { sellerProfileId },
    });
  }
}
