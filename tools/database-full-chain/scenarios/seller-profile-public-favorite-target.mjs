import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfilePublicFavoriteTarget({ database, seller }) {
  const activeId = `${seller.sellerProfileId}_favorite_active`;
  const soldOutId = `${seller.sellerProfileId}_favorite_sold_out`;
  const privateId = `${seller.sellerProfileId}_favorite_private`;
  const hiddenId = `${seller.sellerProfileId}_favorite_hidden`;
  const archivedId = `${seller.sellerProfileId}_favorite_archived`;
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
       'public.grainline_seller_public_favorite_target(text)'
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
     VALUES
       ($1, $6, 'Favorite active', 'Full-chain favorite target', 1000, 'usd',
        'ACTIVE', 'IN_STOCK', 1, false, NULL, $7, $7),
       ($2, $6, 'Favorite sold out', 'Full-chain favorite target', 1000, 'usd',
        'SOLD_OUT', 'IN_STOCK', 0, false, NULL, $7, $7),
       ($3, $6, 'Favorite private', 'Full-chain favorite target', 1000, 'usd',
        'ACTIVE', 'IN_STOCK', 1, true, NULL, $7, $7),
       ($4, $6, 'Favorite hidden', 'Full-chain favorite target', 1000, 'usd',
        'HIDDEN', 'IN_STOCK', 1, false, NULL, $7, $7),
       ($5, $6, 'Favorite archived', 'Full-chain favorite target', 1000, 'usd',
        'ACTIVE', 'IN_STOCK', 1, false, $7, $7, $7)`,
    [activeId, soldOutId, privateId, hiddenId, archivedId, seller.sellerProfileId, now],
  );

  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_public_favorite_target($1)",
      [activeId],
    )), [{
      listingId: activeId,
      title: "Favorite active",
      ownerUserId: seller.userId,
    }]);
    assert.deepEqual(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_public_favorite_target($1)",
      [soldOutId],
    )), [{
      listingId: soldOutId,
      title: "Favorite sold out",
      ownerUserId: seller.userId,
    }]);
    for (const unavailableId of [privateId, hiddenId, archivedId, "missing"]) {
      assert.deepEqual(rowsOf(await database.query(
        "SELECT * FROM public.grainline_seller_public_favorite_target($1)",
        [unavailableId],
      )), []);
    }
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_favorite_target('bad id')",
      ),
      (error) => error?.code === "22023",
    );
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
      "SELECT * FROM public.grainline_seller_public_favorite_target($1)",
      [activeId],
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

  await database.query(
    `DELETE FROM public."Listing" WHERE id = ANY($1::text[])`,
    [[activeId, soldOutId, privateId, hiddenId, archivedId]],
  );
}
