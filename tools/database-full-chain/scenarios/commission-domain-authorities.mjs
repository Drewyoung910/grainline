import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import pg from "pg";

const PREPARATION_FUNCTIONS = Object.freeze([
  "grainline_commission_account_deletion_prepare",
  "grainline_commission_account_deletion_redact",
  "grainline_commission_interest_actor_create",
  "grainline_commission_interest_actor_request_ids",
  "grainline_commission_interest_owner_export",
  "grainline_commission_request_actor_report_target",
  "grainline_commission_request_owner_active_count",
  "grainline_commission_request_owner_assign_metros",
  "grainline_commission_request_owner_create",
  "grainline_commission_request_owner_export",
  "grainline_commission_request_owner_page",
  "grainline_commission_request_owner_reference_image_urls",
  "grainline_commission_request_owner_transition",
  "grainline_commission_request_public_count",
  "grainline_commission_request_public_detail",
  "grainline_commission_request_public_metro_ids",
  "grainline_commission_request_public_page",
  "grainline_commission_request_public_sitemap_page",
  "grainline_commission_request_service_expire_batch",
  "grainline_commission_request_service_expired_count",
  "grainline_commission_request_staff_ban_close",
  "grainline_commission_request_staff_ban_restore",
  "grainline_seller_owner_commission_interest_summaries",
]);

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

async function createOwnerRequest(database, actorId, requestId, input = {}) {
  return rowsOf(await runtimeQuery(
    database,
    actorId,
    `SELECT *
       FROM public.grainline_commission_request_owner_create(
         $1, $2, $3, NULL, NULL, NULL, NULL, $8::text[],
         $4, $5, $6, $7
       )`,
    [
      requestId,
      input.title ?? `Commission ${requestId}`,
      input.description ?? "Full-chain commission authority proof",
      input.isNational ?? true,
      input.lat ?? null,
      input.lng ?? null,
      input.radiusMeters ?? null,
      input.referenceImageUrls ?? [],
    ],
  ));
}

async function createActorInterest(database, actorId, requestId) {
  return rowsOf(await runtimeQuery(
    database,
    actorId,
    `SELECT *
       FROM public.grainline_commission_interest_actor_create($1, $2, $3, $4)`,
    [randomUUID(), randomUUID(), randomUUID(), requestId],
  ));
}

function idSet(result) {
  return new Set(rowsOf(result).map((row) => row.id));
}

async function proveInterestTransitionSerialization({
  connectionString,
  database,
  buyerId,
  sellerUserId,
  interestFirstRequestId,
  transitionFirstRequestId,
}) {
  const interestClient = new pg.Client({ connectionString });
  const transitionClient = new pg.Client({ connectionString });
  await Promise.all([interestClient.connect(), transitionClient.connect()]);
  try {
    await beginRuntime(interestClient, sellerUserId);
    const interestFirst = await interestClient.query(
      `SELECT *
         FROM public.grainline_commission_interest_actor_create($1, $2, $3, $4)`,
      [randomUUID(), randomUUID(), randomUUID(), interestFirstRequestId],
    );
    assert.equal(interestFirst.rows[0]?.created, true);

    await beginRuntime(transitionClient, buyerId, "250ms");
    await assert.rejects(
      transitionClient.query(
        `SELECT *
           FROM public.grainline_commission_request_owner_transition($1, 'CLOSED')`,
        [interestFirstRequestId],
      ),
      (error) => error?.code === "55P03",
      "a status transition must wait for in-flight interest admission",
    );
    await transitionClient.query("ROLLBACK");
    await interestClient.query("COMMIT");

    const transitionedAfterInterest = rowsOf(await runtimeQuery(
      database,
      buyerId,
      `SELECT *
         FROM public.grainline_commission_request_owner_transition($1, 'CLOSED')`,
      [interestFirstRequestId],
    ));
    assert.deepEqual(transitionedAfterInterest.map((row) => ({
      outcome: row.outcome,
      sellerUserIds: row.sellerUserIds,
    })), [{ outcome: "transitioned", sellerUserIds: [sellerUserId] }]);

    await beginRuntime(transitionClient, buyerId);
    const transitionFirst = await transitionClient.query(
      `SELECT *
         FROM public.grainline_commission_request_owner_transition($1, 'CLOSED')`,
      [transitionFirstRequestId],
    );
    assert.equal(transitionFirst.rows[0]?.outcome, "transitioned");

    await beginRuntime(interestClient, sellerUserId, "250ms");
    await assert.rejects(
      interestClient.query(
        `SELECT *
           FROM public.grainline_commission_interest_actor_create($1, $2, $3, $4)`,
        [randomUUID(), randomUUID(), randomUUID(), transitionFirstRequestId],
      ),
      (error) => error?.code === "55P03",
      "interest admission must wait for an in-flight status transition",
    );
    await interestClient.query("ROLLBACK");
    await transitionClient.query("COMMIT");

    await assert.rejects(
      createActorInterest(database, sellerUserId, transitionFirstRequestId),
      (error) => error?.code === "42501" && /commission request is closed/u.test(error.message),
      "an interest serialized after closure must be refused",
    );
  } finally {
    await interestClient.query("ROLLBACK").catch(() => {});
    await transitionClient.query("ROLLBACK").catch(() => {});
    await Promise.all([interestClient.end(), transitionClient.end()]);
  }
}

