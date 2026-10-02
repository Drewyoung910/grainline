import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260901130000_prepare_order_fulfillment_authority/migration.sql",
  "utf8",
);
const deauthorizationCorrection = readFileSync(
  "prisma/migrations/20260926012000_correct_order_seller_deauthorization_fulfillment/migration.sql",
  "utf8",
);
const partialRefundCorrectionPath = [
  process.env.ORDER_PARTIAL_REFUND_FULFILLMENT_MIGRATION_PATH,
  "prisma/migrations/20261002010000_allow_partial_refund_fulfillment/migration.sql",
].find((candidate) => candidate && existsSync(candidate));
assert.ok(
  partialRefundCorrectionPath,
  "partial-refund fulfillment migration is available",
);
const partialRefundCorrection = readFileSync(
  partialRefundCorrectionPath,
  "utf8",
);

function functionSql(source, name) {
  const delimiter = `$${name}$`;
  const start = source.search(new RegExp(
    `CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\(`,
  ));
  const end = source.indexOf(`${delimiter};`, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start, end + delimiter.length + 1);
}

const partialRefundHelper = partialRefundCorrection.slice(
  partialRefundCorrection.indexOf(
    "CREATE FUNCTION public.grainline_order_refund_blocks_fulfillment(",
  ),
  partialRefundCorrection.indexOf(
    "CREATE OR REPLACE FUNCTION public.grainline_order_seller_fulfillment_transition(",
  ),
);
const partialRefundFulfillmentCorrection = `BEGIN;
${partialRefundHelper}
${functionSql(partialRefundCorrection, "grainline_order_seller_fulfillment_transition")}
${functionSql(partialRefundCorrection, "grainline_order_buyer_receipt_confirm")}
COMMIT;`;

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TYPE public."FulfillmentMethod" AS ENUM ('PICKUP', 'SHIPPING');
    CREATE TYPE public."FulfillmentStatus" AS ENUM (
      'PENDING', 'READY_FOR_PICKUP', 'PICKED_UP', 'SHIPPED', 'DELIVERED'
    );
    CREATE TYPE public."LabelStatus" AS ENUM ('PURCHASED', 'EXPIRED', 'VOIDED');
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      name text,
      email text,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE,
      "displayName" text
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "buyerId" text,
      "sellerProfileId" text,
      "paidAt" timestamp(3) without time zone,
      "fulfillmentMethod" public."FulfillmentMethod",
      "fulfillmentStatus" public."FulfillmentStatus" NOT NULL DEFAULT 'PENDING',
      "trackingCarrier" text,
      "trackingNumber" text,
      "pickupReadyAt" timestamp(3) without time zone,
      "pickedUpAt" timestamp(3) without time zone,
      "shippedAt" timestamp(3) without time zone,
      "deliveredAt" timestamp(3) without time zone,
      "sellerNotes" text,
      "estimatedDeliveryDate" timestamp(3) without time zone,
      "sellerRefundId" text,
      "sellerRefundAmountCents" integer,
      "sellerRefundLockedAt" timestamp(3) without time zone,
      "paymentRefundBlocked" boolean NOT NULL DEFAULT false,
      "paymentOpenDisputeBlocked" boolean NOT NULL DEFAULT false,
      "chargedTotalCents" integer,
      "itemsSubtotalCents" integer NOT NULL DEFAULT 0,
      "shippingAmountCents" integer NOT NULL DEFAULT 0,
      "giftWrappingPriceCents" integer NOT NULL DEFAULT 0,
      "taxAmountCents" integer NOT NULL DEFAULT 0,
      "reviewNeeded" boolean NOT NULL DEFAULT false,
      "reviewNote" text,
      "sellerDeauthorizedAt" timestamp(3) without time zone,
      "labelStatus" public."LabelStatus",
      "buyerDataPurgedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."Case" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE public."SystemAuditLog" (
      id text PRIMARY KEY,
      "actorType" text NOT NULL,
      "actorId" text,
      action text NOT NULL,
      "targetType" text NOT NULL,
      "targetId" text NOT NULL,
      reason text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, grainline_app_runtime;
    INSERT INTO public."User" (id, name, email) VALUES
      ('buyer-1', 'Buyer One', 'buyer@example.test'),
      ('buyer-2', 'Buyer Two', 'other@example.test'),
      ('seller-user-1', 'Seller One', 'seller@example.test'),
      ('seller-user-2', 'Seller Two', 'seller2@example.test');
    INSERT INTO public."SellerProfile" (id, "userId", "displayName") VALUES
      ('seller-1', 'seller-user-1', 'Shop One'),
      ('seller-2', 'seller-user-2', 'Shop Two');
    INSERT INTO public."Order" (
      id, "buyerId", "sellerProfileId", "paidAt", "fulfillmentMethod",
      "fulfillmentStatus", "estimatedDeliveryDate"
    ) VALUES
      ('shipping-order', 'buyer-1', 'seller-1', CURRENT_TIMESTAMP, 'SHIPPING', 'PENDING', CURRENT_TIMESTAMP),
      ('pickup-order', 'buyer-1', 'seller-1', CURRENT_TIMESTAMP, 'PICKUP', 'PENDING', NULL),
      ('notes-order', 'buyer-1', 'seller-1', CURRENT_TIMESTAMP, 'SHIPPING', 'PENDING', NULL),
      ('inactive-buyer-order', 'buyer-2', 'seller-1', CURRENT_TIMESTAMP, 'SHIPPING', 'PENDING', NULL),
      ('inactive-seller-order', 'buyer-1', 'seller-2', CURRENT_TIMESTAMP, 'SHIPPING', 'SHIPPED', NULL),
      ('blocked-order', 'buyer-1', 'seller-1', CURRENT_TIMESTAMP, 'SHIPPING', 'PENDING', NULL);
    INSERT INTO public."Case" (id, "orderId", status)
      VALUES ('case-1', 'blocked-order', 'OPEN');
  `);
  await database.exec(migration);
  await database.exec(deauthorizationCorrection);
  return database;
}

async function asRuntime(database, sql) {
  await database.exec("SET ROLE grainline_app_runtime");
  try {
    return await database.query(sql);
  } finally {
    await database.exec("RESET ROLE");
  }
}

describe("Order fulfillment fixed authority in PostgreSQL", () => {
  it("keeps a seller deauthorization hold after staff edits the mutable review fields", async () => {
    const database = await createDatabase();
    try {
      await database.exec(`
        UPDATE public."Order"
           SET "sellerDeauthorizedAt" = CURRENT_TIMESTAMP,
               "reviewNeeded" = false,
               "reviewNote" = 'A later staff note replaced the webhook text'
         WHERE id = 'notes-order'
      `);
      const result = await asRuntime(database, `
        SELECT public.grainline_order_seller_fulfillment_transition(
          'seller-user-1', 'notes-order', 'shipped', 'UPS', '1Z999AA10123456784'
        ) AS result
      `);
      assert.deepEqual(result.rows[0].result, {
        outcome: "conflict",
        reason: "seller_deauthorized",
      });
    } finally {
      await database.close();
    }
  });

  it("serializes seller shipping and buyer delivery with derived audits", async () => {
    const database = await createDatabase();
    try {
      const shipped = await asRuntime(database, `
        SELECT public.grainline_order_seller_fulfillment_transition(
          'seller-user-1', 'shipping-order', 'shipped', 'UPS', '1Z999AA10123456784'
        ) AS result
      `);
      assert.equal(shipped.rows[0].result.outcome, "changed");
      assert.equal(shipped.rows[0].result.buyerEmail, "buyer@example.test");
      assert.equal(shipped.rows[0].result.newStatus, "SHIPPED");

      const received = await asRuntime(database, `
        SELECT public.grainline_order_buyer_receipt_confirm(
          'buyer-1', 'shipping-order'
        ) AS result
      `);
      assert.equal(received.rows[0].result.outcome, "changed");
      assert.equal(received.rows[0].result.sellerUserId, "seller-user-1");
      assert.equal(received.rows[0].result.newStatus, "DELIVERED");

      const stored = await database.query(`
        SELECT "fulfillmentMethod"::text AS method,
               "fulfillmentStatus"::text AS status,
               "trackingCarrier" AS carrier,
               "trackingNumber" AS tracking,
               "shippedAt" IS NOT NULL AS shipped,
               "deliveredAt" IS NOT NULL AS delivered
          FROM public."Order"
         WHERE id = 'shipping-order'
      `);
      assert.deepEqual(stored.rows, [{
        method: "SHIPPING",
        status: "DELIVERED",
        carrier: "UPS",
        tracking: "1Z999AA10123456784",
        shipped: true,
        delivered: true,
      }]);
      const audits = await database.query(`
        SELECT metadata ->> 'action' AS action
          FROM public."SystemAuditLog"
         WHERE "targetId" = 'shipping-order'
         ORDER BY "createdAt", id
      `);
      assert.deepEqual(audits.rows.map((row) => row.action).sort(), ["delivered", "shipped"]);
    } finally {
      await database.close();
    }
  });

  it("continues fulfillment after an evidenced partial refund and blocks unsafe refund states", async () => {
    const database = await createDatabase();
    try {
      await database.exec(partialRefundFulfillmentCorrection);
      await database.exec(`
        UPDATE public."Order"
           SET "sellerRefundId" = 're_partial',
               "sellerRefundAmountCents" = 250,
               "paymentRefundBlocked" = true,
               "chargedTotalCents" = 1000
         WHERE id = 'shipping-order'
      `);
      const shipped = await asRuntime(database, `
        SELECT public.grainline_order_seller_fulfillment_transition(
          'seller-user-1', 'shipping-order', 'shipped', 'UPS', '1Z999AA10123456784'
        ) AS result
      `);
      assert.equal(shipped.rows[0].result.outcome, "changed");
      const received = await asRuntime(database, `
        SELECT public.grainline_order_buyer_receipt_confirm(
          'buyer-1', 'shipping-order'
        ) AS result
      `);
      assert.equal(received.rows[0].result.newStatus, "DELIVERED");

      for (const unsafe of [
        { id: "re_full", amount: 1000, locked: null, blocked: true },
        { id: "pending", amount: null, locked: "CURRENT_TIMESTAMP", blocked: false },
        { id: "ambiguous_refund_pending_reconciliation", amount: null, locked: null, blocked: true },
        { id: null, amount: 250, locked: null, blocked: true },
        { id: "re_missing_amount", amount: null, locked: null, blocked: true },
      ]) {
        await database.exec(`
          UPDATE public."Order"
             SET "sellerRefundId" = ${unsafe.id === null ? "NULL" : `'${unsafe.id}'`},
                 "sellerRefundAmountCents" = ${unsafe.amount ?? "NULL"},
                 "sellerRefundLockedAt" = ${unsafe.locked ?? "NULL"},
                 "paymentRefundBlocked" = ${unsafe.blocked},
                 "chargedTotalCents" = 1000,
                 "fulfillmentStatus" = 'PENDING'
           WHERE id = 'pickup-order'
        `);
        const blocked = await asRuntime(database, `
          SELECT public.grainline_order_seller_fulfillment_transition(
            'seller-user-1', 'pickup-order', 'ready_for_pickup', NULL, NULL
          ) AS result
        `);
        assert.deepEqual(blocked.rows[0].result, {
          outcome: "conflict",
          reason: "refunded",
        });
      }

      const privileges = await database.query(`SELECT
        has_function_privilege('public',
          'public.grainline_order_refund_blocks_fulfillment(text,timestamp without time zone,boolean,integer,integer)',
          'EXECUTE') AS public_execute,
        has_function_privilege('grainline_app_runtime',
          'public.grainline_order_refund_blocks_fulfillment(text,timestamp without time zone,boolean,integer,integer)',
          'EXECUTE') AS runtime_execute`);
      assert.deepEqual(privileges.rows, [{
        public_execute: false,
        runtime_execute: false,
      }]);
    } finally {
      await database.close();
    }
  });

  it("keeps pickup completion buyer-controlled and seller notes separate", async () => {
    const database = await createDatabase();
    try {
      const ready = await asRuntime(database, `
        SELECT public.grainline_order_seller_fulfillment_transition(
          'seller-user-1', 'pickup-order', 'ready_for_pickup', NULL, NULL
        ) AS result
      `);
      assert.equal(ready.rows[0].result.newStatus, "READY_FOR_PICKUP");

      const pickedUp = await asRuntime(database, `
        SELECT public.grainline_order_buyer_receipt_confirm(
          'buyer-1', 'pickup-order'
        ) AS result
      `);
      assert.equal(pickedUp.rows[0].result.action, "picked_up");
      assert.equal(pickedUp.rows[0].result.newStatus, "PICKED_UP");

      await database.exec(`
        UPDATE public."Order"
           SET "sellerRefundId" = 'retained-refund'
         WHERE id = 'notes-order'
      `);
      const notes = await asRuntime(database, `
        SELECT public.grainline_order_seller_notes_update(
          'seller-user-1', 'notes-order', 'Private workshop note'
        ) AS result
      `);
      assert.equal(notes.rows[0].result.outcome, "changed");
      assert.equal(notes.rows[0].result.hasNotes, true);
      const stored = await database.query(`
        SELECT "sellerNotes" AS notes
          FROM public."Order"
         WHERE id = 'notes-order'
      `);
      assert.equal(stored.rows[0].notes, "Private workshop note");
    } finally {
      await database.close();
    }
  });

  it("does not make paid-order progress depend on an active notification recipient", async () => {
    const database = await createDatabase();
    try {
      await database.exec(`
        UPDATE public."User" SET banned = true WHERE id = 'buyer-2';
        UPDATE public."User" SET "deletedAt" = CURRENT_TIMESTAMP WHERE id = 'seller-user-2';
      `);
      const shipped = await asRuntime(database, `
        SELECT public.grainline_order_seller_fulfillment_transition(
          'seller-user-1', 'inactive-buyer-order', 'shipped', 'UPS', '1Z999AA10123456784'
        ) AS result
      `);
      assert.equal(shipped.rows[0].result.outcome, "changed");
      assert.equal(shipped.rows[0].result.buyerUserId, null);
      assert.equal(shipped.rows[0].result.buyerEmail, null);

      const received = await asRuntime(database, `
        SELECT public.grainline_order_buyer_receipt_confirm(
          'buyer-1', 'inactive-seller-order'
        ) AS result
      `);
      assert.equal(received.rows[0].result.outcome, "changed");
      assert.equal(received.rows[0].result.sellerUserId, null);
    } finally {
      await database.close();
    }
  });

  it("rejects forged actors, active Cases and direct runtime table writes", async () => {
    const database = await createDatabase();
    try {
      const forgedSeller = await asRuntime(database, `
        SELECT public.grainline_order_seller_fulfillment_transition(
          'seller-user-2', 'shipping-order', 'shipped', 'UPS', '1Z999AA10123456784'
        ) AS result
      `);
      assert.equal(forgedSeller.rows[0].result, null);
      const forgedBuyer = await asRuntime(database, `
        SELECT public.grainline_order_buyer_receipt_confirm(
          'buyer-2', 'shipping-order'
        ) AS result
      `);
      assert.equal(forgedBuyer.rows[0].result, null);
      const blocked = await asRuntime(database, `
        SELECT public.grainline_order_seller_fulfillment_transition(
          'seller-user-1', 'blocked-order', 'shipped', 'UPS', '1Z999AA10123456784'
        ) AS result
      `);
      assert.deepEqual(blocked.rows[0].result, {
        outcome: "conflict",
        reason: "active_case",
      });
      await assert.rejects(
        asRuntime(database, `UPDATE public."Order" SET "sellerNotes" = 'forged'`),
        /permission denied/i,
      );
    } finally {
      await database.close();
    }
  });
});
