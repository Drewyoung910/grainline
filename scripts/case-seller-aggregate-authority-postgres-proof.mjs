#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "CASE_SELLER_AGGREGATE_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const PREFIX = "case-seller-aggregate-proof";
const OLD_TIME = new Date("2025-01-01T00:00:00.000Z");

const ids = Object.freeze({
  buyer: `${PREFIX}-buyer`,
  sellerUser: `${PREFIX}-seller-user`,
  seller: `${PREFIX}-seller`,
  reinstatableUser: `${PREFIX}-reinstatable-user`,
  reinstatableSeller: `${PREFIX}-reinstatable-seller`,
  plainUser: `${PREFIX}-plain-user`,
  plainSeller: `${PREFIX}-plain-seller`,
  bannedUser: `${PREFIX}-banned-user`,
  bannedSeller: `${PREFIX}-banned-seller`,
  foreignUser: `${PREFIX}-foreign-user`,
  staffUser: `${PREFIX}-staff-user`,
  bannedStaffUser: `${PREFIX}-banned-staff-user`,
  oldActiveOrder: `${PREFIX}-order-old-active`,
  recentActiveOrder: `${PREFIX}-order-recent-active`,
  oldClosedOrder: `${PREFIX}-order-old-closed`,
});

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseCaseSellerAggregateProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Case seller aggregate proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Case seller aggregate proof requires the ${DATABASE_NAME} database`,
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

async function seedUser(
  client,
  id,
  { role = "USER", banned = false } = {},
) {
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

async function seedSeller(
  client,
  id,
  userId,
  { guildLevel = "NONE", guildMemberApprovedAt = null } = {},
) {
  await client.query(`
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "displayNameNormalized",
      "guildLevel", "guildMemberApprovedAt",
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, $3, $4,
      $5::public."GuildLevel", $6,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [
    id,
    userId,
    `Seller ${id}`,
    `seller ${id}`,
    guildLevel,
    guildMemberApprovedAt,
  ]);
}

async function seedCase(
  client,
  { orderId, status, createdAt, suffix },
) {
  await client.query(
    'INSERT INTO public."Order" (id, "buyerId") VALUES ($1, $2)',
    [orderId, ids.buyer],
  );
  await client.query(`
    INSERT INTO public."Case" (
      id, "orderId", "buyerId", "sellerId", reason, description,
      status, resolution, "sellerRespondBy", "resolvedAt",
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, $3, $4,
      'DAMAGED'::public."CaseReason",
      'Disposable seller aggregate authority proof.',
      $5::public."CaseStatus",
      CASE
        WHEN $5::text IN ('RESOLVED', 'CLOSED')
          THEN 'DISMISSED'::public."CaseResolution"
        ELSE NULL
      END,
      CURRENT_TIMESTAMP + INTERVAL '48 hours',
      CASE
        WHEN $5::text IN ('RESOLVED', 'CLOSED')
          THEN CURRENT_TIMESTAMP
        ELSE NULL
      END,
      $6,
      CURRENT_TIMESTAMP
    )
  `, [
    `${PREFIX}-case-${suffix}`,
    orderId,
    ids.buyer,
    ids.sellerUser,
    status,
    createdAt,
  ]);
}

