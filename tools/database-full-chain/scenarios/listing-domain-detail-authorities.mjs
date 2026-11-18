import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function rowsOf(result) {
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

async function runtimeQuery(database, actorId, sql, params = []) {
  await database.query("BEGIN");
  try {
    await database.query("SET LOCAL ROLE grainline_app_runtime");
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [actorId ?? ""],
    );
    const result = await database.query(sql, params);
    await database.query("COMMIT");
    return result;
  } catch (error) {
    await database.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function withSession(database, role, operation) {
  await database.query(`SET SESSION AUTHORIZATION ${role}`);
  try {
    return await operation();
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }
}

export async function proveListingDomainDetailAuthorities({ database, seller }) {
  const suffix = randomUUID();
  const buyerId = `listing-detail-buyer-${suffix}`;
  const unrelatedId = `listing-detail-unrelated-${suffix}`;
  const staffId = `listing-detail-staff-${suffix}`;
  const listingIds = {
    public: `listing-detail-public-${suffix}`,
    soldOut: `listing-detail-sold-out-${suffix}`,
    hidden: `listing-detail-hidden-${suffix}`,
    reserved: `listing-detail-reserved-${suffix}`,
    archived: `listing-detail-archived-${suffix}`,
  };
  const photoId = `listing-detail-photo-${suffix}`;
  const groupId = `listing-detail-group-${suffix}`;
  const optionId = `listing-detail-option-${suffix}`;
  const blockId = `listing-detail-block-${suffix}`;
  const now = "2026-11-02 12:00:00";

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.proname AS name,
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
       pg_catalog.to_regprocedure('public.grainline_listing_detail_source_core(text)'),
       pg_catalog.to_regprocedure('public.grainline_listing_actor_detail_source(text)'),
       pg_catalog.to_regprocedure('public.grainline_listing_staff_detail_source(text,text)')
     )
     ORDER BY routine.proname
  `)), [
    {
      name: "grainline_listing_actor_detail_source",
      runtimeExecute: true,
      staffExecute: false,
      publicExecute: false,
    },
    {
      name: "grainline_listing_detail_source_core",
      runtimeExecute: false,
      staffExecute: false,
      publicExecute: false,
    },
    {
      name: "grainline_listing_staff_detail_source",
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
       ($1, $2, $3, 'Detail buyer', 'USER', $10, $10, $10, '2026-01-01', $10),
       ($4, $5, $6, 'Unrelated buyer', 'USER', $10, $10, $10, '2026-01-01', $10),
       ($7, $8, $9, 'Detail staff', 'ADMIN', $10, $10, $10, '2026-01-01', $10)`,
    [
      buyerId,
      `clerk_${buyerId}`.slice(0, 191),
      `${buyerId}@example.test`.slice(0, 191),
      unrelatedId,
      `clerk_${unrelatedId}`.slice(0, 191),
      `${unrelatedId}@example.test`.slice(0, 191),
      staffId,
      `clerk_${staffId}`.slice(0, 191),
      `${staffId}@example.test`.slice(0, 191),
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Listing"
       (id, "sellerId", title, description, "priceCents", currency, status,
        "listingType", "stockQuantity", "isPrivate", "reservedForUserId",
        "archivedAt", tags, materials, "metaDescription", "createdAt", "updatedAt")
     VALUES
       ($1, $6, 'Public detail', 'Public detail description', 1000, 'usd', 'ACTIVE',
        'IN_STOCK', 1, false, NULL, NULL, ARRAY['public'], ARRAY['oak'],
        'Public detail metadata', $8, $8),
       ($2, $6, 'Sold-out detail', 'Sold-out detail description', 1100, 'usd', 'SOLD_OUT',
        'IN_STOCK', 0, false, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
        NULL, $8, $8),
       ($3, $6, 'Hidden detail', 'Hidden detail description', 1200, 'usd', 'HIDDEN',
        'MADE_TO_ORDER', NULL, false, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
        NULL, $8, $8),
       ($4, $6, 'Reserved detail', 'Reserved detail description', 1300, 'usd', 'ACTIVE',
        'MADE_TO_ORDER', NULL, true, $7, NULL, ARRAY[]::text[], ARRAY[]::text[],
        NULL, $8, $8),
       ($5, $6, 'Archived detail', 'Archived detail description', 1400, 'usd', 'HIDDEN',
        'MADE_TO_ORDER', NULL, false, NULL, $8, ARRAY[]::text[], ARRAY[]::text[],
        NULL, $8, $8)`,
    [
      listingIds.public,
      listingIds.soldOut,
      listingIds.hidden,
      listingIds.reserved,
      listingIds.archived,
      seller.sellerProfileId,
      buyerId,
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Photo"
       (id, "listingId", url, "originalUrl", "altText", "sortOrder", "createdAt")
     VALUES ($1, $2, 'https://cdn.example.test/safe.jpg',
             'https://private.example.test/original.jpg', 'Safe alt', 0, $3)`,
    [photoId, listingIds.public, now],
  );
  await database.query(
    `INSERT INTO public."ListingVariantGroup" (id, "listingId", name, "sortOrder")
     VALUES ($1, $2, 'Finish', 0)`,
    [groupId, listingIds.public],
  );
  await database.query(
    `INSERT INTO public."ListingVariantOption"
       (id, "groupId", label, "priceAdjustCents", "sortOrder", "inStock")
     VALUES ($1, $2, 'Natural', 100, 0, true)`,
    [optionId, groupId],
  );

  const sourceSql = `
    SELECT * FROM public.grainline_listing_actor_detail_source($1::text)
  `;
  const anonymousPublic = rowsOf(await runtimeQuery(
    database,
    null,
    sourceSql,
    [listingIds.public],
  ));
  assert.equal(anonymousPublic.length, 1, "anonymous public detail");
  assert.equal(
    JSON.stringify(anonymousPublic).includes("originalUrl"),
    false,
    "originalUrl must not cross the Listing detail boundary",
  );
  assert.deepEqual(anonymousPublic[0].photos, [{
    id: photoId,
    url: "https://cdn.example.test/safe.jpg",
    altText: "Safe alt",
  }]);
  assert.deepEqual(anonymousPublic[0].variantGroups, [{
    id: groupId,
    name: "Finish",
    options: [{
      id: optionId,
      label: "Natural",
      priceAdjustCents: 100,
      inStock: true,
    }],
  }]);
  assert.equal(rowsOf(await runtimeQuery(
    database,
    null,
    sourceSql,
    [listingIds.soldOut],
  )).length, 1, "anonymous sold-out detail");
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    null,
    sourceSql,
    [listingIds.hidden],
  )), []);

  assert.equal(rowsOf(await runtimeQuery(
    database,
    seller.userId,
    sourceSql,
    [listingIds.hidden],
  )).length, 1, "owner hidden detail");
  assert.equal(rowsOf(await runtimeQuery(
    database,
    buyerId,
    sourceSql,
    [listingIds.reserved],
  )).length, 1, "reserved buyer detail");
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    unrelatedId,
    sourceSql,
    [listingIds.reserved],
  )), []);

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [blockId, seller.userId, buyerId, now],
  );
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    buyerId,
    sourceSql,
    [listingIds.public],
  )), [], "blocked pair detail");

  await withSession(database, "grainline_staff_read_runtime", async () => {
    assert.equal(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_listing_staff_detail_source($1::text, $2::text)`,
      [staffId, listingIds.hidden],
    )).length, 1, "staff hidden detail");
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_listing_staff_detail_source($1::text, $2::text)`,
      [staffId, listingIds.archived],
    )), [], "archived detail");
    await assert.rejects(
      database.query(sourceSql, [listingIds.public]),
      /permission denied/u,
    );
  });
  await assert.rejects(
    runtimeQuery(
      database,
      staffId,
      `SELECT *
         FROM public.grainline_listing_staff_detail_source($1::text, $2::text)`,
      [staffId, listingIds.hidden],
    ),
    /permission denied/u,
  );

  await database.query(`DELETE FROM public."Block" WHERE id = $1`, [blockId]);
  await database.query(`DELETE FROM public."Photo" WHERE id = $1`, [photoId]);
  await database.query(`DELETE FROM public."Listing" WHERE id = ANY($1::text[])`, [
    Object.values(listingIds),
  ]);
  await database.query(`DELETE FROM public."User" WHERE id = ANY($1::text[])`, [[
    buyerId,
    unrelatedId,
    staffId,
  ]]);
}
