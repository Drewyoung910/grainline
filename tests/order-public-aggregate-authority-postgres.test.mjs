import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260901050000_prepare_order_public_aggregate_authority/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TYPE public."FulfillmentStatus" AS ENUM (
      'PENDING', 'READY_FOR_PICKUP', 'PICKED_UP', 'SHIPPED', 'DELIVERED'
    );
    CREATE TYPE public."ListingStatus" AS ENUM (
      'DRAFT', 'ACTIVE', 'SOLD', 'SOLD_OUT', 'HIDDEN', 'PENDING_REVIEW', 'REJECTED'
    );
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "chargesEnabled" boolean NOT NULL DEFAULT true,
      "stripeAccountVersion" text,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      status public."ListingStatus" NOT NULL,
      "isPrivate" boolean NOT NULL DEFAULT false,
      "viewCount" integer NOT NULL DEFAULT 0,
      "clickCount" integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "sellerProfileId" text NOT NULL REFERENCES public."SellerProfile"(id),
      "paidAt" timestamp(3) without time zone,
      "shippedAt" timestamp(3) without time zone,
      "fulfillmentStatus" public."FulfillmentStatus" NOT NULL,
      "sellerRefundId" text,
      "paymentRefundBlocked" boolean NOT NULL DEFAULT false,
      "paymentConversionDisputeBlocked" boolean NOT NULL DEFAULT false,
      "stripeSessionId" text,
      "stripePaymentIntentId" text,
      "stripeChargeId" text
    );
    CREATE TABLE public."OrderItem" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id),
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      "sellerProfileId" text NOT NULL REFERENCES public."SellerProfile"(id),
      quantity integer NOT NULL
    );

    INSERT INTO public."User" (id, banned) VALUES
      ('seller-user-1', false), ('seller-user-2', true), ('seller-user-3', false);
    INSERT INTO public."SellerProfile" (
      id, "userId", "chargesEnabled", "stripeAccountVersion", "vacationMode"
    ) VALUES
      ('seller-1', 'seller-user-1', true, 'v2', false),
      ('seller-2', 'seller-user-2', true, 'v2', false),
      ('seller-3', 'seller-user-3', true, 'v2', true);
    INSERT INTO public."Listing" (
      id, "sellerId", status, "isPrivate", "viewCount", "clickCount"
    ) VALUES
      ('listing-1', 'seller-1', 'ACTIVE', false, 100, 20),
      ('listing-private', 'seller-1', 'ACTIVE', true, 500, 90),
      ('listing-banned', 'seller-2', 'ACTIVE', false, 300, 40),
      ('listing-vacation', 'seller-3', 'ACTIVE', false, 200, 30);
    INSERT INTO public."Order" (
      id, "sellerProfileId", "paidAt", "shippedAt", "fulfillmentStatus",
      "sellerRefundId", "paymentRefundBlocked", "paymentConversionDisputeBlocked",
      "stripeSessionId"
    ) VALUES
      ('order-valid', 'seller-1', '2026-08-20', '2026-08-22', 'DELIVERED', NULL, false, false, 'cs_valid'),
      ('order-disputed', 'seller-1', '2026-08-21', '2026-08-24', 'SHIPPED', NULL, false, true, 'cs_disputed'),
      ('order-refunded', 'seller-1', '2026-08-22', '2026-08-23', 'DELIVERED', 're_1', false, false, 'cs_refunded'),
      ('order-private', 'seller-1', '2026-08-23', '2026-08-25', 'PICKED_UP', NULL, false, false, 'cs_private'),
      ('order-banned', 'seller-2', '2026-08-20', '2026-08-22', 'DELIVERED', NULL, false, false, 'cs_banned'),
      ('order-vacation', 'seller-3', '2026-08-20', '2026-08-22', 'DELIVERED', NULL, false, false, 'cs_vacation');
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", "sellerProfileId", quantity
    ) VALUES
      ('item-valid', 'order-valid', 'listing-1', 'seller-1', 2),
      ('item-disputed', 'order-disputed', 'listing-1', 'seller-1', 4),
      ('item-refunded', 'order-refunded', 'listing-1', 'seller-1', 8),
      ('item-private', 'order-private', 'listing-private', 'seller-1', 3),
      ('item-banned', 'order-banned', 'listing-banned', 'seller-2', 5),
      ('item-vacation', 'order-vacation', 'listing-vacation', 'seller-3', 6);
  `);
  await database.exec(migration);
  return database;
}

describe("Order public aggregate authority PostgreSQL proof", () => {
  it("returns aggregate-only public seller and marketplace facts", async () => {
    const database = await createDatabase();
    try {
      const fulfilled = await database.query(`
        SELECT public.grainline_order_public_fulfilled_count() AS value
      `);
      assert.equal(Number(fulfilled.rows[0].value), 4);

      const seller = await database.query(`
        SELECT * FROM public.grainline_order_public_seller_stats(
          'seller-1', 0
        )
      `);
      assert.equal(Number(seller.rows[0].sold_count), 9);
      assert.equal(Number(seller.rows[0].shipped_count), 3);
      assert.ok(Number(seller.rows[0].avg_ship_days) > 0);
      const banned = await database.query(`
        SELECT * FROM public.grainline_order_public_seller_stats(
          'seller-2', 0
        )
      `);
      assert.equal(banned.rows.length, 0);

      const listings = await database.query(`
        SELECT * FROM public.grainline_order_public_listing_counts(
          ARRAY['listing-1', 'listing-private', 'listing-banned', 'listing-vacation']::text[]
        )
      `);
      assert.deepEqual(listings.rows, [{ listing_id: "listing-1", order_count: 1 }]);

      const marketplace = await database.query(`
        SELECT * FROM public.grainline_order_public_marketplace_listing_metrics()
      `);
      assert.deepEqual(marketplace.rows, [{
        total_views: 100,
        total_clicks: 20,
        total_orders: 1,
      }]);
    } finally {
      await database.close();
    }
  });

  it("rejects unsafe batches and grants only restricted runtime execution", async () => {
    const database = await createDatabase();
    try {
      await assert.rejects(
        database.query(`
          SELECT * FROM public.grainline_order_public_listing_counts(
            ARRAY['listing-1', 'listing-1']::text[]
          )
        `),
        /input is invalid/i,
      );
      await assert.rejects(
        database.query(`
          SELECT * FROM public.grainline_order_public_seller_stats('', 0)
        `),
        /input is invalid/i,
      );
      for (const identity of [
        "grainline_order_public_fulfilled_count()",
        "grainline_order_public_seller_stats(text,bigint)",
        "grainline_order_public_listing_counts(text[])",
        "grainline_order_public_marketplace_listing_metrics()",
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
