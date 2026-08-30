#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import pg from "pg";

const { Client } = pg;
const MIGRATION_PATH =
  "prisma/migrations/20260830010000_prepare_order_payment_event_aggregate_authority/migration.sql";
const OWNER_ENV = "ORDER_PAYMENT_EVENT_AGGREGATE_PROOF_DATABASE_URL";
const RUNTIME_ENV =
  "ORDER_PAYMENT_EVENT_AGGREGATE_PROOF_RUNTIME_DATABASE_URL";

function parseLoopbackUrl(value, label, expectedRole) {
  assert.ok(value, `${label} is required`);
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "postgresql:");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    `${label} refuses a non-loopback database`,
  );
  assert.equal(parsed.pathname, "/grainline_ci");
  assert.equal(decodeURIComponent(parsed.username), expectedRole);
  assert.ok(parsed.password, `${label} requires a password`);
  return value;
}

export function parseOrderPaymentEventAggregateProofConfig(env = process.env) {
  return Object.freeze({
    ownerDatabaseUrl: parseLoopbackUrl(env[OWNER_ENV], OWNER_ENV, "ci"),
    runtimeDatabaseUrl: parseLoopbackUrl(
      env[RUNTIME_ENV],
      RUNTIME_ENV,
      "grainline_app_runtime",
    ),
  });
}

function identifier(value) {
  assert.match(value, /^[a-z][a-z0-9_]{0,62}$/u);
  return `"${value}"`;
}

function client(connectionString, applicationName) {
  return new Client({ connectionString, application_name: applicationName });
}

async function expectSqlState(target, sql, params, expectedCode) {
  await target.query("BEGIN");
  try {
    await target.query(sql, params);
    assert.fail(`expected PostgreSQL SQLSTATE ${expectedCode}`);
  } catch (error) {
    assert.equal(error?.code, expectedCode);
  } finally {
    await target.query("ROLLBACK").catch(() => {});
  }
}

function eventInsertSql(schema) {
  return `
    INSERT INTO ${schema}."OrderPaymentEvent" (
      id, "orderId", "stripeObjectId", "eventType", status,
      "stripeEventCreatedSeconds", "createdAt"
    ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
  `;
}

