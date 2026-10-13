import type { Prisma } from "@prisma/client";

type SellerAccountDeletionClient = Pick<Prisma.TransactionClient, "sellerProfile">;

/** Compatibility boundary for account-deletion mutations of private seller data. */
export function pauseSellerForAccountDeletion(
  client: SellerAccountDeletionClient,
  input: { userId: string; stripeAccountId?: string },
) {
  return client.sellerProfile.updateMany({
    where: {
      userId: input.userId,
      ...(input.stripeAccountId ? { stripeAccountId: input.stripeAccountId } : {}),
    },
    data: { chargesEnabled: false, vacationMode: true },
  });
}

export async function anonymizeSellerForAccountDeletion(
  client: SellerAccountDeletionClient,
  input: {
    sellerProfileId: string;
    userId: string;
    stripeRejectSucceeded: boolean;
    stripeAccountId: string | null;
    stripeAccountVersion: string | null;
    stripeControllerType: string | null;
  },
) {
  const result = await client.sellerProfile.updateMany({
    where: { id: input.sellerProfileId, userId: input.userId },
    data: {
      displayName: "Deleted maker",
      displayNameNormalized: "Deleted maker",
      bio: null,
      city: null,
      state: null,
      lat: null,
      lng: null,
      radiusMeters: null,
      publicMapOptIn: false,
      stripeAccountId: null,
      stripeAccountVersion: null,
      stripeControllerType: null,
      chargesEnabled: false,
      manualStripeReconciliationNeeded: !input.stripeRejectSucceeded,
      manualStripeReconciliationNote: input.stripeRejectSucceeded
        ? null
        : `Account deletion could not reject Stripe Connect account ${input.stripeAccountId} (${input.stripeAccountVersion ?? "legacy/unknown"}; ${input.stripeControllerType ?? "controller unknown"}); manual Stripe dashboard reconciliation required.`,
      shippingFlatRateCents: null,
      freeShippingOverCents: null,
      allowLocalPickup: false,
      shipFromName: null,
      shipFromLine1: null,
      shipFromLine2: null,
      shipFromCity: null,
      shipFromState: null,
      shipFromPostal: null,
      shipFromCountry: "US",
      shipFromPhone: null,
      defaultPkgWeightGrams: null,
      defaultPkgLengthCm: null,
      defaultPkgWidthCm: null,
      defaultPkgHeightCm: null,
      useCalculatedShipping: false,
      preferredCarriers: [],
      tagline: null,
      bannerImageUrl: null,
      avatarImageUrl: null,
      workshopImageUrl: null,
      storyTitle: null,
      storyBody: null,
      instagramUrl: null,
      facebookUrl: null,
      pinterestUrl: null,
      tiktokUrl: null,
      websiteUrl: null,
      yearsInBusiness: null,
      acceptsCustomOrders: false,
      acceptingNewOrders: false,
      customOrderTurnaroundDays: null,
      offersGiftWrapping: false,
      giftWrappingPriceCents: null,
      returnPolicy: null,
      customOrderPolicy: null,
      shippingPolicy: null,
      featuredListingIds: [],
      galleryImageUrls: [],
      galleryAltTexts: [],
      isVerifiedMaker: false,
      verifiedAt: null,
      guildLevel: "NONE",
      guildMemberApprovedAt: null,
      guildMasterApprovedAt: null,
      guildMasterAppliedAt: null,
      guildMasterReviewNotes: null,
      consecutiveMetricFailures: 0,
      lastMetricCheckAt: null,
      metricWarningSentAt: null,
      listingsBelowThresholdSince: null,
      profileViews: 0,
      featuredUntil: null,
      metroId: null,
      cityMetroId: null,
      vacationMode: true,
      vacationReturnDate: null,
      vacationMessage: null,
    },
  });

  if (result.count !== 1) {
    throw new Error("Account deletion seller profile ownership changed");
  }
}
