import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withDbUserContext } from "@/lib/dbUserContext";
import {
  sellerProfileEditorSelect,
  sellerSettingsOwnerSelect,
} from "@/lib/sellerProfileSelects";

type SellerOwnerPrivateClient = Pick<Prisma.TransactionClient, "sellerProfile" | "$queryRaw">;

type SellerOwnerPrivateState = {
  stripeAccountId: string | null;
  stripeAccountVersion: string | null;
  stripeControllerType: string | null;
  manualStripeReconciliationNeeded: boolean;
  manualStripeReconciliationNote: string | null;
  shipFromName: string | null;
  shipFromLine1: string | null;
  shipFromLine2: string | null;
  shipFromCity: string | null;
  shipFromState: string | null;
  shipFromPostal: string | null;
  shipFromCountry: string | null;
  shipFromPhone: string | null;
  defaultPkgWeightGrams: number | null;
  defaultPkgLengthCm: number | null;
  defaultPkgWidthCm: number | null;
  defaultPkgHeightCm: number | null;
  useCalculatedShipping: boolean;
  preferredCarriers: string[];
  onboardingStep: number;
  onboardingComplete: boolean;
  guildMemberApprovedAt: string | Date | null;
  guildMasterApprovedAt: string | Date | null;
  guildMasterAppliedAt: string | Date | null;
  guildMasterReviewNotes: string | null;
  consecutiveMetricFailures: number;
  lastMetricCheckAt: string | Date | null;
  metricWarningSentAt: string | Date | null;
  listingsBelowThresholdSince: string | Date | null;
  publicMapExactConsentAt: string | Date | null;
  publicMapExactConsentVersion: number | null;
  profileViews: number;
};

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function nullableDateValue(value: unknown): value is string | Date | null {
  return value === null || typeof value === "string" || value instanceof Date;
}

function isSellerOwnerPrivateState(value: unknown): value is SellerOwnerPrivateState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return nullableString(state.stripeAccountId)
    && nullableString(state.stripeAccountVersion)
    && nullableString(state.stripeControllerType)
    && typeof state.manualStripeReconciliationNeeded === "boolean"
    && nullableString(state.manualStripeReconciliationNote)
    && nullableString(state.shipFromName)
    && nullableString(state.shipFromLine1)
    && nullableString(state.shipFromLine2)
    && nullableString(state.shipFromCity)
    && nullableString(state.shipFromState)
    && nullableString(state.shipFromPostal)
    && nullableString(state.shipFromCountry)
    && nullableString(state.shipFromPhone)
    && nullableNumber(state.defaultPkgWeightGrams)
    && nullableNumber(state.defaultPkgLengthCm)
    && nullableNumber(state.defaultPkgWidthCm)
    && nullableNumber(state.defaultPkgHeightCm)
    && typeof state.useCalculatedShipping === "boolean"
    && Array.isArray(state.preferredCarriers)
    && state.preferredCarriers.every((carrier) => typeof carrier === "string")
    && Number.isSafeInteger(state.onboardingStep)
    && typeof state.onboardingComplete === "boolean"
    && nullableDateValue(state.guildMemberApprovedAt)
    && nullableDateValue(state.guildMasterApprovedAt)
    && nullableDateValue(state.guildMasterAppliedAt)
    && nullableString(state.guildMasterReviewNotes)
    && Number.isSafeInteger(state.consecutiveMetricFailures)
    && nullableDateValue(state.lastMetricCheckAt)
    && nullableDateValue(state.metricWarningSentAt)
    && nullableDateValue(state.listingsBelowThresholdSince)
    && nullableDateValue(state.publicMapExactConsentAt)
    && (state.publicMapExactConsentVersion === null
      || state.publicMapExactConsentVersion === 1)
    && Number.isSafeInteger(state.profileViews);
}

export async function sellerOwnerPrivateState(
  userId: string,
  expectedSellerProfileId: string | null,
  client: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma,
) {
  const rows = await client.$queryRaw<Array<{ id: string; state: unknown }>>`
    SELECT id, state
      FROM public.grainline_seller_owner_private_state(${userId}::text)
  `;
  const row = rows[0];
  const valid = row
    && typeof row.id === "string"
    && (expectedSellerProfileId === null || row.id === expectedSellerProfileId)
    && isSellerOwnerPrivateState(row.state);
  if (rows.length > 1 || (row && !valid)) {
    throw new Error("Seller owner private-state authority returned an invalid result");
  }
  return valid ? { id: row.id, ...(row.state as SellerOwnerPrivateState) } : null;
}

const sellerOwnerOnboardingSelect = {
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
  shippingFlatRateCents: true,
  freeShippingOverCents: true,
  allowLocalPickup: true,
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
  makerVerification: true,
} satisfies Prisma.SellerProfileSelect;

type SellerOwnerGuildApplicationStateRow = {
  userId: unknown;
  guildLevel: unknown;
  verificationStatus: unknown;
  verificationReviewedAt: unknown;
};

