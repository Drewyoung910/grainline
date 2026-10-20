import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  withDbUserContext,
  type DbUserContextTransactionClient,
} from "@/lib/dbUserContext";

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

function nullableDate(value: unknown): value is Date | null {
  return value === null
    || (value instanceof Date && !Number.isNaN(value.getTime()));
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

type SellerOwnerOnboardingStateRow = {
  sellerProfileId: unknown;
  userId: unknown;
  displayName: unknown;
  bio: unknown;
  tagline: unknown;
  avatarImageUrl: unknown;
  yearsInBusiness: unknown;
  city: unknown;
  state: unknown;
  returnPolicy: unknown;
  shippingPolicy: unknown;
  acceptsCustomOrders: unknown;
  chargesEnabled: unknown;
  totalListingCount: unknown;
  latestListingId: unknown;
  latestListingTitle: unknown;
  latestListingStatus: unknown;
};

const LISTING_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "SOLD",
  "SOLD_OUT",
  "HIDDEN",
  "PENDING_REVIEW",
  "REJECTED",
] as const;

function safeCount(value: unknown) {
  const count = typeof value === "bigint" ? Number(value) : value;
  return Number.isSafeInteger(count) && (count as number) >= 0
    ? count as number
    : null;
}

async function readSellerOwnerOnboardingState(
  client: DbUserContextTransactionClient,
  userId: string,
  expectedSellerProfileId: string | null,
) {
  const rows = await client.$queryRaw<SellerOwnerOnboardingStateRow[]>`
    SELECT *
      FROM public.grainline_seller_owner_onboarding_state(
        ${expectedSellerProfileId}::text
      )
  `;
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new Error("Seller owner onboarding authority returned multiple results");
  }
  const row = rows[0];
  const count = safeCount(row.totalListingCount);
  const latestIsNull = row.latestListingId === null
    && row.latestListingTitle === null
    && row.latestListingStatus === null;
  const latestIsValid = typeof row.latestListingId === "string"
    && typeof row.latestListingTitle === "string"
    && LISTING_STATUSES.includes(
      row.latestListingStatus as typeof LISTING_STATUSES[number],
    );
  if (
    typeof row.sellerProfileId !== "string"
    || (expectedSellerProfileId !== null && row.sellerProfileId !== expectedSellerProfileId)
    || row.userId !== userId
    || typeof row.displayName !== "string"
    || !nullableString(row.bio)
    || !nullableString(row.tagline)
    || !nullableString(row.avatarImageUrl)
    || !nullableNumber(row.yearsInBusiness)
    || !nullableString(row.city)
    || !nullableString(row.state)
    || !nullableString(row.returnPolicy)
    || !nullableString(row.shippingPolicy)
    || typeof row.acceptsCustomOrders !== "boolean"
    || typeof row.chargesEnabled !== "boolean"
    || count === null
    || (!latestIsNull && !latestIsValid)
  ) {
    throw new Error("Seller owner onboarding authority returned an invalid result");
  }
  return Object.freeze({
    id: row.sellerProfileId,
    userId: row.userId,
    displayName: row.displayName,
    bio: row.bio,
    tagline: row.tagline,
    avatarImageUrl: row.avatarImageUrl,
    yearsInBusiness: row.yearsInBusiness,
    city: row.city,
    state: row.state,
    returnPolicy: row.returnPolicy,
    shippingPolicy: row.shippingPolicy,
    acceptsCustomOrders: row.acceptsCustomOrders,
    chargesEnabled: row.chargesEnabled,
    _count: Object.freeze({ listings: count }),
    listings: latestIsValid
      ? [Object.freeze({
          id: row.latestListingId as string,
          title: row.latestListingTitle as string,
          status: row.latestListingStatus as typeof LISTING_STATUSES[number],
        })]
      : [],
  });
}

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

type SellerOwnerGuildApplicationStateRow = {
  userId: unknown;
  guildLevel: unknown;
  verificationStatus: unknown;
  verificationReviewedAt: unknown;
};

