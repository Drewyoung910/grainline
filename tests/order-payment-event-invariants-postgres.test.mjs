import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260829010000_prepare_order_payment_event_invariants/migration.sql",
  "utf8",
);

async function createPredecessorDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
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
    INSERT INTO public."Order" (id, currency)
    VALUES ('order-usd', 'usd'), ('order-cad', 'cad');
  `);
  return database;
}

function localRefundSql({
  id = "payment-local",
  orderId = "order-usd",
  eventId = "local:seller_refund_recorded:re_local",
  refundId = "re_local",
  action = "SELLER_REFUND_RECORDED",
  currency = "usd",
  amount = 500,
  updatedExpression = "CURRENT_TIMESTAMP",
} = {}) {
  return `
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeEventId", "stripeObjectId", "stripeObjectType",
      "eventType", "amountCents", currency, status, reason, description,
      metadata, "createdAt", "updatedAt"
    ) VALUES (
      '${id}', '${orderId}', '${eventId}', '${refundId}', 'refund',
      'REFUND', ${amount}, '${currency}', 'succeeded', 'seller_refund',
      'Provider refund recorded.',
      pg_catalog.jsonb_build_object(
        'localAction', '${action}',
        'refundIds', pg_catalog.jsonb_build_array('${refundId}')
      ),
      CURRENT_TIMESTAMP, ${updatedExpression}
    )
  `;
}

function signedDisputeSql({
  id = "payment-dispute",
  eventId = "evt_dispute",
  disputeId = "du_dispute",
  eventType = "charge.dispute.created",
  metadataChargeId = "ch_dispute",
  metadataDisputeId = disputeId,
  eventCreated = 1770000000,
} = {}) {
  return `
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeEventId", "stripeObjectId", "stripeObjectType",
      "eventType", "amountCents", currency, status, reason, description,
      metadata, "stripeEventCreatedSeconds", "createdAt", "updatedAt"
    ) VALUES (
      '${id}', 'order-usd', '${eventId}', '${disputeId}', 'dispute',
      'DISPUTE', 500, 'usd', 'needs_response', 'fraudulent',
      'Stripe dispute event.',
      pg_catalog.jsonb_build_object(
        'chargeId', '${metadataChargeId}',
        'disputeId', '${metadataDisputeId}',
        'stripeEventType', '${eventType}',
        'stripeEventCreated', ${eventCreated}
      ),
      ${eventCreated}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
}

