import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  assertCleanupSnapshot,
  assertDeliverySnapshot,
  cleanupExactRows,
  createDisposableDatabaseFixtures,
  disposableDatabaseIdentity,
  readCleanupSnapshot,
  readDeliverySnapshot,
} from "../scripts/order-payment-event-signed-production-proof.mjs";

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";

function proofState() {
  return {
    attemptId: ATTEMPT_ID,
    ...disposableDatabaseIdentity(ATTEMPT_ID),
    refundPaymentIntentId: "pi_refund_fixture",
    refundChargeId: "ch_refund_fixture",
    refundId: "re_refund_fixture",
    refundEventId: "evt_refund_fixture",
    refundPaymentEventId: "ope_refund_fixture",
    disputePaymentIntentId: "pi_dispute_fixture",
    disputeChargeId: "ch_dispute_fixture",
    disputeId: "dp_dispute_fixture",
    disputeEventId: "evt_dispute_fixture",
    disputePaymentEventId: "ope_dispute_fixture",
    caseId: "case_dispute_fixture",
    notificationId: "notification_dispute_fixture",
  };
}

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      "clerkId" varchar(255) NOT NULL UNIQUE,
      email varchar(254) NOT NULL UNIQUE,
      name varchar(100),
      role text NOT NULL DEFAULT 'USER',
      "deletedAt" timestamp(3) without time zone,
      banned boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id) ON DELETE CASCADE,
      "displayName" varchar(100) NOT NULL,
      "displayNameNormalized" varchar(100) NOT NULL,
      "vacationMode" boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id) ON DELETE RESTRICT,
      title varchar(150) NOT NULL,
      description varchar(5000) NOT NULL,
      "priceCents" integer NOT NULL,
      currency varchar(3) NOT NULL DEFAULT 'usd',
      status text NOT NULL DEFAULT 'ACTIVE',
      "listingType" text NOT NULL DEFAULT 'MADE_TO_ORDER',
      "isPrivate" boolean NOT NULL DEFAULT false,
      "reservedForUserId" text REFERENCES public."User"(id) ON DELETE SET NULL,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "buyerId" text REFERENCES public."User"(id) ON DELETE SET NULL,
      "sellerProfileId" text REFERENCES public."SellerProfile"(id) ON DELETE RESTRICT,
      "stripePaymentIntentId" varchar(255) UNIQUE,
      "stripeChargeId" varchar(255) UNIQUE,
      currency varchar(3) NOT NULL DEFAULT 'usd',
      "itemsSubtotalCents" integer NOT NULL DEFAULT 0,
      "shippingAmountCents" integer NOT NULL DEFAULT 0,
      "taxAmountCents" integer NOT NULL DEFAULT 0,
      "paidAt" timestamp(3) without time zone,
      "sellerRefundId" varchar(255),
      "sellerRefundAmountCents" integer,
      "reviewNeeded" boolean NOT NULL DEFAULT false,
      "reviewNote" varchar(10000),
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."OrderItem" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id) ON DELETE CASCADE,
      "listingId" text NOT NULL REFERENCES public."Listing"(id) ON DELETE RESTRICT,
      "sellerProfileId" text REFERENCES public."SellerProfile"(id) ON DELETE RESTRICT,
      quantity integer NOT NULL DEFAULT 1,
      "priceCents" integer NOT NULL,
      "listingSnapshot" jsonb,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."StripeWebhookEvent" (
      id varchar(255) PRIMARY KEY,
      type varchar(100) NOT NULL,
      "sourceObjectId" varchar(255),
      "claimGeneration" bigint NOT NULL DEFAULT 1,
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
      metadata jsonb,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."Case" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL UNIQUE REFERENCES public."Order"(id) ON DELETE RESTRICT,
      "buyerId" text REFERENCES public."User"(id) ON DELETE SET NULL,
      "sellerId" text NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
      status text NOT NULL,
      "openedByPaymentEventId" text,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."CaseStripeDisputeApplication" (
      "paymentEventId" text PRIMARY KEY REFERENCES public."OrderPaymentEvent"(id) ON DELETE RESTRICT,
      "caseId" text NOT NULL REFERENCES public."Case"(id) ON DELETE RESTRICT,
      "orderId" text NOT NULL REFERENCES public."Order"(id) ON DELETE RESTRICT,
      action varchar(10) NOT NULL,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."Notification" (
      id text PRIMARY KEY,
      "userId" text NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
      "relatedUserId" text,
      type text NOT NULL,
      "sourceType" varchar(80),
      "sourceId" varchar(191)
    );
    CREATE TABLE public."SystemAuditLog" (
      id text PRIMARY KEY,
      "actorType" varchar(40) NOT NULL,
      "actorId" varchar(255),
      action varchar(100) NOT NULL,
      "targetType" varchar(100) NOT NULL,
      "targetId" varchar(255) NOT NULL,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return database;
}

async function seedDelivery(database, state) {
  await database.query(`
    INSERT INTO public."StripeWebhookEvent" (
      id, type, "sourceObjectId", "claimGeneration", "processingStartedAt", "processedAt"
    ) VALUES
      ($1, 'charge.refunded', $2, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($3, 'charge.dispute.created', $4, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [state.refundEventId, state.refundChargeId, state.disputeEventId, state.disputeId]);
  await database.query(`
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeEventId", "stripeObjectId", "stripeObjectType",
      "eventType", "amountCents", currency, status, reason, metadata
    ) VALUES
      ($1, $2, $3, $4::varchar(255), 'refund', 'REFUND', 500, 'usd', 'succeeded',
        'external_refund', pg_catalog.jsonb_build_object(
          'latestRefundId', $4::varchar(255)
        )),
      ($5, $6, $7, $8, 'dispute', 'DISPUTE', 500, 'usd', 'needs_response',
        NULL, '{}'::jsonb)
  `, [
    state.refundPaymentEventId, state.refundOrderId, state.refundEventId, state.refundId,
    state.disputePaymentEventId, state.disputeOrderId, state.disputeEventId, state.disputeId,
  ]);
  await database.query(`
    UPDATE public."Order"
       SET "sellerRefundId" = $2, "sellerRefundAmountCents" = 500, "reviewNeeded" = true
     WHERE id = $1
  `, [state.refundOrderId, state.refundId]);
  await database.query(
    `UPDATE public."Order" SET "reviewNeeded" = true WHERE id = $1`,
    [state.disputeOrderId],
  );
  await database.query(`
    INSERT INTO public."Case" (
      id, "orderId", "buyerId", "sellerId", status, "openedByPaymentEventId"
    ) VALUES ($1, $2, $3, $4, 'UNDER_REVIEW', $5)
  `, [state.caseId, state.disputeOrderId, state.buyerId, state.sellerUserId, state.disputePaymentEventId]);
  await database.query(`
    INSERT INTO public."CaseStripeDisputeApplication" (
      "paymentEventId", "caseId", "orderId", action
    ) VALUES ($1, $2, $3, 'create')
  `, [state.disputePaymentEventId, state.caseId, state.disputeOrderId]);
  await database.query(`
    INSERT INTO public."Notification" (
      id, "userId", "relatedUserId", type, "sourceType", "sourceId"
    ) VALUES ($1, $2, $3, 'PAYMENT_DISPUTE', 'order_payment', $4)
  `, [state.notificationId, state.sellerUserId, state.buyerId, state.disputeEventId]);
  await database.query(`
    INSERT INTO public."SystemAuditLog" (
      id, "actorType", "actorId", action, "targetType", "targetId"
    ) VALUES
      ('audit-refund', 'webhook', $1, 'STRIPE_REFUND_RECORDED', 'ORDER', $2),
      ('audit-dispute', 'webhook', $3, 'STRIPE_DISPUTE_RECORDED', 'ORDER', $4),
      ('audit-case', 'webhook', $3, 'CASE_STRIPE_DISPUTE_APPLIED', 'CASE', $5)
  `, [state.refundEventId, state.refundOrderId, state.disputeEventId, state.disputeOrderId, state.caseId]);
}

test("disposable PostgreSQL restart-safely creates, proves and exactly cleans both signed families", async () => {
  const database = await createDatabase();
  const state = proofState();
  try {
    await createDisposableDatabaseFixtures(database, state, "refund");
    await createDisposableDatabaseFixtures(database, state, "refund");
    await createDisposableDatabaseFixtures(database, state, "dispute");
    await createDisposableDatabaseFixtures(database, state, "dispute");
    await seedDelivery(database, state);
    const delivered = assertDeliverySnapshot(await readDeliverySnapshot(
      database,
      state,
      state.refundId,
    ), {
      refundObjectId: state.refundId,
      refundRepresentation: "provider_refund",
    });
    assert.equal(delivered.refundPaymentEventId, state.refundPaymentEventId);
    assert.equal(delivered.disputePaymentEventId, state.disputePaymentEventId);
    assert.equal(delivered.caseId, state.caseId);
    assert.equal(delivered.notificationId, state.notificationId);

    await cleanupExactRows(database, state);
    assert.deepEqual(assertCleanupSnapshot(await readCleanupSnapshot(database, state)), {
      userCount: 0,
      sellerCount: 0,
      listingCount: 0,
      orderCount: 0,
      itemCount: 0,
      paymentCount: 0,
      caseCount: 0,
      notificationCount: 0,
      webhookCount: 2,
      processedWebhookCount: 2,
    });
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL refuses fixture collisions and unexpected dependents", async () => {
  const database = await createDatabase();
  const state = proofState();
  try {
    await createDisposableDatabaseFixtures(database, state, "refund");
    await assert.rejects(
      createDisposableDatabaseFixtures(database, { ...state, refundChargeId: "ch_collision" }, "refund"),
      /fixture identity collided/,
    );
    await database.query(
      `UPDATE public."Listing" SET title = 'not-the-proof-marker' WHERE id = $1`,
      [state.refundListingId],
    );
    await assert.rejects(
      createDisposableDatabaseFixtures(database, state, "refund"),
      /fixture identity collided/,
    );
    await database.query(
      `UPDATE public."Listing" SET title = 'payment-proof-refund' WHERE id = $1`,
      [state.refundListingId],
    );
    await createDisposableDatabaseFixtures(database, state, "dispute");
    await seedDelivery(database, state);
    await database.query(
      `UPDATE public."Listing" SET title = 'not-the-proof-marker' WHERE id = $1`,
      [state.refundListingId],
    );
    await assert.rejects(
      cleanupExactRows(database, state),
      /exact cleanup relationship drifted/,
    );
    await database.query(
      `UPDATE public."Listing" SET title = 'payment-proof-refund' WHERE id = $1`,
      [state.refundListingId],
    );
    await database.exec(`
      CREATE TABLE public."UnexpectedOrderDependent" (
        id text PRIMARY KEY,
        "orderId" text NOT NULL REFERENCES public."Order"(id) ON DELETE CASCADE
      )
    `);
    await database.query(
      `INSERT INTO public."UnexpectedOrderDependent" (id, "orderId") VALUES ('unexpected', $1)`,
      [state.refundOrderId],
    );
    await assert.rejects(
      cleanupExactRows(database, state),
      /unexpected dependent row/,
    );
    const retained = await database.query(`
      SELECT
        (SELECT count(*)::integer FROM public."User") AS users,
        (SELECT count(*)::integer FROM public."OrderPaymentEvent") AS payments,
        (SELECT count(*)::integer FROM public."Notification") AS notifications
    `);
    assert.deepEqual(retained.rows[0], { notifications: 1, payments: 2, users: 2 });
  } finally {
    await database.close();
  }
});
