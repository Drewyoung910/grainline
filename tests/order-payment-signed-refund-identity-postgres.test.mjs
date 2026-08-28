import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const predecessor = readFileSync(
  "prisma/migrations/20260824030000_prepare_order_payment_signed_authority/migration.sql",
  "utf8",
);
const successor = readFileSync(
  "prisma/migrations/20260828010000_prepare_order_payment_signed_refund_identity/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TABLE public."User" (id text PRIMARY KEY);
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id)
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "buyerId" text REFERENCES public."User"(id),
      "sellerProfileId" text REFERENCES public."SellerProfile"(id),
      currency varchar(3) NOT NULL DEFAULT 'usd',
      "stripeChargeId" varchar(255) UNIQUE,
      "sellerRefundId" varchar(255),
      "sellerRefundAmountCents" integer,
      "sellerRefundLockedAt" timestamp(3) without time zone,
      "caseResolutionClaimId" varchar(255),
      "refundClaimId" varchar(255),
      "itemsSubtotalCents" integer NOT NULL DEFAULT 10000,
      "shippingAmountCents" integer NOT NULL DEFAULT 1000,
      "giftWrappingPriceCents" integer,
      "taxAmountCents" integer NOT NULL DEFAULT 800,
      "reviewNeeded" boolean NOT NULL DEFAULT false,
      "reviewNote" varchar(2000)
    );
    CREATE TABLE public."StripeWebhookEvent" (
      id varchar(255) PRIMARY KEY,
      type varchar(100) NOT NULL,
      "sourceObjectId" varchar(255),
      "claimGeneration" bigint NOT NULL DEFAULT 0,
      "processingStartedAt" timestamp(3) without time zone,
      "processedAt" timestamp(3) without time zone,
      "lastError" varchar(2000),
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."OrderPaymentEvent" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id) ON DELETE RESTRICT,
      "stripeEventId" varchar(255) NOT NULL UNIQUE,
      "stripeObjectId" varchar(255),
      "stripeObjectType" varchar(100),
      "eventType" varchar(100) NOT NULL,
      "amountCents" integer,
      currency varchar(3) NOT NULL DEFAULT 'usd',
      status varchar(100),
      reason varchar(255),
      description varchar(5000),
      metadata jsonb,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (id, "orderId")
    );
    CREATE INDEX "OrderPaymentEvent_orderId_createdAt_idx"
      ON public."OrderPaymentEvent" ("orderId", "createdAt");
    CREATE INDEX "OrderPaymentEvent_eventType_createdAt_idx"
      ON public."OrderPaymentEvent" ("eventType", "createdAt");
    CREATE INDEX "OrderPaymentEvent_stripeObjectId_idx"
      ON public."OrderPaymentEvent" ("stripeObjectId");
    CREATE TABLE public."SystemAuditLog" (
      id text PRIMARY KEY,
      "actorType" varchar(40) NOT NULL,
      "actorId" varchar(255),
      action varchar(100) NOT NULL,
      "targetType" varchar(100) NOT NULL,
      "targetId" varchar(255) NOT NULL,
      reason varchar(1000),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE FUNCTION public.grainline_case_stripe_dispute_apply(p_payment_event_id text)
    RETURNS TABLE (
      "caseId" text,
      "orderId" text,
      "sellerUserId" text,
      "buyerUserId" text,
      "paymentEventId" text,
      action text
    )
    LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
    AS $stub$
      SELECT 'case-' || payment.id, payment."orderId", seller."userId",
             orders."buyerId", payment.id, 'create'::text
        FROM public."OrderPaymentEvent" AS payment
        JOIN public."Order" AS orders ON orders.id = payment."orderId"
        JOIN public."SellerProfile" AS seller ON seller.id = orders."sellerProfileId"
       WHERE payment.id = p_payment_event_id
    $stub$;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public."OrderPaymentEvent" TO grainline_app_runtime;
  `);
  await database.exec(predecessor);
  await database.exec(successor);
  await database.exec(`
    INSERT INTO public."User" (id) VALUES ('buyer'), ('seller-user');
    INSERT INTO public."SellerProfile" (id, "userId")
      VALUES ('seller', 'seller-user');
  `);
  return database;
}

async function seedOrder(database, suffix, amount = 11800) {
  await database.query(`
    INSERT INTO public."Order" (
      id, "buyerId", "sellerProfileId", "stripeChargeId",
      "sellerRefundId", "sellerRefundAmountCents", "reviewNeeded", "reviewNote"
    ) VALUES ($1, 'buyer', 'seller', $2, $3, $4, true, $5)
  `, [
    `order-${suffix}`,
    `ch_${suffix}`,
    `re_${suffix}`,
    amount,
    `preserve-${suffix}`,
  ]);
}

async function seedLocalEvidence(database, {
  suffix,
  action,
  reason,
  amount = 11800,
  includeAudit = true,
}) {
  const paymentId = `local-payment-${suffix}-${action}`;
  const refundId = `re_${suffix}`;
  await database.query(`
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeEventId", "stripeObjectId", "stripeObjectType",
      "eventType", "amountCents", currency, status, reason, description, metadata
    ) VALUES ($1, $2, $3::text, $4::text, 'refund', 'REFUND', $5, 'usd', 'succeeded',
              $6, 'local evidence',
              pg_catalog.jsonb_build_object(
                'localAction', $7::text,
                'refundIds', pg_catalog.jsonb_build_array($4::text)
              ))
  `, [
    paymentId,
    `order-${suffix}`,
    `local:${action.toLowerCase()}:${refundId}`,
    refundId,
    amount,
    reason,
    action,
  ]);
  if (includeAudit) {
    await database.query(`
      INSERT INTO public."SystemAuditLog" (
        id, "actorType", "actorId", action, "targetType", "targetId", reason, metadata
      ) VALUES ($1, 'system', 'fixture', $2, 'ORDER', $3, $4,
                pg_catalog.jsonb_build_object(
                  'orderPaymentEventId', $5::text,
                  'stripeRefundId', $6::text,
                  'amountCents', $7::integer,
                  'currency', 'usd'
                ))
    `, [
      `audit-${suffix}-${action}`,
      action,
      `order-${suffix}`,
      reason,
      paymentId,
      refundId,
      amount,
    ]);
  }
  return paymentId;
}

async function seedLease(database, suffix, generation = 1) {
  await database.query(`
    INSERT INTO public."StripeWebhookEvent" (
      id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
    ) VALUES ($1, 'charge.refunded', $2, $3, CURRENT_TIMESTAMP)
  `, [`evt_${suffix}`, `ch_${suffix}`, generation]);
}

async function applyOmittedRefund(
  database,
  suffix,
  amount = 11800,
  generation = 1,
  eventCreatedSeconds = Math.floor(Date.now() / 1000) - 2,
) {
  return (await database.query(`
    SELECT * FROM public.grainline_order_payment_signed_refund_apply(
      $1, $2, $3, $4, $5, 'usd', NULL, NULL, NULL, NULL, NULL
    )
  `, [
    `evt_${suffix}`,
    generation,
    `ch_${suffix}`,
    eventCreatedSeconds,
    amount,
  ])).rows[0];
}

const families = [
  ["seller", "SELLER_REFUND_RECORDED", "seller_refund"],
  ["case", "CASE_REFUND_RECORDED", "case_resolution_refund"],
  ["blocked", "BLOCKED_CHECKOUT_REFUND_RECORDED", "blocked_checkout"],
];

test("disposable PostgreSQL derives omitted refund identity for all fixed local families", async () => {
  const database = await createDatabase();
  try {
    for (const [suffix, action, reason] of families) {
      await seedOrder(database, suffix);
      const localPaymentId = await seedLocalEvidence(database, { suffix, action, reason });
      await seedLease(database, suffix);
      const eventCreatedSeconds = Math.floor(Date.now() / 1000) - 2;
      const inserted = await applyOmittedRefund(
        database,
        suffix,
        11800,
        1,
        eventCreatedSeconds,
      );
      assert.equal(inserted.action, "inserted");
      assert.equal(inserted.orderId, `order-${suffix}`);
      assert.equal(inserted.orderUpdated, false);

      const signed = (await database.query(`
        SELECT "stripeObjectId", "amountCents", status, reason, metadata
          FROM public."OrderPaymentEvent" WHERE "stripeEventId" = $1
      `, [`evt_${suffix}`])).rows[0];
      assert.equal(signed.stripeObjectId, `re_${suffix}`);
      assert.equal(signed.amountCents, 11800);
      assert.equal(signed.status, "succeeded");
      assert.equal(signed.reason, "local_refund_confirmed");
      assert.equal(signed.metadata.latestRefundId, `re_${suffix}`);
      assert.equal(signed.metadata.latestRefundAmountCents, 11800);
      assert.equal(signed.metadata.localRefundEvidenceId, localPaymentId);
      assert.equal(signed.metadata.localRefundEvidenceAction, action);

      const order = (await database.query(`
        SELECT "sellerRefundId", "sellerRefundAmountCents", "reviewNote"
          FROM public."Order" WHERE id = $1
      `, [`order-${suffix}`])).rows[0];
      assert.equal(order.sellerRefundId, `re_${suffix}`);
      assert.equal(order.sellerRefundAmountCents, 11800);
      assert.equal(order.reviewNote, `preserve-${suffix}`);

      const replay = await applyOmittedRefund(
        database,
        suffix,
        11800,
        1,
        eventCreatedSeconds,
      );
      assert.equal(replay.action, "replay");
      assert.equal(replay.orderUpdated, false);
      assert.equal(replay.paymentEventId, inserted.paymentEventId);
    }
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL keeps missing, ambiguous, or amount-mismatched evidence external", async () => {
  const database = await createDatabase();
  try {
    await seedOrder(database, "missing-audit");
    await seedLocalEvidence(database, {
      suffix: "missing-audit",
      action: "SELLER_REFUND_RECORDED",
      reason: "seller_refund",
      includeAudit: false,
    });
    await seedLease(database, "missing-audit");
    const missingAudit = await applyOmittedRefund(database, "missing-audit");
    assert.equal(missingAudit.orderUpdated, true);

    await seedOrder(database, "mismatch", 5000);
    await seedLocalEvidence(database, {
      suffix: "mismatch",
      action: "SELLER_REFUND_RECORDED",
      reason: "seller_refund",
      amount: 5000,
    });
    await seedLease(database, "mismatch");
    const mismatch = await applyOmittedRefund(database, "mismatch", 6000);
    assert.equal(mismatch.orderUpdated, true);

    await seedOrder(database, "duplicate");
    await seedLocalEvidence(database, {
      suffix: "duplicate",
      action: "SELLER_REFUND_RECORDED",
      reason: "seller_refund",
    });
    await seedLocalEvidence(database, {
      suffix: "duplicate",
      action: "BLOCKED_CHECKOUT_REFUND_RECORDED",
      reason: "blocked_checkout",
    });
    await seedLease(database, "duplicate");
    const duplicate = await applyOmittedRefund(database, "duplicate");
    assert.equal(duplicate.orderUpdated, true);

    for (const suffix of ["missing-audit", "mismatch", "duplicate"]) {
      const signed = (await database.query(`
        SELECT "stripeObjectId", reason, metadata
          FROM public."OrderPaymentEvent" WHERE "stripeEventId" = $1
      `, [`evt_${suffix}`])).rows[0];
      assert.equal(signed.stripeObjectId, `external:evt_${suffix}`);
      assert.equal(signed.reason, "additional_external_refund");
      assert.equal(signed.metadata.localRefundEvidenceId, null);
      assert.equal(signed.metadata.localRefundEvidenceAction, null);
    }
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL preserves exact legacy replay and rejects source-generation forgery", async () => {
  const database = await createDatabase();
  try {
    await seedOrder(database, "legacy");
    await seedLocalEvidence(database, {
      suffix: "legacy",
      action: "BLOCKED_CHECKOUT_REFUND_RECORDED",
      reason: "blocked_checkout",
    });
    await seedLease(database, "legacy");
    const eventCreated = Math.floor(Date.now() / 1000) - 2;
    await database.query(`
      INSERT INTO public."OrderPaymentEvent" (
        id, "orderId", "stripeEventId", "stripeObjectId", "stripeObjectType",
        "eventType", "amountCents", currency, status, reason, description,
        metadata, "stripeEventCreatedSeconds"
      ) VALUES (
        'legacy-signed', 'order-legacy', 'evt_legacy', 'external:evt_legacy',
        'refund', 'REFUND', 11800, 'usd', 'refunded',
        'additional_external_refund', 'legacy representation',
        pg_catalog.jsonb_build_object(
          'chargeId', 'ch_legacy',
          'latestRefundId', NULL,
          'latestRefundAmountCents', NULL,
          'totalRefundedCents', 11800,
          'refundCreatedSeconds', NULL,
          'refundReason', NULL
        ),
        $1
      )
    `, [eventCreated]);
    const replay = (await database.query(`
      SELECT * FROM public.grainline_order_payment_signed_refund_apply(
        'evt_legacy', 1, 'ch_legacy', $1, 11800, 'usd',
        NULL, NULL, NULL, NULL, NULL
      )
    `, [eventCreated])).rows[0];
    assert.equal(replay.action, "replay");
    assert.equal(replay.paymentEventId, "legacy-signed");

    await seedOrder(database, "forged");
    await seedLocalEvidence(database, {
      suffix: "forged",
      action: "SELLER_REFUND_RECORDED",
      reason: "seller_refund",
    });
    await seedLease(database, "forged", 2);
    await assert.rejects(
      applyOmittedRefund(database, "forged", 11800, 1),
      /source lease is invalid/,
    );
  } finally {
    await database.close();
  }
});
