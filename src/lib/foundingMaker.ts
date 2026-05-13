import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

const FOUNDING_MAKER_CAP = 250;
const FOUNDING_MAKER_GRANT_ATTEMPTS = 3;

function isUniqueConstraintError(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

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

    // Assign from the current max number instead of count+1 so deleted/gapped
    // numbers are never reused. Retry unique collisions from concurrent grants.
    for (let attempt = 0; attempt < FOUNDING_MAKER_GRANT_ATTEMPTS; attempt++) {
      try {
        await prisma.$transaction(async (tx) => {
          const currentMax = await tx.sellerProfile.aggregate({
            where: { isFoundingMaker: true },
            _max: { foundingMakerNumber: true },
          });
          const nextNumber = (currentMax._max.foundingMakerNumber ?? 0) + 1;
          if (nextNumber > FOUNDING_MAKER_CAP) return;

          const updated = await tx.sellerProfile.updateMany({
            where: { id: sellerProfileId, isFoundingMaker: false },
            data: {
              isFoundingMaker: true,
              foundingMakerNumber: nextNumber,
              foundingMakerAt: new Date(),
            },
          });
          if (updated.count === 0) return;
        });
        return;
      } catch (err) {
        if (isUniqueConstraintError(err) && attempt < FOUNDING_MAKER_GRANT_ATTEMPTS - 1) {
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    // Non-fatal: the listing transition is the primary work, the badge is a bonus.
    if (process.env.NODE_ENV !== "production") {
      console.error("[founding-maker] grant failed", err);
    }
  }
}
