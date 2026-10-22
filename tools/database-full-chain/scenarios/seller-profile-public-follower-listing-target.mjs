import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfilePublicFollowerListingTarget({ database, seller }) {
  const listingId = `${seller.sellerProfileId}_follower_target`;
  const now = "2026-10-20 12:00:00";

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.prosecdef AS "securityDefiner",
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
     WHERE routine.oid = pg_catalog.to_regprocedure(
       'public.grainline_seller_public_follower_listing_target(text,text)'
     )
  `)), [{
    securityDefiner: true,
    volatility: "s",
    config: ["search_path=pg_catalog"],
    runtimeExecute: true,
    publicExecute: false,
  }]);

  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "isPrivate", "archivedAt",
       "createdAt", "updatedAt")
     VALUES ($1, $2, 'Follower target', 'Full-chain follower fanout target',
             6400, 'usd', 'ACTIVE', 'IN_STOCK', 1, false, NULL, $3, $3)`,
    [listingId, seller.sellerProfileId, now],
  );

  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_public_follower_listing_target($1,$2)`,
      [listingId, seller.sellerProfileId],
    )), [{
      listingId,
      title: "Follower target",
      priceCents: 6400,
      currency: "usd",
      sellerProfileId: seller.sellerProfileId,
      sellerUserId: seller.userId,
      sellerDisplayName: "Full Chain Workshop",
    }]);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_public_follower_listing_target($1,$2)`,
      [listingId, "wrong-seller"],
    )), []);
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(
    `UPDATE public."SellerProfile"
        SET "vacationMode" = true, "updatedAt" = $2
      WHERE id = $1`,
    [seller.sellerProfileId, now],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_public_follower_listing_target($1,$2)`,
      [listingId, seller.sellerProfileId],
    )), []);
  } finally {
    await database.query("RESET ROLE");
  }
  await database.query(
    `UPDATE public."SellerProfile"
        SET "vacationMode" = false, "updatedAt" = $2
      WHERE id = $1`,
    [seller.sellerProfileId, now],
  );

  await database.query("DELETE FROM public.\"Listing\" WHERE id = $1", [listingId]);
}
