import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

async function readAsRuntime(database, actorId, targetType, targetId, reportedUserId) {
  await database.query("SELECT set_config('app.user_id', $1, false)", [actorId]);
  await database.query("SET ROLE grainline_app_runtime");
  try {
    const rows = rowsOf(await database.query(
      `SELECT public.grainline_seller_actor_report_resource_target(
         $1, $2, $3
       ) AS value`,
      [targetType, targetId, reportedUserId],
    ));
    assert.equal(rows.length, 1);
    assert.equal(typeof rows[0].value, "boolean");
    return rows[0].value;
  } finally {
    await database.query("RESET ROLE");
  }
}

export async function proveSellerProfileReportResourceTarget({ database, seller }) {
  const viewerId = `${seller.userId}_report_viewer`;
  const reservedViewerId = `${seller.userId}_report_reserved`;
  const reviewerId = `${seller.userId}_report_reviewer`;
  const listingId = `${seller.sellerProfileId}_report_listing`;
  const reviewId = `${listingId}_review`;
  const now = "2026-10-21 13:00:00";

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
       'public.grainline_seller_actor_report_resource_target(text,text,text)'
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
     VALUES
       ($1, $2, $3, 'Report viewer', 'USER', $10, $10, $10, '2026-01-01', $10),
       ($4, $5, $6, 'Reserved report viewer', 'USER', $10, $10, $10, '2026-01-01', $10),
       ($7, $8, $9, 'Report reviewer', 'USER', $10, $10, $10, '2026-01-01', $10)`,
    [
      viewerId,
      `user_${viewerId}`.slice(0, 191),
      `${viewerId}@example.test`.slice(0, 191),
      reservedViewerId,
      `user_${reservedViewerId}`.slice(0, 191),
      `${reservedViewerId}@example.test`.slice(0, 191),
      reviewerId,
      `user_${reviewerId}`.slice(0, 191),
      `${reviewerId}@example.test`.slice(0, 191),
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "isPrivate", "reservedForUserId",
       "archivedAt", "createdAt", "updatedAt")
     VALUES
       ($1, $2, 'Report target listing', 'Actor report authority proof',
        8500, 'usd', 'ACTIVE', 'IN_STOCK', 1, false, NULL, NULL, $3, $3)`,
    [listingId, seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."Review"
      (id, "listingId", "reviewerId", "reviewerAccountActive", "ratingX2",
       verified, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, 10, true, $4, $4)`,
    [reviewId, listingId, reviewerId, now],
  );

  assert.equal(
    await readAsRuntime(database, viewerId, "LISTING", listingId, seller.userId),
    true,
  );
  assert.equal(
    await readAsRuntime(database, viewerId, "LISTING", listingId, reviewerId),
    false,
  );
  assert.equal(
    await readAsRuntime(database, viewerId, "REVIEW", reviewId, reviewerId),
    true,
  );
  assert.equal(
    await readAsRuntime(database, viewerId, "REVIEW", reviewId, seller.userId),
    true,
  );

  await database.query(
    `UPDATE public."Listing"
        SET "isPrivate" = true,
            "reservedForUserId" = $2,
            "updatedAt" = $3
      WHERE id = $1`,
    [listingId, reservedViewerId, now],
  );
  assert.equal(
    await readAsRuntime(database, reservedViewerId, "LISTING", listingId, seller.userId),
    true,
  );
  assert.equal(
    await readAsRuntime(database, viewerId, "LISTING", listingId, seller.userId),
    false,
  );
  assert.equal(
    await readAsRuntime(database, reservedViewerId, "REVIEW", reviewId, reviewerId),
    true,
  );
  assert.equal(
    await readAsRuntime(database, viewerId, "REVIEW", reviewId, reviewerId),
    false,
  );

  await database.query(
    `UPDATE public."Listing"
        SET status = 'HIDDEN', "archivedAt" = $2, "updatedAt" = $2
      WHERE id = $1`,
    [listingId, now],
  );
  assert.equal(
    await readAsRuntime(database, reviewerId, "REVIEW", reviewId, seller.userId),
    true,
  );
  assert.equal(
    await readAsRuntime(database, seller.userId, "REVIEW", reviewId, reviewerId),
    true,
  );
  assert.equal(
    await readAsRuntime(database, reservedViewerId, "REVIEW", reviewId, reviewerId),
    false,
  );

  await database.query(`UPDATE public."User" SET banned = true WHERE id = $1`, [viewerId]);
  await assert.rejects(
    readAsRuntime(database, viewerId, "LISTING", listingId, seller.userId),
    (error) => error?.code === "42501",
  );
  await database.query(`UPDATE public."User" SET banned = false WHERE id = $1`, [viewerId]);

  await assert.rejects(
    readAsRuntime(database, viewerId, "ORDER", listingId, seller.userId),
    (error) => error?.code === "22023",
  );
  await assert.rejects(
    readAsRuntime(database, viewerId, "LISTING", "bad id", seller.userId),
    (error) => error?.code === "22023",
  );

  await database.query("SELECT set_config('app.user_id', '', false)");
  await database.query(`DELETE FROM public."Review" WHERE id = $1`, [reviewId]);
  await database.query(`DELETE FROM public."Listing" WHERE id = $1`, [listingId]);
  await database.query(
    `DELETE FROM public."User" WHERE id = ANY($1::text[])`,
    [[viewerId, reservedViewerId, reviewerId]],
  );
}
