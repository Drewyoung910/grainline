import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260901040000_prepare_order_eligibility_authority/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TYPE public."FulfillmentStatus" AS ENUM (
      'PENDING', 'READY_FOR_PICKUP', 'PICKED_UP', 'SHIPPED', 'DELIVERED'
    );
    CREATE TYPE public."CaseStatus" AS ENUM (
      'OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED'
    );
    CREATE TABLE public."User" (id text PRIMARY KEY);
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id)
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id)
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "buyerId" text REFERENCES public."User"(id),
      "sellerProfileId" text NOT NULL REFERENCES public."SellerProfile"(id),
      "createdAt" timestamp(3) without time zone NOT NULL,
      "paidAt" timestamp(3) without time zone,
      "fulfillmentStatus" public."FulfillmentStatus" NOT NULL,
      "sellerRefundId" text,
      "paymentRefundBlocked" boolean NOT NULL DEFAULT false,
      "stripeSessionId" text,
      "stripePaymentIntentId" text,
      "stripeChargeId" text,
      "deliveredAt" timestamp(3) without time zone,
      "pickedUpAt" timestamp(3) without time zone
    );
    CREATE TABLE public."OrderItem" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id),
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      "sellerProfileId" text REFERENCES public."SellerProfile"(id),
      "priceCents" integer NOT NULL,
      quantity integer NOT NULL
    );
    CREATE TABLE public."Case" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL UNIQUE REFERENCES public."Order"(id),
      status public."CaseStatus" NOT NULL
    );

    INSERT INTO public."User" (id) VALUES
      ('buyer-1'), ('buyer-2'), ('seller-user-1'), ('seller-user-2');
    INSERT INTO public."SellerProfile" (id, "userId") VALUES
      ('seller-1', 'seller-user-1'), ('seller-2', 'seller-user-2');
    INSERT INTO public."Listing" (id, "sellerId") VALUES
      ('listing-1', 'seller-1'), ('listing-2', 'seller-2'), ('listing-empty', 'seller-1');
    INSERT INTO public."Order" (
      id, "buyerId", "sellerProfileId", "createdAt", "paidAt",
      "fulfillmentStatus", "sellerRefundId", "paymentRefundBlocked",
      "stripeSessionId", "deliveredAt", "pickedUpAt"
    ) VALUES
      ('order-eligible', 'buyer-1', 'seller-1', '2026-08-25 12:00:00', '2026-08-25 12:01:00', 'DELIVERED', NULL, false, 'cs_1', '2026-08-26', NULL),
      ('order-refunded', 'buyer-1', 'seller-1', '2026-08-26 12:00:00', '2026-08-26 12:01:00', 'DELIVERED', 're_1', false, 'cs_2', '2026-08-27', NULL),
      ('order-active', 'buyer-1', 'seller-1', '2026-08-27 12:00:00', '2026-08-27 12:01:00', 'SHIPPED', NULL, false, 'cs_3', NULL, NULL),
      ('order-foreign', 'buyer-2', 'seller-2', '2026-08-25 12:00:00', '2026-08-25 12:01:00', 'PICKED_UP', NULL, false, 'cs_4', NULL, '2026-08-26');
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", "sellerProfileId", "priceCents", quantity
    ) VALUES
      ('item-eligible', 'order-eligible', 'listing-1', 'seller-1', 500, 2),
      ('item-refunded', 'order-refunded', 'listing-1', 'seller-1', 700, 1),
      ('item-active', 'order-active', 'listing-1', 'seller-1', 300, 1),
      ('item-foreign', 'order-foreign', 'listing-2', 'seller-2', 900, 1);
  `);
  await database.exec(migration);
  return database;
}

describe("Order eligibility authority PostgreSQL proof", () => {
  it("binds review and report decisions to exact durable participants", async () => {
    const database = await createDatabase();
    try {
      const eligible = await database.query(`
        SELECT * FROM public.grainline_order_review_eligibility_lock(
          'buyer-1', 'listing-1', 0
        )
      `);
      assert.deepEqual(eligible.rows, [{
        order_item_id: "item-eligible",
        seller_profile_id: "seller-1",
      }]);
      const forged = await database.query(`
        SELECT * FROM public.grainline_order_review_eligibility_lock(
          'buyer-2', 'listing-1', 0
        )
      `);
      assert.equal(forged.rows.length, 0);

      const validReport = await database.query(`
        SELECT public.grainline_order_report_target_access(
          'buyer-1', 'seller-user-1', 'order-eligible'
        ) AS value
      `);
      assert.equal(validReport.rows[0].value, true);
      const forgedReport = await database.query(`
        SELECT public.grainline_order_report_target_access(
          'buyer-2', 'seller-user-1', 'order-eligible'
        ) AS value
      `);
      assert.equal(forgedReport.rows[0].value, false);
    } finally {
      await database.close();
    }
  });

  it("returns only actor-owned sales and archive decisions", async () => {
    const database = await createDatabase();
    try {
      const sales = await database.query(`
        SELECT * FROM public.grainline_order_seller_verification_sales(
          'seller-user-1', 'seller-1'
        )
      `);
      assert.equal(Number(sales.rows[0].total_sales_cents), 1000);
      const foreignSales = await database.query(`
        SELECT * FROM public.grainline_order_seller_verification_sales(
          'seller-user-2', 'seller-1'
        )
      `);
      assert.equal(foreignSales.rows.length, 0);

      const blocked = await database.query(`
        SELECT * FROM public.grainline_listing_order_archive_blocked(
          'seller-user-1', 'listing-1', 1788134400000
        )
      `);
      assert.equal(blocked.rows[0].blocked, true);
      const empty = await database.query(`
        SELECT * FROM public.grainline_listing_order_archive_blocked(
          'seller-user-1', 'listing-empty', 1788134400000
        )
      `);
      assert.equal(empty.rows[0].blocked, false);
      const foreign = await database.query(`
        SELECT * FROM public.grainline_listing_order_archive_blocked(
          'seller-user-2', 'listing-1', 1788134400000
        )
      `);
      assert.equal(foreign.rows.length, 0);
    } finally {
      await database.close();
    }
  });

  it("rejects malformed inputs and grants only runtime execution", async () => {
    const database = await createDatabase();
    try {
      await assert.rejects(
        database.query("SELECT * FROM public.grainline_order_review_eligibility_lock('', 'listing-1', 0)"),
        /input is invalid/i,
      );
      for (const identity of [
        "grainline_order_review_eligibility_lock(text,text,bigint)",
        "grainline_order_report_target_access(text,text,text)",
        "grainline_order_seller_verification_sales(text,text)",
        "grainline_listing_order_archive_blocked(text,text,bigint)",
      ]) {
        const privileges = await database.query(`
          SELECT
            pg_catalog.has_function_privilege(
              'grainline_app_runtime', '${identity}', 'EXECUTE'
            ) AS runtime_execute,
            EXISTS (
              SELECT 1
                FROM pg_catalog.pg_proc AS procedure
                CROSS JOIN LATERAL pg_catalog.aclexplode(
                  COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
                ) AS acl
               WHERE procedure.oid = pg_catalog.to_regprocedure('${identity}')
                 AND acl.grantee = 0
                 AND acl.privilege_type = 'EXECUTE'
            ) AS public_execute
        `);
        assert.equal(privileges.rows[0].runtime_execute, true, identity);
        assert.equal(privileges.rows[0].public_execute, false, identity);
      }
    } finally {
      await database.close();
    }
  });
});
