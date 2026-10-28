import assert from "node:assert/strict";

import pg from "pg";

export const FAVORITE_PREPARATION_MIGRATION =
  "20261028010000_prepare_favorite_authorities";
export const FAVORITE_RLS_MIGRATION =
  "20261028050000_activate_favorite_rls";

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

async function beginRuntime(client, actorId, lockTimeout = null) {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE grainline_app_runtime");
  if (lockTimeout) await client.query(`SET LOCAL lock_timeout = '${lockTimeout}'`);
  await client.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, true)",
    [actorId ?? ""],
  );
}

async function insertListing(database, id, sellerProfileId, title) {
  await database.query(
    `INSERT INTO public."Listing"
       (id, "sellerId", title, description, "priceCents", currency, status,
        "listingType", "isPrivate", "sellerPubliclyOrderable", "createdAt", "updatedAt")
     VALUES (
       $1, $2, $3, 'Favorite full-chain fixture', 2500, 'usd',
       'ACTIVE'::public."ListingStatus", 'MADE_TO_ORDER'::public."ListingType",
       false, true, '2026-10-28 10:00:00', '2026-10-28 10:00:00'
     )`,
    [id, sellerProfileId, title],
  );
}

async function insertFavorite(database, userId, listingId, createdAt = "2026-10-28 10:05:00") {
  await database.query(
    `INSERT INTO public."Favorite" ("userId", "listingId", "createdAt")
     VALUES ($1, $2, $3)`,
    [userId, listingId, createdAt],
  );
}

export async function seedFavoritePredecessorFixture({ database, seller }) {
  const suffix = `favorite_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const fixture = {
    seller,
    buyerA: `${suffix}_buyer_a`,
    buyerB: `${suffix}_buyer_b`,
    activationBuyer: `${suffix}_activation_buyer`,
    buyerCascade: `${suffix}_buyer_cascade`,
    predecessorBuyer: `${suffix}_predecessor_buyer`,
    admin: `${suffix}_admin`,
    listings: Object.fromEntries([
      "backfill",
      "add",
      "predecessorCompatibility",
      "banRace",
      "blockCleanup",
      "sellerCleanup",
      "adminCleanup",
      "userCascade",
      "listingCascade",
      "addFirstRace",
      "blockFirstRace",
      "addFirstArchiveRace",
      "archiveFirstRace",
      "activation",
    ].map((key) => [key, `${suffix}_${key}`])),
    now: "2026-10-28 10:00:00",
  };

  const users = [
    [fixture.buyerA, "Favorite buyer A", "USER"],
    [fixture.buyerB, "Favorite buyer B", "USER"],
    [fixture.activationBuyer, "Favorite activation buyer", "USER"],
    [fixture.buyerCascade, "Favorite cascade buyer", "USER"],
    [fixture.predecessorBuyer, "Favorite predecessor buyer", "USER"],
    [fixture.admin, "Favorite admin", "ADMIN"],
  ];
  for (const [id, name, role] of users) {
    await database.query(
      `INSERT INTO public."User"
         (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5::public."Role", false, $6, $6)`,
      [id, `clerk_${id}`, `${id}@example.test`, name, role, fixture.now],
    );
  }

  for (const [key, listingId] of Object.entries(fixture.listings)) {
    await insertListing(database, listingId, seller.sellerProfileId, `Favorite ${key}`);
  }
  await insertFavorite(database, fixture.buyerA, fixture.listings.backfill);

  // Reproduce the predecessor route's check-then-write gap: the target is
  // readable, a block commits, and the later direct insert still succeeds.
  const target = rowsOf(await runtimeQuery(
    database,
    fixture.predecessorBuyer,
    "SELECT * FROM public.grainline_seller_public_favorite_target($1)",
    [fixture.listings.backfill],
  ));
  assert.equal(target.length, 1);
  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [`${suffix}_predecessor_block`, fixture.predecessorBuyer, seller.userId, fixture.now],
  );
  await insertFavorite(database, fixture.predecessorBuyer, fixture.listings.backfill);

  return Object.freeze(fixture);
}

export async function proveFavoritePredecessorGap({ database, fixture }) {
  const count = Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."Favorite"
      WHERE "userId" = $1 AND "listingId" = $2`,
    [fixture.predecessorBuyer, fixture.listings.backfill],
  ))[0]?.count ?? -1);
  assert.equal(count, 1);
  return Object.freeze({ blockedFavoriteInserted: true });
}

