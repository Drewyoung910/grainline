import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  sellerProfileEditorSelect,
  sellerSettingsOwnerSelect,
} from "@/lib/sellerProfileSelects";

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

const sellerOwnerOnboardingMutationSelect = {
  id: true,
  userId: true,
  onboardingStep: true,
  chargesEnabled: true,
  _count: { select: { listings: true } },
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

const sellerOwnerGuildDashboardSelect = {
  id: true,
  userId: true,
  bio: true,
  avatarImageUrl: true,
  returnPolicy: true,
  customOrderPolicy: true,
  shippingPolicy: true,
  guildLevel: true,
  guildMemberApprovedAt: true,
  guildMasterApprovedAt: true,
  guildMasterAppliedAt: true,
  guildMasterReviewNotes: true,
  consecutiveMetricFailures: true,
  lastMetricCheckAt: true,
  metricWarningSentAt: true,
  makerVerification: true,
} satisfies Prisma.SellerProfileSelect;

const sellerOwnerGuildApplicationSelect = {
  userId: true,
  guildLevel: true,
  makerVerification: { select: { status: true, reviewedAt: true } },
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

export function sellerOwnerOnboardingMutationState(
  userId: string,
  client: SellerOwnerPrivateClient = prisma,
) {
  return client.sellerProfile.findUnique({
    where: { userId },
    select: sellerOwnerOnboardingMutationSelect,
  });
}

async function requireOneSellerOwnerMutation(
  result: { count: number },
  operation: string,
) {
  if (result.count !== 1) {
    throw new Error(`Seller owner ${operation} target changed`);
  }
}

export async function updateSellerOwnerOnboardingStepOne(
  client: SellerOwnerPrivateClient,
  input: {
    sellerProfileId: string;
    userId: string;
    displayName?: string;
    displayNameNormalized?: string;
    bio: string | null;
    tagline: string | null;
    avatarImageUrl: string | null;
  },
) {
  const result = await client.sellerProfile.updateMany({
    where: { id: input.sellerProfileId, userId: input.userId },
    data: {
      ...(input.displayName
        ? {
            displayName: input.displayName,
            displayNameNormalized: input.displayNameNormalized,
          }
        : {}),
      bio: input.bio,
      tagline: input.tagline,
      avatarImageUrl: input.avatarImageUrl,
      onboardingStep: 2,
    },
  });
  await requireOneSellerOwnerMutation(result, "onboarding step one");
}

export async function updateSellerOwnerOnboardingStepTwo(
  client: SellerOwnerPrivateClient,
  input: {
    sellerProfileId: string;
    userId: string;
    yearsInBusiness: number | null;
    city: string | null;
    state: string | null;
    returnPolicy: string | null;
    shippingPolicy: string | null;
    acceptsCustomOrders: boolean;
  },
) {
  const result = await client.sellerProfile.updateMany({
    where: { id: input.sellerProfileId, userId: input.userId },
    data: {
      yearsInBusiness: input.yearsInBusiness,
      city: input.city,
      state: input.state,
      returnPolicy: input.returnPolicy,
      shippingPolicy: input.shippingPolicy,
      acceptsCustomOrders: input.acceptsCustomOrders,
      onboardingStep: 3,
    },
  });
  await requireOneSellerOwnerMutation(result, "onboarding step two");
}

export function advanceSellerOwnerOnboardingStep(
  client: SellerOwnerPrivateClient,
  input: {
    sellerProfileId: string;
    userId: string;
    expectedStep: number;
    nextStep: number;
  },
) {
  return client.sellerProfile.updateMany({
    where: {
      id: input.sellerProfileId,
      userId: input.userId,
      onboardingStep: input.expectedStep,
    },
    data: { onboardingStep: input.nextStep },
  });
}

export async function completeSellerOwnerOnboarding(
  client: SellerOwnerPrivateClient,
  input: { sellerProfileId: string; userId: string },
) {
  const result = await client.sellerProfile.updateMany({
    where: { id: input.sellerProfileId, userId: input.userId },
    data: { onboardingComplete: true },
  });
  await requireOneSellerOwnerMutation(result, "onboarding completion");
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

export function sellerOwnerGuildDashboardState(
  sellerProfileId: string,
  userId: string,
  client: SellerOwnerPrivateClient = prisma,
) {
  return client.sellerProfile.findFirst({
    where: { id: sellerProfileId, userId },
    select: sellerOwnerGuildDashboardSelect,
  });
}

export function sellerOwnerGuildApplicationState(
  sellerProfileId: string,
  userId: string,
  client: SellerOwnerPrivateClient = prisma,
) {
  return client.sellerProfile.findFirst({
    where: { id: sellerProfileId, userId },
    select: sellerOwnerGuildApplicationSelect,
  });
}

export function recordSellerOwnerGuildMasterApplication(
  client: SellerOwnerPrivateClient,
  input: {
    sellerProfileId: string;
    userId: string;
    appliedAt: Date;
  },
) {
  return client.sellerProfile.updateMany({
    where: {
      id: input.sellerProfileId,
      userId: input.userId,
      guildLevel: "GUILD_MEMBER",
    },
    data: {
      guildMasterAppliedAt: input.appliedAt,
      guildMasterReviewNotes: null,
    },
  });
}

export function sellerOwnerShopSettingsState(
  sellerProfileId: string,
  userId: string,
  client: SellerOwnerPrivateClient = prisma,
) {
  return client.sellerProfile.findFirst({
    where: { id: sellerProfileId, userId },
    select: sellerSettingsOwnerSelect,
  });
}

export async function updateSellerOwnerShopSettings(
  client: SellerOwnerPrivateClient,
  input: {
    sellerProfileId: string;
    userId: string;
    city: string | null;
    state: string | null;
    lat: number | null;
    lng: number | null;
    radiusMeters: number | null;
    publicMapOptIn: boolean;
    shippingFlatRateCents: number | null;
    freeShippingOverCents: number | null;
    allowLocalPickup: boolean;
    useCalculatedShipping: boolean;
    preferredCarriers: string[];
    shipFromName: string | null;
    shipFromLine1: string | null;
    shipFromLine2: string | null;
    shipFromCity: string | null;
    shipFromState: string | null;
    shipFromPostal: string | null;
    shipFromCountry: string;
    shipFromPhone: string | null;
    defaultPkgLengthCm: number | null;
    defaultPkgWidthCm: number | null;
    defaultPkgHeightCm: number | null;
    defaultPkgWeightGrams: number | null;
  },
) {
  const result = await client.sellerProfile.updateMany({
    where: { id: input.sellerProfileId, userId: input.userId },
    data: {
      city: input.city,
      state: input.state,
      lat: input.lat,
      lng: input.lng,
      radiusMeters: input.radiusMeters,
      publicMapOptIn: input.publicMapOptIn,
      shippingFlatRateCents: input.shippingFlatRateCents,
      freeShippingOverCents: input.freeShippingOverCents,
      allowLocalPickup: input.allowLocalPickup,
      useCalculatedShipping: input.useCalculatedShipping,
      preferredCarriers: input.preferredCarriers,
      shipFromName: input.shipFromName,
      shipFromLine1: input.shipFromLine1,
      shipFromLine2: input.shipFromLine2,
      shipFromCity: input.shipFromCity,
      shipFromState: input.shipFromState,
      shipFromPostal: input.shipFromPostal,
      shipFromCountry: input.shipFromCountry,
      shipFromPhone: input.shipFromPhone,
      defaultPkgLengthCm: input.defaultPkgLengthCm,
      defaultPkgWidthCm: input.defaultPkgWidthCm,
      defaultPkgHeightCm: input.defaultPkgHeightCm,
      defaultPkgWeightGrams: input.defaultPkgWeightGrams,
    },
  });
  await requireOneSellerOwnerMutation(result, "shop settings update");
}

export async function updateSellerOwnerMetroAssignment(
  client: SellerOwnerPrivateClient,
  input: {
    sellerProfileId: string;
    userId: string;
    metroId: string | null;
    cityMetroId: string | null;
  },
) {
  const result = await client.sellerProfile.updateMany({
    where: { id: input.sellerProfileId, userId: input.userId },
    data: { metroId: input.metroId, cityMetroId: input.cityMetroId },
  });
  await requireOneSellerOwnerMutation(result, "metro assignment");
}

export function duplicateSellerOwnerDisplayName(
  input: {
    sellerProfileId: string;
    displayName: string;
    displayNameNormalized: string;
  },
  client: SellerOwnerPrivateClient = prisma,
) {
  return client.sellerProfile.findFirst({
    where: {
      OR: [
        { displayName: { equals: input.displayName, mode: "insensitive" } },
        {
          displayNameNormalized: {
            equals: input.displayNameNormalized,
            mode: "insensitive",
          },
        },
      ],
      id: { not: input.sellerProfileId },
    },
    select: { id: true },
  });
}

export async function updateSellerOwnerProfile(
  client: SellerOwnerPrivateClient,
  input: {
    sellerProfileId: string;
    userId: string;
    displayName: string;
    displayNameNormalized: string;
    tagline: string | null;
    bio: string | null;
    storyTitle: string | null;
    storyBody: string | null;
    yearsInBusiness: number | null;
    bannerImageUrl: string | null;
    avatarImageUrl: string | null;
    workshopImageUrl: string | null;
    galleryImageUrls?: string[];
    galleryAltTexts?: string[];
    instagramUrl: string | null;
    facebookUrl: string | null;
    pinterestUrl: string | null;
    tiktokUrl: string | null;
    websiteUrl: string | null;
    returnPolicy: string | null;
    customOrderPolicy: string | null;
    shippingPolicy: string | null;
    acceptsCustomOrders: boolean;
    acceptingNewOrders: boolean;
    customOrderTurnaroundDays: number | null;
    offersGiftWrapping: boolean;
    giftWrappingPriceCents: number | null;
  },
) {
  const result = await client.sellerProfile.updateMany({
    where: { id: input.sellerProfileId, userId: input.userId },
    data: {
      displayName: input.displayName,
      displayNameNormalized: input.displayNameNormalized,
      tagline: input.tagline,
      bio: input.bio,
      storyTitle: input.storyTitle,
      storyBody: input.storyBody,
      yearsInBusiness: input.yearsInBusiness,
      bannerImageUrl: input.bannerImageUrl,
      avatarImageUrl: input.avatarImageUrl,
      workshopImageUrl: input.workshopImageUrl,
      ...(input.galleryImageUrls
        ? {
            galleryImageUrls: input.galleryImageUrls,
            galleryAltTexts: input.galleryAltTexts ?? [],
          }
        : {}),
      instagramUrl: input.instagramUrl,
      facebookUrl: input.facebookUrl,
      pinterestUrl: input.pinterestUrl,
      tiktokUrl: input.tiktokUrl,
      websiteUrl: input.websiteUrl,
      returnPolicy: input.returnPolicy,
      customOrderPolicy: input.customOrderPolicy,
      shippingPolicy: input.shippingPolicy,
      acceptsCustomOrders: input.acceptsCustomOrders,
      acceptingNewOrders: input.acceptingNewOrders,
      customOrderTurnaroundDays: input.customOrderTurnaroundDays,
      offersGiftWrapping: input.offersGiftWrapping,
      giftWrappingPriceCents: input.offersGiftWrapping
        ? input.giftWrappingPriceCents
        : null,
    },
  });
  await requireOneSellerOwnerMutation(result, "profile update");
}

export async function clearSellerOwnerAvatar(
  client: SellerOwnerPrivateClient,
  input: { sellerProfileId: string; userId: string },
) {
  const result = await client.sellerProfile.updateMany({
    where: { id: input.sellerProfileId, userId: input.userId },
    data: { avatarImageUrl: null },
  });
  await requireOneSellerOwnerMutation(result, "avatar removal");
}

export function sellerOwnerFeaturedListingIds(
  client: SellerOwnerPrivateClient,
  input: { sellerProfileId: string; userId: string },
) {
  return client.sellerProfile.findFirst({
    where: { id: input.sellerProfileId, userId: input.userId },
    select: { featuredListingIds: true },
  });
}

export async function updateSellerOwnerFeaturedListingIds(
  client: SellerOwnerPrivateClient,
  input: { sellerProfileId: string; userId: string; featuredListingIds: string[] },
) {
  const result = await client.sellerProfile.updateMany({
    where: { id: input.sellerProfileId, userId: input.userId },
    data: { featuredListingIds: input.featuredListingIds },
  });
  await requireOneSellerOwnerMutation(result, "featured listings update");
}

export function sellerOwnerProfileEditorState(
  sellerProfileId: string,
  userId: string,
  client: SellerOwnerPrivateClient = prisma,
) {
  return client.sellerProfile.findFirst({
    where: { id: sellerProfileId, userId },
    select: {
      ...sellerProfileEditorSelect,
      faqs: { orderBy: { sortOrder: "asc" as const } },
    },
  });
}