export async function runOrderPaymentEventAggregatePostgresProof(config) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 20);
  const schemaName = `ope_aggregate_${suffix}`;
  const schema = identifier(schemaName);
  const raceApplication = `grainline-ope-aggregate-race-${suffix}`;
  const owner = client(
    config.ownerDatabaseUrl,
    `grainline-ope-aggregate-owner-${suffix}`,
  );
  const ownerB = client(config.ownerDatabaseUrl, raceApplication);
  const runtime = client(
    config.runtimeDatabaseUrl,
    `grainline-ope-aggregate-runtime-${suffix}`,
  );
  let schemaCreated = false;

  await Promise.all([owner.connect(), ownerB.connect(), runtime.connect()]);
  try {
    const [ownerIdentity, runtimeIdentity] = await Promise.all([
      owner.query("SELECT current_user AS role, current_database() AS database"),
      runtime.query("SELECT current_user AS role, current_database() AS database"),
    ]);
    assert.deepEqual(ownerIdentity.rows[0], {
      role: "ci",
      database: "grainline_ci",
    });
    assert.deepEqual(runtimeIdentity.rows[0], {
      role: "grainline_app_runtime",
      database: "grainline_ci",
    });

    await owner.query(`CREATE SCHEMA ${schema} AUTHORIZATION ci`);
    schemaCreated = true;
    await owner.query(`
      CREATE TABLE ${schema}."Order" (
        id text PRIMARY KEY,
        note text
      );
      CREATE TABLE ${schema}."OrderPaymentEvent" (
        id text PRIMARY KEY,
        "orderId" text NOT NULL
          REFERENCES ${schema}."Order"(id) ON DELETE RESTRICT,
        "stripeObjectId" text NOT NULL,
        "eventType" text NOT NULL,
        status text,
        "stripeEventCreatedSeconds" bigint,
        "createdAt" timestamp(3) without time zone NOT NULL
          DEFAULT CURRENT_TIMESTAMP
      );
      GRANT USAGE ON SCHEMA ${schema} TO grainline_app_runtime;
      GRANT SELECT, INSERT, UPDATE, DELETE
        ON TABLE ${schema}."Order", ${schema}."OrderPaymentEvent"
        TO grainline_app_runtime;
      INSERT INTO ${schema}."Order" (id) VALUES
        ('order-clean'), ('order-race'), ('order-dispute');
    `);

    const migration = fs.readFileSync(MIGRATION_PATH, "utf8").replaceAll(
      "public.",
      `${schema}.`,
    );
    await owner.query(migration);

    const catalog = await owner.query(`
      SELECT
        (
          SELECT pg_catalog.count(*)::integer
            FROM pg_catalog.pg_trigger AS trigger_record
           WHERE trigger_record.tgrelid IN (
             '${schemaName}."Order"'::regclass,
             '${schemaName}."OrderPaymentEvent"'::regclass
           )
             AND NOT trigger_record.tgisinternal
        ) AS trigger_count,
        (
          SELECT pg_catalog.count(*)::integer
            FROM pg_catalog.pg_proc AS routine
            JOIN pg_catalog.pg_namespace AS namespace
              ON namespace.oid = routine.pronamespace
           WHERE namespace.nspname = $1::text
             AND routine.proname LIKE 'grainline_order_payment_projection_%'
             AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
             AND routine.provolatile = 'v'
             AND routine.prosecdef
             AND NOT pg_catalog.has_function_privilege(
               'grainline_app_runtime', routine.oid, 'EXECUTE'
             )
        ) AS private_function_count
    `, [schemaName]);
    assert.deepEqual(catalog.rows[0], {
      trigger_count: 2,
      private_function_count: 3,
    });

    await runtime.query(eventInsertSql(schema), [
      "refund-failed",
      "order-clean",
      "re_failed",
      "REFUND",
      "FAILED",
      100,
    ]);
    let state = await runtime.query(`
      SELECT "paymentRefundBlocked" AS refund,
             "paymentConversionDisputeBlocked" AS dispute
        FROM ${schema}."Order" WHERE id = 'order-clean'
    `);
    assert.deepEqual(state.rows[0], { refund: false, dispute: false });

    await expectSqlState(
      runtime,
      `UPDATE ${schema}."Order"
          SET "paymentRefundBlocked" = true
        WHERE id = 'order-clean'`,
      [],
      "23514",
    );
    await expectSqlState(
      runtime,
      `SELECT * FROM ${schema}.grainline_order_payment_projection_state($1)`,
      ["order-clean"],
      "42501",
    );

    await runtime.query(eventInsertSql(schema), [
      "dispute-open",
      "order-dispute",
      "du_primary",
      "DISPUTE",
      "needs_response",
      100,
    ]);
    await runtime.query(eventInsertSql(schema), [
      "dispute-won",
      "order-dispute",
      "du_primary",
      "DISPUTE",
      "won",
      200,
    ]);
    await runtime.query(eventInsertSql(schema), [
      "dispute-late-old",
      "order-dispute",
      "du_primary",
      "DISPUTE",
      "under_review",
      150,
    ]);
    state = await runtime.query(`
      SELECT "paymentConversionDisputeBlocked" AS dispute
        FROM ${schema}."Order" WHERE id = 'order-dispute'
    `);
    assert.deepEqual(state.rows[0], { dispute: false });

    await runtime.query("BEGIN");
    await runtime.query(eventInsertSql(schema), [
      "refund-race",
      "order-race",
      "re_race",
      "REFUND",
      "succeeded",
      300,
    ]);

    await ownerB.query("BEGIN");
    await ownerB.query("SET LOCAL lock_timeout = '5s'");
    const pendingEligibility = ownerB.query(`
      SELECT id
        FROM ${schema}."Order"
       WHERE id = 'order-race'
         AND "paymentRefundBlocked" = false
       FOR UPDATE
    `);

    let lockWaitObserved = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const waiting = await owner.query(`
        SELECT wait_event_type
          FROM pg_catalog.pg_stat_activity
         WHERE application_name = $1::text
           AND state = 'active'
      `, [raceApplication]);
      if (waiting.rows[0]?.wait_event_type === "Lock") {
        lockWaitObserved = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(
      lockWaitObserved,
      true,
      "eligibility claim did not wait on the payment projection update",
    );
    await runtime.query("COMMIT");
    const eligibility = await pendingEligibility;
    assert.equal(
      eligibility.rowCount,
      0,
      "stale review eligibility survived the committed refund projection",
    );
    await ownerB.query("COMMIT");

    state = await runtime.query(`
      SELECT "paymentRefundBlocked" AS refund
        FROM ${schema}."Order" WHERE id = 'order-race'
    `);
    assert.deepEqual(state.rows[0], { refund: true });

    return Object.freeze({
      backfillAndRefreshProven: true,
      directProjectionForgeryRejected: true,
      helperExecutionDenied: true,
      outOfOrderDisputeProven: true,
      parentOrderRaceSerialized: true,
      productionChanged: false,
      runtimeRoleProven: true,
    });
  } finally {
    await runtime.query("ROLLBACK").catch(() => {});
    await ownerB.query("ROLLBACK").catch(() => {});
    if (schemaCreated) {
      await owner.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    }
    await Promise.allSettled([runtime.end(), ownerB.end(), owner.end()]);
  }
}

async function main() {
  const result = await runOrderPaymentEventAggregatePostgresProof(
    parseOrderPaymentEventAggregateProofConfig(),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `OrderPaymentEvent aggregate-authority PostgreSQL proof failed [${
        error?.code ?? "UNCLASSIFIED"
      }]\n`,
    );
    process.exitCode = 1;
  });
}
