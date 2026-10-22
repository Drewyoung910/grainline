import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

async function readAsRuntime(database, actorId, listingId) {
  await database.query("SELECT set_config('app.user_id', $1, false)", [actorId]);
  await database.query("SET ROLE grainline_app_runtime");
  try {
    return rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_actor_review_listing_target($1)",
      [listingId],
    ));
  } finally {
    await database.query("RESET ROLE");
  }
}

export async function proveSellerProfileActorReviewListingTarget({ database, seller }) {
  const actorId = `${seller.userId}_review_target_actor`;
  const listingId = `${seller.sellerProfileId}_review_target_listing`;
  const now = "2026-10-21 16:00:00";

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.prosecdef AS "securityDefiner",
           routine.provolatile AS volatility,
           routine.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           ) AS "runtimeExecute",
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime', routine.oid, 'EXECUTE'
           ) AS "staffReadExecute",
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
       'public.grainline_seller_actor_review_listing_target(text)'
     )
  `)), [{
    securityDefiner: true,
    volatility: "s",
    config: ["search_path=pg_catalog"],
    runtimeExecute: true,
    staffReadExecute: false,
    publicExecute: false,
  }]);

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, role, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Review target actor', 'USER', $4, $4, $4, '2026-01-01', $4)`,
    [
      actorId,
      `user_${actorId}`.slice(0, 191),
      `${actorId}@example.test`.slice(0, 191),
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "isPrivate", "archivedAt",
       "createdAt", "updatedAt")
     VALUES ($1, $2, 'Review target listing', 'Review target authority proof',
             4200, 'usd', 'ACTIVE', 'IN_STOCK', 1, false, NULL, $3, $3)`,
    [listingId, seller.sellerProfileId, now],
  );

  assert.deepEqual(await readAsRuntime(database, actorId, listingId), [{
    listingId,
    title: "Review target listing",
    sellerProfileId: seller.sellerProfileId,
    sellerUserId: seller.userId,
    sellerDisplayName: "Full Chain Workshop",
    ownerAccountActive: true,
  }]);
  assert.deepEqual(await readAsRuntime(database, seller.userId, listingId), [{
    listingId,
    title: "Review target listing",
    sellerProfileId: seller.sellerProfileId,
    sellerUserId: seller.userId,
    sellerDisplayName: "Full Chain Workshop",
    ownerAccountActive: true,
  }]);

  await database.query(
    `UPDATE public."Listing"
        SET status = 'HIDDEN',
            "isPrivate" = true,
            "reservedForUserId" = $2,
            "archivedAt" = $3,
            "updatedAt" = $3
      WHERE id = $1`,
    [listingId, actorId, now],
  );
  assert.equal((await readAsRuntime(database, actorId, listingId)).length, 1);

  await database.query(`UPDATE public."User" SET banned = true WHERE id = $1`, [seller.userId]);
  const inactiveRows = await readAsRuntime(database, actorId, listingId);
  assert.equal(inactiveRows.length, 1);
  assert.equal(inactiveRows[0].ownerAccountActive, false);
  await database.query(`UPDATE public."User" SET banned = false WHERE id = $1`, [seller.userId]);

  await database.query(`UPDATE public."User" SET banned = true WHERE id = $1`, [actorId]);
  await assert.rejects(
    readAsRuntime(database, actorId, listingId),
    (error) => error?.code === "42501",
  );
  await database.query(`UPDATE public."User" SET banned = false WHERE id = $1`, [actorId]);

  assert.deepEqual(await readAsRuntime(database, actorId, `${listingId}_missing`), []);
  await assert.rejects(
    readAsRuntime(database, actorId, "bad id"),
    (error) => error?.code === "22023",
  );
  await database.query("SELECT set_config('app.user_id', '', false)");

  await database.query(`DELETE FROM public."Listing" WHERE id = $1`, [listingId]);
  await database.query(`DELETE FROM public."User" WHERE id = $1`, [actorId]);
}
