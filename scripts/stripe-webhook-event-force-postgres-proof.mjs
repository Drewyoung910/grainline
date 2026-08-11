#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  proveStripeWebhookEventCatalog,
  proveStripeWebhookEventRuntimeBoundary,
} from "./stripe-webhook-event-activation-postgres-proof.mjs";
import {
  verifyStripeWebhookEventForceRelease,
} from "./verify-stripe-webhook-event-force-release.mjs";

const { Client } = pg;
const PROOF_ENV = "STRIPE_WEBHOOK_EVENT_FORCE_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const PREFIX = "evt_grainline_force_proof";
const LEGACY_CLAIM_SESSION_ID = "cs_test_grainlineforceproof";

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseStripeWebhookEventForceProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.protocol, "postgresql:", "FORCE proof requires PostgreSQL");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "FORCE proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `FORCE proof requires the ${DATABASE_NAME} database`,
  );
  return Object.freeze({ databaseUrl });
}

export async function runStripeWebhookEventForceProof(env = process.env) {
  const { databaseUrl } = parseStripeWebhookEventForceProofConfig(env);
  verifyStripeWebhookEventForceRelease(undefined, {
    allowReviewedSuccessor: true,
  });
  const owner = new Client({ connectionString: databaseUrl });
  await owner.connect();
  try {
    await proveStripeWebhookEventCatalog(owner, { expectedForced: true });
    await proveStripeWebhookEventRuntimeBoundary(owner, {
      prefix: PREFIX,
      legacyClaimSessionId: LEGACY_CLAIM_SESSION_ID,
    });
    const residue = await owner.query(`
      SELECT pg_catalog.count(*)::integer AS residue_count
        FROM public."StripeWebhookEvent"
       WHERE id LIKE $1
          OR id = $2
    `, [`${PREFIX}%`, `checkout-stock-restore:${LEGACY_CLAIM_SESSION_ID}`]);
    assert.deepEqual(residue.rows, [{ residue_count: 0 }]);
    return Object.freeze({
      database: DATABASE_NAME,
      checks: 12,
      directTablePrivileges: 0,
      runtimeFunctions: 6,
      rlsEnabled: true,
      rlsForced: true,
      policyCount: 0,
      rolledBack: true,
      productionTouched: false,
    });
  } finally {
    await owner.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(await runStripeWebhookEventForceProof(), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `StripeWebhookEvent FORCE proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}
