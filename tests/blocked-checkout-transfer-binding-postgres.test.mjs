import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260826010000_prepare_blocked_checkout_transfer_binding/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TABLE public."StripeWebhookEvent" (
      id varchar(255) PRIMARY KEY,
      type varchar(100) NOT NULL,
      "sourceObjectId" varchar(255),
      "claimGeneration" bigint NOT NULL DEFAULT 0,
      "processingStartedAt" timestamp(3) without time zone,
      "processedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "paidAt" timestamp(3) without time zone,
      "stripeSessionId" varchar(255) UNIQUE,
      "stripePaymentIntentId" varchar(255),
      "stripeChargeId" varchar(255),
      "stripeTransferId" varchar(255),
      "sellerRefundId" varchar(255),
      "sellerRefundLockedAt" timestamp(3) without time zone,
      "refundClaimId" text
    );
    CREATE TABLE public."OrderPaymentEvent" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id),
      "eventType" varchar(100) NOT NULL
    );
  `);
  await database.exec(migration);
  return database;
}

async function seed(database, suffix = "exact") {
  await database.query(`
    INSERT INTO public."StripeWebhookEvent" (
      id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
    ) VALUES ($1, 'checkout.session.completed', $2, 3, CURRENT_TIMESTAMP)
  `, [`evt_${suffix}`, `cs_${suffix}`]);
  await database.query(`
    INSERT INTO public."Order" (
      id, "paidAt", "stripeSessionId", "stripePaymentIntentId", "stripeChargeId"
    ) VALUES ($1, CURRENT_TIMESTAMP, $2, $3, $4)
  `, [`order_${suffix}`, `cs_${suffix}`, `pi_${suffix}`, `ch_${suffix}`]);
}

async function bind(database, suffix = "exact", overrides = {}) {
  const input = {
    eventId: `evt_${suffix}`,
    generation: 3,
    sessionId: `cs_${suffix}`,
    orderId: `order_${suffix}`,
    paymentIntentId: `pi_${suffix}`,
    chargeId: `ch_${suffix}`,
    transferId: `tr_${suffix}`,
    ...overrides,
  };
  return (await database.query(`
    SELECT public.grainline_blocked_checkout_transfer_bind(
      $1, $2, $3, $4, $5, $6, $7
    ) AS binding
  `, [
    input.eventId,
    input.generation,
    input.sessionId,
    input.orderId,
    input.paymentIntentId,
    input.chargeId,
    input.transferId,
  ])).rows[0]?.binding;
}

test("disposable PostgreSQL binds and replays one exact destination transfer", async () => {
  const database = await createDatabase();
  try {
    await seed(database);
    const first = await bind(database);
    assert.deepEqual(first, {
      action: "bound",
      orderId: "order_exact",
      transferId: "tr_exact",
    });
    const replay = await bind(database);
    assert.deepEqual(replay, {
      action: "replay",
      orderId: "order_exact",
      transferId: "tr_exact",
    });
    const row = (await database.query(`
      SELECT "stripeTransferId" AS transfer_id
      FROM public."Order" WHERE id='order_exact'
    `)).rows[0];
    assert.equal(row.transfer_id, "tr_exact");
    await assert.rejects(
      bind(database, "exact", { transferId: "tr_conflict" }),
      /conflicts with the durable transfer/,
    );
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL fences transfer binding to the active signed source and exact payment", async () => {
  const database = await createDatabase();
  try {
    await seed(database, "fenced");
    await assert.rejects(
      bind(database, "fenced", { generation: 2 }),
      /source lease is invalid/,
    );
    await assert.rejects(
      bind(database, "fenced", { sessionId: "cs_other" }),
      /source lease is invalid/,
    );
    await assert.rejects(
      bind(database, "fenced", { paymentIntentId: "pi_other" }),
      /Order source is invalid/,
    );
    await assert.rejects(
      bind(database, "fenced", { chargeId: "ch_other" }),
      /Order source is invalid/,
    );
    for (const overrides of [
      { paymentIntentId: null },
      { chargeId: null },
      { transferId: null },
      { transferId: `tr_${"x".repeat(253)}` },
    ]) {
      await assert.rejects(
        bind(database, "fenced", overrides),
        /input is invalid/,
      );
    }
    const row = (await database.query(`
      SELECT "stripeTransferId" AS transfer_id
      FROM public."Order" WHERE id='order_fenced'
    `)).rows[0];
    assert.equal(row.transfer_id, null);
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL rejects a first transfer binding after refund authority", async () => {
  const database = await createDatabase();
  try {
    await seed(database, "late");
    await database.query(`
      UPDATE public."Order"
      SET "sellerRefundId"='re_already', "sellerRefundLockedAt"=CURRENT_TIMESTAMP
      WHERE id='order_late'
    `);
    await assert.rejects(bind(database, "late"), /arrived after refund authority/);
    const row = (await database.query(`
      SELECT "stripeTransferId" AS transfer_id
      FROM public."Order" WHERE id='order_late'
    `)).rows[0];
    assert.equal(row.transfer_id, null);
  } finally {
    await database.close();
  }
});

test("transfer binding catalog is runtime-only and search-path pinned", async () => {
  const database = await createDatabase();
  try {
    const row = (await database.query(`
      SELECT
        procedure.prosecdef AS security_definer,
        procedure.proconfig AS config,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          procedure.oid,
          'EXECUTE'
        ) AS runtime_execute,
        EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
          WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
        ) AS public_execute
      FROM pg_catalog.pg_proc AS procedure
      WHERE procedure.oid='public.grainline_blocked_checkout_transfer_bind(text,bigint,text,text,text,text,text)'::pg_catalog.regprocedure
    `)).rows[0];
    assert.deepEqual(row, {
      security_definer: true,
      config: ["search_path=pg_catalog"],
      runtime_execute: true,
      public_execute: false,
    });
  } finally {
    await database.close();
  }
});
