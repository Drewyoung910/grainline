import { ListingStatus, Prisma } from "@prisma/client";

const SAVED_LISTING_PUBLIC_SELLER_STATE = {
  chargesEnabled: true,
  stripeAccountSupported: true,
  vacationMode: false,
  ownerAccountActive: true,
} satisfies Prisma.SellerProfileWhereInput;

export function savedListingFavoriteWhere(
  userId: string,
  blockedSellerIds: string[] = [],
): Prisma.FavoriteWhereInput {
  return {
    userId,
    listing: {
      AND: [
        {
          status: { in: [ListingStatus.ACTIVE, ListingStatus.SOLD_OUT] },
          isPrivate: false,
          seller: SAVED_LISTING_PUBLIC_SELLER_STATE,
        },
        ...(blockedSellerIds.length > 0 ? [{ sellerId: { notIn: blockedSellerIds } }] : []),
      ],
    },
  };
}
