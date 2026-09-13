import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260830020000_prepare_order_payment_event_transition_authority/migration.sql",
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
      "stripeObjectId" text,
      "eventType" text NOT NULL,
      status text,
      "stripeEventCreatedSeconds" bigint,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO public."Order" (id) VALUES
      ('order-backfill'), ('order-live'), ('order-tie');
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeObjectId", "eventType", status,
      "stripeEventCreatedSeconds"
    ) VALUES (
      'dispute-backfill', 'order-backfill', 'du_backfill',
      'DISPUTE', 'needs_response', 100
    );
  `);
  return database;
}

async function projection(database, orderId) {
  const result = await database.query(`
    SELECT "paymentOpenDisputeBlocked" AS blocked
      FROM public."Order"
     WHERE id = $1
  `, [orderId]);
  return result.rows[0]?.blocked;
}

async function insertDispute(database, {
  id,
  orderId,
  disputeId,
  status,
  eventSeconds,
}) {
  await database.query(`
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeObjectId", "eventType", status,
      "stripeEventCreatedSeconds"
    ) VALUES ($1, $2, $3, 'DISPUTE', $4, $5)
  `, [id, orderId, disputeId, status, eventSeconds]);
}

describe("OrderPaymentEvent transition-authority migration", () => {
  it("backfills, refreshes and makes the open-dispute projection unforgeable", async () => {
    const database = await createPredecessorDatabase();
    try {
      await database.exec(migration);
      assert.equal(await projection(database, "order-backfill"), true);
      assert.equal(await projection(database, "order-live"), false);

      await insertDispute(database, {
        id: "dispute-live-open",
        orderId: "order-live",
        disputeId: "du_live",
        status: "needs_response",
        eventSeconds: 100,
      });
      assert.equal(await projection(database, "order-live"), true);
      await insertDispute(database, {
        id: "dispute-live-won",
        orderId: "order-live",
        disputeId: "du_live",
        status: "won",
        eventSeconds: 200,
      });
      assert.equal(await projection(database, "order-live"), false);
      await insertDispute(database, {
        id: "dispute-live-old-late",
        orderId: "order-live",
        disputeId: "du_live",
        status: "under_review",
        eventSeconds: 150,
      });
      assert.equal(await projection(database, "order-live"), false);

      await insertDispute(database, {
        id: "dispute-tie-won",
        orderId: "order-tie",
        disputeId: "du_tie",
        status: "won",
        eventSeconds: 300,
      });
      await insertDispute(database, {
        id: "dispute-tie-open",
        orderId: "order-tie",
        disputeId: "du_tie",
        status: "under_review",
        eventSeconds: 300,
      });
      assert.equal(await projection(database, "order-tie"), true);

      await assert.rejects(
        database.exec(`
          UPDATE public."Order"
             SET "paymentOpenDisputeBlocked" = false
           WHERE id = 'order-tie'
        `),
        (error) => error?.code === "23514",
      );

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
               AND routine.proname LIKE 'grainline_order_payment_open_dispute_%'
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
