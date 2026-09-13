#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS,
} from "./order-payment-event-read-authority-catalog.mjs";

const { Client } = pg;
const INVARIANT_MIGRATION_PATH =
  "prisma/migrations/20260829010000_prepare_order_payment_event_invariants/migration.sql";
const READ_MIGRATION_PATH =
  "prisma/migrations/20260829020000_prepare_order_payment_event_read_authority/migration.sql";
const OWNER_ENV = "ORDER_PAYMENT_EVENT_READ_PROOF_DATABASE_URL";
const RUNTIME_ENV = "ORDER_PAYMENT_EVENT_READ_PROOF_RUNTIME_DATABASE_URL";

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

export function parseOrderPaymentEventReadProofConfig(env = process.env) {
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

export async function runOrderPaymentEventReadAuthorityPostgresProof(config) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 20);
  const schemaName = `ope_read_${suffix}`;
  const schema = identifier(schemaName);
  const owner = client(config.ownerDatabaseUrl, `grainline-ope-read-owner-${suffix}`);
  const runtime = client(config.runtimeDatabaseUrl, `grainline-ope-read-runtime-${suffix}`);
  let schemaCreated = false;

  await Promise.all([owner.connect(), runtime.connect()]);
  try {
    const [ownerIdentity, runtimeIdentity] = await Promise.all([
      owner.query("SELECT current_user AS role, current_database() AS database"),
      runtime.query("SELECT current_user AS role, current_database() AS database"),
    ]);
    assert.deepEqual(ownerIdentity.rows[0], { role: "ci", database: "grainline_ci" });
    assert.deepEqual(runtimeIdentity.rows[0], {
      role: "grainline_app_runtime",
      database: "grainline_ci",
    });

    await owner.query(`CREATE SCHEMA ${schema} AUTHORIZATION ci`);
    schemaCreated = true;
    await owner.query(`
      CREATE TABLE ${schema}."User" (
        id text PRIMARY KEY,
        role text NOT NULL DEFAULT 'USER',
        banned boolean NOT NULL DEFAULT false,
        "deletedAt" timestamp(3) without time zone
      );
      CREATE TABLE ${schema}."SellerProfile" (
        id text PRIMARY KEY,
        "userId" text NOT NULL UNIQUE REFERENCES ${schema}."User"(id)
      );
      CREATE TABLE ${schema}."Order" (
        id text PRIMARY KEY,
        "buyerId" text REFERENCES ${schema}."User"(id),
        "sellerProfileId" text REFERENCES ${schema}."SellerProfile"(id),
        currency varchar(3) NOT NULL DEFAULT 'usd'
      );
      CREATE TABLE ${schema}."OrderPaymentEvent" (
        id text PRIMARY KEY,
        "orderId" text NOT NULL REFERENCES ${schema}."Order"(id) ON DELETE RESTRICT,
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
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
        ${schema}."User", ${schema}."SellerProfile", ${schema}."Order",
        ${schema}."OrderPaymentEvent"
        TO grainline_app_runtime;
    `);

    for (const migrationPath of [INVARIANT_MIGRATION_PATH, READ_MIGRATION_PATH]) {
      const migration = readFileSync(migrationPath, "utf8").replaceAll(
        "public.",
        `${schema}.`,
      );
      await owner.query(migration);
    }

    await owner.query(`
      INSERT INTO ${schema}."User" (id, role, banned) VALUES
        ('buyer-1', 'USER', false),
        ('buyer-2', 'USER', false),
        ('seller-user-1', 'USER', false),
        ('seller-user-2', 'USER', false),
        ('staff-1', 'EMPLOYEE', false),
        ('staff-banned', 'ADMIN', true);
      INSERT INTO ${schema}."SellerProfile" (id, "userId") VALUES
        ('seller-1', 'seller-user-1'),
        ('seller-2', 'seller-user-2');
      INSERT INTO ${schema}."Order" (id, "buyerId", "sellerProfileId", currency) VALUES
        ('order-1', 'buyer-1', 'seller-1', 'usd'),
        ('order-2', 'buyer-2', 'seller-2', 'usd');
      INSERT INTO ${schema}."OrderPaymentEvent" (
        id, "orderId", "stripeEventId", "stripeObjectId", "stripeObjectType",
        "eventType", "amountCents", currency, status, reason, description,
        metadata, "createdAt", "updatedAt"
      ) VALUES
        (
          'payment-1', 'order-1', 'local:seller_refund_recorded:re_one',
          're_one', 'refund', 'REFUND', 500, 'usd', 'succeeded',
          'seller_refund', 'Refund one.',
          pg_catalog.jsonb_build_object(
            'localAction', 'SELLER_REFUND_RECORDED',
            'refundIds', pg_catalog.jsonb_build_array('re_one'),
            'refundAccounting', pg_catalog.jsonb_build_object(
              'transferReversalId', 'trr_one',
              'transferReversalAmountCents', 475
            )
          ),
          '2026-08-29 10:00:00.000', '2026-08-29 10:00:00.000'
        ),
        (
          'payment-2', 'order-2', 'local:case_refund_recorded:re_two',
          're_two', 'refund', 'REFUND', 250, 'usd', 'succeeded',
          'case_resolution_refund', 'Refund two.',
          pg_catalog.jsonb_build_object(
            'localAction', 'CASE_REFUND_RECORDED',
            'refundIds', pg_catalog.jsonb_build_array('re_two')
          ),
          '2026-08-29 09:00:00.000', '2026-08-29 09:00:00.000'
        );
    `);

    const catalog = await owner.query(`
      SELECT
        routine.proname AS function_name,
        pg_catalog.oidvectortypes(routine.proargtypes) AS argument_types,
        routine.prosecdef AS security_definer,
        routine.provolatile AS volatility,
        routine.proparallel AS parallel_mode,
        routine.proconfig AS config,
        owner_role.rolname AS owner_name,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime', routine.oid, 'EXECUTE'
        ) AS runtime_execute,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime', routine.oid, 'EXECUTE WITH GRANT OPTION'
        ) AS runtime_execute_grantable
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
      JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = routine.proowner
      WHERE namespace.nspname = $1::text
        AND routine.proname LIKE 'grainline_order_payment_%'
    `, [schemaName]);
    const readRows = catalog.rows.filter((row) => (
      row.function_name.includes("refund_outcomes")
      || row.function_name.includes("export_page")
      || row.function_name === "grainline_order_payment_staff_timeline"
    ));
    assert.equal(readRows.length, 5);
    assert.deepEqual(
      readRows.map((row) => (
        `${row.function_name}(${row.argument_types.replaceAll(" ", "")})`
      )).sort(),
      [...ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS].sort(),
    );
    for (const row of readRows) {
      assert.equal(row.owner_name, "ci");
      assert.equal(row.security_definer, true);
      assert.equal(row.volatility, "s");
      assert.equal(row.parallel_mode, "s");
      assert.deepEqual(row.config, ["search_path=pg_catalog"]);
      assert.equal(row.runtime_execute, true);
      assert.equal(row.runtime_execute_grantable, false);
    }
    const publicExecute = await owner.query(`
      SELECT pg_catalog.count(*)::integer AS count
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
      ) AS acl
      WHERE namespace.nspname = $1::text
        AND routine.proname IN (
          'grainline_order_payment_buyer_refund_outcomes',
          'grainline_order_payment_seller_refund_outcomes',
          'grainline_order_payment_buyer_export_page',
          'grainline_order_payment_seller_export_page',
          'grainline_order_payment_staff_timeline'
        )
        AND acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    `, [schemaName]);
    assert.equal(publicExecute.rows[0].count, 0);

    const buyer = await runtime.query(`
      SELECT order_id, amount_cents, currency, status
      FROM ${schema}.grainline_order_payment_buyer_refund_outcomes(
        $1::text, $2::text[]
      )
    `, ["buyer-1", ["order-1", "order-2"]]);
    assert.deepEqual(buyer.rows, [{
      order_id: "order-1",
      amount_cents: 500,
      currency: "usd",
      status: "succeeded",
    }]);

    const seller = await runtime.query(`
      SELECT order_id, amount_cents, currency, status
      FROM ${schema}.grainline_order_payment_seller_refund_outcomes(
        $1::text, $2::text[]
      )
    `, ["seller-user-1", ["order-1", "order-2"]]);
    assert.deepEqual(seller.rows, [{
      order_id: "order-1",
      amount_cents: 500,
      currency: "usd",
      status: "succeeded",
    }]);

    await assert.rejects(
      runtime.query(`
        SELECT * FROM ${schema}.grainline_order_payment_staff_timeline(
          $1::text, $2::text, 25
        )
      `, ["buyer-1", "order-1"]),
      (error) => error?.code === "42501",
    );
    await assert.rejects(
      runtime.query(`
        SELECT * FROM ${schema}.grainline_order_payment_staff_timeline(
          $1::text, $2::text, 25
        )
      `, ["staff-banned", "order-1"]),
      (error) => error?.code === "42501",
    );
    const staff = await runtime.query(`
      SELECT payment_event_id, stripe_event_id, stripe_object_id,
             transfer_reversal_id, transfer_reversal_amount_cents
      FROM ${schema}.grainline_order_payment_staff_timeline(
        $1::text, $2::text, 25
      )
    `, ["staff-1", "order-1"]);
    assert.deepEqual(staff.rows, [{
      payment_event_id: "payment-1",
      stripe_event_id: "local:seller_refund_recorded:re_one",
      stripe_object_id: "re_one",
      transfer_reversal_id: "trr_one",
      transfer_reversal_amount_cents: "475",
    }]);

    const directCompatibility = await runtime.query(
      `SELECT pg_catalog.count(*)::integer AS count FROM ${schema}."OrderPaymentEvent"`,
    );
    assert.equal(directCompatibility.rows[0].count, 2);

    return Object.freeze({
      catalogValidated: true,
      buyerIsolationProven: true,
      sellerIsolationProven: true,
      staffBoundaryProven: true,
      publicExecuteRevoked: true,
      predecessorCrudRetained: true,
      productionChanged: false,
      runtimeRoleProven: true,
    });
  } finally {
    if (schemaCreated) {
      await owner.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    }
    await Promise.allSettled([runtime.end(), owner.end()]);
  }
}

async function main() {
  const result = await runOrderPaymentEventReadAuthorityPostgresProof(
    parseOrderPaymentEventReadProofConfig(),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `OrderPaymentEvent read-authority PostgreSQL proof failed [${error?.code ?? "UNCLASSIFIED"}]\n`,
    );
    process.exitCode = 1;
  });
}
