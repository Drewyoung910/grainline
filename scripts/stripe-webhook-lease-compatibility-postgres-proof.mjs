#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "STRIPE_WEBHOOK_LEASE_COMPATIBILITY_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const DRAFT = "docs/rls-drafts/stripe-webhook-lease-compatibility.sql";

const ids = Object.freeze({
  fresh: "evt_grainline_lease_proof_fresh",
  stale: "evt_grainline_lease_proof_stale",
});

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseStripeWebhookLeaseCompatibilityProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.protocol, "postgresql:", "Stripe lease proof requires PostgreSQL");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Stripe lease proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Stripe lease proof requires the ${DATABASE_NAME} database`,
  );
  return Object.freeze({ databaseUrl });
}

export function readStripeWebhookLeaseDraftBody(path = DRAFT) {
  const sql = fs.readFileSync(path, "utf8").trim();
  assert.match(sql, /\bDRAFT ONLY\b/);
  assert.match(sql, /^--[\s\S]*?\nBEGIN;\s*/);
  assert.match(sql, /\sCOMMIT;\s*$/);
  return sql
    .replace(/^([\s\S]*?\n)BEGIN;\s*/, "$1")
    .replace(/\sCOMMIT;\s*$/, "\n");
}

async function runtimeQuery(client, text, values = []) {
  await client.query("SET LOCAL ROLE grainline_app_runtime");
  try {
    return await client.query(text, values);
  } finally {
    await client.query("RESET ROLE");
  }
}

async function expectRuntimePostgresError(client, name, work, pattern) {
  const savepoint = `proof_${name.replace(/[^a-z0-9_]/gi, "_")}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  let caught;
  try {
    await client.query("SET LOCAL ROLE grainline_app_runtime");
    await work();
  } catch (error) {
    caught = error;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query("RESET ROLE");
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  assert.ok(caught, `${name} unexpectedly succeeded`);
  assert.match(safeError(caught), pattern);
}

