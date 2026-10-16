import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const inventory = fs.readFileSync(
  "scripts/order-refund-648-production-inventory.sql",
  "utf8",
);

function queryBetween(startMarker, endMarker) {
  const start = inventory.indexOf(startMarker);
  const end = inventory.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} query must exist`);
  return inventory.slice(start + startMarker.length, end).trim().replace(/;$/u, "");
}

const claimSummary = queryBetween(
  "-- @query claim-summary",
  "-- @query lost-claim-summary",
);
const lostClaimSummary = queryBetween(
  "-- @query lost-claim-summary",
  "ROLLBACK;",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "refundClaimId" text,
      "refundClaimGeneration" bigint,
      "refundClaimSource" text,
      "refundClaimSourceId" text,
      "refundClaimSourceGeneration" bigint,
      "refundClaimProviderAuthorizedAt" timestamp(3) without time zone,
      "sellerRefundId" text,
      "itemsSubtotalCents" integer NOT NULL,
      "shippingAmountCents" integer NOT NULL,
      "giftWrappingPriceCents" integer,
      "taxAmountCents" integer NOT NULL,
      "caseResolutionClaimId" text
    );
    CREATE TABLE public."OrderPaymentEvent" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id),
      "eventType" text NOT NULL,
      "stripeEventId" text NOT NULL,
      "amountCents" integer,
      status text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamp(3) without time zone NOT NULL
    );
    CREATE TABLE public."StripeWebhookEvent" (
      id text PRIMARY KEY,
      "claimGeneration" bigint NOT NULL,
      "processingStartedAt" timestamp(3) without time zone,
      "processedAt" timestamp(3) without time zone,
      "lastError" text
    );

    INSERT INTO public."Order" (
      id, "refundClaimId", "refundClaimGeneration", "refundClaimSource",
      "refundClaimSourceId", "refundClaimSourceGeneration",
      "refundClaimProviderAuthorizedAt", "sellerRefundId",
      "itemsSubtotalCents", "shippingAmountCents",
      "giftWrappingPriceCents", "taxAmountCents", "caseResolutionClaimId"
    ) VALUES
      ('seller-partial', 'claim-partial', 1, 'SELLER', 'seller-user', NULL,
       CURRENT_TIMESTAMP - INTERVAL '2 hours', 'pending', 900, 100, 0, 0, NULL),
      ('seller-full', 'claim-full', 1, 'SELLER', 'seller-user', NULL,
       CURRENT_TIMESTAMP - INTERVAL '2 hours', 'pending', 900, 100, 0, 0, NULL),
      ('blocked-processed', 'claim-processed', 1, 'BLOCKED_CHECKOUT',
       'evt-processed', 1, CURRENT_TIMESTAMP - INTERVAL '2 hours', 'pending',
       500, 100, 0, 0, NULL),
      ('blocked-ahead', 'claim-ahead', 1, 'BLOCKED_CHECKOUT', 'evt-ahead', 1,
       CURRENT_TIMESTAMP - INTERVAL '2 hours', 'pending', 600, 100, 0, 0, NULL),
      ('lost-claim', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       700, 100, 0, 0, NULL);

    INSERT INTO public."StripeWebhookEvent" (
      id, "claimGeneration", "processingStartedAt", "processedAt", "lastError"
    ) VALUES
      ('evt-processed', 1, NULL, CURRENT_TIMESTAMP,
       'payment evidence is immutable'),
      ('evt-ahead', 2, NULL, CURRENT_TIMESTAMP, NULL);

    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "eventType", "stripeEventId", "amountCents", status,
      metadata, "createdAt"
    ) VALUES
      ('payment-partial', 'seller-partial', 'REFUND', 'evt_partial', 400,
       'succeeded', '{"totalRefundedCents":400}'::jsonb, CURRENT_TIMESTAMP),
      ('payment-full', 'seller-full', 'REFUND', 'evt_full', 500, 'succeeded',
       '{"totalRefundedCents":1000}'::jsonb, CURRENT_TIMESTAMP),
      ('payment-processed', 'blocked-processed', 'REFUND', 'evt_processed_refund',
       600, 'succeeded', '{"totalRefundedCents":600}'::jsonb, CURRENT_TIMESTAMP),
      ('payment-ahead', 'blocked-ahead', 'REFUND', 'evt_ahead_refund', 700,
       'succeeded', '{"totalRefundedCents":700}'::jsonb, CURRENT_TIMESTAMP),
      ('payment-lost', 'lost-claim', 'REFUND', 'evt_lost', 800, 'succeeded',
       '{"totalRefundedCents":800,"pendingLocalRefundLock":true}'::jsonb,
       CURRENT_TIMESTAMP);
  `);
  return database;
}

test("aggregate inventory requires enough signed refund cents and classifies recovery state", async () => {
  const database = await createDatabase();
  try {
    const rows = (await database.query(claimSummary)).rows;
    const byClass = new Map(rows.map((row) => [row.repair_class, row]));
    assert.equal(byClass.get("A_RECORD_EXISTING_STRIPE_REFUND")?.orders, 1);
    assert.equal(Number(
      byClass.get("A_RECORD_EXISTING_STRIPE_REFUND")?.provider_refunded_cents,
    ), 1000);
    assert.equal(
      byClass.get("B_NOT_PROVEN_648_STRIPE_INSPECTION_DECIDES")?.orders,
      1,
    );
    assert.equal(Number(
      byClass.get("B_NOT_PROVEN_648_STRIPE_INSPECTION_DECIDES")
        ?.provider_refunded_cents,
    ), 400);
    assert.equal(byClass.get("C_ENGINEERING_SOURCE_EVENT_PROCESSED")?.orders, 1);
    assert.equal(
      byClass.get("C_ENGINEERING_SOURCE_EVENT_GENERATION_AHEAD")?.orders,
      1,
    );
    assert.equal(
      byClass.get("C_ENGINEERING_SOURCE_EVENT_PROCESSED")
        ?.source_event_failed_with_648,
      true,
    );
  } finally {
    await database.close();
  }
});

test("lost-claim summary emits aggregates without identifiers", async () => {
  const database = await createDatabase();
  try {
    const rows = (await database.query(lostClaimSummary)).rows;
    assert.equal(rows.length, 1);
    assert.deepEqual({
      ...rows[0],
      provider_refunded_cents: Number(rows[0].provider_refunded_cents),
    }, {
      refund_sentinel_cleared: true,
      staff_case_refund_claim_in_flight: false,
      orders: 1,
      provider_refunded_cents: 800,
    });
    assert.doesNotMatch(lostClaimSummary, /SELECT\s+orders\.id\s+AS/iu);
  } finally {
    await database.close();
  }
});

test("the complete inventory script executes without mutating rows", async () => {
  const database = await createDatabase();
  try {
    const before = (await database.query(`
      SELECT count(*)::integer AS count FROM public."Order"
    `)).rows[0].count;
    await database.exec(inventory);
    const after = (await database.query(`
      SELECT count(*)::integer AS count FROM public."Order"
    `)).rows[0].count;
    assert.equal(after, before);
  } finally {
    await database.close();
  }
});
