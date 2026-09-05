import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const candidate = fs.readFileSync(
  "docs/rls-drafts/order-seller-deauthorization-authority.sql",
  "utf8",
);

const rows = (result) => result.rows;
let db;
let dataDirectory;

describe("Order seller deauthorization authority", () => {
  before(async () => {
    dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "grainline-order-deauth-"));
    db = new PGlite({ dataDir: dataDirectory });
    await db.exec(`
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
      CREATE TABLE public."User" (id text PRIMARY KEY);
      CREATE TABLE public."SellerProfile" (
        id text PRIMARY KEY,
        "userId" text NOT NULL REFERENCES public."User"(id),
        "stripeAccountId" varchar(255) UNIQUE,
        "chargesEnabled" boolean NOT NULL DEFAULT false
      );
      CREATE TABLE public."StripeWebhookEvent" (
        id varchar(255) PRIMARY KEY,
        type varchar(100) NOT NULL,
        "sourceObjectId" varchar(255),
        "claimGeneration" bigint NOT NULL,
        "processingStartedAt" timestamp(3) without time zone,
        "processedAt" timestamp(3) without time zone
      );
      CREATE TABLE public."Order" (
        id text PRIMARY KEY,
        "sellerProfileId" text,
        "paidAt" timestamp(3) without time zone,
        "fulfillmentStatus" text NOT NULL,
        "reviewNeeded" boolean NOT NULL DEFAULT false,
        "reviewNote" varchar(10000)
      );
      CREATE TABLE public."SystemAuditLog" (
        id text PRIMARY KEY,
        "actorType" varchar(40) NOT NULL,
        "actorId" varchar(255),
        action varchar(100) NOT NULL,
        "targetType" varchar(100) NOT NULL,
        "targetId" varchar(255) NOT NULL,
        reason varchar(1000),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" timestamp(3) without time zone NOT NULL
      );
      INSERT INTO public."User" (id) VALUES ('seller-user');
      INSERT INTO public."SellerProfile" (
        id, "userId", "stripeAccountId", "chargesEnabled"
      ) VALUES ('seller-1', 'seller-user', 'acct_test_deauth', true);
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES (
        'evt_test_deauth', 'account.application.deauthorized',
        'acct_test_deauth', 1, CURRENT_TIMESTAMP
      );
      INSERT INTO public."Order" (
        id, "sellerProfileId", "paidAt", "fulfillmentStatus", "reviewNeeded", "reviewNote"
      ) VALUES
        ('order-open', 'seller-1', CURRENT_TIMESTAMP - interval '2 days', 'PENDING', false, NULL),
        ('order-held', 'seller-1', CURRENT_TIMESTAMP - interval '1 day', 'SHIPPED', true, 'Separate staff hold'),
        -- Keep this beyond every supported host timezone offset. The proof
        -- intentionally crosses the PostgreSQL timestamp-without-time-zone / JS
        -- Date boundary, so a one-hour lead is not a stable future witness.
        ('order-future', 'seller-1', CURRENT_TIMESTAMP + interval '2 days', 'PENDING', false, NULL),
        ('order-terminal', 'seller-1', CURRENT_TIMESTAMP - interval '1 day', 'DELIVERED', false, NULL);
    `);
    await db.exec(candidate);
  });

  after(async () => {
    await db?.close();
    if (dataDirectory) fs.rmSync(dataDirectory, { recursive: true, force: true });
  });

  it("rejects either half of a deauthorization witness even when CHECK would evaluate to NULL", async () => {
    for (const assignments of [
      '"sellerDeauthorizedAt" = CURRENT_TIMESTAMP, "sellerDeauthorizationEventId" = NULL',
      `"sellerDeauthorizedAt" = NULL, "sellerDeauthorizationEventId" = 'evt_proof'`,
    ]) {
      await db.exec("BEGIN");
      try {
        await assert.rejects(
          () => db.exec(`UPDATE public."Order" SET ${assignments} WHERE id = 'order-terminal'`),
          (error) => error.code === "23514",
        );
      } finally {
        await db.exec("ROLLBACK");
      }
    }
  });

  it("atomically clears the account and marks every eligible pre-event order", async () => {
    const eventCreatedAt = rows(await db.query(`
      SELECT (CURRENT_TIMESTAMP - interval '1 minute')::timestamp AS value
    `))[0].value;
    let applied;
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      applied = rows(await db.query(`
        SELECT * FROM public.grainline_stripe_seller_deauthorization_apply(
          $1, $2, $3, $4::timestamp
        )
      `, ["evt_test_deauth", 1n, "acct_test_deauth", eventCreatedAt]));
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
    }
    assert.deepEqual(rows(await db.query(`
      SELECT "stripeAccountId" AS account_id, "chargesEnabled" AS enabled
        FROM public."SellerProfile" WHERE id = 'seller-1'
    `)), [{ account_id: null, enabled: false }]);
    const orders = rows(await db.query(`
      SELECT id, "reviewNeeded" AS review_needed, "reviewNote" AS review_note,
             "sellerDeauthorizationEventId" AS event_id
        FROM public."Order" ORDER BY id
    `));
    assert.equal(orders.find((row) => row.id === "order-open").event_id, "evt_test_deauth");
    assert.match(orders.find((row) => row.id === "order-open").review_note, /deauthorized/);
    assert.equal(orders.find((row) => row.id === "order-held").event_id, "evt_test_deauth");
    assert.equal(orders.find((row) => row.id === "order-held").review_note, "Separate staff hold");
    assert.equal(orders.find((row) => row.id === "order-future").event_id, null);
    assert.equal(orders.find((row) => row.id === "order-terminal").event_id, null);
    const affectedOrderIds = orders.filter((row) => row.event_id !== null).map((row) => row.id);
    assert.deepEqual(affectedOrderIds, ["order-held", "order-open"]);
    assert.deepEqual(applied, [{
      outcome: "applied",
      seller_profile_id: "seller-1",
      public_visibility_changed: true,
      affected_order_count: affectedOrderIds.length,
    }]);
  });

  it("replays from the immutable event ledger without clearing a reconnected account", async () => {
    const application = rows(await db.query(`
      SELECT "eventCreatedAt"::text AS event_created_at
        FROM public."SellerDeauthorizationApplication"
       WHERE "eventId" = 'evt_test_deauth'
    `))[0];
    await db.exec(`
      UPDATE public."StripeWebhookEvent"
         SET "claimGeneration" = 2, "processingStartedAt" = CURRENT_TIMESTAMP
       WHERE id = 'evt_test_deauth';
      UPDATE public."SellerProfile"
         SET "stripeAccountId" = 'acct_test_reconnected', "chargesEnabled" = true
       WHERE id = 'seller-1';
    `);
    let replayed;
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      replayed = rows(await db.query(`
        SELECT * FROM public.grainline_stripe_seller_deauthorization_apply(
          $1, $2, $3, $4::timestamp
        )
      `, [
        "evt_test_deauth",
        2n,
        "acct_test_deauth",
        application.event_created_at,
      ]));
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
    }
    assert.deepEqual(replayed, [{
      outcome: "replayed",
      seller_profile_id: "seller-1",
      public_visibility_changed: true,
      affected_order_count: 2,
    }]);
    assert.deepEqual(rows(await db.query(`
      SELECT "stripeAccountId" AS account_id, "chargesEnabled" AS enabled
        FROM public."SellerProfile" WHERE id = 'seller-1'
    `)), [{ account_id: "acct_test_reconnected", enabled: true }]);
  });

  it("rejects forged generations and direct runtime ledger access", async () => {
    const application = rows(await db.query(`
      SELECT "eventCreatedAt"::text AS event_created_at
        FROM public."SellerDeauthorizationApplication"
       WHERE "eventId" = 'evt_test_deauth'
    `))[0];
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      await assert.rejects(
        db.query(`
          SELECT * FROM public.grainline_stripe_seller_deauthorization_apply(
            $1, $2, $3, $4::timestamp
          )
        `, ["evt_test_deauth", 1n, "acct_test_deauth", application.event_created_at]),
        /authority is invalid/,
      );
      await assert.rejects(
        db.query(`SELECT * FROM public."SellerDeauthorizationApplication"`),
        /permission denied/,
      );
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
    }
  });

  it("rolls account, order, audit and replay evidence back as one unit", async () => {
    await db.exec(`
      INSERT INTO public."User" (id) VALUES ('rollback-user');
      INSERT INTO public."SellerProfile" (
        id, "userId", "stripeAccountId", "chargesEnabled"
      ) VALUES ('seller-rollback', 'rollback-user', 'acct_test_rollback', true);
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES (
        'evt_test_rollback', 'account.application.deauthorized',
        'acct_test_rollback', 1, CURRENT_TIMESTAMP
      );
      INSERT INTO public."Order" (
        id, "sellerProfileId", "paidAt", "fulfillmentStatus", "reviewNeeded"
      ) VALUES (
        'order-rollback', 'seller-rollback', CURRENT_TIMESTAMP - interval '1 day',
        'PENDING', false
      );
    `);
    const eventCreatedAt = rows(await db.query(`
      SELECT (CURRENT_TIMESTAMP - interval '1 minute')::timestamp AS value
    `))[0].value;

    await db.exec("BEGIN");
    try {
      await db.exec("SET LOCAL ROLE grainline_app_runtime");
      const applied = rows(await db.query(`
        SELECT * FROM public.grainline_stripe_seller_deauthorization_apply(
          $1, $2, $3, $4::timestamp
        )
      `, ["evt_test_rollback", 1n, "acct_test_rollback", eventCreatedAt]));
      assert.equal(applied[0]?.outcome, "applied");
    } finally {
      await db.exec("ROLLBACK");
    }

    assert.deepEqual(rows(await db.query(`
      SELECT "stripeAccountId" AS account_id, "chargesEnabled" AS enabled
        FROM public."SellerProfile" WHERE id = 'seller-rollback'
    `)), [{ account_id: "acct_test_rollback", enabled: true }]);
    assert.deepEqual(rows(await db.query(`
      SELECT "reviewNeeded" AS review_needed,
             "sellerDeauthorizationEventId" AS event_id
        FROM public."Order" WHERE id = 'order-rollback'
    `)), [{ review_needed: false, event_id: null }]);
    assert.equal(rows(await db.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public."SellerDeauthorizationApplication"
       WHERE "eventId" = 'evt_test_rollback'
    `))[0].count, 0);
    assert.equal(rows(await db.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public."SystemAuditLog"
       WHERE "actorId" = 'evt_test_rollback'
    `))[0].count, 0);
  });
});
