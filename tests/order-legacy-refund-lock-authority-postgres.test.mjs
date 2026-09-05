import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const draft = fs.readFileSync(
  "docs/rls-drafts/order-legacy-refund-lock-authority.sql",
  "utf8",
);

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      role text NOT NULL,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "stripeSessionId" text,
      "sellerRefundId" text,
      "sellerRefundLockedAt" timestamp(3) without time zone,
      "caseResolutionClaimId" text,
      "refundClaimId" text
    );
    CREATE TABLE public."Case" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL,
      status text NOT NULL,
      "resolvedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."StripeWebhookEvent" (
      id text PRIMARY KEY,
      type text NOT NULL,
      "sourceObjectId" text,
      "claimGeneration" bigint NOT NULL,
      "processingStartedAt" timestamp(3) without time zone,
      "processedAt" timestamp(3) without time zone
    );
    INSERT INTO public."User" (id, role) VALUES
      ('staff', 'EMPLOYEE'), ('admin', 'ADMIN'), ('customer', 'CUSTOMER');
    INSERT INTO public."Order" (
      id, "stripeSessionId", "sellerRefundId", "sellerRefundLockedAt",
      "caseResolutionClaimId", "refundClaimId"
    ) VALUES
      ('webhook-stale', 'cs_stale', 'pending', TIMESTAMP '2020-01-01', NULL, NULL),
      ('case-stale', 'cs_case', 'pending', TIMESTAMP '2020-01-01', NULL, NULL),
      ('recent', 'cs_recent', 'pending', TIMESTAMP '2099-01-01', NULL, NULL),
      ('modern', 'cs_modern', 'pending', TIMESTAMP '2020-01-01', NULL, 'claim-1'),
      ('case-claimed', 'cs_claimed', 'pending', TIMESTAMP '2020-01-01', 'case-claim', NULL),
      ('terminal', 'cs_terminal', 'pending', TIMESTAMP '2020-01-01', NULL, NULL),
      ('batch-a', 'cs_a', 'pending', TIMESTAMP '2020-01-01', NULL, NULL),
      ('batch-b', 'cs_b', 'pending', TIMESTAMP '2020-01-01', NULL, NULL);
    INSERT INTO public."Case" (id, "orderId", status, "resolvedAt") VALUES
      ('case-open', 'case-stale', 'OPEN', NULL),
      ('case-terminal', 'terminal', 'RESOLVED', CURRENT_TIMESTAMP);
    INSERT INTO public."StripeWebhookEvent" (
      id, type, "sourceObjectId", "claimGeneration", "processingStartedAt", "processedAt"
    ) VALUES
      ('evt-active', 'checkout.session.completed', 'cs_stale', 4, CURRENT_TIMESTAMP, NULL),
      ('evt-processed', 'checkout.session.completed', 'cs_stale', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('evt-wrong-type', 'charge.refunded', 'cs_stale', 4, CURRENT_TIMESTAMP, NULL);
  `);
  await db.exec(draft);
  return db;
}

async function scalar(db, query, params = []) {
  return (await db.query(query, params)).rows[0];
}

describe("Order legacy refund-lock authority in PostgreSQL", () => {
  it("releases one legacy lock only under the exact active signed source", async () => {
    const db = await database();
    try {
      await assert.rejects(
        db.query(
          "SELECT public.grainline_blocked_checkout_legacy_refund_lock_release($1,$2,$3,$4)",
          ["evt-active", 3, "cs_stale", "webhook-stale"],
        ),
        /source lease is invalid/i,
      );
      await assert.rejects(
        db.query(
          "SELECT public.grainline_blocked_checkout_legacy_refund_lock_release($1,$2,$3,$4)",
          ["evt-processed", 4, "cs_stale", "webhook-stale"],
        ),
        /source lease is invalid/i,
      );
      await assert.rejects(
        db.query(
          "SELECT public.grainline_blocked_checkout_legacy_refund_lock_release($1,$2,$3,$4)",
          ["evt-wrong-type", 4, "cs_stale", "webhook-stale"],
        ),
        /source lease is invalid/i,
      );
      const released = await scalar(
        db,
        "SELECT public.grainline_blocked_checkout_legacy_refund_lock_release($1,$2,$3,$4) AS released",
        ["evt-active", 4, "cs_stale", "webhook-stale"],
      );
      assert.equal(released.released, true);
      assert.deepEqual(
        (await db.query(
          `SELECT "sellerRefundId", "sellerRefundLockedAt"
             FROM public."Order" WHERE id = 'webhook-stale'`,
        )).rows,
        [{ sellerRefundId: null, sellerRefundLockedAt: null }],
      );
    } finally {
      await db.close();
    }
  });

  it("binds Case cleanup to active staff and a nonterminal exact Case", async () => {
    const db = await database();
    try {
      await assert.rejects(
        db.query(
          "SELECT public.grainline_case_legacy_refund_lock_release($1,$2)",
          ["customer", "case-open"],
        ),
        /staff authority is invalid/i,
      );
      assert.equal(
        (await scalar(
          db,
          "SELECT public.grainline_case_legacy_refund_lock_release($1,$2) AS released",
          ["staff", "case-terminal"],
        )).released,
        false,
      );
      assert.equal(
        (await scalar(
          db,
          "SELECT public.grainline_case_legacy_refund_lock_release($1,$2) AS released",
          ["admin", "case-open"],
        )).released,
        true,
      );
    } finally {
      await db.close();
    }
  });

  it("prunes a bounded batch and never clears recent or claimed state", async () => {
    const db = await database();
    try {
      await assert.rejects(
        db.query("SELECT public.grainline_order_legacy_refund_lock_prune(101)"),
        /batch is invalid/i,
      );
      assert.equal(
        (await scalar(
          db,
          "SELECT public.grainline_order_legacy_refund_lock_prune(1) AS count",
        )).count,
        1,
      );
      assert.equal(
        (await scalar(
          db,
          "SELECT public.grainline_order_legacy_refund_lock_prune(100) AS count",
        )).count,
        4,
      );
      const protectedRows = await db.query(`
        SELECT id, "sellerRefundId"
          FROM public."Order"
         WHERE id IN ('recent', 'modern', 'case-claimed')
         ORDER BY id
      `);
      assert.deepEqual(protectedRows.rows, [
        { id: "case-claimed", sellerRefundId: "pending" },
        { id: "modern", sellerRefundId: "pending" },
        { id: "recent", sellerRefundId: "pending" },
      ]);
    } finally {
      await db.close();
    }
  });

  it("permits only fixed function execution through the runtime role", async () => {
    const db = await database();
    try {
      await db.exec("SET ROLE grainline_app_runtime");
      assert.equal(
        (await scalar(
          db,
          "SELECT public.grainline_order_legacy_refund_lock_prune(1) AS count",
        )).count,
        1,
      );
      await assert.rejects(
        db.query('SELECT * FROM public."Order"'),
        /permission denied/i,
      );
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
      await db.close();
    }
  });
});
