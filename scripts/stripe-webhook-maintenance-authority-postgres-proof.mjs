#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { verifyStripeWebhookMaintenanceAuthority } from "./verify-stripe-webhook-maintenance-authority.mjs";

const { Client } = pg;
const PROOF_ENV = "STRIPE_WEBHOOK_MAINTENANCE_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const runtimeRole = "grainline_app_runtime";

const ids = Object.freeze({
  oldFirst: "evt_grainline_maintenance_old_first",
  oldSecond: "evt_grainline_maintenance_old_second",
  recent: "evt_grainline_maintenance_recent",
  unprocessed: "evt_grainline_maintenance_unprocessed",
  failed: "evt_grainline_maintenance_failed",
  released: "evt_grainline_maintenance_released",
  stale: "evt_grainline_maintenance_stale",
  healthy: "evt_grainline_maintenance_healthy",
  claim: "cs_test_grainlinemaintenanceclaim",
  collisionType: "cs_test_grainlinemaintenancewrongtype",
  collisionOpen: "cs_test_grainlinemaintenanceopen",
  concurrency: "cs_test_grainlinemaintenanceconcurrency",
});

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseStripeWebhookMaintenanceProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.protocol, "postgresql:", "maintenance proof requires PostgreSQL");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "maintenance proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `maintenance proof requires the ${DATABASE_NAME} database`,
  );
  return Object.freeze({ databaseUrl });
}

async function runtimeQuery(client, text, values = []) {
  await client.query(`SET LOCAL ROLE ${runtimeRole}`);
  try {
    return await client.query(text, values);
  } finally {
    await client.query("RESET ROLE");
  }
}