async function callAdd(database, actorId, listingId) {
  return rowsOf(await runtimeQuery(
    database,
    actorId,
    "SELECT * FROM public.grainline_favorite_owner_add($1)",
    [listingId],
  ));
}

async function projectedCount(database, listingId) {
  return Number(rowsOf(await database.query(
    `SELECT "favoriteCount" AS value FROM public."Listing" WHERE id = $1`,
    [listingId],
  ))[0]?.value ?? -1);
}

async function provePredecessorDirectCompatibility({ database, fixture }) {
  const insert = `
    INSERT INTO public."Favorite" ("userId", "listingId", "createdAt")
    VALUES ($1, $2, pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
    ON CONFLICT ("userId", "listingId") DO NOTHING
  `;
  await runtimeQuery(
    database,
    fixture.buyerA,
    insert,
    [fixture.buyerA, fixture.listings.predecessorCompatibility],
  );
  await runtimeQuery(
    database,
    fixture.buyerA,
    insert,
    [fixture.buyerA, fixture.listings.predecessorCompatibility],
  );
  assert.equal(await projectedCount(database, fixture.listings.predecessorCompatibility), 1);
  await runtimeQuery(
    database,
    fixture.buyerA,
    `DELETE FROM public."Favorite"
      WHERE "userId" = $1 AND "listingId" = $2`,
    [fixture.buyerA, fixture.listings.predecessorCompatibility],
  );
  assert.equal(await projectedCount(database, fixture.listings.predecessorCompatibility), 0);
}

