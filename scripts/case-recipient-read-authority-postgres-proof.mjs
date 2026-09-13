#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "CASE_RECIPIENT_READ_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const PREFIX = "case-recipient-read-proof";
const CREATED_AT = new Date("2026-07-29T05:50:00.000Z");

const ids = Object.freeze({
  buyer: `${PREFIX}-buyer`,
  seller: `${PREFIX}-seller`,
  foreign: `${PREFIX}-foreign`,
  staff: `${PREFIX}-staff`,
  admin: `${PREFIX}-admin`,
  suspended: `${PREFIX}-suspended`,
  deleted: `${PREFIX}-deleted`,
  activeOrder: `${PREFIX}-active-order`,
  resolvedOrder: `${PREFIX}-resolved-order`,
  sellerProfile: `${PREFIX}-seller-profile`,
  listing: `${PREFIX}-listing`,
  activeCase: `${PREFIX}-active-case`,
  resolvedCase: `${PREFIX}-resolved-case`,
});

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseCaseRecipientReadProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Case recipient-read proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Case recipient-read proof requires the ${DATABASE_NAME} database`,
  );
  return Object.freeze({ databaseUrl });
}

function createClient(databaseUrl, applicationName) {
  return new Client({
    application_name: applicationName,
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
    statement_timeout: 25_000,
  });
}

async function runtimeQuery(client, sql, params = []) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE grainline_app_runtime");
    const result = await client.query(sql, params);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function getById(client, actorId, caseId = ids.activeCase) {
  return runtimeQuery(
    client,
    `
      SELECT *
        FROM public.grainline_case_get($1, $2)
    `,
    [actorId, caseId],
  );
}

async function getByOrder(
  client,
  actorId,
  orderId = ids.activeOrder,
) {
  return runtimeQuery(
    client,
    `
      SELECT *
        FROM public.grainline_case_get_by_order($1, $2)
    `,
    [actorId, orderId],
  );
}

async function activeCount(client, actorId) {
  return runtimeQuery(
    client,
    `
      SELECT *
        FROM public.grainline_case_staff_active_count($1)
    `,
    [actorId],
  );
}

async function seedUsers(client) {
  for (const [id, role, banned, deletedAt] of [
    [ids.buyer, "USER", false, null],
    [ids.seller, "USER", false, null],
    [ids.foreign, "USER", false, null],
    [ids.staff, "EMPLOYEE", false, null],
    [ids.admin, "ADMIN", false, null],
    [ids.suspended, "USER", true, null],
    [ids.deleted, "USER", false, new Date()],
  ]) {
    await client.query(`
      INSERT INTO public."User" (
        id, "clerkId", email, name, role, banned, "deletedAt",
        "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, $4, $5::public."Role", $6, $7,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, [
      id,
      `clerk-${id}`,
      `${id}@example.invalid`,
      `Private ${id}`,
      role,
      banned,
      deletedAt,
    ]);
  }
}

