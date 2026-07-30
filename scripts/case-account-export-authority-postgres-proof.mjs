#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "CASE_ACCOUNT_EXPORT_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const PREFIX = "case-account-export-proof";
const TIE_TIME = new Date("2026-07-01T12:00:00.000Z");
const OLD_TIME = new Date("2026-06-01T12:00:00.000Z");

const ids = Object.freeze({
  buyer: `${PREFIX}-buyer`,
  seller: `${PREFIX}-seller`,
  outsider: `${PREFIX}-outsider`,
  staff: `${PREFIX}-staff`,
  banned: `${PREFIX}-banned`,
  sellerProfile: `${PREFIX}-seller-profile`,
  listing: `${PREFIX}-listing`,
  tieOrderA: `${PREFIX}-order-tie-a`,
  tieOrderB: `${PREFIX}-order-tie-b`,
  oldOrder: `${PREFIX}-order-old`,
  tieCaseA: `${PREFIX}-case-tie-a`,
  tieCaseB: `${PREFIX}-case-tie-b`,
  oldCase: `${PREFIX}-case-old`,
});

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseCaseAccountExportProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Case account-export proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Case account-export proof requires the ${DATABASE_NAME} database`,
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

async function seedUser(client, id, { role = "USER", banned = false } = {}) {
  await client.query(`
    INSERT INTO public."User" (
      id, "clerkId", email, name, role, banned,
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, $3, $4, $5::public."Role", $6,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [
    id,
    `clerk-${id}`,
    `${id}@example.invalid`,
    `Name ${id}`,
    role,
    banned,
  ]);
}

async function seedCase(client, { id, orderId, createdAt }) {
  await client.query(
    'INSERT INTO public."Order" (id, "buyerId") VALUES ($1, $2)',
    [orderId, ids.buyer],
  );
  await client.query(`
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", quantity, "priceCents"
    )
    VALUES ($1, $2, $3, 1, 1000)
  `, [`${orderId}-item`, orderId, ids.listing]);
  await client.query(`
    INSERT INTO public."Case" (
      id, "orderId", "buyerId", "sellerId", reason, description,
      status, resolution, "refundAmountCents", "sellerRespondBy",
      "resolvedAt", "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, $3, $4,
      'DAMAGED'::public."CaseReason",
      'Disposable account-export authority proof.',
      'OPEN'::public."CaseStatus",
      NULL,
      NULL,
      $5::timestamp + INTERVAL '48 hours',
      NULL,
      $5::timestamp,
      $5::timestamp
    )
  `, [
    id,
    orderId,
    ids.buyer,
    ids.seller,
    createdAt,
  ]);
  await client.query(`
    INSERT INTO public."CaseMessage" (
      id, "caseId", "authorId", "authorKind", body, "createdAt"
    )
    VALUES (
      $1, $2, $3, 'BUYER',
      'Disposable opening evidence for the Case account-export proof.',
      $4
    )
  `, [`${id}-opening-message`, id, ids.buyer, createdAt]);
}

