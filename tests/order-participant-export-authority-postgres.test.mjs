import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260901030000_prepare_order_participant_export_authority/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TABLE public."User" (id text PRIMARY KEY);
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id)
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
      "buyerEmail" varchar(254),
      "buyerName" varchar(200),
      "shipToLine1" varchar(200),
      "shipToLine2" varchar(200),
      "shipToCity" varchar(100),
      "shipToState" varchar(50),
      "shipToPostalCode" varchar(20),
      "shipToCountry" varchar(2),
      "fulfillmentMethod" text,
      "fulfillmentStatus" text NOT NULL DEFAULT 'PENDING',
      "trackingCarrier" varchar(100),
      "trackingNumber" varchar(100),
      "shippedAt" timestamp(3) without time zone,
      "deliveredAt" timestamp(3) without time zone,
      "sellerRefundId" varchar(255),
      "sellerRefundAmountCents" integer,
      "giftNote" varchar(500),
      "giftWrapping" boolean NOT NULL DEFAULT false,
      "giftWrappingPriceCents" integer,
      "buyerDataPurgedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."OrderItem" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id),
      "listingId" text NOT NULL,
      "priceCents" integer NOT NULL,
      quantity integer NOT NULL,
      "listingSnapshot" jsonb,
      "selectedVariants" jsonb,
      "createdAt" timestamp(3) without time zone NOT NULL
    );
    INSERT INTO public."User" (id) VALUES ('buyer-1'), ('buyer-2'), ('seller-user-1'), ('seller-user-2');
    INSERT INTO public."SellerProfile" (id, "userId") VALUES
      ('seller-1', 'seller-user-1'), ('seller-2', 'seller-user-2');
    INSERT INTO public."Order" (
      id, "buyerId", "sellerProfileId", "createdAt", "paidAt", currency,
      "itemsSubtotalCents", "shippingTitle", "shippingAmountCents", "taxAmountCents",
      "buyerEmail", "buyerName", "shipToLine1", "shipToCity", "shipToState",
      "shipToPostalCode", "shipToCountry", "fulfillmentMethod", "fulfillmentStatus",
      "sellerRefundId", "sellerRefundAmountCents", "giftNote", "giftWrapping",
      "giftWrappingPriceCents"
    ) VALUES
      ('order-1', 'buyer-1', 'seller-1', '2026-08-31 10:00:00', '2026-08-31 10:01:00', 'usd',
       500, 'Ground', 100, 50, 'buyer@example.test', 'Buyer', '1 Main', 'Austin', 'TX',
       '78701', 'US', 'SHIPPING', 'SHIPPED', 're_provider_secret', 500, 'Gift', true, 25),
      ('order-2', 'buyer-2', 'seller-2', '2026-08-31 09:00:00', NULL, 'usd',
       600, NULL, 0, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, 'PENDING', NULL, NULL, NULL, false, NULL);
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", "priceCents", quantity,
      "listingSnapshot", "selectedVariants", "createdAt"
    ) VALUES (
      'item-1', 'order-1', 'listing-1', 500, 1,
      '{"title":"Historical","priceCents":500,"imageUrls":[],"sellerName":"Maker","unexpectedSecret":"drop"}',
      '[{"groupName":"Finish","optionLabel":"Natural","priceAdjustCents":0,"unexpectedSecret":"drop"}]',
      '2026-08-31 10:00:01'
    );
  `);
  await database.exec(migration);
  return database;
}

describe("Order participant export authority PostgreSQL proof", () => {
  it("returns only actor-bound buyer and durable-seller pages", async () => {
    const database = await createDatabase();
    try {
      await database.exec("SET SESSION AUTHORIZATION grainline_app_runtime");
      const buyer = await database.query(
        "SELECT * FROM public.grainline_order_buyer_export_page($1, $2, $3, $4)",
        ["buyer-1", 25, null, null],
      );
      assert.equal(buyer.rows.length, 1);
      assert.equal(buyer.rows[0].order_data.id, "order-1");
      assert.equal(buyer.rows[0].order_data.sellerRefundState, "RECORDED");
      assert.equal(JSON.stringify(buyer.rows[0]).includes("re_provider_secret"), false);
      assert.equal(JSON.stringify(buyer.rows[0]).includes("unexpectedSecret"), false);

      const seller = await database.query(
        "SELECT * FROM public.grainline_order_seller_export_page($1, $2, $3, $4)",
        ["seller-user-1", 25, null, null],
      );
      assert.equal(seller.rows.length, 1);
      assert.equal(seller.rows[0].order_data.id, "order-1");
      assert.equal("buyerEmail" in seller.rows[0].order_data, false);

      const otherBuyer = await database.query(
        "SELECT * FROM public.grainline_order_buyer_export_page($1, $2, $3, $4)",
        ["buyer-2", 25, null, null],
      );
      assert.deepEqual(otherBuyer.rows.map((row) => row.order_id), ["order-2"]);
      const otherSeller = await database.query(
        "SELECT * FROM public.grainline_order_seller_export_page($1, $2, $3, $4)",
        ["seller-user-2", 25, null, null],
      );
      assert.deepEqual(otherSeller.rows.map((row) => row.order_id), ["order-2"]);
    } finally {
      await database.close();
    }
  });

  it("uses a stable cursor and fails closed on malformed bounds", async () => {
    const database = await createDatabase();
    try {
      await database.exec("SET SESSION AUTHORIZATION grainline_app_runtime");
      const first = await database.query(
        "SELECT * FROM public.grainline_order_buyer_export_page('buyer-1', 1, NULL, NULL)",
      );
      const next = await database.query(
        "SELECT * FROM public.grainline_order_buyer_export_page($1, $2, $3, $4)",
        ["buyer-1", 1, first.rows[0].created_at_epoch_millis, first.rows[0].order_id],
      );
      assert.equal(next.rows.length, 0);
      await assert.rejects(
        database.query("SELECT * FROM public.grainline_order_buyer_export_page('buyer-1', 26, NULL, NULL)"),
        /input is invalid/i,
      );
      await assert.rejects(
        database.query("SELECT * FROM public.grainline_order_seller_export_page('seller-user-1', 1, 1, NULL)"),
        /input is invalid/i,
      );
    } finally {
      await database.close();
    }
  });
});
