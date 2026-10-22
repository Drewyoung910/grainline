import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

async function withSession(database, role, operation) {
  await database.query(`SET SESSION AUTHORIZATION ${role}`);
  try {
    return await operation();
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }
}

export async function proveSellerProfileListingDetailAuthorities({ database, seller }) {
  const buyerId = `${seller.userId}_detail_buyer`;
  const staffId = `${seller.userId}_detail_staff`;
  const now = "2026-10-22 12:00:00";
  const listingIds = {
    public: `${seller.sellerProfileId}_detail_public`,
    hidden: `${seller.sellerProfileId}_detail_hidden`,
    reserved: `${seller.sellerProfileId}_detail_reserved`,
    archived: `${seller.sellerProfileId}_detail_archived`,
  };

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.proname AS name,
           routine.prosecdef AS "securityDefiner",
           routine.provolatile AS volatility,
           routine.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           ) AS "runtimeExecute",
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime', routine.oid, 'EXECUTE'
           ) AS "staffExecute",
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
         'public.grainline_seller_actor_listing_detail_profile(text)'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_seller_staff_listing_detail_profile(text,text)'
       )
     )
     ORDER BY routine.proname
  `)), [
    {
      name: "grainline_seller_actor_listing_detail_profile",
      securityDefiner: true,
      volatility: "s",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      staffExecute: false,
      publicExecute: false,
    },
    {
      name: "grainline_seller_staff_listing_detail_profile",
      securityDefiner: true,
      volatility: "s",
      config: ["search_path=pg_catalog"],
      runtimeExecute: false,
      staffExecute: true,
      publicExecute: false,
    },
  ]);

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, role, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES
       ($1, $2, $3, 'Detail buyer', 'USER', $4, $4, $4, '2026-01-01', $4),
       ($5, $6, $7, 'Detail staff', 'ADMIN', $4, $4, $4, '2026-01-01', $4)`,
    [
      buyerId,
      `user_${buyerId}`.slice(0, 191),
      `${buyerId}@example.test`.slice(0, 191),
      now,
      staffId,
      `user_${staffId}`.slice(0, 191),
      `${staffId}@example.test`.slice(0, 191),
    ],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "isPrivate", "reservedForUserId",
       "archivedAt", "createdAt", "updatedAt")
     VALUES
       ($1, $5, 'Public detail', 'Public', 1000, 'usd', 'ACTIVE',
        'IN_STOCK', 1, false, NULL, NULL, $6, $6),
       ($2, $5, 'Hidden detail', 'Hidden', 1000, 'usd', 'HIDDEN',
        'IN_STOCK', 1, false, NULL, NULL, $6, $6),
       ($3, $5, 'Reserved detail', 'Reserved', 1000, 'usd', 'ACTIVE',
        'IN_STOCK', 1, true, $7, NULL, $6, $6),
       ($4, $5, 'Archived detail', 'Archived', 1000, 'usd', 'HIDDEN',
        'IN_STOCK', 1, true, $7, $6, $6, $6)`,
    [
      listingIds.public,
      listingIds.hidden,
      listingIds.reserved,
      listingIds.archived,
      seller.sellerProfileId,
      now,
      buyerId,
    ],
  );

  await database.query("SELECT set_config('app.user_id', '', false)");
  await withSession(database, "grainline_app_runtime", async () => {
    assert.equal(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_actor_listing_detail_profile($1)",
      [listingIds.public],
    )).length, 1);
    assert.deepEqual(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_actor_listing_detail_profile($1)",
      [listingIds.hidden],
    )), []);
  });

  await database.query("SELECT set_config('app.user_id', $1, false)", [seller.userId]);
  await withSession(database, "grainline_app_runtime", async () => {
    assert.equal(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_actor_listing_detail_profile($1)",
      [listingIds.hidden],
    )).length, 1);
    assert.deepEqual(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_actor_listing_detail_profile($1)",
      [listingIds.archived],
    )), []);
  });

  await database.query("SELECT set_config('app.user_id', $1, false)", [buyerId]);
  await withSession(database, "grainline_app_runtime", async () => {
    assert.equal(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_actor_listing_detail_profile($1)",
      [listingIds.reserved],
    )).length, 1);
  });

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [`${seller.sellerProfileId}_detail_block`, seller.userId, buyerId, now],
  );
  await withSession(database, "grainline_app_runtime", async () => {
    assert.deepEqual(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_actor_listing_detail_profile($1)",
      [listingIds.public],
    )), []);
  });

  await withSession(database, "grainline_staff_read_runtime", async () => {
    assert.equal(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_staff_listing_detail_profile($1, $2)`,
      [staffId, listingIds.hidden],
    )).length, 1);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_staff_listing_detail_profile($1, $2)`,
      [staffId, listingIds.archived],
    )), []);
  });

  await database.query(
    `DELETE FROM public."Block" WHERE id = $1`,
    [`${seller.sellerProfileId}_detail_block`],
  );
  await database.query(
    `DELETE FROM public."Listing" WHERE id = ANY($1::text[])`,
    [Object.values(listingIds)],
  );
  await database.query(
    `DELETE FROM public."User" WHERE id = ANY($1::text[])`,
    [[buyerId, staffId]],
  );
  await database.query("SELECT set_config('app.user_id', '', false)");
}
