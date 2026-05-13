import { ListingStatus, Prisma } from "@prisma/client";

const SUPPORTED_STRIPE_CONNECT_ACCOUNT_VERSION = "v2";

const SAVED_LISTING_PUBLIC_SELLER_STATE = {
  chargesEnabled: true,
  OR: [
    { stripeAccountVersion: null },
    { stripeAccountVersion: SUPPORTED_STRIPE_CONNECT_ACCOUNT_VERSION },
  ],
  vacationMode: false,
  user: { banned: false, deletedAt: null },
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
