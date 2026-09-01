import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260901070000_prepare_order_seller_metrics_authority/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TYPE public."FulfillmentStatus" AS ENUM (
      'PENDING', 'READY_FOR_PICKUP', 'PICKED_UP', 'SHIPPED', 'DELIVERED'
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id)
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "sellerProfileId" text REFERENCES public."SellerProfile"(id),
      "paidAt" timestamp(3) without time zone,
      "shippedAt" timestamp(3) without time zone,
      "processingDeadline" timestamp(3) without time zone,
      "fulfillmentStatus" public."FulfillmentStatus" NOT NULL,
      "sellerRefundId" text,
      "paymentRefundBlocked" boolean NOT NULL DEFAULT false,
      "stripeSessionId" text,
      "stripePaymentIntentId" text,
      "stripeChargeId" text
    );
    CREATE TABLE public."OrderItem" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id),
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      "sellerProfileId" text REFERENCES public."SellerProfile"(id),
      quantity integer NOT NULL,
      "priceCents" integer NOT NULL
    );

    INSERT INTO public."SellerProfile" (id) VALUES ('seller-1'), ('seller-2');
    INSERT INTO public."Listing" (id, "sellerId") VALUES
      ('listing-reassigned', 'seller-2'),
      ('listing-two', 'seller-2');
    INSERT INTO public."Order" (
      id, "sellerProfileId", "paidAt", "shippedAt", "processingDeadline",
      "fulfillmentStatus", "sellerRefundId", "paymentRefundBlocked",
      "stripeSessionId", "stripePaymentIntentId"
    ) VALUES
      ('completed-on-time', 'seller-1', CURRENT_TIMESTAMP - INTERVAL '20 days',
       CURRENT_TIMESTAMP - INTERVAL '18 days', CURRENT_TIMESTAMP - INTERVAL '17 days',
       'DELIVERED', NULL, false, 'cs_valid', NULL),
      ('completed-late', 'seller-1', CURRENT_TIMESTAMP - INTERVAL '15 days',
       CURRENT_TIMESTAMP - INTERVAL '10 days', CURRENT_TIMESTAMP - INTERVAL '12 days',
       'PICKED_UP', NULL, false, NULL, 'pi_valid'),
      ('refunded', 'seller-1', CURRENT_TIMESTAMP - INTERVAL '14 days',
       CURRENT_TIMESTAMP - INTERVAL '13 days', CURRENT_TIMESTAMP - INTERVAL '12 days',
       'DELIVERED', 're_refunded', false, 'cs_refunded', NULL),
      ('blocked', 'seller-1', CURRENT_TIMESTAMP - INTERVAL '13 days',
       CURRENT_TIMESTAMP - INTERVAL '12 days', CURRENT_TIMESTAMP - INTERVAL '11 days',
       'DELIVERED', NULL, true, 'cs_blocked', NULL),
      ('unpaid', 'seller-1', NULL,
       CURRENT_TIMESTAMP - INTERVAL '11 days', CURRENT_TIMESTAMP - INTERVAL '10 days',
       'DELIVERED', NULL, false, NULL, NULL),
      ('old-shipment', 'seller-1', CURRENT_TIMESTAMP - INTERVAL '200 days',
       CURRENT_TIMESTAMP - INTERVAL '180 days', CURRENT_TIMESTAMP - INTERVAL '179 days',
       'DELIVERED', NULL, false, 'cs_old', NULL),
      ('seller-two-order', 'seller-2', CURRENT_TIMESTAMP - INTERVAL '10 days',
       CURRENT_TIMESTAMP - INTERVAL '9 days', CURRENT_TIMESTAMP - INTERVAL '8 days',
       'DELIVERED', NULL, false, 'cs_two', NULL);
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", "sellerProfileId", quantity, "priceCents"
    ) VALUES
      ('item-on-time', 'completed-on-time', 'listing-reassigned', 'seller-1', 2, 300),
      ('item-late', 'completed-late', 'listing-reassigned', 'seller-1', 1, 500),
      ('item-refunded', 'refunded', 'listing-reassigned', 'seller-1', 1, 900),
      ('item-blocked', 'blocked', 'listing-reassigned', 'seller-1', 1, 800),
      ('item-unpaid', 'unpaid', 'listing-reassigned', 'seller-1', 1, 700),
      ('item-old', 'old-shipment', 'listing-reassigned', 'seller-1', 1, 200),
      ('item-two', 'seller-two-order', 'listing-two', 'seller-2', 1, 7000);
  `);
  await database.exec(migration);
  return database;
}

describe("Order seller metrics authority PostgreSQL proof", () => {
  it("uses durable checkout-time seller keys and the retained trust policy", async () => {
    const database = await createDatabase();
    try {
      const result = await database.query(`
        SELECT *
          FROM public.grainline_order_seller_metrics_facts(
            'seller-1',
            (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP - INTERVAL '90 days') * 1000)::bigint
          )
      `);
      assert.deepEqual(result.rows, [{
        seller_profile_id: "seller-1",
        completed_order_count: 3,
        total_sales_cents: 1300,
        shipped_count: 2,
        on_time_count: 1,
      }]);

      const reassignedListingOwner = await database.query(`
        SELECT *
          FROM public.grainline_order_seller_metrics_facts(
            'seller-2',
            (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP - INTERVAL '90 days') * 1000)::bigint
          )
      `);
      assert.deepEqual(reassignedListingOwner.rows, [{
        seller_profile_id: "seller-2",
        completed_order_count: 1,
        total_sales_cents: 7000,
        shipped_count: 1,
        on_time_count: 1,
      }]);
    } finally {
      await database.close();
    }
  });

  it("fails closed on unsafe inputs and grants only the runtime role", async () => {
    const database = await createDatabase();
    try {
      const missing = await database.query(`
        SELECT * FROM public.grainline_order_seller_metrics_facts(
          'seller-missing',
          (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP - INTERVAL '90 days') * 1000)::bigint
        )
      `);
      assert.equal(missing.rows.length, 0);
      await assert.rejects(
        database.query(`
          SELECT * FROM public.grainline_order_seller_metrics_facts(
            ' seller-1',
            (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP - INTERVAL '90 days') * 1000)::bigint
          )
        `),
        /input is invalid/i,
      );
      await assert.rejects(
        database.query(`
          SELECT * FROM public.grainline_order_seller_metrics_facts(
            'seller-1',
            (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP - INTERVAL '401 days') * 1000)::bigint
          )
        `),
        /period is invalid/i,
      );

      const privileges = await database.query(`
        SELECT
          pg_catalog.has_function_privilege(
            'grainline_app_runtime',
            'grainline_order_seller_metrics_facts(text,bigint)',
            'EXECUTE'
          ) AS runtime_execute,
          EXISTS (
            SELECT 1
              FROM pg_catalog.pg_proc AS procedure
              CROSS JOIN LATERAL pg_catalog.aclexplode(
                COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
              ) AS acl
             WHERE procedure.oid = pg_catalog.to_regprocedure(
               'grainline_order_seller_metrics_facts(text,bigint)'
             )
               AND acl.grantee = 0
               AND acl.privilege_type = 'EXECUTE'
          ) AS public_execute
      `);
      assert.equal(privileges.rows[0].runtime_execute, true);
      assert.equal(privileges.rows[0].public_execute, false);
    } finally {
      await database.close();
    }
  });
});
