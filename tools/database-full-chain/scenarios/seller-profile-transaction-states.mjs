import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

async function callAsRuntime(database, actorId, functionName, resourceId) {
  await database.query("SELECT set_config('app.user_id', $1, false)", [actorId]);
  await database.query("SET ROLE grainline_app_runtime");
  try {
    return rowsOf(await database.query(
      `SELECT * FROM public.${functionName}($1)`,
      [resourceId],
    ));
  } finally {
    await database.query("RESET ROLE");
  }
}

export async function proveSellerProfileTransactionStates({ database, seller }) {
  const actorId = `${seller.userId}_transaction_actor`;
  const otherActorId = `${seller.userId}_transaction_other`;
  const listingId = `${seller.sellerProfileId}_transaction_listing`;
  const cartId = `${actorId}_cart`;
  const cartItemId = `${actorId}_cart_item`;
  const now = "2026-10-21 19:00:00";

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.proname AS name,
           routine.prosecdef AS "securityDefiner",
           routine.provolatile AS volatility,
           routine.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           ) AS "runtimeExecute",
           EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
               ) AS acl
              WHERE acl.grantee = 0
                AND acl.privilege_type = 'EXECUTE'
           ) AS "publicExecute"
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid IN (
       pg_catalog.to_regprocedure(
         'public.grainline_seller_actor_listing_transaction_state(text)'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_seller_actor_cart_transaction_states(text)'
       )
     )
     ORDER BY routine.proname
  `)), [
    {
      name: "grainline_seller_actor_cart_transaction_states",
      securityDefiner: true,
      volatility: "s",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      publicExecute: false,
    },
    {
      name: "grainline_seller_actor_listing_transaction_state",
      securityDefiner: true,
      volatility: "s",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      publicExecute: false,
    },
  ]);

  const originalSeller = rowsOf(await database.query(
    `SELECT "chargesEnabled", "stripeAccountSupported", "ownerAccountActive",
            "vacationMode", "acceptingNewOrders", "freeShippingOverCents",
            "shippingFlatRateCents", "allowLocalPickup", "offersGiftWrapping",
            "giftWrappingPriceCents", "updatedAt"::text AS "updatedAtText"
       FROM public."SellerProfile"
      WHERE id = $1`,
    [seller.sellerProfileId],
  ))[0];
  assert.ok(originalSeller);

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES
       ($1, $2, $3, 'Transaction actor', $7, $7, $7, '2026-01-01', $7),
       ($4, $5, $6, 'Other transaction actor', $7, $7, $7, '2026-01-01', $7)`,
    [
      actorId,
      `user_${actorId}`.slice(0, 191),
      `${actorId}@example.test`.slice(0, 191),
      otherActorId,
      `user_${otherActorId}`.slice(0, 191),
      `${otherActorId}@example.test`.slice(0, 191),
      now,
    ],
  );
  await database.query(
    `UPDATE public."SellerProfile"
        SET "chargesEnabled" = true,
            "stripeAccountSupported" = true,
            "ownerAccountActive" = true,
            "vacationMode" = false,
            "acceptingNewOrders" = true,
            "freeShippingOverCents" = 5000,
            "shippingFlatRateCents" = 750,
            "allowLocalPickup" = true,
            "offersGiftWrapping" = true,
            "giftWrappingPriceCents" = 400,
            "updatedAt" = $2
      WHERE id = $1`,
    [seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "isPrivate", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Transaction listing', 'Transaction authority proof',
             4200, 'usd', 'ACTIVE', 'IN_STOCK', 2, false, $3, $3)`,
    [listingId, seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."Cart" (id, "userId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $3)`,
    [cartId, actorId, now],
  );
  await database.query(
    `INSERT INTO public."CartItem"
      (id, "cartId", "listingId", quantity, "priceCents", "priceVersion",
       "selectedVariantOptionIds", "variantKey", "createdAt")
     VALUES ($1, $2, $3, 1, 4200, 1, ARRAY[]::text[], '', $4)`,
    [cartItemId, cartId, listingId, now],
  );

  const expected = {
    id: seller.sellerProfileId,
    userId: seller.userId,
    displayName: "Full Chain Workshop",
    chargesEnabled: true,
    stripeAccountSupported: true,
    ownerAccountActive: true,
    vacationMode: false,
    acceptingNewOrders: true,
    freeShippingOverCents: 5000,
    shippingFlatRateCents: 750,
    allowLocalPickup: true,
    offersGiftWrapping: true,
    giftWrappingPriceCents: 400,
  };
  assert.deepEqual(
    await callAsRuntime(
      database,
      actorId,
      "grainline_seller_actor_listing_transaction_state",
      listingId,
    ),
    [expected],
  );
  assert.deepEqual(
    await callAsRuntime(
      database,
      actorId,
      "grainline_seller_actor_cart_transaction_states",
      cartId,
    ),
    [expected],
  );
  assert.deepEqual(
    await callAsRuntime(
      database,
      otherActorId,
      "grainline_seller_actor_cart_transaction_states",
      cartId,
    ),
    [],
  );
  assert.deepEqual(
    await callAsRuntime(
      database,
      otherActorId,
      "grainline_seller_actor_listing_transaction_state",
      `${listingId}_missing`,
    ),
    [],
  );

  await database.query(`UPDATE public."User" SET banned = true WHERE id = $1`, [actorId]);
  assert.deepEqual(
    await callAsRuntime(
      database,
      actorId,
      "grainline_seller_actor_cart_transaction_states",
      cartId,
    ),
    [],
  );
  await database.query(`UPDATE public."User" SET banned = false WHERE id = $1`, [actorId]);
  await database.query("SELECT set_config('app.user_id', '', false)");

  await database.query(`DELETE FROM public."Cart" WHERE id = $1`, [cartId]);
  await database.query(`DELETE FROM public."Listing" WHERE id = $1`, [listingId]);
  await database.query(
    `UPDATE public."SellerProfile"
        SET "chargesEnabled" = $2,
            "stripeAccountSupported" = $3,
            "ownerAccountActive" = $4,
            "vacationMode" = $5,
            "acceptingNewOrders" = $6,
            "freeShippingOverCents" = $7,
            "shippingFlatRateCents" = $8,
            "allowLocalPickup" = $9,
            "offersGiftWrapping" = $10,
            "giftWrappingPriceCents" = $11,
            "updatedAt" = $12
      WHERE id = $1`,
    [
      seller.sellerProfileId,
      originalSeller.chargesEnabled,
      originalSeller.stripeAccountSupported,
      originalSeller.ownerAccountActive,
      originalSeller.vacationMode,
      originalSeller.acceptingNewOrders,
      originalSeller.freeShippingOverCents,
      originalSeller.shippingFlatRateCents,
      originalSeller.allowLocalPickup,
      originalSeller.offersGiftWrapping,
      originalSeller.giftWrappingPriceCents,
      originalSeller.updatedAtText,
    ],
  );
  await database.query(
    `DELETE FROM public."User" WHERE id = ANY($1::text[])`,
    [[actorId, otherActorId]],
  );
}
