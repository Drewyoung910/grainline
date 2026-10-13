import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type SellerOwnerPrivateClient = Pick<Prisma.TransactionClient, "sellerProfile">;

const sellerOwnerOnboardingSelect = {
  onboardingStep: true,
  onboardingComplete: true,
  displayName: true,
  bio: true,
  tagline: true,
  avatarImageUrl: true,
  yearsInBusiness: true,
  city: true,
  state: true,
  returnPolicy: true,
  shippingPolicy: true,
  acceptsCustomOrders: true,
  stripeAccountId: true,
  chargesEnabled: true,
  _count: { select: { listings: true } },
  listings: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, title: true, status: true },
  },
} satisfies Prisma.SellerProfileSelect;

const sellerOwnerExportSelect = {
  id: true,
  displayName: true,
  bio: true,
  city: true,
  state: true,
  lat: true,
  lng: true,
  radiusMeters: true,
  publicMapOptIn: true,
  chargesEnabled: true,
  stripeAccountId: true,
  stripeAccountVersion: true,
  stripeControllerType: true,
  manualStripeReconciliationNeeded: true,
  shippingFlatRateCents: true,
  freeShippingOverCents: true,
  allowLocalPickup: true,
  useCalculatedShipping: true,
  preferredCarriers: true,
  defaultPkgWeightGrams: true,
  defaultPkgLengthCm: true,
  defaultPkgWidthCm: true,
  defaultPkgHeightCm: true,
  shipFromName: true,
  shipFromLine1: true,
  shipFromLine2: true,
  shipFromCity: true,
  shipFromState: true,
  shipFromPostal: true,
  shipFromCountry: true,
  shipFromPhone: true,
  tagline: true,
  bannerImageUrl: true,
  avatarImageUrl: true,
  workshopImageUrl: true,
  storyTitle: true,
  storyBody: true,
  instagramUrl: true,
  facebookUrl: true,
  pinterestUrl: true,
  tiktokUrl: true,
  websiteUrl: true,
  yearsInBusiness: true,
  acceptsCustomOrders: true,
  acceptingNewOrders: true,
  customOrderTurnaroundDays: true,
  offersGiftWrapping: true,
  giftWrappingPriceCents: true,
  returnPolicy: true,
  customOrderPolicy: true,
  shippingPolicy: true,
  featuredListingIds: true,
  galleryImageUrls: true,
  galleryAltTexts: true,
  isVerifiedMaker: true,
  verifiedAt: true,
  guildLevel: true,
  guildMemberApprovedAt: true,
  guildMasterApprovedAt: true,
  guildMasterAppliedAt: true,
  guildMasterReviewNotes: true,
  consecutiveMetricFailures: true,
  lastMetricCheckAt: true,
  metricWarningSentAt: true,
  listingsBelowThresholdSince: true,
  onboardingStep: true,
  onboardingComplete: true,
  vacationMode: true,
  vacationReturnDate: true,
  vacationMessage: true,
  isFoundingMaker: true,
  foundingMakerNumber: true,
  foundingMakerAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SellerProfileSelect;

/** Owner-bound compatibility reads that intentionally combine public profile
 * state with private operational state. These become fixed database operations
 * after SellerProfilePrivate is installed in Production. */
export function sellerOwnerOnboardingState(
  sellerProfileId: string,
  client: SellerOwnerPrivateClient = prisma,
) {
  return client.sellerProfile.findUnique({
    where: { id: sellerProfileId },
    select: sellerOwnerOnboardingSelect,
  });
}

export function sellerOwnerExportProfile(
  userId: string,
  client: SellerOwnerPrivateClient = prisma,
) {
  return client.sellerProfile.findUnique({
    where: { userId },
    select: sellerOwnerExportSelect,
  });
}
