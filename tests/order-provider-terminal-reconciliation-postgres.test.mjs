import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const signedAuthority = readFileSync(
  "prisma/migrations/20260824030000_prepare_order_payment_signed_authority/migration.sql",
  "utf8",
);
const signedIdentity = readFileSync(
  "prisma/migrations/20260828010000_prepare_order_payment_signed_refund_identity/migration.sql",
  "utf8",
);
const paymentProjection = readFileSync(
  "prisma/migrations/20260830010000_prepare_order_payment_event_aggregate_authority/migration.sql",
  "utf8",
);
const providerExclusion = readFileSync(
  "prisma/migrations/20260905030000_prepare_order_provider_claim_exclusion/migration.sql",
  "utf8",
);
const terminalReconciliation = readFileSync(
  "prisma/migrations/20260926010000_correct_order_provider_terminal_reconciliation/migration.sql",
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
      "reviewNote" varchar(2000),
      "labelStatus" varchar(32) NOT NULL DEFAULT 'NONE',
      "labelClaimStatus" varchar(32)
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
  await database.exec(signedAuthority);
  await database.exec(signedIdentity);
  await database.exec(paymentProjection);
  await database.exec(providerExclusion);
  await database.exec(`
    INSERT INTO public."User" (id) VALUES ('buyer'), ('seller-user');
    INSERT INTO public."SellerProfile" (id, "userId")
      VALUES ('seller', 'seller-user');
    INSERT INTO public."Order" (
      id, "buyerId", "sellerProfileId", "stripeChargeId",
      "labelStatus", "labelClaimStatus"
    ) VALUES (
      'labeled-order', 'buyer', 'seller', 'ch_labeled',
      'PURCHASED', 'FINALIZED'
    );
    INSERT INTO public."StripeWebhookEvent" (
      id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
    ) VALUES (
      'evt_labeled_refund', 'charge.refunded', 'ch_labeled', 1,
      CURRENT_TIMESTAMP
    );
  `);
  return database;
}

async function applyRefund(database) {
  return (
    await database.query(
      `
    SELECT * FROM public.grainline_order_payment_signed_refund_apply(
      'evt_labeled_refund',
      1,
      'ch_labeled',
      $1,
      11800,
      'usd',
      're_labeledexternal',
      11800,
      'succeeded',
      $1,
      NULL
    )
  `,
      [Math.floor(Date.now() / 1000) - 2],
    )
  ).rows[0];
}

test("terminal Stripe refund evidence survives a purchased Shippo label", async () => {
  const database = await createDatabase();
  try {
    await assert.rejects(
      applyRefund(database),
      /Order_provider_claim_mutual_exclusion_check|check constraint/i,
    );

    assert.equal(
      Number(
        (
          await database.query(`
      SELECT pg_catalog.count(*) AS count
        FROM public."OrderPaymentEvent"
       WHERE "orderId" = 'labeled-order'
    `)
        ).rows[0].count,
      ),
      0,
    );

    await database.exec(terminalReconciliation);
    const inserted = await applyRefund(database);
    assert.equal(inserted.action, "inserted");
    assert.equal(inserted.orderUpdated, true);

    const order = (
      await database.query(`
      SELECT "sellerRefundId", "sellerRefundAmountCents",
             "paymentRefundBlocked", "labelStatus", "labelClaimStatus",
             "reviewNeeded"
        FROM public."Order"
       WHERE id = 'labeled-order'
    `)
    ).rows[0];
    assert.deepEqual(order, {
      sellerRefundId: "re_labeledexternal",
      sellerRefundAmountCents: 11800,
      paymentRefundBlocked: true,
      labelStatus: "PURCHASED",
      labelClaimStatus: "FINALIZED",
      reviewNeeded: true,
    });
    assert.equal(
      Number(
        (
          await database.query(`
      SELECT pg_catalog.count(*) AS count
        FROM public."OrderPaymentEvent"
       WHERE "orderId" = 'labeled-order'
         AND "stripeEventId" = 'evt_labeled_refund'
         AND "stripeObjectId" = 're_labeledexternal'
    `)
        ).rows[0].count,
      ),
      1,
    );
    assert.equal(
      Number(
        (
          await database.query(`
      SELECT pg_catalog.count(*) AS count
        FROM public."SystemAuditLog"
       WHERE action = 'STRIPE_REFUND_RECORDED'
         AND "targetId" = 'labeled-order'
    `)
        ).rows[0].count,
      ),
      1,
    );

    await assert.rejects(
      database.exec(`
        UPDATE public."Order"
           SET "refundClaimId" = 'claim-still-active'
         WHERE id = 'labeled-order'
      `),
      /Order_provider_claim_mutual_exclusion_check|check constraint/i,
    );
  } finally {
    await database.close();
  }
});