async function expectRuntimeError(client, name, work, pattern) {
  const savepoint = `proof_${name.replace(/[^a-z0-9_]/gi, "_")}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  let caught;
  try {
    await client.query(`SET LOCAL ROLE ${runtimeRole}`);
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

async function proveCatalog(client) {
  const catalog = await client.query(`
    SELECT pg_catalog.count(*)::integer AS function_count
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND (
         procedure.proname,
         pg_catalog.oidvectortypes(procedure.proargtypes)
       ) IN (
         ('grainline_stripe_webhook_prune_batch', 'integer'),
         ('grainline_stripe_webhook_health_summary', ''),
         ('grainline_legacy_stock_restore_claim', 'text')
       )
       AND procedure.prosecdef
       AND procedure.proowner = (CURRENT_USER::pg_catalog.regrole)::oid
       AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.has_function_privilege(
         '${runtimeRole}', procedure.oid, 'EXECUTE'
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
       )
  `);
  assert.deepEqual(catalog.rows, [{ function_count: 3 }]);
}

async function seedRows(client) {
  await client.query(`
    INSERT INTO public."StripeWebhookEvent" (
      id, type, "claimGeneration", "processingStartedAt", "processedAt",
      "lastError", "createdAt", "updatedAt"
    ) VALUES
      ($1, 'proof.old', 1, NULL, (clock_timestamp() AT TIME ZONE 'UTC') - interval '92 days', NULL, (clock_timestamp() AT TIME ZONE 'UTC') - interval '92 days', (clock_timestamp() AT TIME ZONE 'UTC') - interval '92 days'),
      ($2, 'proof.old', 1, NULL, (clock_timestamp() AT TIME ZONE 'UTC') - interval '91 days', NULL, (clock_timestamp() AT TIME ZONE 'UTC') - interval '91 days', (clock_timestamp() AT TIME ZONE 'UTC') - interval '91 days'),
      ($3, 'proof.recent', 1, NULL, (clock_timestamp() AT TIME ZONE 'UTC') - interval '89 days', NULL, (clock_timestamp() AT TIME ZONE 'UTC') - interval '89 days', (clock_timestamp() AT TIME ZONE 'UTC') - interval '89 days'),
      ($4, 'proof.unprocessed', 1, (clock_timestamp() AT TIME ZONE 'UTC') - interval '30 seconds', NULL, NULL, (clock_timestamp() AT TIME ZONE 'UTC') - interval '100 days', (clock_timestamp() AT TIME ZONE 'UTC') - interval '30 seconds'),
      ($5, 'proof.failed', 2, NULL, NULL, 'fixed proof failure', (clock_timestamp() AT TIME ZONE 'UTC') - interval '4 minutes', (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 minute'),
      ($6, 'proof.released', 1, NULL, NULL, NULL, (clock_timestamp() AT TIME ZONE 'UTC') - interval '4 minutes', (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 minute'),
      ($7, 'proof.stale', 3, (clock_timestamp() AT TIME ZONE 'UTC') - interval '3 minutes', NULL, NULL, (clock_timestamp() AT TIME ZONE 'UTC') - interval '4 minutes', (clock_timestamp() AT TIME ZONE 'UTC') - interval '3 minutes'),
      ($8, 'proof.healthy', 1, (clock_timestamp() AT TIME ZONE 'UTC') - interval '30 seconds', NULL, NULL, (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 minute', (clock_timestamp() AT TIME ZONE 'UTC') - interval '30 seconds')
  `, [
    ids.oldFirst,
    ids.oldSecond,
    ids.recent,
    ids.unprocessed,
    ids.failed,
    ids.released,
    ids.stale,
    ids.healthy,
  ]);
}

async function provePruneAndHealth(client) {
  await expectRuntimeError(
    client,
    "invalid_limit",
    () => client.query("SELECT public.grainline_stripe_webhook_prune_batch(0)"),
    /prune limit is invalid/,
  );
  const first = await runtimeQuery(
    client,
    "SELECT public.grainline_stripe_webhook_prune_batch(1)::text AS deleted",
  );
  assert.deepEqual(first.rows, [{ deleted: "1" }]);
  const afterFirst = await client.query(`
    SELECT id FROM public."StripeWebhookEvent"
     WHERE id IN ($1, $2) ORDER BY id
  `, [ids.oldFirst, ids.oldSecond]);
  assert.deepEqual(afterFirst.rows, [{ id: ids.oldSecond }]);

  const second = await runtimeQuery(
    client,
    "SELECT public.grainline_stripe_webhook_prune_batch(5000)::text AS deleted",
  );
  assert.deepEqual(second.rows, [{ deleted: "1" }]);
  const survivors = await client.query(`
    SELECT id FROM public."StripeWebhookEvent"
     WHERE id IN ($1, $2) ORDER BY id
  `, [ids.recent, ids.unprocessed]);
  assert.deepEqual(survivors.rows, [
    { id: ids.recent },
    { id: ids.unprocessed },
  ].sort((left, right) => left.id.localeCompare(right.id)));

  const health = await runtimeQuery(client, `
    SELECT
      failed_count::text,
      released_count::text,
      stale_count::text,
      issue_count::text
      FROM public.grainline_stripe_webhook_health_summary()
  `);
  assert.deepEqual(health.rows, [{
    failed_count: "1",
    released_count: "2",
    stale_count: "1",
    issue_count: "3",
  }]);
}

async function proveLegacyClaim(client) {
  for (const [name, value, pattern] of [
    ["blank_claim", " ", /session id is invalid/],
    ["noncanonical_claim", "evt_not_a_checkout", /session id is invalid/],
  ]) {
    await expectRuntimeError(
      client,
      name,
      () => client.query(
        "SELECT public.grainline_legacy_stock_restore_claim($1)",
        [value],
      ),
      pattern,
    );
  }

  const first = await runtimeQuery(
    client,
    "SELECT public.grainline_legacy_stock_restore_claim($1) AS claimed",
    [ids.claim],
  );
  const replay = await runtimeQuery(
    client,
    "SELECT public.grainline_legacy_stock_restore_claim($1) AS claimed",
    [ids.claim],
  );
  assert.deepEqual(first.rows, [{ claimed: true }]);
  assert.deepEqual(replay.rows, [{ claimed: false }]);
  const canonical = await client.query(`
    SELECT id, type, "claimGeneration"::text AS generation,
           "processedAt" IS NOT NULL AS processed
      FROM public."StripeWebhookEvent"
     WHERE id = $1
  `, [`checkout-stock-restore:${ids.claim}`]);
  assert.deepEqual(canonical.rows, [{
    id: `checkout-stock-restore:${ids.claim}`,
    type: "checkout.session.stock_restored",
    generation: "1",
    processed: true,
  }]);

  await client.query(`
    INSERT INTO public."StripeWebhookEvent" (
      id, type, "claimGeneration", "processingStartedAt", "processedAt",
      "createdAt", "updatedAt"
    ) VALUES
      ($1, 'proof.wrong', 1, clock_timestamp() AT TIME ZONE 'UTC', clock_timestamp() AT TIME ZONE 'UTC', clock_timestamp() AT TIME ZONE 'UTC', clock_timestamp() AT TIME ZONE 'UTC'),
      ($2, 'checkout.session.stock_restored', 1, clock_timestamp() AT TIME ZONE 'UTC', NULL, clock_timestamp() AT TIME ZONE 'UTC', clock_timestamp() AT TIME ZONE 'UTC')
  `, [
    `checkout-stock-restore:${ids.collisionType}`,
    `checkout-stock-restore:${ids.collisionOpen}`,
  ]);
  for (const [name, value] of [
    ["wrong_type_collision", ids.collisionType],
    ["open_collision", ids.collisionOpen],
  ]) {
    await expectRuntimeError(
      client,
      name,
      () => client.query(
        "SELECT public.grainline_legacy_stock_restore_claim($1)",
        [value],
      ),
      /conflicts with an invalid event/,
    );
  }
}

async function proveClaimLock(databaseUrl) {
  const first = new Client({ connectionString: databaseUrl });
  const second = new Client({ connectionString: databaseUrl });
  await Promise.all([first.connect(), second.connect()]);
  try {
    await first.query("BEGIN");
    await second.query("BEGIN");
    const claimed = await runtimeQuery(
      first,
      "SELECT public.grainline_legacy_stock_restore_claim($1) AS claimed",
      [ids.concurrency],
    );
    assert.deepEqual(claimed.rows, [{ claimed: true }]);

    await second.query(`SET LOCAL ROLE ${runtimeRole}`);
    let settled = false;
    const waiting = second.query(
      "SELECT public.grainline_legacy_stock_restore_claim($1) AS claimed",
      [ids.concurrency],
    ).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(settled, false, "competing claim did not wait for the advisory lock");
    await first.query("ROLLBACK");
    const afterRollback = await waiting;
    assert.deepEqual(afterRollback.rows, [{ claimed: true }]);
    await second.query("ROLLBACK");
  } finally {
    await Promise.allSettled([
      first.query("ROLLBACK"),
      second.query("ROLLBACK"),
    ]);
    await Promise.all([first.end(), second.end()]);
  }
}

export async function runStripeWebhookMaintenanceAuthorityProof(
  env = process.env,
) {
  const { databaseUrl } = parseStripeWebhookMaintenanceProofConfig(env);
  verifyStripeWebhookMaintenanceAuthority();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL TIME ZONE 'America/Chicago'");
    await proveCatalog(client);
    await seedRows(client);
    await provePruneAndHealth(client);
    await proveLegacyClaim(client);
    await client.query("ROLLBACK");
    await proveClaimLock(databaseUrl);

    const residue = await client.query(`
      SELECT pg_catalog.count(*)::integer AS residue_count
        FROM public."StripeWebhookEvent"
       WHERE id LIKE 'evt_grainline_maintenance_%'
          OR id LIKE 'checkout-stock-restore:cs_test_grainlinemaintenance%'
    `);
    assert.deepEqual(residue.rows, [{ residue_count: 0 }]);
    return Object.freeze({
      database: DATABASE_NAME,
      checks: 14,
      proofMode: "ephemeral-loopback-promoted-migration-rollback",
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runStripeWebhookMaintenanceAuthorityProof();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `Stripe webhook maintenance proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}