type SellerOwnerGuildDashboardStateRow = {
  sellerProfileId: unknown;
  userId: unknown;
  bio: unknown;
  avatarImageUrl: unknown;
  returnPolicy: unknown;
  customOrderPolicy: unknown;
  shippingPolicy: unknown;
  guildLevel: unknown;
  verificationStatus: unknown;
  verificationReviewedAt: unknown;
  verificationReviewNotes: unknown;
  verificationCraftDescription: unknown;
  verificationYearsExperience: unknown;
  verificationPortfolioUrl: unknown;
};

type SellerOwnerShopSettingsStateRow = {
  sellerProfileId: unknown;
  chargesEnabled: unknown;
  vacationMode: unknown;
  vacationReturnDate: unknown;
  vacationMessage: unknown;
  city: unknown;
  state: unknown;
  lat: unknown;
  lng: unknown;
  radiusMeters: unknown;
  publicMapOptIn: unknown;
  shippingFlatRateCents: unknown;
  freeShippingOverCents: unknown;
  allowLocalPickup: unknown;
};

type SellerOwnerProfileEditorFaq = {
  id: string;
  question: string;
  answer: string;
};

type SellerOwnerProfileEditorState = {
  avatarImageUrl: string | null;
  bannerImageUrl: string | null;
  displayName: string;
  tagline: string | null;
  yearsInBusiness: number | null;
  bio: string | null;
  storyTitle: string | null;
  storyBody: string | null;
  workshopImageUrl: string | null;
  galleryImageUrls: string[];
  galleryAltTexts: string[];
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
  featuredListingIds: string[];
  faqs: SellerOwnerProfileEditorFaq[];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function nullableSafeInteger(value: unknown): value is number | null {
  return value === null || Number.isSafeInteger(value);
}

function isSellerOwnerProfileEditorState(
  value: unknown,
): value is SellerOwnerProfileEditorState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return nullableString(state.avatarImageUrl)
    && nullableString(state.bannerImageUrl)
    && typeof state.displayName === "string"
    && nullableString(state.tagline)
    && nullableSafeInteger(state.yearsInBusiness)
    && nullableString(state.bio)
    && nullableString(state.storyTitle)
    && nullableString(state.storyBody)
    && nullableString(state.workshopImageUrl)
    && isStringArray(state.galleryImageUrls)
    && isStringArray(state.galleryAltTexts)
    && nullableString(state.instagramUrl)
    && nullableString(state.facebookUrl)
    && nullableString(state.pinterestUrl)
    && nullableString(state.tiktokUrl)
    && nullableString(state.websiteUrl)
    && nullableString(state.returnPolicy)
    && nullableString(state.customOrderPolicy)
    && nullableString(state.shippingPolicy)
    && typeof state.acceptsCustomOrders === "boolean"
    && typeof state.acceptingNewOrders === "boolean"
    && nullableSafeInteger(state.customOrderTurnaroundDays)
    && typeof state.offersGiftWrapping === "boolean"
    && nullableSafeInteger(state.giftWrappingPriceCents)
    && isStringArray(state.featuredListingIds)
    && Array.isArray(state.faqs)
    && state.faqs.every((faq) => {
      if (!faq || typeof faq !== "object" || Array.isArray(faq)) return false;
      const entry = faq as Record<string, unknown>;
      return typeof entry.id === "string"
        && typeof entry.question === "string"
        && typeof entry.answer === "string";
    });
}

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
) {
  return withDbUserContext(userId, async (client) => {
    const profile = await readSellerOwnerOnboardingState(
      client,
      userId,
      sellerProfileId,
    );
    if (!profile) return null;
    const privateState = await sellerOwnerPrivateState(userId, sellerProfileId, client);
    return privateState ? { ...profile, ...privateState } : null;
  });
}

