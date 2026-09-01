import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260901140000_prepare_order_label_authority/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TYPE public."FulfillmentMethod" AS ENUM ('PICKUP', 'SHIPPING');
    CREATE TYPE public."FulfillmentStatus" AS ENUM (
      'PENDING', 'READY_FOR_PICKUP', 'PICKED_UP', 'SHIPPED', 'DELIVERED'
    );
    CREATE TYPE public."LabelStatus" AS ENUM ('PURCHASED', 'EXPIRED', 'VOIDED');
    CREATE TYPE public."NotificationType" AS ENUM ('ORDER_SHIPPED');
    CREATE TABLE public."User" (
      id text PRIMARY KEY, name text, email text,
      "notificationPreferences" jsonb NOT NULL DEFAULT '{}'::jsonb,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY, "userId" text NOT NULL UNIQUE, "displayName" text,
      "shipFromName" text, "shipFromLine1" text, "shipFromLine2" text,
      "shipFromCity" text, "shipFromState" text, "shipFromPostal" text,
      "shipFromCountry" text, "defaultPkgWeightGrams" integer,
      "defaultPkgLengthCm" double precision, "defaultPkgWidthCm" double precision,
      "defaultPkgHeightCm" double precision
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY, "packagedWeightGrams" integer,
      "packagedLengthCm" double precision, "packagedWidthCm" double precision,
      "packagedHeightCm" double precision
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY, "buyerId" text, "sellerProfileId" text,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "paidAt" timestamp(3) without time zone, currency text NOT NULL DEFAULT 'usd',
      "buyerName" text, "shipToLine1" text, "shipToLine2" text,
      "shipToCity" text, "shipToState" text, "shipToPostalCode" text,
      "shipToCountry" text, "fulfillmentMethod" public."FulfillmentMethod",
      "fulfillmentStatus" public."FulfillmentStatus" NOT NULL DEFAULT 'PENDING',
      "trackingCarrier" text, "trackingNumber" text, "shippedAt" timestamp(3),
      "estimatedDeliveryDate" timestamp(3), "quotedShippingAmountCents" integer,
      "quotedToName" text, "sellerRefundId" text, "sellerRefundLockedAt" timestamp(3),
      "paymentRefundBlocked" boolean NOT NULL DEFAULT false,
      "paymentOpenDisputeBlocked" boolean NOT NULL DEFAULT false,
      "reviewNeeded" boolean NOT NULL DEFAULT false, "reviewNote" text,
      "stripeTransferId" text, "shippoShipmentId" text, "shippoRateObjectId" text,
      "shippoTransactionId" text, "labelUrl" text, "labelCarrier" text,
      "labelTrackingNumber" text, "labelPurchasedAt" timestamp(3),
      "labelCostCents" integer, "labelStatus" public."LabelStatus",
      "labelClawbackStatus" text, "labelClawbackReversalId" text,
      "labelClawbackRetryCount" integer NOT NULL DEFAULT 0,
      "labelClawbackLastAttemptAt" timestamp(3),
      "labelClawbackNextAttemptAt" timestamp(3),
      "labelClawbackResolvedAt" timestamp(3)
    );
    CREATE TABLE public."OrderItem" (
      id text PRIMARY KEY, "orderId" text NOT NULL, "listingId" text NOT NULL,
      quantity integer NOT NULL DEFAULT 1, "listingSnapshot" jsonb
    );
    CREATE TABLE public."OrderShippingRateQuote" (
      id text PRIMARY KEY, "orderId" text NOT NULL, "shipmentId" text NOT NULL,
      rates jsonb NOT NULL, "expiresAt" timestamp(3) NOT NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."Case" (id text PRIMARY KEY, "orderId" text NOT NULL, status text NOT NULL);
    CREATE TABLE public."SystemAuditLog" (
      id text PRIMARY KEY, "actorType" text NOT NULL, "actorId" text,
      action text NOT NULL, "targetType" text NOT NULL, "targetId" text NOT NULL,
      reason text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."Notification" (
      id text PRIMARY KEY, "userId" text NOT NULL, "relatedUserId" text,
      type public."NotificationType" NOT NULL, title varchar(200) NOT NULL,
      body varchar(1000) NOT NULL, link varchar(2048), "sourceType" varchar(80),
      "sourceId" varchar(191), "dedupKey" varchar(64) NOT NULL,
      read boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("userId", type, "dedupKey")
    );
    CREATE FUNCTION public.grainline_order_seller_detail_v3(text, text)
    RETURNS TABLE(
      order_id text, created_at_epoch_millis bigint, paid_at_epoch_millis bigint,
      currency text, items_subtotal_cents integer, shipping_title text,
      shipping_amount_cents integer, tax_amount_cents integer,
      fulfillment_method text, fulfillment_status text, tracking_carrier text,
      tracking_number text, pickup_ready_at_epoch_millis bigint,
      picked_up_at_epoch_millis bigint, shipped_at_epoch_millis bigint,
      delivered_at_epoch_millis bigint, estimated_delivery_at_epoch_millis bigint,
      processing_deadline_epoch_millis bigint, shipping_carrier text,
      shipping_service text, review_needed boolean, deauthorized_review_hold boolean,
      gift_note text, gift_wrapping boolean, gift_wrapping_price_cents integer,
      buyer_data_purged_at_epoch_millis bigint, ship_to_line_1 text,
      ship_to_line_2 text, ship_to_city text, ship_to_state text,
      ship_to_postal_code text, ship_to_country text, buyer_id text,
      buyer_name text, buyer_email text, buyer_deleted_at_epoch_millis bigint,
      seller_notes text, seller_refund_state text, seller_refund_amount_cents integer,
      label_status text, label_url text, label_carrier text,
      label_tracking_number text, label_purchased_at_epoch_millis bigint, items jsonb
    )
    LANGUAGE plpgsql
    AS $$ BEGIN RETURN; END $$;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, grainline_app_runtime;
    INSERT INTO public."User" (id, name, email) VALUES
      ('buyer-1', 'Buyer', 'buyer@example.test'),
      ('seller-user-1', 'Seller', 'seller@example.test'),
      ('seller-user-2', 'Other', 'other@example.test');
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "shipFromName", "shipFromLine1",
      "shipFromCity", "shipFromState", "shipFromPostal", "shipFromCountry",
      "defaultPkgWeightGrams", "defaultPkgLengthCm", "defaultPkgWidthCm", "defaultPkgHeightCm"
    ) VALUES
      ('seller-1', 'seller-user-1', 'Shop', 'Shop', '1 Maker St', 'Austin', 'TX', '78701', 'US', 1000, 20, 15, 10),
      ('seller-2', 'seller-user-2', 'Other', 'Other', '2 Maker St', 'Austin', 'TX', '78701', 'US', 1000, 20, 15, 10);
    INSERT INTO public."Listing" (id, "packagedWeightGrams", "packagedLengthCm", "packagedWidthCm", "packagedHeightCm")
      VALUES ('listing-1', 900, 19, 14, 9);
    INSERT INTO public."Order" (
      id, "buyerId", "sellerProfileId", "paidAt", currency, "buyerName",
      "shipToLine1", "shipToCity", "shipToState", "shipToPostalCode", "shipToCountry",
      "fulfillmentMethod", "quotedShippingAmountCents", "shippoRateObjectId", "stripeTransferId"
    ) VALUES
      ('order-1', 'buyer-1', 'seller-1', CURRENT_TIMESTAMP, 'usd', 'Buyer',
       '3 Buyer St', 'Dallas', 'TX', '75001', 'US', 'SHIPPING', 900, 'rate-old', 'tr_1'),
      ('order-2', 'buyer-1', 'seller-2', CURRENT_TIMESTAMP, 'usd', 'Buyer',
       '3 Buyer St', 'Dallas', 'TX', '75001', 'US', 'SHIPPING', 900, 'rate-other', 'tr_2');
    INSERT INTO public."OrderItem" (id, "orderId", "listingId", quantity, "listingSnapshot") VALUES
      ('item-1', 'order-1', 'listing-1', 2,
       '{"shippingPackageComplete":true,"shippingWeightGrams":900,"shippingLengthCm":19,"shippingWidthCm":14,"shippingHeightCm":9}'),
      ('item-2', 'order-2', 'listing-1', 1, NULL);
  `);
  await database.exec(migration);
  return database;
}

async function asRuntime(database, sql) {
  await database.exec("SET ROLE grainline_app_runtime");
  try { return await database.query(sql); }
  finally { await database.exec("RESET ROLE"); }
}

describe("Order label fixed authority in PostgreSQL", () => {
  it("derives package facts and binds quote, claim, provider result, and download", async () => {
    const database = await createDatabase();
    try {
      const preflight = await asRuntime(database, `
        SELECT public.grainline_order_seller_label_preflight('seller-user-1', 'order-1') AS result
      `);
      assert.equal(preflight.rows[0].result.outcome, "ready");
      assert.equal(Number(preflight.rows[0].result.packageWeightGrams), 1800);
      assert.equal(preflight.rows[0].result.packageSource, "CHECKOUT_SNAPSHOT");

      const quote = await asRuntime(database, `
        SELECT public.grainline_order_seller_label_quote_replace(
          'seller-user-1', 'order-1', 'shipment-1',
          '[{"objectId":"rate-1","amountCents":725,"currency":"usd","label":"UPS Ground","carrier":"UPS","service":"Ground"}]'::jsonb
        ) AS result
      `);
      assert.equal(quote.rows[0].result.outcome, "changed");

      const claim = await asRuntime(database, `
        SELECT public.grainline_order_seller_label_claim(
          'seller-user-1', 'order-1', 'rate-1'
        ) AS result
      `);
      assert.equal(claim.rows[0].result.outcome, "claimed");
      assert.equal(claim.rows[0].result.amountCents, 725);

      const record = await asRuntime(database, `
        SELECT public.grainline_order_seller_label_provider_record(
          'seller-user-1', 'order-1', '${claim.rows[0].result.claimId}',
          ${claim.rows[0].result.claimGeneration}, 'SUCCESS', 'txn-1',
          'https://labels.example.test/label.pdf', 'rate-1', 725, 'usd',
          'UPS', '1Z999AA10123456784', NULL
        ) AS result
      `);
      assert.equal(record.rows[0].result.outcome, "recorded");
      assert.equal(record.rows[0].result.clawbackStatus, "RETRYING");
      const audit = await database.query(`
        SELECT action, metadata
          FROM public."SystemAuditLog"
         WHERE id = '${record.rows[0].result.auditLogId}'
      `);
      assert.equal(audit.rows[0].action, "ORDER_FULFILLMENT_TRANSITION");
      assert.equal(audit.rows[0].metadata.action, "shipped");
      assert.equal(audit.rows[0].metadata.newStatus, "SHIPPED");
      assert.equal(audit.rows[0].metadata.trackingCarrier, "UPS");

      const notification = await database.query(`
        SELECT "userId", "relatedUserId", type::text, title, body, link,
               "sourceType", "sourceId", "dedupKey"
          FROM public."Notification"
      `);
      assert.equal(notification.rows.length, 1);
      assert.deepEqual(
        {
          userId: notification.rows[0].userId,
          relatedUserId: notification.rows[0].relatedUserId,
          type: notification.rows[0].type,
          title: notification.rows[0].title,
          body: notification.rows[0].body,
          link: notification.rows[0].link,
          sourceType: notification.rows[0].sourceType,
          sourceId: notification.rows[0].sourceId,
        },
        {
          userId: "buyer-1",
          relatedUserId: "seller-user-1",
          type: "ORDER_SHIPPED",
          title: "Your piece is on its way!",
          body: "Shipped via UPS",
          link: "/dashboard/orders/order-1",
          sourceType: "order_fulfillment",
          sourceId: record.rows[0].result.auditLogId,
        },
      );

      const replay = await asRuntime(database, `
        SELECT public.grainline_order_seller_label_provider_record(
          'seller-user-1', 'order-1', '${claim.rows[0].result.claimId}',
          ${claim.rows[0].result.claimGeneration}, 'SUCCESS', 'txn-1',
          'https://labels.example.test/label.pdf', 'rate-1', 725, 'usd',
          'UPS', '1Z999AA10123456784', NULL
        ) AS result
      `);
      assert.equal(replay.rows[0].result.auditLogId, record.rows[0].result.auditLogId);
      const replayCounts = await database.query(`
        SELECT
          (SELECT pg_catalog.count(*) FROM public."SystemAuditLog")::integer AS audit_count,
          (SELECT pg_catalog.count(*) FROM public."Notification")::integer AS notification_count
      `);
      assert.equal(replayCounts.rows[0].audit_count, 1);
      assert.equal(replayCounts.rows[0].notification_count, 1);

      const finalized = await asRuntime(database, `
        SELECT public.grainline_order_label_clawback_finalize(
          'order-1', '${claim.rows[0].result.claimId}',
          ${claim.rows[0].result.claimGeneration},
          ${record.rows[0].result.clawbackGeneration},
          'SUCCESS', 'trr-1', NULL
        ) AS result
      `);
      assert.equal(finalized.rows[0].result.clawbackStatus, "REVERSED");

      const download = await asRuntime(database, `
        SELECT public.grainline_order_seller_label_download('seller-user-1', 'order-1') AS result
      `);
      assert.equal(download.rows[0].result.transactionId, "txn-1");
      assert.equal(download.rows[0].result.labelUrl, undefined);
      await assert.rejects(
        asRuntime(database, `SELECT "labelUrl" FROM public."Order" WHERE id = 'order-1'`),
        /permission denied/i,
      );
    } finally { await database.close(); }
  });

  it("denies cross-seller access and rejects drifted provider money", async () => {
    const database = await createDatabase();
    try {
      const denied = await asRuntime(database, `
        SELECT public.grainline_order_seller_label_preflight('seller-user-1', 'order-2') AS result
      `);
      assert.equal(denied.rows[0].result, null);
      const claim = await asRuntime(database, `
        SELECT public.grainline_order_seller_label_claim('seller-user-1', 'order-1', NULL) AS result
      `);
      await assert.rejects(
        asRuntime(database, `
          SELECT public.grainline_order_seller_label_provider_record(
            'seller-user-1', 'order-1', '${claim.rows[0].result.claimId}',
            ${claim.rows[0].result.claimGeneration}, 'SUCCESS', 'txn-drift',
            'https://labels.example.test/label.pdf', 'rate-old', 901, 'usd',
            'UPS', NULL, NULL
          )
        `),
        /does not match the fixed claim/i,
      );
    } finally { await database.close(); }
  });

  it("fences ambiguous creates and lets only one worker claim a retry generation", async () => {
    const database = await createDatabase();
    try {
      const claim = await asRuntime(database, `
        SELECT public.grainline_order_seller_label_claim('seller-user-1', 'order-1', NULL) AS result
      `);
      const ambiguous = await asRuntime(database, `
        SELECT public.grainline_order_seller_label_provider_record(
          'seller-user-1', 'order-1', '${claim.rows[0].result.claimId}',
          ${claim.rows[0].result.claimGeneration}, 'AMBIGUOUS',
          NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'timeout'
        ) AS result
      `);
      assert.equal(ambiguous.rows[0].result.outcome, "ambiguous");
      const second = await asRuntime(database, `
        SELECT public.grainline_order_seller_label_claim('seller-user-1', 'order-1', NULL) AS result
      `);
      assert.equal(second.rows[0].result.reason, "label_claim_active");

      await asRuntime(database, `
        SELECT public.grainline_order_seller_label_provider_record(
          'seller-user-1', 'order-1', '${claim.rows[0].result.claimId}',
          ${claim.rows[0].result.claimGeneration}, 'SUCCESS', 'txn-1',
          'https://labels.example.test/label.pdf', 'rate-old', 900, 'usd',
          'UPS', NULL, NULL
        )
      `);
      await database.exec(`
        UPDATE public."Order" SET "labelClawbackStatus" = 'RETRY_PENDING',
          "labelClawbackNextAttemptAt" = CURRENT_TIMESTAMP - interval '1 minute'
        WHERE id = 'order-1'
      `);
      const first = await asRuntime(database,
        `SELECT public.grainline_order_label_clawback_claim_batch(10) AS result`);
      const secondBatch = await asRuntime(database,
        `SELECT public.grainline_order_label_clawback_claim_batch(10) AS result`);
      assert.equal(first.rows[0].result.length, 1);
      assert.equal(secondBatch.rows[0].result.length, 0);
    } finally { await database.close(); }
  });
});