async function proveAddBanRace({ connectionString, database, fixture }) {
  const addClient = new pg.Client({ connectionString });
  const banClient = new pg.Client({ connectionString });
  await Promise.all([addClient.connect(), banClient.connect()]);
  try {
    await banClient.query("BEGIN");
    await banClient.query(
      'UPDATE public."User" SET banned = true WHERE id = $1',
      [fixture.buyerB],
    );

    await beginRuntime(addClient, fixture.buyerB, "2s");
    const rejectedAdd = assert.rejects(
      addClient.query(
        "SELECT * FROM public.grainline_favorite_owner_add($1)",
        [fixture.listings.banRace],
      ),
      (error) => error?.code === "42501",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    await banClient.query("COMMIT");
    await rejectedAdd;
    await addClient.query("ROLLBACK");

    assert.equal(await projectedCount(database, fixture.listings.banRace), 0);
    await database.query(
      'UPDATE public."User" SET banned = false WHERE id = $1',
      [fixture.buyerB],
    );
  } finally {
    await addClient.query("ROLLBACK").catch(() => {});
    await banClient.query("ROLLBACK").catch(() => {});
    await Promise.all([addClient.end(), banClient.end()]);
  }
}

async function proveAddBlockRaces({ connectionString, database, fixture }) {
  const first = new pg.Client({ connectionString });
  const second = new pg.Client({ connectionString });
  await Promise.all([first.connect(), second.connect()]);
  try {
    await beginRuntime(first, fixture.buyerA);
    assert.deepEqual(
      (await first.query(
        "SELECT * FROM public.grainline_favorite_owner_add($1)",
        [fixture.listings.addFirstRace],
      )).rows,
      [{
        resultStatus: "OK",
        title: "Favorite addFirstRace",
        ownerUserId: fixture.seller.userId,
        created: true,
      }],
    );

    await beginRuntime(second, fixture.seller.userId, "250ms");
    await assert.rejects(
      second.query(
        "SELECT * FROM public.grainline_user_block_pair_lock($1)",
        [fixture.buyerA],
      ),
      (error) => error?.code === "55P03",
    );
    await second.query("ROLLBACK");
    await first.query("COMMIT");

    await beginRuntime(second, fixture.seller.userId);
    await second.query(
      "SELECT * FROM public.grainline_user_block_pair_lock($1)",
      [fixture.buyerA],
    );
    await second.query(
      `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
       VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
      [`${fixture.listings.addFirstRace}_block`, fixture.seller.userId, fixture.buyerA],
    );
    await second.query("COMMIT");
    assert.equal(await projectedCount(database, fixture.listings.addFirstRace), 1);

    await beginRuntime(second, fixture.seller.userId);
    await second.query(
      "SELECT * FROM public.grainline_user_block_pair_lock($1)",
      [fixture.buyerB],
    );
    await second.query(
      `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
       VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
      [`${fixture.listings.blockFirstRace}_block`, fixture.seller.userId, fixture.buyerB],
    );

    await beginRuntime(first, fixture.buyerB, "250ms");
    await assert.rejects(
      first.query(
        "SELECT * FROM public.grainline_favorite_owner_add($1)",
        [fixture.listings.blockFirstRace],
      ),
      (error) => error?.code === "55P03",
    );
    await first.query("ROLLBACK");
    await second.query("COMMIT");
    assert.deepEqual(
      await callAdd(database, fixture.buyerB, fixture.listings.blockFirstRace),
      [{ resultStatus: "BLOCKED", title: null, ownerUserId: null, created: false }],
    );
  } finally {
    await first.query("ROLLBACK").catch(() => {});
    await second.query("ROLLBACK").catch(() => {});
    await Promise.all([first.end(), second.end()]);
  }
}

async function proveAddArchiveRaces({ connectionString, database, fixture }) {
  const first = new pg.Client({ connectionString });
  const second = new pg.Client({ connectionString });
  await Promise.all([first.connect(), second.connect()]);
  try {
    await beginRuntime(first, fixture.buyerCascade);
    await first.query(
      "SELECT * FROM public.grainline_favorite_owner_add($1)",
      [fixture.listings.addFirstArchiveRace],
    );
    await second.query("BEGIN");
    await second.query("SET LOCAL lock_timeout = '250ms'");
    await assert.rejects(
      second.query(
        `UPDATE public."Listing"
            SET status = 'HIDDEN'::public."ListingStatus", "isPrivate" = true
          WHERE id = $1`,
        [fixture.listings.addFirstArchiveRace],
      ),
      (error) => error?.code === "55P03",
    );
    await second.query("ROLLBACK");
    await first.query("COMMIT");
    await database.query(
      `UPDATE public."Listing"
          SET status = 'HIDDEN'::public."ListingStatus", "isPrivate" = true
        WHERE id = $1`,
      [fixture.listings.addFirstArchiveRace],
    );
    await runtimeQuery(
      database,
      fixture.seller.userId,
      "SELECT public.grainline_favorite_seller_listing_cleanup($1)",
      [fixture.listings.addFirstArchiveRace],
    );
    assert.equal(await projectedCount(database, fixture.listings.addFirstArchiveRace), 0);

    await second.query("BEGIN");
    await second.query(
      `UPDATE public."Listing"
          SET status = 'HIDDEN'::public."ListingStatus", "isPrivate" = true
        WHERE id = $1`,
      [fixture.listings.archiveFirstRace],
    );
    await beginRuntime(first, fixture.buyerCascade, "250ms");
    await assert.rejects(
      first.query(
        "SELECT * FROM public.grainline_favorite_owner_add($1)",
        [fixture.listings.archiveFirstRace],
      ),
      (error) => error?.code === "55P03",
    );
    await first.query("ROLLBACK");
    await second.query("COMMIT");
    assert.deepEqual(
      await callAdd(database, fixture.buyerCascade, fixture.listings.archiveFirstRace),
      [{ resultStatus: "NOT_FOUND", title: null, ownerUserId: null, created: false }],
    );
  } finally {
    await first.query("ROLLBACK").catch(() => {});
    await second.query("ROLLBACK").catch(() => {});
    await Promise.all([first.end(), second.end()]);
  }
}

export async function proveFavoritePreparedAuthorities({
  database,
  connectionString,
  fixture,
}) {
  assert.equal(await projectedCount(database, fixture.listings.backfill), 2);
  await provePredecessorDirectCompatibility({ database, fixture });
  await proveAddBanRace({ connectionString, database, fixture });
  assert.deepEqual(
    await callAdd(database, fixture.buyerB, fixture.listings.add),
    [{
      resultStatus: "OK",
      title: "Favorite add",
      ownerUserId: fixture.seller.userId,
      created: true,
    }],
  );
  assert.equal(await projectedCount(database, fixture.listings.add), 1);
  assert.equal((await callAdd(database, fixture.buyerB, fixture.listings.add))[0]?.created, false);
  assert.equal(await projectedCount(database, fixture.listings.add), 1);

  await assert.rejects(
    runtimeQuery(
      database,
      fixture.buyerB,
      `UPDATE public."Listing"
          SET "favoriteCount" = 999
        WHERE id = $1`,
      [fixture.listings.add],
    ),
    (error) => error?.code === "42501",
  );
  assert.equal(await projectedCount(database, fixture.listings.add), 1);
  await runtimeQuery(
    database,
    fixture.buyerB,
    `UPDATE public."Listing" SET "updatedAt" = "updatedAt" WHERE id = $1`,
    [fixture.listings.add],
  );

  await assert.rejects(
    runtimeQuery(
      database,
      null,
      "SELECT * FROM public.grainline_favorite_owner_listing_ids($1::text[])",
      [[fixture.listings.add]],
    ),
    (error) => error?.code === "22023",
  );

  assert.deepEqual(
    rowsOf(await runtimeQuery(
      database,
      fixture.buyerB,
      "SELECT * FROM public.grainline_favorite_owner_listing_ids($1::text[])",
      [[fixture.listings.add, fixture.listings.backfill]],
    )),
    [{ listingId: fixture.listings.add }],
  );
  assert.deepEqual(
    rowsOf(await runtimeQuery(
      database,
      fixture.buyerA,
      "SELECT * FROM public.grainline_favorite_owner_listing_ids($1::text[])",
      [[fixture.listings.add]],
    )),
    [],
  );
  const crossUserRemove = rowsOf(await runtimeQuery(
    database,
    fixture.buyerA,
    "SELECT public.grainline_favorite_owner_remove($1) AS value",
    [fixture.listings.add],
  ));
  assert.equal(Number(crossUserRemove[0]?.value ?? -1), 0);
  assert.equal(await projectedCount(database, fixture.listings.add), 1);
  assert.deepEqual(
    await callAdd(database, fixture.seller.userId, fixture.listings.add),
    [{ resultStatus: "SELF", title: null, ownerUserId: null, created: false }],
  );
  assert.deepEqual(
    await callAdd(database, fixture.predecessorBuyer, fixture.listings.add),
    [{ resultStatus: "BLOCKED", title: null, ownerUserId: null, created: false }],
  );

  await assert.rejects(
    database.query(
      `UPDATE public."Favorite" SET "createdAt" = pg_catalog.clock_timestamp()
        WHERE "userId" = $1 AND "listingId" = $2`,
      [fixture.buyerB, fixture.listings.add],
    ),
    (error) => error?.code === "42501",
  );

  const exportRows = rowsOf(await runtimeQuery(
    database,
    fixture.buyerB,
    "SELECT * FROM public.grainline_favorite_owner_export()",
  ));
  assert.equal(exportRows.some((row) => row.listingId === fixture.listings.add), true);
  assert.equal(
    Number(rowsOf(await runtimeQuery(
      database,
      fixture.seller.userId,
      `SELECT public.grainline_favorite_seller_range_count(
         '2026-10-28 00:00:00',
         (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') + INTERVAL '1 day',
         true
       ) AS value`,
    ))[0]?.value ?? -1) >= 3,
    true,
  );

  const removed = rowsOf(await runtimeQuery(
    database,
    fixture.buyerB,
    "SELECT public.grainline_favorite_owner_remove($1) AS value",
    [fixture.listings.add],
  ));
  assert.equal(Number(removed[0]?.value ?? -1), 1);
  assert.equal(await projectedCount(database, fixture.listings.add), 0);

  await insertFavorite(database, fixture.buyerB, fixture.listings.sellerCleanup);
  await assert.rejects(
    runtimeQuery(
      database,
      fixture.buyerA,
      "SELECT public.grainline_favorite_seller_listing_cleanup($1)",
      [fixture.listings.sellerCleanup],
    ),
    (error) => error?.code === "42501",
  );
  await runtimeQuery(
    database,
    fixture.seller.userId,
    "SELECT public.grainline_favorite_seller_listing_cleanup($1)",
    [fixture.listings.sellerCleanup],
  );
  assert.equal(await projectedCount(database, fixture.listings.sellerCleanup), 0);

  await insertFavorite(database, fixture.buyerB, fixture.listings.adminCleanup);
  await assert.rejects(
    runtimeQuery(
      database,
      fixture.buyerA,
      "SELECT public.grainline_favorite_admin_listing_cleanup($1)",
      [fixture.listings.adminCleanup],
    ),
    (error) => error?.code === "42501",
  );
  await runtimeQuery(
    database,
    fixture.admin,
    "SELECT public.grainline_favorite_admin_listing_cleanup($1)",
    [fixture.listings.adminCleanup],
  );
  assert.equal(await projectedCount(database, fixture.listings.adminCleanup), 0);

  await insertFavorite(database, fixture.buyerB, fixture.listings.blockCleanup);
  const deletedAll = rowsOf(await runtimeQuery(
    database,
    fixture.buyerB,
    "SELECT public.grainline_favorite_owner_delete_all($1) AS value",
    [fixture.buyerB],
  ));
  assert.equal(Number(deletedAll[0]?.value ?? -1), 1);
  assert.equal(await projectedCount(database, fixture.listings.blockCleanup), 0);
  await assert.rejects(
    runtimeQuery(
      database,
      fixture.buyerB,
      "SELECT public.grainline_favorite_owner_delete_all($1)",
      [fixture.buyerA],
    ),
    (error) => error?.code === "42501",
  );

  await insertFavorite(database, fixture.buyerB, fixture.listings.listingCascade);
  await database.query('DELETE FROM public."Listing" WHERE id = $1', [fixture.listings.listingCascade]);
  assert.equal(rowsOf(await database.query(
    'SELECT 1 FROM public."Favorite" WHERE "listingId" = $1',
    [fixture.listings.listingCascade],
  )).length, 0);

  await proveAddBlockRaces({ connectionString, database, fixture });
  await proveAddArchiveRaces({ connectionString, database, fixture });

  await insertFavorite(database, fixture.buyerCascade, fixture.listings.userCascade);
  await database.query('DELETE FROM public."User" WHERE id = $1', [fixture.buyerCascade]);
  assert.equal(await projectedCount(database, fixture.listings.userCascade), 0);

  const drift = Number(rowsOf(await database.query(`
    SELECT pg_catalog.count(*)::integer AS count
      FROM public."Listing" AS listing
      LEFT JOIN LATERAL (
        SELECT pg_catalog.count(*)::integer AS value
          FROM public."Favorite" AS favorite
         WHERE favorite."listingId" = listing.id
      ) AS actual ON true
     WHERE listing."favoriteCount" <> actual.value
  `))[0]?.count ?? -1);
  assert.equal(drift, 0);
}

export async function proveFavoriteRlsAuthorities({ database, fixture }) {
  const posture = rowsOf(await database.query(`
    SELECT class.relrowsecurity AS rls_enabled,
           class.relforcerowsecurity AS rls_forced,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'SELECT'
           ) AS runtime_select,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'INSERT'
           ) AS runtime_insert,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'UPDATE'
           ) AS runtime_update,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'DELETE'
           ) AS runtime_delete,
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = class.oid) AS policy_count
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'Favorite'
       AND class.relkind = 'r'
  `))[0];
  assert.deepEqual(posture, {
    rls_enabled: true,
    rls_forced: true,
    runtime_select: true,
    runtime_insert: false,
    runtime_update: false,
    runtime_delete: true,
    policy_count: 2,
  });

  assert.deepEqual(
    await callAdd(database, fixture.activationBuyer, fixture.listings.activation),
    [{
      resultStatus: "OK",
      title: "Favorite activation",
      ownerUserId: fixture.seller.userId,
      created: true,
    }],
    "fixed add must remain usable without direct INSERT",
  );
  assert.equal(await projectedCount(database, fixture.listings.activation), 1);

  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.activationBuyer,
    `SELECT "userId", "listingId"
       FROM public."Favorite"
      WHERE "listingId" = $1`,
    [fixture.listings.activation],
  )), [{
    userId: fixture.activationBuyer,
    listingId: fixture.listings.activation,
  }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.buyerB,
    `SELECT "userId", "listingId"
       FROM public."Favorite"
      WHERE "listingId" = $1`,
    [fixture.listings.activation],
  )), [], "another user must not read the owner's row");
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    null,
    `SELECT "userId", "listingId"
       FROM public."Favorite"
      WHERE "listingId" = $1`,
    [fixture.listings.activation],
  )), [], "a missing actor context must reveal no rows");

  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.buyerB,
    `DELETE FROM public."Favorite"
      WHERE "listingId" = $1
      RETURNING "userId"`,
    [fixture.listings.activation],
  )), [], "another user must not delete the owner's row");
  await assert.rejects(
    runtimeQuery(
      database,
      fixture.buyerB,
      `INSERT INTO public."Favorite" ("userId", "listingId", "createdAt")
       VALUES ($1, $2, pg_catalog.clock_timestamp())`,
      [fixture.buyerB, fixture.listings.activation],
    ),
    (error) => error?.code === "42501",
    "runtime must not bypass the fixed add authority with direct INSERT",
  );
  await assert.rejects(
    runtimeQuery(
      database,
      fixture.activationBuyer,
      `UPDATE public."Favorite"
          SET "createdAt" = pg_catalog.clock_timestamp()
        WHERE "listingId" = $1`,
      [fixture.listings.activation],
    ),
    (error) => error?.code === "42501",
    "Favorite has no direct UPDATE contract",
  );

  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.activationBuyer,
    `DELETE FROM public."Favorite"
      WHERE "listingId" = $1
      RETURNING "userId"`,
    [fixture.listings.activation],
  )), [{ userId: fixture.activationBuyer }]);
  assert.equal(await projectedCount(database, fixture.listings.activation), 0);

  const cascadeUser = `${fixture.listings.activation}_cascade_user`;
  const cascadeListing = `${fixture.listings.activation}_cascade_listing`;
  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'Favorite cascade user', 'USER', false, $4, $4)`,
    [
      cascadeUser,
      `clerk_${cascadeUser}`,
      `${cascadeUser}@example.test`,
      fixture.now,
    ],
  );
  await insertListing(
    database,
    cascadeListing,
    fixture.seller.sellerProfileId,
    "Favorite activation cascade",
  );
  await insertFavorite(database, cascadeUser, fixture.listings.activation);
  await insertFavorite(database, fixture.activationBuyer, cascadeListing);
  assert.equal(await projectedCount(database, fixture.listings.activation), 1);
  assert.equal(await projectedCount(database, cascadeListing), 1);
  await database.query(`DELETE FROM public."User" WHERE id = $1`, [cascadeUser]);
  assert.equal(await projectedCount(database, fixture.listings.activation), 0);
  await database.query(`DELETE FROM public."Listing" WHERE id = $1`, [cascadeListing]);
  assert.equal(rowsOf(await database.query(
    `SELECT 1 FROM public."Favorite" WHERE "listingId" = $1`,
    [cascadeListing],
  )).length, 0, "Listing deletion must cascade under FORCE");
}

export async function proveFavoriteRlsRollback({ database, fixture }) {
  const posture = rowsOf(await database.query(`
    SELECT class.relrowsecurity AS rls_enabled,
           class.relforcerowsecurity AS rls_forced,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'SELECT'
           ) AS runtime_select,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'INSERT'
           ) AS runtime_insert,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'UPDATE'
           ) AS runtime_update,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'DELETE'
           ) AS runtime_delete,
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = class.oid) AS policy_count
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'Favorite'
       AND class.relkind = 'r'
  `))[0];
  assert.deepEqual(posture, {
    rls_enabled: false,
    rls_forced: false,
    runtime_select: true,
    runtime_insert: true,
    runtime_update: true,
    runtime_delete: true,
    policy_count: 0,
  });

  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.buyerB,
    `INSERT INTO public."Favorite" ("userId", "listingId", "createdAt")
     VALUES ($1, $2, pg_catalog.clock_timestamp())
     RETURNING "userId", "listingId"`,
    [fixture.activationBuyer, fixture.listings.activation],
  )), [{
    userId: fixture.activationBuyer,
    listingId: fixture.listings.activation,
  }]);
  assert.equal(await projectedCount(database, fixture.listings.activation), 1);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.buyerB,
    `SELECT "userId", "listingId"
       FROM public."Favorite"
      WHERE "listingId" = $1`,
    [fixture.listings.activation],
  )), [{
    userId: fixture.activationBuyer,
    listingId: fixture.listings.activation,
  }], "rollback must restore the prepared predecessor read posture");
  await assert.rejects(
    runtimeQuery(
      database,
      fixture.buyerB,
      `UPDATE public."Favorite"
          SET "createdAt" = pg_catalog.clock_timestamp()
        WHERE "listingId" = $1`,
      [fixture.listings.activation],
    ),
    (error) => error?.code === "42501",
    "the preparation's immutable-row trigger must survive rollback",
  );
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.buyerB,
    `DELETE FROM public."Favorite"
      WHERE "listingId" = $1
      RETURNING "userId"`,
    [fixture.listings.activation],
  )), [{ userId: fixture.activationBuyer }]);
  assert.equal(await projectedCount(database, fixture.listings.activation), 0);
}
