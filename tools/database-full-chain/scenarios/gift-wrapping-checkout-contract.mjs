import assert from "node:assert/strict";

export const GIFT_WRAPPING_CHECKOUT_CONTRACT_MIGRATION =
  "20261027050000_correct_gift_wrapping_checkout_contract";

const profileUpdateSql = `
  SELECT *
    FROM public.grainline_seller_owner_profile_update(
      $1::text, $2::text, $3::text, $4::text, $5::text, $6::text,
      $7::text, $8::integer, $9::text, $10::text, $11::text,
      $12::text[], $13::text[], $14::boolean, $15::text, $16::text,
      $17::text, $18::text, $19::text, $20::text, $21::text, $22::text,
      $23::boolean, $24::boolean, $25::integer, $26::boolean, $27::integer
    )
`;

async function asRuntime(database, actorId, sql, params = []) {
  await database.query("SET SESSION AUTHORIZATION grainline_app_runtime");
  try {
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, false)",
      [actorId],
    );
    return await database.query(sql, params);
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
    await database.query("RESET app.user_id");
  }
}

function profileUpdateArgs(seller) {
  return [
    seller.sellerProfileId,
    "Full Chain Workshop",
    "full chain workshop",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    [],
    [],
    false,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    false,
    true,
    null,
    true,
    null,
  ];
}

function sourceSnapshot({
  buyerId,
  giftWrappingPriceCents,
  seller,
  listingId,
}) {
  return {
    seller: {
      id: seller.sellerProfileId,
      userId: seller.userId,
      displayName: "Full Chain Workshop",
      stripeAccountId: seller.stripeAccountId,
      stripeAccountVersion: "v2",
      chargesEnabled: true,
      vacationMode: false,
      acceptingNewOrders: true,
      allowLocalPickup: true,
      offersGiftWrapping: true,
      giftWrappingPriceCents,
      defaultPkgWeightGrams: 2000,
      defaultPkgLengthCm: 40,
      defaultPkgWidthCm: 30,
      defaultPkgHeightCm: 20,
      userBanned: false,
      userDeleted: false,
    },
    item: {
      quantity: 1,
      selectedVariantOptionIds: [],
      listing: {
        id: listingId,
        sellerId: seller.sellerProfileId,
        title: "Free gift-wrap checkout fixture",
        description: "Disposable full-chain fixture",
        priceCents: 500,
        priceVersion: 1,
        currency: "usd",
        status: "ACTIVE",
        listingType: "IN_STOCK",
        processingTimeMinDays: null,
        processingTimeMaxDays: null,
        shipsWithinDays: 2,
        category: "KITCHEN",
        tags: ["fixture"],
        isPrivate: false,
        reservedForUserId: null,
        packagedWeightGrams: 900,
        packagedLengthCm: 20,
        packagedWidthCm: 10,
        packagedHeightCm: 5,
        imageUrl: "https://cdn.example.test/gift-wrap.jpg",
        imageUrls: ["https://cdn.example.test/gift-wrap.jpg"],
        variantGroups: [],
      },
    },
    buyerId,
  };
}

function providerProjection({ buyerEmail, listingId, suffix }) {
  return {
    currency: "usd",
    chargedTotalCents: 650,
    itemsSubtotalCents: 500,
    shippingTitle: "Ground",
    shippingAmountCents: 100,
    taxAmountCents: 50,
    buyerEmail,
    buyerName: "Gift Wrap Buyer",
    shipToLine1: "1 Main St",
    shipToLine2: null,
    shipToCity: "Austin",
    shipToState: "TX",
    shipToPostalCode: "78701",
    shipToCountry: "US",
    stripePaymentIntentId: `pi_fullchaingiftwrap_${suffix}`,
    stripeChargeId: `ch_fullchaingiftwrap_${suffix}`,
    stripeApplicationFeeId: `fee_fullchaingiftwrap_${suffix}`,
    stripeTransferId: `tr_fullchaingiftwrap_${suffix}`,
    shippingCarrier: "USPS",
    shippingService: "Ground Advantage",
    quotedToLine1: "1 Main St",
    quotedToLine2: null,
    quotedToCity: "Austin",
    quotedToState: "TX",
    quotedToPostalCode: "78701",
    quotedToCountry: "US",
    quotedToName: "Gift Wrap Buyer",
    quotedToPhone: null,
    quotedShippingAmountCents: 100,
    shippoShipmentId: `ship_fullchaingiftwrap_${suffix}`,
    shippoRateObjectId: `rate_fullchaingiftwrap_${suffix}`,
    giftNote: "Thank you",
    giftWrapping: true,
    giftWrappingPriceCents: 0,
    estDays: 3,
    paidItems: [{
      sourceKey: `single:${listingId}`,
      listingId,
      variantKey: "",
      quantity: 1,
      unitAmountCents: 500,
    }],
  };
}

