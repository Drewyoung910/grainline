import { Prisma } from "@prisma/client";

// Exact seller fields used to decide whether a buyer may start or continue a
// purchase. Provider-version detail remains here until checkout receives its
// purpose-bound private operation; public discovery must use
// stripeAccountSupported instead.
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
