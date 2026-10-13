import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type SellerCheckoutListingClient = Pick<Prisma.TransactionClient, "listing">;

// Exact seller state used to decide whether a buyer may start or continue a
// purchase. The compatibility implementation reads SellerProfile until the
// companion table and fixed checkout operation are installed in Production.
export const listingSellerOrderStateSelect = {
  id: true,
  userId: true,
  chargesEnabled: true,
  stripeAccountId: true,
  stripeAccountVersion: true,
  ownerAccountActive: true,
  vacationMode: true,
  acceptingNewOrders: true,
} satisfies Prisma.SellerProfileSelect;

export const cartCheckoutSellerSelect = {
  ...listingSellerOrderStateSelect,
  displayName: true,
  offersGiftWrapping: true,
  giftWrappingPriceCents: true,
  allowLocalPickup: true,
  defaultPkgWeightGrams: true,
  defaultPkgLengthCm: true,
  defaultPkgWidthCm: true,
  defaultPkgHeightCm: true,
} satisfies Prisma.SellerProfileSelect;

export const sellerCartCheckoutInclude = {
  items: {
    include: {
      listing: {
        include: {
          seller: { select: cartCheckoutSellerSelect },
          photos: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] },
          variantGroups: { include: { options: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.CartInclude;

export function sellerSingleCheckoutSource(
  listingId: string,
  client: SellerCheckoutListingClient = prisma,
) {
  return client.listing.findUnique({
    where: { id: listingId },
    include: {
      photos: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] },
      seller: { select: cartCheckoutSellerSelect },
      variantGroups: { include: { options: true } },
    },
  });
}

export function sellerSingleCheckoutResumeSource(
  listingId: string,
  client: SellerCheckoutListingClient = prisma,
) {
  return client.listing.findUnique({
    where: { id: listingId },
    select: {
      status: true,
      isPrivate: true,
      reservedForUserId: true,
      seller: { select: listingSellerOrderStateSelect },
    },
  });
}
