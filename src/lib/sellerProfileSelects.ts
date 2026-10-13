import { Prisma } from "@prisma/client";

// Shared authenticated-owner bootstrap projection. Keep this bounded to fields
// consumed immediately by ensureSeller callers; page-specific private settings
// use their own explicit projections below.
export const sellerBootstrapSelect = {
  id: true,
  userId: true,
  displayName: true,
  chargesEnabled: true,
  stripeAccountId: true,
  vacationMode: true,
  bannerImageUrl: true,
  avatarImageUrl: true,
  workshopImageUrl: true,
  galleryImageUrls: true,
} satisfies Prisma.SellerProfileSelect;

export const sellerSettingsOwnerSelect = {
  id: true,
  stripeAccountId: true,
  chargesEnabled: true,
  vacationMode: true,
  vacationReturnDate: true,
  vacationMessage: true,
  city: true,
  state: true,
  lat: true,
  lng: true,
  radiusMeters: true,
  publicMapOptIn: true,
  shippingFlatRateCents: true,
  freeShippingOverCents: true,
  allowLocalPickup: true,
  useCalculatedShipping: true,
  preferredCarriers: true,
  shipFromName: true,
  shipFromLine1: true,
  shipFromLine2: true,
  shipFromCity: true,
  shipFromState: true,
  shipFromPostal: true,
  shipFromCountry: true,
  shipFromPhone: true,
  defaultPkgWeightGrams: true,
  defaultPkgLengthCm: true,
  defaultPkgWidthCm: true,
  defaultPkgHeightCm: true,
} satisfies Prisma.SellerProfileSelect;

export const sellerProfileEditorSelect = {
  avatarImageUrl: true,
  bannerImageUrl: true,
  displayName: true,
  tagline: true,
  yearsInBusiness: true,
  bio: true,
  storyTitle: true,
  storyBody: true,
  workshopImageUrl: true,
  galleryImageUrls: true,
  galleryAltTexts: true,
  instagramUrl: true,
  facebookUrl: true,
  pinterestUrl: true,
  tiktokUrl: true,
  websiteUrl: true,
  returnPolicy: true,
  customOrderPolicy: true,
  shippingPolicy: true,
  acceptsCustomOrders: true,
  acceptingNewOrders: true,
  customOrderTurnaroundDays: true,
  offersGiftWrapping: true,
  giftWrappingPriceCents: true,
  featuredListingIds: true,
} satisfies Prisma.SellerProfileSelect;

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
