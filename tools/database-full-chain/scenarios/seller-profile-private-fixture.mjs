export const SELLER_PROFILE_PRIVATE_COLUMNS = Object.freeze([
  "stripeAccountId",
  "stripeAccountVersion",
  "stripeControllerType",
  "manualStripeReconciliationNeeded",
  "manualStripeReconciliationNote",
  "shipFromName",
  "shipFromLine1",
  "shipFromLine2",
  "shipFromCity",
  "shipFromState",
  "shipFromPostal",
  "shipFromCountry",
  "shipFromPhone",
  "defaultPkgWeightGrams",
  "defaultPkgLengthCm",
  "defaultPkgWidthCm",
  "defaultPkgHeightCm",
  "useCalculatedShipping",
  "preferredCarriers",
  "onboardingStep",
  "onboardingComplete",
  "guildMemberApprovedAt",
  "guildMasterApprovedAt",
  "guildMasterAppliedAt",
  "guildMasterReviewNotes",
  "consecutiveMetricFailures",
  "lastMetricCheckAt",
  "metricWarningSentAt",
  "listingsBelowThresholdSince",
  "profileViews",
]);

export const FIXTURE_IDS = Object.freeze({
  user: "full_chain_seller_user",
  sellerProfile: "full_chain_seller_profile",
});

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function assertSellerProfilePrivateLayout(database) {
  const result = await database.query(`
    SELECT source.relname AS table_name, attribute.attname AS column_name
      FROM pg_catalog.pg_attribute AS attribute
      JOIN pg_catalog.pg_class AS source ON source.oid = attribute.attrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = source.relnamespace
     WHERE namespace.nspname = 'public'
       AND source.relname IN ('SellerProfile', 'SellerProfilePrivate')
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  `);
  const rows = rowsOf(result);
  const publicColumns = new Set(
    rows.filter((row) => row.table_name === "SellerProfile").map((row) => row.column_name),
  );
  const privateColumns = new Set(
    rows
      .filter((row) => row.table_name === "SellerProfilePrivate")
      .map((row) => row.column_name),
  );

  const leaked = SELLER_PROFILE_PRIVATE_COLUMNS.filter((column) =>
    publicColumns.has(column),
  );
  const missing = SELLER_PROFILE_PRIVATE_COLUMNS.filter(
    (column) => !privateColumns.has(column),
  );
  if (leaked.length || missing.length || !privateColumns.has("sellerProfileId")) {
    throw new Error(
      `SellerProfile private layout mismatch: leaked=${leaked.join(",") || "none"} ` +
        `missing=${missing.join(",") || "none"}`,
    );
  }
  return { publicColumns, privateColumns };
}

export async function seedSellerProfilePrivateFixture(
  database,
  { ids = FIXTURE_IDS, suffix = "default" } = {},
) {
  await assertSellerProfilePrivateLayout(database);
  const now = new Date("2026-10-15T00:00:00.000Z");
  const safeSuffix = suffix.replace(/[^a-z0-9_-]/giu, "_").slice(0, 40) || "default";
  const userId = `${ids.user}_${safeSuffix}`;
  const sellerProfileId = `${ids.sellerProfile}_${safeSuffix}`;
  const clerkId = `user_full_chain_${safeSuffix}`;
  const email = `full-chain-${safeSuffix}@example.test`;
  const stripeAccountId = `acct_full_chain_${safeSuffix}`;

  await database.query("BEGIN");
  try {
    await database.query(
      `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt", "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, $4, $5, $5, $5, '2026-01-01', $5)`,
      [userId, clerkId, email, "Full Chain Seller", now],
    );

    // The post-retirement initializer creates the private row. Keep all private
    // values out of the public insert so this fixture fails if the retired layout
    // returns or the initializer disappears.
    await database.query(
      `INSERT INTO public."SellerProfile"
      (id, "userId", "displayName", "displayNameNormalized", city, state,
       "chargesEnabled", "stripeAccountSupported", "acceptingNewOrders",
       "allowLocalPickup", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'Austin', 'TX', false, true, true, true, $5, $5)`,
      [sellerProfileId, userId, "Full Chain Workshop", "full chain workshop", now],
    );

    await database.query(
      `UPDATE public."SellerProfilePrivate"
        SET "stripeAccountId" = $2,
            "stripeAccountVersion" = 'v2',
            "stripeControllerType" = 'application',
            "shipFromName" = 'Full Chain Workshop',
            "shipFromLine1" = '100 Fixture Way',
            "shipFromCity" = 'Austin',
            "shipFromState" = 'TX',
            "shipFromPostal" = '78701',
            "shipFromCountry" = 'US',
            "shipFromPhone" = '+15125550100',
            "defaultPkgWeightGrams" = 2000,
            "defaultPkgLengthCm" = 40,
            "defaultPkgWidthCm" = 30,
            "defaultPkgHeightCm" = 20,
            "useCalculatedShipping" = true,
            "onboardingStep" = 5,
            "onboardingComplete" = true,
            "updatedAt" = $3
      WHERE "sellerProfileId" = $1`,
      [sellerProfileId, stripeAccountId, now],
    );
    await database.query(
      `UPDATE public."SellerProfile"
          SET "chargesEnabled" = true, "updatedAt" = $2
        WHERE id = $1`,
      [sellerProfileId, now],
    );

    const result = await database.query(
      `SELECT seller.id,
            seller."userId",
            seller."stripeAccountSupported",
            private."stripeAccountId",
            private."shipFromPhone",
            private."onboardingComplete"
       FROM public."SellerProfile" AS seller
       JOIN public."SellerProfilePrivate" AS private
         ON private."sellerProfileId" = seller.id
      WHERE seller.id = $1`,
      [sellerProfileId],
    );
    const row = rowsOf(result)[0];
    if (
      !row ||
      row.stripeAccountId !== stripeAccountId ||
      row.shipFromPhone !== "+15125550100" ||
      row.onboardingComplete !== true
    ) {
      throw new Error("SellerProfilePrivate fixture verification failed");
    }
    await database.query("COMMIT");
  } catch (error) {
    try {
      await database.query("ROLLBACK");
    } catch {}
    throw error;
  }
  return Object.freeze({ userId, sellerProfileId, stripeAccountId });
}
