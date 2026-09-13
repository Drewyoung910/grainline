import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260824010000_prepare_order_refund_claim_generation/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      "deletedAt" timestamp(3) without time zone,
      banned boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id)
    );
    CREATE TABLE public."StripeWebhookEvent" (
      id varchar(255) PRIMARY KEY,
      type varchar(100) NOT NULL,
      "sourceObjectId" varchar(255),
      "claimGeneration" bigint NOT NULL DEFAULT 0,
      "processingStartedAt" timestamp(3) without time zone,
      "processedAt" timestamp(3) without time zone,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "sellerProfileId" text REFERENCES public."SellerProfile"(id),
      "paidAt" timestamp(3) without time zone,
      "stripeSessionId" varchar(255) UNIQUE,
      "stripePaymentIntentId" varchar(255),
      "stripeTransferId" varchar(255),
      currency varchar(3) NOT NULL DEFAULT 'usd',
      "itemsSubtotalCents" integer NOT NULL DEFAULT 0,
      "shippingAmountCents" integer NOT NULL DEFAULT 0,
      "taxAmountCents" integer NOT NULL DEFAULT 0,
      "giftWrappingPriceCents" integer,
      "caseResolutionClaimId" text,
      "sellerRefundId" varchar(255),
      "sellerRefundAmountCents" integer,
      "sellerRefundLockedAt" timestamp(3) without time zone,
      "labelStatus" text,
      "reviewNeeded" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."OrderPaymentEvent" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id),
      "eventType" varchar(100) NOT NULL,
      "stripeObjectId" varchar(255),
      status varchar(100),
      metadata jsonb,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Order"
      TO grainline_app_runtime;
  `);
  await database.exec(migration);
  await database.exec(`
    INSERT INTO public."User" (id) VALUES ('seller-user'), ('other-user');
    INSERT INTO public."SellerProfile" (id, "userId") VALUES
      ('seller-profile', 'seller-user'),
      ('other-profile', 'other-user');
  `);
  return database;
}

async function seedOrder(database, {
  id,
  sellerProfileId = "seller-profile",
  sessionId = null,
} = {}) {
  await database.query(`
    INSERT INTO public."Order" (
      id,
      "sellerProfileId",
      "paidAt",
      "stripeSessionId",
      "stripePaymentIntentId",
      "stripeTransferId",
      currency,
      "itemsSubtotalCents",
      "shippingAmountCents",
      "giftWrappingPriceCents",
      "taxAmountCents"
    ) VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, 'tr_test', 'usd', 1000, 200, 50, 75)
  `, [id, sellerProfileId, sessionId, `pi_${id}`]);
}

async function sellerClaim(database, actorId, orderId) {
  return (await database.query(`
    SELECT public.grainline_seller_refund_claim($1, $2) AS claim
  `, [actorId, orderId])).rows[0]?.claim ?? null;
}

async function blockedClaim(database, {
  eventId,
  eventGeneration = 1,
  sessionId,
  orderId,
  amountCents = 1325,
}) {
  return (await database.query(`
    SELECT public.grainline_blocked_checkout_refund_claim(
      $1, $2, $3, $4, $5
    ) AS claim
  `, [eventId, eventGeneration, sessionId, orderId, amountCents])).rows[0]?.claim ?? null;
}

test("disposable PostgreSQL proves seller claim authority, replay, and generation fencing", async () => {
  const database = await createDatabase();
  try {
    await seedOrder(database, { id: "order-seller" });
    const claim = await sellerClaim(database, "seller-user", "order-seller");
    assert.equal(claim.action, "claimed");
    assert.equal(Number(claim.claimGeneration), 1);
    assert.equal(claim.refundAmountCents, 1325);
    assert.equal(claim.currency, "usd");
    assert.equal(claim.paymentIntentId, "pi_order-seller");
    assert.equal(
      claim.idempotencyScope,
      `seller-refund:${claim.claimId}:FULL:1325`,
    );

    const replay = await sellerClaim(database, "seller-user", "order-seller");
    assert.equal(replay.action, "replay");
    assert.equal(replay.claimId, claim.claimId);
    assert.equal(Number(replay.claimGeneration), 1);

    await assert.rejects(
      sellerClaim(database, "other-user", "order-seller"),
      /Order authority is invalid/,
    );

    const row = (await database.query(`
      SELECT
        "sellerRefundId",
        "refundClaimSource",
        "refundClaimSourceId",
        "refundClaimSourceGeneration",
        "refundClaimProviderAuthorizedAt" IS NOT NULL AS provider_authorized
      FROM public."Order" WHERE id = 'order-seller'
    `)).rows[0];
    assert.deepEqual(row, {
      sellerRefundId: "pending",
      refundClaimSource: "SELLER",
      refundClaimSourceId: "seller-user",
      refundClaimSourceGeneration: null,
      provider_authorized: true,
    });
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL binds blocked-checkout claims to one signed lease and amount", async () => {
  const database = await createDatabase();
  try {
    await seedOrder(database, {
      id: "order-blocked",
      sessionId: "cs_blocked",
    });
    await database.query(`
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES ($1, 'checkout.session.completed', $2, 3, CURRENT_TIMESTAMP)
    `, ["evt_blocked", "cs_blocked"]);

    await assert.rejects(
      blockedClaim(database, {
        eventId: "evt_blocked",
        eventGeneration: 2,
        sessionId: "cs_blocked",
        orderId: "order-blocked",
      }),
      /source lease is invalid/,
    );
    await assert.rejects(
      blockedClaim(database, {
        eventId: "evt_blocked",
        eventGeneration: 3,
        sessionId: "cs_blocked",
        orderId: "order-blocked",
        amountCents: 1324,
      }),
      /amount or currency drifted/,
    );

    const claim = await blockedClaim(database, {
      eventId: "evt_blocked",
      eventGeneration: 3,
      sessionId: "cs_blocked",
      orderId: "order-blocked",
    });
    assert.equal(claim.action, "claimed");
    assert.equal(Number(claim.claimGeneration), 1);
    assert.equal(
      claim.idempotencyScope,
      `blocked-checkout-refund:${claim.claimId}:FULL:1325`,
    );

    const replay = await blockedClaim(database, {
      eventId: "evt_blocked",
      eventGeneration: 3,
      sessionId: "cs_blocked",
      orderId: "order-blocked",
    });
    assert.equal(replay.action, "replay");
    assert.equal(replay.claimId, claim.claimId);

    const row = (await database.query(`
      SELECT
        "refundClaimSource",
        "refundClaimSourceId",
        "refundClaimSourceGeneration"
      FROM public."Order" WHERE id = 'order-blocked'
    `)).rows[0];
    assert.deepEqual(row, {
      refundClaimSource: "BLOCKED_CHECKOUT",
      refundClaimSourceId: "evt_blocked",
      refundClaimSourceGeneration: 3,
    });
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL accepts the signed asynchronous checkout success source", async () => {
  const database = await createDatabase();
  try {
    await seedOrder(database, {
      id: "order-async-blocked",
      sessionId: "cs_async_blocked",
    });
    await database.query(`
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES (
        'evt_async_blocked',
        'checkout.session.async_payment_succeeded',
        'cs_async_blocked',
        2,
        CURRENT_TIMESTAMP
      )
    `);

    const claim = await blockedClaim(database, {
      eventId: "evt_async_blocked",
      eventGeneration: 2,
      sessionId: "cs_async_blocked",
      orderId: "order-async-blocked",
    });
    assert.equal(claim.action, "claimed");
    assert.equal(claim.refundAmountCents, 1325);
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL rejects legacy writes that would detach an active claim", async () => {
  const database = await createDatabase();
  try {
    await seedOrder(database, { id: "order-protected" });
    await sellerClaim(database, "seller-user", "order-protected");

    await assert.rejects(
      database.query(`
        UPDATE public."Order"
           SET "sellerRefundId" = NULL,
               "sellerRefundLockedAt" = NULL
         WHERE id = 'order-protected'
      `),
      /Order_refundClaim_tuple_check/,
    );
    await assert.rejects(
      database.query(`
        UPDATE public."Order"
           SET "sellerRefundId" = 're_stolen'
         WHERE id = 'order-protected'
      `),
      /Order_refundClaim_tuple_check/,
    );

    await database.query(`
      UPDATE public."Order"
         SET "sellerRefundId" = 'ambiguous_refund_pending_reconciliation'
       WHERE id = 'order-protected'
    `);
    const row = (await database.query(`
      SELECT "sellerRefundId", "refundClaimId" IS NOT NULL AS has_claim
        FROM public."Order"
       WHERE id = 'order-protected'
    `)).rows[0];
    assert.deepEqual(row, {
      sellerRefundId: "ambiguous_refund_pending_reconciliation",
      has_claim: true,
    });
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL fails closed for refund/dispute conflicts and preserves predecessor grants", async () => {
  const database = await createDatabase();
  try {
    await seedOrder(database, { id: "order-refunded" });
    await database.query(`
      INSERT INTO public."OrderPaymentEvent" (
        id, "orderId", "eventType", status
      ) VALUES ('payment-refund', 'order-refunded', 'REFUND', 'succeeded')
    `);
    assert.equal(
      await sellerClaim(database, "seller-user", "order-refunded"),
      null,
    );

    await seedOrder(database, { id: "order-disputed" });
    await database.query(`
      INSERT INTO public."OrderPaymentEvent" (
        id, "orderId", "eventType", "stripeObjectId", status, metadata
      ) VALUES (
        'payment-dispute', 'order-disputed', 'DISPUTE', 'dp_1',
        'needs_response', '{"stripeEventCreated":"100"}'::jsonb
      )
    `);
    assert.equal(
      await sellerClaim(database, "seller-user", "order-disputed"),
      null,
    );

    const posture = (await database.query(`
      SELECT
        has_table_privilege(
          'grainline_app_runtime', 'public."Order"', 'SELECT,INSERT,UPDATE,DELETE'
        ) AS keeps_order_crud,
        has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_seller_refund_claim(text,text)',
          'EXECUTE'
        ) AS can_seller_claim,
        has_function_privilege(
          'public',
          'public.grainline_seller_refund_claim(text,text)',
          'EXECUTE'
        ) AS public_can_claim
    `)).rows[0];
    assert.deepEqual(posture, {
      keeps_order_crud: true,
      can_seller_claim: true,
      public_can_claim: false,
    });
  } finally {
    await database.close();
  }
});
