import { Prisma } from "@prisma/client";

// Shared authenticated-owner bootstrap projection. Keep this bounded to fields
// consumed immediately by ensureSeller callers; page-specific private settings
// use their own explicit projections below.
export const sellerBootstrapSelect = {
  id: true,
  userId: true,
  displayName: true,
  chargesEnabled: true,
  vacationMode: true,
  bannerImageUrl: true,
  avatarImageUrl: true,
  workshopImageUrl: true,
  galleryImageUrls: true,
} satisfies Prisma.SellerProfileSelect;

export const sellerSettingsOwnerSelect = {
  id: true,
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