export async function sellerOwnerOnboardingMutationState(
  userId: string,
) {
  return withDbUserContext(userId, async (client) => {
    const profile = await readSellerOwnerOnboardingState(client, userId, null);
    if (!profile) return null;
    const privateState = await sellerOwnerPrivateState(userId, profile.id, client);
    return privateState ? {
      id: profile.id,
      userId: profile.userId,
      chargesEnabled: profile.chargesEnabled,
      _count: profile._count,
      onboardingStep: privateState.onboardingStep,
    } : null;
  });
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
) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<SellerOwnerGuildDashboardStateRow[]>`
      SELECT *
        FROM public.grainline_seller_owner_guild_dashboard_state(
          ${sellerProfileId}::text
        )
    `;
    if (rows.length === 0) return null;
    if (rows.length !== 1) {
      throw new Error("Seller owner Guild dashboard authority returned multiple results");
    }
    const row = rows[0];
    const noVerification = row.verificationStatus === null
      && row.verificationReviewedAt === null
      && row.verificationReviewNotes === null
      && row.verificationCraftDescription === null
      && row.verificationYearsExperience === null
      && row.verificationPortfolioUrl === null;
    const validVerification = VERIFICATION_STATUSES.includes(
      row.verificationStatus as typeof VERIFICATION_STATUSES[number],
    )
      && nullableDate(row.verificationReviewedAt)
      && nullableString(row.verificationReviewNotes)
      && typeof row.verificationCraftDescription === "string"
      && Number.isSafeInteger(row.verificationYearsExperience)
      && nullableString(row.verificationPortfolioUrl);
    if (
      row.sellerProfileId !== sellerProfileId
      || row.userId !== userId
      || !nullableString(row.bio)
      || !nullableString(row.avatarImageUrl)
      || !nullableString(row.returnPolicy)
      || !nullableString(row.customOrderPolicy)
      || !nullableString(row.shippingPolicy)
      || !GUILD_LEVELS.includes(row.guildLevel as typeof GUILD_LEVELS[number])
      || (!noVerification && !validVerification)
    ) {
      throw new Error("Seller owner Guild dashboard authority returned an invalid result");
    }
    const privateState = await sellerOwnerPrivateState(userId, sellerProfileId, client);
    return privateState ? {
      userId: row.userId as string,
      bio: row.bio as string | null,
      avatarImageUrl: row.avatarImageUrl as string | null,
      returnPolicy: row.returnPolicy as string | null,
      customOrderPolicy: row.customOrderPolicy as string | null,
      shippingPolicy: row.shippingPolicy as string | null,
      guildLevel: row.guildLevel as typeof GUILD_LEVELS[number],
      makerVerification: noVerification ? null : {
        status: row.verificationStatus as typeof VERIFICATION_STATUSES[number],
        reviewedAt: row.verificationReviewedAt as Date | null,
        reviewNotes: row.verificationReviewNotes as string | null,
        craftDescription: row.verificationCraftDescription as string,
        yearsExperience: row.verificationYearsExperience as number,
        portfolioUrl: row.verificationPortfolioUrl as string | null,
      },
      ...privateState,
    } : null;
  });
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
) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<SellerOwnerShopSettingsStateRow[]>`
      SELECT *
        FROM public.grainline_seller_owner_shop_settings_state(
          ${sellerProfileId}::text
        )
    `;
    if (rows.length === 0) return null;
    if (rows.length !== 1) {
      throw new Error("Seller owner Shop Settings authority returned multiple results");
    }
    const row = rows[0];
    if (
      row.sellerProfileId !== sellerProfileId
      || typeof row.chargesEnabled !== "boolean"
      || typeof row.vacationMode !== "boolean"
      || !nullableDate(row.vacationReturnDate)
      || !nullableString(row.vacationMessage)
      || !nullableString(row.city)
      || !nullableString(row.state)
      || !nullableNumber(row.lat)
      || !nullableNumber(row.lng)
      || !nullableNumber(row.radiusMeters)
      || typeof row.publicMapOptIn !== "boolean"
      || !nullableNumber(row.shippingFlatRateCents)
      || !nullableNumber(row.freeShippingOverCents)
      || typeof row.allowLocalPickup !== "boolean"
    ) {
      throw new Error("Seller owner Shop Settings authority returned an invalid result");
    }
    const privateState = await sellerOwnerPrivateState(userId, sellerProfileId, client);
    return privateState ? {
      chargesEnabled: row.chargesEnabled,
      vacationMode: row.vacationMode,
      vacationReturnDate: row.vacationReturnDate as Date | null,
      vacationMessage: row.vacationMessage as string | null,
      city: row.city as string | null,
      state: row.state as string | null,
      lat: row.lat as number | null,
      lng: row.lng as number | null,
      radiusMeters: row.radiusMeters as number | null,
      publicMapOptIn: row.publicMapOptIn,
      shippingFlatRateCents: row.shippingFlatRateCents as number | null,
      freeShippingOverCents: row.freeShippingOverCents as number | null,
      allowLocalPickup: row.allowLocalPickup,
      ...privateState,
    } : null;
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

