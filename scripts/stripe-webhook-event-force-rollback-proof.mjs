#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
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
const PROOF_ENV = "STRIPE_WEBHOOK_EVENT_FORCE_ROLLBACK_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const PREFIX = "evt_grainline_force_rollback";
const LEGACY_CLAIM_SESSION_ID = "cs_test_grainlineforcerollback";

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseStripeWebhookEventForceRollbackProofConfig(
  env = process.env,
) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(
    parsed.protocol,
    "postgresql:",
    "FORCE rollback proof requires PostgreSQL",
  );
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "FORCE rollback proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `FORCE rollback proof requires the ${DATABASE_NAME} database`,
  );
  return Object.freeze({ databaseUrl });
}

async function forceEnabled(owner) {
  const result = await owner.query(`
    SELECT class.relforcerowsecurity AS force_enabled
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'StripeWebhookEvent'
       AND class.relkind = 'r'
  `);
  assert.equal(result.rowCount, 1);
  return result.rows[0].force_enabled;
}

export async function runStripeWebhookEventForceRollbackProof(
  env = process.env,
) {
  const { databaseUrl } = parseStripeWebhookEventForceRollbackProofConfig(env);
  verifyStripeWebhookEventForceRelease(undefined, {
    allowReviewedSuccessor: true,
  });
  const rollback = fs.readFileSync(
    "docs/rls-drafts/stripe-webhook-event-force-rollback.sql",
    "utf8",
  );
  const owner = new Client({ connectionString: databaseUrl });
  await owner.connect();
  let rollbackProven = false;
  try {
    await proveStripeWebhookEventCatalog(owner, { expectedForced: true });
    await owner.query(rollback);
    await proveStripeWebhookEventCatalog(owner, { expectedForced: false });
    await proveStripeWebhookEventRuntimeBoundary(owner, {
      prefix: PREFIX,
      legacyClaimSessionId: LEGACY_CLAIM_SESSION_ID,
    });
    rollbackProven = true;
  } finally {
    try {
      if (!(await forceEnabled(owner))) {
        await owner.query(
          'ALTER TABLE public."StripeWebhookEvent" FORCE ROW LEVEL SECURITY',
        );
      }
      await proveStripeWebhookEventCatalog(owner, { expectedForced: true });
    } finally {
      await owner.end();
    }
  }
  return Object.freeze({
    database: DATABASE_NAME,
    rollbackProven,
    phaseARestoredDuringProof: true,
    forceRestored: true,
    rowDataChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(
        await runStripeWebhookEventForceRollbackProof(),
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `StripeWebhookEvent FORCE rollback proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}
