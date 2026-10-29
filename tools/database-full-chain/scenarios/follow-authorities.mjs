import assert from "node:assert/strict";

import pg from "pg";

export const FOLLOW_PREPARATION_MIGRATION =
  "20261028020000_prepare_follow_authorities";
export const FOLLOW_RLS_MIGRATION =
  "20261028060000_activate_follow_rls";

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

async function insertFollow(database, id, followerId, sellerProfileId, createdAt) {
  await database.query(
    `INSERT INTO public."Follow"
       (id, "followerId", "sellerProfileId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [id, followerId, sellerProfileId, createdAt],
  );
}

export async function seedFollowPredecessorFixture({ database }) {
  const suffix = `follow_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const fixture = Object.freeze({
    followerA: `${suffix}_follower_a`,
    followerB: `${suffix}_follower_b`,
    directBuyer: `${suffix}_direct_buyer`,
    unrelated: `${suffix}_unrelated`,
    deletingSellerUser: `${suffix}_deleting_seller_user`,
    deletingSellerProfile: `${suffix}_deleting_seller_profile`,
    otherSellerUser: `${suffix}_seller_user`,
    otherSellerProfile: `${suffix}_seller_profile`,
    listingSource: `${suffix}_listing_source`,
    blogSource: `${suffix}_blog_source`,
    draftBlogSource: `${suffix}_draft_blog_source`,
    followADeleting: `${suffix}_a_deleting`,
    followBDeleting: `${suffix}_b_deleting`,
    raceFollowerA: `${suffix}_race_follower_a`,
    raceFollowerB: `${suffix}_race_follower_b`,
    sideEffectId: `${suffix}_side_effect`,
    claimToken: "00000000-0000-4000-8000-000000000128",
    now: "2026-10-28 12:00:00",
  });

  for (const [id, name] of [
    [fixture.followerA, "Follow buyer A"],
    [fixture.followerB, "Follow buyer B"],
    [fixture.directBuyer, "Follow direct buyer"],
    [fixture.unrelated, "Follow unrelated buyer"],
    [fixture.deletingSellerUser, "Follow deleting seller"],
    [fixture.otherSellerUser, "Follow other seller"],
    [fixture.raceFollowerA, "Follow race buyer A"],
    [fixture.raceFollowerB, "Follow race buyer B"],
  ]) {
    await database.query(
      `INSERT INTO public."User"
         (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'USER'::public."Role", false, $5, $5)`,
      [id, `clerk_${id}`, `${id}@example.test`, name, fixture.now],
    );
  }

  for (const [sellerProfileId, userId, displayName, normalizedName] of [
    [
      fixture.deletingSellerProfile,
      fixture.deletingSellerUser,
      "Follow Deleting Maker",
      "follow deleting maker",
    ],
    [
      fixture.otherSellerProfile,
      fixture.otherSellerUser,
      "Follow Other Maker",
      "follow other maker",
    ],
  ]) {
    await database.query(
      `INSERT INTO public."SellerProfile"
       (id, "userId", "ownerAccountActive", "ownerImageUrl", "displayName",
        "displayNameNormalized", "createdAt", "updatedAt", "chargesEnabled",
        "stripeAccountSupported")
       VALUES ($1, $2, true, NULL, $3, $4, $5, $5, true, true)`,
      [sellerProfileId, userId, displayName, normalizedName, fixture.now],
    );
  }

  await database.query(
    `INSERT INTO public."Listing"
       (id, "sellerId", title, description, "priceCents", currency, status,
        "listingType", "isPrivate", "sellerPubliclyOrderable", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Follow fanout listing', 'Exact-source fanout proof',
             2500, 'usd', 'ACTIVE'::public."ListingStatus",
             'MADE_TO_ORDER'::public."ListingType", false, true, $3, $3)`,
    [fixture.listingSource, fixture.deletingSellerProfile, fixture.now],
  );
  await database.query(
    `INSERT INTO public."BlogPost"
       (id, slug, title, body, "authorId", "authorType", "sellerProfileId", status,
        "authorAccountActive", "publishedAt", "createdAt", "updatedAt")
     VALUES
       ($1, $2, 'Follow fanout post', 'Published exact-source fanout proof',
        $3, 'MAKER', $4, 'PUBLISHED', true, $5, $5, $5),
       ($6, $7, 'Draft follow fanout post', 'Non-public source proof',
        $3, 'MAKER', $4, 'DRAFT', true, NULL, $5, $5)`,
    [
      fixture.blogSource,
      `${suffix}-follow-fanout-published`.slice(0, 255),
      fixture.deletingSellerUser,
      fixture.deletingSellerProfile,
      fixture.now,
      fixture.draftBlogSource,
      `${suffix}-follow-fanout-draft`.slice(0, 255),
    ],
  );

  await insertFollow(
    database,
    `${suffix}_a_other`,
    fixture.followerA,
    fixture.otherSellerProfile,
    "2026-10-28 12:01:00",
  );
  await insertFollow(
    database,
    fixture.followADeleting,
    fixture.followerA,
    fixture.deletingSellerProfile,
    "2026-10-28 12:02:00",
  );
  await insertFollow(
    database,
    fixture.followBDeleting,
    fixture.followerB,
    fixture.deletingSellerProfile,
    "2026-10-28 12:03:00",
  );
  await insertFollow(
    database,
    `${suffix}_seller_outgoing`,
    fixture.deletingSellerUser,
    fixture.otherSellerProfile,
    "2026-10-28 12:04:00",
  );
  await insertFollow(
    database,
    `${suffix}_unrelated_other`,
    fixture.unrelated,
    fixture.otherSellerProfile,
    "2026-10-28 12:05:00",
  );

  // The predecessor app can still insert and inspect relationship rows
  // directly. Compatible preparation must not break that deployed version.
  await runtimeQuery(
    database,
    fixture.directBuyer,
    `INSERT INTO public."Follow"
       (id, "followerId", "sellerProfileId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [
      `${suffix}_direct_deleting`,
      fixture.directBuyer,
      fixture.deletingSellerProfile,
      fixture.now,
    ],
  );

  return fixture;
}

export async function proveFollowPredecessorCompatibility({ database, fixture }) {
  const rows = rowsOf(await runtimeQuery(
    database,
    fixture.directBuyer,
    `SELECT id FROM public."Follow"
      WHERE "followerId" = $1 AND "sellerProfileId" = $2`,
    [fixture.directBuyer, fixture.deletingSellerProfile],
  ));
  assert.equal(rows.length, 1);
  return Object.freeze({ directRelationshipVisible: true });
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

async function proveFollowBlockSerialization({ connectionString, database, fixture }) {
  const followFirst = new pg.Client({ connectionString });
  const blockFirst = new pg.Client({ connectionString });
  await Promise.all([followFirst.connect(), blockFirst.connect()]);
  try {
    // Follow wins the pair lock first. Block must wait, then its in-transaction
    // cleanup removes the committed relationship before the Block commits.
    await beginRuntime(followFirst, fixture.raceFollowerA);
    const created = (await followFirst.query(
      "SELECT * FROM public.grainline_seller_public_follow_create($1,$2)",
      [fixture.otherSellerProfile, `${fixture.sideEffectId}_race_follow_first`],
    )).rows;
    assert.equal(created[0]?.resultStatus, "OK");
    assert.equal(created[0]?.created, true);

    await beginRuntime(blockFirst, fixture.otherSellerUser, "250ms");
    await assert.rejects(
      blockFirst.query(
        "SELECT * FROM public.grainline_user_block_pair_lock($1)",
        [fixture.raceFollowerA],
      ),
      (error) => error?.code === "55P03",
      "block creation must wait behind a concurrent follow decision",
    );
    await blockFirst.query("ROLLBACK");
    await followFirst.query("COMMIT");

    await beginRuntime(blockFirst, fixture.otherSellerUser);
    await blockFirst.query(
      "SELECT * FROM public.grainline_user_block_pair_lock($1)",
      [fixture.raceFollowerA],
    );
    await blockFirst.query(
      `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
       VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
      [`${fixture.sideEffectId}_race_follow_first_block`, fixture.otherSellerUser, fixture.raceFollowerA],
    );
    await blockFirst.query(
      "SELECT public.grainline_user_block_follow_cleanup($1)",
      [fixture.raceFollowerA],
    );
    await blockFirst.query("COMMIT");
    assert.equal(Number(rowsOf(await database.query(
      `SELECT pg_catalog.count(*)::integer AS count
         FROM public."Follow"
        WHERE "followerId" = $1 AND "sellerProfileId" = $2`,
      [fixture.raceFollowerA, fixture.otherSellerProfile],
    ))[0]?.count ?? -1), 0);

    // Block wins first. Follow must wait on the same pair lock and, after the
    // Block commits, the next attempt observes BLOCKED instead of inserting.
    await beginRuntime(blockFirst, fixture.otherSellerUser);
    await blockFirst.query(
      "SELECT * FROM public.grainline_user_block_pair_lock($1)",
      [fixture.raceFollowerB],
    );
    await blockFirst.query(
      `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
       VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
      [`${fixture.sideEffectId}_race_block_first`, fixture.otherSellerUser, fixture.raceFollowerB],
    );

    await beginRuntime(followFirst, fixture.raceFollowerB, "250ms");
    await assert.rejects(
      followFirst.query(
        "SELECT * FROM public.grainline_seller_public_follow_create($1,$2)",
        [fixture.otherSellerProfile, `${fixture.sideEffectId}_race_blocked_follow`],
      ),
      (error) => error?.code === "55P03",
      "follow creation must wait behind a concurrent block decision",
    );
    await followFirst.query("ROLLBACK");
    await blockFirst.query("COMMIT");
    const blocked = rowsOf(await runtimeQuery(
      database,
      fixture.raceFollowerB,
      "SELECT * FROM public.grainline_seller_public_follow_create($1,$2)",
      [fixture.otherSellerProfile, `${fixture.sideEffectId}_race_blocked_follow`],
    ));
    assert.equal(blocked[0]?.resultStatus, "BLOCKED");
    assert.equal(blocked[0]?.created, false);
  } finally {
    await followFirst.query("ROLLBACK").catch(() => {});
    await blockFirst.query("ROLLBACK").catch(() => {});
    await Promise.all([followFirst.end(), blockFirst.end()]);
  }
}

export async function proveFollowPreparedAuthorities({
  database,
  connectionString,
  fixture,
}) {
  // Preparation is backward compatible: predecessor direct DELETE remains
  // available until the separate activation release.
  await runtimeQuery(
    database,
    fixture.directBuyer,
    `DELETE FROM public."Follow"
      WHERE "followerId" = $1 AND "sellerProfileId" = $2`,
    [fixture.directBuyer, fixture.deletingSellerProfile],
  );
  assert.equal(rowsOf(await database.query(
    `SELECT 1 FROM public."Follow"
      WHERE "followerId" = $1 AND "sellerProfileId" = $2`,
    [fixture.directBuyer, fixture.deletingSellerProfile],
  )).length, 0);

  const listingRecipients = rowsOf(await runtimeQuery(
    database,
    null,
    `SELECT * FROM public.grainline_follow_source_notification_page(
       'followed_maker_new_listing', $1, NULL, 1000
     )`,
    [fixture.listingSource],
  ));
  assert.deepEqual(listingRecipients, [
    { followId: fixture.followADeleting, followerId: fixture.followerA },
    { followId: fixture.followBDeleting, followerId: fixture.followerB },
  ]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    null,
    `SELECT * FROM public.grainline_follow_source_notification_page(
       'followed_maker_new_blog', $1, NULL, 1000
     )`,
    [fixture.blogSource],
  )), listingRecipients);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    null,
    `SELECT * FROM public.grainline_follow_source_notification_page(
       'followed_maker_new_listing', $1, NULL, 1000
     )`,
    [fixture.deletingSellerProfile],
  )), []);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    null,
    `SELECT * FROM public.grainline_follow_source_notification_page(
       'followed_maker_new_blog', $1, NULL, 1000
     )`,
    [fixture.draftBlogSource],
  )), []);
  await assert.rejects(
    runtimeQuery(
      database,
      null,
      `SELECT * FROM public.grainline_follow_source_notification_page(
         'seller_profile', $1, NULL, 1000
       )`,
      [fixture.deletingSellerProfile],
    ),
    (error) => error?.code === "22023",
  );

  await assert.rejects(
    runtimeQuery(
      database,
      null,
      "SELECT * FROM public.grainline_follow_owner_target_ids(10)",
    ),
    (error) => error?.code === "22023",
  );
  await assert.rejects(
    runtimeQuery(
      database,
      fixture.followerA,
      "SELECT * FROM public.grainline_follow_owner_target_ids(1001)",
    ),
    (error) => error?.code === "22023",
  );

  assert.deepEqual(
    rowsOf(await runtimeQuery(
      database,
      fixture.followerA,
      "SELECT * FROM public.grainline_follow_owner_target_ids(1000)",
    )),
    [
      { sellerProfileId: fixture.deletingSellerProfile },
      { sellerProfileId: fixture.otherSellerProfile },
    ],
  );
  assert.deepEqual(
    rowsOf(await runtimeQuery(
      database,
      fixture.unrelated,
      "SELECT * FROM public.grainline_follow_owner_target_ids(1000)",
    )),
    [{ sellerProfileId: fixture.otherSellerProfile }],
  );
  await proveFollowBlockSerialization({ connectionString, database, fixture });
  const ownerOutgoingBeforeVisibilityChange = rowsOf(await runtimeQuery(
    database,
    fixture.followerA,
    "SELECT * FROM public.grainline_follow_owner_outgoing_count()",
  ));
  assert.equal(ownerOutgoingBeforeVisibilityChange.length, 1);
  assert.equal(Number(ownerOutgoingBeforeVisibilityChange[0].value), 2);

  // Public counts deliberately include a surviving banned follower while the
  // viewer-state boolean remains bound to an active transaction-local actor.
  await database.query(
    'UPDATE public."User" SET banned = true WHERE id = $1',
    [fixture.followerB],
  );
  const anonymousStates = rowsOf(await runtimeQuery(
    database,
    null,
    "SELECT * FROM public.grainline_follow_public_state_batch($1::text[])",
    [[fixture.deletingSellerProfile, fixture.otherSellerProfile]],
  ));
  assert.deepEqual(anonymousStates.map((row) => ({
    ...row,
    followerCount: Number(row.followerCount),
  })), [
    {
      sellerProfileId: fixture.deletingSellerProfile,
      followerCount: 2,
      following: false,
    },
    {
      sellerProfileId: fixture.otherSellerProfile,
      followerCount: 3,
      following: false,
    },
  ]);
  const actorStates = rowsOf(await runtimeQuery(
    database,
    fixture.followerA,
    "SELECT * FROM public.grainline_follow_public_state_batch($1::text[])",
    [[fixture.deletingSellerProfile, fixture.otherSellerProfile]],
  ));
  assert.deepEqual(actorStates.map((row) => row.following), [true, true]);

  await database.query(
    'UPDATE public."SellerProfile" SET "chargesEnabled" = false WHERE id = $1',
    [fixture.otherSellerProfile],
  );
  const ownerOutgoingAfterVisibilityChange = rowsOf(await runtimeQuery(
    database,
    fixture.followerA,
    "SELECT * FROM public.grainline_follow_owner_outgoing_count()",
  ));
  assert.equal(ownerOutgoingAfterVisibilityChange.length, 1);
  assert.equal(Number(ownerOutgoingAfterVisibilityChange[0].value), 2);
  assert.deepEqual(
    rowsOf(await runtimeQuery(
      database,
      fixture.followerA,
      "SELECT * FROM public.grainline_follow_public_state_batch($1::text[])",
      [[fixture.deletingSellerProfile, fixture.otherSellerProfile]],
    )).map((row) => row.sellerProfileId),
    [fixture.deletingSellerProfile],
  );
  await database.query(
    'UPDATE public."SellerProfile" SET "chargesEnabled" = true WHERE id = $1',
    [fixture.otherSellerProfile],
  );

  // Seller-owner aggregate remains available even when the shop is not public.
  await database.query(
    'UPDATE public."SellerProfile" SET "chargesEnabled" = false WHERE id = $1',
    [fixture.deletingSellerProfile],
  );
  const sellerIncoming = rowsOf(await runtimeQuery(
    database,
    fixture.deletingSellerUser,
    "SELECT * FROM public.grainline_follow_seller_owner_incoming_count()",
  ));
  assert.equal(sellerIncoming.length, 1);
  assert.equal(Number(sellerIncoming[0].value), 2);
  await database.query(
    'UPDATE public."SellerProfile" SET "chargesEnabled" = true WHERE id = $1',
    [fixture.deletingSellerProfile],
  );

  await database.query(
    `INSERT INTO public."AccountDeletionSideEffect"
       (id, "userId", kind, "dedupKey", payload, status, attempts,
        "claimGeneration", "claimToken", "processingStartedAt", "nextAttemptAt",
        "createdAt", "updatedAt")
     VALUES ($1, $2::varchar(191), 'LOCAL_ANONYMIZE',
             'account-delete:local:' || $2::text,
             '{}'::jsonb, 'PROCESSING', 1, 1, $3::uuid, $4, NULL, $4, $4)`,
    [
      fixture.sideEffectId,
      fixture.deletingSellerUser,
      fixture.claimToken,
      fixture.now,
    ],
  );
  await assert.rejects(
    runtimeQuery(
      database,
      fixture.deletingSellerUser,
      `SELECT public.grainline_follow_account_deletion_cleanup(
         $1, $2, 1, '00000000-0000-4000-8000-000000000129'::uuid
       )`,
      [fixture.sideEffectId, fixture.deletingSellerUser],
    ),
    (error) => error?.code === "42501",
  );
  await assert.rejects(
    runtimeQuery(
      database,
      fixture.followerA,
      "SELECT public.grainline_follow_account_deletion_cleanup($1,$2,1,$3::uuid)",
      [fixture.sideEffectId, fixture.deletingSellerUser, fixture.claimToken],
    ),
    (error) => error?.code === "42501",
  );
  const cleanup = rowsOf(await runtimeQuery(
    database,
    fixture.deletingSellerUser,
    "SELECT public.grainline_follow_account_deletion_cleanup($1,$2,1,$3::uuid) AS value",
    [fixture.sideEffectId, fixture.deletingSellerUser, fixture.claimToken],
  ));
  assert.equal(Number(cleanup[0]?.value ?? -1), 3);

  assert.equal(rowsOf(await database.query(
    `SELECT 1 FROM public."Follow"
      WHERE "followerId" = $1 OR "sellerProfileId" = $2`,
    [fixture.deletingSellerUser, fixture.deletingSellerProfile],
  )).length, 0);
  assert.equal(rowsOf(await database.query(
    `SELECT 1 FROM public."Follow"
      WHERE "followerId" = $1 AND "sellerProfileId" = $2`,
    [fixture.followerA, fixture.otherSellerProfile],
  )).length, 1);
  assert.equal(rowsOf(await database.query(
    `SELECT 1 FROM public."Follow"
      WHERE "followerId" = $1 AND "sellerProfileId" = $2`,
    [fixture.unrelated, fixture.otherSellerProfile],
  )).length, 1);
}

export async function proveFollowRlsAuthorities({ database, fixture }) {
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
       AND class.relname = 'Follow'
       AND class.relkind = 'r'
  `))[0];
  assert.deepEqual(posture, {
    rls_enabled: true,
    rls_forced: true,
    runtime_select: false,
    runtime_insert: false,
    runtime_update: false,
    runtime_delete: false,
    policy_count: 0,
  });

  for (const statement of [
    'SELECT 1 FROM public."Follow" LIMIT 1',
    `INSERT INTO public."Follow"
       (id, "followerId", "sellerProfileId", "createdAt")
     VALUES ('follow_direct_denied', '${fixture.directBuyer}',
             '${fixture.otherSellerProfile}', pg_catalog.clock_timestamp())`,
    `UPDATE public."Follow" SET "createdAt" = pg_catalog.clock_timestamp()
      WHERE "followerId" = '${fixture.followerA}'`,
    `DELETE FROM public."Follow"
      WHERE "followerId" = '${fixture.followerA}'`,
  ]) {
    await assert.rejects(
      runtimeQuery(database, fixture.directBuyer, statement),
      (error) => error?.code === "42501",
      `runtime direct Follow statement must be denied: ${statement}`,
    );
  }

  const followId = `${fixture.sideEffectId}_activation_follow`;
  const created = rowsOf(await runtimeQuery(
    database,
    fixture.directBuyer,
    "SELECT * FROM public.grainline_seller_public_follow_create($1,$2)",
    [fixture.otherSellerProfile, followId],
  ));
  assert.equal(created.length, 1);
  assert.equal(created[0].resultStatus, "OK");
  assert.equal(created[0].ownerUserId, fixture.otherSellerUser);
  assert.equal(created[0].created, true);

  assert.deepEqual(
    rowsOf(await runtimeQuery(
      database,
      fixture.directBuyer,
      "SELECT * FROM public.grainline_follow_owner_target_ids(1000)",
    )),
    [{ sellerProfileId: fixture.otherSellerProfile }],
  );
  const publicState = rowsOf(await runtimeQuery(
    database,
    fixture.directBuyer,
    "SELECT * FROM public.grainline_follow_public_state_batch($1::text[])",
    [[fixture.otherSellerProfile]],
  ));
  assert.equal(publicState.length, 1);
  assert.equal(publicState[0].sellerProfileId, fixture.otherSellerProfile);
  assert.equal(publicState[0].following, true);
  assert.equal(Number(publicState[0].followerCount) >= 3, true);

  const replayedDeletionCleanup = rowsOf(await runtimeQuery(
    database,
    fixture.deletingSellerUser,
    "SELECT public.grainline_follow_account_deletion_cleanup($1,$2,1,$3::uuid) AS value",
    [fixture.sideEffectId, fixture.deletingSellerUser, fixture.claimToken],
  ));
  assert.equal(Number(replayedDeletionCleanup[0]?.value ?? -1), 0);

  const removed = rowsOf(await runtimeQuery(
    database,
    fixture.directBuyer,
    "SELECT * FROM public.grainline_seller_public_follow_delete($1)",
    [fixture.otherSellerProfile],
  ));
  assert.equal(removed.length, 1);
  assert.equal(removed[0].resultStatus, "OK");

  const cascadeFollower = `${fixture.sideEffectId}_cascade_follower`;
  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'Follow cascade follower', 'USER', false, $4, $4)`,
    [
      cascadeFollower,
      `clerk_${cascadeFollower}`,
      `${cascadeFollower}@example.test`,
      fixture.now,
    ],
  );
  await insertFollow(
    database,
    `${fixture.sideEffectId}_cascade_user_follow`,
    cascadeFollower,
    fixture.otherSellerProfile,
    fixture.now,
  );
  await database.query('DELETE FROM public."User" WHERE id = $1', [cascadeFollower]);
  assert.equal(rowsOf(await database.query(
    'SELECT 1 FROM public."Follow" WHERE "followerId" = $1',
    [cascadeFollower],
  )).length, 0, "User deletion must cascade Follow rows under FORCE");

  const cascadeSellerUser = `${fixture.sideEffectId}_cascade_seller_user`;
  const cascadeSellerProfile = `${fixture.sideEffectId}_cascade_seller_profile`;
  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'Follow cascade seller', 'USER', false, $4, $4)`,
    [
      cascadeSellerUser,
      `clerk_${cascadeSellerUser}`,
      `${cascadeSellerUser}@example.test`,
      fixture.now,
    ],
  );
  await database.query(
    `INSERT INTO public."SellerProfile"
       (id, "userId", "ownerAccountActive", "displayName",
        "displayNameNormalized", "createdAt", "updatedAt", "chargesEnabled",
        "stripeAccountSupported")
     VALUES ($1, $2, true, 'Follow cascade maker', 'follow cascade maker',
             $3, $3, true, true)`,
    [cascadeSellerProfile, cascadeSellerUser, fixture.now],
  );
  await insertFollow(
    database,
    `${fixture.sideEffectId}_cascade_seller_follow`,
    fixture.followerA,
    cascadeSellerProfile,
    fixture.now,
  );
  await database.query(
    'DELETE FROM public."SellerProfile" WHERE id = $1',
    [cascadeSellerProfile],
  );
  assert.equal(rowsOf(await database.query(
    'SELECT 1 FROM public."Follow" WHERE "sellerProfileId" = $1',
    [cascadeSellerProfile],
  )).length, 0, "SellerProfile deletion must cascade Follow rows under FORCE");
  await database.query('DELETE FROM public."User" WHERE id = $1', [cascadeSellerUser]);
}

export async function proveFollowRlsRollback({ database, fixture }) {
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
       AND class.relname = 'Follow'
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

  const rollbackId = `${fixture.sideEffectId}_rollback_direct`;
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.followerA,
    `INSERT INTO public."Follow"
       (id, "followerId", "sellerProfileId", "createdAt")
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [rollbackId, fixture.directBuyer, fixture.otherSellerProfile, fixture.now],
  )), [{ id: rollbackId }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.followerA,
    'SELECT id FROM public."Follow" WHERE id = $1',
    [rollbackId],
  )), [{ id: rollbackId }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.followerA,
    `UPDATE public."Follow"
        SET "createdAt" = '2026-10-28 13:00:00'
      WHERE id = $1 RETURNING id`,
    [rollbackId],
  )), [{ id: rollbackId }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.followerA,
    'DELETE FROM public."Follow" WHERE id = $1 RETURNING id',
    [rollbackId],
  )), [{ id: rollbackId }]);
}
