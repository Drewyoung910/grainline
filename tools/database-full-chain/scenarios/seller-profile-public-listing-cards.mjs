import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfilePublicListingCards({ database, seller }) {
  const actorUserId = `${seller.userId}_listing_card_viewer`;
  const listingId = `${seller.sellerProfileId}_listing_card`;
  const blockId = `${seller.sellerProfileId}_listing_card_block`;
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
       'public.grainline_seller_public_listing_cards(text[])'
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
     VALUES ($1, $2, $3, 'Listing card viewer', $4, $4, $4, '2026-01-01', $4)`,
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
     VALUES ($1, $2, 'Listing card', 'Full-chain seller card',
             5200, 'usd', 'ACTIVE', 'IN_STOCK', 1, false, NULL, $3, $3)`,
    [listingId, seller.sellerProfileId, now],
  );

  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_public_listing_cards($1::text[])`,
      [[listingId]],
    )), [{
      listingId,
      sellerProfileId: seller.sellerProfileId,
      displayName: "Full Chain Workshop",
      avatarImageUrl: null,
      // The preceding public-profile scenario deliberately promotes this
      // shared full-chain fixture and leaves the reviewed public state in
      // place for later authority proofs.
      guildLevel: "GUILD_MEMBER",
      city: "Austin",
      state: "TX",
      acceptingNewOrders: true,
      ownerImageUrl: null,
    }]);
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [blockId, seller.userId, actorUserId, now],
  );
  await database.query("SELECT set_config('app.user_id', $1, false)", [actorUserId]);
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_public_listing_cards($1::text[])`,
      [[listingId]],
    )), []);
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query("DELETE FROM public.\"Block\" WHERE id = $1", [blockId]);
  await database.query("DELETE FROM public.\"Listing\" WHERE id = $1", [listingId]);
  await database.query("DELETE FROM public.\"User\" WHERE id = $1", [actorUserId]);
  await database.query("SELECT set_config('app.user_id', '', false)");
}
