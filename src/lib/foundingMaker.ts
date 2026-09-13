import { prisma } from "@/lib/db";
import {
  FOUNDING_MAKER_CAP,
  maybeGrantFoundingMakerWithClient,
} from "@/lib/foundingMakerCore";
import { publicListingWhere } from "@/lib/listingVisibility";
import { logServerError } from "@/lib/serverErrorLogger";

export const FOUNDING_MAKER_REPAIR_LISTING_SCAN_LIMIT = 250;
export const FOUNDING_MAKER_REPAIR_SELLER_LIMIT = 25;

/**
 * Idempotent + race-safe grant of the Founding Maker badge to a seller.
 *
 * Called whenever a listing transitions to ACTIVE. The first time a seller
 * has any ACTIVE listing AND the total number of Founding Makers is still
 * under the cap, they become a Founding Maker.
 *
 * Buyers never get the badge because buyers never create an ACTIVE listing.
 *
 * Safe to call from multiple code paths and concurrently. The shared allocator
 * takes a short Postgres advisory lock around max-number assignment so a burst
 * of simultaneous seller grants cannot exhaust a fixed retry count.
 */
export async function maybeGrantFoundingMaker(sellerProfileId: string): Promise<void> {
  try {
    await maybeGrantFoundingMakerWithClient(prisma, sellerProfileId);
  } catch (err) {
    // Non-fatal: the listing transition is the primary work, the badge is a bonus.
    logServerError(err, {
      level: "warning",
      source: "founding_maker_grant",
      extra: { sellerProfileId },
    });
  }
}

export async function repairMissedFoundingMakerGrants(opts: {
  listingScanLimit?: number;
  sellerLimit?: number;
} = {}) {
  const listingScanLimit = Math.max(
    1,
    Math.min(opts.listingScanLimit ?? FOUNDING_MAKER_REPAIR_LISTING_SCAN_LIMIT, FOUNDING_MAKER_REPAIR_LISTING_SCAN_LIMIT),
  );
  const sellerLimit = Math.max(
    1,
    Math.min(opts.sellerLimit ?? FOUNDING_MAKER_REPAIR_SELLER_LIMIT, FOUNDING_MAKER_REPAIR_SELLER_LIMIT),
  );

  const currentMax = await prisma.foundingMakerGrant.aggregate({
    _max: { foundingMakerNumber: true },
  });
  const remainingSlots = FOUNDING_MAKER_CAP - (currentMax._max.foundingMakerNumber ?? 0);
  if (remainingSlots <= 0) {
    return { ok: true, scannedListings: 0, attemptedSellers: 0, repairedSellers: 0, remainingSlots: 0 };
  }

  const candidateListings = await prisma.listing.findMany({
    where: publicListingWhere({
      seller: {
        isFoundingMaker: false,
      },
    }),
    orderBy: [
      { createdAt: "asc" },
      { id: "asc" },
    ],
    take: listingScanLimit,
    select: {
      sellerId: true,
    },
  });

  const sellerIds: string[] = [];
  const seen = new Set<string>();
  for (const listing of candidateListings) {
    if (seen.has(listing.sellerId)) continue;
    seen.add(listing.sellerId);
    sellerIds.push(listing.sellerId);
    if (sellerIds.length >= Math.min(sellerLimit, remainingSlots)) break;
  }

  let repairedSellers = 0;
  for (const sellerId of sellerIds) {
    await maybeGrantFoundingMaker(sellerId);
    const seller = await prisma.sellerProfile.findUnique({
      where: { id: sellerId },
      select: { isFoundingMaker: true },
    });
    if (seller?.isFoundingMaker) repairedSellers += 1;
  }

  return {
    ok: true,
    scannedListings: candidateListings.length,
    attemptedSellers: sellerIds.length,
    repairedSellers,
    remainingSlots: Math.max(0, remainingSlots - repairedSellers),
  };
}
