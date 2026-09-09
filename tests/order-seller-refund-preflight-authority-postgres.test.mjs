import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = fs.readFileSync(
  "docs/rls-drafts/order-seller-refund-preflight-authority.sql",
  "utf8",
);

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "sellerProfileId" text,
      "sellerRefundId" text,
      "sellerRefundLockedAt" timestamp(3) without time zone,
      "caseResolutionClaimId" text,
      "refundClaimId" text,
      "paymentOpenDisputeBlocked" boolean NOT NULL DEFAULT false,
      "paymentRefundBlocked" boolean NOT NULL DEFAULT false,
      "labelStatus" text,
      "labelClaimStatus" text,
      "stripePaymentIntentId" text,
      "paidAt" timestamp(3) without time zone
    );
    INSERT INTO public."User" (id) VALUES ('seller-user'), ('other-user');
    INSERT INTO public."SellerProfile" (id, "userId")
      VALUES ('seller', 'seller-user'), ('other-seller', 'other-user');
    INSERT INTO public."Order" (
      id, "sellerProfileId", "stripePaymentIntentId", "paidAt"
    ) VALUES
      ('ready', 'seller', 'pi_ready', CURRENT_TIMESTAMP),
      ('other', 'other-seller', 'pi_other', CURRENT_TIMESTAMP),
      ('stale', 'seller', 'pi_stale', CURRENT_TIMESTAMP),
      ('modern-claim', 'seller', 'pi_modern', CURRENT_TIMESTAMP),
      ('active-label', 'seller', 'pi_label', CURRENT_TIMESTAMP),
      ('open-dispute', 'seller', 'pi_dispute', CURRENT_TIMESTAMP),
      ('ambiguous', 'seller', 'pi_ambiguous', CURRENT_TIMESTAMP),
      ('recorded', 'seller', 'pi_recorded', CURRENT_TIMESTAMP),
      ('refund-blocked', 'seller', 'pi_refund_blocked', CURRENT_TIMESTAMP),
      ('no-payment', 'seller', NULL, CURRENT_TIMESTAMP),
      ('case-claim', 'seller', 'pi_case', CURRENT_TIMESTAMP);
    UPDATE public."Order"
       SET "sellerRefundId" = 'pending',
           "sellerRefundLockedAt" = TIMESTAMP '2020-01-01 00:00:00'
     WHERE id IN ('stale', 'modern-claim');
    UPDATE public."Order"
       SET "refundClaimId" = 'claim-modern'
     WHERE id = 'modern-claim';
    UPDATE public."Order"
       SET "labelClaimStatus" = 'PROVIDER_PENDING'
     WHERE id = 'active-label';
    UPDATE public."Order"
       SET "paymentOpenDisputeBlocked" = true
     WHERE id = 'open-dispute';
    UPDATE public."Order"
       SET "sellerRefundId" = 'ambiguous_refund_pending_reconciliation'
     WHERE id = 'ambiguous';
    UPDATE public."Order"
       SET "sellerRefundId" = 're_recorded'
     WHERE id = 'recorded';
    UPDATE public."Order"
       SET "paymentRefundBlocked" = true
     WHERE id = 'refund-blocked';
    UPDATE public."Order"
       SET "caseResolutionClaimId" = 'case-claim-id'
     WHERE id = 'case-claim';
  `);
  await db.exec(migration);
  return db;
}

async function decision(db, actor, order) {
  return (await db.query(
    `SELECT public.grainline_seller_refund_preflight($1, $2) AS decision`,
    [actor, order],
  )).rows[0]?.decision;
}

describe("Order seller-refund preflight authority in PostgreSQL", () => {
  it("authorizes only the durable seller and releases only a legacy stale lock", async () => {
    const db = await database();
    try {
      assert.equal(await decision(db, "seller-user", "ready"), "READY");
      assert.equal(await decision(db, "seller-user", "other"), "NOT_FOUND");
      assert.equal(await decision(db, "other-user", "ready"), "NOT_FOUND");
      assert.equal(await decision(db, "seller-user", "missing"), "NOT_FOUND");

      assert.equal(await decision(db, "other-user", "stale"), "NOT_FOUND");
      assert.equal(
        (await db.query(
          `SELECT "sellerRefundId" FROM public."Order" WHERE id = 'stale'`,
        )).rows[0]?.sellerRefundId,
        "pending",
      );

      assert.equal(await decision(db, "seller-user", "stale"), "READY");
      assert.deepEqual(
        (await db.query(
          `SELECT "sellerRefundId", "sellerRefundLockedAt"
             FROM public."Order" WHERE id = 'stale'`,
        )).rows,
        [{ sellerRefundId: null, sellerRefundLockedAt: null }],
      );

      assert.equal(
        await decision(db, "seller-user", "modern-claim"),
        "PROCESSING",
      );
      assert.equal(
        (await db.query(
          `SELECT "refundClaimId" FROM public."Order" WHERE id = 'modern-claim'`,
        )).rows[0]?.refundClaimId,
        "claim-modern",
      );
    } finally {
      await db.close();
    }
  });

  it("classifies provider conflicts and denies direct runtime table access", async () => {
    const db = await database();
    try {
      assert.equal(
        await decision(db, "seller-user", "active-label"),
        "LABEL_BLOCKED",
      );
      assert.equal(
        await decision(db, "seller-user", "open-dispute"),
        "OPEN_DISPUTE",
      );
      assert.equal(await decision(db, "seller-user", "ambiguous"), "AMBIGUOUS");
      assert.equal(await decision(db, "seller-user", "recorded"), "RECORDED");
      assert.equal(await decision(db, "seller-user", "refund-blocked"), "RECORDED");
      assert.equal(await decision(db, "seller-user", "no-payment"), "NO_PAYMENT");
      assert.equal(await decision(db, "seller-user", "case-claim"), "STATE_CHANGED");
      await assert.rejects(
        decision(db, " seller-user", "ready"),
        /input is invalid/i,
      );
      await db.exec("SET ROLE grainline_app_runtime");
      assert.equal(await decision(db, "seller-user", "ready"), "READY");
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
