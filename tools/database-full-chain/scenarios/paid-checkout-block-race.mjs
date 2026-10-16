import assert from "node:assert/strict";

function singleSourceSnapshot({ buyerId, seller, listingId }) {
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
      offersGiftWrapping: false,
      giftWrappingPriceCents: null,
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
        title: "Blocked-pair paid checkout fixture",
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
        imageUrl: "https://cdn.example.test/blocked-pair.jpg",
        imageUrls: ["https://cdn.example.test/blocked-pair.jpg"],
        variantGroups: [],
      },
    },
    buyerId,
  };
}

function providerProjection({ listingId, suffix }) {
  return {
    currency: "usd",
    chargedTotalCents: 650,
    itemsSubtotalCents: 500,
    shippingTitle: "Ground",
    shippingAmountCents: 100,
    taxAmountCents: 50,
    buyerEmail: `blocked-pair-${suffix}@example.test`,
    buyerName: "Blocked Pair Buyer",
    shipToLine1: "1 Main St",
    shipToLine2: null,
    shipToCity: "Austin",
    shipToState: "TX",
    shipToPostalCode: "78701",
    shipToCountry: "US",
    stripePaymentIntentId: `pi_fullchain702_${suffix}`,
    stripeChargeId: `ch_fullchain702_${suffix}`,
    stripeApplicationFeeId: `fee_fullchain702_${suffix}`,
    stripeTransferId: `tr_fullchain702_${suffix}`,
    shippingCarrier: "USPS",
    shippingService: "Ground Advantage",
    quotedToLine1: "1 Main St",
    quotedToLine2: null,
    quotedToCity: "Austin",
    quotedToState: "TX",
    quotedToPostalCode: "78701",
    quotedToCountry: "US",
    quotedToName: "Blocked Pair Buyer",
    quotedToPhone: null,
    quotedShippingAmountCents: 100,
    shippoShipmentId: `ship_fullchain702_${suffix}`,
    shippoRateObjectId: `rate_fullchain702_${suffix}`,
    giftNote: null,
    giftWrapping: false,
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

async function asRuntime(database, sql, params = []) {
  await database.query("SET SESSION AUTHORIZATION grainline_app_runtime");
  try {
    return await database.query(sql, params);
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }
}

async function seedBlockedPair(database, seller, direction) {
  const suffix = direction === "buyer_blocks_seller" ? "buyer" : "seller";
  const now = new Date();
  const buyerId = `full_chain_702_buyer_${suffix}`;
  const listingId = `full_chain_702_listing_${suffix}`;
  const eventId = `evt_fullchain702_${suffix}`;
  const sessionId = `cs_test_fullchain702${suffix}`;
  const reservationId = `full_chain_702_reservation_${suffix}`;
  const snapshot = singleSourceSnapshot({ buyerId, seller, listingId });

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Blocked Pair Buyer', $4, $4, $4, '2026-01-01', $4)`,
    [buyerId, `user_full_chain_702_${suffix}`, `full-chain-702-${suffix}@example.test`, now],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "shipsWithinDays", category, tags,
       "packagedWeightGrams", "packagedLengthCm", "packagedWidthCm",
       "packagedHeightCm", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Blocked-pair paid checkout fixture',
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
      "7".repeat(32),
      buyerId,
      seller.sellerProfileId,
      sessionId,
      JSON.stringify([{
        listingId,
        sellerId: seller.sellerProfileId,
        quantity: 1,
      }]),
      JSON.stringify(snapshot),
      new Date(now.getTime() + 30 * 60 * 1000),
      now,
    ],
  );

  const blockerId = direction === "buyer_blocks_seller" ? buyerId : seller.userId;
  const blockedId = direction === "buyer_blocks_seller" ? seller.userId : buyerId;
  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [`full_chain_702_block_${suffix}`, blockerId, blockedId, now],
  );

  return {
    buyerId,
    eventId,
    listingId,
    reservationId,
    sessionId,
    paidAt: new Date(now.getTime() - 60 * 1000),
    provider: providerProjection({ listingId, suffix }),
  };
}

export async function proveBlockedPairPaidCheckoutCompletion({ database, seller }) {
  for (const direction of ["buyer_blocks_seller", "seller_blocks_buyer"]) {
    const fixture = await seedBlockedPair(database, seller, direction);
    const result = (await asRuntime(
      database,
      `SELECT * FROM public.grainline_stripe_checkout_order_create(
         $1, 1, $2, $3, $4::timestamp, $5::jsonb
       )`,
      [
        fixture.eventId,
        fixture.reservationId,
        fixture.sessionId,
        fixture.paidAt,
        JSON.stringify(fixture.provider),
      ],
    )).rows[0];

    assert.equal(result.outcome, "created");
    assert.match(result.invalid_reason, /could not transact at payment completion/u);
    assert.deepEqual(result.invalid_seller_user_ids, []);

    const order = (await database.query(
      `SELECT "buyerId" AS buyer_id,
              "buyerDataPurgedAt" AS buyer_data_purged_at,
              "buyerEmail" AS buyer_email,
              "reviewNeeded" AS review_needed,
              "blockedCheckoutRefundRequiredAt" AS refund_required_at
         FROM public."Order"
        WHERE id = $1`,
      [result.order_id],
    )).rows[0];
    assert.equal(order.buyer_id, null);
    assert.ok(order.buyer_data_purged_at instanceof Date);
    assert.equal(order.buyer_email, null);
    assert.equal(order.review_needed, true);
    assert.ok(order.refund_required_at instanceof Date);

    const reservation = (await database.query(
      `SELECT status FROM public."CheckoutStockReservation" WHERE id = $1`,
      [fixture.reservationId],
    )).rows[0];
    assert.equal(reservation.status, "COMPLETED");
  }
}
