import { ListingStatus, Prisma } from "@prisma/client";

export function savedListingFavoriteWhere(
  userId: string,
  blockedSellerIds: string[] = [],
): Prisma.FavoriteWhereInput {
  return {
    userId,
    listing: {
      status: { in: [ListingStatus.ACTIVE, ListingStatus.SOLD_OUT] },
      isPrivate: false,
      ...(blockedSellerIds.length > 0 ? { sellerId: { notIn: blockedSellerIds } } : {}),
      seller: {
        chargesEnabled: true,
        vacationMode: false,
        user: { banned: false, deletedAt: null },
      },
    },
  };
}
