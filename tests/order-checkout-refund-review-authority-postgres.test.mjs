import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const candidate = fs.readFileSync(
  "docs/rls-drafts/order-checkout-refund-review-authority.sql",
  "utf8",
);
const rows = (result) => result.rows;
let db;
let dataDirectory;

async function record(action, generation = 3n, sessionId = "cs-review", orderId = "order-review") {
  return rows(await db.query(`
    SELECT * FROM public.grainline_stripe_checkout_refund_review(
      'evt-review', $1, $2, $3, $4
    )
  `, [generation, sessionId, orderId, action]));
}

async function asRuntime(callback) {
  await db.exec("SET ROLE grainline_app_runtime");
  try {
    return await callback();
  } finally {
    await db.exec("RESET ROLE").catch(() => {});
  }
}

async function reviewNote() {
  return rows(await db.query(`
    SELECT "reviewNote" AS note FROM public."Order" WHERE id = 'order-review'
  `))[0].note;
}

describe("Order checkout refund review PostgreSQL authority", () => {
  before(async () => {
    dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "grainline-order-refund-review-"));
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
      CREATE TABLE public."Order" (
        id text PRIMARY KEY,
        "stripeSessionId" varchar(255) UNIQUE,
        "stripePaymentIntentId" varchar(255),
        "sellerRefundId" varchar(255),
        "paymentRefundBlocked" boolean NOT NULL DEFAULT false,
        "paymentOpenDisputeBlocked" boolean NOT NULL DEFAULT false,
        "reviewNeeded" boolean NOT NULL DEFAULT false,
        "reviewNote" varchar(10000)
      );
      CREATE TABLE public."OrderPaymentEvent" (
        id text PRIMARY KEY,
        "orderId" text NOT NULL,
        "eventType" text NOT NULL,
        "stripeObjectId" varchar(255),
        status text,
        metadata jsonb,
        "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      REVOKE ALL ON public."StripeWebhookEvent", public."Order", public."OrderPaymentEvent"
        FROM PUBLIC;
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES (
        'evt-review', 'checkout.session.completed', 'cs-review', 3, CURRENT_TIMESTAMP
      );
      INSERT INTO public."Order" (
        id, "stripeSessionId", "reviewNeeded", "reviewNote"
      ) VALUES (
        'order-review', 'cs-review', true,
        'Seller is no longer eligible. Order was held for staff review. Previous retry detail.'
      );
    `);
    await db.exec(candidate);
  });

  after(async () => {
    await db?.close();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  });

  it("keeps tables closed and rejects forged event, session, Order, and action identity", async () => {
    const privileges = rows(await db.query(`
      SELECT pg_catalog.has_table_privilege(
               'grainline_app_runtime', 'public."Order"', 'SELECT,UPDATE'
             ) AS has_table_authority,
             pg_catalog.has_function_privilege(
               'grainline_app_runtime',
               'public.grainline_stripe_checkout_refund_review(text,bigint,text,text,text)',
               'EXECUTE'
             ) AS can_execute
    `))[0];
    assert.deepEqual(privileges, { has_table_authority: false, can_execute: true });
    await asRuntime(async () => {
      await assert.rejects(record("provider_failure", 4n), /event authority is invalid/);
      await assert.rejects(record("provider_failure", 3n, "cs-other"), /event authority is invalid/);
      await assert.rejects(record("provider_failure", 3n, "cs-review", "order-other"), /Order authority is invalid/);
      await assert.rejects(record("caller_text"), /identity is invalid/);
      await assert.rejects(db.query(`SELECT * FROM public."Order"`), /permission denied/);
    });
  });

  it("records missing payment identity only when PostgreSQL confirms it", async () => {
    assert.deepEqual(await asRuntime(() => record("missing_payment_intent")), [{
      outcome: "missing_payment_intent",
    }]);
    assert.equal(
      await reviewNote(),
      "Seller is no longer eligible. Order was held for staff review. Automatic refund could not be issued because the PaymentIntent ID was unavailable.",
    );
    await db.exec(`
      UPDATE public."Order"
         SET "stripePaymentIntentId" = 'pi_review',
             "reviewNote" = 'Seller is no longer eligible. Order was held for staff review.'
       WHERE id = 'order-review'
    `);
    await asRuntime(async () => {
      await assert.rejects(record("missing_payment_intent"), /payment identity drifted/);
    });
  });

  it("derives refund, open-dispute, and generic conflict outcomes without caller text", async () => {
    await db.exec(`
      INSERT INTO public."OrderPaymentEvent" (
        id, "orderId", "eventType", "stripeObjectId", status, metadata
      ) VALUES ('refund-1', 'order-review', 'REFUND', 're_1', 'succeeded', '{}')
    `);
    assert.deepEqual(await asRuntime(() => record("claim_conflict")), [{
      outcome: "refund_exists",
    }]);
    assert.match(await reviewNote(), /another refund is already being processed or recorded/);

    await db.exec(`
      DELETE FROM public."OrderPaymentEvent";
      UPDATE public."Order"
         SET "reviewNote" = 'Seller is no longer eligible. Order was held for staff review.'
       WHERE id = 'order-review';
      INSERT INTO public."OrderPaymentEvent" (
        id, "orderId", "eventType", "stripeObjectId", status, metadata
      ) VALUES (
        'dispute-1', 'order-review', 'DISPUTE', 'du_1', 'needs_response',
        '{"stripeEventCreated":"100"}'
      )
    `);
    assert.deepEqual(await asRuntime(() => record("claim_conflict")), [{
      outcome: "open_dispute",
    }]);
    assert.match(await reviewNote(), /a Stripe dispute is still open/);

    await db.exec(`
      DELETE FROM public."OrderPaymentEvent";
      UPDATE public."Order"
         SET "reviewNote" = 'Seller is no longer eligible. Order was held for staff review.'
       WHERE id = 'order-review'
    `);
    assert.deepEqual(await asRuntime(() => record("claim_conflict")), [{
      outcome: "state_changed",
    }]);
    assert.match(await reviewNote(), /refund or dispute state changed while processing/);
  });

  it("derives provider-failure precedence and rejects non-blocked Orders", async () => {
    assert.deepEqual(await asRuntime(() => record("provider_failure")), [{
      outcome: "provider_failure",
    }]);
    assert.equal(
      await reviewNote(),
      "Seller is no longer eligible. Order was held for staff review. Automatic refund failed; staff must reconcile this payment manually.",
    );
    await db.exec(`
      INSERT INTO public."OrderPaymentEvent" (
        id, "orderId", "eventType", "stripeObjectId", status, metadata
      ) VALUES ('refund-after-provider', 'order-review', 'REFUND', 're_after', 'succeeded', '{}');
      UPDATE public."Order"
         SET "reviewNote" = 'Seller is no longer eligible. Order was held for staff review.'
       WHERE id = 'order-review'
    `);
    assert.deepEqual(await asRuntime(() => record("provider_failure")), [{
      outcome: "refund_exists",
    }]);
    assert.match(await reviewNote(), /another refund is already being processed or recorded/);
    await db.exec(`
      UPDATE public."Order" SET "reviewNeeded" = false WHERE id = 'order-review'
    `);
    await asRuntime(async () => {
      await assert.rejects(record("provider_failure"), /source state is invalid/);
    });
  });

  it("rejects a completed webhook lease", async () => {
    await db.exec(`
      UPDATE public."Order"
         SET "reviewNeeded" = true,
             "reviewNote" = 'Seller is no longer eligible. Order was held for staff review.'
       WHERE id = 'order-review';
      UPDATE public."StripeWebhookEvent" SET "processedAt" = CURRENT_TIMESTAMP
       WHERE id = 'evt-review'
    `);
    await asRuntime(async () => {
      await assert.rejects(record("provider_failure"), /event authority is invalid/);
    });
  });
});
