import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260901010000_prepare_order_participant_detail_authority/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id)
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      status text NOT NULL
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
      "reviewNote" text,
      "giftNote" varchar(500),
      "giftWrapping" boolean NOT NULL DEFAULT false,
      "giftWrappingPriceCents" integer,
      "buyerDataPurgedAt" timestamp(3) without time zone,
      "shipToLine1" varchar(200),
      "shipToLine2" varchar(200),
      "shipToCity" varchar(100),
      "shipToState" varchar(50),
      "shipToPostalCode" varchar(20),
      "shipToCountry" varchar(2),
      "buyerName" varchar(200),
      "buyerEmail" varchar(254),
      "sellerNotes" varchar(2000),
      "sellerRefundId" varchar(255),
      "sellerRefundAmountCents" integer,
      "labelStatus" text,
      "labelUrl" varchar(2048),
      "labelCarrier" varchar(100),
      "labelTrackingNumber" varchar(100),
      "labelPurchasedAt" timestamp(3) without time zone
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Order", public."OrderItem"
      TO grainline_app_runtime;
    GRANT SELECT ON TABLE public."User", public."SellerProfile", public."Listing"
      TO grainline_app_runtime;

    INSERT INTO public."User" (id, "deletedAt") VALUES
      ('buyer-1', NULL), ('buyer-2', NULL), ('buyer-deleted', '2026-08-31 12:00:00'),
      ('seller-user-1', NULL), ('seller-user-2', NULL);
    INSERT INTO public."SellerProfile" (id, "userId") VALUES
      ('seller-1', 'seller-user-1'), ('seller-2', 'seller-user-2');
    INSERT INTO public."Listing" (id, status) VALUES
      ('listing-active', 'ACTIVE'), ('listing-hidden', 'HIDDEN');
    INSERT INTO public."Order" (
      id, "buyerId", "sellerProfileId", "createdAt", "paidAt", currency,
      "itemsSubtotalCents", "shippingTitle", "shippingAmountCents", "taxAmountCents",
      "fulfillmentMethod", "fulfillmentStatus", "trackingCarrier", "trackingNumber",
      "shippedAt", "estimatedDeliveryDate", "processingDeadline", "shippingCarrier",
      "shippingService", "reviewNeeded", "reviewNote", "giftNote", "giftWrapping",
      "giftWrappingPriceCents", "shipToLine1", "shipToCity", "shipToState",
      "shipToPostalCode", "shipToCountry", "buyerName", "buyerEmail", "sellerNotes",
      "sellerRefundId", "sellerRefundAmountCents", "labelStatus", "labelUrl",
      "labelCarrier", "labelTrackingNumber", "labelPurchasedAt"
    ) VALUES (
      'order-1', 'buyer-1', 'seller-1', '2026-08-31 10:00:00', '2026-08-31 10:01:00', 'usd',
      500, 'Ground', 100, 50, 'SHIPPING', 'SHIPPED', 'UPS', 'track-1',
      '2026-08-31 11:00:00', '2026-09-04 11:00:00', '2026-09-02 11:00:00', 'UPS',
      'Ground', true, 'Seller Stripe account was deauthorized after payment. Staff only details',
      'Private gift note', true, 25, '1 Main', 'Austin', 'TX', '78701', 'US',
      'Buyer One', 'buyer1@example.test', 'Seller-only note', 're_secret_provider_id', 500,
      'PURCHASED', 'https://labels.example.test/label.pdf', 'UPS', 'label-track',
      '2026-08-31 11:05:00'
    ), (
      'order-2', 'buyer-deleted', 'seller-1', '2026-08-31 09:00:00', NULL, 'usd',
      200, NULL, 0, 0, 'PICKUP', 'PENDING', NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, false, NULL,
      'Should disappear', false, NULL, 'Old address', 'Austin', 'TX', '78701', 'US',
      'Deleted Buyer', 'deleted@example.test', NULL, 'pending', 200,
      NULL, NULL, NULL, NULL, NULL
    );
    UPDATE public."Order"
       SET "buyerDataPurgedAt" = '2026-08-31 13:00:00'
     WHERE id = 'order-2';
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", "priceCents", quantity,
      "listingSnapshot", "selectedVariants", "createdAt"
    ) VALUES (
      'item-1', 'order-1', 'listing-active', 500, 1,
      '{"title":"Table","description":"Snapshot","priceCents":500,"imageUrls":["https://img.example.test/a.jpg"],"category":"FURNITURE","tags":["oak"],"sellerName":"Maker One","capturedAt":"2026-08-31T10:00:00.000Z","listingType":"MADE_TO_ORDER","processingTimeMinDays":2,"processingTimeMaxDays":4,"shipsWithinDays":null,"unexpectedSecret":"must not escape"}',
      '[{"groupName":"Finish","optionLabel":"Natural","priceAdjustCents":0,"unexpectedSecret":"must not escape"}]',
      '2026-08-31 10:00:01'
    ), (
      'item-2', 'order-1', 'listing-hidden', 100, 2, NULL, NULL,
      '2026-08-31 10:00:02'
    );
  `);
  await database.exec(migration);
  return database;
}

describe("Order participant detail authority", () => {
  it("returns one actor-bound buyer projection without provider identifiers", async () => {
    const database = await createDatabase();
    try {
      const result = await database.query(
        "SELECT * FROM public.grainline_order_buyer_detail($1, $2)",
        ["buyer-1", "order-1"],
      );
      assert.equal(result.rows.length, 1);
      const row = result.rows[0];
      assert.equal(row.seller_refund_state, "RECORDED");
      assert.equal(row.seller_refund_amount_cents, 500);
      assert.equal(row.seller_user_id, "seller-user-1");
      assert.equal(JSON.stringify(row).includes("re_secret_provider_id"), false);
      assert.equal(JSON.stringify(row).includes("unexpectedSecret"), false);
      assert.deepEqual(row.items.map((item) => item.listingActive), [true, false]);
      assert.equal(row.items[0].listingSnapshot.title, "Table");
      assert.deepEqual(row.items[0].selectedVariants, [{
        groupName: "Finish",
        optionLabel: "Natural",
        priceAdjustCents: 0,
      }]);

      const foreign = await database.query(
        "SELECT * FROM public.grainline_order_buyer_detail($1, $2)",
        ["buyer-2", "order-1"],
      );
      assert.equal(foreign.rows.length, 0);
    } finally {
      await database.close();
    }
  });

  it("returns durable seller fields, derived holds, and purged buyer data", async () => {
    const database = await createDatabase();
    try {
      const result = await database.query(
        "SELECT * FROM public.grainline_order_seller_detail($1, $2)",
        ["seller-user-1", "order-1"],
      );
      assert.equal(result.rows.length, 1);
      const row = result.rows[0];
      assert.equal(row.deauthorized_review_hold, true);
      assert.equal(row.seller_notes, "Seller-only note");
      assert.equal(row.label_status, "PURCHASED");
      assert.equal(JSON.stringify(row).includes("Staff only details"), false);
      assert.equal(JSON.stringify(row).includes("re_secret_provider_id"), false);

      const purged = await database.query(
        "SELECT * FROM public.grainline_order_seller_detail($1, $2)",
        ["seller-user-1", "order-2"],
      );
      assert.equal(purged.rows[0].buyer_name, null);
      assert.equal(purged.rows[0].buyer_email, null);
      assert.equal(purged.rows[0].gift_note, null);
      assert.equal(purged.rows[0].ship_to_line_1, null);
      assert.equal(purged.rows[0].seller_refund_state, "PROCESSING");
      assert.equal(purged.rows[0].seller_refund_amount_cents, null);

      const foreign = await database.query(
        "SELECT * FROM public.grainline_order_seller_detail($1, $2)",
        ["seller-user-2", "order-1"],
      );
      assert.equal(foreign.rows.length, 0);
    } finally {
      await database.close();
    }
  });

  it("rejects malformed inputs and exposes only fixed runtime execute", async () => {
    const database = await createDatabase();
    try {
      await assert.rejects(
        database.query("SELECT * FROM public.grainline_order_buyer_detail('', 'order-1')"),
        /input is invalid/i,
      );
      for (const identity of [
        "grainline_order_buyer_detail(text,text)",
        "grainline_order_seller_detail(text,text)",
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
