#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "SELLER_PAYOUT_EVENT_AUTHORITY_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const MIGRATION_ROLE = "ci";
const RUNTIME_ROLE = "grainline_app_runtime";
const PREFIX = "seller-payout-authority-proof";
const ADVISORY_SALT = 620081501;

const ids = Object.freeze({
  userOne: `${PREFIX}-user-1`,
  userTwo: `${PREFIX}-user-2`,
  sellerOne: `${PREFIX}-seller-1`,
  sellerTwo: `${PREFIX}-seller-2`,
  accountOne: `acct_${PREFIX}_1`,
  accountTwo: `acct_${PREFIX}_2`,
  mainPayout: `po_${PREFIX}_main`,
  concurrentPayout: `po_${PREFIX}_concurrent`,
});

const functionIdentities = Object.freeze([
  "grainline_seller_payout_event_apply(text,bigint,bigint,text,text,integer,text,text,text)",
  "grainline_seller_payout_latest_failure(text)",
  "grainline_seller_payout_export_page(text,integer,bigint,text)",
]);

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseSellerPayoutEventAuthorityProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.protocol, "postgresql:");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Seller payout authority proof refuses a non-loopback database",
  );
  assert.equal(parsed.pathname, `/${DATABASE_NAME}`);
  assert.equal(decodeURIComponent(parsed.username), MIGRATION_ROLE);
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
    await client.query(`SET LOCAL ROLE ${RUNTIME_ROLE}`);
    const result = await client.query(sql, params);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function expectRuntimeError(client, label, work, expectedCode, pattern) {
  let caught;
  try {
    await runtimeQuery(client, work.sql, work.params);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${label} unexpectedly succeeded`);
  assert.equal(caught.code, expectedCode, `${label} returned the wrong SQLSTATE`);
  assert.match(safeError(caught), pattern, label);
}

function payoutCall(eventId, eventCreatedSeconds, payoutId, overrides = {}) {
  return {
    sql: `
      SELECT action, payout_event_id, seller_user_id
        FROM public.grainline_seller_payout_event_apply(
          $1, $2, $3, $4, $5, $6, $7, $8, $9
        )
    `,
    params: [
      eventId,
      overrides.claimGeneration ?? 1,
      eventCreatedSeconds,
      overrides.accountId ?? ids.accountOne,
      payoutId,
      overrides.amountCents ?? 100,
      overrides.currency ?? "usd",
      overrides.failureCode ?? "proof_failure",
      overrides.failureMessage ?? "Disposable seller payout authority proof.",
    ],
  };
}

async function applyPayout(client, eventId, eventCreatedSeconds, payoutId, overrides) {
  const call = payoutCall(eventId, eventCreatedSeconds, payoutId, overrides);
  const result = await runtimeQuery(client, call.sql, call.params);
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

async function seedEvent(client, eventId, payoutId) {
  await client.query(`
    INSERT INTO public."StripeWebhookEvent" (
      id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
    ) VALUES ($1, 'payout.failed', $2, 1, CURRENT_TIMESTAMP)
  `, [eventId, payoutId]);
}

async function cleanFixtures(client) {
  await client.query(
    'DELETE FROM public."SellerPayoutEvent" WHERE "stripePayoutId" LIKE $1',
    [`po_${PREFIX}%`],
  );
  await client.query(
    'DELETE FROM public."StripeWebhookEvent" WHERE id LIKE $1',
    [`evt_${PREFIX}%`],
  );
  await client.query(
    'DELETE FROM public."SellerProfile" WHERE id IN ($1, $2)',
    [ids.sellerOne, ids.sellerTwo],
  );
  await client.query(
    'DELETE FROM public."User" WHERE id IN ($1, $2)',
    [ids.userOne, ids.userTwo],
  );
}

async function seedFixtures(client) {
  await cleanFixtures(client);
  await client.query(`
    INSERT INTO public."User" (
      id, "clerkId", email, name, role, "createdAt", "updatedAt"
    ) VALUES
      ($1, $2, $3, 'Payout authority proof one', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($4, $5, $6, 'Payout authority proof two', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    ids.userOne,
    `clerk-${ids.userOne}`,
    `${ids.userOne}@example.invalid`,
    ids.userTwo,
    `clerk-${ids.userTwo}`,
    `${ids.userTwo}@example.invalid`,
  ]);
  await client.query(`
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "displayNameNormalized",
      "stripeAccountId", "createdAt", "updatedAt"
    ) VALUES
      ($1, $2, 'Payout proof one', 'payout proof one', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($4, $5, 'Payout proof two', 'payout proof two', $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    ids.sellerOne,
    ids.userOne,
    ids.accountOne,
    ids.sellerTwo,
    ids.userTwo,
    ids.accountTwo,
  ]);
}

async function verifyCatalog(client) {
  const identity = await client.query(`
    SELECT current_database() AS database_name, CURRENT_USER AS current_user
  `);
  assert.deepEqual(identity.rows, [{
    database_name: DATABASE_NAME,
    current_user: MIGRATION_ROLE,
  }]);

  const table = await client.query(`
    SELECT
      c.relrowsecurity AS rls_enabled,
      c.relforcerowsecurity AS rls_forced,
      pg_catalog.has_table_privilege($1, c.oid, 'SELECT') AS can_select,
      pg_catalog.has_table_privilege($1, c.oid, 'INSERT') AS can_insert,
      pg_catalog.has_table_privilege($1, c.oid, 'UPDATE') AS can_update,
      pg_catalog.has_table_privilege($1, c.oid, 'DELETE') AS can_delete,
      EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))
        ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = ANY(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
      ) AS public_crud
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'SellerPayoutEvent'
  `, [RUNTIME_ROLE]);
  assert.deepEqual(table.rows, [{
    rls_enabled: false,
    rls_forced: false,
    can_select: true,
    can_insert: true,
    can_update: true,
    can_delete: true,
    public_crud: false,
  }]);

  const functions = await client.query(`
    SELECT
      p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' AS identity,
      p.prosecdef AS security_definer,
      p.proconfig AS config,
      pg_catalog.pg_get_userbyid(p.proowner) AS owner,
      pg_catalog.has_function_privilege($1, p.oid, 'EXECUTE') AS runtime_execute,
      EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
        ) AS acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
      ) AS public_execute
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY($2::text[])
    ORDER BY identity
  `, [RUNTIME_ROLE, functionIdentities.map((identity) => identity.slice(0, identity.indexOf("(")))]);
  assert.deepEqual(
    functions.rows.map((row) => row.identity),
    [...functionIdentities].sort(),
  );
  for (const row of functions.rows) {
    assert.equal(row.security_definer, true, row.identity);
    assert.deepEqual(row.config, ["search_path=pg_catalog"], row.identity);
    assert.equal(row.owner, MIGRATION_ROLE, row.identity);
    assert.equal(row.runtime_execute, true, row.identity);
    assert.equal(row.public_execute, false, row.identity);
  }
}

async function waitForAdvisoryWaiters(client, applicationNames) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
      FROM pg_catalog.pg_stat_activity
      WHERE application_name = ANY($1::text[])
        AND wait_event_type = 'Lock'
        AND wait_event = 'advisory'
    `, [applicationNames]);
    if (waiting.rows[0]?.count === applicationNames.length) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("concurrent payout calls did not both wait on the advisory lock");
}

