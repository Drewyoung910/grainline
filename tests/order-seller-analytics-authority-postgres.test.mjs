import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260901060000_prepare_order_seller_analytics_authority/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TYPE public."FulfillmentStatus" AS ENUM (
      'PENDING', 'READY_FOR_PICKUP', 'PICKED_UP', 'SHIPPED', 'DELIVERED'
    );
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
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      title varchar(200) NOT NULL,
      "createdAt" timestamp(3) without time zone NOT NULL,
      "viewCount" integer NOT NULL DEFAULT 0,
      "clickCount" integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public."Photo" (
      id text PRIMARY KEY,
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      url varchar(2048) NOT NULL,
      "sortOrder" integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "buyerId" text REFERENCES public."User"(id),
      "sellerProfileId" text NOT NULL REFERENCES public."SellerProfile"(id),
      "createdAt" timestamp(3) without time zone NOT NULL,
      "paidAt" timestamp(3) without time zone,
      "shippedAt" timestamp(3) without time zone,
      "fulfillmentStatus" public."FulfillmentStatus" NOT NULL,
      "sellerRefundId" text,
      "paymentRefundBlocked" boolean NOT NULL DEFAULT false,
      "stripeSessionId" text,
      "stripePaymentIntentId" text,
      "stripeChargeId" text,
      "itemsSubtotalCents" integer NOT NULL,
      "shippingAmountCents" integer NOT NULL DEFAULT 0,
      "taxAmountCents" integer NOT NULL DEFAULT 0,
      "giftWrappingPriceCents" integer,
      currency varchar(3) NOT NULL DEFAULT 'usd',
      "buyerName" varchar(200),
      "buyerEmail" varchar(254),
      "buyerDataPurgedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."OrderItem" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id),
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      "sellerProfileId" text NOT NULL REFERENCES public."SellerProfile"(id),
      quantity integer NOT NULL,
      "priceCents" integer NOT NULL,
      "listingSnapshot" jsonb,
      "createdAt" timestamp(3) without time zone NOT NULL
    );
    CREATE TABLE public."Cart" (
      id text PRIMARY KEY,
      "userId" text NOT NULL REFERENCES public."User"(id)
    );
    CREATE TABLE public."CartItem" (
      id text PRIMARY KEY,
      "cartId" text NOT NULL REFERENCES public."Cart"(id),
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      "createdAt" timestamp(3) without time zone NOT NULL
    );
    CREATE TABLE public."ListingViewDaily" (
      id text PRIMARY KEY,
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      "sellerProfileId" text NOT NULL REFERENCES public."SellerProfile"(id),
      date timestamp(3) without time zone NOT NULL,
      views integer NOT NULL DEFAULT 0,
      clicks integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public."Favorite" (
      "userId" text NOT NULL REFERENCES public."User"(id),
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      "createdAt" timestamp(3) without time zone NOT NULL,
      PRIMARY KEY ("userId", "listingId")
    );
    CREATE TABLE public."StockNotification" (
      id text PRIMARY KEY,
      "userId" text NOT NULL REFERENCES public."User"(id),
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      "createdAt" timestamp(3) without time zone NOT NULL
    );

    INSERT INTO public."User" (id, "deletedAt") VALUES
      ('seller-user-1', NULL), ('seller-user-2', NULL),
      ('buyer-1', NULL), ('buyer-2', NULL), ('buyer-deleted', '2026-08-20');
    INSERT INTO public."SellerProfile" (id, "userId") VALUES
      ('seller-1', 'seller-user-1'), ('seller-2', 'seller-user-2');
    INSERT INTO public."Listing" (
      id, "sellerId", title, "createdAt", "viewCount", "clickCount"
    ) VALUES
      ('listing-1', 'seller-1', 'Chair', '2026-01-01', 100, 20),
      ('listing-2', 'seller-1', 'Table', '2026-02-01', 50, 10),
      ('listing-other', 'seller-2', 'Other', '2026-01-01', 900, 800);
    INSERT INTO public."Photo" (id, "listingId", url, "sortOrder") VALUES
      ('photo-b', 'listing-1', 'https://example.com/b.jpg', 0),
      ('photo-a', 'listing-1', 'https://example.com/a.jpg', 0);
    INSERT INTO public."Order" (
      id, "buyerId", "sellerProfileId", "createdAt", "paidAt", "shippedAt",
      "fulfillmentStatus", "sellerRefundId", "paymentRefundBlocked",
      "stripeSessionId", "itemsSubtotalCents", "shippingAmountCents",
      "taxAmountCents", currency, "buyerName", "buyerEmail", "buyerDataPurgedAt"
    ) VALUES
      ('order-1', 'buyer-1', 'seller-1', '2026-08-01 10:00', '2026-08-01 10:01', '2026-08-02 10:00', 'DELIVERED', NULL, false, 'cs_1', 1000, 100, 80, 'usd', 'Buyer One', 'one@example.com', NULL),
      ('order-2', 'buyer-1', 'seller-1', '2026-08-02 10:00', '2026-08-02 10:01', NULL, 'PENDING', NULL, false, 'cs_2', 500, 0, 40, 'usd', 'Buyer One', 'one@example.com', NULL),
      ('order-refunded', 'buyer-2', 'seller-1', '2026-08-03', '2026-08-03', NULL, 'PENDING', 're_1', false, 'cs_refund', 900, 0, 0, 'usd', 'Buyer Two', 'two@example.com', NULL),
      ('order-prior', 'buyer-2', 'seller-1', '2026-07-01', '2026-07-01', NULL, 'PENDING', NULL, false, 'cs_prior', 300, 0, 0, 'usd', 'Buyer Two', 'two@example.com', NULL),
      ('order-later', 'buyer-1', 'seller-1', '2026-08-12', '2026-08-12', NULL, 'PENDING', NULL, false, 'cs_later', 400, 0, 0, 'usd', 'Buyer One', 'one@example.com', NULL),
      ('order-deleted', 'buyer-deleted', 'seller-1', '2026-08-13', '2026-08-13', NULL, 'PICKED_UP', NULL, false, 'cs_deleted', 200, 0, 0, 'usd', 'Deleted Buyer', 'deleted@example.com', '2026-08-20'),
      ('order-other', 'buyer-2', 'seller-2', '2026-08-01', '2026-08-01', NULL, 'DELIVERED', NULL, false, 'cs_other', 7000, 0, 0, 'usd', 'Other Buyer', 'other@example.com', NULL);
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", "sellerProfileId", quantity, "priceCents",
      "listingSnapshot", "createdAt"
    ) VALUES
      ('item-1b', 'order-1', 'listing-2', 'seller-1', 1, 400, '{"title":"Table"}', '2026-08-01 10:00'),
      ('item-1a', 'order-1', 'listing-1', 'seller-1', 2, 300, '{"title":"Chair"}', '2026-08-01 10:00'),
      ('item-2', 'order-2', 'listing-1', 'seller-1', 1, 500, '{"title":"Chair two"}', '2026-08-02'),
      ('item-refund', 'order-refunded', 'listing-1', 'seller-1', 1, 900, '{}', '2026-08-03'),
      ('item-prior', 'order-prior', 'listing-2', 'seller-1', 1, 300, '{}', '2026-07-01'),
      ('item-later', 'order-later', 'listing-1', 'seller-1', 1, 400, '{}', '2026-08-12'),
      ('item-deleted', 'order-deleted', 'listing-2', 'seller-1', 1, 200, '{}', '2026-08-13'),
      ('item-other', 'order-other', 'listing-other', 'seller-2', 1, 7000, '{}', '2026-08-01');
    INSERT INTO public."Cart" (id, "userId") VALUES
      ('cart-1', 'buyer-1'), ('cart-2', 'buyer-2');
    INSERT INTO public."CartItem" (id, "cartId", "listingId", "createdAt") VALUES
      ('cart-abandoned', 'cart-2', 'listing-2', '2026-08-10'),
      ('cart-purchased-later', 'cart-1', 'listing-1', '2026-08-11'),
      ('cart-recent', 'cart-2', 'listing-1', CURRENT_TIMESTAMP);
    INSERT INTO public."ListingViewDaily" (
      id, "listingId", "sellerProfileId", date, views, clicks
    ) VALUES
      ('view-1', 'listing-1', 'seller-1', '2026-08-01', 10, 3),
      ('view-2', 'listing-2', 'seller-1', '2026-08-01', 4, 1),
      ('view-other', 'listing-other', 'seller-2', '2026-08-01', 1000, 900);
    INSERT INTO public."Favorite" ("userId", "listingId", "createdAt") VALUES
      ('buyer-1', 'listing-1', '2026-08-04');
    INSERT INTO public."StockNotification" (id, "userId", "listingId", "createdAt") VALUES
      ('stock-1', 'buyer-2', 'listing-2', '2026-08-05');
  `);
  await database.exec(migration);
  return database;
}

describe("Order seller analytics authority PostgreSQL proof", () => {
  it("binds seller aggregates, deterministic recent sales and corrected cart semantics", async () => {
    const database = await createDatabase();
    try {
      const summary = await database.query(`
        SELECT * FROM public.grainline_order_seller_analytics_summary(
          'seller-user-1', 1785542400000, 1788307200000, false
        )
      `);
      assert.equal(summary.rows[0].seller_profile_id, "seller-1");
      assert.equal(Number(summary.rows[0].total_revenue_cents), 2100);
      assert.equal(Number(summary.rows[0].total_orders), 4);
      assert.equal(Number(summary.rows[0].total_buyers), 3);
      assert.equal(Number(summary.rows[0].repeat_buyers), 1);
      assert.equal(Number(summary.rows[0].cart_abandonment), 1);

      const denied = await database.query(`
        SELECT * FROM public.grainline_order_seller_analytics_summary(
          'unknown-user', 1785542400000, 1788307200000, false
        )
      `);
      assert.equal(denied.rows.length, 0);

      const recent = await database.query(`
        SELECT * FROM public.grainline_order_seller_recent_sales('seller-user-1')
      `);
      assert.equal(recent.rows.length, 5);
      const firstOrder = recent.rows.find((row) => row.order_id === "order-1");
      assert.equal(firstOrder.first_item_listing_snapshot.title, "Chair");
      const deleted = recent.rows.find((row) => row.order_id === "order-deleted");
      assert.equal(deleted.buyer_name, null);
      assert.equal(deleted.buyer_email, null);

      const completed = await database.query(`
        SELECT public.grainline_order_seller_completed_count('seller-user-1') AS value
      `);
      assert.equal(Number(completed.rows[0].value), 2);
    } finally {
      await database.close();
    }
  });

  it("returns bounded buckets/top listings and restricted execution grants", async () => {
    const database = await createDatabase();
    try {
      let buckets;
      try {
        buckets = await database.query(`
          SELECT * FROM public.grainline_order_seller_analytics_buckets(
            'seller-user-1', 1785542400000, 1788307200000, false, 'day'
          )
        `);
      } catch (error) {
        throw new Error(`${error.message}; detail=${error.detail ?? "none"}`);
      }
      assert.ok(buckets.rows.length >= 3);
      const top = await database.query(`
        SELECT * FROM public.grainline_order_seller_analytics_top_listings(
          'seller-user-1', 1785542400000, 1788307200000, false, false
        )
      `);
      assert.equal(top.rows[0].listing_id, "listing-1");
      assert.equal(top.rows[0].image_url, "https://example.com/a.jpg");
      assert.ok(top.rows.every((row) => row.listing_id !== "listing-other"));

      await assert.rejects(
        database.query(`
          SELECT * FROM public.grainline_order_seller_analytics_buckets(
            'seller-user-1', 0, 1000, false, 'minute'
          )
        `),
        /input is invalid/i,
      );
      for (const identity of [
        "grainline_order_seller_analytics_summary(text,bigint,bigint,boolean)",
        "grainline_order_seller_analytics_buckets(text,bigint,bigint,boolean,text)",
        "grainline_order_seller_analytics_top_listings(text,bigint,bigint,boolean,boolean)",
        "grainline_order_seller_recent_sales(text)",
        "grainline_order_seller_completed_count(text)",
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