async function callBegin(client, id, type) {
  const result = await runtimeQuery(
    client,
    "SELECT action, claim_generation FROM public.grainline_stripe_webhook_begin($1, $2)",
    [id, type],
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

async function callComplete(client, id, generation) {
  const result = await runtimeQuery(
    client,
    "SELECT public.grainline_stripe_webhook_complete($1, $2) AS result",
    [id, generation],
  );
  return result.rows[0]?.result;
}

async function callFail(client, id, generation, error) {
  const result = await runtimeQuery(
    client,
    "SELECT public.grainline_stripe_webhook_fail($1, $2, $3) AS result",
    [id, generation, error],
  );
  return result.rows[0]?.result;
}

async function proveCatalog(client) {
  const catalog = await client.query(`
    SELECT
      (SELECT pg_catalog.count(*)::integer
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'StripeWebhookEvent'
          AND column_name = 'claimGeneration'
          AND data_type = 'bigint'
          AND is_nullable = 'NO') AS generation_column_count,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_constraint AS constraint_state
        WHERE constraint_state.conname = 'StripeWebhookEvent_claimGeneration_check'
          AND constraint_state.convalidated) AS generation_constraint_count,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_proc AS procedure
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND (
            procedure.proname,
            pg_catalog.oidvectortypes(procedure.proargtypes)
          ) IN (
            ('grainline_stripe_webhook_begin', 'text, text'),
            ('grainline_stripe_webhook_complete', 'text, bigint'),
            ('grainline_stripe_webhook_fail', 'text, bigint, text')
          )
          AND procedure.prosecdef
          AND procedure.proowner = (CURRENT_USER::pg_catalog.regrole)::oid
          AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
          AND pg_catalog.has_function_privilege(
            'grainline_app_runtime', procedure.oid, 'EXECUTE'
          )
          AND NOT EXISTS (
            SELECT 1
              FROM pg_catalog.aclexplode(
                COALESCE(
                  procedure.proacl,
                  pg_catalog.acldefault('f', procedure.proowner)
                )
              ) AS acl
             WHERE acl.grantee = 0
               AND acl.privilege_type = 'EXECUTE'
          )) AS reviewed_function_count
  `);
  assert.deepEqual(catalog.rows, [{
    generation_column_count: 1,
    generation_constraint_count: 1,
    reviewed_function_count: 3,
  }]);
}

async function proveLeaseLifecycle(client) {
  await expectRuntimePostgresError(
    client,
    "blank_identity",
    () => client.query(
      "SELECT * FROM public.grainline_stripe_webhook_begin($1, $2)",
      ["   ", "checkout.session.completed"],
    ),
    /event id is invalid/,
  );
  await expectRuntimePostgresError(
    client,
    "blank_type",
    () => client.query(
      "SELECT * FROM public.grainline_stripe_webhook_begin($1, $2)",
      ["evt_grainline_blank_type", "   "],
    ),
    /event type is invalid/,
  );

  assert.deepEqual(await callBegin(client, ids.fresh, "checkout.session.completed"), {
    action: "process",
    claim_generation: "1",
  });
  assert.deepEqual(await callBegin(client, ids.fresh, "checkout.session.completed"), {
    action: "in_progress",
    claim_generation: "1",
  });

  await expectRuntimePostgresError(
    client,
    "type_immutability",
    () => client.query(
      "SELECT * FROM public.grainline_stripe_webhook_begin($1, $2)",
      [ids.fresh, "charge.refunded"],
    ),
    /event type is immutable/,
  );

  assert.equal(await callFail(client, ids.fresh, "1", "x".repeat(900)), "failed");
  const failed = await client.query(`
    SELECT
      "claimGeneration"::text AS generation,
      "processingStartedAt" IS NULL AS released,
      pg_catalog.char_length("lastError") AS error_length
      FROM public."StripeWebhookEvent"
     WHERE id = $1
  `, [ids.fresh]);
  assert.deepEqual(failed.rows, [{
    generation: "1",
    released: true,
    error_length: 500,
  }]);

  assert.deepEqual(await callBegin(client, ids.fresh, "checkout.session.completed"), {
    action: "process",
    claim_generation: "2",
  });
  const activeStart = await client.query(
    'SELECT "processingStartedAt" FROM public."StripeWebhookEvent" WHERE id = $1',
    [ids.fresh],
  );

  assert.equal(await callComplete(client, ids.fresh, "1"), "superseded");
  assert.equal(await callFail(client, ids.fresh, "1", "stale worker"), "superseded");
  const afterStaleFinalizers = await client.query(`
    SELECT
      "claimGeneration"::text AS generation,
      "processedAt" IS NULL AS unprocessed,
      "processingStartedAt" = $2 AS same_started_at,
      "lastError" IS NULL AS error_clear
      FROM public."StripeWebhookEvent"
     WHERE id = $1
  `, [ids.fresh, activeStart.rows[0].processingStartedAt]);
  assert.deepEqual(afterStaleFinalizers.rows, [{
    generation: "2",
    unprocessed: true,
    same_started_at: true,
    error_clear: true,
  }]);

  assert.equal(await callComplete(client, ids.fresh, "2"), "completed");
  assert.equal(await callComplete(client, ids.fresh, "2"), "already_processed");
  assert.deepEqual(await callBegin(client, ids.fresh, "checkout.session.completed"), {
    action: "processed",
    claim_generation: "2",
  });
}

async function proveDatabaseClockStaleReclaim(client) {
  await client.query(`
    INSERT INTO public."StripeWebhookEvent" (
      id,
      type,
      "claimGeneration",
      "processingStartedAt",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      $1,
      'account.updated',
      7,
      pg_catalog.clock_timestamp() - interval '3 minutes',
      pg_catalog.clock_timestamp() - interval '4 minutes',
      pg_catalog.clock_timestamp() - interval '3 minutes'
    )
  `, [ids.stale]);

  const before = await client.query("SELECT pg_catalog.clock_timestamp() AS now");
  assert.deepEqual(await callBegin(client, ids.stale, "account.updated"), {
    action: "process",
    claim_generation: "8",
  });
  const after = await client.query("SELECT pg_catalog.clock_timestamp() AS now");
  const row = await client.query(`
    SELECT "processingStartedAt" AS started
      FROM public."StripeWebhookEvent"
     WHERE id = $1
  `, [ids.stale]);
  assert.ok(row.rows[0].started >= before.rows[0].now);
  assert.ok(row.rows[0].started <= after.rows[0].now);
}

export async function runStripeWebhookLeaseCompatibilityProof(env = process.env) {
  const { databaseUrl } = parseStripeWebhookLeaseCompatibilityProofConfig(env);
  const draftBody = readStripeWebhookLeaseDraftBody();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let originalCatalog;
  try {
    originalCatalog = await client.query(`
      SELECT
        (SELECT pg_catalog.count(*)::integer
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'StripeWebhookEvent'
            AND column_name = 'claimGeneration') AS column_count,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_proc AS procedure
           JOIN pg_catalog.pg_namespace AS namespace
             ON namespace.oid = procedure.pronamespace
          WHERE namespace.nspname = 'public'
            AND procedure.proname LIKE 'grainline_stripe_webhook_%') AS function_count
    `);
    assert.deepEqual(originalCatalog.rows, [{ column_count: 0, function_count: 0 }]);

    await client.query("BEGIN");
    await client.query(draftBody);
    await proveCatalog(client);
    await proveLeaseLifecycle(client);
    await proveDatabaseClockStaleReclaim(client);
    await client.query("ROLLBACK");

    const restoredCatalog = await client.query(`
      SELECT
        (SELECT pg_catalog.count(*)::integer
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'StripeWebhookEvent'
            AND column_name = 'claimGeneration') AS column_count,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_proc AS procedure
           JOIN pg_catalog.pg_namespace AS namespace
             ON namespace.oid = procedure.pronamespace
          WHERE namespace.nspname = 'public'
            AND procedure.proname LIKE 'grainline_stripe_webhook_%') AS function_count,
        (SELECT pg_catalog.count(*)::integer
           FROM public."StripeWebhookEvent"
          WHERE id IN ($1, $2)) AS residue_count
    `, [ids.fresh, ids.stale]);
    assert.deepEqual(restoredCatalog.rows, [{
      column_count: 0,
      function_count: 0,
      residue_count: 0,
    }]);

    return Object.freeze({
      database: DATABASE_NAME,
      checks: 10,
      rolledBack: true,
      productionTouched: false,
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    const result = await runStripeWebhookLeaseCompatibilityProof();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Stripe webhook lease compatibility proof failed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}