async function seedFixtures(client) {
  await client.query("BEGIN");
  try {
    await seedUser(client, ids.buyer);
    await seedUser(client, ids.seller);
    await seedUser(client, ids.outsider);
    await seedUser(client, ids.staff, { role: "EMPLOYEE" });
    await seedUser(client, ids.banned, { banned: true });
    await client.query(`
      INSERT INTO public."SellerProfile" (
        id, "userId", "displayName", "displayNameNormalized",
        "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, 'Case account-export proof seller',
        'case account-export proof seller',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, [ids.sellerProfile, ids.seller]);
    await client.query(`
      INSERT INTO public."Listing" (
        id, "sellerId", title, description, "priceCents",
        "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, 'Case account-export proof listing',
        'Disposable account-export authority proof.',
        1000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, [ids.listing, ids.sellerProfile]);
    await seedCase(client, {
      id: ids.tieCaseA,
      orderId: ids.tieOrderA,
      createdAt: TIE_TIME,
    });
    await seedCase(client, {
      id: ids.tieCaseB,
      orderId: ids.tieOrderB,
      createdAt: TIE_TIME,
    });
    await seedCase(client, {
      id: ids.oldCase,
      orderId: ids.oldOrder,
      createdAt: OLD_TIME,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function fixtureCounts(client) {
  const result = await client.query(`
    SELECT
      (SELECT pg_catalog.count(*)::integer
         FROM public."User" WHERE id LIKE $1) AS users,
      (SELECT pg_catalog.count(*)::integer
         FROM public."SellerProfile" WHERE id LIKE $1) AS sellers,
      (SELECT pg_catalog.count(*)::integer
         FROM public."Listing" WHERE id LIKE $1) AS listings,
      (SELECT pg_catalog.count(*)::integer
         FROM public."Order" WHERE id LIKE $1) AS orders,
      (SELECT pg_catalog.count(*)::integer
         FROM public."OrderItem" WHERE id LIKE $1) AS items,
      (SELECT pg_catalog.count(*)::integer
         FROM public."Case" WHERE id LIKE $1) AS cases,
      (SELECT pg_catalog.count(*)::integer
         FROM public."CaseMessage" WHERE "caseId" LIKE $1) AS messages
  `, [`${PREFIX}%`]);
  return result.rows[0];
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

async function installProofPolicies(client) {
  await client.query(`
    CREATE POLICY case_account_export_proof_user_self
      ON public."User"
      FOR SELECT
      TO grainline_app_runtime
      USING (
        id = NULLIF(
          pg_catalog.current_setting('app.user_id', true),
          ''
        )
      )
  `);
  await client.query(`
    CREATE POLICY case_account_export_proof_case_participant
      ON public."Case"
      FOR SELECT
      TO grainline_app_runtime
      USING (
        NULLIF(
          pg_catalog.current_setting('app.user_id', true),
          ''
        ) IN ("buyerId", "sellerId")
      )
  `);
  for (const table of ["User", "Case"]) {
    await client.query(
      `ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`,
    );
    await client.query(
      `ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY`,
    );
  }
}

async function removeProofPolicies(client) {
  for (const table of ["Case", "User"]) {
    await client.query(
      `ALTER TABLE public."${table}" NO FORCE ROW LEVEL SECURITY`,
    ).catch(() => {});
    await client.query(
      `ALTER TABLE public."${table}" DISABLE ROW LEVEL SECURITY`,
    ).catch(() => {});
  }
  await client.query(`
    DROP POLICY IF EXISTS case_account_export_proof_case_participant
      ON public."Case"
  `).catch(() => {});
  await client.query(`
    DROP POLICY IF EXISTS case_account_export_proof_user_self
      ON public."User"
  `).catch(() => {});
}

async function exportPage(
  client,
  actorId,
  { cursorCreatedAt = null, cursorId = null, limit = 25 } = {},
) {
  return runtimeQuery(
    client,
    `
      SELECT *
        FROM public.grainline_case_export_page(
          $1,
          $2,
          $3,
          $4
        )
    `,
    [actorId, cursorCreatedAt, cursorId, limit],
  );
}

async function expectSqlState(run, sqlState) {
  await assert.rejects(run, (error) => {
    assert.equal(error?.code, sqlState);
    return true;
  });
}

function assertMinimalRow(row) {
  assert.deepEqual(Object.keys(row).sort(), [
    "buyerId",
    "createdAt",
    "description",
    "id",
    "orderId",
    "reason",
    "refundAmountCents",
    "resolution",
    "resolvedAt",
    "sellerId",
    "sellerRespondBy",
    "status",
    "updatedAt",
  ]);
  for (const timestamp of [
    row.createdAt,
    row.updatedAt,
    row.sellerRespondBy,
  ]) {
    assert.ok(timestamp instanceof Date);
    assert.ok(Number.isFinite(timestamp.getTime()));
  }
  assert.equal(row.resolvedAt, null);
  assert.doesNotMatch(
    JSON.stringify(row),
    /example\.invalid|clerk-|Name |stripeRefundId|openedByPaymentEventId/,
  );
}

export async function runCaseAccountExportAuthorityProof(
  env = process.env,
) {
  const { databaseUrl } = parseCaseAccountExportProofConfig(env);
  const owner = createClient(databaseUrl, `${PREFIX}-owner`);
  const runtime = createClient(databaseUrl, `${PREFIX}-runtime`);
  const checks = [];
  let policiesInstalled = false;
  await owner.connect();
  await runtime.connect();
  try {
    assert.deepEqual(
      await fixtureCounts(owner),
      {
        users: 0,
        sellers: 0,
        listings: 0,
        orders: 0,
        items: 0,
        cases: 0,
        messages: 0,
      },
      "Case account-export proof found pre-existing fixtures",
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
          'public',
          procedure.oid,
          'EXECUTE'
        ) AS public_execute
        FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid =
         'public.grainline_case_export_page(text,timestamp,text,integer)'
           ::pg_catalog.regprocedure
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
         'public."Case"'::pg_catalog.regclass
       )
       ORDER BY relname
    `);
    assert.equal(
      originalRls.rows.every(
        (row) => !row.relrowsecurity && !row.relforcerowsecurity,
      ),
      true,
      "Case account-export proof requires compatible pre-RLS posture",
    );
    policiesInstalled = true;
    await installProofPolicies(owner);
    checks.push("forced-participant-policies-installed");

    const first = await exportPage(runtime, ids.buyer, { limit: 2 });
    assert.deepEqual(
      first.rows.map((row) => row.id),
      [ids.tieCaseB, ids.tieCaseA],
    );
    first.rows.forEach(assertMinimalRow);
    const second = await exportPage(runtime, ids.buyer, {
      cursorCreatedAt: first.rows[1].createdAt,
      cursorId: first.rows[1].id,
      limit: 2,
    });
    assert.deepEqual(second.rows.map((row) => row.id), [ids.oldCase]);
    second.rows.forEach(assertMinimalRow);
    checks.push("participant-stable-keyset");

    const seller = await exportPage(runtime, ids.seller);
    assert.equal(seller.rowCount, 3);
    for (const actorId of [
      ids.outsider,
      ids.staff,
      ids.banned,
      `${PREFIX}-missing`,
    ]) {
      assert.equal((await exportPage(runtime, actorId)).rowCount, 0);
    }
    checks.push("participant-only-and-disabled-denial");

    for (const [params, sqlState] of [
      [["actor with spaces", null, null, 25], "22023"],
      [[ids.buyer, TIE_TIME, null, 25], "22023"],
      [[ids.buyer, null, "cursor with spaces", 25], "22023"],
      [[ids.buyer, null, null, 26], "22023"],
    ]) {
      await expectSqlState(
        () => runtimeQuery(
          runtime,
          `SELECT * FROM public.grainline_case_export_page($1,$2,$3,$4)`,
          params,
        ),
        sqlState,
      );
    }
    checks.push("invalid-input-denial");

    const direct = await runtimeQuery(
      runtime,
      'SELECT pg_catalog.count(*)::integer AS count FROM public."Case"',
    );
    assert.equal(direct.rows[0].count, 0);
    checks.push("unset-context-direct-read-zero");

    await runtime.query("BEGIN");
    await runtime.query("SET LOCAL ROLE grainline_app_runtime");
    const context = await runtime.query(`
      WITH exported AS MATERIALIZED (
        SELECT *
          FROM public.grainline_case_export_page($1, NULL, NULL, 1)
      )
      SELECT
        exported.id,
        pg_catalog.current_setting('app.user_id', true) AS actor
        FROM exported
    `, [ids.buyer]);
    assert.equal(context.rows[0]?.actor, ids.buyer);
    await runtime.query("COMMIT");
    const afterCommit = await runtime.query(`
      SELECT pg_catalog.current_setting('app.user_id', true) AS actor
    `);
    assert.ok(
      afterCommit.rows[0]?.actor === null
        || afterCommit.rows[0]?.actor === "",
      "Case account-export actor context leaked after commit",
    );
    checks.push("transaction-local-context");

    assert.deepEqual(
      await fixtureCounts(owner),
      {
        users: 5,
        sellers: 1,
        listings: 1,
        orders: 3,
        items: 3,
        cases: 3,
        messages: 3,
      },
      "Case account-export proof changed protected state",
    );
    checks.push("expected-state-before-cleanup");
  } finally {
    await runtime.query("ROLLBACK").catch(() => {});
    if (policiesInstalled) {
      await removeProofPolicies(owner);
    }
    await cleanupFixtures(owner).catch(() => {});
    const residue = await fixtureCounts(owner).catch(() => null);
    await Promise.all([
      owner.end().catch(() => {}),
      runtime.end().catch(() => {}),
    ]);
    assert.deepEqual(
      residue,
      {
        users: 0,
        sellers: 0,
        listings: 0,
        orders: 0,
        items: 0,
        cases: 0,
        messages: 0,
      },
      "Case account-export proof left fixture residue",
    );
  }
  checks.push("cleanup-zero-residue");
  assert.equal(checks.length, 11);
  return Object.freeze({ checks: Object.freeze([...checks]) });
}

const isDirectRun =
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  runCaseAccountExportAuthorityProof()
    .then(({ checks }) => {
      process.stdout.write(
        `Case account-export PostgreSQL proof passed ${checks.length} checks.\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(
        `Case account-export PostgreSQL proof failed: ${safeError(error)}\n`,
      );
      process.exitCode = 1;
    });
}
