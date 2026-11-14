import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const COMMISSION_DOMAIN_RLS_MIGRATION =
  "20261113020000_activate_commission_domain_rls";

async function posture(database) {
  return (await database.query(`
    SELECT relation.relname,
           relation.relrowsecurity AS "rlsEnabled",
           relation.relforcerowsecurity AS "rlsForced",
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = relation.oid) AS "policyCount",
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
     ORDER BY relation.relname
  `)).rows;
}

const ACTIVE_POSTURE = Object.freeze([
  Object.freeze({
    relname: "CommissionInterest",
    rlsEnabled: true,
    rlsForced: true,
    policyCount: 0,
    runtimeSelect: false,
    runtimeInsert: false,
    runtimeUpdate: false,
    runtimeDelete: false,
  }),
  Object.freeze({
    relname: "CommissionRequest",
    rlsEnabled: true,
    rlsForced: true,
    policyCount: 0,
    runtimeSelect: false,
    runtimeInsert: false,
    runtimeUpdate: false,
    runtimeDelete: false,
  }),
]);

const PREDECESSOR_POSTURE = Object.freeze(ACTIVE_POSTURE.map((entry) =>
  Object.freeze({
    ...entry,
    rlsEnabled: false,
    rlsForced: false,
    runtimeSelect: true,
    runtimeInsert: true,
    runtimeUpdate: true,
    runtimeDelete: true,
  })));

