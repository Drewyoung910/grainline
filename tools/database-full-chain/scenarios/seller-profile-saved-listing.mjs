import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileSavedListingAuthority({ database, seller }) {
  const suffix = seller.sellerProfileId;
  const actorUserId = `${suffix}_saved_actor`;
  const listingFirstId = `${suffix}_saved_first`;
  const listingSecondId = `${suffix}_saved_second`;
  const listingPrivateId = `${suffix}_saved_private`;
  const listingHiddenId = `${suffix}_saved_hidden`;
  const photoId = `${suffix}_saved_photo`;
  const blockId = `${suffix}_saved_block`;
  const now = "2026-10-20 12:00:00";

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
         'public.grainline_seller_owner_saved_listing_count()'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_seller_owner_saved_listing_page(integer,integer)'
       )
     )
     ORDER BY routine.proname
  `)), [
    {
      name: "grainline_seller_owner_saved_listing_count",
      securityDefiner: true,
      volatility: "s",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      publicExecute: false,
    },
    {
      name: "grainline_seller_owner_saved_listing_page",
      securityDefiner: true,
      volatility: "s",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      publicExecute: false,
    },
  ]);

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Saved listing actor', $4, $4, $4, '2026-01-01', $4)`,
    [
      actorUserId,
      `user_${actorUserId}`.slice(0, 191),
      `${actorUserId}@example.test`.slice(0, 191),
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "isPrivate", "createdAt", "updatedAt")
     VALUES
       ($1, $5, 'Saved first', 'Full-chain visible listing', 1000, 'usd',
        'ACTIVE', 'IN_STOCK', 2, false, $6, $6),
       ($2, $5, 'Saved second', 'Full-chain sold-out listing', 2000, 'usd',
        'SOLD_OUT', 'IN_STOCK', 0, false, $6, $6),
       ($3, $5, 'Saved private', 'Full-chain private listing', 3000, 'usd',
        'ACTIVE', 'IN_STOCK', 1, true, $6, $6),
       ($4, $5, 'Saved hidden', 'Full-chain hidden listing', 4000, 'usd',
        'HIDDEN', 'IN_STOCK', 1, false, $6, $6)`,
    [
      listingFirstId,
      listingSecondId,
      listingPrivateId,
      listingHiddenId,
      seller.sellerProfileId,
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Favorite" ("userId", "listingId", "createdAt")
     VALUES
       ($1, $2, '2026-10-20 12:00:00'),
       ($1, $3, '2026-10-20 12:00:00'),
       ($1, $4, '2026-10-20 11:00:00'),
       ($1, $5, '2026-10-20 10:00:00')`,
    [
      actorUserId,
      listingFirstId,
      listingSecondId,
      listingPrivateId,
      listingHiddenId,
    ],
  );
  await database.query(
    `INSERT INTO public."Photo"
      (id, "listingId", url, "altText", "sortOrder", "createdAt")
     VALUES ($1, $2, 'https://example.test/saved.jpg', 'Saved listing', 0, $3)`,
    [photoId, listingFirstId, now],
  );

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_owner_saved_listing_count()",
      ),
      (error) => error?.code === "42501",
    );
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, false)",
      [actorUserId],
    );
    const countRows = rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_owner_saved_listing_count()",
    ));
    assert.equal(countRows.length, 1);
    assert.equal(String(countRows[0].value), "2");
    const pageRows = rowsOf(await database.query(`
      SELECT "listingId", title, "photoUrl"
        FROM public.grainline_seller_owner_saved_listing_page(24, 0)
    `));
    assert.deepEqual(pageRows, [
      { listingId: listingSecondId, title: "Saved second", photoUrl: null },
      {
        listingId: listingFirstId,
        title: "Saved first",
        photoUrl: "https://example.test/saved.jpg",
      },
    ]);
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_owner_saved_listing_page(25, 0)",
      ),
      (error) => error?.code === "22023",
    );
  } finally {
    await database.query("SELECT pg_catalog.set_config('app.user_id', '', false)");
    await database.query("RESET ROLE");
  }

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [blockId, seller.userId, actorUserId, now],
  );
  await database.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [actorUserId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_owner_saved_listing_page(24, 0)",
    )), []);
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }

  await database.query(`DELETE FROM public."Block" WHERE id = $1`, [blockId]);
  await database.query(`DELETE FROM public."Photo" WHERE id = $1`, [photoId]);
  await database.query(
    `DELETE FROM public."Favorite" WHERE "userId" = $1`,
    [actorUserId],
  );
  await database.query(
    `DELETE FROM public."Listing" WHERE id = ANY($1::text[])`,
    [[listingFirstId, listingSecondId, listingPrivateId, listingHiddenId]],
  );
  await database.query(`DELETE FROM public."User" WHERE id = $1`, [actorUserId]);
}
