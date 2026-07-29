#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "CASE_STAFF_QUEUE_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const PREFIX = "case-staff-queue-proof";
const BASE_TIME = new Date("2026-07-29T06:00:00.000Z");

const ids = Object.freeze({
  buyer: `${PREFIX}-buyer`,
  namelessBuyer: `${PREFIX}-nameless-buyer`,
  seller: `${PREFIX}-seller`,
  staff: `${PREFIX}-staff`,
  admin: `${PREFIX}-admin`,
  foreign: `${PREFIX}-foreign`,
  suspendedStaff: `${PREFIX}-suspended-staff`,
  deletedStaff: `${PREFIX}-deleted-staff`,
});

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseCaseStaffQueueProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Case staff queue proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Case staff queue proof requires the ${DATABASE_NAME} database`,
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

async function queue(
  client,
  actorId,
  status = null,
  page = 1,
  pageSize = 25,
) {
  return runtimeQuery(
    client,
    `
      SELECT *
        FROM public.grainline_case_staff_queue($1, $2, $3, $4)
    `,
    [actorId, status, page, pageSize],
  );
}

async function seedUser(
  client,
  id,
  { role = "USER", name = `Name ${id}`, banned = false, deletedAt = null } = {},
) {
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
    name,
    role,
    banned,
    deletedAt,
  ]);
}

async function seedFixtures(client) {
  await client.query("BEGIN");
  try {
    await seedUser(client, ids.buyer, { name: "Buyer Queue Proof" });
    await seedUser(client, ids.namelessBuyer, { name: null });
    await seedUser(client, ids.seller, { name: "Seller Queue Proof" });
    await seedUser(client, ids.staff, { role: "EMPLOYEE" });
    await seedUser(client, ids.admin, { role: "ADMIN" });
    await seedUser(client, ids.foreign);
    await seedUser(client, ids.suspendedStaff, {
      role: "EMPLOYEE",
      banned: true,
    });
    await seedUser(client, ids.deletedStaff, {
      role: "ADMIN",
      deletedAt: BASE_TIME,
    });

    for (let index = 0; index < 27; index += 1) {
      const suffix = String(index).padStart(2, "0");
      const orderId = `${PREFIX}-order-${suffix}`;
      const caseId = `${PREFIX}-case-${suffix}`;
      const isResolved = index === 26;
      const buyerId = isResolved
        ? null
        : index === 1
          ? ids.namelessBuyer
          : ids.buyer;
      const createdAt = new Date(BASE_TIME.getTime() + (index * 60_000));
      await client.query(
        'INSERT INTO public."Order" (id, "buyerId") VALUES ($1, $2)',
        [orderId, buyerId ?? ids.buyer],
      );
      await client.query(`
        INSERT INTO public."Case" (
          id, "orderId", "buyerId", "sellerId", reason, description,
          status, resolution, "sellerRespondBy", "resolvedAt",
          "createdAt", "updatedAt"
        )
        VALUES (
          $1, $2, $3, $4, 'DAMAGED',
          'Disposable Case staff queue authority proof.',
          $5::public."CaseStatus",
          $6::public."CaseResolution",
          $7::timestamp + INTERVAL '48 hours',
          $8,
          $7::timestamp,
          $7::timestamp
        )
      `, [
        caseId,
        orderId,
        buyerId,
        ids.seller,
        isResolved ? "RESOLVED" : "OPEN",
        isResolved ? "DISMISSED" : null,
        createdAt,
        isResolved ? new Date(createdAt.getTime() + 60_000) : null,
      ]);
    }

    for (const [id, authorId, authorKind, body] of [
      [`${PREFIX}-message-1`, ids.buyer, "BUYER", "First queue proof message."],
      [`${PREFIX}-message-2`, ids.seller, "SELLER", "Second queue proof message."],
    ]) {
      await client.query(`
        INSERT INTO public."CaseMessage" (
          id, "caseId", "authorId", "authorKind", body, "createdAt"
        )
        VALUES (
          $1, $2, $3, $4::public."CaseMessageAuthorKind", $5, $6
        )
      `, [
        id,
        `${PREFIX}-case-00`,
        authorId,
        authorKind,
        body,
        BASE_TIME,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function countFixtures(client) {
  const result = await client.query(`
    SELECT
      (SELECT pg_catalog.count(*)::integer
         FROM public."User"
        WHERE id LIKE $1) AS users,
      (SELECT pg_catalog.count(*)::integer
         FROM public."Order"
        WHERE id LIKE $1) AS orders,
      (SELECT pg_catalog.count(*)::integer
         FROM public."Case"
        WHERE id LIKE $1) AS cases,
      (SELECT pg_catalog.count(*)::integer
         FROM public."CaseMessage"
        WHERE id LIKE $1) AS messages
  `, [`${PREFIX}%`]);
  return result.rows[0];
}

async function setProofRls(client) {
  for (const table of ["User", "Case", "CaseMessage"]) {
    await client.query(
      `ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`,
    );
    await client.query(
      `ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY`,
    );
  }
}

async function restoreProofRls(client) {
  for (const table of ["CaseMessage", "Case", "User"]) {
    await client.query(
      `ALTER TABLE public."${table}" NO FORCE ROW LEVEL SECURITY`,
    ).catch(() => {});
    await client.query(
      `ALTER TABLE public."${table}" DISABLE ROW LEVEL SECURITY`,
    ).catch(() => {});
  }
}

async function cleanupFixtures(client) {
  await client.query("BEGIN");
  try {
    await client.query(
      'DELETE FROM public."CaseMessage" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Case" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Order" WHERE id LIKE $1',
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

async function expectSqlState(run, sqlState) {
  await assert.rejects(run, (error) => {
    assert.equal(error?.code, sqlState);
    return true;
  });
}

export async function runCaseStaffQueueProof(env = process.env) {
  const { databaseUrl } = parseCaseStaffQueueProofConfig(env);
  const owner = createClient(databaseUrl, `${PREFIX}-owner`);
  const runtime = createClient(databaseUrl, `${PREFIX}-runtime`);
  const checks = [];
  let rlsChanged = false;
  await owner.connect();
  await runtime.connect();
  try {
    assert.deepEqual(
      await countFixtures(owner),
      { users: 0, orders: 0, cases: 0, messages: 0 },
      "Case staff queue proof found pre-existing fixtures",
    );
    checks.push("preflight-zero-residue");
    await seedFixtures(owner);
    checks.push("fixtures-seeded");

    const catalog = await owner.query(`
      SELECT
        procedure.prosecdef,
        procedure.provolatile,
        procedure.proparallel,
        procedure.proconfig,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          procedure.oid,
          'EXECUTE'
        ) AS runtime_execute,
        pg_catalog.has_function_privilege(
          'PUBLIC',
          procedure.oid,
          'EXECUTE'
        ) AS public_execute
        FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid =
         'public.grainline_case_staff_queue(text,text,integer,integer)'::pg_catalog.regprocedure
    `);
    assert.deepEqual(catalog.rows, [{
      prosecdef: true,
      provolatile: "v",
      proparallel: "u",
      proconfig: ["search_path=pg_catalog"],
      runtime_execute: true,
      public_execute: false,
    }]);
    checks.push("catalog-and-grants");

    const originalRls = await owner.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_catalog.pg_class
       WHERE oid IN (
         'public."User"'::pg_catalog.regclass,
         'public."Case"'::pg_catalog.regclass,
         'public."CaseMessage"'::pg_catalog.regclass
       )
       ORDER BY relname
    `);
    assert.deepEqual(
      originalRls.rows,
      [
        {
          relname: "Case",
          relrowsecurity: false,
          relforcerowsecurity: false,
        },
        {
          relname: "CaseMessage",
          relrowsecurity: false,
          relforcerowsecurity: false,
        },
        {
          relname: "User",
          relrowsecurity: false,
          relforcerowsecurity: false,
        },
      ],
      "Case staff queue proof requires the compatible pre-RLS posture",
    );
    rlsChanged = true;
    await setProofRls(owner);
    checks.push("forced-rls-test-posture");

    for (const actorId of [ids.staff, ids.admin]) {
      const result = await queue(runtime, actorId);
      assert.equal(result.rowCount, 1);
      assert.equal(result.rows[0].totalCount, "27");
      assert.equal(result.rows[0].safePage, 1);
      assert.equal(result.rows[0].cases.length, 25);
      assert.equal(result.rows[0].cases[0].id, `${PREFIX}-case-25`);
      assert.equal(
        result.rows[0].cases[0].buyerLabel,
        "Buyer Queue Proof",
      );
      assert.equal(
        result.rows[0].cases[0].buyerSecondaryEmail,
        `${ids.buyer}@example.invalid`,
      );
      assert.equal(result.rows[0].cases[0].sellerLabel, "Seller Queue Proof");
      assert.match(result.rows[0].cases[0].createdAt, /(?:Z|\+00:00)$/);
      assert.deepEqual(
        Object.keys(result.rows[0].cases[0]).sort(),
        [
          "buyerLabel",
          "buyerSecondaryEmail",
          "createdAt",
          "id",
          "messageCount",
          "orderId",
          "reason",
          "sellerLabel",
          "status",
        ],
      );
    }
    checks.push("staff-admin-equivalence");

    const finalPage = await queue(runtime, ids.staff, null, 1000);
    assert.equal(finalPage.rows[0].safePage, 2);
    assert.equal(finalPage.rows[0].cases.length, 2);
    assert.deepEqual(
      finalPage.rows[0].cases.map((row) => row.id),
      [`${PREFIX}-case-00`, `${PREFIX}-case-26`],
    );
    assert.equal(finalPage.rows[0].cases[0].messageCount, 2);
    assert.equal(finalPage.rows[0].cases[1].buyerLabel, "Deleted buyer");
    assert.equal(
      finalPage.rows[0].cases[1].buyerSecondaryEmail,
      null,
    );
    checks.push("page-clamp-order-and-derived-count");

    const nameless = await queue(runtime, ids.staff, "OPEN", 2, 25);
    assert.equal(nameless.rows[0].totalCount, "26");
    assert.equal(nameless.rows[0].safePage, 2);
    assert.equal(nameless.rows[0].cases.length, 1);
    assert.equal(nameless.rows[0].cases[0].id, `${PREFIX}-case-00`);
    const firstPageOpen = await queue(runtime, ids.staff, "OPEN");
    const namelessRow = firstPageOpen.rows[0].cases.find(
      (row) => row.id === `${PREFIX}-case-01`,
    );
    assert.equal(
      namelessRow?.buyerLabel,
      `${ids.namelessBuyer}@example.invalid`,
    );
    assert.equal(namelessRow?.buyerSecondaryEmail, null);
    checks.push("status-filter-and-minimal-contact");

    const empty = await queue(runtime, ids.staff, "CLOSED", 1000);
    assert.deepEqual(empty.rows[0], {
      totalCount: "0",
      safePage: 1,
      cases: [],
    });
    checks.push("empty-filter-result");

    for (const actorId of [
      ids.foreign,
      ids.suspendedStaff,
      ids.deletedStaff,
      `${PREFIX}-missing`,
    ]) {
      assert.equal((await queue(runtime, actorId)).rowCount, 0);
    }
    checks.push("unauthorized-actor-denial");

    for (const args of [
      [ids.staff, "INVALID", 1, 25],
      [ids.staff, null, 0, 25],
      [ids.staff, null, 1001, 25],
      [ids.staff, null, 1, 0],
      [ids.staff, null, 1, 51],
    ]) {
      await expectSqlState(
        () => runtimeQuery(
          runtime,
          "SELECT * FROM public.grainline_case_staff_queue($1, $2, $3, $4)",
          args,
        ),
        "22023",
      );
    }
    checks.push("invalid-input-denial");

    const direct = await runtimeQuery(
      runtime,
      `
        SELECT id
          FROM public."Case"
         WHERE id LIKE $1
      `,
      [`${PREFIX}%`],
    );
    assert.equal(direct.rowCount, 0);
    checks.push("function-only-forced-rls-read");

    const leakedContext = await runtimeQuery(
      runtime,
      "SELECT pg_catalog.current_setting('app.user_id', true) AS actor",
    );
    assert.equal(leakedContext.rows[0].actor, null);
    checks.push("transaction-local-context");

    assert.deepEqual(
      await countFixtures(owner),
      { users: 8, orders: 27, cases: 27, messages: 2 },
      "Case staff queue proof changed protected state",
    );
    checks.push("read-only-state");
  } finally {
    if (rlsChanged) {
      await restoreProofRls(owner);
    }
    await cleanupFixtures(owner).catch(() => {});
    const residue = await countFixtures(owner).catch(() => null);
    await Promise.all([
      owner.end().catch(() => {}),
      runtime.end().catch(() => {}),
    ]);
    assert.deepEqual(
      residue,
      { users: 0, orders: 0, cases: 0, messages: 0 },
      "Case staff queue proof left fixture residue",
    );
  }
  assert.equal(checks.length, 13);
  return Object.freeze({ checks: Object.freeze([...checks]) });
}

const isDirectRun =
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  runCaseStaffQueueProof()
    .then(({ checks }) => {
      process.stdout.write(
        `Case staff queue PostgreSQL proof passed ${checks.length} checks.\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(
        `Case staff queue PostgreSQL proof failed: ${safeError(error)}\n`,
      );
      process.exitCode = 1;
    });
}