async function directRuntimeQuery(database, sql) {
  await database.query("BEGIN");
  try {
    await database.query("SET LOCAL ROLE grainline_app_runtime");
    const result = await database.query(sql);
    await database.query("COMMIT");
    return result;
  } catch (error) {
    await database.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function publicCountThroughAuthority(database) {
  await database.query("BEGIN");
  try {
    await database.query("SET LOCAL ROLE grainline_app_runtime");
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', '', true)",
    );
    const result = await database.query(`
      SELECT public.grainline_commission_request_public_count(
        NULL, NULL, NULL, NULL, NULL, NULL
      ) AS value
    `);
    await database.query("COMMIT");
    return Number(result.rows[0]?.value);
  } catch (error) {
    await database.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function proveQueryPlansAtVolume(database, seller) {
  const volumePrefix = `commission_plan_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const rowCount = 20_000;
  try {
    await database.query(
      `INSERT INTO public."CommissionRequest" (
         id, "buyerId", title, description, status, "interestedCount",
         "isNational", lat, lng, "radiusMeters", "buyerAccountActive",
         "createdAt", "updatedAt"
       )
       SELECT
         $1 || '_' || series.value::text,
         $2,
         'Volume plan request ' || series.value::text,
         'Disposable realistic-volume Commission query-plan proof',
         'OPEN'::public."CommissionStatus",
         0,
         series.value % 2 = 0,
         CASE WHEN series.value % 2 = 0 THEN NULL ELSE 30.25 END,
         CASE WHEN series.value % 2 = 0 THEN NULL ELSE -97.75 END,
         CASE WHEN series.value % 2 = 0 THEN NULL ELSE 80000 END,
         true,
         timestamp '2026-11-01 12:00:00'
           - series.value * interval '1 second',
         timestamp '2026-11-01 12:00:00'
           - series.value * interval '1 second'
       FROM pg_catalog.generate_series(1, $3::integer) AS series(value)`,
      [volumePrefix, seller.userId, rowCount],
    );
    await database.query('ANALYZE public."CommissionRequest"');

    const planResult = await database.query(`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON, TIMING OFF)
      SELECT request.id
        FROM public."CommissionRequest" AS request
       WHERE request.status = 'OPEN'::public."CommissionStatus"
         AND (request."expiresAt" IS NULL OR request."expiresAt" >
              pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()))
         AND request."buyerAccountActive" = true
       ORDER BY request."createdAt" DESC, request.id DESC
       LIMIT 24
    `);
    const plan = planResult.rows[0]?.["QUERY PLAN"];
    assert.equal(Array.isArray(plan), true, "Commission plan JSON must be present");
    assert.match(
      JSON.stringify(plan),
      /CommissionRequest_status_createdAt_idx/u,
      "public Commission pagination must retain the status/createdAt index path",
    );
    assert.ok(
      Number(plan[0]?.["Execution Time"]) < 3_000,
      "indexed Commission page plan exceeded the disposable 3 second bound",
    );

    await database.query("BEGIN");
    try {
      await database.query("SET LOCAL ROLE grainline_app_runtime");
      await database.query("SET LOCAL statement_timeout = '3s'");
      await database.query(
        "SELECT pg_catalog.set_config('app.user_id', '', true)",
      );
      const result = await database.query(`
        SELECT
          public.grainline_commission_request_public_count(
            NULL, NULL, NULL, 30.25, -97.75, 100000
          ) AS count,
          (SELECT pg_catalog.count(*)::integer
             FROM public.grainline_commission_request_public_page(
               NULL, NULL, NULL, 30.25, -97.75, 100000, 0, 24
             )) AS page_count
      `);
      assert.ok(Number(result.rows[0]?.count) >= rowCount);
      assert.equal(Number(result.rows[0]?.page_count), 24);
      await database.query("COMMIT");
    } catch (error) {
      await database.query("ROLLBACK").catch(() => {});
      throw error;
    }
  } finally {
    await database.query(
      'DELETE FROM public."CommissionRequest" WHERE id LIKE $1',
      [`${volumePrefix}_%`],
    );
    await database.query('ANALYZE public."CommissionRequest"');
  }
}

export async function proveCommissionDomainRlsActivation({
  database,
  repositoryRoot,
  seller,
}) {
  assert.deepEqual(await posture(database), ACTIVE_POSTURE);
  assert.equal(Number.isSafeInteger(await publicCountThroughAuthority(database)), true);
  await proveQueryPlansAtVolume(database, seller);

  await assert.rejects(
    directRuntimeQuery(
      database,
      'SELECT pg_catalog.count(*) FROM public."CommissionRequest"',
    ),
    (error) => error?.code === "42501",
    "policyless activation must deny direct request reads",
  );
  await assert.rejects(
    directRuntimeQuery(
      database,
      `INSERT INTO public."CommissionInterest"
         (id, "commissionRequestId", "sellerProfileId", "createdAt")
       VALUES ('forged', 'forged', 'forged', pg_catalog.clock_timestamp())`,
    ),
    (error) => error?.code === "42501",
    "policyless activation must deny direct interest writes",
  );

  const rollbackSql = readFileSync(
    join(repositoryRoot, "docs/rls-drafts/commission-domain-activation-rollback.sql"),
    "utf8",
  );
  const activationSql = readFileSync(
    join(
      repositoryRoot,
      "prisma/migrations",
      COMMISSION_DOMAIN_RLS_MIGRATION,
      "migration.sql",
    ),
    "utf8",
  );

  await database.query(rollbackSql);
  assert.deepEqual(await posture(database), PREDECESSOR_POSTURE);
  await directRuntimeQuery(
    database,
    `SELECT pg_catalog.count(*) FROM public."CommissionRequest";
     UPDATE public."CommissionRequest"
        SET "updatedAt" = "updatedAt"
      WHERE false;
     DELETE FROM public."CommissionInterest" WHERE false`,
  );

  await database.query(activationSql);
  assert.deepEqual(await posture(database), ACTIVE_POSTURE);
  assert.equal(Number.isSafeInteger(await publicCountThroughAuthority(database)), true);

  const suffix = `commission_activation_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const buyerId = `${suffix}_buyer`;
  const requestId = `${suffix}_request`;
  const interestId = randomUUID();
  const now = "2026-11-01 15:00:00";
  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt",
        "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Commission cascade buyer', 'USER', false,
             $4, $4, $4, '2026-01-01', $4)`,
    [buyerId, `clerk_${buyerId}`, `${buyerId}@example.test`, now],
  );
  await database.query(
    `INSERT INTO public."CommissionRequest"
       (id, "buyerId", title, description, "createdAt", "updatedAt")
     VALUES ($1, $2, 'Cascade proof', 'Cascade proof', $3, $3)`,
    [requestId, buyerId, now],
  );
  await database.query(
    `INSERT INTO public."CommissionInterest"
       (id, "commissionRequestId", "sellerProfileId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [interestId, requestId, seller.sellerProfileId, now],
  );
  await database.query(
    'DELETE FROM public."CommissionRequest" WHERE id = $1',
    [requestId],
  );
  assert.deepEqual((await database.query(
    `SELECT
       (SELECT pg_catalog.count(*)::integer
          FROM public."CommissionRequest" WHERE id = $1) AS requests,
       (SELECT pg_catalog.count(*)::integer
          FROM public."CommissionInterest" WHERE id = $2) AS interests`,
    [requestId, interestId],
  )).rows, [{ requests: 0, interests: 0 }]);
  await database.query('DELETE FROM public."User" WHERE id = $1', [buyerId]);
}