const GUILD_LEVELS = ["NONE", "GUILD_MEMBER", "GUILD_MASTER"] as const;
const VERIFICATION_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "GUILD_MASTER_PENDING",
  "GUILD_MASTER_APPROVED",
  "GUILD_MASTER_REJECTED",
] as const;

/** Owner-bound compatibility reads that intentionally combine public profile
 * state with private operational state. These become fixed database operations
 * after SellerProfilePrivate is installed in Production. */
export async function sellerOwnerOnboardingState(
  sellerProfileId: string,
  userId: string,
  client: SellerOwnerPrivateClient = prisma,
) {
  const profile = await client.sellerProfile.findFirst({
    where: { id: sellerProfileId, userId },
    select: sellerOwnerOnboardingSelect,
  });
  if (!profile) return null;
  const privateState = await sellerOwnerPrivateState(userId, sellerProfileId, client);
  return privateState ? { ...profile, ...privateState } : null;
}

export async function sellerOwnerOnboardingMutationState(
  userId: string,
  client: SellerOwnerPrivateClient = prisma,
) {
  const profile = await client.sellerProfile.findUnique({
    where: { userId },
    select: sellerOwnerOnboardingMutationSelect,
  });
  if (!profile) return null;
  const privateState = await sellerOwnerPrivateState(userId, profile.id, client);
  return privateState ? { ...profile, onboardingStep: privateState.onboardingStep } : null;
}

async function updateSellerOwnerOnboardingStep(
  client: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: {
    sellerProfileId: string;
    userId: string;
    expectedStep: number | null;
    nextStep: number;
  },
) {
  const rows = await client.$queryRaw<Array<{ updated: boolean }>>`
    SELECT public.grainline_seller_owner_onboarding_step_update(
      ${input.userId}::text,
      ${input.sellerProfileId}::text,
      ${input.expectedStep}::integer,
      ${input.nextStep}::integer
    ) AS updated
  `;
  if (rows.length !== 1 || typeof rows[0]?.updated !== "boolean") {
    throw new Error("Seller owner onboarding-step authority returned an invalid result");
  }
  return rows[0].updated;
}

async function completeSellerOwnerOnboardingState(
  client: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { sellerProfileId: string; userId: string },
) {
  const rows = await client.$queryRaw<Array<{ completed: boolean }>>`
    SELECT public.grainline_seller_owner_onboarding_complete(
      ${input.userId}::text,
      ${input.sellerProfileId}::text
    ) AS completed
  `;
  if (rows.length !== 1 || typeof rows[0]?.completed !== "boolean") {
    throw new Error("Seller owner onboarding-complete authority returned an invalid result");
  }
  return rows[0].completed;
}

export async function sellerOwnerExportProfile(
  userId: string,
  client: SellerOwnerPrivateClient = prisma,
) {
  const profile = await client.sellerProfile.findUnique({
    where: { userId },
    select: sellerOwnerExportSelect,
  });
  if (!profile) return null;
  const privateState = await sellerOwnerPrivateState(userId, profile.id, client);
  return privateState ? { ...profile, ...privateState } : null;
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
    },
  });
  await requireOneSellerOwnerMutation(result, "onboarding step one");
  if (!await updateSellerOwnerOnboardingStep(client, {
    sellerProfileId: input.sellerProfileId,
    userId: input.userId,
    expectedStep: null,
    nextStep: 2,
  })) {
    throw new Error("Seller owner onboarding step one changed");
  }
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
    },
  });
  await requireOneSellerOwnerMutation(result, "onboarding step two");
  if (!await updateSellerOwnerOnboardingStep(client, {
    sellerProfileId: input.sellerProfileId,
    userId: input.userId,
    expectedStep: null,
    nextStep: 3,
  })) {
    throw new Error("Seller owner onboarding step two changed");
  }
}

export async function advanceSellerOwnerOnboardingStep(
  client: SellerOwnerPrivateClient,
  input: {
    sellerProfileId: string;
    userId: string;
    expectedStep: number;
    nextStep: number;
  },
) {
  const updated = await updateSellerOwnerOnboardingStep(client, input);
  return { count: updated ? 1 : 0 };
}

export async function completeSellerOwnerOnboarding(
  client: SellerOwnerPrivateClient,
  input: { sellerProfileId: string; userId: string },
) {
  const completed = await completeSellerOwnerOnboardingState(client, input);
  if (!completed) throw new Error("Seller owner onboarding completion prerequisites changed");
}

export async function sellerOwnerGuildDashboardState(
  sellerProfileId: string,
  userId: string,
  client: SellerOwnerPrivateClient = prisma,
) {
  const profile = await client.sellerProfile.findFirst({
    where: { id: sellerProfileId, userId },
    select: sellerOwnerGuildDashboardSelect,
  });
  if (!profile) return null;
  const privateState = await sellerOwnerPrivateState(userId, sellerProfileId, client);
  return privateState ? { ...profile, ...privateState } : null;
}

