#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import pg from "pg";
import { stripeWebhookEventReservationFromRows } from "../src/lib/stripeWebhookEventState.ts";
import {
  proveProcessedStripeWebhookEvent,
  verifyBuyerDeletionReplayRuntimeIdentity,
} from "./buyer-deletion-stripe-replay-proof.mjs";

const { Client } = pg;
const PROOF_ENV = "BUYER_DELETION_REPLAY_POSTGRES_PROOF_DATABASE_URL";
const PROOF_DATABASE = "grainline_ci";
const PROOF_OWNER = "ci";
const RUNTIME_ROLE = "grainline_app_runtime";
const RUNTIME_PASSWORD = "buyer-deletion-replay-postgres-proof";
const EVENT_TYPE = "checkout.session.completed";
const IDS = Object.freeze({
  missing: "evt_grainline_buyer_replay_missing",
  pending: "evt_grainline_buyer_replay_pending",
  stale: "evt_grainline_buyer_replay_stale",
  processed: "evt_grainline_buyer_replay_processed",
});

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseBuyerDeletionReplayPostgresProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.protocol, "postgresql:");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "buyer-deletion replay PostgreSQL proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${PROOF_DATABASE}`,
    `buyer-deletion replay PostgreSQL proof requires ${PROOF_DATABASE}`,
  );
  assert.equal(
    decodeURIComponent(parsed.username),
    PROOF_OWNER,
    `buyer-deletion replay PostgreSQL proof requires owner ${PROOF_OWNER}`,
  );
  return Object.freeze({ databaseUrl });
}

function runtimePrismaClient(databaseUrl) {
  const runtimeUrl = new URL(databaseUrl);
  runtimeUrl.username = RUNTIME_ROLE;
  runtimeUrl.password = RUNTIME_PASSWORD;
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: runtimeUrl.toString() }),
  });
}

async function begin(runtime, id, type = EVENT_TYPE) {
  return stripeWebhookEventReservationFromRows(await runtime.$queryRaw(Prisma.sql`
    SELECT action, claim_generation
      FROM public.grainline_stripe_webhook_begin(${id}, ${type})
  `));
}

async function snapshot(owner, id) {
  const result = await owner.query(`
    SELECT
      id,
      type,
      "claimGeneration"::text AS claim_generation,
      "processingStartedAt"::text AS processing_started_at,
      "processedAt"::text AS processed_at,
      "lastError" AS last_error,
      "updatedAt"::text AS updated_at
    FROM public."StripeWebhookEvent"
    WHERE id = $1
  `, [id]);
  return result.rows;
}

async function residueCount(owner) {
  const result = await owner.query(`
    SELECT pg_catalog.count(*)::integer AS residue_count
      FROM public."StripeWebhookEvent"
     WHERE id = ANY($1::text[])
  `, [Object.values(IDS)]);
  return result.rows[0]?.residue_count;
}

export async function runBuyerDeletionReplayPostgresProof(config) {
  const owner = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-buyer-deletion-replay-postgres-proof-owner",
  });
  let passwordInstalled = false;
  let runtime;
  await owner.connect();
  try {
    const identity = await owner.query(`
      SELECT
        pg_catalog.current_database() AS database_name,
        CURRENT_USER AS current_user_name,
        SESSION_USER AS session_user_name
    `);
    assert.deepEqual(identity.rows, [{
      database_name: PROOF_DATABASE,
      current_user_name: PROOF_OWNER,
      session_user_name: PROOF_OWNER,
    }]);
    assert.equal(await residueCount(owner), 0, "buyer-deletion replay proof fixture residue pre-exists");

    await owner.query(`
      ALTER ROLE grainline_app_runtime
      PASSWORD 'buyer-deletion-replay-postgres-proof'
    `);
    passwordInstalled = true;
    runtime = runtimePrismaClient(config.databaseUrl);
    await runtime.$connect();
    await verifyBuyerDeletionReplayRuntimeIdentity(runtime, {
      databaseName: PROOF_DATABASE,
      runtimeRole: RUNTIME_ROLE,
    });

    const missing = await proveProcessedStripeWebhookEvent(
      runtime,
      IDS.missing,
      EVENT_TYPE,
    );
    assert.equal(missing.action, "process");
    assert.deepEqual(await snapshot(owner, IDS.missing), []);

    const pendingClaim = await begin(runtime, IDS.pending);
    assert.equal(pendingClaim.action, "process");
    const pendingBefore = await snapshot(owner, IDS.pending);
    const pending = await proveProcessedStripeWebhookEvent(
      runtime,
      IDS.pending,
      EVENT_TYPE,
    );
    assert.equal(pending.action, "in_progress");
    assert.deepEqual(await snapshot(owner, IDS.pending), pendingBefore);

    await owner.query(`
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "claimGeneration", "processingStartedAt", "processedAt",
        "lastError", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, 4,
        (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - interval '3 minutes',
        NULL, 'bounded stale fixture',
        (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - interval '4 minutes',
        (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - interval '3 minutes'
      )
    `, [IDS.stale, EVENT_TYPE]);
    const staleBefore = await snapshot(owner, IDS.stale);
    const stale = await proveProcessedStripeWebhookEvent(
      runtime,
      IDS.stale,
      EVENT_TYPE,
    );
    assert.equal(stale.action, "process");
    assert.equal(stale.claimGeneration, 5n);
    assert.deepEqual(await snapshot(owner, IDS.stale), staleBefore);

    const processedClaim = await begin(runtime, IDS.processed);
    assert.equal(processedClaim.action, "process");
    const completion = await runtime.$queryRaw(Prisma.sql`
      SELECT public.grainline_stripe_webhook_complete(
        ${IDS.processed},
        ${processedClaim.claimGeneration}
      ) AS result
    `);
    assert.deepEqual(completion, [{ result: "completed" }]);
    const processedBefore = await snapshot(owner, IDS.processed);
    const processed = await proveProcessedStripeWebhookEvent(
      runtime,
      IDS.processed,
      EVENT_TYPE,
    );
    assert.equal(processed.action, "processed");
    assert.deepEqual(await snapshot(owner, IDS.processed), processedBefore);

    await assert.rejects(
      () => proveProcessedStripeWebhookEvent(
        runtime,
        IDS.processed,
        "charge.refunded",
      ),
      /Stripe webhook event type is immutable/,
    );
    assert.deepEqual(await snapshot(owner, IDS.processed), processedBefore);

    return Object.freeze({
      checks: 12,
      database: PROOF_DATABASE,
      engineAttestedRuntime: true,
      proofMode: "ephemeral-loopback-actual-prisma-rollback",
      productionTouched: false,
      rolledBackMissingInsert: true,
      rolledBackStaleReclaim: true,
    });
  } finally {
    if (runtime) await runtime.$disconnect().catch(() => undefined);
    await owner.query(`
      DELETE FROM public."StripeWebhookEvent"
       WHERE id = ANY($1::text[])
    `, [Object.values(IDS)]).catch(() => undefined);
    if (passwordInstalled) {
      await owner.query(`
        ALTER ROLE grainline_app_runtime PASSWORD NULL
      `).catch(() => undefined);
    }
    const residue = await residueCount(owner).catch(() => null);
    await owner.end();
    assert.equal(residue, 0, "buyer-deletion replay PostgreSQL proof left fixture residue");
  }
}

async function main() {
  try {
    const config = parseBuyerDeletionReplayPostgresProofConfig(process.env);
    const result = await runBuyerDeletionReplayPostgresProof(config);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `Buyer-deletion replay PostgreSQL proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
