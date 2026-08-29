import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  assertCleanupSnapshot,
  assertProofSnapshot,
  classifyFixtureSnapshot,
  cleanupExactRows,
  createFixtures,
  readCleanupSnapshot,
  readFixtureSnapshot,
  readProofSnapshot,
} from "../scripts/order-payment-event-case-refund-production-proof.mjs";

function state() {
  return {
    startedAt: "2026-08-29T12:00:00.000Z",
    staffUserId: "opecsr_staff",
    staffClerkId: "user_case_staff",
    sellerUserId: "opecsr_seller",
    sellerClerkId: "opecsr_seller_clerk",
    sellerEmail: "case-refund-seller@example.invalid.thegrainline.com",
    buyerUserId: "opecsr_buyer",
    buyerClerkId: "opecsr_buyer_clerk",
    buyerEmail: "case-refund-buyer@example.invalid.thegrainline.com",
    sellerProfileId: "opecsr_profile",
    listingId: "opecsr_listing",
    orderId: "opecsr_order",
    orderItemId: "opecsr_item",
    caseId: "opecsr_case",
    stripeAccountId: "acct_case_fixture",
    paymentIntentId: "pi_case_fixture",
    chargeId: "ch_case_fixture",
    transferId: "tr_case_fixture",
    refundId: "re_case_fixture",
    transferReversalId: "trr_case_fixture",
    signedEventId: "evt_case_fixture",
    localPaymentEventId: "ope_case_local",
    signedPaymentEventId: "ope_case_signed",
    claimId: "case_resolution_claim_fixture",
    resolutionMessageId: "case_resolution_message_case_resolution_claim_fixture",
    buyerNotificationId: "notification_case_buyer",
    sellerNotificationId: "notification_case_seller",
    emailOutboxId: "outbox_case_fixture",
  };
}

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE TYPE public."Role" AS ENUM ('USER', 'EMPLOYEE', 'ADMIN');
    CREATE TABLE public."User" (
      id text PRIMARY KEY, "clerkId" varchar(255) NOT NULL UNIQUE, email varchar(254) NOT NULL UNIQUE,
      name varchar(100), role public."Role" NOT NULL DEFAULT 'USER',
      "notificationPreferences" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "deletedAt" timestamp(3), banned boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY, "userId" text NOT NULL UNIQUE REFERENCES public."User"(id) ON DELETE CASCADE,
      "displayName" varchar(100) NOT NULL, "displayNameNormalized" varchar(100) NOT NULL,
      "stripeAccountId" varchar(255) UNIQUE, "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountVersion" varchar(20), "stripeControllerType" varchar(100),
      "vacationMode" boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY, "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id) ON DELETE RESTRICT,
      title varchar(150) NOT NULL, description varchar(5000) NOT NULL, "priceCents" integer NOT NULL,
      currency varchar(3) NOT NULL DEFAULT 'usd', status text NOT NULL, "listingType" text NOT NULL,
      "stockQuantity" integer, "shipsWithinDays" integer, "isPrivate" boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY, "buyerId" text REFERENCES public."User"(id) ON DELETE SET NULL,
      "sellerProfileId" text REFERENCES public."SellerProfile"(id) ON DELETE RESTRICT,
      "stripePaymentIntentId" varchar(255) UNIQUE, "stripeChargeId" varchar(255) UNIQUE,
      "stripeTransferId" varchar(255), currency varchar(3) NOT NULL DEFAULT 'usd',
      "itemsSubtotalCents" integer NOT NULL DEFAULT 0, "shippingAmountCents" integer NOT NULL DEFAULT 0,
      "giftWrappingPriceCents" integer, "taxAmountCents" integer NOT NULL DEFAULT 0,
      "paidAt" timestamp(3), "fulfillmentStatus" text NOT NULL DEFAULT 'PENDING',
      "sellerRefundId" varchar(255), "sellerRefundAmountCents" integer,
      "caseResolutionClaimId" text, "reviewNeeded" boolean NOT NULL DEFAULT false,
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
      "buyerId" text REFERENCES public."User"(id) ON DELETE SET NULL,
      "sellerId" text NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
      reason text NOT NULL, description varchar(5000) NOT NULL, status text NOT NULL, resolution text,
      "refundAmountCents" integer, "stripeRefundId" varchar(255), "sellerRespondBy" timestamp(3) NOT NULL,
      "resolvedById" text REFERENCES public."User"(id) ON DELETE SET NULL,
      "resolvedAt" timestamp(3), "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
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
      "stripeEventId" varchar(255) NOT NULL UNIQUE, "stripeObjectId" varchar(255),
      "stripeObjectType" varchar(100), "eventType" varchar(100) NOT NULL, "amountCents" integer,
      currency varchar(3) NOT NULL, status varchar(100), reason varchar(255), metadata jsonb
    );
    CREATE TABLE public."CaseResolutionClaim" (
      id text PRIMARY KEY, "caseId" text NOT NULL REFERENCES public."Case"(id) ON DELETE RESTRICT,
      "orderId" text NOT NULL REFERENCES public."Order"(id) ON DELETE RESTRICT,
      "staffActorId" text NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
      status text NOT NULL, "orderPaymentEventId" text REFERENCES public."OrderPaymentEvent"(id) ON DELETE RESTRICT
    );
    CREATE TABLE public."Notification" (
      id text PRIMARY KEY, "userId" text NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
      "relatedUserId" text, type text NOT NULL, "sourceType" varchar(80), "sourceId" varchar(191)
    );
    CREATE TABLE public."EmailOutbox" (
      id text PRIMARY KEY, "userId" varchar(191), "preferenceKey" varchar(80), "sourceType" varchar(80),
      "sourceId" varchar(191), status varchar(20) NOT NULL
    );
    CREATE TABLE public."AdminAuditLog" (
      id text PRIMARY KEY, "adminId" text NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
      action varchar(100) NOT NULL, "targetType" varchar(100) NOT NULL, "targetId" varchar(255) NOT NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."SystemAuditLog" (
      id text PRIMARY KEY, "actorType" varchar(40) NOT NULL, "actorId" varchar(255), action varchar(100) NOT NULL,
      "targetType" varchar(100) NOT NULL, "targetId" varchar(255) NOT NULL
    );
  `);
  const value = state();
  await db.query(`INSERT INTO public."User" (id,"clerkId",email,name,role,"updatedAt")
    VALUES ($1,$2,'canary@example.invalid','Operational Canary','USER',CURRENT_TIMESTAMP)`,
  [value.staffUserId, value.staffClerkId]);
  const query = db.query.bind(db);
  db.query = async (sql, parameters) => {
    try {
      return await query(sql, parameters);
    } catch (error) {
      error.message = `${error.message} [fixture SQL: ${String(sql).replace(/\s+/g, " ").trim().slice(0, 96)}]`;
      throw error;
    }
  };
  return db;
}

async function seedOutcome(db, value) {
  await db.query(`UPDATE public."Order" SET "sellerRefundId"=$2,"sellerRefundAmountCents"=500,
    "reviewNeeded"=true,"caseResolutionClaimId"=NULL WHERE id=$1`, [value.orderId, value.refundId]);
  await db.query(`UPDATE public."Listing" SET "stockQuantity"=1,status='ACTIVE' WHERE id=$1`, [value.listingId]);
  await db.query(`UPDATE public."Case" SET status='RESOLVED',resolution='REFUND_FULL',"refundAmountCents"=500,
    "stripeRefundId"=$2,"resolvedById"=$3,"resolvedAt"=CURRENT_TIMESTAMP WHERE id=$1`,
  [value.caseId, value.refundId, value.staffUserId]);
  await db.query(`INSERT INTO public."StripeWebhookEvent" (id,type,"sourceObjectId","claimGeneration","processedAt")
    VALUES ($1,'charge.refunded',$2,1,CURRENT_TIMESTAMP)`, [value.signedEventId, value.chargeId]);
  await db.query(`INSERT INTO public."OrderPaymentEvent" (id,"orderId","stripeEventId","stripeObjectId","stripeObjectType","eventType","amountCents",currency,status,reason,metadata) VALUES
    ($1,$3,'local:case_refund_recorded:'||$4,$4,'refund','REFUND',500,'usd','succeeded','case_resolution_refund',
      pg_catalog.jsonb_build_object('resolutionClaimId',$6::text,'transferReversalId',$7::text,'transferReversalAmountCents',475)),
    ($2,$3,$5,$4,'refund','REFUND',500,'usd','succeeded','local_refund_confirmed',
      pg_catalog.jsonb_build_object('latestRefundId',$4,'totalRefundedCents',500))`,
  [value.localPaymentEventId, value.signedPaymentEventId, value.orderId, value.refundId,
    value.signedEventId, value.claimId, value.transferReversalId]);
  await db.query(`INSERT INTO public."CaseResolutionClaim" (id,"caseId","orderId","staffActorId",status,"orderPaymentEventId")
    VALUES ($1,$2,$3,$4,'FINALIZED',$5)`,
  [value.claimId, value.caseId, value.orderId, value.staffUserId, value.localPaymentEventId]);
  await db.query(`INSERT INTO public."CaseMessage" (id,"caseId","authorId","authorKind",body)
    VALUES ($1,$2,$3,'STAFF','Grainline resolved this case with a full refund to the buyer.')`,
  [value.resolutionMessageId, value.caseId, value.staffUserId]);
  await db.query(`INSERT INTO public."Notification" (id,"userId","relatedUserId",type,"sourceType","sourceId") VALUES
    ($1,$3,$5,'REFUND_ISSUED','case',$6),
    ($2,$4,$5,'CASE_MESSAGE','case_message',$7)`,
  [value.buyerNotificationId, value.sellerNotificationId, value.buyerUserId, value.sellerUserId,
    value.staffUserId, value.caseId, value.resolutionMessageId]);
  await db.query(`INSERT INTO public."EmailOutbox" (id,"userId","preferenceKey","sourceType","sourceId",status)
    VALUES ($1,$2,'EMAIL_REFUND_ISSUED','case',$3,'SKIPPED')`,
  [value.emailOutboxId, value.buyerUserId, value.caseId]);
  await db.query(`INSERT INTO public."AdminAuditLog" (id,"adminId",action,"targetType","targetId","createdAt") VALUES
    ('audit-pin',$1::text,'ADMIN_PIN_VERIFY_OK','USER',$1::text,'2026-08-29T12:01:00Z'),
    ('audit-resolve',$1,'RESOLVE_CASE','CASE',$2,'2026-08-29T12:02:00Z')`,
  [value.staffUserId, value.caseId]);
  await db.query(`INSERT INTO public."SystemAuditLog" (id,"actorType","actorId",action,"targetType","targetId") VALUES
    ('audit-local','user',$1,'CASE_REFUND_RECORDED','ORDER',$2),
    ('audit-signed','webhook',$3,'STRIPE_REFUND_RECORDED','ORDER',$2)`,
  [value.staffUserId, value.orderId, value.signedEventId]);
}

test("staff Case refund fixtures, effects and cleanup are exact in real PostgreSQL", async () => {
  const db = await database();
  const value = state();
  try {
    assert.equal(classifyFixtureSnapshot(await readFixtureSnapshot(db, value)), "absent");
    await createFixtures(db, value);
    assert.equal(classifyFixtureSnapshot(await readFixtureSnapshot(db, value)), "complete");
    await seedOutcome(db, value);
    const proof = assertProofSnapshot(await readProofSnapshot(db, value), value);
    assert.equal(proof.claimId, value.claimId);
    await cleanupExactRows(db, value);
    const cleanup = assertCleanupSnapshot(await readCleanupSnapshot(db, value));
    assert.equal(cleanup.processedWebhookCount, 1);
    assert.equal(cleanup.pinAuditCount, 1);
    assert.equal(cleanup.canaryCount, 1);
  } finally {
    await db.close();
  }
});

test("staff Case refund cleanup rolls back completely on marker drift", async () => {
  const db = await database();
  const value = state();
  try {
    await createFixtures(db, value);
    await seedOutcome(db, value);
    await db.query(`UPDATE public."Listing" SET title='wrong-marker' WHERE id=$1`, [value.listingId]);
    await assert.rejects(cleanupExactRows(db, value), /cleanup listing drifted/);
    const retained = await db.query(`SELECT
      (SELECT count(*)::integer FROM public."Order") AS orders,
      (SELECT count(*)::integer FROM public."OrderPaymentEvent") AS payments,
      (SELECT count(*)::integer FROM public."CaseResolutionClaim") AS claims`);
    assert.deepEqual(retained.rows[0], { orders: 1, payments: 2, claims: 1 });
  } finally {
    await db.close();
  }
});