export function sellerOwnerGuildApplicationState(
  sellerProfileId: string,
  userId: string,
) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<SellerOwnerGuildApplicationStateRow[]>`
      SELECT *
        FROM public.grainline_seller_owner_guild_application_state(
          ${sellerProfileId}::text
        )
    `;
    if (rows.length === 0) return null;
    if (rows.length !== 1) {
      throw new Error("Seller owner Guild application authority returned multiple results");
    }
    const row = rows[0];
    if (
      typeof row.userId !== "string"
      || row.userId !== userId
      || !GUILD_LEVELS.includes(row.guildLevel as typeof GUILD_LEVELS[number])
      || (
        row.verificationStatus !== null
        && !VERIFICATION_STATUSES.includes(
          row.verificationStatus as typeof VERIFICATION_STATUSES[number],
        )
      )
      || (
        row.verificationReviewedAt !== null
        && (!(row.verificationReviewedAt instanceof Date)
          || Number.isNaN(row.verificationReviewedAt.getTime()))
      )
      || (row.verificationStatus === null && row.verificationReviewedAt !== null)
    ) {
      throw new Error("Seller owner Guild application authority returned an invalid result");
    }
    return Object.freeze({
      userId: row.userId,
      guildLevel: row.guildLevel as typeof GUILD_LEVELS[number],
      makerVerification: row.verificationStatus === null
        ? null
        : Object.freeze({
            status: row.verificationStatus as typeof VERIFICATION_STATUSES[number],
            reviewedAt: row.verificationReviewedAt as Date | null,
          }),
    });
  });
}

export async function recordSellerOwnerGuildMasterApplication(
  client: SellerOwnerPrivateClient,
  input: {
    sellerProfileId: string;
    userId: string;
    appliedAt: Date;
  },
) {
  const rows = await client.$queryRaw<Array<{ applied: boolean }>>`
    SELECT public.grainline_seller_owner_guild_master_application_record(
      ${input.userId}::text,
      ${input.sellerProfileId}::text,
      ${input.appliedAt}::timestamp
    ) AS applied
  `;
  if (rows.length !== 1 || typeof rows[0]?.applied !== "boolean") {
    throw new Error("Seller owner Guild Master application authority returned an invalid result");
  }
  return { count: rows[0].applied ? 1 : 0 };
}

export async function sellerOwnerShopSettingsState(
  sellerProfileId: string,
  userId: string,
  client: SellerOwnerPrivateClient = prisma,
) {
  const profile = await client.sellerProfile.findFirst({
    where: { id: sellerProfileId, userId },
    select: sellerSettingsOwnerSelect,
  });
  if (!profile) return null;
  const privateState = await sellerOwnerPrivateState(userId, sellerProfileId, client);
  return privateState ? { ...profile, ...privateState } : null;
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
    publicMapExactConsent: boolean;
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
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT public.grainline_seller_owner_shop_settings_update(
      ${input.userId}::text,
      ${input.sellerProfileId}::text,
      ${input.city}::text,
      ${input.state}::text,
      ${input.lat}::double precision,
      ${input.lng}::double precision,
      ${input.radiusMeters}::double precision,
      ${input.publicMapOptIn}::boolean,
      ${input.publicMapExactConsent}::boolean,
      ${input.shippingFlatRateCents}::integer,
      ${input.freeShippingOverCents}::integer,
      ${input.allowLocalPickup}::boolean,
      ${input.useCalculatedShipping}::boolean,
      ${input.preferredCarriers}::text[],
      ${input.shipFromName}::text,
      ${input.shipFromLine1}::text,
      ${input.shipFromLine2}::text,
      ${input.shipFromCity}::text,
      ${input.shipFromState}::text,
      ${input.shipFromPostal}::text,
      ${input.shipFromCountry}::text,
      ${input.shipFromPhone}::text,
      ${input.defaultPkgLengthCm}::double precision,
      ${input.defaultPkgWidthCm}::double precision,
      ${input.defaultPkgHeightCm}::double precision,
      ${input.defaultPkgWeightGrams}::integer
    ) AS id
  `;
  if (rows.length !== 1 || rows[0]?.id !== input.sellerProfileId) {
    throw new Error("Seller owner shop-settings authority returned an invalid result");
  }
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

export function toggleSellerOwnerFeaturedListing(
  userId: string,
  input: { sellerProfileId: string; listingId: string },
) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<{ applied: unknown; featured: unknown }>>`
      SELECT *
        FROM public.grainline_seller_owner_featured_listing_toggle(
          ${input.sellerProfileId}::text,
          ${input.listingId}::text
        )
    `;
    if (
      rows.length !== 1
      || typeof rows[0]?.applied !== "boolean"
      || typeof rows[0]?.featured !== "boolean"
    ) {
      throw new Error("Seller owner featured-listing authority returned an invalid result");
    }
    return Object.freeze({
      applied: rows[0].applied,
      featured: rows[0].featured,
    });
  });
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
