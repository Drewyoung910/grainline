import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const draft = fs.readFileSync(
  "docs/rls-drafts/order-refund-reconciliation-commit-proof.sql",
  "utf8",
);

const CLAIM_A = "order_refund_claim_11111111-1111-4111-8111-111111111111";
const CLAIM_B = "order_refund_claim_22222222-2222-4222-8222-222222222222";

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS;
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "refundClaimId" text,
      "refundClaimGeneration" bigint NOT NULL DEFAULT 0,
      "refundClaimSource" text,
      "refundClaimSourceId" text,
      "refundClaimSourceGeneration" bigint,
      "refundClaimIdempotencyScope" text,
      "refundClaimProviderAuthorizedAt" timestamp(3) without time zone,
      "sellerRefundId" text,
      "sellerRefundAmountCents" integer
    );
    CREATE TABLE public."OrderRefundReconciliation" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL,
      "claimId" text NOT NULL,
      "claimGeneration" bigint NOT NULL,
      action text NOT NULL
    );
    REVOKE ALL ON TABLE public."Order", public."OrderRefundReconciliation"
      FROM PUBLIC, grainline_app_runtime;
  `);
  await db.exec(draft);
  return db;
}

async function committed(db, orderId, claimId, generation) {
  return (await db.query(
    "SELECT public.grainline_order_refund_reconciliation_committed($1, $2, $3) AS committed",
    [orderId, claimId, generation],
  )).rows[0]?.committed;
}

describe("Order refund-reconciliation commit proof in PostgreSQL", () => {
  it("accepts only the exact finalized claim decision", async () => {
    const db = await database();
    try {
      await db.exec(`
        INSERT INTO public."Order" (
          id, "refundClaimGeneration", "sellerRefundId", "sellerRefundAmountCents"
        ) VALUES ('order-1', 3, 're_exact123', 500);
        INSERT INTO public."OrderRefundReconciliation" (
          id, "orderId", "claimId", "claimGeneration", action
        ) VALUES ('reconciliation-1', 'order-1', '${CLAIM_A}', 3, 'CONFIRMED_PROVIDER_EFFECT');
      `);
      assert.equal(await committed(db, "order-1", CLAIM_A, 3), true);
      assert.equal(await committed(db, "order-1", CLAIM_B, 3), false);
      assert.equal(await committed(db, "order-1", CLAIM_A, 2), false);
      assert.equal(await committed(db, "other-order", CLAIM_A, 3), false);
      await db.exec(`UPDATE public."Order" SET "refundClaimId" = '${CLAIM_A}' WHERE id = 'order-1'`);
      assert.equal(await committed(db, "order-1", CLAIM_A, 3), false);
    } finally {
      await db.close();
    }
  });

  it("rejects no-effect decisions, malformed input and direct runtime reads", async () => {
    const db = await database();
    try {
      await db.exec(`
        INSERT INTO public."Order" (
          id, "refundClaimGeneration", "sellerRefundId", "sellerRefundAmountCents"
        ) VALUES ('order-2', 4, 're_exact456', 500);
        INSERT INTO public."OrderRefundReconciliation" (
          id, "orderId", "claimId", "claimGeneration", action
        ) VALUES ('reconciliation-2', 'order-2', '${CLAIM_B}', 4, 'CONFIRMED_NO_PROVIDER_EFFECT');
      `);
      assert.equal(await committed(db, "order-2", CLAIM_B, 4), false);
      await assert.rejects(
        committed(db, "order-2", "forged", 4),
        /commit proof input is invalid/i,
      );
      await db.exec("SET ROLE grainline_app_runtime");
      assert.equal(await committed(db, "order-2", CLAIM_B, 4), false);
      await assert.rejects(db.query('SELECT * FROM public."Order"'), /permission denied/i);
      await assert.rejects(
        db.query('SELECT * FROM public."OrderRefundReconciliation"'),
        /permission denied/i,
      );
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
      await db.close();
    }
  });
});
