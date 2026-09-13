import { PrismaClient } from "@prisma/client";
import { publicListingWhere } from "./listingVisibility.ts";

export const FOUNDING_MAKER_CAP = 250;
export const FOUNDING_MAKER_LOCK_NAMESPACE = 913337;
export const FOUNDING_MAKER_LOCK_KEY = 250;

export type FoundingMakerClient = Pick<
  PrismaClient,
  "$transaction" | "foundingMakerGrant" | "listing" | "sellerProfile"
>;

/**
 * Shared allocator for Founding Maker grants.
 *
 * FoundingMakerGrant is the durable source of issued numbers. SellerProfile
 * keeps the denormalized public badge fields, but number allocation must not
 * depend on live SellerProfile rows or a future hard delete could recycle the
 * highest deleted number.
 */
export async function maybeGrantFoundingMakerWithClient(
  client: FoundingMakerClient,
  sellerProfileId: string,
): Promise<void> {
  const seller = await client.sellerProfile.findUnique({
    where: { id: sellerProfileId },
    select: { id: true, isFoundingMaker: true },
  });
  if (!seller || seller.isFoundingMaker) return;

  const activeListingCount = await client.listing.count({
    where: publicListingWhere({ sellerId: sellerProfileId }),
  });
  if (activeListingCount === 0) return;

  await client.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(${FOUNDING_MAKER_LOCK_NAMESPACE}, ${FOUNDING_MAKER_LOCK_KEY})
    `;

    const stillEligible = await tx.listing.count({
      where: publicListingWhere({ sellerId: sellerProfileId }),
    });
    if (stillEligible === 0) return;

    const existingGrant = await tx.foundingMakerGrant.findUnique({
      where: { sellerProfileId },
      select: { foundingMakerNumber: true, grantedAt: true },
    });
    if (existingGrant) {
      await tx.sellerProfile.updateMany({
        where: { id: sellerProfileId, isFoundingMaker: false },
        data: {
          isFoundingMaker: true,
          foundingMakerNumber: existingGrant.foundingMakerNumber,
          foundingMakerAt: existingGrant.grantedAt,
        },
      });
      return;
    }

    const currentMax = await tx.foundingMakerGrant.aggregate({
      _max: { foundingMakerNumber: true },
    });
    const nextNumber = (currentMax._max.foundingMakerNumber ?? 0) + 1;
    if (nextNumber > FOUNDING_MAKER_CAP) return;

    const grantedAt = new Date();
    const grant = await tx.foundingMakerGrant.create({
      data: {
        sellerProfileId,
        foundingMakerNumber: nextNumber,
        grantedAt,
      },
      select: {
        foundingMakerNumber: true,
        grantedAt: true,
      },
    });

    await tx.sellerProfile.updateMany({
      where: { id: sellerProfileId, isFoundingMaker: false },
      data: {
        isFoundingMaker: true,
        foundingMakerNumber: grant.foundingMakerNumber,
        foundingMakerAt: grant.grantedAt,
      },
    });
  }, { maxWait: 5000, timeout: 10000 });
}
