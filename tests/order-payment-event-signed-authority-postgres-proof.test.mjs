import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260824030000_prepare_order_payment_signed_authority/migration.sql",
  "utf8",
);
const disputeIdentityMigration = readFileSync(
  "prisma/migrations/20260828020000_correct_order_payment_signed_dispute_identity/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  try {
    await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY
    );
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
    LANGUAGE sql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $case_stub$
      SELECT
        'case-' || payment.id,
        payment."orderId",
        seller."userId",
        orders."buyerId",
        payment.id,
        'create'::text
      FROM public."OrderPaymentEvent" AS payment
      JOIN public."Order" AS orders ON orders.id = payment."orderId"
      JOIN public."SellerProfile" AS seller
        ON seller.id = orders."sellerProfileId"
      WHERE payment.id = p_payment_event_id
    ;
    $case_stub$;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public."OrderPaymentEvent" TO grainline_app_runtime;
    `);
  } catch (error) {
    await database.close();
    throw new Error(`signed authority fixture schema failed: ${error.message}`, { cause: error });
  }
  try {
    await database.exec(migration);
    await database.exec(disputeIdentityMigration);
  } catch (error) {
    await database.close();
    throw new Error(
      `signed authority migration failed at ${error.position ?? "unknown"}: ${error.message}`,
      { cause: error },
    );
  }
  await database.exec(`
    INSERT INTO public."User" (id) VALUES ('buyer-1'), ('seller-user-1');
    INSERT INTO public."SellerProfile" (id, "userId")
      VALUES ('seller-1', 'seller-user-1');
    INSERT INTO public."Order" (
      id,
      "buyerId",
      "sellerProfileId",
      "stripeChargeId"
    ) VALUES ('order-1', 'buyer-1', 'seller-1', 'ch_1');
  `);
  return database;
}

async function seedLease(database, {
  eventId,
  type,
  sourceObjectId,
  generation = 1,
}) {
  await database.query(`
    INSERT INTO public."StripeWebhookEvent" (
      id,
      type,
      "sourceObjectId",
      "claimGeneration",
      "processingStartedAt"
    ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
  `, [eventId, type, sourceObjectId, generation]);
}

async function applyRefund(database, {
  eventId,
  eventCreated,
  chargeId = "ch_1",
  refundId = "re_1",
  amountRefunded = 11800,
  refundAmount = 11800,
  status = "succeeded",
  reason = null,
} = {}) {
  return (await database.query(`
    SELECT *
      FROM public.grainline_order_payment_signed_refund_apply(
        $1, 1, $2, $3, $4, 'usd', $5, $6, $7, $8, $9
      )
  `, [
    eventId,
    chargeId,
    eventCreated,
    amountRefunded,
    refundId,
    refundAmount,
    status,
    eventCreated - 1,
    reason,
  ])).rows[0];
}

async function applyDispute(database, {
  eventId,
  eventCreated,
  chargeId = "ch_1",
  disputeId = "du_1",
  amount = 11800,
  status = "needs_response",
  reason = "fraudulent",
} = {}) {
  return (await database.query(`
    SELECT *
      FROM public.grainline_order_payment_signed_dispute_apply(
        $1, 1, $2, $3, $4, $5, 'usd', $6, $7
      )
  `, [
    eventId,
    chargeId,
    disputeId,
    eventCreated,
    amount,
    reason,
    status,
  ])).rows[0];
}

test("disposable PostgreSQL proves signed refund source, replay and collision boundaries", async () => {
  const database = await createDatabase();
  const now = Math.floor(Date.now() / 1000);
  try {
    await seedLease(database, {
      eventId: "evt_refund_1",
      type: "charge.refunded",
      sourceObjectId: "ch_1",
    });
    const inserted = await applyRefund(database, {
      eventId: "evt_refund_1",
      eventCreated: now - 3,
    });
    assert.equal(inserted.action, "inserted");
    assert.equal(inserted.orderId, "order-1");
    assert.equal(inserted.orderUpdated, true);
    assert.ok(inserted.paymentEventId);

    const replay = await applyRefund(database, {
      eventId: "evt_refund_1",
      eventCreated: now - 3,
    });
    assert.deepEqual(replay, {
      action: "replay",
      paymentEventId: inserted.paymentEventId,
      orderId: "order-1",
      orderUpdated: false,
    });

    await assert.rejects(
      applyRefund(database, {
        eventId: "evt_refund_1",
        eventCreated: now - 3,
        refundAmount: 11799,
      }),
      /replay payload is inconsistent/,
    );

    const order = (await database.query(`
      SELECT "sellerRefundId", "sellerRefundAmountCents", "reviewNeeded"
        FROM public."Order" WHERE id = 'order-1'
    `)).rows[0];
    assert.deepEqual(order, {
      sellerRefundId: "re_1",
      sellerRefundAmountCents: 11800,
      reviewNeeded: true,
    });
    const event = (await database.query(`
      SELECT "stripeEventCreatedSeconds", metadata->>'chargeId' AS charge_id
        FROM public."OrderPaymentEvent"
       WHERE "stripeEventId" = 'evt_refund_1'
    `)).rows[0];
    assert.equal(Number(event.stripeEventCreatedSeconds), now - 3);
    assert.equal(event.charge_id, "ch_1");

    await seedLease(database, {
      eventId: "evt_refund_wrong_source",
      type: "charge.refunded",
      sourceObjectId: "ch_other",
    });
    await assert.rejects(
      applyRefund(database, {
        eventId: "evt_refund_wrong_source",
        eventCreated: now - 2,
      }),
      /source lease is invalid/,
    );
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL proves dispute ordering as a set, Case binding and fail-closed source checks", async () => {
  const database = await createDatabase();
  const now = Math.floor(Date.now() / 1000);
  try {
    await seedLease(database, {
      eventId: "evt_dispute_noncanonical_prefix",
      type: "charge.dispute.created",
      sourceObjectId: "dp_legacy",
    });
    await assert.rejects(
      applyDispute(database, {
        eventId: "evt_dispute_noncanonical_prefix",
        disputeId: "dp_legacy",
        eventCreated: now - 5,
      }),
      /Signed dispute input is invalid/,
    );

    await seedLease(database, {
      eventId: "evt_dispute_created",
      type: "charge.dispute.created",
      sourceObjectId: "du_1",
    });
    const applied = await applyDispute(database, {
      eventId: "evt_dispute_created",
      eventCreated: now - 5,
    });
    assert.equal(applied.action, "applied");
    assert.equal(applied.orderId, "order-1");
    assert.equal(applied.sellerUserId, "seller-user-1");
    assert.equal(applied.buyerUserId, "buyer-1");
    assert.equal(applied.caseAction, "create");
    assert.equal(applied.notificationAuthorized, true);

    const replay = await applyDispute(database, {
      eventId: "evt_dispute_created",
      eventCreated: now - 5,
    });
    assert.equal(replay.action, "replay");
    assert.equal(replay.notificationAuthorized, false);

    await seedLease(database, {
      eventId: "evt_dispute_stale",
      type: "charge.dispute.updated",
      sourceObjectId: "du_1",
    });
    const stale = await applyDispute(database, {
      eventId: "evt_dispute_stale",
      eventCreated: now - 6,
      eventType: "charge.dispute.updated",
    });
    assert.equal(stale.action, "stale_recorded");
    assert.equal(stale.notificationAuthorized, false);

    await seedLease(database, {
      eventId: "evt_dispute_same",
      type: "charge.dispute.created",
      sourceObjectId: "du_1",
    });
    const sameSecond = await applyDispute(database, {
      eventId: "evt_dispute_same",
      eventCreated: now - 5,
      eventType: "charge.dispute.updated",
    });
    assert.equal(sameSecond.action, "same_second_recorded");

    await seedLease(database, {
      eventId: "evt_dispute_type_conflict",
      type: "charge.dispute.updated",
      sourceObjectId: "du_1",
    });
    const typeConflict = await applyDispute(database, {
      eventId: "evt_dispute_type_conflict",
      eventCreated: now - 5,
    });
    assert.equal(typeConflict.action, "conflict_recorded");
    assert.equal(typeConflict.notificationAuthorized, false);

    await seedLease(database, {
      eventId: "evt_dispute_conflict",
      type: "charge.dispute.updated",
      sourceObjectId: "du_1",
    });
    const conflict = await applyDispute(database, {
      eventId: "evt_dispute_conflict",
      eventCreated: now - 5,
      eventType: "charge.dispute.updated",
      status: "won",
    });
    assert.equal(conflict.action, "conflict_recorded");
    assert.equal(conflict.notificationAuthorized, false);

    await seedLease(database, {
      eventId: "evt_dispute_third",
      type: "charge.dispute.updated",
      sourceObjectId: "du_1",
    });
    const thirdAtConflictSecond = await applyDispute(database, {
      eventId: "evt_dispute_third",
      eventCreated: now - 5,
      eventType: "charge.dispute.updated",
    });
    assert.equal(thirdAtConflictSecond.action, "conflict_recorded");

    await seedLease(database, {
      eventId: "evt_dispute_newer",
      type: "charge.dispute.updated",
      sourceObjectId: "du_1",
    });
    const newer = await applyDispute(database, {
      eventId: "evt_dispute_newer",
      eventCreated: now - 4,
      eventType: "charge.dispute.updated",
      status: "under_review",
    });
    assert.equal(newer.action, "applied");

    const counts = (await database.query(`
      SELECT
        pg_catalog.count(*) FILTER (WHERE "eventType" = 'DISPUTE')::integer AS disputes,
        pg_catalog.count(*) FILTER (
          WHERE metadata->>'orderingAction' = 'conflict_recorded'
        )::integer AS conflicts
      FROM public."OrderPaymentEvent"
    `)).rows[0];
    assert.deepEqual(counts, { disputes: 7, conflicts: 3 });

    await seedLease(database, {
      eventId: "evt_dispute_wrong_generation",
      type: "charge.dispute.updated",
      sourceObjectId: "du_1",
      generation: 2,
    });
    await assert.rejects(
      applyDispute(database, {
        eventId: "evt_dispute_wrong_generation",
        eventCreated: now - 3,
        eventType: "charge.dispute.updated",
      }),
      /source lease is invalid/,
    );
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL preserves local, active-claim, stale and additional-refund semantics", async () => {
  const database = await createDatabase();
  const now = Math.floor(Date.now() / 1000);
  try {
    await database.exec(`
      UPDATE public."Order"
         SET "sellerRefundId" = 're_local1',
             "sellerRefundAmountCents" = 11800,
             "reviewNeeded" = false
       WHERE id = 'order-1'
    `);
    await seedLease(database, {
      eventId: "evt_local_confirmation",
      type: "charge.refunded",
      sourceObjectId: "ch_1",
    });
    const localConfirmation = await applyRefund(database, {
      eventId: "evt_local_confirmation",
      eventCreated: now - 10,
      refundId: "re_local1",
    });
    assert.equal(localConfirmation.orderUpdated, false);
    assert.equal((await database.query(`
      SELECT reason FROM public."OrderPaymentEvent"
       WHERE "stripeEventId" = 'evt_local_confirmation'
    `)).rows[0].reason, "local_refund_confirmed");

    await database.exec(`
      UPDATE public."Order"
         SET "sellerRefundId" = 'pending',
             "sellerRefundLockedAt" = CURRENT_TIMESTAMP - INTERVAL '1 hour',
             "refundClaimId" = 'claim-active'
       WHERE id = 'order-1'
    `);
    await seedLease(database, {
      eventId: "evt_active_claim",
      type: "charge.refunded",
      sourceObjectId: "ch_1",
    });
    const activeClaim = await applyRefund(database, {
      eventId: "evt_active_claim",
      eventCreated: now - 9,
      refundId: "re_activeclaim",
    });
    assert.equal(activeClaim.orderUpdated, false);
    assert.equal((await database.query(`
      SELECT "sellerRefundId" FROM public."Order" WHERE id = 'order-1'
    `)).rows[0].sellerRefundId, "pending");

    await database.exec(`
      UPDATE public."Order"
         SET "refundClaimId" = NULL,
             "caseResolutionClaimId" = NULL,
             "sellerRefundLockedAt" = CURRENT_TIMESTAMP - INTERVAL '1 hour'
       WHERE id = 'order-1'
    `);
    await seedLease(database, {
      eventId: "evt_stale_claim",
      type: "charge.refunded",
      sourceObjectId: "ch_1",
    });
    const staleClaim = await applyRefund(database, {
      eventId: "evt_stale_claim",
      eventCreated: now - 8,
      refundId: "re_staleclaim",
    });
    assert.equal(staleClaim.orderUpdated, true);
    assert.equal((await database.query(`
      SELECT "sellerRefundId" FROM public."Order" WHERE id = 'order-1'
    `)).rows[0].sellerRefundId, "re_staleclaim");

    await database.exec(`
      UPDATE public."Order"
         SET "sellerRefundId" = 're_preservedlocal',
             "sellerRefundAmountCents" = 5000,
             "sellerRefundLockedAt" = NULL
       WHERE id = 'order-1'
    `);
    await seedLease(database, {
      eventId: "evt_additional_external",
      type: "charge.refunded",
      sourceObjectId: "ch_1",
    });
    const additional = await applyRefund(database, {
      eventId: "evt_additional_external",
      eventCreated: now - 7,
      refundId: "re_additional1",
      refundAmount: 6800,
    });
    assert.equal(additional.orderUpdated, true);
    const preserved = (await database.query(`
      SELECT "sellerRefundId", "sellerRefundAmountCents", "reviewNote"
        FROM public."Order" WHERE id = 'order-1'
    `)).rows[0];
    assert.equal(preserved.sellerRefundId, "re_preservedlocal");
    assert.equal(preserved.sellerRefundAmountCents, 11800);
    assert.match(preserved.reviewNote, /local refund audit ID was preserved/i);

    await database.exec(`
      UPDATE public."Order"
         SET "sellerRefundId" = 'ambiguous_refund_pending_reconciliation',
             "sellerRefundAmountCents" = NULL
       WHERE id = 'order-1'
    `);
    await seedLease(database, {
      eventId: "evt_ambiguous_resolution",
      type: "charge.refunded",
      sourceObjectId: "ch_1",
    });
    const resolvedAmbiguous = await applyRefund(database, {
      eventId: "evt_ambiguous_resolution",
      eventCreated: now - 6,
      refundId: "re_ambiguousresolved",
    });
    assert.equal(resolvedAmbiguous.orderUpdated, true);
    assert.equal((await database.query(`
      SELECT "sellerRefundId" FROM public."Order" WHERE id = 'order-1'
    `)).rows[0].sellerRefundId, "re_ambiguousresolved");
  } finally {
    await database.close();
  }
});

test("compatible migration preserves predecessor table access while exposing only fixed functions", async () => {
  const database = await createDatabase();
  try {
    const posture = (await database.query(`
      SELECT
        relation.relrowsecurity AS rls_enabled,
        relation.relforcerowsecurity AS rls_forced,
        has_table_privilege(
          'grainline_app_runtime',
          'public."OrderPaymentEvent"',
          'SELECT'
        ) AS can_select,
        has_table_privilege(
          'grainline_app_runtime',
          'public."OrderPaymentEvent"',
          'INSERT'
        ) AS can_insert,
        has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_order_payment_signed_refund_apply(text,bigint,text,bigint,integer,text,text,integer,text,bigint,text)',
          'EXECUTE'
        ) AS runtime_can_refund,
        has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)',
          'EXECUTE'
        ) AS runtime_can_dispute,
        has_function_privilege(
          'public',
          'public.grainline_order_payment_signed_refund_apply(text,bigint,text,bigint,integer,text,text,integer,text,bigint,text)',
          'EXECUTE'
        ) AS public_can_refund
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'OrderPaymentEvent'
    `)).rows[0];
    assert.deepEqual(posture, {
      rls_enabled: false,
      rls_forced: false,
      can_select: true,
      can_insert: true,
      runtime_can_refund: true,
      runtime_can_dispute: true,
      public_can_refund: false,
    });
  } finally {
    await database.close();
  }
});