export function updateSellerOwnerMetroAssignment(
  userId: string,
  input: {
    sellerProfileId: string;
    metroId: string | null;
    cityMetroId: string | null;
  },
) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<{ sellerProfileId: unknown }>>`
      SELECT *
        FROM public.grainline_seller_owner_metro_assignment_update(
          ${input.sellerProfileId}::text,
          ${input.metroId}::text,
          ${input.cityMetroId}::text
        )
    `;
    if (rows.length !== 1 || rows[0]?.sellerProfileId !== input.sellerProfileId) {
      throw new Error("Seller owner metro-assignment authority returned an invalid result");
    }
    return Object.freeze({ sellerProfileId: rows[0].sellerProfileId });
  });
}

export async function updateSellerOwnerProfile(
  client: DbUserContextTransactionClient,
  input: {
    sellerProfileId: string;
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
  const galleryImagesTouched = input.galleryImageUrls !== undefined;
  const rows = await client.$queryRaw<Array<{
    sellerProfileId: unknown;
    duplicateDisplayName: unknown;
  }>>`
    SELECT *
      FROM public.grainline_seller_owner_profile_update(
        ${input.sellerProfileId}::text,
        ${input.displayName}::text,
        ${input.displayNameNormalized}::text,
        ${input.tagline}::text,
        ${input.bio}::text,
        ${input.storyTitle}::text,
        ${input.storyBody}::text,
        ${input.yearsInBusiness}::integer,
        ${input.bannerImageUrl}::text,
        ${input.avatarImageUrl}::text,
        ${input.workshopImageUrl}::text,
        ${input.galleryImageUrls ?? []}::text[],
        ${input.galleryAltTexts ?? []}::text[],
        ${galleryImagesTouched}::boolean,
        ${input.instagramUrl}::text,
        ${input.facebookUrl}::text,
        ${input.pinterestUrl}::text,
        ${input.tiktokUrl}::text,
        ${input.websiteUrl}::text,
        ${input.returnPolicy}::text,
        ${input.customOrderPolicy}::text,
        ${input.shippingPolicy}::text,
        ${input.acceptsCustomOrders}::boolean,
        ${input.acceptingNewOrders}::boolean,
        ${input.customOrderTurnaroundDays}::integer,
        ${input.offersGiftWrapping}::boolean,
        ${input.giftWrappingPriceCents}::integer
      )
  `;
  const row = rows[0];
  if (
    rows.length !== 1
    || row?.sellerProfileId !== input.sellerProfileId
    || typeof row.duplicateDisplayName !== "boolean"
  ) {
    throw new Error("Seller owner profile-update authority returned an invalid result");
  }
  return Object.freeze({ duplicateDisplayName: row.duplicateDisplayName });
}

export async function clearSellerOwnerAvatar(
  client: DbUserContextTransactionClient,
  input: { sellerProfileId: string },
) {
  const rows = await client.$queryRaw<Array<{ sellerProfileId: unknown }>>`
    SELECT *
      FROM public.grainline_seller_owner_avatar_clear(
        ${input.sellerProfileId}::text
      )
  `;
  if (rows.length !== 1 || rows[0]?.sellerProfileId !== input.sellerProfileId) {
    throw new Error("Seller owner avatar-clear authority returned an invalid result");
  }
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
) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<{
      sellerProfileId: unknown;
      state: unknown;
    }>>`
      SELECT *
        FROM public.grainline_seller_owner_profile_editor_state(
          ${sellerProfileId}::text
        )
    `;
    if (rows.length === 0) return null;
    const row = rows[0];
    if (
      rows.length !== 1
      || row.sellerProfileId !== sellerProfileId
      || !isSellerOwnerProfileEditorState(row.state)
    ) {
      throw new Error("Seller owner profile-editor authority returned an invalid result");
    }
    return row.state;
  });
}
