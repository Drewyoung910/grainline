import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  assertCleanupSnapshot,
  assertProofSnapshot,
  cleanupExactRows,
  createFixtures,
  readCleanupSnapshot,
  readProofSnapshot,
} from "../scripts/order-payment-event-seller-refund-production-proof.mjs";

function state() {
  return {
    sellerUserId: "opesr_seller_user",
    sellerClerkId: "user_sellerproof",
    sellerProfileId: "opesr_seller",
    buyerId: "opesr_buyer",
    buyerClerkId: "opesr_buyer_clerk",
    buyerEmail: "opesr_buyer@example.invalid",
    listingId: "opesr_listing",
    orderId: "opesr_order",
    orderItemId: "opesr_item",
    caseId: "opesr_case",
    stripeAccountId: "acct_fixture",
    paymentIntentId: "pi_fixture",
    chargeId: "ch_fixture",
    transferId: "tr_fixture",
    refundId: "re_fixture",
    transferReversalId: "trr_fixture",
    signedEventId: "evt_fixture",
    localPaymentEventId: "ope_local",
    signedPaymentEventId: "ope_signed",
    caseApplicationId: "ope_local",
    notificationId: "notification_fixture",
    emailOutboxId: "outbox_fixture",
  };
}

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE public."User" (
      id text PRIMARY KEY, "clerkId" varchar(255) NOT NULL UNIQUE, email varchar(254) NOT NULL UNIQUE,
      name varchar(100), role text NOT NULL DEFAULT 'USER', "notificationPreferences" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "deletedAt" timestamp(3), banned boolean NOT NULL DEFAULT false, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY, "userId" text NOT NULL UNIQUE REFERENCES public."User"(id) ON DELETE CASCADE,
      "displayName" varchar(100) NOT NULL, "displayNameNormalized" varchar(100) NOT NULL,
      "stripeAccountId" varchar(255) UNIQUE, "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountVersion" varchar(20), "stripeControllerType" varchar(100), "vacationMode" boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY, "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id) ON DELETE RESTRICT,
      title varchar(150) NOT NULL, description varchar(5000) NOT NULL, "priceCents" integer NOT NULL,
      currency varchar(3) NOT NULL DEFAULT 'usd', status text NOT NULL, "listingType" text NOT NULL,
      "stockQuantity" integer, "shipsWithinDays" integer, "isPrivate" boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY, "buyerId" text REFERENCES public."User"(id) ON DELETE SET NULL,
      "sellerProfileId" text REFERENCES public."SellerProfile"(id) ON DELETE RESTRICT,
      "stripePaymentIntentId" varchar(255) UNIQUE, "stripeChargeId" varchar(255) UNIQUE, "stripeTransferId" varchar(255),
      currency varchar(3) NOT NULL DEFAULT 'usd', "itemsSubtotalCents" integer NOT NULL DEFAULT 0,
      "shippingAmountCents" integer NOT NULL DEFAULT 0, "taxAmountCents" integer NOT NULL DEFAULT 0,
      "paidAt" timestamp(3), "fulfillmentStatus" text NOT NULL DEFAULT 'PENDING',
      "sellerRefundId" varchar(255), "sellerRefundAmountCents" integer, "refundClaimId" varchar(255),
      "refundClaimSource" varchar(32), "refundClaimSourceId" varchar(255), "refundClaimIdempotencyScope" varchar(191),
      "refundClaimProviderAuthorizedAt" timestamp(3), "reviewNeeded" boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."OrderItem" (
      id text PRIMARY KEY, "orderId" text NOT NULL REFERENCES public."Order"(id) ON DELETE CASCADE,
      "listingId" text NOT NULL REFERENCES public."Listing"(id) ON DELETE RESTRICT,
      "sellerProfileId" text REFERENCES public."SellerProfile"(id) ON DELETE RESTRICT,
      quantity integer NOT NULL, "priceCents" integer NOT NULL, "listingSnapshot" jsonb
    );
    CREATE TABLE public."Case" (
      id text PRIMARY KEY, "orderId" text NOT NULL UNIQUE REFERENCES public."Order"(id) ON DELETE RESTRICT,
      "buyerId" text REFERENCES public."User"(id) ON DELETE SET NULL, "sellerId" text NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
      reason text NOT NULL, description varchar(5000) NOT NULL, status text NOT NULL, resolution text,
      "refundAmountCents" integer, "stripeRefundId" varchar(255), "sellerRespondBy" timestamp(3) NOT NULL,
      "resolvedById" text REFERENCES public."User"(id) ON DELETE SET NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL
    );
    CREATE TABLE public."CaseMessage" (
      id text PRIMARY KEY, "caseId" text NOT NULL REFERENCES public."Case"(id) ON DELETE CASCADE,
      "authorId" text NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
      "authorKind" text, body varchar(5000) NOT NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."StripeWebhookEvent" (
      id varchar(255) PRIMARY KEY, type varchar(100) NOT NULL, "sourceObjectId" varchar(255),
      "claimGeneration" bigint NOT NULL DEFAULT 1, "processedAt" timestamp(3), "lastError" varchar(2000)
    );
    CREATE TABLE public."OrderPaymentEvent" (
      id text PRIMARY KEY, "orderId" text NOT NULL REFERENCES public."Order"(id) ON DELETE RESTRICT,
      "stripeEventId" varchar(255) NOT NULL UNIQUE, "stripeObjectId" varchar(255), "stripeObjectType" varchar(100),
      "eventType" varchar(100) NOT NULL, "amountCents" integer, currency varchar(3) NOT NULL, status varchar(100),
      reason varchar(255), metadata jsonb
    );
    CREATE TABLE public."CaseSellerRefundApplication" (
      "paymentEventId" text PRIMARY KEY REFERENCES public."OrderPaymentEvent"(id) ON DELETE RESTRICT,
      "caseId" text NOT NULL REFERENCES public."Case"(id) ON DELETE RESTRICT,
      "orderId" text NOT NULL REFERENCES public."Order"(id) ON DELETE RESTRICT, action varchar(10) NOT NULL
    );
    CREATE TABLE public."Notification" (
      id text PRIMARY KEY, "userId" text NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
      "relatedUserId" text, type text NOT NULL, "sourceType" varchar(80), "sourceId" varchar(191)
    );
    CREATE TABLE public."EmailOutbox" (
      id text PRIMARY KEY, "userId" varchar(191), "preferenceKey" varchar(80), "sourceType" varchar(80),
      "sourceId" varchar(191), status varchar(20) NOT NULL
    );
    CREATE TABLE public."SystemAuditLog" (
      id text PRIMARY KEY, "actorType" varchar(40) NOT NULL, "actorId" varchar(255), action varchar(100) NOT NULL,
      "targetType" varchar(100) NOT NULL, "targetId" varchar(255) NOT NULL
    );
    CREATE FUNCTION public.grainline_test_case_opening_evidence_valid()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $grainline_test_case_opening_evidence_valid$
    BEGIN
      IF EXISTS (SELECT 1 FROM public."Case" WHERE id = NEW.id)
         AND NOT EXISTS (SELECT 1 FROM public."CaseMessage" WHERE "caseId" = NEW.id) THEN
        RAISE EXCEPTION 'Case has no human or durable webhook opening evidence'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $grainline_test_case_opening_evidence_valid$;
    CREATE CONSTRAINT TRIGGER grainline_test_case_opening_evidence_valid
    AFTER INSERT OR UPDATE ON public."Case"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.grainline_test_case_opening_evidence_valid();
  `);
  await db.query(`INSERT INTO public."User" (id, "clerkId", email, name, role, "updatedAt")
    VALUES ($1, $2, 'canary@example.invalid', 'Operational Canary', 'USER', CURRENT_TIMESTAMP)`,
  [state().sellerUserId, state().sellerClerkId]);
  return db;
}

async function seedOutcome(db, value) {
  await db.query(`UPDATE public."Order" SET "sellerRefundId"=$2, "sellerRefundAmountCents"=500,
    "reviewNeeded"=true WHERE id=$1`, [value.orderId, value.refundId]);
  await db.query(`UPDATE public."Listing" SET "stockQuantity"=1, status='ACTIVE' WHERE id=$1`, [value.listingId]);
  await db.query(`UPDATE public."Case" SET status='RESOLVED', resolution='REFUND_FULL', "refundAmountCents"=500,
    "stripeRefundId"=$2, "resolvedById"=$3 WHERE id=$1`, [value.caseId, value.refundId, value.sellerUserId]);
  await db.query(`INSERT INTO public."StripeWebhookEvent" (id,type,"sourceObjectId","claimGeneration","processedAt")
    VALUES ($1,'charge.refunded',$2,1,CURRENT_TIMESTAMP)`, [value.signedEventId, value.chargeId]);
  await db.query(`INSERT INTO public."OrderPaymentEvent" (id,"orderId","stripeEventId","stripeObjectId","stripeObjectType","eventType","amountCents",currency,status,reason,metadata)
    VALUES ($1,$3,'local:seller_refund_recorded:'||$4,$4,'refund','REFUND',500,'usd','succeeded','seller_refund',
      pg_catalog.jsonb_build_object('refundAccounting',pg_catalog.jsonb_build_object(
        'buyerRefundAmountCents',500,'originalTransferAmountCents',475,'transferReversalId',$6::text,
        'transferReversalAmountCents',475,'platformFundedRefundCents',25))),
      ($2,$3,$5,$4,'refund','REFUND',500,'usd','succeeded','local_refund_confirmed',
      pg_catalog.jsonb_build_object('latestRefundId',$4,'totalRefundedCents',500,'pendingLocalRefundLock',false))`,
  [value.localPaymentEventId, value.signedPaymentEventId, value.orderId, value.refundId, value.signedEventId,
    value.transferReversalId]);
  await db.query(`INSERT INTO public."CaseSellerRefundApplication" ("paymentEventId","caseId","orderId",action)
    VALUES ($1,$2,$3,'resolve')`, [value.caseApplicationId, value.caseId, value.orderId]);
  await db.query(`INSERT INTO public."Notification" (id,"userId","relatedUserId",type,"sourceType","sourceId")
    VALUES ($1,$2,$3,'REFUND_ISSUED','order_payment','local:seller_refund_recorded:'||$4)`,
  [value.notificationId, value.buyerId, value.sellerUserId, value.refundId]);
  await db.query(`INSERT INTO public."EmailOutbox" (id,"userId","preferenceKey","sourceType","sourceId",status)
    VALUES ($1,$2,'EMAIL_REFUND_ISSUED','order_payment','local:seller_refund_recorded:'||$3,'SKIPPED')`,
  [value.emailOutboxId, value.buyerId, value.refundId]);
  await db.query(`INSERT INTO public."SystemAuditLog" (id,"actorType","actorId",action,"targetType","targetId") VALUES
    ('audit-seller','system',$1,'SELLER_REFUND_RECORDED','ORDER',$2),
    ('audit-case','system',$1,'CASE_SELLER_REFUND_APPLIED','CASE',$3),
    ('audit-signed','webhook',$4,'STRIPE_REFUND_RECORDED','ORDER',$2)`,
  [value.sellerUserId, value.orderId, value.caseId, value.signedEventId]);
}

test("seller refund fixture is exact, provable and removable while retaining canary and webhook lease", async () => {
  const db = await database();
  const value = state();
  try {
    await createFixtures(db, value);
    await seedOutcome(db, value);
    const proven = assertProofSnapshot(await readProofSnapshot(db, value), value);
    assert.equal(proven.paymentCount, 2);
    await cleanupExactRows(db, value);
    assert.deepEqual(assertCleanupSnapshot(await readCleanupSnapshot(db, value)), {
      buyerCount: 0, sellerCount: 0, listingCount: 0, orderCount: 0, itemCount: 0,
      caseCount: 0, caseMessageCount: 0, paymentCount: 0, notificationCount: 0, outboxCount: 0,
      webhookCount: 1, processedWebhookCount: 1, canaryCount: 1,
    });
  } finally {
    await db.close();
  }
});

test("production-equivalent deferred opening invariant rejects a Case without its opening message", async () => {
  const db = await database();
  const value = state();
  try {
    await db.query("BEGIN");
    await db.query(`INSERT INTO public."User" (id, "clerkId", email, name, role, "updatedAt")
      VALUES ($1, $2, $3, 'Missing opening buyer', 'USER', CURRENT_TIMESTAMP)`,
    [value.buyerId, value.buyerClerkId, value.buyerEmail]);
    await db.query(`INSERT INTO public."Order" (id, "buyerId") VALUES ('missing-opening-order', $1)`,
      [value.buyerId]);
    await db.query(`INSERT INTO public."Case" (
      id, "orderId", "buyerId", "sellerId", reason, description, status, "sellerRespondBy", "updatedAt"
    ) VALUES ($1, 'missing-opening-order', $2, $2, 'OTHER', 'Missing opening proof', 'OPEN',
      CURRENT_TIMESTAMP + INTERVAL '48 hours', CURRENT_TIMESTAMP)`, [value.caseId, value.buyerId]);
    await assert.rejects(db.query("COMMIT"), /Case has no human or durable webhook opening evidence/);
    await db.query("ROLLBACK").catch(() => {});
  } finally {
    await db.close();
  }
});

test("fixture and cleanup fail closed on collisions or marker drift", async () => {
  const db = await database();
  const value = state();
  try {
    await createFixtures(db, value);
    await createFixtures(db, value);
    await db.query(`UPDATE public."CaseMessage" SET body='not-opening-evidence' WHERE "caseId"=$1`, [value.caseId]);
    await assert.rejects(createFixtures(db, value), /fixture identity collided/);
    await db.query(`UPDATE public."CaseMessage"
      SET body='Disposable opening evidence for the seller refund production proof.' WHERE "caseId"=$1`, [value.caseId]);
    await db.query(`UPDATE public."Listing" SET title='not-the-marker' WHERE id=$1`, [value.listingId]);
    await assert.rejects(createFixtures(db, value), /fixture identity collided/);
    await db.query(`UPDATE public."Listing" SET title='seller-refund-production-proof' WHERE id=$1`, [value.listingId]);
    await seedOutcome(db, value);
    await db.query(`UPDATE public."CaseMessage" SET body='not-opening-evidence' WHERE "caseId"=$1`, [value.caseId]);
    await assert.rejects(cleanupExactRows(db, value), /cleanup opening_message relationship drifted/);
    await db.query(`UPDATE public."CaseMessage"
      SET body='Disposable opening evidence for the seller refund production proof.' WHERE "caseId"=$1`, [value.caseId]);
    await db.query(`UPDATE public."Listing" SET title='not-the-marker' WHERE id=$1`, [value.listingId]);
    await assert.rejects(cleanupExactRows(db, value), /cleanup listing relationship drifted/);
    const retained = await db.query(`SELECT (SELECT count(*)::integer FROM public."Order") AS orders,
      (SELECT count(*)::integer FROM public."OrderPaymentEvent") AS payments`);
    assert.deepEqual(retained.rows[0], { orders: 1, payments: 2 });
  } finally {
    await db.close();
  }
});
