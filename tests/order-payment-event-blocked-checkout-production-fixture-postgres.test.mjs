import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  assertCleanupSnapshot,
  assertDeliverySnapshot,
  blockFixtureSeller,
  cleanupDeliveredRows,
  cleanupUnpaidFixtures,
  convergeFixtureSellerConnectIdentity,
  createFixtures,
  DISPOSABLE_SELLER_CONTROLLER_SUMMARY,
  readCleanupSnapshot,
  readDeliverySnapshot,
  reopenFixtureSellerForPaymentRenewal,
} from "../scripts/order-payment-event-blocked-checkout-production-proof.mjs";

function state() {
  return {
    buyerId: "opebc_buyer",
    buyerClerkId: "user_canary",
    buyerEmail: "canary@example.com",
    originalNotificationPreferences: { EMAIL_REFUND_ISSUED: true },
    originalTermsAcceptedAt: "2026-06-14T00:00:00.000Z",
    originalTermsVersion: "2026-06-14",
    originalAgeAttestedAt: "2026-06-14T00:00:00.000Z",
    sellerUserId: "opebc_seller_user",
    sellerClerkId: "opebc_seller_clerk",
    sellerEmail: "opebc_seller@example.invalid",
    sellerProfileId: "opebc_seller",
    listingId: "opebc_listing",
    stripeAccountId: "acct_fixture",
    stripeSessionId: "cs_test_fixture",
    checkoutLockKey: "checkout:single:opebc_buyer:listing:opebc_listing",
    reservationId: "reservation_fixture",
    priorExpiredCheckoutCount: 2,
    checkoutEventId: "evt_checkout_fixture",
    orderId: "order_fixture",
    orderItemId: "item_fixture",
    paymentIntentId: "pi_fixture",
    chargeId: "ch_fixture",
    transferId: "tr_fixture",
    chargeAmountCents: 540,
    refundId: "re_fixture",
    refundAmountCents: 540,
    transferReversalId: "trr_fixture",
    refundEventId: "evt_refund_fixture",
    localPaymentEventId: "payment_local",
    signedPaymentEventId: "payment_signed",
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
      "termsAcceptedAt" timestamp, "termsVersion" varchar(50), "ageAttestedAt" timestamp,
      "deletedAt" timestamp, banned boolean NOT NULL DEFAULT false,
      "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp NOT NULL
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY, "userId" text NOT NULL UNIQUE REFERENCES public."User"(id) ON DELETE CASCADE,
      "displayName" varchar(100) NOT NULL, "displayNameNormalized" varchar(100) NOT NULL,
      "stripeAccountId" varchar(255) UNIQUE, "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountVersion" varchar(20), "stripeControllerType" varchar(100),
      "vacationMode" boolean NOT NULL DEFAULT false, "acceptingNewOrders" boolean NOT NULL DEFAULT true,
      "allowLocalPickup" boolean NOT NULL DEFAULT false,
      "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp NOT NULL
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY, "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id) ON DELETE RESTRICT,
      title varchar(150) NOT NULL, description varchar(5000) NOT NULL, "priceCents" integer NOT NULL,
      currency varchar(3) NOT NULL DEFAULT 'usd', status text NOT NULL, "listingType" text NOT NULL,
      "stockQuantity" integer, "shipsWithinDays" integer, "isPrivate" boolean NOT NULL DEFAULT false,
      "reservedForUserId" text REFERENCES public."User"(id) ON DELETE SET NULL,
      "packagedWeightGrams" integer, "packagedLengthCm" double precision, "packagedWidthCm" double precision,
      "packagedHeightCm" double precision, "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp NOT NULL
    );
    CREATE TABLE public."CheckoutStockReservation" (
      id text PRIMARY KEY, "checkoutLockKey" varchar(255) NOT NULL, "payloadHash" varchar(64) NOT NULL DEFAULT 'hash',
      "buyerId" varchar(191), "sellerId" varchar(191), "stripeSessionId" varchar(255) UNIQUE,
      status varchar(32) NOT NULL, "reservedItems" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "restoredAt" timestamp, "restoreReason" varchar(100), "repairGeneration" bigint NOT NULL DEFAULT 0,
      "repairClaimedAt" timestamp, "repairClaimKind" varchar(32), "lastRepairError" varchar(100),
      "lastRepairAttemptAt" timestamp,
      "expiresAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY, "buyerId" text REFERENCES public."User"(id) ON DELETE SET NULL,
      "sellerProfileId" text REFERENCES public."SellerProfile"(id) ON DELETE RESTRICT,
      "stripeSessionId" varchar(255) UNIQUE, "stripePaymentIntentId" varchar(255), "stripeChargeId" varchar(255),
      "stripeTransferId" varchar(255), currency varchar(3) NOT NULL DEFAULT 'usd',
      "itemsSubtotalCents" integer NOT NULL DEFAULT 0, "shippingAmountCents" integer NOT NULL DEFAULT 0,
      "taxAmountCents" integer NOT NULL DEFAULT 0, "sellerRefundId" varchar(255), "sellerRefundAmountCents" integer,
      "refundClaimId" varchar(255), "refundClaimGeneration" bigint NOT NULL DEFAULT 0,
      "refundClaimSource" varchar(32), "refundClaimSourceId" varchar(255), "refundClaimIdempotencyScope" varchar(191),
      "refundClaimProviderAuthorizedAt" timestamp, "reviewNeeded" boolean NOT NULL DEFAULT false,
      "reviewNote" varchar(10000), "paidAt" timestamp, "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."OrderItem" (
      id text PRIMARY KEY, "orderId" text NOT NULL REFERENCES public."Order"(id) ON DELETE CASCADE,
      "listingId" text NOT NULL REFERENCES public."Listing"(id) ON DELETE RESTRICT,
      "sellerProfileId" text REFERENCES public."SellerProfile"(id) ON DELETE RESTRICT,
      quantity integer NOT NULL, "priceCents" integer NOT NULL, "listingSnapshot" jsonb
    );
    CREATE TABLE public."StripeWebhookEvent" (
      id varchar(255) PRIMARY KEY, type varchar(100) NOT NULL, "sourceObjectId" varchar(255),
      "claimGeneration" bigint NOT NULL DEFAULT 1, "processedAt" timestamp, "lastError" varchar(2000)
    );
    CREATE TABLE public."OrderPaymentEvent" (
      id text PRIMARY KEY, "orderId" text NOT NULL REFERENCES public."Order"(id) ON DELETE RESTRICT,
      "stripeEventId" varchar(255) NOT NULL UNIQUE, "stripeObjectId" varchar(255), "stripeObjectType" varchar(100),
      "eventType" varchar(100) NOT NULL, "amountCents" integer, currency varchar(3) NOT NULL, status varchar(100),
      reason varchar(255), metadata jsonb
    );
    CREATE TABLE public."Notification" (
      id text PRIMARY KEY, "userId" text NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
      "relatedUserId" text, type text NOT NULL, "sourceType" varchar(80), "sourceId" varchar(191)
    );
    CREATE TABLE public."EmailOutbox" (
      id text PRIMARY KEY, "userId" varchar(191), "preferenceKey" varchar(80), "templateName" varchar(80),
      "sourceType" varchar(80), "sourceId" varchar(191), "dedupKey" varchar(128) UNIQUE, status varchar(20) NOT NULL
    );
    CREATE TABLE public."SystemAuditLog" (
      id text PRIMARY KEY, "actorType" varchar(40) NOT NULL, "actorId" varchar(255), action varchar(100) NOT NULL,
      "targetType" varchar(100) NOT NULL, "targetId" varchar(255) NOT NULL
    );
  `);
  const value = state();
  await db.query(`INSERT INTO public."User" (id,"clerkId",email,name,role,"notificationPreferences",
    "termsAcceptedAt","termsVersion","ageAttestedAt","updatedAt")
    VALUES ($1,$2,$3,'Operational Canary','USER',$4::jsonb,$5::timestamp,$6,$7::timestamp,CURRENT_TIMESTAMP)`,
  [value.buyerId, value.buyerClerkId, value.buyerEmail, JSON.stringify(value.originalNotificationPreferences),
    value.originalTermsAcceptedAt, value.originalTermsVersion, value.originalAgeAttestedAt]);
  return db;
}

async function seedOutcome(db, value) {
  await db.query(`UPDATE public."SellerProfile" SET "vacationMode"=true WHERE id=$1`, [value.sellerProfileId]);
  await db.query(`UPDATE public."Listing" SET "stockQuantity"=1,status='ACTIVE' WHERE id=$1`, [value.listingId]);
  await db.query(`INSERT INTO public."CheckoutStockReservation" (
    id,"checkoutLockKey","payloadHash","buyerId","sellerId","stripeSessionId",status,"reservedItems","restoredAt","restoreReason")
    VALUES
      ('reservation_expired_1',$2,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',$3,$4,'cs_test_expired_1','RESTORED',$6::jsonb,
        CURRENT_TIMESTAMP,'stripe_session_expired'),
      ('reservation_expired_2',$2,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',$3,$4,'cs_test_expired_2','RESTORED',$6::jsonb,
        CURRENT_TIMESTAMP,'stripe_session_expired'),
      ($1,$2,'cccccccccccccccccccccccccccccccc',$3,$4,$5,'COMPLETED',$6::jsonb,NULL,NULL)`,
  [value.reservationId, value.checkoutLockKey, value.buyerId, value.sellerProfileId, value.stripeSessionId,
    JSON.stringify([{ listingId: value.listingId, quantity: 1, sellerId: value.sellerProfileId }])]);
  await db.query(`INSERT INTO public."Order" (
    id,"buyerId","sellerProfileId","stripeSessionId","stripePaymentIntentId","stripeChargeId","stripeTransferId",
    "itemsSubtotalCents","shippingAmountCents","taxAmountCents","sellerRefundId","sellerRefundAmountCents",
    "refundClaimGeneration","reviewNeeded","reviewNote","paidAt")
    VALUES ($1,$2,$3,$4,$5,$6,$7,500,0,40,$8,540,1,true,
      'Seller entered vacation mode before payment completion. Order was held for staff review.',CURRENT_TIMESTAMP)`,
  [value.orderId, value.buyerId, value.sellerProfileId, value.stripeSessionId, value.paymentIntentId,
    value.chargeId, value.transferId, value.refundId]);
  await db.query(`INSERT INTO public."OrderItem" (id,"orderId","listingId","sellerProfileId",quantity,"priceCents","listingSnapshot")
    VALUES ($1,$2,$3,$4,1,500,'{}'::jsonb)`,
  [value.orderItemId, value.orderId, value.listingId, value.sellerProfileId]);
  await db.query(`INSERT INTO public."StripeWebhookEvent" (id,type,"sourceObjectId","claimGeneration","processedAt") VALUES
    ($1,'checkout.session.completed',$2,1,CURRENT_TIMESTAMP),($3,'charge.refunded',$4,1,CURRENT_TIMESTAMP)`,
  [value.checkoutEventId, value.stripeSessionId, value.refundEventId, value.chargeId]);
  await db.query(`INSERT INTO public."OrderPaymentEvent" (
    id,"orderId","stripeEventId","stripeObjectId","stripeObjectType","eventType","amountCents",currency,status,reason,metadata) VALUES
    ($1,$3,'local:blocked_checkout_refund_recorded:'||$4,$4,'refund','REFUND',540,'usd','succeeded','blocked_checkout',
      pg_catalog.jsonb_build_object('refundAccounting',pg_catalog.jsonb_build_object(
        'buyerRefundAmountCents',540,'originalTransferAmountCents',475,'transferReversalId',$6::text))),
    ($2,$3,$5,$4,'refund','REFUND',540,'usd','succeeded','local_refund_confirmed',
      pg_catalog.jsonb_build_object('latestRefundId',$4,'totalRefundedCents',540))`,
  [value.localPaymentEventId, value.signedPaymentEventId, value.orderId, value.refundId,
    value.refundEventId, value.transferReversalId]);
  await db.query(`INSERT INTO public."Notification" (id,"userId","relatedUserId",type,"sourceType","sourceId")
    VALUES ($1,$2,NULL,'REFUND_ISSUED','order_payment','local:blocked_checkout_refund_recorded:'||$3)`,
  [value.notificationId, value.buyerId, value.refundId]);
  await db.query(`INSERT INTO public."EmailOutbox" (id,"userId","preferenceKey","templateName","sourceType","sourceId","dedupKey",status)
    VALUES ($1,$2,'EMAIL_REFUND_ISSUED','refund_issued','order_payment','local:blocked_checkout_refund_recorded:'||$3,$4,'SKIPPED')`,
  [value.emailOutboxId, value.buyerId, value.refundId, `refund-issued:local:blocked_checkout_refund_recorded:${value.refundId}`]);
  await db.query(`INSERT INTO public."SystemAuditLog" (id,"actorType","actorId",action,"targetType","targetId") VALUES
    ('audit-checkout','webhook',$1,'STRIPE_CHECKOUT_ORDER_CREATED','ORDER',$3),
    ('audit-local','webhook',$1,'BLOCKED_CHECKOUT_REFUND_RECORDED','ORDER',$3),
    ('audit-refund','webhook',$2,'STRIPE_REFUND_RECORDED','ORDER',$3)`,
  [value.checkoutEventId, value.refundEventId, value.orderId]);
}

async function seedExpiredPaymentAttempts(db, value) {
  const items = JSON.stringify([{
    listingId: value.listingId,
    quantity: 1,
    sellerId: value.sellerProfileId,
  }]);
  await db.query(`
    INSERT INTO public."CheckoutStockReservation" (
      id,"checkoutLockKey","payloadHash","buyerId","sellerId","stripeSessionId",
      status,"reservedItems","restoredAt","restoreReason"
    ) VALUES
      ('reservation_expired_1',$2,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',$3,$4,
        'cs_test_expired_1','RESTORED',$6::jsonb,CURRENT_TIMESTAMP,'stripe_session_expired'),
      ('reservation_expired_2',$2,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',$3,$4,
        'cs_test_expired_2','RESTORED',$6::jsonb,CURRENT_TIMESTAMP,'stripe_session_expired'),
      ($1,$2,'cccccccccccccccccccccccccccccccc',$3,$4,
        $5,'RESTORED',$6::jsonb,CURRENT_TIMESTAMP,'stripe_session_expired')
  `, [
    value.reservationId,
    value.checkoutLockKey,
    value.buyerId,
    value.sellerProfileId,
    value.stripeSessionId,
    items,
  ]);
  return Object.freeze({
    active: null,
    terminalCount: 3,
    terminalReservationIds: Object.freeze([
      "reservation_expired_1",
      "reservation_expired_2",
      value.reservationId,
    ]),
    terminalSessionIds: Object.freeze([
      "cs_test_expired_1",
      "cs_test_expired_2",
      value.stripeSessionId,
    ]),
  });
}

test("blocked-checkout outcome is exact and removable while retaining two signed leases", async () => {
  const db = await database();
  const value = state();
  try {
    await createFixtures(db, value);
    await seedOutcome(db, value);
    const proven = assertDeliverySnapshot(await readDeliverySnapshot(db, value), value);
    assert.equal(proven.wrongNotificationCount, 0);
    await cleanupDeliveredRows(db, value);
    assert.deepEqual(assertCleanupSnapshot(await readCleanupSnapshot(db, value)), {
      seller_user_count: 0, seller_count: 0, listing_count: 0, reservation_count: 0,
      order_count: 0, item_count: 0, payment_count: 0, notification_count: 0, outbox_count: 0,
      webhook_count: 2, processed_webhook_count: 2, canary_count: 1,
    });
  } finally {
    await db.close();
  }
});

test("failed-proof cleanup accepts only its exact historical SOLD_OUT listing shape", async () => {
  const db = await database();
  const value = state();
  try {
    await createFixtures(db, value);
    await seedOutcome(db, value);
    await db.query(`UPDATE public."Listing" SET status='SOLD_OUT' WHERE id=$1`, [value.listingId]);
    await assert.rejects(cleanupDeliveredRows(db, value), /cleanup listing relationship drifted/);
    await assert.rejects(cleanupDeliveredRows(db, value, "DRAFT"), /listing status is unsupported/);
    await cleanupDeliveredRows(db, value, "SOLD_OUT");
    assert.deepEqual(assertCleanupSnapshot(await readCleanupSnapshot(db, value)), {
      seller_user_count: 0, seller_count: 0, listing_count: 0, reservation_count: 0,
      order_count: 0, item_count: 0, payment_count: 0, notification_count: 0, outbox_count: 0,
      webhook_count: 2, processed_webhook_count: 2, canary_count: 1,
    });
  } finally {
    await db.close();
  }
});

test("fixture resume and cleanup reject marker drift without partial deletion", async () => {
  const db = await database();
  const value = state();
  try {
    await createFixtures(db, value);
    await createFixtures(db, value);
    await seedOutcome(db, value);
    await db.query(`UPDATE public."Listing" SET title='wrong-marker' WHERE id=$1`, [value.listingId]);
    await assert.rejects(cleanupDeliveredRows(db, value), /cleanup listing relationship drifted/);
    const retained = await db.query(`SELECT (SELECT count(*)::integer FROM public."Order") AS orders,
      (SELECT count(*)::integer FROM public."OrderPaymentEvent") AS payments`);
    assert.deepEqual(retained.rows[0], { orders: 1, payments: 2 });
  } finally {
    await db.close();
  }
});

test("cleanup rejects expired-attempt history drift and rolls back every deletion", async () => {
  const db = await database();
  const value = state();
  try {
    await createFixtures(db, value);
    await seedOutcome(db, value);
    await db.query(`UPDATE public."CheckoutStockReservation" SET "restoreReason"='unexpected'
      WHERE id='reservation_expired_1'`);
    await assert.rejects(cleanupDeliveredRows(db, value), /prior cleanup reservation drifted/);
    const retained = await db.query(`SELECT
      (SELECT count(*)::integer FROM public."CheckoutStockReservation") AS reservations,
      (SELECT count(*)::integer FROM public."Order") AS orders,
      (SELECT count(*)::integer FROM public."OrderPaymentEvent") AS payments`);
    assert.deepEqual(retained.rows[0], { reservations: 3, orders: 1, payments: 2 });
  } finally {
    await db.close();
  }
});

test("unpaid abort cleanup removes the current and every classified expired reservation", async () => {
  const db = await database();
  const value = state();
  try {
    await createFixtures(db, value);
    await blockFixtureSeller(db, value);
    const items = JSON.stringify([{ listingId: value.listingId, quantity: 1, sellerId: value.sellerProfileId }]);
    await db.query(`INSERT INTO public."CheckoutStockReservation" (
      id,"checkoutLockKey","payloadHash","buyerId","sellerId","stripeSessionId",status,"reservedItems","restoredAt","restoreReason")
      VALUES
        ('reservation_expired_1',$2,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',$3,$4,'cs_test_expired_1','RESTORED',$6::jsonb,
          CURRENT_TIMESTAMP,'stripe_session_expired'),
        ('reservation_expired_2',$2,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',$3,$4,'cs_test_expired_2','RESTORED',$6::jsonb,
          CURRENT_TIMESTAMP,'stripe_session_expired'),
        ($1,$2,'cccccccccccccccccccccccccccccccc',$3,$4,$5,'RESTORED',$6::jsonb,
          CURRENT_TIMESTAMP,'stripe_session_expired')`,
    [value.reservationId, value.checkoutLockKey, value.buyerId, value.sellerProfileId, value.stripeSessionId, items]);
    await cleanupUnpaidFixtures(db, value);
    const removed = await db.query(`SELECT
      (SELECT count(*)::integer FROM public."CheckoutStockReservation") AS reservations,
      (SELECT count(*)::integer FROM public."Listing") AS listings,
      (SELECT count(*)::integer FROM public."SellerProfile") AS sellers,
      (SELECT count(*)::integer FROM public."User" WHERE id=$1) AS seller_users`, [value.sellerUserId]);
    assert.deepEqual(removed.rows[0], { reservations: 0, listings: 0, sellers: 0, seller_users: 0 });
  } finally {
    await db.close();
  }
});

test("fixture Connect identity is honest, current-controller bound, and narrowly repairable", async () => {
  const db = await database();
  const value = state();
  try {
    await createFixtures(db, value);
    const created = await db.query(`SELECT "stripeAccountVersion","stripeControllerType" FROM public."SellerProfile" WHERE id=$1`,
      [value.sellerProfileId]);
    assert.deepEqual(created.rows[0], {
      stripeAccountVersion: null,
      stripeControllerType: DISPOSABLE_SELLER_CONTROLLER_SUMMARY,
    });

    await db.query(`UPDATE public."SellerProfile" SET "stripeAccountVersion"='v1',"stripeControllerType"='custom' WHERE id=$1`,
      [value.sellerProfileId]);
    const repaired = await convergeFixtureSellerConnectIdentity(db, value);
    assert.equal(repaired.stripeAccountVersion, null);
    assert.equal(repaired.stripeControllerType, DISPOSABLE_SELLER_CONTROLLER_SUMMARY);

    await db.query(`UPDATE public."SellerProfile" SET "stripeControllerType"='unexpected-controller' WHERE id=$1`,
      [value.sellerProfileId]);
    await assert.rejects(convergeFixtureSellerConnectIdentity(db, value), /Connect identity drifted/);
    const retained = await db.query(`SELECT "stripeControllerType" FROM public."SellerProfile" WHERE id=$1`,
      [value.sellerProfileId]);
    assert.equal(retained.rows[0].stripeControllerType, "unexpected-controller");
  } finally {
    await db.close();
  }
});

test("canary fencing rejects concurrent preference drift without clobber or fixture deletion", async () => {
  const db = await database();
  const value = state();
  try {
    await db.query(
      `UPDATE public."User" SET "termsVersion"='concurrent-change' WHERE id=$1`,
      [value.buyerId],
    );
    await assert.rejects(
      createFixtures(db, value),
      /canary original snapshot drifted/,
    );
    const absentBeforeFence = await db.query(`
      SELECT
        (SELECT count(*)::integer FROM public."SellerProfile" WHERE id=$1) AS sellers,
        (SELECT count(*)::integer FROM public."Listing" WHERE id=$2) AS listings
    `, [value.sellerProfileId, value.listingId]);
    assert.deepEqual(absentBeforeFence.rows[0], { sellers: 0, listings: 0 });
    await db.query(
      `UPDATE public."User" SET "termsVersion"=$2 WHERE id=$1`,
      [value.buyerId, value.originalTermsVersion],
    );
    await createFixtures(db, value);
    await db.query(
      `UPDATE public."User" SET "notificationPreferences"=$2::jsonb WHERE id=$1`,
      [value.buyerId, JSON.stringify(value.originalNotificationPreferences)],
    );
    await assert.rejects(
      createFixtures(db, value),
      /canary proof fence drifted/,
    );
    const retainedAfterResume = await db.query(`
      SELECT
        (SELECT count(*)::integer FROM public."SellerProfile" WHERE id=$1) AS sellers,
        (SELECT count(*)::integer FROM public."Listing" WHERE id=$2) AS listings
    `, [value.sellerProfileId, value.listingId]);
    assert.deepEqual(retainedAfterResume.rows[0], { sellers: 1, listings: 1 });

    await db.query(
      `UPDATE public."User"
          SET "notificationPreferences"=pg_catalog.jsonb_set(
            $2::jsonb, '{EMAIL_REFUND_ISSUED}', 'false'::jsonb, true
          )
        WHERE id=$1`,
      [value.buyerId, JSON.stringify(value.originalNotificationPreferences)],
    );
    await seedOutcome(db, value);
    await db.query(
      `UPDATE public."User" SET "notificationPreferences"=$2::jsonb WHERE id=$1`,
      [value.buyerId, JSON.stringify(value.originalNotificationPreferences)],
    );
    await assert.rejects(
      cleanupDeliveredRows(db, value),
      /canary proof fence drifted/,
    );
    const retainedAfterCleanup = await db.query(`
      SELECT
        (SELECT count(*)::integer FROM public."Order" WHERE id=$1) AS orders,
        (SELECT count(*)::integer FROM public."OrderPaymentEvent" WHERE "orderId"=$1) AS payments
    `, [value.orderId]);
    assert.deepEqual(retainedAfterCleanup.rows[0], { orders: 1, payments: 2 });
  } finally {
    await db.close();
  }
});

test("seller block transition converges after a crash before journal persistence", async () => {
  const db = await database();
  const value = state();
  try {
    await createFixtures(db, value);
    await blockFixtureSeller(db, value);
    await blockFixtureSeller(db, value);
    const result = await db.query(
      `SELECT "vacationMode" FROM public."SellerProfile" WHERE id=$1`,
      [value.sellerProfileId],
    );
    assert.deepEqual(result.rows, [{ vacationMode: true }]);
  } finally {
    await db.close();
  }
});

test("expired payment renewal reopens only the exact locked synthetic seller and is restart-safe", async () => {
  const db = await database();
  const value = state();
  try {
    await createFixtures(db, value);
    await blockFixtureSeller(db, value);
    const history = await seedExpiredPaymentAttempts(db, value);

    await reopenFixtureSellerForPaymentRenewal(db, value, history);
    await reopenFixtureSellerForPaymentRenewal(db, value, history);

    const result = await db.query(`
      SELECT
        (SELECT "vacationMode" FROM public."SellerProfile" WHERE id=$1) AS vacation_mode,
        (SELECT "stockQuantity" FROM public."Listing" WHERE id=$2) AS stock,
        (SELECT count(*)::integer FROM public."CheckoutStockReservation") AS reservations,
        (SELECT count(*)::integer FROM public."Order") AS orders
    `, [value.sellerProfileId, value.listingId]);
    assert.deepEqual(result.rows[0], {
      vacation_mode: false,
      stock: 1,
      reservations: 3,
      orders: 0,
    });
  } finally {
    await db.close();
  }
});

test("expired payment renewal rejects drift and rolls back without reopening the seller", async () => {
  const db = await database();
  const value = state();
  try {
    await createFixtures(db, value);
    await blockFixtureSeller(db, value);
    const history = await seedExpiredPaymentAttempts(db, value);
    await db.query(`UPDATE public."Listing" SET "stockQuantity"=2 WHERE id=$1`, [value.listingId]);

    await assert.rejects(
      reopenFixtureSellerForPaymentRenewal(db, value, history),
      /renewal listing drifted/,
    );

    const retained = await db.query(`
      SELECT
        (SELECT "vacationMode" FROM public."SellerProfile" WHERE id=$1) AS vacation_mode,
        (SELECT count(*)::integer FROM public."CheckoutStockReservation") AS reservations
    `, [value.sellerProfileId]);
    assert.deepEqual(retained.rows[0], { vacation_mode: true, reservations: 3 });
  } finally {
    await db.close();
  }
});
