import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const invariantMigration = readFileSync(
  "prisma/migrations/20260829010000_prepare_order_payment_event_invariants/migration.sql",
  "utf8",
);
const readMigration = readFileSync(
  "prisma/migrations/20260829020000_prepare_order_payment_event_read_authority/migration.sql",
  "utf8",
);

const FUNCTION_IDENTITIES = Object.freeze([
  "grainline_order_payment_buyer_refund_outcomes(text,text[])",
  "grainline_order_payment_seller_refund_outcomes(text,text[])",
  "grainline_order_payment_buyer_export_page(text,integer,bigint,text)",
  "grainline_order_payment_seller_export_page(text,integer,bigint,text)",
  "grainline_order_payment_staff_timeline(text,text,integer)",
]);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      role text NOT NULL DEFAULT 'USER',
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id)
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "buyerId" text REFERENCES public."User"(id),
      "sellerProfileId" text REFERENCES public."SellerProfile"(id),
      currency varchar(3) NOT NULL DEFAULT 'usd'
    );
    CREATE TABLE public."OrderPaymentEvent" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id) ON DELETE RESTRICT,
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
    ALTER TABLE public."OrderPaymentEvent"
      ADD CONSTRAINT "OrderPaymentEvent_stripeEventCreatedSeconds_check"
      CHECK (
        "stripeEventCreatedSeconds" IS NULL
        OR "stripeEventCreatedSeconds" BETWEEN 1 AND 253402300799
      );
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public."OrderPaymentEvent" TO grainline_app_runtime;
    INSERT INTO public."User" (id, role, banned) VALUES
      ('buyer-1', 'USER', false),
      ('buyer-2', 'USER', false),
      ('seller-user-1', 'USER', false),
      ('seller-user-2', 'USER', false),
      ('staff-1', 'EMPLOYEE', false),
      ('staff-banned', 'ADMIN', true);
    INSERT INTO public."SellerProfile" (id, "userId") VALUES
      ('seller-1', 'seller-user-1'),
      ('seller-2', 'seller-user-2');
    INSERT INTO public."Order" (id, "buyerId", "sellerProfileId", currency) VALUES
      ('order-1', 'buyer-1', 'seller-1', 'usd'),
      ('order-2', 'buyer-2', 'seller-2', 'usd');
  `);
  await database.exec(invariantMigration);
  await database.exec(readMigration);
  await database.exec(`
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeEventId", "stripeObjectId", "stripeObjectType",
      "eventType", "amountCents", currency, status, reason, description,
      metadata, "createdAt", "updatedAt"
    ) VALUES
      (
        'payment-1', 'order-1',
        'local:seller_refund_recorded:re_refundone',
        're_refundone', 'refund', 'REFUND', 500, 'usd', 'succeeded',
        'seller_refund', 'Refund one.',
        pg_catalog.jsonb_build_object(
          'localAction', 'SELLER_REFUND_RECORDED',
          'refundIds', pg_catalog.jsonb_build_array('re_refundone'),
          'refundAccounting', pg_catalog.jsonb_build_object(
            'transferReversalId', 'trr_one',
            'transferReversalAmountCents', 475,
            'platformFundedRefundCents', 25,
            'originalTransferAmountCents', 475
          )
        ),
        '2026-08-29 10:00:00.000', '2026-08-29 10:00:00.000'
      ),
      (
        'payment-2', 'order-1',
        'local:seller_refund_recorded:re_failedrefund',
        're_failedrefund', 'refund', 'REFUND', 500, 'usd', 'failed',
        'seller_refund', 'Failed refund.',
        pg_catalog.jsonb_build_object(
          'localAction', 'SELLER_REFUND_RECORDED',
          'refundIds', pg_catalog.jsonb_build_array('re_failedrefund')
        ),
        '2026-08-29 11:00:00.000', '2026-08-29 11:00:00.000'
      ),
      (
        'payment-3', 'order-2',
        'local:case_refund_recorded:re_refundtwo',
        're_refundtwo', 'refund', 'REFUND', 250, 'usd', 'succeeded',
        'case_resolution_refund', 'Refund two.',
        pg_catalog.jsonb_build_object(
          'localAction', 'CASE_REFUND_RECORDED',
          'refundIds', pg_catalog.jsonb_build_array('re_refundtwo')
        ),
        '2026-08-29 09:00:00.000', '2026-08-29 09:00:00.000'
      );
  `);
  return database;
}

describe("OrderPaymentEvent fixed read authority", () => {
  it("isolates buyer and durable seller outcome batches without N+1 reads", async () => {
    const database = await createDatabase();
    try {
      const buyer = await database.query(`
        SELECT * FROM public.grainline_order_payment_buyer_refund_outcomes(
          'buyer-1', ARRAY['order-1', 'order-2']::text[]
        )
      `);
      assert.deepEqual(buyer.rows, [{
        order_id: "order-1",
        amount_cents: 500,
        currency: "usd",
        status: "succeeded",
        created_at_epoch_millis: 1787997600000,
      }]);

      const seller = await database.query(`
        SELECT * FROM public.grainline_order_payment_seller_refund_outcomes(
          'seller-user-1', ARRAY['order-2', 'order-1']::text[]
        )
      `);
      assert.deepEqual(seller.rows.map((row) => row.order_id), ["order-1"]);

      const forged = await database.query(`
        SELECT * FROM public.grainline_order_payment_buyer_refund_outcomes(
          'buyer-2', ARRAY['order-1']::text[]
        )
      `);
      assert.deepEqual(forged.rows, []);

      await assert.rejects(
        database.query(`
          SELECT * FROM public.grainline_order_payment_buyer_refund_outcomes(
            'buyer-1', ARRAY['order-1', 'order-1']::text[]
          )
        `),
        /input is invalid/i,
      );
    } finally {
      await database.close();
    }
  });

  it("pages distinct buyer and seller export projections with stable cursors", async () => {
    const database = await createDatabase();
    try {
      const first = await database.query(`
        SELECT * FROM public.grainline_order_payment_buyer_export_page(
          'buyer-1', 1, NULL, NULL
        )
      `);
      assert.equal(first.rows.length, 1);
      assert.equal(first.rows[0].payment_event_id, "payment-2");
      assert.equal(first.rows[0].event_type, "REFUND");
      assert.equal("reason" in first.rows[0], false);

      const second = await database.query(
        `SELECT * FROM public.grainline_order_payment_buyer_export_page(
          $1, 1, $2, $3
        )`,
        [
          "buyer-1",
          first.rows[0].created_at_epoch_millis,
          first.rows[0].payment_event_id,
        ],
      );
      assert.equal(second.rows[0].payment_event_id, "payment-1");

      const seller = await database.query(`
        SELECT * FROM public.grainline_order_payment_seller_export_page(
          'seller-user-1', 2, NULL, NULL
        )
      `);
      assert.deepEqual(
        seller.rows.map((row) => [row.payment_event_id, row.reason]),
        [
          ["payment-2", "seller_refund"],
          ["payment-1", "seller_refund"],
        ],
      );

      const foreign = await database.query(`
        SELECT * FROM public.grainline_order_payment_seller_export_page(
          'seller-user-2', 10, NULL, NULL
        )
      `);
      assert.deepEqual(foreign.rows.map((row) => row.order_id), ["order-2"]);
    } finally {
      await database.close();
    }
  });

  it("restricts the bounded staff timeline and derives selected accounting fields", async () => {
    const database = await createDatabase();
    try {
      const rows = await database.query(`
        SELECT * FROM public.grainline_order_payment_staff_timeline(
          'staff-1', 'order-1', 25
        )
      `);
      assert.equal(rows.rows.length, 2);
      assert.equal(rows.rows[1].transfer_reversal_id, "trr_one");
      assert.equal(rows.rows[1].transfer_reversal_amount_cents, "475");
      assert.equal("metadata" in rows.rows[1], false);

      await assert.rejects(
        database.query(`
          SELECT * FROM public.grainline_order_payment_staff_timeline(
            'buyer-1', 'order-1', 25
          )
        `),
        /access denied/i,
      );
      await assert.rejects(
        database.query(`
          SELECT * FROM public.grainline_order_payment_staff_timeline(
            'staff-banned', 'order-1', 25
          )
        `),
        /access denied/i,
      );
      await assert.rejects(
        database.query(`
          SELECT * FROM public.grainline_order_payment_staff_timeline(
            'staff-1', 'order-1', 26
          )
        `),
        /input is invalid/i,
      );
    } finally {
      await database.close();
    }
  });

  it("keeps predecessor table CRUD while granting only the five fixed functions", async () => {
    const database = await createDatabase();
    try {
      const table = await database.query(`
        SELECT
          pg_catalog.has_table_privilege(
            'grainline_app_runtime', 'public."OrderPaymentEvent"', 'SELECT'
          ) AS can_select,
          pg_catalog.has_table_privilege(
            'grainline_app_runtime', 'public."OrderPaymentEvent"', 'INSERT'
          ) AS can_insert,
          relation.relrowsecurity AS rls_enabled,
          relation.relforcerowsecurity AS rls_forced
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname = 'OrderPaymentEvent'
      `);
      assert.deepEqual(table.rows, [{
        can_select: true,
        can_insert: true,
        rls_enabled: false,
        rls_forced: false,
      }]);

      const functions = await database.query(`
        SELECT
          function_record.proname || '(' || pg_catalog.replace(
            pg_catalog.oidvectortypes(function_record.proargtypes), ', ', ','
          ) || ')' AS identity,
          function_record.prosecdef AS security_definer,
          function_record.provolatile AS volatility,
          function_record.proparallel AS parallel,
          function_record.proconfig AS config,
          pg_catalog.has_function_privilege(
            'grainline_app_runtime', function_record.oid, 'EXECUTE'
          ) AS runtime_execute,
          pg_catalog.has_function_privilege(
            'public', function_record.oid, 'EXECUTE'
          ) AS public_execute
        FROM pg_catalog.pg_proc AS function_record
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = function_record.pronamespace
        WHERE namespace.nspname = 'public'
          AND function_record.proname LIKE 'grainline_order_payment_%'
          AND function_record.proname IN (
            'grainline_order_payment_buyer_refund_outcomes',
            'grainline_order_payment_seller_refund_outcomes',
            'grainline_order_payment_buyer_export_page',
            'grainline_order_payment_seller_export_page',
            'grainline_order_payment_staff_timeline'
          )
        ORDER BY identity
      `);
      assert.deepEqual(
        functions.rows.map((row) => row.identity).sort(),
        [...FUNCTION_IDENTITIES].sort(),
      );
      for (const row of functions.rows) {
        assert.equal(row.security_definer, true);
        assert.equal(row.volatility, "s");
        assert.equal(row.parallel, "s");
        assert.deepEqual(row.config, ["search_path=pg_catalog"]);
        assert.equal(row.runtime_execute, true);
        assert.equal(row.public_execute, false);
      }
    } finally {
      await database.close();
    }
  });
});
