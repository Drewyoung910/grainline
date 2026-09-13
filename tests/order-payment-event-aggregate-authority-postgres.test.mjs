import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260830010000_prepare_order_payment_event_aggregate_authority/migration.sql",
  "utf8",
);

async function createPredecessorDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      note text
    );
    CREATE TABLE public."OrderPaymentEvent" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id) ON DELETE RESTRICT,
      "stripeObjectId" text NOT NULL,
      "eventType" text NOT NULL,
      "amountCents" integer DEFAULT 500,
      currency text DEFAULT 'usd',
      status text,
      reason text,
      metadata jsonb DEFAULT '{"stripeEventType":"charge.dispute.updated"}'::jsonb,
      "stripeEventCreatedSeconds" bigint,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO public."Order" (id) VALUES
      ('order-backfill-refund'),
      ('order-backfill-dispute'),
      ('order-clean'),
      ('order-dispute-live');
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeObjectId", "eventType", status,
      "stripeEventCreatedSeconds", "createdAt"
    ) VALUES
      ('payment-backfill-refund', 'order-backfill-refund', 're_backfill',
       'REFUND', 'succeeded', 100, '2026-08-30 01:00:00'),
      ('payment-backfill-dispute', 'order-backfill-dispute', 'du_backfill',
       'DISPUTE', 'needs_response', 100, '2026-08-30 01:00:01');
  `);
  return database;
}

async function projection(database, orderId) {
  const result = await database.query(`
    SELECT "paymentRefundBlocked" AS refund,
           "paymentConversionDisputeBlocked" AS dispute
      FROM public."Order"
     WHERE id = $1
  `, [orderId]);
  return result.rows[0];
}

async function insertEvent(database, {
  id,
  orderId,
  objectId,
  eventType,
  status,
  eventSeconds,
}) {
  await database.query(`
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeObjectId", "eventType", status,
      "stripeEventCreatedSeconds", "createdAt"
    ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
  `, [id, orderId, objectId, eventType, status, eventSeconds]);
}

describe("OrderPaymentEvent aggregate-authority migration", () => {
  it("backfills, refreshes and makes both Order projections unforgeable", async () => {
    const database = await createPredecessorDatabase();
    try {
      await database.exec(migration);

      assert.deepEqual(await projection(database, "order-backfill-refund"), {
        refund: true,
        dispute: false,
      });
      assert.deepEqual(await projection(database, "order-backfill-dispute"), {
        refund: false,
        dispute: true,
      });
      assert.deepEqual(await projection(database, "order-clean"), {
        refund: false,
        dispute: false,
      });

      await insertEvent(database, {
        id: "payment-refund-failed",
        orderId: "order-clean",
        objectId: "re_failed",
        eventType: "REFUND",
        status: "failed",
        eventSeconds: 101,
      });
      assert.deepEqual(await projection(database, "order-clean"), {
        refund: false,
        dispute: false,
      });

      await insertEvent(database, {
        id: "payment-refund-succeeded",
        orderId: "order-clean",
        objectId: "re_succeeded",
        eventType: "REFUND",
        status: "succeeded",
        eventSeconds: 102,
      });
      assert.deepEqual(await projection(database, "order-clean"), {
        refund: true,
        dispute: false,
      });

      await assert.rejects(
        database.exec(`
          UPDATE public."Order"
             SET "paymentRefundBlocked" = false
           WHERE id = 'order-clean'
        `),
        (error) => error?.code === "23514",
      );
      await assert.rejects(
        database.exec(`
          INSERT INTO public."Order" (
            id, "paymentConversionDisputeBlocked"
          ) VALUES ('order-forged', true)
        `),
        (error) => error?.code === "23514",
      );
      await database.exec(`
        UPDATE public."Order" SET note = 'unrelated update remains compatible'
         WHERE id = 'order-clean'
      `);

      await insertEvent(database, {
        id: "dispute-open",
        orderId: "order-dispute-live",
        objectId: "du_primary",
        eventType: "DISPUTE",
        status: "needs_response",
        eventSeconds: 100,
      });
      assert.deepEqual(await projection(database, "order-dispute-live"), {
        refund: false,
        dispute: true,
      });
      await insertEvent(database, {
        id: "dispute-won",
        orderId: "order-dispute-live",
        objectId: "du_primary",
        eventType: "DISPUTE",
        status: "won",
        eventSeconds: 200,
      });
      assert.deepEqual(await projection(database, "order-dispute-live"), {
        refund: false,
        dispute: false,
      });

      // Conflicting signed payloads at the same provider second are a
      // reconciliation state, never an arrival-time winner.
      await insertEvent(database, {
        id: "dispute-same-second-conflict",
        orderId: "order-dispute-live",
        objectId: "du_primary",
        eventType: "DISPUTE",
        status: "under_review",
        eventSeconds: 200,
      });
      assert.deepEqual(await projection(database, "order-dispute-live"), {
        refund: false,
        dispute: true,
      });

      // A late-delivered older event cannot replace the signed latest state.
      await insertEvent(database, {
        id: "dispute-out-of-order",
        orderId: "order-dispute-live",
        objectId: "du_primary",
        eventType: "DISPUTE",
        status: "under_review",
        eventSeconds: 150,
      });
      assert.deepEqual(await projection(database, "order-dispute-live"), {
        refund: false,
        dispute: true,
      });

      // Every distinct dispute object contributes its own latest state.
      await insertEvent(database, {
        id: "second-dispute-blocking",
        orderId: "order-dispute-live",
        objectId: "du_secondary",
        eventType: "DISPUTE",
        status: "lost",
        eventSeconds: 300,
      });
      assert.deepEqual(await projection(database, "order-dispute-live"), {
        refund: false,
        dispute: true,
      });
      await insertEvent(database, {
        id: "second-dispute-qualified",
        orderId: "order-dispute-live",
        objectId: "du_secondary",
        eventType: "DISPUTE",
        status: "warning_closed",
        eventSeconds: 400,
      });
      assert.deepEqual(await projection(database, "order-dispute-live"), {
        refund: false,
        dispute: true,
      });

      const catalog = await database.query(`
        SELECT
          (
            SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_trigger AS trigger_record
             WHERE trigger_record.tgrelid IN (
               'public."Order"'::regclass,
               'public."OrderPaymentEvent"'::regclass
             )
               AND NOT trigger_record.tgisinternal
          ) AS trigger_count,
          (
            SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_proc AS routine
              JOIN pg_catalog.pg_namespace AS namespace
                ON namespace.oid = routine.pronamespace
             WHERE namespace.nspname = 'public'
               AND routine.proname LIKE 'grainline_order_payment_projection_%'
               AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
               AND NOT pg_catalog.has_function_privilege(
                 'grainline_app_runtime', routine.oid, 'EXECUTE'
               )
          ) AS private_function_count
      `);
      assert.deepEqual(catalog.rows[0], {
        trigger_count: 2,
        private_function_count: 3,
      });
    } finally {
      await database.close();
    }
  });
});
