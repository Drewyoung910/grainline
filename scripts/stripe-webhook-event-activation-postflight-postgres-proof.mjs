#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  verifyStripeWebhookEventActivatedCatalog,
  verifyStripeWebhookEventActivationRuntimeIdentity,
} from "./stripe-webhook-event-activation-production-postflight.mjs";

const { Client } = pg;
const DATABASE_ENV =
  "STRIPE_WEBHOOK_EVENT_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const RUNTIME_ROLE = "grainline_app_runtime";

export function parseStripeWebhookEventActivationPostflightProofConfig(
  env = process.env,
) {
  const databaseUrl = env[DATABASE_ENV];
  assert.ok(databaseUrl, `${DATABASE_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.protocol, "postgresql:");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "activation postflight proof refuses a non-loopback database",
  );
  assert.equal(parsed.pathname, `/${DATABASE_NAME}`);
  assert.equal(decodeURIComponent(parsed.username), RUNTIME_ROLE);
  assert.ok(parsed.password, "activation postflight proof requires direct login");
  return Object.freeze({ databaseUrl });
}

async function expectedFailure(client, operation, code, label) {
  await client.query("SAVEPOINT stripe_postflight_proof_expected_failure");
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await client.query(
    "ROLLBACK TO SAVEPOINT stripe_postflight_proof_expected_failure",
  );
  await client.query(
    "RELEASE SAVEPOINT stripe_postflight_proof_expected_failure",
  );
  assert.equal(caught?.code, code, `${label} returned the wrong SQLSTATE`);
}

export async function runStripeWebhookEventActivationPostflightProof(
  env = process.env,
) {
  const { databaseUrl } =
    parseStripeWebhookEventActivationPostflightProofConfig(env);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const transaction = await client.query(`
      SELECT
        pg_catalog.current_setting('transaction_isolation') AS isolation,
        pg_catalog.current_setting('transaction_read_only') AS read_only
    `);
    assert.deepEqual(transaction.rows, [{
      isolation: "repeatable read",
      read_only: "on",
    }]);
    await verifyStripeWebhookEventActivationRuntimeIdentity(
      client,
      { databaseName: DATABASE_NAME, runtimeRole: RUNTIME_ROLE },
      "ci",
    );
    await verifyStripeWebhookEventActivatedCatalog(client, "ci");
    await expectedFailure(
      client,
      () => client.query(`SELECT id FROM public."StripeWebhookEvent" LIMIT 1`),
      "42501",
      "direct runtime read",
    );
    const health = await client.query(
      "SELECT * FROM public.grainline_stripe_webhook_health_summary()",
    );
    assert.equal(health.rowCount, 1);
    await expectedFailure(
      client,
      () => client.query(
        "SELECT action FROM public.grainline_stripe_webhook_begin($1, $2)",
        ["evt_grainline_ci_postflight_never_committed", "grainline.proof"],
      ),
      "25006",
      "begin function read-only fence",
    );
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      database: DATABASE_NAME,
      runtimeRole: RUNTIME_ROLE,
      directRuntimeLogin: true,
      sourcePinnedFunctions: 6,
      postflightReadOnly: true,
      residue: 0,
      productionTouched: false,
    });
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(await runStripeWebhookEventActivationPostflightProof(), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `StripeWebhookEvent activation postflight PostgreSQL proof failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
