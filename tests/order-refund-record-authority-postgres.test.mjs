import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const claimMigration = readFileSync(
  "prisma/migrations/20260824010000_prepare_order_refund_claim_generation/migration.sql",
  "utf8",
);
const recordMigration = readFileSync(
  "prisma/migrations/20260824020000_prepare_order_refund_record_authority/migration.sql",
  "utf8",
);
const reconciliationMigration = readFileSync(
  "prisma/migrations/20260824040000_prepare_order_refund_reconciliation_authority/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TYPE public."Role" AS ENUM ('USER', 'EMPLOYEE', 'ADMIN');
    CREATE TYPE public."ListingStatus" AS ENUM (
      'DRAFT', 'ACTIVE', 'SOLD', 'SOLD_OUT', 'HIDDEN',
      'PENDING_REVIEW', 'REJECTED'
    );
    CREATE TYPE public."ListingType" AS ENUM ('MADE_TO_ORDER', 'IN_STOCK');
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      role public."Role" NOT NULL DEFAULT 'USER',
      "deletedAt" timestamp(3) without time zone,
      banned boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "manualStripeReconciliationNeeded" boolean NOT NULL DEFAULT false,
      "manualStripeReconciliationNote" text,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."StripeWebhookEvent" (
      id varchar(255) PRIMARY KEY,
      type varchar(100) NOT NULL,
      "sourceObjectId" varchar(255),
      "claimGeneration" bigint NOT NULL DEFAULT 0,
      "processingStartedAt" timestamp(3) without time zone,
      "processedAt" timestamp(3) without time zone,
      "lastError" text,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "buyerId" text,
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
      "fulfillmentStatus" text NOT NULL DEFAULT 'PENDING',
      "reviewNeeded" boolean NOT NULL DEFAULT false,
      "reviewNote" text
    );
    CREATE TABLE public."OrderPaymentEvent" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id),
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
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      "listingType" public."ListingType" NOT NULL,
      "stockQuantity" integer,
      status public."ListingStatus" NOT NULL,
      "isPrivate" boolean NOT NULL DEFAULT false,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."OrderItem" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id),
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      quantity integer NOT NULL
    );
    CREATE TABLE public."CaseSellerRefundApplication" (
      "paymentEventId" text PRIMARY KEY,
      action varchar(10) NOT NULL
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
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."AdminAuditLog" (
      id text PRIMARY KEY,
      "adminId" text NOT NULL REFERENCES public."User"(id),
      action varchar(100) NOT NULL,
      "targetType" varchar(100) NOT NULL,
      "targetId" varchar(255) NOT NULL,
      reason varchar(1000),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      undone boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE FUNCTION public.grainline_case_seller_refund_apply(
      p_actor_user_id text,
      p_order_payment_event_id text
    )
    RETURNS TABLE (
      "caseId" text,
      "orderId" text,
      "sellerUserId" text,
      "buyerUserId" text,
      "paymentEventId" text,
      action text
    )
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
      SELECT
        NULL::text,
        payment_event."orderId",
        p_actor_user_id,
        orders."buyerId",
        payment_event.id,
        'no_case'::text
      FROM public."OrderPaymentEvent" AS payment_event
      JOIN public."Order" AS orders ON orders.id = payment_event."orderId"
      WHERE payment_event.id = p_order_payment_event_id
    $$;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Order"
      TO grainline_app_runtime;
  `);
  await database.exec(claimMigration);
  await database.exec(recordMigration);
  await database.exec(reconciliationMigration);
  await database.exec(`
    INSERT INTO public."User" (id, role) VALUES
      ('seller-user', 'USER'),
      ('buyer-user', 'USER'),
      ('admin-user', 'ADMIN');
    INSERT INTO public."SellerProfile" (id, "userId")
      VALUES ('seller-profile', 'seller-user');
  `);
  return database;
}

async function seedOrder(database, {
  id,
  sessionId = null,
  transferId = "tr_test",
  listingId = `${id}-listing`,
} = {}) {
  await database.query(`
    INSERT INTO public."Listing" (
      id, "sellerId", "listingType", "stockQuantity", status
    ) VALUES ($1, 'seller-profile', 'IN_STOCK', 0, 'SOLD_OUT')
  `, [listingId]);
  await database.query(`
    INSERT INTO public."Order" (
      id, "buyerId", "sellerProfileId", "paidAt", "stripeSessionId",
      "stripePaymentIntentId", "stripeTransferId", currency,
      "itemsSubtotalCents", "shippingAmountCents",
      "giftWrappingPriceCents", "taxAmountCents"
    ) VALUES (
      $1, 'buyer-user', 'seller-profile', CURRENT_TIMESTAMP, $2,
      $3, $4, 'usd', 1000, 200, 50, 75
    )
  `, [id, sessionId, `pi_${id}`, transferId]);
  await database.query(`
    INSERT INTO public."OrderItem" (id, "orderId", "listingId", quantity)
    VALUES ($1, $2, $3, 2)
  `, [`${id}-item`, id, listingId]);
  return listingId;
}

async function sellerClaim(database, orderId) {
  return (await database.query(`
    SELECT public.grainline_seller_refund_claim('seller-user', $1) AS claim
  `, [orderId])).rows[0].claim;
}

async function sellerRecord(database, claim) {
  return (await database.query(`
    SELECT public.grainline_seller_refund_record(
      'seller-user', $1, $2, 're_seller', 'succeeded', 'trr_seller', 1200
    ) AS result
  `, [claim.claimId, claim.claimGeneration])).rows[0].result;
}

async function blockedClaim(database, {
  eventId,
  eventGeneration,
  sessionId,
  orderId,
}) {
  return (await database.query(`
    SELECT public.grainline_blocked_checkout_refund_claim_resume(
      $1, $2, $3, $4, 1325
    ) AS claim
  `, [eventId, eventGeneration, sessionId, orderId])).rows[0].claim;
}

test("fixed seller refund record atomically finalizes payment, stock, audit, and replay", async () => {
  const database = await createDatabase();
  try {
    const listingId = await seedOrder(database, { id: "order-seller" });
    const claim = await sellerClaim(database, "order-seller");
    const recorded = await sellerRecord(database, claim);
    assert.equal(recorded.action, "recorded");
    assert.equal(recorded.caseAction, "no_case");
    assert.equal(recorded.restoredActiveListingCount, 1);

    const order = (await database.query(`
      SELECT
        "sellerRefundId", "sellerRefundAmountCents", "refundClaimId",
        "sellerRefundLockedAt", "reviewNeeded"
      FROM public."Order" WHERE id = 'order-seller'
    `)).rows[0];
    assert.deepEqual(order, {
      sellerRefundId: "re_seller",
      sellerRefundAmountCents: 1325,
      refundClaimId: null,
      sellerRefundLockedAt: null,
      reviewNeeded: true,
    });
    const listing = (await database.query(`
      SELECT "stockQuantity", status::text AS status
      FROM public."Listing" WHERE id = $1
    `, [listingId])).rows[0];
    assert.deepEqual(listing, { stockQuantity: 2, status: "ACTIVE" });
    const evidence = (await database.query(`
      SELECT metadata, reason
      FROM public."OrderPaymentEvent"
      WHERE "stripeEventId" = 'local:seller_refund_recorded:re_seller'
    `)).rows[0];
    assert.equal(evidence.reason, "seller_refund");
    assert.equal(evidence.metadata.restoredActiveListingCount, 1);
    assert.equal(
      evidence.metadata.notificationBody,
      "Your maker issued a refund of 13.25 USD for your order.",
    );
    assert.equal(
      (await database.query(`
        SELECT count(*)::integer AS count FROM public."SystemAuditLog"
        WHERE action = 'SELLER_REFUND_RECORDED'
      `)).rows[0].count,
      1,
    );

    await database.exec(`UPDATE public."User" SET banned = true WHERE id = 'seller-user'`);
    const replay = await sellerRecord(database, claim);
    assert.equal(replay.action, "replay");
    assert.equal(replay.paymentEventId, recorded.paymentEventId);
    assert.equal(replay.restoredActiveListingCount, 1);
    assert.deepEqual(
      (await database.query(`
        SELECT "stockQuantity", status::text AS status
        FROM public."Listing" WHERE id = $1
      `, [listingId])).rows[0],
      { stockQuantity: 2, status: "ACTIVE" },
    );
  } finally {
    await database.close();
  }
});

test("blocked-checkout claim hands off to a later signed lease and records once", async () => {
  const database = await createDatabase();
  try {
    const listingId = await seedOrder(database, {
      id: "order-blocked",
      sessionId: "cs_blocked",
      transferId: null,
    });
    await database.exec(`
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES (
        'evt_blocked', 'checkout.session.completed', 'cs_blocked', 1,
        CURRENT_TIMESTAMP
      )
    `);
    const firstClaim = await blockedClaim(database, {
      eventId: "evt_blocked",
      eventGeneration: 1,
      sessionId: "cs_blocked",
      orderId: "order-blocked",
    });
    await database.exec(`
      UPDATE public."StripeWebhookEvent"
         SET "claimGeneration" = 2,
             "processingStartedAt" = CURRENT_TIMESTAMP
       WHERE id = 'evt_blocked'
    `);
    const resumedClaim = await blockedClaim(database, {
      eventId: "evt_blocked",
      eventGeneration: 2,
      sessionId: "cs_blocked",
      orderId: "order-blocked",
    });
    assert.equal(resumedClaim.action, "replay");
    assert.equal(resumedClaim.claimId, firstClaim.claimId);
    assert.equal(
      (await database.query(`
        SELECT "refundClaimSourceGeneration" AS generation
        FROM public."Order" WHERE id = 'order-blocked'
      `)).rows[0].generation,
      2,
    );
    await database.exec(`
      UPDATE public."StripeWebhookEvent"
         SET "processingStartedAt" = NULL
       WHERE id = 'evt_blocked'
    `);
    await assert.rejects(
      blockedClaim(database, {
        eventId: "evt_blocked",
        eventGeneration: 2,
        sessionId: "cs_blocked",
        orderId: "order-blocked",
      }),
      /source lease is invalid/,
    );
    await database.exec(`
      UPDATE public."StripeWebhookEvent"
         SET "processingStartedAt" = CURRENT_TIMESTAMP
       WHERE id = 'evt_blocked'
    `);

    const recorded = (await database.query(`
      SELECT public.grainline_blocked_checkout_refund_record(
        'evt_blocked', 2, $1, $2, 're_blocked', 'succeeded', NULL, NULL
      ) AS result
    `, [resumedClaim.claimId, resumedClaim.claimGeneration])).rows[0].result;
    assert.equal(recorded.action, "recorded");
    assert.equal(recorded.restoredActiveListingCount, 1);
    await database.exec(`
      UPDATE public."StripeWebhookEvent"
         SET "processedAt" = CURRENT_TIMESTAMP
       WHERE id = 'evt_blocked'
    `);
    const replay = (await database.query(`
      SELECT public.grainline_blocked_checkout_refund_record(
        'evt_blocked', 2, $1, $2, 're_blocked', 'succeeded', NULL, NULL
      ) AS result
    `, [resumedClaim.claimId, resumedClaim.claimGeneration])).rows[0].result;
    assert.equal(replay.action, "replay");
    assert.equal(replay.restoredActiveListingCount, 1);
    assert.deepEqual(
      (await database.query(`
        SELECT "stockQuantity", status::text AS status
        FROM public."Listing" WHERE id = $1
      `, [listingId])).rows[0],
      { stockQuantity: 2, status: "ACTIVE" },
    );
  } finally {
    await database.close();
  }
});

test("reviewed blocked-checkout recovery finalizes after the failed webhook lease is cleared", async () => {
  const database = await createDatabase();
  try {
    await seedOrder(database, {
      id: "order-blocked-reconciliation",
      sessionId: "cs_blocked_reconciliation",
      transferId: null,
    });
    await database.exec(`
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES (
        'evt_blocked_reconciliation',
        'checkout.session.completed',
        'cs_blocked_reconciliation',
        1,
        CURRENT_TIMESTAMP
      )
    `);
    const claim = await blockedClaim(database, {
      eventId: "evt_blocked_reconciliation",
      eventGeneration: 1,
      sessionId: "cs_blocked_reconciliation",
      orderId: "order-blocked-reconciliation",
    });
    await database.exec(`
      UPDATE public."Order"
         SET "sellerRefundId" = 'ambiguous_refund_pending_reconciliation'
       WHERE id = 'order-blocked-reconciliation';
      UPDATE public."StripeWebhookEvent"
         SET "processingStartedAt" = NULL,
             "lastError" = 'sanitized provider timeout'
       WHERE id = 'evt_blocked_reconciliation';
    `);

    const prepared = (await database.query(`
      SELECT public.grainline_order_refund_reconciliation_prepare(
        'admin-user', 'order-blocked-reconciliation'
      ) AS claim
    `)).rows[0].claim;
    assert.equal(prepared.claimId, claim.claimId);
    assert.equal(prepared.claimGeneration, claim.claimGeneration);
    const reconciled = (await database.query(`
      SELECT public.grainline_order_refund_reconcile(
        'admin-user', $1, $2, 'CONFIRMED_PROVIDER_EFFECT',
        'Reviewed the exact blocked-checkout Stripe refund.',
        pg_catalog.floor(EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()))::bigint,
        'USABLE_REFUND', $3
      ) AS result
    `, [prepared.claimId, prepared.claimGeneration, "d".repeat(64)])).rows[0]
      .result;

    await assert.rejects(
      database.query(`
        SELECT public.grainline_blocked_checkout_refund_record(
          'evt_blocked_reconciliation', 1, $1, $2,
          're_blockedreconciliation', 'succeeded', NULL, NULL
        )
      `, [prepared.claimId, prepared.claimGeneration]),
      /source lease is inactive/,
    );
    await assert.rejects(
      database.query(`
        SELECT public.grainline_blocked_checkout_refund_reconciliation_record(
          'order-refund-reconcile:00000000-0000-0000-0000-000000000000',
          $1, $2, 're_blockedreconciliation', 'succeeded', NULL, NULL
        )
      `, [prepared.claimId, prepared.claimGeneration]),
      /reconciliation authority is invalid/,
    );

    const recorded = (await database.query(`
      SELECT public.grainline_blocked_checkout_refund_reconciliation_record(
        $1, $2, $3, 're_blockedreconciliation', 'succeeded', NULL, NULL
      ) AS result
    `, [
      reconciled.reconciliationId,
      prepared.claimId,
      prepared.claimGeneration,
    ])).rows[0].result;
    assert.equal(recorded.action, "recorded");
    assert.equal(recorded.orderId, "order-blocked-reconciliation");
    assert.deepEqual(
      (await database.query(`
        SELECT "processedAt" IS NOT NULL AS processed,
               "processingStartedAt" AS processing,
               "lastError" AS error
          FROM public."StripeWebhookEvent"
         WHERE id = 'evt_blocked_reconciliation'
      `)).rows[0],
      { processed: true, processing: null, error: null },
    );
  } finally {
    await database.close();
  }
});

test("seller finalization rolls back every write when the fixed Case application drifts", async () => {
  const database = await createDatabase();
  try {
    const listingId = await seedOrder(database, { id: "order-rollback" });
    const claim = await sellerClaim(database, "order-rollback");
    await database.exec(`
      CREATE OR REPLACE FUNCTION public.grainline_case_seller_refund_apply(
        p_actor_user_id text,
        p_order_payment_event_id text
      )
      RETURNS TABLE (
        "caseId" text,
        "orderId" text,
        "sellerUserId" text,
        "buyerUserId" text,
        "paymentEventId" text,
        action text
      )
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = pg_catalog
      AS $$
        SELECT
          NULL::text,
          'wrong-order'::text,
          p_actor_user_id,
          'buyer-user'::text,
          p_order_payment_event_id,
          'no_case'::text
      $$
    `);

    await assert.rejects(
      sellerRecord(database, claim),
      /Case application failed closed/,
    );
    assert.deepEqual(
      (await database.query(`
        SELECT "sellerRefundId", "refundClaimId", "reviewNeeded"
        FROM public."Order" WHERE id = 'order-rollback'
      `)).rows[0],
      {
        sellerRefundId: "pending",
        refundClaimId: claim.claimId,
        reviewNeeded: false,
      },
    );
    assert.deepEqual(
      (await database.query(`
        SELECT "stockQuantity", status::text AS status
        FROM public."Listing" WHERE id = $1
      `, [listingId])).rows[0],
      { stockQuantity: 0, status: "SOLD_OUT" },
    );
    assert.equal(
      (await database.query(`
        SELECT count(*)::integer AS count FROM public."OrderPaymentEvent"
      `)).rows[0].count,
      0,
    );
    assert.equal(
      (await database.query(`
        SELECT count(*)::integer AS count FROM public."SystemAuditLog"
      `)).rows[0].count,
      0,
    );
  } finally {
    await database.close();
  }
});

test("refund record functions reject drift and expose only the reviewed runtime entrypoints", async () => {
  const database = await createDatabase();
  try {
    await seedOrder(database, { id: "order-drift" });
    const claim = await sellerClaim(database, "order-drift");
    await assert.rejects(
      database.query(`
        SELECT public.grainline_seller_refund_record(
          'seller-user', $1, $2, 're_drift', 'provider_made_this_up',
          'trr_drift', 1200
        )
      `, [claim.claimId, claim.claimGeneration]),
      /provider evidence is invalid/,
    );
    await assert.rejects(
      database.query(`
        SELECT public.grainline_seller_refund_record(
          'seller-user', $1, $2, 're_drift', 'succeeded', NULL, 1
        )
      `, [claim.claimId, claim.claimGeneration]),
      /provider evidence is invalid/,
    );
    await assert.rejects(
      database.query(`
        SELECT public.grainline_seller_refund_record(
          'seller-user', $1, $2, 're_drift', 'succeeded', NULL, NULL
        )
      `, [claim.claimId, claim.claimGeneration]),
      /reversal evidence is missing or mismatched/,
    );
    await assert.rejects(
      database.query(`
        SELECT public.grainline_seller_refund_record(
          'seller-user', $1, $2, 're_drift', 'succeeded', 'trr_drift', 1199
        )
      `, [claim.claimId, claim.claimGeneration]),
      /reversal evidence is missing or mismatched/,
    );
    await assert.rejects(
      database.query(`
        SELECT public.grainline_seller_refund_record(
          'seller-user', $1, $2, 're_drift', 'succeeded', 'trr_drift', 1200
        )
      `, [claim.claimId, Number(claim.claimGeneration) + 1]),
      /claim is no longer active/,
    );

    await seedOrder(database, {
      id: "order-blocked-status",
      sessionId: "cs_blocked_status",
      transferId: null,
    });
    await database.exec(`
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES (
        'evt_blocked_status', 'checkout.session.completed',
        'cs_blocked_status', 1, CURRENT_TIMESTAMP
      )
    `);
    const blockedStatusClaim = await blockedClaim(database, {
      eventId: "evt_blocked_status",
      eventGeneration: 1,
      sessionId: "cs_blocked_status",
      orderId: "order-blocked-status",
    });
    await assert.rejects(
      database.query(`
        SELECT public.grainline_blocked_checkout_refund_record(
          'evt_blocked_status', 1, $1, $2, 're_blocked_status',
          'SUCCEEDED', NULL, NULL
        )
      `, [blockedStatusClaim.claimId, blockedStatusClaim.claimGeneration]),
      /provider evidence is invalid/,
    );

    const privileges = (await database.query(`
      SELECT
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_seller_refund_record(text,text,bigint,text,text,text,integer)',
          'EXECUTE'
        ) AS seller_runtime,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_blocked_checkout_refund_record(text,bigint,text,bigint,text,text,text,integer)',
          'EXECUTE'
        ) AS blocked_runtime,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_blocked_checkout_refund_claim_resume(text,bigint,text,text,integer)',
          'EXECUTE'
        ) AS resume_runtime,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_blocked_checkout_refund_record_core(text,bigint,text,bigint,text,text,text,integer)',
          'EXECUTE'
        ) AS core_runtime,
        pg_catalog.has_function_privilege(
          'public',
          'public.grainline_blocked_checkout_refund_record_core(text,bigint,text,bigint,text,text,text,integer)',
          'EXECUTE'
        ) AS core_public,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_blocked_checkout_refund_reconciliation_record(text,text,bigint,text,text,text,integer)',
          'EXECUTE'
        ) AS reconciliation_runtime,
        pg_catalog.has_function_privilege(
          'public',
          'public.grainline_seller_refund_record(text,text,bigint,text,text,text,integer)',
          'EXECUTE'
        ) AS seller_public
    `)).rows[0];
    assert.deepEqual(privileges, {
      seller_runtime: true,
      blocked_runtime: true,
      resume_runtime: true,
      core_runtime: false,
      core_public: false,
      reconciliation_runtime: true,
      seller_public: false,
    });
  } finally {
    await database.close();
  }
});
