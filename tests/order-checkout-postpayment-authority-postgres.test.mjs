import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const candidate = fs.readFileSync(
  "docs/rls-drafts/order-checkout-postpayment-authority.sql",
  "utf8",
);
const rows = (result) => result.rows;
let db;
let dataDirectory;

const snapshot = {
  title: "Proof item",
  description: "Retained description",
  priceCents: 500,
  imageUrls: ["https://cdn.example/proof.jpg"],
  category: null,
  tags: ["proof"],
  sellerName: "Proof Shop",
  capturedAt: "2026-09-05T12:00:00.000Z",
  listingType: "IN_STOCK",
  processingTimeMinDays: null,
  processingTimeMaxDays: null,
  shipsWithinDays: 2,
  shippingWeightGrams: 100,
  shippingLengthCm: 10,
  shippingWidthCm: 10,
  shippingHeightCm: 10,
};

async function project(eventId = "evt-paid", generation = 3n, sessionId = "cs-paid") {
  return rows(await db.query(`
    SELECT * FROM public.grainline_stripe_checkout_postpayment($1, $2, $3)
  `, [eventId, generation, sessionId]));
}

describe("Order checkout post-payment PostgreSQL authority", () => {
  before(async () => {
    dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "grainline-order-postpayment-"));
    db = new PGlite({ dataDir: dataDirectory });
    await db.exec(`
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS;
      CREATE TABLE public."User" (
        id text PRIMARY KEY,
        email varchar(254) NOT NULL,
        name varchar(100)
      );
      CREATE TABLE public."SellerProfile" (
        id text PRIMARY KEY,
        "userId" text NOT NULL REFERENCES public."User"(id),
        "displayName" varchar(100) NOT NULL
      );
      CREATE TABLE public."Listing" (
        id text PRIMARY KEY,
        "stockQuantity" integer
      );
      CREATE TABLE public."StripeWebhookEvent" (
        id varchar(255) PRIMARY KEY,
        type varchar(100) NOT NULL,
        "sourceObjectId" varchar(255),
        "claimGeneration" bigint NOT NULL,
        "processingStartedAt" timestamp(3) without time zone,
        "processedAt" timestamp(3) without time zone
      );
      CREATE TABLE public."Order" (
        id text PRIMARY KEY,
        "buyerId" text,
        "sellerProfileId" text,
        "paidAt" timestamp(3) without time zone,
        "stripeSessionId" varchar(255) UNIQUE,
        "sellerRefundId" varchar(255),
        "paymentRefundBlocked" boolean NOT NULL DEFAULT false,
        "reviewNeeded" boolean NOT NULL DEFAULT false,
        "reviewNote" varchar(10000),
        "itemsSubtotalCents" integer NOT NULL DEFAULT 0,
        "shippingAmountCents" integer NOT NULL DEFAULT 0,
        "taxAmountCents" integer NOT NULL DEFAULT 0,
        "giftWrapping" boolean NOT NULL DEFAULT false,
        "giftWrappingPriceCents" integer,
        currency varchar(3) NOT NULL DEFAULT 'usd',
        "estimatedDeliveryDate" timestamp(3) without time zone,
        "processingDeadline" timestamp(3) without time zone,
        "shipToLine1" varchar(200),
        "shipToCity" varchar(100),
        "shipToState" varchar(50),
        "shipToPostalCode" varchar(20)
      );
      CREATE TABLE public."OrderItem" (
        id text PRIMARY KEY,
        "orderId" text NOT NULL REFERENCES public."Order"(id),
        "listingId" text NOT NULL REFERENCES public."Listing"(id),
        "sellerProfileId" text,
        quantity integer NOT NULL,
        "priceCents" integer NOT NULL,
        "listingSnapshot" jsonb
      );
      REVOKE ALL ON public."User", public."SellerProfile", public."Listing",
        public."StripeWebhookEvent", public."Order", public."OrderItem" FROM PUBLIC;
      INSERT INTO public."User" (id, email, name) VALUES
        ('buyer-1', 'buyer@example.com', 'Proof Buyer'),
        ('seller-user', 'seller@example.com', 'Proof Seller');
      INSERT INTO public."SellerProfile" (id, "userId", "displayName")
        VALUES ('seller-1', 'seller-user', 'Proof Shop');
      INSERT INTO public."Listing" (id, "stockQuantity") VALUES ('listing-1', 2);
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES (
        'evt-paid', 'checkout.session.completed', 'cs-paid', 3, CURRENT_TIMESTAMP
      );
      INSERT INTO public."Order" (
        id, "buyerId", "sellerProfileId", "paidAt", "stripeSessionId",
        "itemsSubtotalCents", "shippingAmountCents", "taxAmountCents",
        "estimatedDeliveryDate", "processingDeadline", "shipToLine1",
        "shipToCity", "shipToState", "shipToPostalCode"
      ) VALUES (
        'order-1', 'buyer-1', 'seller-1', CURRENT_TIMESTAMP, 'cs-paid',
        500, 100, 50, CURRENT_TIMESTAMP + INTERVAL '5 days',
        CURRENT_TIMESTAMP + INTERVAL '2 days', '1 Main St', 'Austin', 'TX', '78701'
      );
    `);
    await db.query(`
      INSERT INTO public."OrderItem" (
        id, "orderId", "listingId", "sellerProfileId", quantity,
        "priceCents", "listingSnapshot"
      ) VALUES ('item-1', 'order-1', 'listing-1', 'seller-1', 1, 500, $1::jsonb)
    `, [JSON.stringify(snapshot)]);
    await db.exec(candidate);
  });

  after(async () => {
    await db?.close();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  });

  it("returns one bounded source-derived projection as restricted runtime", async () => {
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      const result = await project();
      assert.equal(result.length, 1);
      assert.equal(result[0].outcome, "ready");
      assert.equal(result[0].order_id, "order-1");
      assert.equal(result[0].projection.buyerId, "buyer-1");
      assert.equal(result[0].projection.sellerUserId, "seller-user");
      assert.equal(result[0].projection.isFirstLegitimateSale, true);
      assert.equal(result[0].projection.items[0].currentStockQuantity, 2);
      assert.equal(result[0].projection.items[0].listingSnapshot.title, "Proof item");
    } finally {
      await db.exec("RESET ROLE");
    }
  });

  it("keeps direct tables closed and rejects forged event identity", async () => {
    const privileges = rows(await db.query(`
      SELECT pg_catalog.has_table_privilege(
               'grainline_app_runtime', 'public."Order"', 'SELECT'
             ) AS can_select,
             pg_catalog.has_function_privilege(
               'grainline_app_runtime',
               'public.grainline_stripe_checkout_postpayment(text,bigint,text)',
               'EXECUTE'
             ) AS can_execute
    `))[0];
    assert.deepEqual(privileges, { can_select: false, can_execute: true });
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      await assert.rejects(project("evt-paid", 4n), /event authority is invalid/);
      await assert.rejects(project("evt-paid", 3n, "cs-forged"), /event authority is invalid/);
      await assert.rejects(db.query(`SELECT * FROM public."Order"`), /permission denied/);
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
    }
  });

  it("returns no PII projection for a blocked checkout", async () => {
    await db.exec(`UPDATE public."Order" SET "paymentRefundBlocked" = true WHERE id = 'order-1'`);
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      const result = await project();
      assert.deepEqual(result, [{ outcome: "blocked", order_id: "order-1", projection: null }]);
    } finally {
      await db.exec("RESET ROLE");
    }
    await db.exec(`UPDATE public."Order" SET "paymentRefundBlocked" = false WHERE id = 'order-1'`);
  });

  it("selects one deterministic first legitimate sale under concurrent orders", async () => {
    await db.exec(`
      INSERT INTO public."Order" (
        id, "buyerId", "sellerProfileId", "paidAt", "stripeSessionId",
        "itemsSubtotalCents", "shippingAmountCents", "taxAmountCents"
      ) VALUES
        ('order-refunded', 'buyer-1', 'seller-1', CURRENT_TIMESTAMP, 'cs-refunded',
         500, 0, 0),
        ('order-second', 'buyer-1', 'seller-1', CURRENT_TIMESTAMP + INTERVAL '1 second', 'cs-second',
         500, 0, 0);
      UPDATE public."Order" SET "sellerRefundId" = 're_refunded'
       WHERE id = 'order-refunded';
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES (
        'evt-second', 'checkout.session.async_payment_succeeded', 'cs-second', 1,
        CURRENT_TIMESTAMP
      );
    `);
    await db.query(`
      INSERT INTO public."OrderItem" (
        id, "orderId", "listingId", "sellerProfileId", quantity,
        "priceCents", "listingSnapshot"
      ) VALUES ('item-second', 'order-second', 'listing-1', 'seller-1', 1, 500, $1::jsonb)
    `, [JSON.stringify(snapshot)]);
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      const result = await project();
      assert.equal(result[0].projection.isFirstLegitimateSale, true);
      const second = await project("evt-second", 1n, "cs-second");
      assert.equal(second[0].projection.isFirstLegitimateSale, false);
    } finally {
      await db.exec("RESET ROLE");
    }
  });
});
