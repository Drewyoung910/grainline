import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

async function asRuntime(database, operation) {
  await database.query("SET SESSION AUTHORIZATION grainline_app_runtime");
  try {
    return await operation();
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }
}

export async function proveSellerProfileRetainedAuthorityGaps({ database, seller }) {
  const now = new Date("2026-10-20T18:00:00.000Z");
  const buyerId = `${seller.userId}_retained_buyer`;
  const listingIds = Array.from(
    { length: 5 },
    (_, index) => `${seller.sellerProfileId}_retained_listing_${index + 1}`,
  );

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Retained Authority Buyer', $4, $4, $4, '2026-01-01', $4)`,
    [
      buyerId,
      `user_${buyerId}`,
      `${buyerId}@example.test`,
      now,
    ],
  );

  const belowThreshold = await asRuntime(database, () => database.query(
    `SELECT public.grainline_seller_guild_listing_threshold_sync($1) AS threshold`,
    [seller.sellerProfileId],
  ));
  assert.ok(rowsOf(belowThreshold)[0]?.threshold instanceof Date);
  assert.ok(rowsOf(await database.query(
    `SELECT "listingsBelowThresholdSince" AS threshold
       FROM public."SellerProfilePrivate"
      WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId],
  ))[0]?.threshold instanceof Date);

  for (const [index, listingId] of listingIds.entries()) {
    await database.query(
      `INSERT INTO public."Listing"
        (id, "sellerId", title, description, "priceCents", currency, status,
         "listingType", "stockQuantity", "shipsWithinDays", category, tags,
         "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Retained authority fixture', 500, 'usd', 'ACTIVE',
         'IN_STOCK', 5, 2, 'KITCHEN', ARRAY['fixture'], $4, $4)`,
      [listingId, seller.sellerProfileId, `Retained listing ${index + 1}`, now],
    );
  }

  const thresholdCleared = await asRuntime(database, () => database.query(
    `SELECT public.grainline_seller_guild_listing_threshold_sync($1) AS threshold`,
    [seller.sellerProfileId],
  ));
  assert.deepEqual(rowsOf(thresholdCleared), [{ threshold: null }]);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT "listingsBelowThresholdSince" AS threshold
       FROM public."SellerProfilePrivate"
      WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId],
  )), [{ threshold: null }]);

  const noReferences = await asRuntime(database, () => database.query(
    `SELECT * FROM public.grainline_listing_delete_reference_state($1, $2)`,
    [seller.userId, listingIds[0]],
  ));
  assert.deepEqual(rowsOf(noReferences), [{
    hasOrderItems: false,
    hasReviews: false,
    hasConversations: false,
    hasMessages: false,
    hasCheckoutReservations: false,
  }]);
  assert.deepEqual(rowsOf(await asRuntime(database, () => database.query(
    `SELECT * FROM public.grainline_listing_delete_reference_state($1, $2)`,
    [buyerId, listingIds[0]],
  ))), []);

  for (const [suffix, listingId] of [["buyer", listingIds[0]], ["seller", listingIds[1]]]) {
    await database.query(
      `INSERT INTO public."CheckoutStockReservation"
        (id, "checkoutLockKey", "payloadHash", "buyerId", "sellerId",
         "stripeSessionId", status, "reservedItems", "sourceSnapshot",
         "expiresAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, 'SESSION_CREATED', $7::jsonb, $8::jsonb,
         $9, $10, $10)`,
      [
        `${seller.sellerProfileId}_retained_reservation_${suffix}`,
        `retained:${seller.sellerProfileId}:${suffix}`,
        suffix === "buyer" ? "a".repeat(32) : "b".repeat(32),
        buyerId,
        seller.sellerProfileId,
        `cs_retained_${seller.sellerProfileId}_${suffix}`,
        JSON.stringify([{
          listingId,
          sellerId: seller.sellerProfileId,
          quantity: 1,
        }]),
        JSON.stringify({ item: { listing: { id: listingId } } }),
        new Date("2026-10-20T19:00:00.000Z"),
        now,
      ],
    );
  }

  const checkoutReference = await asRuntime(database, () => database.query(
    `SELECT * FROM public.grainline_listing_delete_reference_state($1, $2)`,
    [seller.userId, listingIds[0]],
  ));
  assert.equal(rowsOf(checkoutReference)[0]?.hasCheckoutReservations, true);

  const buyerClaims = await asRuntime(database, () => database.query(
    `SELECT * FROM public.grainline_checkout_reservation_account_claim_batch($1, 10)`,
    [buyerId],
  ));
  assert.deepEqual(rowsOf(buyerClaims).map((row) => row.reservation_id), [
    `${seller.sellerProfileId}_retained_reservation_buyer`,
    `${seller.sellerProfileId}_retained_reservation_seller`,
  ]);
  assert.ok(rowsOf(buyerClaims).every((row) => Number(row.repair_generation) === 1));

  await database.query(
    `UPDATE public."CheckoutStockReservation"
        SET "repairClaimedAt" = NULL,
            "repairClaimKind" = NULL
      WHERE id = $1`,
    [`${seller.sellerProfileId}_retained_reservation_seller`],
  );
  const sellerClaims = await asRuntime(database, () => database.query(
    `SELECT * FROM public.grainline_checkout_reservation_account_claim_batch($1, 1)`,
    [seller.userId],
  ));
  assert.deepEqual(rowsOf(sellerClaims).map((row) => row.reservation_id), [
    `${seller.sellerProfileId}_retained_reservation_seller`,
  ]);
  assert.equal(Number(rowsOf(sellerClaims)[0]?.repair_generation), 2);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT "repairClaimKind" AS kind
       FROM public."CheckoutStockReservation"
      WHERE id = $1`,
    [`${seller.sellerProfileId}_retained_reservation_seller`],
  )), [{ kind: "ACCOUNT" }]);
}