export async function runSellerPayoutEventAuthorityProof(env = process.env) {
  const { databaseUrl } = parseSellerPayoutEventAuthorityProofConfig(env);
  const admin = createClient(databaseUrl, `${PREFIX}-admin`);
  const locker = createClient(databaseUrl, `${PREFIX}-locker`);
  const older = createClient(databaseUrl, `${PREFIX}-older`);
  const newer = createClient(databaseUrl, `${PREFIX}-newer`);
  const clients = [admin, locker, older, newer];
  let concurrentPromises = [];
  for (const client of clients) await client.connect();

  const nowResult = await admin.query(
    "SELECT pg_catalog.floor(EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()))::bigint AS now_seconds",
  );
  const now = Number(nowResult.rows[0].now_seconds);
  try {
    await verifyCatalog(admin);
    await seedFixtures(admin);

    await seedEvent(admin, `evt_${PREFIX}_forged`, `po_${PREFIX}_real`);
    const forged = payoutCall(
      `evt_${PREFIX}_forged`,
      now - 5,
      `po_${PREFIX}_forged`,
    );
    await expectRuntimeError(
      admin,
      "forged payout source",
      forged,
      "23514",
      /webhook claim is invalid/,
    );

    await seedEvent(admin, `evt_${PREFIX}_unknown`, `po_${PREFIX}_unknown`);
    const ignored = await applyPayout(
      admin,
      `evt_${PREFIX}_unknown`,
      now - 5,
      `po_${PREFIX}_unknown`,
      { accountId: `acct_${PREFIX}_unknown` },
    );
    assert.deepEqual(ignored, {
      action: "ignored_unknown_account",
      payout_event_id: null,
      seller_user_id: null,
    });

    await seedEvent(admin, `evt_${PREFIX}_main`, ids.mainPayout);
    const inserted = await applyPayout(
      admin,
      `evt_${PREFIX}_main`,
      now - 4,
      ids.mainPayout,
    );
    assert.equal(inserted.action, "inserted");
    assert.equal(inserted.seller_user_id, ids.userOne);
    const replay = await applyPayout(
      admin,
      `evt_${PREFIX}_main`,
      now - 4,
      ids.mainPayout,
    );
    assert.equal(replay.action, "already_applied");
    assert.equal(replay.payout_event_id, inserted.payout_event_id);

    const ownLatest = await runtimeQuery(
      admin,
      "SELECT * FROM public.grainline_seller_payout_latest_failure($1)",
      [ids.userOne],
    );
    assert.equal(ownLatest.rowCount, 1);
    assert.equal(ownLatest.rows[0].payout_event_id, inserted.payout_event_id);
    const foreignLatest = await runtimeQuery(
      admin,
      "SELECT * FROM public.grainline_seller_payout_latest_failure($1)",
      [ids.userTwo],
    );
    assert.equal(foreignLatest.rowCount, 0);
    const exported = await runtimeQuery(
      admin,
      `SELECT * FROM public.grainline_seller_payout_export_page($1, 10000, NULL, NULL)`,
      [ids.userOne],
    );
    assert.equal(exported.rowCount, 1);
    assert.equal(exported.rows[0].seller_profile_id, ids.sellerOne);

    const oldEvent = `evt_${PREFIX}_concurrent_old`;
    const newEvent = `evt_${PREFIX}_concurrent_new`;
    await seedEvent(admin, oldEvent, ids.concurrentPayout);
    await seedEvent(admin, newEvent, ids.concurrentPayout);
    await locker.query("BEGIN");
    await locker.query(
      "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, $2))",
      [ids.concurrentPayout, ADVISORY_SALT],
    );
    const oldPromise = applyPayout(
      older,
      oldEvent,
      now - 3,
      ids.concurrentPayout,
      { failureMessage: "Older concurrent payout." },
    );
    const newPromise = applyPayout(
      newer,
      newEvent,
      now - 2,
      ids.concurrentPayout,
      { amountCents: 125, failureMessage: "Newer concurrent payout." },
    );
    concurrentPromises = [oldPromise, newPromise];
    await waitForAdvisoryWaiters(admin, [
      `${PREFIX}-older`,
      `${PREFIX}-newer`,
    ]);
    await locker.query("COMMIT");
    const concurrent = await Promise.all(concurrentPromises);
    concurrentPromises = [];
    assert.ok(
      concurrent.every((row) => ["inserted", "updated", "stale_ignored"].includes(row.action)),
      "concurrent calls returned an unexpected action",
    );
    assert.equal(
      concurrent.filter((row) => row.action === "inserted").length,
      1,
      "concurrent first insert was not singular",
    );
    assert.equal(
      concurrent.filter((row) => ["updated", "stale_ignored"].includes(row.action)).length,
      1,
      "concurrent second event did not converge by event ordering",
    );
    const finalConcurrent = await admin.query(`
      SELECT "stripeEventId", "stripeEventCreatedSeconds", "amountCents"
      FROM public."SellerPayoutEvent"
      WHERE "stripePayoutId" = $1
    `, [ids.concurrentPayout]);
    assert.deepEqual(finalConcurrent.rows, [{
      stripeEventId: newEvent,
      stripeEventCreatedSeconds: String(now - 2),
      amountCents: 125,
    }]);

    return Object.freeze({
      database: DATABASE_NAME,
      migrationRole: MIGRATION_ROLE,
      runtimeRole: RUNTIME_ROLE,
      compatibilityRlsEnabled: false,
      exactFunctions: functionIdentities.length,
      forgedSourceRejected: true,
      sellerProjectionIsolated: true,
      exactReplayIdempotent: true,
      concurrentOrderingSerialized: true,
      productionTouched: false,
    });
  } finally {
    await locker.query("ROLLBACK").catch(() => {});
    await Promise.allSettled(concurrentPromises);
    await cleanFixtures(admin).catch(() => {});
    for (const client of clients.reverse()) await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      await runSellerPayoutEventAuthorityProof(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `SellerPayoutEvent authority PostgreSQL proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}
