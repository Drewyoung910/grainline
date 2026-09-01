import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260901120000_prepare_order_receipt_notification_authority/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TYPE public."NotificationType" AS ENUM (
      'NEW_MESSAGE', 'NEW_ORDER', 'ORDER_SHIPPED', 'ORDER_DELIVERED',
      'CASE_OPENED', 'CASE_MESSAGE', 'CASE_RESOLVED', 'REFUND_ISSUED',
      'CUSTOM_ORDER_REQUEST', 'CUSTOM_ORDER_LINK', 'VERIFICATION_APPROVED',
      'VERIFICATION_REJECTED', 'BACK_IN_STOCK', 'NEW_REVIEW', 'LOW_STOCK',
      'NEW_FAVORITE', 'NEW_BLOG_COMMENT', 'BLOG_COMMENT_REPLY', 'NEW_FOLLOWER',
      'FOLLOWED_MAKER_NEW_LISTING', 'FOLLOWED_MAKER_NEW_BLOG',
      'SELLER_BROADCAST', 'COMMISSION_INTEREST', 'LISTING_APPROVED',
      'LISTING_REJECTED', 'ACCOUNT_WARNING', 'LISTING_FLAGGED_BY_USER',
      'PAYMENT_DISPUTE', 'PAYOUT_FAILED'
    );
    CREATE TYPE public."FulfillmentMethod" AS ENUM ('PICKUP', 'SHIPPING');
    CREATE TYPE public."FulfillmentStatus" AS ENUM (
      'PENDING', 'READY_FOR_PICKUP', 'PICKED_UP', 'SHIPPED', 'DELIVERED'
    );
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone,
      "notificationPreferences" jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id)
    );
    CREATE TABLE public."Block" (
      id text PRIMARY KEY,
      "blockerId" text NOT NULL REFERENCES public."User"(id),
      "blockedId" text NOT NULL REFERENCES public."User"(id),
      UNIQUE ("blockerId", "blockedId")
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "buyerId" text REFERENCES public."User"(id),
      "sellerProfileId" text REFERENCES public."SellerProfile"(id),
      "paidAt" timestamp(3) without time zone,
      "sellerRefundId" text,
      "paymentRefundBlocked" boolean NOT NULL DEFAULT false,
      "paymentOpenDisputeBlocked" boolean NOT NULL DEFAULT false,
      "fulfillmentMethod" public."FulfillmentMethod",
      "fulfillmentStatus" public."FulfillmentStatus" NOT NULL,
      "deliveredAt" timestamp(3) without time zone,
      "pickedUpAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SystemAuditLog" (
      id text PRIMARY KEY,
      "actorType" text NOT NULL,
      "actorId" text,
      action text NOT NULL,
      "targetType" text NOT NULL,
      "targetId" text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE public."Notification" (
      id text PRIMARY KEY,
      "userId" text NOT NULL REFERENCES public."User"(id),
      "relatedUserId" text,
      type public."NotificationType" NOT NULL,
      title varchar(200) NOT NULL,
      body varchar(1000) NOT NULL,
      link varchar(2048),
      "sourceType" varchar(80),
      "sourceId" varchar(191),
      "dedupKey" varchar(64) NOT NULL,
      read boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("userId", type, "dedupKey")
    );
    ALTER TABLE public."Notification" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public."Notification" FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public."Notification" FROM PUBLIC, grainline_app_runtime;

    INSERT INTO public."User" (id) VALUES
      ('buyer-1'), ('seller-user-1'), ('seller-user-2');
    INSERT INTO public."SellerProfile" (id, "userId") VALUES
      ('seller-1', 'seller-user-1'), ('seller-2', 'seller-user-2');
    INSERT INTO public."Order" (
      id, "buyerId", "sellerProfileId", "paidAt", "fulfillmentMethod",
      "fulfillmentStatus", "deliveredAt", "pickedUpAt"
    ) VALUES
      ('order-delivery', 'buyer-1', 'seller-1', CURRENT_TIMESTAMP,
       'SHIPPING', 'DELIVERED', CURRENT_TIMESTAMP, NULL),
      ('order-pickup', 'buyer-1', 'seller-1', CURRENT_TIMESTAMP,
       'PICKUP', 'PICKED_UP', NULL, CURRENT_TIMESTAMP);
    INSERT INTO public."SystemAuditLog" (
      id, "actorType", "actorId", action, "targetType", "targetId", metadata
    ) VALUES
      ('audit-delivery', 'user', 'buyer-1', 'ORDER_FULFILLMENT_TRANSITION',
       'ORDER', 'order-delivery',
       '{"action":"delivered","fulfillmentMethod":"SHIPPING","previousStatus":"SHIPPED","newStatus":"DELIVERED"}'),
      ('audit-pickup', 'user', 'buyer-1', 'ORDER_FULFILLMENT_TRANSITION',
       'ORDER', 'order-pickup',
       '{"action":"picked_up","fulfillmentMethod":"PICKUP","previousStatus":"READY_FOR_PICKUP","newStatus":"PICKED_UP"}');
  `);
  await database.exec(migration);
  await database.exec(`
    CREATE FUNCTION public.grainline_notification_create_order_event(
      p_notification_id text,
      p_user_id text,
      p_type public."NotificationType",
      p_source_type text,
      p_source_id text,
      p_related_user_id text
    ) RETURNS text
    LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
    SET search_path = pg_catalog
    AS $wrapper$
    DECLARE notification_id text;
    BEGIN
      IF p_source_type NOT IN (
        'order_checkout', 'order_fulfillment', 'order_payment',
        'stripe_payout_failure'
      ) THEN
        RAISE EXCEPTION 'order notification requires reviewed commerce evidence';
      END IF;
      SELECT public.grainline_notification_create_core(
        p_notification_id, p_user_id, p_type, p_source_type,
        p_source_id, p_related_user_id
      ) INTO notification_id;
      RETURN notification_id;
    END;
    $wrapper$;
    REVOKE ALL ON FUNCTION public.grainline_notification_create_order_event(
      text, text, public."NotificationType", text, text, text
    ) FROM PUBLIC, grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION public.grainline_notification_create_order_event(
      text, text, public."NotificationType", text, text, text
    ) TO grainline_app_runtime;
  `);
  return database;
}

async function asRuntime(database, sql, params = []) {
  await database.exec("SET ROLE grainline_app_runtime");
  try {
    return await database.query(sql, params);
  } finally {
    await database.exec("RESET ROLE");
  }
}

describe("Order buyer-receipt Notification authority in PostgreSQL", () => {
  it("derives a seller delivery notice from buyer evidence and replays once", async () => {
    const database = await createDatabase();
    try {
      const first = await asRuntime(database, `
        SELECT public.grainline_notification_create_order_event(
          '11111111-1111-4111-8111-111111111111',
          'seller-user-1', 'ORDER_DELIVERED', 'order_fulfillment',
          'audit-delivery', 'buyer-1'
        ) AS id
      `);
      const replay = await asRuntime(database, `
        SELECT public.grainline_notification_create_order_event(
          '22222222-2222-4222-8222-222222222222',
          'seller-user-1', 'ORDER_DELIVERED', 'order_fulfillment',
          'audit-delivery', 'buyer-1'
        ) AS id
      `);
      assert.equal(replay.rows[0].id, first.rows[0].id);
      const stored = await database.query(`
        SELECT "userId", "relatedUserId", type::text, title, body, link,
               "sourceType", "sourceId"
          FROM public."Notification"
      `);
      assert.deepEqual(stored.rows, [{
        userId: "seller-user-1",
        relatedUserId: "buyer-1",
        type: "ORDER_DELIVERED",
        title: "Buyer confirmed delivery",
        body: "The buyer confirmed delivery.",
        link: "/dashboard/sales/order-delivery",
        sourceType: "order_fulfillment",
        sourceId: "audit-delivery",
      }]);
    } finally {
      await database.close();
    }
  });

  it("accepts buyer-confirmed pickup and fails closed for forged recipients", async () => {
    const database = await createDatabase();
    try {
      const pickup = await asRuntime(database, `
        SELECT public.grainline_notification_create_order_event(
          '33333333-3333-4333-8333-333333333333',
          'seller-user-1', 'ORDER_DELIVERED', 'order_fulfillment',
          'audit-pickup', 'buyer-1'
        ) AS id
      `);
      assert.equal(typeof pickup.rows[0].id, "string");
      const forged = await asRuntime(database, `
          SELECT public.grainline_notification_create_order_event(
            '44444444-4444-4444-8444-444444444444',
            'seller-user-2', 'ORDER_DELIVERED', 'order_fulfillment',
            'audit-pickup', 'buyer-1'
          ) AS id
        `);
      assert.equal(forged.rows[0].id, null);
      const count = await database.query(
        `SELECT pg_catalog.count(*)::int AS count FROM public."Notification"`,
      );
      assert.equal(count.rows[0].count, 1);
      await assert.rejects(
        asRuntime(database, `
          SELECT public.grainline_notification_create_core(
            '55555555-5555-4555-8555-555555555555',
            'seller-user-1', 'ORDER_DELIVERED', 'order_fulfillment',
            'audit-pickup', 'buyer-1'
          )
        `),
        /permission denied/i,
      );
    } finally {
      await database.close();
    }
  });
});
