import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfilePublicRecentlyViewedListings({ database, seller }) {
  const actorUserId = `${seller.userId}_recent_viewer`;
  const activeId = `${seller.sellerProfileId}_recent_active`;
  const soldOutId = `${seller.sellerProfileId}_recent_sold_out`;
  const photoId = `${seller.sellerProfileId}_recent_photo`;
  const blockId = `${seller.sellerProfileId}_recent_block`;
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
       'public.grainline_seller_public_recently_viewed_listings(text[])'
     )
  `)), [{
    securityDefiner: true,
    volatility: "s",
    config: ["search_path=pg_catalog"],
    runtimeExecute: true,
    publicExecute: false,
  }]);

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Recently viewed actor', $4, $4, $4, '2026-01-01', $4)`,
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
       "listingType", "stockQuantity", "isPrivate", "archivedAt",
       "createdAt", "updatedAt")
     VALUES
       ($1, $3, 'Recently viewed active', 'Full-chain recent card', 12500, 'usd',
        'ACTIVE', 'IN_STOCK', 1, false, NULL, $4, $4),
       ($2, $3, 'Recently viewed sold out', 'Full-chain recent card', 8000, 'usd',
        'SOLD_OUT', 'IN_STOCK', 0, false, NULL, $4, $4)`,
    [activeId, soldOutId, seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."Photo"
      (id, "listingId", url, "originalUrl", "sortOrder", "createdAt")
     VALUES ($1, $2, 'https://example.test/recent.jpg',
             'https://example.test/recent.jpg', 0, $3)`,
    [photoId, activeId, now],
  );

  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_public_recently_viewed_listings($1::text[])`,
      [[soldOutId, activeId, activeId]],
    )), [{
      id: activeId,
      title: "Recently viewed active",
      priceCents: 12500,
      currency: "usd",
      photoUrl: "https://example.test/recent.jpg",
      sellerDisplayName: "Full Chain Workshop",
      sellerAvatarImageUrl: null,
    }]);
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [blockId, actorUserId, seller.userId, now],
  );
  await database.query("SELECT set_config('app.user_id', $1, false)", [actorUserId]);
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_public_recently_viewed_listings($1::text[])`,
      [[activeId]],
    )), []);
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query("DELETE FROM public.\"Block\" WHERE id = $1", [blockId]);
  await database.query("DELETE FROM public.\"Photo\" WHERE id = $1", [photoId]);
  await database.query(
    `DELETE FROM public."Listing" WHERE id = ANY($1::text[])`,
    [[activeId, soldOutId]],
  );
  await database.query("DELETE FROM public.\"User\" WHERE id = $1", [actorUserId]);
  await database.query("SELECT set_config('app.user_id', '', false)");
}
