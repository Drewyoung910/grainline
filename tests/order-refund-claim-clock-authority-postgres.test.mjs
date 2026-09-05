import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = fs.readFileSync(
  "docs/rls-drafts/order-refund-claim-clock-authority.sql",
  "utf8",
);

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS;
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "sellerRefundId" varchar(255),
      "refundClaimId" varchar(255),
      "refundClaimGeneration" bigint NOT NULL DEFAULT 0,
      "refundClaimSource" varchar(32),
      "refundClaimSourceId" varchar(255),
      "refundClaimSourceGeneration" bigint,
      "refundClaimIdempotencyScope" varchar(191),
      "refundClaimProviderAuthorizedAt" timestamp(3) without time zone
    );
    INSERT INTO public."Order" (
      id,
      "sellerRefundId",
      "refundClaimId",
      "refundClaimGeneration",
      "refundClaimSource",
      "refundClaimSourceId",
      "refundClaimSourceGeneration",
      "refundClaimIdempotencyScope",
      "refundClaimProviderAuthorizedAt"
    ) VALUES
      (
        'seller-order', 'pending', 'seller-claim', 2, 'SELLER',
        'seller-user', NULL, 'seller-refund:seller-claim:FULL:500',
        TIMESTAMP '2026-09-05 01:02:03.456'
      ),
      (
        'blocked-order', 'pending', 'blocked-claim', 3, 'BLOCKED_CHECKOUT',
        'evt_123', 7, 'blocked-checkout-refund:blocked-claim:FULL:500',
        TIMESTAMP '2026-09-05 02:03:04.567'
      );
  `);
  await db.exec(migration);
  return db;
}

async function clockRows(db, values) {
  return db.query(
    `SELECT provider_authorized_at::text AS value
       FROM public.grainline_order_refund_claim_provider_clock(
         $1::text, $2::bigint, $3::text, $4::text, $5::bigint, $6::text
       )`,
    values,
  );
}

describe("Order refund claim provider-clock authority in PostgreSQL", () => {
  it("returns one exact clock and rejects every claim-identity forgery", async () => {
    const db = await database();
    try {
      const seller = [
        "seller-claim",
        2,
        "SELLER",
        "seller-user",
        null,
        "seller-refund:seller-claim:FULL:500",
      ];
      assert.equal((await clockRows(db, seller)).rows.length, 1);
      for (const forged of [
        ["wrong", ...seller.slice(1)],
        [seller[0], 3, ...seller.slice(2)],
        [seller[0], seller[1], "BLOCKED_CHECKOUT", seller[3], 7, seller[5]],
        [seller[0], seller[1], seller[2], "other-user", ...seller.slice(4)],
        [...seller.slice(0, 5), "seller-refund:wrong:FULL:500"],
      ]) {
        assert.equal((await clockRows(db, forged)).rows.length, 0);
      }

      const blocked = [
        "blocked-claim",
        3,
        "BLOCKED_CHECKOUT",
        "evt_123",
        7,
        "blocked-checkout-refund:blocked-claim:FULL:500",
      ];
      assert.equal((await clockRows(db, blocked)).rows.length, 1);
      for (const malformed of [
        [seller[0], seller[1], seller[2], seller[3], 7, seller[5]],
        [
          "blocked-claim",
          3,
          "BLOCKED_CHECKOUT",
          "evt_123",
          null,
          "blocked-checkout-refund:blocked-claim:FULL:500",
        ],
      ]) {
        await assert.rejects(clockRows(db, malformed), /input is invalid/i);
      }
    } finally {
      await db.close();
    }
  });

  it("allows the restricted runtime only the fixed function", async () => {
    const db = await database();
    try {
      await db.exec("SET ROLE grainline_app_runtime");
      const result = await clockRows(db, [
        "seller-claim",
        2,
        "SELLER",
        "seller-user",
        null,
        "seller-refund:seller-claim:FULL:500",
      ]);
      assert.equal(result.rows.length, 1);
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