async function seedFixtures(client) {
  await client.query("BEGIN");
  try {
    await seedUser(client, ids.buyer);
    await seedUser(client, ids.sellerUser);
    await seedUser(client, ids.reinstatableUser);
    await seedUser(client, ids.plainUser);
    await seedUser(client, ids.bannedUser, { banned: true });
    await seedUser(client, ids.foreignUser);
    await seedUser(client, ids.staffUser, { role: "EMPLOYEE" });
    await seedUser(client, ids.bannedStaffUser, {
      role: "ADMIN",
      banned: true,
    });

    await seedSeller(client, ids.seller, ids.sellerUser, {
      guildLevel: "GUILD_MEMBER",
      guildMemberApprovedAt: OLD_TIME,
    });
    await seedSeller(
      client,
      ids.reinstatableSeller,
      ids.reinstatableUser,
      { guildMemberApprovedAt: OLD_TIME },
    );
    await seedSeller(client, ids.plainSeller, ids.plainUser);
    await seedSeller(client, ids.bannedSeller, ids.bannedUser);

    await seedCase(client, {
      orderId: ids.oldActiveOrder,
      status: "OPEN",
      createdAt: OLD_TIME,
      suffix: "old-active",
    });
    await seedCase(client, {
      orderId: ids.recentActiveOrder,
      status: "UNDER_REVIEW",
      createdAt: new Date(),
      suffix: "recent-active",
    });
    await seedCase(client, {
      orderId: ids.oldClosedOrder,
      status: "CLOSED",
      createdAt: OLD_TIME,
      suffix: "old-closed",
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
         FROM public."Order" WHERE id LIKE $1) AS orders,
      (SELECT pg_catalog.count(*)::integer
         FROM public."Case" WHERE id LIKE $1) AS cases
  `, [`${PREFIX}%`]);
  return result.rows[0];
}

async function setProofRls(client) {
  for (const table of ["User", "SellerProfile", "Case"]) {
    await client.query(
      `ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`,
    );
    await client.query(
      `ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY`,
    );
  }
}

async function restoreProofRls(client) {
  for (const table of ["Case", "SellerProfile", "User"]) {
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
      'DELETE FROM public."Case" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Order" WHERE id LIKE $1',
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

async function verificationEligibility(client, actorId, sellerProfileId) {
  return runtimeQuery(
    client,
    `
      SELECT *
        FROM public.grainline_case_seller_verification_eligibility(
          $1,
          $2
        )
    `,
    [actorId, sellerProfileId],
  );
}

async function guildGuard(client, sellerProfileId) {
  return runtimeQuery(
    client,
    `
      SELECT *
        FROM public.grainline_case_guild_unresolved_guard($1)
    `,
    [sellerProfileId],
  );
}

async function expectSqlState(run, sqlState) {
  await assert.rejects(run, (error) => {
    assert.equal(error?.code, sqlState);
    return true;
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runCaseSellerAggregateProof(env = process.env) {
  const { databaseUrl } = parseCaseSellerAggregateProofConfig(env);
  const owner = createClient(databaseUrl, `${PREFIX}-owner`);
  const runtime = createClient(databaseUrl, `${PREFIX}-runtime`);
  const contender = createClient(databaseUrl, `${PREFIX}-contender`);
  const checks = [];
  let rlsChanged = false;
  await owner.connect();
  await runtime.connect();
  await contender.connect();
  try {
    assert.deepEqual(
      await fixtureCounts(owner),
      { users: 0, sellers: 0, orders: 0, cases: 0 },
      "Case seller aggregate proof found pre-existing fixtures",
    );
    checks.push("preflight-zero-residue");
    await seedFixtures(owner);
    checks.push("fixtures-seeded");

    const catalog = await owner.query(`
      SELECT
        procedure.proname,
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
       WHERE procedure.oid IN (
         'public.grainline_case_seller_active_count(text)'::pg_catalog.regprocedure,
         'public.grainline_case_seller_verification_eligibility(text,text)'::pg_catalog.regprocedure,
         'public.grainline_case_guild_unresolved_guard(text)'::pg_catalog.regprocedure
       )
       ORDER BY procedure.proname
    `);
    assert.deepEqual(
      catalog.rows,
      [
        "grainline_case_guild_unresolved_guard",
        "grainline_case_seller_active_count",
        "grainline_case_seller_verification_eligibility",
      ].map((proname) => ({
        proname,
        prosecdef: true,
        provolatile: "v",
        proparallel: "u",
        proconfig: ["search_path=pg_catalog"],
        runtime_execute: true,
        public_execute: false,
      })),
    );
    checks.push("catalog-and-grants");

    const originalRls = await owner.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_catalog.pg_class
       WHERE oid IN (
         'public."User"'::pg_catalog.regclass,
         'public."SellerProfile"'::pg_catalog.regclass,
         'public."Case"'::pg_catalog.regclass
       )
       ORDER BY relname
    `);
    assert.equal(
      originalRls.rows.every(
        (row) => !row.relrowsecurity && !row.relforcerowsecurity,
      ),
      true,
      "Case seller aggregate proof requires the compatible pre-RLS posture",
    );
    rlsChanged = true;
    await setProofRls(owner);
    checks.push("forced-rls-source-posture");

    const activeCount = await runtimeQuery(
      runtime,
      "SELECT * FROM public.grainline_case_seller_active_count($1)",
      [ids.seller],
    );
    assert.equal(activeCount.rowCount, 1);
    assert.equal(Number(activeCount.rows[0].activeCount), 2);
    const bannedCount = await runtimeQuery(
      runtime,
      "SELECT * FROM public.grainline_case_seller_active_count($1)",
      [ids.bannedSeller],
    );
    assert.equal(bannedCount.rowCount, 0);
    checks.push("metrics-active-count-only");

    for (const actorId of [ids.sellerUser, ids.staffUser]) {
      const result = await verificationEligibility(
        runtime,
        actorId,
        ids.seller,
      );
      assert.equal(result.rowCount, 1);
      assert.equal(Number(result.rows[0].agedUnresolvedCount), 1);
    }
    checks.push("seller-and-staff-verification-count");

    for (const actorId of [
      ids.foreignUser,
      ids.bannedStaffUser,
      `${PREFIX}-missing-user`,
    ]) {
      const result = await verificationEligibility(
        runtime,
        actorId,
        ids.seller,
      );
      assert.equal(result.rowCount, 0);
    }
    checks.push("foreign-disabled-verification-denial");

    const currentGuild = await guildGuard(runtime, ids.seller);
    assert.equal(currentGuild.rowCount, 1);
    assert.equal(currentGuild.rows[0].blocked, true);
    const reinstatable = await guildGuard(runtime, ids.reinstatableSeller);
    assert.equal(reinstatable.rowCount, 1);
    assert.equal(reinstatable.rows[0].blocked, false);
    const plain = await guildGuard(runtime, ids.plainSeller);
    assert.equal(plain.rowCount, 0);
    const banned = await guildGuard(runtime, ids.bannedSeller);
    assert.equal(banned.rowCount, 0);
    checks.push("guild-and-reinstatement-state-binding");

    for (const [sql, params] of [
      [
        "SELECT * FROM public.grainline_case_seller_active_count($1)",
        ["x".repeat(192)],
      ],
      [
        "SELECT * FROM public.grainline_case_seller_verification_eligibility($1, $2)",
        ["x".repeat(129), ids.seller],
      ],
      [
        "SELECT * FROM public.grainline_case_guild_unresolved_guard($1)",
        [""],
      ],
    ]) {
      await expectSqlState(
        () => runtimeQuery(runtime, sql, params),
        "22023",
      );
    }
    checks.push("invalid-input-denial");

    for (const table of ["User", "SellerProfile", "Case"]) {
      const direct = await runtimeQuery(
        runtime,
        `SELECT pg_catalog.count(*)::integer AS count
           FROM public."${table}"`,
      );
      assert.equal(direct.rows[0].count, 0);
    }
    checks.push("function-only-forced-rls-read");

    await runtime.query("BEGIN");
    await runtime.query("SET LOCAL ROLE grainline_app_runtime");
    const locked = await runtime.query(
      "SELECT * FROM public.grainline_case_guild_unresolved_guard($1)",
      [ids.seller],
    );
    assert.equal(locked.rows[0].blocked, true);
    await contender.query("BEGIN");
    const competingLock = contender.query(
      'SELECT id FROM public."Case" WHERE id = $1 FOR UPDATE',
      [`${PREFIX}-case-old-active`],
    );
    const acquiredEarly = await Promise.race([
      competingLock.then(() => true),
      delay(200).then(() => false),
    ]);
    assert.equal(
      acquiredEarly,
      false,
      "Guild guard did not retain the blocking Case row lock",
    );
    await runtime.query("COMMIT");
    await competingLock;
    await contender.query("ROLLBACK");
    checks.push("guild-blocking-case-lock");

    await runtime.query("BEGIN");
    await runtime.query("SET LOCAL ROLE grainline_app_runtime");
    await runtime.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [`${PREFIX}-caller-context`],
    );
    const contextGuard = await runtime.query(
      `
        SELECT
          aggregate_row."activeCount",
          pg_catalog.current_setting('app.user_id', true) AS actor
          FROM public.grainline_case_seller_active_count($1)
            AS aggregate_row
      `,
      [ids.seller],
    );
    assert.equal(Number(contextGuard.rows[0].activeCount), 2);
    assert.equal(
      contextGuard.rows[0].actor,
      `${PREFIX}-caller-context`,
      "Case seller aggregate authority changed the caller's RLS context",
    );
    await runtime.query("ROLLBACK");
    checks.push("caller-context-unchanged");

    assert.deepEqual(
      await fixtureCounts(owner),
      { users: 8, sellers: 4, orders: 3, cases: 3 },
      "Case seller aggregate proof changed protected state",
    );
    checks.push("expected-state-before-cleanup");
  } finally {
    await runtime.query("ROLLBACK").catch(() => {});
    await contender.query("ROLLBACK").catch(() => {});
    if (rlsChanged) {
      await restoreProofRls(owner);
    }
    await cleanupFixtures(owner).catch(() => {});
    const residue = await fixtureCounts(owner).catch(() => null);
    await Promise.all([
      owner.end().catch(() => {}),
      runtime.end().catch(() => {}),
      contender.end().catch(() => {}),
    ]);
    assert.deepEqual(
      residue,
      { users: 0, sellers: 0, orders: 0, cases: 0 },
      "Case seller aggregate proof left fixture residue",
    );
  }
  assert.equal(checks.length, 13);
  return Object.freeze({ checks: Object.freeze([...checks]) });
}

const isDirectRun =
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  runCaseSellerAggregateProof()
    .then(({ checks }) => {
      process.stdout.write(
        `Case seller aggregate PostgreSQL proof passed ${checks.length} checks.\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(
        `Case seller aggregate PostgreSQL proof failed: ${safeError(error)}\n`,
      );
      process.exitCode = 1;
    });
}
