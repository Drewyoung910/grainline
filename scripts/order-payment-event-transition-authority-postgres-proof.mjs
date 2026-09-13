#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const MIGRATION_PATH =
  "prisma/migrations/20260830020000_prepare_order_payment_event_transition_authority/migration.sql";
const OWNER_ENV = "ORDER_PAYMENT_EVENT_TRANSITION_PROOF_DATABASE_URL";
const RUNTIME_ENV = "ORDER_PAYMENT_EVENT_TRANSITION_PROOF_RUNTIME_DATABASE_URL";

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

export function parseOrderPaymentEventTransitionProofConfig(env = process.env) {
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
    ) VALUES ($1, $2, $3, 'DISPUTE', $4, $5, CURRENT_TIMESTAMP)
  `;
}

export async function runOrderPaymentEventTransitionPostgresProof(config) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 20);
  const schemaName = `ope_transition_${suffix}`;
  const schema = identifier(schemaName);
  const owner = client(
    config.ownerDatabaseUrl,
    `grainline-ope-transition-owner-${suffix}`,
  );
  const writer = client(
    config.ownerDatabaseUrl,
    `grainline-ope-transition-writer-${suffix}`,
  );
  const transitionApplication = `grainline-ope-transition-runtime-${suffix}`;
  const runtime = client(config.runtimeDatabaseUrl, transitionApplication);
  let schemaCreated = false;

  await Promise.all([owner.connect(), writer.connect(), runtime.connect()]);
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
        "stripeObjectId" text,
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
        ('order-backfill'), ('order-live'), ('order-tie'),
        ('order-unknown'), ('order-race');
      INSERT INTO ${schema}."OrderPaymentEvent" (
        id, "orderId", "stripeObjectId", "eventType", status,
        "stripeEventCreatedSeconds"
      ) VALUES (
        'dispute-backfill', 'order-backfill', 'du_backfill',
        'DISPUTE', 'needs_response', 100
      );
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
             AND routine.proname LIKE 'grainline_order_payment_open_dispute_%'
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

    const projection = async (orderId) => {
      const result = await runtime.query(`
        SELECT "paymentOpenDisputeBlocked" AS blocked
          FROM ${schema}."Order"
         WHERE id = $1
      `, [orderId]);
      return result.rows[0]?.blocked;
    };
    assert.equal(await projection("order-backfill"), true);

    await runtime.query(eventInsertSql(schema), [
      "dispute-open", "order-live", "du_live", "needs_response", 100,
    ]);
    assert.equal(await projection("order-live"), true);
    await runtime.query(eventInsertSql(schema), [
      "dispute-won", "order-live", "du_live", "won", 200,
    ]);
    assert.equal(await projection("order-live"), false);
    await runtime.query(eventInsertSql(schema), [
      "dispute-old-late", "order-live", "du_live", "under_review", 150,
    ]);
    assert.equal(await projection("order-live"), false);

    await runtime.query(eventInsertSql(schema), [
      "dispute-tie-won", "order-tie", "du_tie", "won", 300,
    ]);
    await runtime.query(eventInsertSql(schema), [
      "dispute-tie-open", "order-tie", "du_tie", "under_review", 300,
    ]);
    assert.equal(await projection("order-tie"), true);
    await runtime.query(eventInsertSql(schema), [
      "dispute-unknown", "order-unknown", "du_unknown", "future_state", 400,
    ]);
    assert.equal(await projection("order-unknown"), true);

    await expectSqlState(
      runtime,
      `UPDATE ${schema}."Order"
          SET "paymentOpenDisputeBlocked" = false
        WHERE id = 'order-tie'`,
      [],
      "23514",
    );
    await expectSqlState(
      runtime,
      `SELECT ${schema}.grainline_order_payment_open_dispute_state($1)`,
      ["order-live"],
      "42501",
    );

    await writer.query("BEGIN");
    await writer.query(eventInsertSql(schema), [
      "dispute-race", "order-race", "du_race", "needs_response", 500,
    ]);
    const pendingTransition = runtime.query(`
      UPDATE ${schema}."Order"
         SET note = 'must-not-commit'
       WHERE id = 'order-race'
         AND "paymentOpenDisputeBlocked" = false
    `);
    let transitionWaitObserved = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const waiting = await owner.query(`
        SELECT wait_event_type
          FROM pg_catalog.pg_stat_activity
         WHERE application_name = $1::text
           AND state = 'active'
      `, [transitionApplication]);
      if (waiting.rows[0]?.wait_event_type === "Lock") {
        transitionWaitObserved = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(
      transitionWaitObserved,
      true,
      "transition did not wait for the payment-event projection refresh",
    );
    await writer.query("COMMIT");
    const transition = await pendingTransition;
    assert.equal(transition.rowCount, 0);
    const raceState = await owner.query(`
      SELECT note, "paymentOpenDisputeBlocked" AS blocked
        FROM ${schema}."Order"
       WHERE id = 'order-race'
    `);
    assert.deepEqual(raceState.rows[0], { note: null, blocked: true });

    return Object.freeze({
      backfillProven: true,
      outOfOrderDisputeProven: true,
      sameSecondConflictFailsClosed: true,
      unknownStatusFailsClosed: true,
      directProjectionForgeryRejected: true,
      helperExecutionDenied: true,
      parentOrderRaceSerialized: true,
      residueCount: 0,
    });
  } finally {
    await writer.query("ROLLBACK").catch(() => {});
    if (schemaCreated) {
      await owner.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    }
    await Promise.allSettled([owner.end(), writer.end(), runtime.end()]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOrderPaymentEventTransitionPostgresProof(
    parseOrderPaymentEventTransitionProofConfig(),
  ).then(
    (result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    (error) => {
      process.stderr.write(
        `OrderPaymentEvent transition-authority PostgreSQL proof failed closed: ${
          error instanceof Error ? error.message : "unknown error"
        }\n`,
      );
      process.exitCode = 1;
    },
  );
}