async function seedFixtures(client) {
  await client.query("BEGIN");
  try {
    await seedUsers(client);
    await client.query(
      'INSERT INTO public."Order" (id, "buyerId") VALUES ($1, $2), ($3, $4)',
      [ids.activeOrder, ids.buyer, ids.resolvedOrder, ids.buyer],
    );
    await client.query(`
      INSERT INTO public."SellerProfile" (
        id, "userId", "displayName", "displayNameNormalized",
        "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, 'Case recipient-read proof seller',
        'case recipient-read proof seller',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, [ids.sellerProfile, ids.seller]);
    await client.query(`
      INSERT INTO public."Listing" (
        id, "sellerId", title, description, "priceCents",
        "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, 'Case recipient-read proof listing',
        'Disposable Case recipient-read authority proof.',
        1000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, [ids.listing, ids.sellerProfile]);
    await client.query(`
      INSERT INTO public."OrderItem" (
        id, "orderId", "listingId", quantity, "priceCents"
      )
      VALUES
        ($1, $2, $3, 1, 1000),
        ($4, $5, $3, 1, 1000)
    `, [
      `${ids.activeOrder}-item`,
      ids.activeOrder,
      ids.listing,
      `${ids.resolvedOrder}-item`,
      ids.resolvedOrder,
    ]);
    await client.query(`
      INSERT INTO public."Case" (
        id, "orderId", "buyerId", "sellerId", reason, description,
        status, "sellerRespondBy", "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, $4, 'DAMAGED',
        'Disposable active Case recipient-read authority proof.',
        'IN_DISCUSSION', $5::timestamp + INTERVAL '48 hours',
        $5::timestamp, $5::timestamp
      )
    `, [
      ids.activeCase,
      ids.activeOrder,
      ids.buyer,
      ids.seller,
      CREATED_AT,
    ]);
    await client.query(`
      INSERT INTO public."Case" (
        id, "orderId", "buyerId", "sellerId", reason, description,
        status, resolution, "sellerRespondBy", "resolvedAt",
        "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, NULL, $3, 'OTHER',
        'Disposable resolved Case recipient-read authority proof.',
        'RESOLVED', 'DISMISSED',
        $4::timestamp + INTERVAL '48 hours',
        $4::timestamp + INTERVAL '72 hours',
        $4::timestamp, $4::timestamp + INTERVAL '72 hours'
      )
    `, [
      ids.resolvedCase,
      ids.resolvedOrder,
      ids.seller,
      CREATED_AT,
    ]);
    await client.query(`
      INSERT INTO public."CaseMessage" (
        id, "caseId", "authorId", "authorKind", body, "createdAt"
      )
      VALUES
        ($1, $2, $3, 'BUYER',
         'Disposable active Case opening evidence.', $4::timestamp),
        ($5, $6, $7, 'SELLER',
         'Disposable resolved Case opening evidence.', $4::timestamp)
    `, [
      `${ids.activeCase}-opening-message`,
      ids.activeCase,
      ids.buyer,
      CREATED_AT,
      `${ids.resolvedCase}-opening-message`,
      ids.resolvedCase,
      ids.seller,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function cleanupFixtures(client) {
  await client.query("BEGIN");
  try {
    await client.query(
      'DELETE FROM public."CaseMessage" WHERE "caseId" LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Case" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."OrderItem" WHERE "orderId" LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Order" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Listing" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."SellerProfile" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."User" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function snapshotFixtures(client) {
  const result = await client.query(`
    SELECT
      (
        SELECT COALESCE(
          pg_catalog.jsonb_agg(
            pg_catalog.to_jsonb(case_row)
            ORDER BY case_row.id
          ),
          '[]'::jsonb
        )
          FROM public."Case" AS case_row
         WHERE case_row.id LIKE $1
      ) AS cases,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."Order"
         WHERE id LIKE $1
      ) AS order_count,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."User"
         WHERE id LIKE $1
      ) AS user_count
  `, [`${PREFIX}%`]);
  return result.rows[0];
}

async function proveCatalog(observer) {
  const result = await observer.query(`
    SELECT
      procedure.proname,
      procedure.prosecdef AS security_definer,
      procedure.proleakproof AS leakproof,
      procedure.provolatile,
      procedure.proparallel,
      procedure.proconfig,
      pg_catalog.pg_get_userbyid(procedure.proowner) = CURRENT_USER
        AS owner_is_migration_role,
      pg_catalog.has_function_privilege(
        'grainline_app_runtime',
        procedure.oid,
        'EXECUTE'
      ) AS runtime_execute,
      pg_catalog.has_function_privilege(
        'public',
        procedure.oid,
        'EXECUTE'
      ) AS public_execute
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid IN (
       'public.grainline_case_get(text,text)'::pg_catalog.regprocedure,
       'public.grainline_case_get_by_order(text,text)'::pg_catalog.regprocedure,
       'public.grainline_case_staff_active_count(text)'::pg_catalog.regprocedure
     )
     ORDER BY procedure.proname
  `);
  assert.deepEqual(
    result.rows.map((row) => row.proname),
    [
      "grainline_case_get",
      "grainline_case_get_by_order",
      "grainline_case_staff_active_count",
    ],
  );
  for (const row of result.rows) {
    assert.deepEqual(row, {
      proname: row.proname,
      security_definer: true,
      leakproof: false,
      provolatile: "v",
      proparallel: "u",
      proconfig: ["search_path=pg_catalog"],
      owner_is_migration_role: true,
      runtime_execute: true,
      public_execute: false,
    });
  }
}

function assertMinimalCaseRow(row, actsAsStaff) {
  assert.deepEqual(Object.keys(row).sort(), [
    "actsAsStaff",
    "buyerId",
    "buyerMarkedResolved",
    "createdAt",
    "description",
    "escalateUnlocksAt",
    "id",
    "orderId",
    "reason",
    "refundAmountCents",
    "resolution",
    "resolvedAt",
    "sellerId",
    "sellerMarkedResolved",
    "sellerRespondBy",
    "status",
  ]);
  assert.equal(row.actsAsStaff, actsAsStaff);
  assert.ok(row.createdAt instanceof Date);
  assert.equal(row.createdAt.toISOString(), CREATED_AT.toISOString());
  assert.ok(row.sellerRespondBy instanceof Date);
  assert.equal(
    row.sellerRespondBy.toISOString(),
    new Date(CREATED_AT.getTime() + 48 * 60 * 60 * 1000).toISOString(),
  );
  assert.doesNotMatch(
    JSON.stringify(row),
    /example\.invalid|Private |clerk-|openedByPaymentEventId|resolvedById|stripeRefundId|updatedAt/,
  );
}

async function proveRecipientAuthority(runtime) {
  for (const actorId of [ids.buyer, ids.seller]) {
    const byId = await getById(runtime, actorId);
    const byOrder = await getByOrder(runtime, actorId);
    assert.equal(byId.rowCount, 1);
    assert.deepEqual(byOrder.rows, byId.rows);
    assertMinimalCaseRow(byId.rows[0], false);
  }

  for (const actorId of [ids.staff, ids.admin]) {
    const byId = await getById(runtime, actorId);
    const byOrder = await getByOrder(runtime, actorId);
    assert.equal(byId.rowCount, 1);
    assert.deepEqual(byOrder.rows, byId.rows);
    assertMinimalCaseRow(byId.rows[0], true);
  }

  for (const actorId of [
    ids.foreign,
    ids.suspended,
    ids.deleted,
    `${PREFIX}-missing`,
  ]) {
    assert.equal((await getById(runtime, actorId)).rowCount, 0);
    assert.equal((await getByOrder(runtime, actorId)).rowCount, 0);
  }
  assert.equal(
    (await getById(runtime, ids.buyer, `${PREFIX}-missing-case`)).rowCount,
    0,
  );
  assert.equal(
    (
      await getByOrder(
        runtime,
        ids.buyer,
        `${PREFIX}-missing-order`,
      )
    ).rowCount,
    0,
  );

  const deletedBuyer = await getById(
    runtime,
    ids.staff,
    ids.resolvedCase,
  );
  assert.equal(deletedBuyer.rowCount, 1);
  assert.equal(deletedBuyer.rows[0].buyerId, null);
  assertMinimalCaseRow(deletedBuyer.rows[0], true);
}

async function proveStaffActiveCount(runtime) {
  for (const actorId of [ids.staff, ids.admin]) {
    const result = await activeCount(runtime, actorId);
    assert.equal(result.rowCount, 1);
    assert.deepEqual(result.rows[0], { activeCount: "1" });
  }
  for (const actorId of [
    ids.buyer,
    ids.seller,
    ids.foreign,
    ids.suspended,
    ids.deleted,
    `${PREFIX}-missing`,
  ]) {
    assert.equal((await activeCount(runtime, actorId)).rowCount, 0);
  }
}

async function proveTransactionLocalContext(runtime) {
  await runtime.query("BEGIN");
  try {
    await runtime.query("SET LOCAL ROLE grainline_app_runtime");
    const result = await runtime.query(`
      WITH visible_case AS MATERIALIZED (
        SELECT *
          FROM public.grainline_case_get($1, $2)
      )
      SELECT
        visible_case.id,
        pg_catalog.current_setting(
          'app.user_id',
          true
        ) AS actor_context
        FROM visible_case
    `, [ids.buyer, ids.activeCase]);
    assert.equal(result.rows[0]?.actor_context, ids.buyer);
    await runtime.query("COMMIT");
  } catch (error) {
    await runtime.query("ROLLBACK").catch(() => {});
    throw error;
  }
  const afterCommit = await runtime.query(`
    SELECT pg_catalog.current_setting(
      'app.user_id',
      true
    ) AS actor_context
  `);
  assert.ok(
    afterCommit.rows[0]?.actor_context === null
      || afterCommit.rows[0]?.actor_context === "",
    "Case recipient-read context leaked after commit",
  );
}

async function proveInvalidInputs(runtime) {
  for (const [sql, params] of [
    [
      "SELECT * FROM public.grainline_case_get($1, $2)",
      ["actor with spaces", ids.activeCase],
    ],
    [
      "SELECT * FROM public.grainline_case_get($1, $2)",
      [ids.buyer, ""],
    ],
    [
      "SELECT * FROM public.grainline_case_get_by_order($1, $2)",
      [ids.buyer, "order with spaces"],
    ],
    [
      "SELECT * FROM public.grainline_case_staff_active_count($1)",
      [""],
    ],
  ]) {
    let caught;
    try {
      await runtimeQuery(runtime, sql, params);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, "invalid Case recipient-read input succeeded");
    assert.match(
      safeError(caught),
      /Case (?:get|get-by-order|staff active-count) input is invalid/,
    );
  }
}

export async function runCaseRecipientReadAuthorityPostgresProof(
  env = process.env,
) {
  const { databaseUrl } = parseCaseRecipientReadProofConfig(env);
  const observer = createClient(databaseUrl, "case-recipient-read-observer");
  const runtime = createClient(databaseUrl, "case-recipient-read-runtime");
  await Promise.all([observer.connect(), runtime.connect()]);
  try {
    await cleanupFixtures(observer).catch(() => {});
    await seedFixtures(observer);
    const before = await snapshotFixtures(observer);
    await proveCatalog(observer);
    await proveRecipientAuthority(runtime);
    await proveStaffActiveCount(runtime);
    await proveTransactionLocalContext(runtime);
    await proveInvalidInputs(runtime);
    const after = await snapshotFixtures(observer);
    assert.deepEqual(
      after,
      before,
      "Case recipient reads changed protected state",
    );
    await cleanupFixtures(observer);
    assert.deepEqual(await snapshotFixtures(observer), {
      cases: [],
      order_count: 0,
      user_count: 0,
    });
    return Object.freeze({
      checks: 20,
      database: DATABASE_NAME,
      persistentStagingChanged: false,
      productionChanged: false,
      proofMode: "ephemeral-loopback-runtime-role-recipient-read-cleanup",
      status: "passed",
    });
  } finally {
    await runtime.query("ROLLBACK").catch(() => {});
    await cleanupFixtures(observer).catch(() => {});
    await Promise.allSettled([observer.end(), runtime.end()]);
  }
}

const isMain =
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCaseRecipientReadAuthorityPostgresProof()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({
          message: safeError(error),
          persistentStagingChanged: false,
          productionChanged: false,
          status: "failed",
        })}\n`,
      );
      process.exitCode = 1;
    });
}
