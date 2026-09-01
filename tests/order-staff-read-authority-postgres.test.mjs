import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260901020000_prepare_order_staff_read_authority/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      name text,
      email text,
      role text NOT NULL,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "displayName" text
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      status text NOT NULL,
      "listingType" text NOT NULL
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "buyerId" text REFERENCES public."User"(id),
      "sellerProfileId" text REFERENCES public."SellerProfile"(id),
      "createdAt" timestamp(3) without time zone NOT NULL,
      "paidAt" timestamp(3) without time zone,
      currency varchar(3) NOT NULL DEFAULT 'usd',
      "itemsSubtotalCents" integer NOT NULL DEFAULT 0,
      "shippingTitle" varchar(200),
      "shippingAmountCents" integer NOT NULL DEFAULT 0,
      "taxAmountCents" integer NOT NULL DEFAULT 0,
      "fulfillmentMethod" text,
      "fulfillmentStatus" text NOT NULL DEFAULT 'PENDING',
      "trackingCarrier" varchar(100),
      "trackingNumber" varchar(100),
      "pickupReadyAt" timestamp(3) without time zone,
      "pickedUpAt" timestamp(3) without time zone,
      "shippedAt" timestamp(3) without time zone,
      "deliveredAt" timestamp(3) without time zone,
      "estimatedDeliveryDate" timestamp(3) without time zone,
      "processingDeadline" timestamp(3) without time zone,
      "shippingCarrier" varchar(100),
      "shippingService" varchar(100),
      "reviewNeeded" boolean NOT NULL DEFAULT false,
      "reviewNote" varchar(10000),
      "giftNote" varchar(500),
      "giftWrapping" boolean NOT NULL DEFAULT false,
      "giftWrappingPriceCents" integer,
      "buyerDataPurgedAt" timestamp(3) without time zone,
      "buyerName" varchar(200),
      "buyerEmail" varchar(254),
      "shipToLine1" varchar(200),
      "shipToLine2" varchar(200),
      "shipToCity" varchar(100),
      "shipToState" varchar(50),
      "shipToPostalCode" varchar(20),
      "shipToCountry" varchar(2),
      "quotedShippingAmountCents" integer,
      "quotedToCity" varchar(100),
      "quotedToState" varchar(50),
      "quotedToPostalCode" varchar(20),
      "quotedToCountry" varchar(2),
      "quotedUseCalculatedShipping" boolean,
      "sellerRefundId" varchar(255),
      "sellerRefundAmountCents" integer,
      "refundClaimId" varchar(255),
      "labelStatus" text,
      "labelClawbackStatus" varchar(50)
    );
    CREATE TABLE public."OrderItem" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id),
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      "priceCents" integer NOT NULL,
      quantity integer NOT NULL,
      "listingSnapshot" jsonb,
      "selectedVariants" jsonb,
      "createdAt" timestamp(3) without time zone NOT NULL
    );

    INSERT INTO public."User" (id, name, email, role, banned, "deletedAt") VALUES
      ('employee-1', 'Staff One', 'staff@example.test', 'EMPLOYEE', false, NULL),
      ('admin-1', 'Admin One', 'admin@example.test', 'ADMIN', false, NULL),
      ('banned-staff', 'Banned', 'banned@example.test', 'EMPLOYEE', true, NULL),
      ('deleted-staff', 'Deleted', 'deleted-staff@example.test', 'ADMIN', false, '2026-08-31 09:00:00'),
      ('buyer-1', 'Buyer One', 'buyer@example.test', 'USER', false, NULL),
      ('seller-user-1', 'Seller One', 'seller@example.test', 'USER', false, NULL);
    INSERT INTO public."SellerProfile" (id, "userId", "displayName") VALUES
      ('seller-1', 'seller-user-1', 'Current Maker Name');
    INSERT INTO public."Listing" (id, status, "listingType") VALUES
      ('listing-1', 'ACTIVE', 'IN_STOCK');
    INSERT INTO public."Order" (
      id, "buyerId", "sellerProfileId", "createdAt", "paidAt", currency,
      "itemsSubtotalCents", "shippingTitle", "shippingAmountCents", "taxAmountCents",
      "fulfillmentMethod", "fulfillmentStatus", "trackingCarrier", "trackingNumber",
      "shippedAt", "estimatedDeliveryDate", "processingDeadline", "shippingCarrier",
      "shippingService", "reviewNeeded", "reviewNote", "giftNote", "giftWrapping",
      "giftWrappingPriceCents", "buyerName", "buyerEmail", "shipToLine1", "shipToCity",
      "shipToState", "shipToPostalCode", "shipToCountry", "quotedShippingAmountCents",
      "quotedToCity", "quotedToState", "quotedToPostalCode", "quotedToCountry",
      "quotedUseCalculatedShipping", "sellerRefundId", "sellerRefundAmountCents",
      "refundClaimId", "labelStatus", "labelClawbackStatus"
    ) VALUES (
      'order-1', 'buyer-1', 'seller-1', '2026-08-31 10:00:00', '2026-08-31 10:01:00', 'usd',
      500, 'Ground', 100, 50, 'SHIPPING', 'SHIPPED', 'UPS', 'track-1',
      '2026-08-31 11:00:00', '2026-09-04 11:00:00', '2026-09-02 11:00:00',
      'UPS', 'Ground', true, 'Private staff review note', 'Private gift note', true,
      25, 'Buyer One', 'buyer@example.test', '1 Main', 'Austin', 'TX', '78701', 'US',
      90, 'Austin', 'TX', '78701', 'US', true, 're_staff_provider_id', 500,
      NULL, 'PURCHASED', 'RESOLVED'
    );
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", "priceCents", quantity,
      "listingSnapshot", "selectedVariants", "createdAt"
    ) VALUES (
      'item-1', 'order-1', 'listing-1', 500, 1,
      '{"title":"Historical Table","description":"Snapshot","priceCents":500,"imageUrls":[],"category":"FURNITURE","tags":[],"sellerName":"Historical Maker","capturedAt":"2026-08-31T10:00:00.000Z","listingType":"IN_STOCK","unexpectedSecret":"blocked"}',
      '[{"groupName":"Finish","optionLabel":"Natural","priceAdjustCents":0,"unexpectedSecret":"blocked"}]',
      '2026-08-31 10:00:01'
    );
  `);
  await database.exec(migration);
  await database.exec(`
    GRANT EXECUTE ON FUNCTION public.grainline_order_staff_page(text, text, integer, integer)
      TO grainline_staff_read_runtime;
    GRANT EXECUTE ON FUNCTION public.grainline_order_staff_detail(text, text)
      TO grainline_staff_read_runtime;
  `);
  return database;
}

describe("Order staff read authority", () => {
  it("keeps ordinary runtime denied and requires the dedicated session role", async () => {
    const database = await createDatabase();
    try {
      await database.exec("SET SESSION AUTHORIZATION grainline_app_runtime");
      await assert.rejects(
        database.query("SELECT * FROM public.grainline_order_staff_detail('employee-1', 'order-1')"),
        /permission denied/i,
      );
      const privileges = await database.query(`
        SELECT pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_order_staff_detail(text,text)',
          'EXECUTE'
        ) AS runtime_execute
      `);
      assert.equal(privileges.rows[0].runtime_execute, false);
    } finally {
      await database.close();
    }
  });

  it("returns bounded queue and detail projections only for a live staff actor", async () => {
    const database = await createDatabase();
    try {
      await database.exec("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
      const page = await database.query(
        "SELECT * FROM public.grainline_order_staff_page($1, $2, $3, $4)",
        ["employee-1", "REVIEW_NEEDED", 1, 25],
      );
      assert.equal(Number(page.rows[0].total_count), 1);
      assert.equal(page.rows[0].orders.length, 1);
      assert.equal(page.rows[0].orders[0].sellerLabel, "Historical Maker");
      assert.equal(page.rows[0].orders[0].items[0].title, "Historical Table");
      assert.equal(JSON.stringify(page.rows[0]).includes("re_staff_provider_id"), false);

      const detail = await database.query(
        "SELECT * FROM public.grainline_order_staff_detail($1, $2)",
        ["admin-1", "order-1"],
      );
      assert.equal(detail.rows.length, 1);
      assert.equal(detail.rows[0].seller_refund_id, "re_staff_provider_id");
      assert.equal(detail.rows[0].items[0].currentListingType, "IN_STOCK");
      assert.equal(detail.rows[0].items[0].listingSnapshot.title, "Historical Table");
      assert.equal(JSON.stringify(detail.rows[0]).includes("unexpectedSecret"), false);

      for (const actor of ["buyer-1", "banned-staff", "deleted-staff", "missing"]) {
        const denied = await database.query(
          "SELECT * FROM public.grainline_order_staff_detail($1, $2)",
          [actor, "order-1"],
        );
        assert.equal(denied.rows.length, 0, actor);
      }
    } finally {
      await database.close();
    }
  });

  it("fails closed on malformed scope and oversized detail", async () => {
    const database = await createDatabase();
    try {
      await database.exec("RESET SESSION AUTHORIZATION");
      await database.exec(`
        INSERT INTO public."OrderItem" (
          id, "orderId", "listingId", "priceCents", quantity,
          "listingSnapshot", "selectedVariants", "createdAt"
        )
        SELECT
          'bulk-' || value::text,
          'order-1',
          'listing-1',
          1,
          1,
          '{"title":"Bulk","priceCents":1}'::jsonb,
          NULL,
          '2026-08-31 12:00:00'::timestamp + value * interval '1 millisecond'
        FROM pg_catalog.generate_series(1, 100) AS value;
      `);
      await database.exec("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
      await assert.rejects(
        database.query("SELECT * FROM public.grainline_order_staff_page('employee-1', 'RAW', 1, 25)"),
        /input is invalid/i,
      );
      await assert.rejects(
        database.query("SELECT * FROM public.grainline_order_staff_detail('employee-1', 'order-1')"),
        /item count exceeds limit/i,
      );
    } finally {
      await database.close();
    }
  });
});
