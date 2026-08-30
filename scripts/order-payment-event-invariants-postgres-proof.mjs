#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const MIGRATION_PATH =
  "prisma/migrations/20260829010000_prepare_order_payment_event_invariants/migration.sql";
const OWNER_ENV = "ORDER_PAYMENT_EVENT_INVARIANTS_PROOF_DATABASE_URL";
const RUNTIME_ENV = "ORDER_PAYMENT_EVENT_INVARIANTS_PROOF_RUNTIME_DATABASE_URL";

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

export function parseOrderPaymentEventInvariantProofConfig(env = process.env) {
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
  assert.match(value, /^[a-z][a-z0-9_]{0,62}$/);
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

function localInsertSql(schema) {
  return `
    INSERT INTO ${schema}."OrderPaymentEvent" (
      id, "orderId", "stripeEventId", "stripeObjectId", "stripeObjectType",
      "eventType", "amountCents", currency, status, reason, description,
      metadata, "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4, 'refund', 'REFUND', 500, $5,
      'succeeded', 'seller_refund', 'Provider refund recorded.',
      pg_catalog.jsonb_build_object(
        'localAction', 'SELLER_REFUND_RECORDED',
        'refundIds', pg_catalog.jsonb_build_array($4::text)
      ),
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
}

export async function runOrderPaymentEventInvariantPostgresProof(config) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 20);
  const schemaName = `ope_invariant_${suffix}`;
  const schema = identifier(schemaName);
  const owner = client(config.ownerDatabaseUrl, `grainline-ope-invariant-owner-${suffix}`);
  const ownerB = client(config.ownerDatabaseUrl, `grainline-ope-invariant-race-${suffix}`);
  const runtime = client(config.runtimeDatabaseUrl, `grainline-ope-invariant-runtime-${suffix}`);
  let schemaCreated = false;

  await Promise.all([owner.connect(), ownerB.connect(), runtime.connect()]);
  try {
    const ownerIdentity = await owner.query(
      "SELECT current_user AS role, current_database() AS database",
    );
    const runtimeIdentity = await runtime.query(
      "SELECT current_user AS role, current_database() AS database",
    );
    assert.deepEqual(ownerIdentity.rows[0], { role: "ci", database: "grainline_ci" });
    assert.deepEqual(runtimeIdentity.rows[0], {
      role: "grainline_app_runtime",
      database: "grainline_ci",
    });

    await owner.query(`CREATE SCHEMA ${schema} AUTHORIZATION ci`);
    schemaCreated = true;
    await owner.query(`
      CREATE TABLE ${schema}."Order" (
        id text PRIMARY KEY,
        currency varchar(3) NOT NULL DEFAULT 'usd'
      );
      CREATE TABLE ${schema}."OrderPaymentEvent" (
        id text PRIMARY KEY,
        "orderId" text NOT NULL
          REFERENCES ${schema}."Order"(id) ON DELETE RESTRICT,
        "stripeEventId" varchar(255) NOT NULL UNIQUE,
        "stripeObjectId" varchar(255),
        "stripeObjectType" varchar(100),
        "eventType" varchar(100) NOT NULL,
        "amountCents" integer,
        currency varchar(3) NOT NULL DEFAULT 'usd',
        status varchar(100),
        reason varchar(255),
        description varchar(5000),
        metadata jsonb,
        "stripeEventCreatedSeconds" bigint,
        "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (id, "orderId")
      );
      ALTER TABLE ${schema}."OrderPaymentEvent"
        ADD CONSTRAINT "OrderPaymentEvent_stripeEventCreatedSeconds_check"
        CHECK (
          "stripeEventCreatedSeconds" IS NULL
          OR "stripeEventCreatedSeconds" BETWEEN 1 AND 253402300799
        );
      GRANT USAGE ON SCHEMA ${schema} TO grainline_app_runtime;
      GRANT SELECT, INSERT, UPDATE, DELETE
        ON TABLE ${schema}."Order", ${schema}."OrderPaymentEvent"
        TO grainline_app_runtime;
      INSERT INTO ${schema}."Order" (id, currency)
      VALUES ('order-base', 'usd'), ('order-race', 'usd');
    `);

    const migration = readFileSync(MIGRATION_PATH, "utf8").replaceAll(
      "public.",
      `${schema}.`,
    );
    await owner.query(migration);

    const catalog = await owner.query(`
      SELECT
        (
          SELECT pg_catalog.count(*)::integer
            FROM pg_catalog.pg_constraint AS constraint_record
           WHERE constraint_record.conrelid =
                 '${schemaName}."OrderPaymentEvent"'::regclass
             AND constraint_record.conname LIKE 'OrderPaymentEvent_%_check'
             AND constraint_record.convalidated
        ) AS validated_constraints,
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
           WHERE namespace.nspname = $1
             AND routine.proname IN (
               'grainline_order_currency_payment_immutable',
               'grainline_order_payment_event_immutable',
               'grainline_order_payment_event_validate_insert'
             )
             AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
             AND NOT pg_catalog.has_function_privilege(
               'grainline_app_runtime', routine.oid, 'EXECUTE'
             )
        ) AS fenced_functions
    `, [schemaName]);
    assert.deepEqual(catalog.rows[0], {
      validated_constraints: 7,
      trigger_count: 3,
      fenced_functions: 3,
    });

    await runtime.query("BEGIN");
    await runtime.query(localInsertSql(schema), [
      "payment-valid",
      "order-base",
      "local:seller_refund_recorded:re_valid",
      "re_valid",
      "usd",
    ]);
    await runtime.query("ROLLBACK");

    await expectSqlState(runtime, localInsertSql(schema), [
      "payment-cross-currency",
      "order-base",
      "local:seller_refund_recorded:re_crosscurrency",
      "re_crosscurrency",
      "cad",
    ], "23514");
    await expectSqlState(runtime, localInsertSql(schema), [
      "payment-forged-family",
      "order-base",
      "local:case_refund_recorded:re_forged",
      "re_forged",
      "usd",
    ], "23514");

    await runtime.query("BEGIN");
    await runtime.query(localInsertSql(schema), [
      "payment-race",
      "order-race",
      "local:seller_refund_recorded:re_race",
      "re_race",
      "usd",
    ]);
    await ownerB.query("BEGIN");
    await ownerB.query("SET LOCAL lock_timeout = '5s'");
    const pendingUpdate = ownerB.query(
      `UPDATE ${schema}."Order" SET currency='cad' WHERE id='order-race'`,
    ).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );

    let lockWaitObserved = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const waiting = await owner.query(`
        SELECT wait_event_type
          FROM pg_catalog.pg_stat_activity
         WHERE application_name = $1
           AND state = 'active'
      `, [`grainline-ope-invariant-race-${suffix}`]);
      if (waiting.rows[0]?.wait_event_type === "Lock") {
        lockWaitObserved = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(lockWaitObserved, true, "currency update did not wait on the insert lock");
    await runtime.query("COMMIT");
    const updateResult = await pendingUpdate;
    assert.equal(updateResult.ok, false);
    assert.equal(updateResult.error?.code, "23514");
    await ownerB.query("ROLLBACK");

    await expectSqlState(runtime,
      `UPDATE ${schema}."OrderPaymentEvent" SET status='failed' WHERE id='payment-race'`,
      [],
      "23514",
    );
    await expectSqlState(runtime,
      `DELETE FROM ${schema}."OrderPaymentEvent" WHERE id='payment-race'`,
      [],
      "23514",
    );

    const retained = await owner.query(`
      SELECT orders.currency,
             payment.currency AS payment_currency,
             payment."updatedAt" = payment."createdAt" AS immutable_time
        FROM ${schema}."Order" AS orders
        JOIN ${schema}."OrderPaymentEvent" AS payment
          ON payment."orderId" = orders.id
       WHERE orders.id = 'order-race'
    `);
    assert.deepEqual(retained.rows[0], {
      currency: "usd",
      payment_currency: "usd",
      immutable_time: true,
    });

    return Object.freeze({
      catalogValidated: true,
      crossCurrencyRejected: true,
      malformedSourceRejected: true,
      immutableDeleteRejected: true,
      immutableUpdateRejected: true,
      parentCurrencyRaceSerialized: true,
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
  const result = await runOrderPaymentEventInvariantPostgresProof(
    parseOrderPaymentEventInvariantProofConfig(),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `OrderPaymentEvent invariant PostgreSQL proof failed [${error?.code ?? "UNCLASSIFIED"}]\n`,
    );
    process.exitCode = 1;
  });
}