export async function proveCommissionDomainPreparedAuthorities({
  database,
  seller,
  connectionString,
}) {
  const suffix = `commission_domain_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const now = "2026-11-01 12:00:00";
  const buyerId = `${suffix}_buyer`;
  const outsiderId = `${suffix}_outsider`;
  const adminId = `${suffix}_admin`;
  const restoringAdminId = `${suffix}_restoring_admin`;
  const metroId = `${suffix}_metro`;
  const uploadId = randomUUID();
  const uploadKey = `messageImage/${suffix}/commission.webp`;
  const uploadUrl = `https://commission-proof.invalid/${uploadKey}`;
  const requestIds = Object.freeze({
    open: `${suffix}_open`,
    terminal: `${suffix}_terminal`,
    expiring: `${suffix}_expiring`,
    rollback: `${suffix}_rollback`,
    ban: `${suffix}_ban`,
    interestFirstRace: `${suffix}_interest_first_race`,
    transitionFirstRace: `${suffix}_transition_first_race`,
  });

  assert.deepEqual(rowsOf(await database.query(
    `SELECT relation.relname,
            relation.relrowsecurity AS "rlsEnabled",
            relation.relforcerowsecurity AS "rlsForced",
            pg_catalog.has_table_privilege(
              'grainline_app_runtime', relation.oid, 'SELECT'
            ) AS "runtimeSelect",
            pg_catalog.has_table_privilege(
              'grainline_app_runtime', relation.oid, 'INSERT'
            ) AS "runtimeInsert",
            pg_catalog.has_table_privilege(
              'grainline_app_runtime', relation.oid, 'UPDATE'
            ) AS "runtimeUpdate",
            pg_catalog.has_table_privilege(
              'grainline_app_runtime', relation.oid, 'DELETE'
            ) AS "runtimeDelete"
       FROM pg_catalog.pg_class AS relation
      WHERE relation.oid IN (
        'public."CommissionRequest"'::pg_catalog.regclass,
        'public."CommissionInterest"'::pg_catalog.regclass
      )
      ORDER BY relation.relname`,
  )), [
    {
      relname: "CommissionInterest",
      rlsEnabled: false,
      rlsForced: false,
      runtimeSelect: true,
      runtimeInsert: true,
      runtimeUpdate: true,
      runtimeDelete: true,
    },
    {
      relname: "CommissionRequest",
      rlsEnabled: false,
      rlsForced: false,
      runtimeSelect: true,
      runtimeInsert: true,
      runtimeUpdate: true,
      runtimeDelete: true,
    },
  ], "preparation must preserve predecessor CRUD while RLS remains off");

  const functionRows = rowsOf(await database.query(
    `SELECT routine.proname AS name,
            routine.prosecdef AS "securityDefiner",
            routine.proconfig AS config,
            (owner_role.rolsuper OR owner_role.rolbypassrls) AS "ownerBypassesRls",
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
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = routine.pronamespace
       JOIN pg_catalog.pg_roles AS owner_role
         ON owner_role.oid = routine.proowner
      WHERE namespace.nspname = 'public'
        AND routine.proname = ANY($1::text[])
      ORDER BY routine.proname`,
    [PREPARATION_FUNCTIONS],
  ));
  assert.deepEqual(
    functionRows.map((row) => row.name),
    PREPARATION_FUNCTIONS,
    "every reviewed Commission authority must exist exactly once",
  );
  for (const row of functionRows) {
    assert.equal(row.securityDefiner, true, `${row.name} must be SECURITY DEFINER`);
    assert.deepEqual(row.config, ["search_path=pg_catalog"]);
    assert.equal(row.ownerBypassesRls, true, `${row.name} owner must bypass RLS`);
    assert.equal(row.runtimeExecute, true, `${row.name} must be runtime-callable`);
    assert.equal(row.publicExecute, false, `${row.name} must not be PUBLIC-callable`);
  }

  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt",
        "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES
       ($1, $2, $3, 'Commission buyer', 'USER', false, $10, $10, $10, '2026-01-01', $10),
       ($4, $5, $6, 'Commission outsider', 'USER', false, $10, $10, $10, '2026-01-01', $10),
       ($7, $8, $9, 'Commission admin', 'ADMIN', false, $10, $10, $10, '2026-01-01', $10)`,
    [
      buyerId,
      `clerk_${buyerId}`,
      `${buyerId}@example.test`,
      outsiderId,
      `clerk_${outsiderId}`,
      `${outsiderId}@example.test`,
      adminId,
      `clerk_${adminId}`,
      `${adminId}@example.test`,
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt",
        "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Commission restoring admin', 'ADMIN', false,
             $4, $4, $4, '2026-01-01', $4)`,
    [
      restoringAdminId,
      `clerk_${restoringAdminId}`,
      `${restoringAdminId}@example.test`,
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Metro"
       (id, slug, name, state, latitude, longitude, "radiusMiles", "isActive",
        "createdAt", "updatedAt")
     VALUES ($1, $2, 'Commission Proof Metro', 'TX', 30.2672, -97.7431,
             45, true, $3, $3)`,
    [metroId, `${suffix}-metro`, now],
  );
  await database.query(
    `INSERT INTO public."DirectUpload" (
       id, key, endpoint, "userId", "publicUrl", "storageClass",
       "contentType", "expectedSize", status, "verifiedAt", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, 'messageImage', $3, $4, 'PUBLIC',
       'image/webp', 1024, 'VERIFIED', $5, $5, $5
     )`,
    [uploadId, uploadKey, buyerId, uploadUrl, now],
  );

  await assert.rejects(
    createOwnerRequest(database, null, `${suffix}_missing_actor`),
    (error) => error?.code === "42501",
    "an unauthenticated caller must not create a CommissionRequest",
  );

  assert.equal((await createOwnerRequest(database, buyerId, requestIds.open, {
    isNational: false,
    lat: 30.2672,
    lng: -97.7431,
    radiusMeters: 5000,
    referenceImageUrls: [uploadUrl],
  })).length, 1);
  assert.equal((await createOwnerRequest(database, buyerId, requestIds.terminal)).length, 1);
  assert.equal((await createOwnerRequest(database, buyerId, requestIds.expiring)).length, 1);
  assert.equal((await createOwnerRequest(database, buyerId, requestIds.rollback)).length, 1);
  assert.equal((await createOwnerRequest(
    database,
    buyerId,
    requestIds.interestFirstRace,
  )).length, 1);
  assert.equal((await createOwnerRequest(
    database,
    buyerId,
    requestIds.transitionFirstRace,
  )).length, 1);
  assert.equal((await createOwnerRequest(database, outsiderId, requestIds.ban)).length, 1);
  await assert.rejects(
    createOwnerRequest(database, buyerId, `${suffix}_untracked_upload`, {
      referenceImageUrls: ["https://untracked.invalid/not-owned.webp"],
    }),
    (error) => error?.code === "23514",
    "request creation must reject an untracked reference image atomically",
  );

  assert.deepEqual(rowsOf(await database.query(
    `SELECT id, "buyerId", "buyerAccountActive", "buyerName"
       FROM public."CommissionRequest"
      WHERE id = $1`,
    [requestIds.open],
  )), [{
    id: requestIds.open,
    buyerId,
    buyerAccountActive: true,
    buyerName: "Commission buyer",
  }], "the owner operation must derive buyer identity and preserve public mirrors");

  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    buyerId,
    `SELECT public.grainline_commission_request_owner_assign_metros($1, $2, NULL)
       AS value`,
    [requestIds.open, metroId],
  )), [{ value: true }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    outsiderId,
    `SELECT public.grainline_commission_request_owner_assign_metros($1, NULL, NULL)
       AS value`,
    [requestIds.open],
  )), [{ value: false }], "another user cannot rewrite the request geography");

  await database.query(
    `UPDATE public."CommissionRequest"
        SET title = ''
      WHERE id = $1`,
    [requestIds.open],
  );

  const anonymousPage = await runtimeQuery(
    database,
    null,
    `SELECT id, title
       FROM public.grainline_commission_request_public_page(
         NULL, NULL, NULL, NULL, NULL, NULL, 0, 1000
       )`,
  );
  assert.equal(idSet(anonymousPage).has(requestIds.open), true);
  assert.equal(
    rowsOf(anonymousPage).find((row) => row.id === requestIds.open)?.title,
    "Untitled commission request",
    "one malformed legacy title must not take down the public board",
  );
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    null,
    `SELECT id, title
       FROM public.grainline_commission_request_public_detail($1)`,
    [requestIds.open],
  )), [{
    id: requestIds.open,
    title: "Untitled commission request",
  }], "one malformed legacy title must not take down its public detail page");
  assert.equal(idSet(await runtimeQuery(
    database,
    null,
    `SELECT id
       FROM public.grainline_commission_request_public_page(
         NULL, NULL, NULL, 30.2672, -97.7431, 80000, 0, 1000
       )`,
  )).has(requestIds.open), true, "nearby local requests must be discoverable");
  assert.equal(idSet(await runtimeQuery(
    database,
    null,
    `SELECT id
       FROM public.grainline_commission_request_public_page(
         NULL, NULL, NULL, 40.7128, -74.0060, 80000, 0, 1000
       )`,
  )).has(requestIds.open), false, "far-away local requests must be excluded");
  assert.equal(rowsOf(await runtimeQuery(
    database,
    null,
    "SELECT id FROM public.grainline_commission_request_public_metro_ids()",
  )).some((row) => row.id === metroId), true);
  assert.equal(rowsOf(await runtimeQuery(
    database,
    null,
    `SELECT id
       FROM public.grainline_commission_request_public_sitemap_page(0, 50000)`,
  )).some((row) => row.id === requestIds.open), true);

  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    outsiderId,
    `SELECT public.grainline_commission_request_actor_report_target($1, $2)
       AS value`,
    [requestIds.open, buyerId],
  )), [{ value: true }]);
  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [`${suffix}_block`, buyerId, outsiderId, now],
  );
  assert.equal(idSet(await runtimeQuery(
    database,
    outsiderId,
    `SELECT id
       FROM public.grainline_commission_request_public_page(
         NULL, NULL, NULL, NULL, NULL, NULL, 0, 1000
       )`,
  )).has(requestIds.open), false, "reciprocal blocks must hide public requests");
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    outsiderId,
    `SELECT public.grainline_commission_request_actor_report_target($1, $2)
       AS value`,
    [requestIds.open, buyerId],
  )), [{ value: false }]);

  const interest = await createActorInterest(database, seller.userId, requestIds.terminal);
  assert.equal(interest.length, 1);
  assert.equal(interest[0].created, true);
  assert.equal(interest[0].buyerUserId, buyerId);
  const repeatedInterest = await createActorInterest(
    database,
    seller.userId,
    requestIds.terminal,
  );
  assert.equal(repeatedInterest[0].created, false);
  assert.equal(repeatedInterest[0].commissionInterestId, interest[0].commissionInterestId);
  await assert.rejects(
    createActorInterest(database, null, requestIds.open),
    (error) => error?.code === "42501",
    "commission interest must derive an authenticated actor",
  );

  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    seller.userId,
    `SELECT "commissionRequestId"
       FROM public.grainline_commission_interest_actor_request_ids($1::text[])`,
    [[requestIds.terminal]],
  )), [{ commissionRequestId: requestIds.terminal }]);
  const transition = rowsOf(await runtimeQuery(
    database,
    buyerId,
    `SELECT *
       FROM public.grainline_commission_request_owner_transition($1, 'FULFILLED')`,
    [requestIds.terminal],
  ));
  assert.deepEqual(transition.map((row) => ({
    outcome: row.outcome,
    requestId: row.requestId,
    status: row.status,
    sellerUserIds: row.sellerUserIds,
  })), [{
    outcome: "transitioned",
    requestId: requestIds.terminal,
    status: "FULFILLED",
    sellerUserIds: [seller.userId],
  }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    outsiderId,
    `SELECT outcome
       FROM public.grainline_commission_request_owner_transition($1, 'CLOSED')`,
    [requestIds.open],
  )), [{ outcome: "not_found" }]);

  assert.equal(rowsOf(await runtimeQuery(
    database,
    null,
    "SELECT id FROM public.grainline_commission_request_public_detail($1)",
    [requestIds.terminal],
  )).length, 0, "terminal requests must not remain public");
  assert.equal(rowsOf(await runtimeQuery(
    database,
    buyerId,
    "SELECT id, title FROM public.grainline_commission_request_public_detail($1)",
    [requestIds.terminal],
  )).length, 1, "the request owner must retain terminal detail access");
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    seller.userId,
    `SELECT id, "alreadyInterested"
       FROM public.grainline_commission_request_public_detail($1)`,
    [requestIds.terminal],
  )), [{ id: requestIds.terminal, alreadyInterested: true }],
  "an interested maker must retain terminal detail access");

  assert.equal(rowsOf(await runtimeQuery(
    database,
    buyerId,
    "SELECT id FROM public.grainline_commission_request_owner_page(1000)",
  )).some((row) => row.id === requestIds.terminal), true);
  const ownerExportRows = rowsOf(await runtimeQuery(
    database,
    buyerId,
    `SELECT id, "metroId", "cityMetroId"
       FROM public.grainline_commission_request_owner_export()`,
  ));
  assert.equal(
    ownerExportRows.some((row) => row.id === requestIds.terminal),
    true,
  );
  for (const row of ownerExportRows) {
    assert.equal(Object.hasOwn(row, "metroId"), true);
    assert.equal(Object.hasOwn(row, "cityMetroId"), true);
  }
  assert.equal(rowsOf(await runtimeQuery(
    database,
    seller.userId,
    `SELECT "commissionRequestId"
       FROM public.grainline_commission_interest_owner_export()`,
  )).some((row) => row.commissionRequestId === requestIds.terminal), true);

  const rollbackInterest = await createActorInterest(
    database,
    seller.userId,
    requestIds.rollback,
  );
  assert.equal(rollbackInterest[0].created, true);
  const ownerInterestSummary = async () => rowsOf(await runtimeQuery(
    database,
    buyerId,
    `SELECT "commissionRequestId", "interestedCount", "interestId"
       FROM public.grainline_seller_owner_commission_interest_summaries(
         $1::text[], 3
       )`,
    [[requestIds.rollback]],
  ));
  const publicInterestCount = async () => rowsOf(await runtimeQuery(
    database,
    buyerId,
    `SELECT "commissionRequestId", value
       FROM public.grainline_seller_public_commission_interest_counts($1::text[])`,
    [[requestIds.rollback]],
  ));
  assert.deepEqual(await ownerInterestSummary(), [{
    commissionRequestId: requestIds.rollback,
    interestedCount: "1",
    interestId: rollbackInterest[0].commissionInterestId,
  }]);

  await database.query('UPDATE public."User" SET banned = true WHERE id = $1', [seller.userId]);
  assert.deepEqual(await ownerInterestSummary(), [{
    commissionRequestId: requestIds.rollback,
    interestedCount: "0",
    interestId: null,
  }], "a banned maker must disappear from the buyer summary without losing evidence");
  assert.deepEqual(await publicInterestCount(), [{
    commissionRequestId: requestIds.rollback,
    value: "0",
  }]);
  await database.query('UPDATE public."User" SET banned = false WHERE id = $1', [seller.userId]);

  const interestBlockId = `${suffix}_interest_block`;
  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [interestBlockId, buyerId, seller.userId, now],
  );
  assert.deepEqual(await ownerInterestSummary(), [{
    commissionRequestId: requestIds.rollback,
    interestedCount: "0",
    interestId: null,
  }], "a reciprocal block must hide the maker from the buyer summary");
  assert.deepEqual(await publicInterestCount(), [{
    commissionRequestId: requestIds.rollback,
    value: "0",
  }]);
  assert.equal(rowsOf(await runtimeQuery(
    database,
    seller.userId,
    "SELECT id FROM public.grainline_commission_request_public_detail($1)",
    [requestIds.rollback],
  )).length, 0, "a preserved interest must not bypass a reciprocal block");
  await beginRuntime(database, buyerId);
  try {
    assert.deepEqual(rowsOf(await database.query(
      `SELECT outcome, "sellerUserIds"
         FROM public.grainline_commission_request_owner_transition($1, 'CLOSED')`,
      [requestIds.rollback],
    )), [{ outcome: "transitioned", sellerUserIds: [] }],
    "blocked makers must not receive Commission transition notifications");
  } finally {
    await database.query("ROLLBACK");
  }
  await database.query('DELETE FROM public."Block" WHERE id = $1', [interestBlockId]);
  assert.equal((await ownerInterestSummary())[0]?.interestedCount, "1");

  const notificationId = randomUUID();
  await database.query("BEGIN");
  try {
    await database.query("SET LOCAL ROLE grainline_app_runtime");
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [buyerId],
    );
    assert.equal(rowsOf(await database.query(
      `SELECT outcome
         FROM public.grainline_commission_request_owner_transition($1, 'CLOSED')`,
      [requestIds.rollback],
    ))[0]?.outcome, "transitioned");
    assert.equal(rowsOf(await database.query(
      `SELECT public.grainline_notification_create_commission_event(
         $1, $2, 'COMMISSION_INTEREST', 'commission_request', $3, $4
       ) AS id`,
      [notificationId, seller.userId, requestIds.rollback, buyerId],
    ))[0]?.id, notificationId);
  } finally {
    await database.query("ROLLBACK");
  }
  assert.deepEqual(rowsOf(await database.query(
    `SELECT status::text AS status
       FROM public."CommissionRequest"
      WHERE id = $1`,
    [requestIds.rollback],
  )), [{ status: "OPEN" }], "state and notifications must share one transaction");
  assert.equal(Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS value
       FROM public."Notification"
      WHERE id = $1`,
    [notificationId],
  ))[0]?.value), 0, "rolled-back transitions must not leave notifications");

  if (connectionString) {
    await proveInterestTransitionSerialization({
      connectionString,
      database,
      buyerId,
      sellerUserId: seller.userId,
      interestFirstRequestId: requestIds.interestFirstRace,
      transitionFirstRequestId: requestIds.transitionFirstRace,
    });
  }

  const expiringInterest = await createActorInterest(
    database,
    seller.userId,
    requestIds.expiring,
  );
  assert.equal(expiringInterest[0].created, true);
  await database.query(
    `UPDATE public."CommissionRequest"
        SET "expiresAt" = pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())
                          - interval '1 minute'
      WHERE id = $1`,
    [requestIds.expiring],
  );
  const expiryBlockId = `${suffix}_expiry_block`;
  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [expiryBlockId, buyerId, seller.userId, now],
  );
  assert.ok(Number(rowsOf(await runtimeQuery(
    database,
    null,
    `SELECT public.grainline_commission_request_service_expired_count() AS value`,
  ))[0]?.value) >= 1);
  const expiredRows = rowsOf(await runtimeQuery(
    database,
    null,
    `SELECT "requestId", "sellerUserIds"
       FROM public.grainline_commission_request_service_expire_batch(200)`,
  ));
  assert.deepEqual(
    expiredRows.find((row) => row.requestId === requestIds.expiring),
    { requestId: requestIds.expiring, sellerUserIds: [] },
    "blocked makers must not receive Commission expiry notifications",
  );
  await database.query('DELETE FROM public."Block" WHERE id = $1', [expiryBlockId]);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT status::text AS status
       FROM public."CommissionRequest"
      WHERE id = $1`,
    [requestIds.expiring],
  )), [{ status: "EXPIRED" }]);

  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    buyerId,
    "SELECT public.grainline_commission_request_owner_active_count() AS value",
  )), [{ value: "2" }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    buyerId,
    "SELECT url FROM public.grainline_commission_request_owner_reference_image_urls()",
  )), [{ url: uploadUrl }]);

  await database.query(
    `UPDATE public."User"
        SET banned = true, "bannedAt" = $2, "bannedBy" = $3
      WHERE id = $1`,
    [outsiderId, now, adminId],
  );
  const banCapabilityId = randomUUID();
  await database.query(
    `INSERT INTO public."OrderStaffCapability" (
       id, "actorUserId", "targetUserId", operation, "payloadHash", "expiresAt"
     ) VALUES ($1, $2, $3, 'BAN_REVIEW_FLAG', NULL,
               pg_catalog.clock_timestamp() + interval '5 minutes')`,
    [banCapabilityId, adminId, outsiderId],
  );
  const banSnapshot = rowsOf(await runtimeQuery(
    database,
    adminId,
    "SELECT * FROM public.grainline_commission_request_staff_ban_close($1, $2)",
    [banCapabilityId, outsiderId],
  ));
  assert.deepEqual(banSnapshot, [{ id: requestIds.ban, status: "OPEN" }]);
  assert.equal(Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS value
       FROM public."OrderStaffCapability"
      WHERE id = $1`,
    [banCapabilityId],
  ))[0]?.value), 1, "Commission must not consume the shared Order ban capability");
  const restoreCapabilityId = randomUUID();
  await database.query(
    `INSERT INTO public."OrderStaffCapability" (
       id, "actorUserId", "targetUserId", operation, "payloadHash", "expiresAt"
     ) VALUES ($1, $2, $3, 'BAN_REVIEW_RESTORE', $4,
               pg_catalog.clock_timestamp() + interval '5 minutes')`,
    [restoreCapabilityId, restoringAdminId, outsiderId, "a".repeat(64)],
  );
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    restoringAdminId,
    `SELECT public.grainline_commission_request_staff_ban_restore(
       $1, $2, $3::text[], $4::text[]
     ) AS value`,
    [restoreCapabilityId, outsiderId, [requestIds.ban], ["OPEN"]],
  )), [{ value: 1 }]);
  await database.query(
    `UPDATE public."User"
        SET banned = false, "bannedAt" = NULL, "bannedBy" = NULL
      WHERE id = $1`,
    [outsiderId],
  );

  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    buyerId,
    "SELECT * FROM public.grainline_commission_account_deletion_prepare()",
  )), [{ closedRequestCount: 2, removedInterestCount: 0 }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    buyerId,
    "SELECT public.grainline_commission_account_deletion_redact() AS value",
  )), [{ value: 6 }]);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT title, description, "referenceImageUrls", "isNational", lat, lng,
            "radiusMeters"
       FROM public."CommissionRequest"
      WHERE id = $1`,
    [requestIds.open],
  )), [{
    title: "Deleted commission request",
    description: "[Request deleted]",
    referenceImageUrls: [],
    isNational: true,
    lat: null,
    lng: null,
    radiusMeters: null,
  }]);
  const sellerDeletionPreparation = rowsOf(await runtimeQuery(
    database,
    seller.userId,
    "SELECT * FROM public.grainline_commission_account_deletion_prepare()",
  ));
  assert.ok(sellerDeletionPreparation[0]?.removedInterestCount >= 3);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT id, "interestedCount"
       FROM public."CommissionRequest"
      WHERE id = ANY($1::text[])
      ORDER BY id`,
    [[requestIds.expiring, requestIds.rollback, requestIds.terminal]],
  )).map((row) => row.interestedCount), [0, 0, 0]);

  await database.query(
    `UPDATE public."User" SET banned = true WHERE id = $1`,
    [buyerId],
  );
  await assert.rejects(
    runtimeQuery(
      database,
      buyerId,
      `SELECT public.grainline_commission_request_owner_assign_metros($1, NULL, NULL)`,
      [requestIds.open],
    ),
    (error) => error?.code === "22023",
    "banned owners must not mutate CommissionRequest geography",
  );
}
