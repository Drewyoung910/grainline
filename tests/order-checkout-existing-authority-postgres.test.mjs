import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const candidate = fs.readFileSync(
  "docs/rls-drafts/order-checkout-existing-authority.sql",
  "utf8",
);
const rows = (result) => result.rows;
let db;
let dataDirectory;

async function classify(generation = 2n, sessionId = "cs-existing") {
  return rows(await db.query(`
    SELECT * FROM public.grainline_stripe_checkout_order_existing(
      'evt-existing', $1, $2
    )
  `, [generation, sessionId]));
}

describe("Order checkout existing PostgreSQL authority", () => {
  before(async () => {
    dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "grainline-order-existing-"));
    db = new PGlite({ dataDir: dataDirectory });
    await db.exec(`
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS;
      CREATE TABLE public."StripeWebhookEvent" (
        id varchar(255) PRIMARY KEY,
        type varchar(100) NOT NULL,
        "sourceObjectId" varchar(255),
        "claimGeneration" bigint NOT NULL,
        "processingStartedAt" timestamp(3) without time zone,
        "processedAt" timestamp(3) without time zone
      );
      CREATE TABLE public."SellerProfile" (
        id text PRIMARY KEY,
        "userId" text NOT NULL
      );
      CREATE TABLE public."Order" (
        id text PRIMARY KEY,
        "sellerProfileId" text,
        "stripeSessionId" varchar(255) UNIQUE,
        "sellerRefundId" varchar(255),
        "sellerRefundLockedAt" timestamp(3) without time zone,
        "refundClaimId" varchar(255),
        "refundClaimSource" varchar(32),
        "refundClaimSourceId" varchar(255),
        "paymentRefundBlocked" boolean NOT NULL DEFAULT false,
        "reviewNeeded" boolean NOT NULL DEFAULT false,
        "reviewNote" varchar(10000)
      );
      REVOKE ALL ON public."StripeWebhookEvent", public."SellerProfile", public."Order" FROM PUBLIC;
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES (
        'evt-existing', 'checkout.session.completed', 'cs-existing', 2,
        CURRENT_TIMESTAMP
      );
      INSERT INTO public."SellerProfile" (id, "userId")
        VALUES ('seller-1', 'seller-user');
    `);
    await db.exec(candidate);
  });

  after(async () => {
    await db?.close();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  });

  it("returns absent without disclosing another Order", async () => {
    await db.exec(`
      INSERT INTO public."Order" (id, "sellerProfileId", "stripeSessionId")
        VALUES ('other-order', 'seller-1', 'cs-other')
    `);
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      assert.deepEqual(await classify(), [{
        outcome: "absent",
        order_id: null,
        retry_reason: null,
        seller_user_ids: [],
      }]);
    } finally {
      await db.exec("RESET ROLE");
    }
  });

  it("keeps tables closed and rejects forged event identity", async () => {
    const privileges = rows(await db.query(`
      SELECT pg_catalog.has_table_privilege(
               'grainline_app_runtime', 'public."Order"', 'SELECT'
             ) AS can_select,
             pg_catalog.has_function_privilege(
               'grainline_app_runtime',
               'public.grainline_stripe_checkout_order_existing(text,bigint,text)',
               'EXECUTE'
             ) AS can_execute
    `))[0];
    assert.deepEqual(privileges, { can_select: false, can_execute: true });
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      await assert.rejects(classify(3n), /event authority is invalid/);
      await assert.rejects(classify(2n, "cs-other"), /event authority is invalid/);
      await assert.rejects(db.query(`SELECT * FROM public."Order"`), /permission denied/);
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
    }
  });

  it("classifies ordinary completion and a new blocked-checkout retry", async () => {
    await db.exec(`
      INSERT INTO public."Order" (id, "sellerProfileId", "stripeSessionId")
        VALUES ('order-1', 'seller-1', 'cs-existing')
    `);
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      assert.equal((await classify())[0].outcome, "complete");
    } finally {
      await db.exec("RESET ROLE");
    }
    await db.exec(`
      UPDATE public."Order"
         SET "reviewNeeded" = true,
             "reviewNote" = 'Seller is no longer eligible. Order was held for staff review.'
       WHERE id = 'order-1'
    `);
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      assert.deepEqual(await classify(), [{
        outcome: "retry",
        order_id: "order-1",
        retry_reason: "Seller is no longer eligible.",
        seller_user_ids: ["seller-user"],
      }]);
    } finally {
      await db.exec("RESET ROLE");
    }
  });

  it("uses database time for fresh, stale, and generation-bound refund claims", async () => {
    await db.exec(`
      UPDATE public."Order"
         SET "sellerRefundId" = 'pending',
             "sellerRefundLockedAt" = CURRENT_TIMESTAMP,
             "refundClaimId" = NULL,
             "refundClaimSource" = NULL,
             "refundClaimSourceId" = NULL
       WHERE id = 'order-1'
    `);
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      assert.equal((await classify())[0].outcome, "processing");
    } finally {
      await db.exec("RESET ROLE");
    }
    await db.exec(`
      UPDATE public."Order"
         SET "sellerRefundLockedAt" = CURRENT_TIMESTAMP - INTERVAL '16 minutes'
       WHERE id = 'order-1'
    `);
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      assert.equal((await classify())[0].outcome, "retry");
    } finally {
      await db.exec("RESET ROLE");
    }
    await db.exec(`
      UPDATE public."Order"
         SET "sellerRefundLockedAt" = CURRENT_TIMESTAMP,
             "refundClaimId" = 'claim-1',
             "refundClaimSource" = 'BLOCKED_CHECKOUT',
             "refundClaimSourceId" = 'evt-existing'
       WHERE id = 'order-1'
    `);
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      assert.equal((await classify())[0].outcome, "retry");
    } finally {
      await db.exec("RESET ROLE");
    }
    await db.exec(`
      UPDATE public."Order" SET "refundClaimSourceId" = 'evt-other'
       WHERE id = 'order-1'
    `);
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      assert.equal((await classify())[0].outcome, "processing");
    } finally {
      await db.exec("RESET ROLE");
    }
  });

  it("treats durable refund completion as complete and rejects processed leases", async () => {
    await db.exec(`
      UPDATE public."Order"
         SET "sellerRefundId" = 're_recorded',
             "refundClaimId" = NULL,
             "refundClaimSource" = NULL,
             "refundClaimSourceId" = NULL
       WHERE id = 'order-1'
    `);
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      assert.equal((await classify())[0].outcome, "complete");
    } finally {
      await db.exec("RESET ROLE");
    }
    await db.exec(`
      UPDATE public."StripeWebhookEvent" SET "processedAt" = CURRENT_TIMESTAMP
       WHERE id = 'evt-existing'
    `);
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      await assert.rejects(classify(), /event authority is invalid/);
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
    }
  });
});