describe("OrderPaymentEvent compatible invariants", () => {
  it("accepts only canonical local and signed source families", async () => {
    const database = await createPredecessorDatabase();
    try {
      await database.exec(migration);
      await database.exec(localRefundSql());
      await database.exec(signedDisputeSql());
      await database.exec(`
        INSERT INTO public."OrderPaymentEvent" (
          id, "orderId", "stripeEventId", "stripeObjectId", "stripeObjectType",
          "eventType", "amountCents", currency, status, reason, description,
          metadata, "stripeEventCreatedSeconds", "createdAt", "updatedAt"
        ) VALUES (
          'payment-refund', 'order-usd', 'evt_refund', 'external:evt_refund',
          'refund', 'REFUND', 500, 'usd', 'succeeded', 'external_refund',
          'Stripe refund event.',
          pg_catalog.jsonb_build_object(
            'chargeId', 'ch_refund',
            'stripeEventType', 'charge.refunded',
            'latestRefundId', NULL
          ),
          1770000001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `);
      const count = await database.query(
        `SELECT pg_catalog.count(*)::integer AS count FROM public."OrderPaymentEvent"`,
      );
      assert.equal(count.rows[0].count, 3);
    } finally {
      await database.close();
    }
  });

  it("rejects malformed, cross-currency and nullable-boolean source bypasses", async () => {
    const database = await createPredecessorDatabase();
    try {
      await database.exec(migration);
      await assert.rejects(
        database.exec(localRefundSql({ id: "negative", amount: -1 })),
      );
      await assert.rejects(
        database.exec(localRefundSql({
          id: "wrong-currency",
          eventId: "local:seller_refund_recorded:re_wrongcurrency",
          refundId: "re_wrongcurrency",
          currency: "cad",
        })),
        /currency does not match/i,
      );
      await assert.rejects(
        database.exec(localRefundSql({
          id: "wrong-family",
          eventId: "local:case_refund_recorded:re_wrongfamily",
          refundId: "re_wrongfamily",
          action: "SELLER_REFUND_RECORDED",
        })),
      );
      await assert.rejects(
        database.exec(signedDisputeSql({
          id: "missing-charge",
          eventId: "evt_missingcharge",
          disputeId: "du_missingcharge",
          metadataChargeId: "",
        })),
      );
      await assert.rejects(
        database.exec(signedDisputeSql({
          id: "wrong-dispute",
          eventId: "evt_wrongdispute",
          disputeId: "du_expected",
          metadataDisputeId: "du_forged",
        })),
      );
      await assert.rejects(database.exec(`
        INSERT INTO public."OrderPaymentEvent" (
          id, "orderId", "stripeEventId", "stripeObjectId", "stripeObjectType",
          "eventType", "amountCents", currency, metadata,
          "createdAt", "updatedAt"
        ) VALUES (
          'null-source', 'order-usd', 'evt_nullsource', 're_nullsource',
          'refund', 'REFUND', 500, 'usd', '{}'::jsonb,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `));
    } finally {
      await database.close();
    }
  });

  it("makes every payment row and its parent currency immutable", async () => {
    const database = await createPredecessorDatabase();
    try {
      await database.exec(migration);
      await database.exec(localRefundSql());
      await assert.rejects(
        database.exec(`UPDATE public."OrderPaymentEvent" SET status='failed' WHERE id='payment-local'`),
        /payment evidence is immutable/i,
      );
      await assert.rejects(
        database.exec(`DELETE FROM public."OrderPaymentEvent" WHERE id='payment-local'`),
        /payment evidence is immutable/i,
      );
      await assert.rejects(
        database.exec(`UPDATE public."Order" SET currency='cad' WHERE id='order-usd'`),
        /currency is immutable/i,
      );
      await database.exec(`UPDATE public."Order" SET currency='usd' WHERE id='order-cad'`);
    } finally {
      await database.close();
    }
  });

  it("validates existing rows atomically and leaves no partial catalog on failure", async () => {
    const database = await createPredecessorDatabase();
    try {
      await database.exec(`
        INSERT INTO public."OrderPaymentEvent" (
          id, "orderId", "stripeEventId", "eventType", currency,
          "createdAt", "updatedAt"
        ) VALUES (
          'legacy-invalid', 'order-usd', 'legacy-invalid', 'UNKNOWN', 'USD',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `);
      await assert.rejects(database.exec(migration));
      await database.exec("ROLLBACK");
      const catalog = await database.query(`
        SELECT
          pg_catalog.count(*) FILTER (
            WHERE constraint_name = 'OrderPaymentEvent_eventType_check'
          )::integer AS constraints,
          pg_catalog.to_regprocedure(
            'public.grainline_order_payment_event_validate_insert()'
          ) IS NOT NULL AS function_exists
        FROM information_schema.table_constraints
        WHERE table_schema='public' AND table_name='OrderPaymentEvent'
      `);
      assert.equal(catalog.rows[0].constraints, 0);
      assert.equal(catalog.rows[0].function_exists, false);
    } finally {
      await database.close();
    }
  });

  it("pins validated constraints, trigger functions and runtime denial", async () => {
    const database = await createPredecessorDatabase();
    try {
      await database.exec(migration);
      const constraints = await database.query(`
        SELECT pg_catalog.count(*)::integer AS count,
               pg_catalog.bool_and(constraint_record.convalidated) AS validated
          FROM pg_catalog.pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = 'public."OrderPaymentEvent"'::regclass
           AND constraint_record.conname LIKE 'OrderPaymentEvent_%_check'
      `);
      assert.equal(constraints.rows[0].count, 7);
      assert.equal(constraints.rows[0].validated, true);

      const triggers = await database.query(`
        SELECT pg_catalog.array_agg(trigger_record.tgname ORDER BY trigger_record.tgname) AS names
          FROM pg_catalog.pg_trigger AS trigger_record
         WHERE trigger_record.tgrelid IN (
           'public."Order"'::regclass,
           'public."OrderPaymentEvent"'::regclass
         )
           AND NOT trigger_record.tgisinternal
      `);
      assert.deepEqual(triggers.rows[0].names, [
        "grainline_order_currency_payment_immutable",
        "grainline_order_payment_event_immutable",
        "grainline_order_payment_event_validate_insert",
      ]);

      const functions = await database.query(`
        SELECT routine.proname,
               routine.proconfig,
               routine.prosecdef,
               routine.provolatile,
               pg_catalog.has_function_privilege(
                 'grainline_app_runtime', routine.oid, 'EXECUTE'
               ) AS runtime_execute
          FROM pg_catalog.pg_proc AS routine
         WHERE routine.proname IN (
           'grainline_order_currency_payment_immutable',
           'grainline_order_payment_event_immutable',
           'grainline_order_payment_event_validate_insert'
         )
         ORDER BY routine.proname
      `);
      assert.equal(functions.rows.length, 3);
      assert.ok(functions.rows.every((row) => row.proconfig?.[0] === "search_path=pg_catalog"));
      assert.ok(functions.rows.every((row) => row.runtime_execute === false));
      assert.equal(functions.rows[0].prosecdef, true);
      assert.equal(functions.rows[1].prosecdef, false);
      assert.equal(functions.rows[2].prosecdef, true);
      assert.ok(functions.rows.every((row) => row.provolatile === "v"));
    } finally {
      await database.close();
    }
  });
});
