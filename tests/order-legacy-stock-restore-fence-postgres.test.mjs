import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const draft = fs.readFileSync(
  "docs/rls-drafts/order-legacy-stock-restore-fence.sql",
  "utf8",
);

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS;
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "stripeSessionId" text UNIQUE
    );
    CREATE TABLE public."StripeWebhookEvent" (
      id text PRIMARY KEY,
      type text NOT NULL,
      "sourceObjectId" text,
      "claimGeneration" bigint NOT NULL DEFAULT 0,
      "processingStartedAt" timestamp(3) without time zone,
      "processedAt" timestamp(3) without time zone,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO public."Order" (id, "stripeSessionId")
      VALUES ('existing-order', 'cs_test_existing');
  `);
  await db.exec(draft);
  return db;
}

async function claim(db, sessionId) {
  return (await db.query(
    "SELECT public.grainline_legacy_stock_restore_claim($1) AS claimed",
    [sessionId],
  )).rows[0]?.claimed;
}

describe("Order legacy stock-restore fence in PostgreSQL", () => {
  it("refuses an existing Order and creates no restore evidence", async () => {
    const db = await database();
    try {
      assert.equal(await claim(db, "cs_test_existing"), false);
      assert.equal(
        (await db.query('SELECT count(*)::integer AS count FROM public."StripeWebhookEvent"')).rows[0]?.count,
        0,
      );
    } finally {
      await db.close();
    }
  });

  it("claims an absent Session once and validates canonical replay evidence", async () => {
    const db = await database();
    try {
      assert.equal(await claim(db, "cs_test_absent"), true);
      assert.equal(await claim(db, "cs_test_absent"), false);
      assert.deepEqual(
        (await db.query(`
          SELECT type, "sourceObjectId", "claimGeneration", "processedAt" IS NOT NULL AS processed
            FROM public."StripeWebhookEvent"
           WHERE id = 'checkout-stock-restore:cs_test_absent'
        `)).rows,
        [{
          type: "checkout.session.stock_restored",
          sourceObjectId: "cs_test_absent",
          claimGeneration: 1,
          processed: true,
        }],
      );
      await db.exec(`
        INSERT INTO public."StripeWebhookEvent" (
          id, type, "sourceObjectId", "claimGeneration",
          "processingStartedAt", "processedAt"
        ) VALUES (
          'checkout-stock-restore:cs_test_legacy',
          'checkout.session.stock_restored',
          NULL,
          1,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `);
      assert.equal(await claim(db, "cs_test_legacy"), false);
      assert.equal(
        (await db.query(`
          SELECT "sourceObjectId"
            FROM public."StripeWebhookEvent"
           WHERE id = 'checkout-stock-restore:cs_test_legacy'
        `)).rows[0]?.sourceObjectId,
        "cs_test_legacy",
      );
      await db.exec(`
        UPDATE public."StripeWebhookEvent"
           SET "sourceObjectId" = 'cs_test_forged'
         WHERE id = 'checkout-stock-restore:cs_test_absent'
      `);
      await assert.rejects(
        claim(db, "cs_test_absent"),
        /conflicts with an invalid event/i,
      );
    } finally {
      await db.close();
    }
  });

  it("rejects malformed input and denies runtime direct table access", async () => {
    const db = await database();
    try {
      await assert.rejects(claim(db, " cs_test_bad"), /session id is invalid/i);
      await db.exec("SET ROLE grainline_app_runtime");
      assert.equal(await claim(db, "cs_test_runtime"), true);
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