async function seedGiftWrappingCheckoutInput({
  database,
  giftWrappingPriceCents,
  seller,
  suffix,
}) {
  const now = new Date("2026-10-27T12:00:00.000Z");
  const buyerId = `full_chain_gift_wrap_buyer_${suffix}`;
  const buyerEmail = `full-chain-gift-wrap-buyer-${suffix}@example.test`;
  const listingId = `full_chain_gift_wrap_listing_${suffix}`;
  const eventId = `evt_fullchaingiftwrap_${suffix}`;
  const sessionId = `cs_test_fullchaingiftwrap${suffix}`;
  const reservationId = `full_chain_gift_wrap_reservation_${suffix}`;

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Gift Wrap Buyer', $4, $4, $4, '2026-01-01', $4)`,
    [buyerId, `user_full_chain_gift_wrap_buyer_${suffix}`, buyerEmail, now],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "shipsWithinDays", category, tags,
       "packagedWeightGrams", "packagedLengthCm", "packagedWidthCm",
       "packagedHeightCm", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Free gift-wrap checkout fixture',
       'Disposable full-chain fixture', 500, 'usd', 'ACTIVE', 'IN_STOCK', 0,
       2, 'KITCHEN', ARRAY['fixture'], 900, 20, 10, 5, $3, $3)`,
    [listingId, seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."StripeWebhookEvent"
      (id, type, "sourceObjectId", "claimGeneration", "processingStartedAt",
       "createdAt", "updatedAt")
     VALUES ($1, 'checkout.session.completed', $2, 1, $3, $3, $3)`,
    [eventId, sessionId, now],
  );
  await database.query(
    `INSERT INTO public."CheckoutStockReservation"
      (id, "checkoutLockKey", "payloadHash", "buyerId", "sellerId",
       "stripeSessionId", status, "reservedItems", "sourceSnapshot",
       "expiresAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, 'SESSION_CREATED', $7::jsonb, $8::jsonb,
       $9, $10, $10)`,
    [
      reservationId,
      `single:${buyerId}:${listingId}`,
      suffix.padEnd(32, "8").slice(0, 32),
      buyerId,
      seller.sellerProfileId,
      sessionId,
      JSON.stringify([{
        listingId,
        sellerId: seller.sellerProfileId,
        quantity: 1,
      }]),
      JSON.stringify(sourceSnapshot({
        buyerId,
        giftWrappingPriceCents,
        seller,
        listingId,
      })),
      new Date(now.getTime() + 30 * 60 * 1000),
      now,
    ],
  );

  return {
    buyerEmail,
    buyerId,
    eventId,
    listingId,
    now,
    provider: providerProjection({ buyerEmail, listingId, suffix }),
    reservationId,
    sessionId,
  };
}

async function createOrderFromInput(database, checkout) {
  return asRuntime(
    database,
    checkout.buyerId,
    `SELECT * FROM public.grainline_stripe_checkout_order_create(
       $1, 1, $2, $3, $4::timestamp, $5::jsonb
     )`,
    [
      checkout.eventId,
      checkout.reservationId,
      checkout.sessionId,
      checkout.now,
      JSON.stringify(checkout.provider),
    ],
  );
}

export async function proveGiftWrappingCheckoutPredecessorFailure({
  database,
  seller,
}) {
  const updateResult = await asRuntime(
    database,
    seller.userId,
    profileUpdateSql,
    profileUpdateArgs(seller),
  );
  assert.equal(updateResult.rows.length, 1);

  const profile = (await database.query(
    `SELECT "offersGiftWrapping" AS offered,
            "giftWrappingPriceCents" AS price
       FROM public."SellerProfile"
      WHERE id = $1`,
    [seller.sellerProfileId],
  )).rows[0];
  assert.deepEqual(profile, { offered: true, price: null });

  const checkout = await seedGiftWrappingCheckoutInput({
    database,
    giftWrappingPriceCents: null,
    seller,
    suffix: "predecessor",
  });
  await assert.rejects(
    createOrderFromInput(database, checkout),
    (error) => error?.code === "23514"
      && /Paid checkout gift-wrap source is invalid/u.test(error.message),
  );
}

export async function proveGiftWrappingCheckoutContract({ database, seller }) {
  const updateResult = await asRuntime(
    database,
    seller.userId,
    profileUpdateSql,
    profileUpdateArgs(seller),
  );
  assert.equal(updateResult.rows.length, 1);

  const profile = (await database.query(
    `SELECT "offersGiftWrapping" AS offered,
            "giftWrappingPriceCents" AS price
       FROM public."SellerProfile"
      WHERE id = $1`,
    [seller.sellerProfileId],
  )).rows[0];
  assert.deepEqual(profile, { offered: true, price: 0 });

  await database.query("BEGIN");
  try {
    await database.query("SAVEPOINT invalid_gift_wrap");
    await assert.rejects(
      database.query(
        `UPDATE public."SellerProfile"
            SET "giftWrappingPriceCents" = NULL
          WHERE id = $1`,
        [seller.sellerProfileId],
      ),
      (error) => error?.code === "23514",
    );
    await database.query("ROLLBACK TO SAVEPOINT invalid_gift_wrap");
    await database.query("RELEASE SAVEPOINT invalid_gift_wrap");
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK").catch(() => {});
    throw error;
  }

  const checkout = await seedGiftWrappingCheckoutInput({
    database,
    giftWrappingPriceCents: 0,
    seller,
    suffix: "corrected",
  });
  const created = await createOrderFromInput(database, checkout);
  assert.equal(created.rows[0]?.outcome, "created");

  const order = (await database.query(
    `SELECT "giftWrapping" AS wrapping,
            "giftWrappingPriceCents" AS price
       FROM public."Order"
      WHERE id = $1`,
    [created.rows[0].order_id],
  )).rows[0];
  assert.deepEqual(order, { wrapping: true, price: 0 });
}
