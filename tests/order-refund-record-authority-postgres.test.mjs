import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
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
const reconciliationMigrationsRoot =
  process.env.ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATIONS_DIR ??
  "prisma/migrations";
const reconciliationMigration = readFileSync(
  path.join(
    reconciliationMigrationsRoot,
    "20260824040000_prepare_order_refund_reconciliation_authority",
    "migration.sql",
  ),
  "utf8",
);
const compositionCorrection = readFileSync(
  "docs/rls-drafts/order-authority-composition-correction.sql",
  "utf8",
);
const paymentEventInvariantMigration = readFileSync(
  process.env.ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION_PATH ??
    "prisma/migrations/20260829010000_prepare_order_payment_event_invariants/migration.sql",
  "utf8",
);
const sellerPrivateMigrationRoot =
  process.env.SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATIONS_DIR ?? "prisma/migrations";
const sellerPrivateReconciliationMigration = readFileSync(
  path.join(
    sellerPrivateMigrationRoot,
    "20261013190000_move_reconciliation_seller_private_sql_callers",
    "migration.sql",
  ),
  "utf8",
);
const sellerPrivateReconciliationTargetCorrection = readFileSync(
  path.join(
    sellerPrivateMigrationRoot,
    "20261014010000_tolerate_missing_seller_reconciliation_target",
    "migration.sql",
  ),
  "utf8",
);
const immutableRefundRecordRepair = readFileSync(
  process.env.ORDER_REFUND_IMMUTABLE_EVENT_MIGRATION_PATH ??
    "prisma/migrations/20261015020000_repair_immutable_order_refund_recording/migration.sql",
  "utf8",
);
const blockedCheckoutRefundWitness = readFileSync(
  process.env.BLOCKED_CHECKOUT_REFUND_WITNESS_MIGRATION_PATH ||
  "prisma/migrations/20261015030000_preserve_blocked_checkout_refund_witness/migration.sql",
  "utf8",
);
const blockedCheckoutRefundRecovery = readFileSync(
  process.env.BLOCKED_CHECKOUT_REFUND_RECOVERY_MIGRATION_PATH ||
    "prisma/migrations/20261015040000_repair_blocked_checkout_refund_recovery/migration.sql",
  "utf8",
);

function functionDefinition(source, name) {
  const match = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`,
    "u",
  ).exec(source);
  const start = match?.index ?? -1;
  assert.ok(start >= 0, `missing corrected ${name}`);
  const delimiter = source.slice(start).match(/\nAS (\$[A-Za-z0-9_]*\$)/u)?.[1];
  assert.ok(delimiter, `missing corrected ${name} body delimiter`);
  const endMarker = `${delimiter};`;
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `missing corrected ${name}`);
  return source.slice(start, end + endMarker.length);
}

function correctedFunction(name) {
  return functionDefinition(compositionCorrection, name);
}

function replaceFunctionDefinition(source, name) {
  return functionDefinition(source, name).replace(
    /^CREATE FUNCTION/u,
    "CREATE OR REPLACE FUNCTION",
  );
}

function dollarBlock(source, tag) {
  const start = source.indexOf(`DO $${tag}$`);
  const endMarker = `\n$${tag}$;`;
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing ${tag}`);
  return source.slice(start, end + endMarker.length);
}

const recoveryPreflight = dollarBlock(
  blockedCheckoutRefundRecovery,
  "grainline_blocked_checkout_refund_recovery_preflight",
);
const recoveryPostflight = dollarBlock(
  blockedCheckoutRefundRecovery,
  "grainline_blocked_checkout_refund_recovery_postflight",
);

function immutablePaymentEventTrigger() {
  const start = paymentEventInvariantMigration.indexOf(
    "CREATE FUNCTION public.grainline_order_payment_event_immutable()",
  );
  const endMarker =
    "EXECUTE FUNCTION public.grainline_order_payment_event_immutable();";
  const end = paymentEventInvariantMigration.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "missing immutable payment-event trigger");
  return paymentEventInvariantMigration.slice(start, end + endMarker.length);
}

function blockedCheckoutWitnessTrigger() {
  const start = blockedCheckoutRefundWitness.indexOf(
    "CREATE FUNCTION public.grainline_order_blocked_checkout_refund_witness_immutable()",
  );
  const endMarker =
    "EXECUTE FUNCTION public.grainline_order_blocked_checkout_refund_witness_immutable();";
  const end = blockedCheckoutRefundWitness.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "missing blocked-checkout witness trigger");
  return blockedCheckoutRefundWitness.slice(start, end + endMarker.length);
}

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
    CREATE TABLE public."SellerProfilePrivate" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
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
      "labelClaimStatus" text,
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
    CREATE TABLE public."OrderRefundReconciliation" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id),
      "claimId" varchar(255) NOT NULL,
      "claimGeneration" bigint NOT NULL,
      "claimSource" varchar(32) NOT NULL,
      "claimSourceId" varchar(255) NOT NULL,
      "claimSourceGeneration" bigint,
      "idempotencyScope" varchar(255) NOT NULL,
      action varchar(64) NOT NULL,
      "actorUserId" text NOT NULL REFERENCES public."User"(id),
      "providerInspectedAt" timestamp(3) without time zone NOT NULL,
      "providerDisposition" varchar(64) NOT NULL,
      "providerEvidenceSha256" varchar(64) NOT NULL,
      reason varchar(1000) NOT NULL,
      "auditLogId" text NOT NULL,
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
  await database.exec(correctedFunction("grainline_blocked_checkout_refund_claim"));
  await database.exec(correctedFunction("grainline_blocked_checkout_refund_record_core"));
  await database.exec(immutablePaymentEventTrigger());
  await database.exec("SET check_function_bodies = off");
  await database.exec(sellerPrivateReconciliationMigration);
  await database.exec(sellerPrivateReconciliationTargetCorrection);
  await database.exec(immutableRefundRecordRepair);
  await database.exec(`
    ALTER TABLE public."Order"
      ADD COLUMN "blockedCheckoutRefundRequiredAt" timestamp(3) without time zone,
      ADD COLUMN "blockedCheckoutRefundRecordedAt" timestamp(3) without time zone,
      ADD COLUMN "paymentRefundBlocked" boolean NOT NULL DEFAULT false;
    ALTER TABLE public."Order"
      ADD CONSTRAINT "Order_blockedCheckoutRefundWitness_check"
      CHECK (
        "blockedCheckoutRefundRecordedAt" IS NULL
        OR "blockedCheckoutRefundRequiredAt" IS NOT NULL
      );
  `);
  await database.exec(blockedCheckoutWitnessTrigger());
  await database.exec(functionDefinition(
    blockedCheckoutRefundWitness,
    "grainline_blocked_checkout_refund_record_core",
  ));
  await database.exec(functionDefinition(
    blockedCheckoutRefundWitness,
    "grainline_stripe_checkout_order_existing",
  ));
  await database.exec(functionDefinition(
    reconciliationMigration,
    "grainline_blocked_checkout_refund_reconciliation_record",
  ));
  await database.exec(`
    REVOKE ALL ON FUNCTION public.grainline_stripe_checkout_order_existing(
      text, bigint, text
    ) FROM PUBLIC, grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION public.grainline_stripe_checkout_order_existing(
      text, bigint, text
    ) TO grainline_app_runtime;
    REVOKE ALL ON FUNCTION public.grainline_blocked_checkout_refund_reconciliation_record(
      text, text, bigint, text, text, text, integer
    ) FROM PUBLIC, grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION public.grainline_blocked_checkout_refund_reconciliation_record(
      text, text, bigint, text, text, text, integer
    ) TO grainline_app_runtime;
  `);
  await database.exec(blockedCheckoutRefundRecovery);
  await database.exec("SET check_function_bodies = on");
  await database.exec(`
    INSERT INTO public."User" (id, role) VALUES
      ('seller-user', 'USER'),
      ('buyer-user', 'USER'),
      ('admin-user', 'ADMIN'),
      ('employee-user', 'EMPLOYEE');
    INSERT INTO public."SellerProfile" (id, "userId")
      VALUES ('seller-profile', 'seller-user');
    INSERT INTO public."SellerProfilePrivate" ("sellerProfileId")
      VALUES ('seller-profile');
  `);
  return database;
}

async function seedOrder(database, {
  id,
  sessionId = null,
  transferId = "tr_test",
  listingId = `${id}-listing`,
  blockedCheckoutRefundRequired = false,
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
      "giftWrappingPriceCents", "taxAmountCents",
      "blockedCheckoutRefundRequiredAt"
    ) VALUES (
      $1, 'buyer-user', 'seller-profile', CURRENT_TIMESTAMP, $2,
      $3, $4, 'usd', 1000, 200, 50, 75,
      CASE WHEN $5 THEN CURRENT_TIMESTAMP ELSE NULL END
    )
  `, [id, sessionId, `pi_${id}`, transferId, blockedCheckoutRefundRequired]);
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

async function seedBlockedReconciliation(database, {
  orderId,
  eventId,
  sessionId,
  reconciliationId,
  actorUserId = "admin-user",
  claimSource = "BLOCKED_CHECKOUT",
  eventType = "checkout.session.completed",
}) {
  const listingId = await seedOrder(database, {
    id: orderId,
    sessionId,
    blockedCheckoutRefundRequired: true,
  });
  await database.query(`
    INSERT INTO public."StripeWebhookEvent" (
      id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
    ) VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP)
  `, [eventId, eventType, sessionId]);
  const claim = await blockedClaim(database, {
    eventId,
    eventGeneration: 1,
    sessionId,
    orderId,
  });
  await database.query(`
    UPDATE public."Order"
       SET "paymentRefundBlocked" = true
     WHERE id = $1
  `, [orderId]);
  await database.query(`
    INSERT INTO public."OrderRefundReconciliation" (
      id, "orderId", "claimId", "claimGeneration", "claimSource",
      "claimSourceId", "claimSourceGeneration", "idempotencyScope", action,
      "actorUserId", "providerInspectedAt", "providerDisposition",
      "providerEvidenceSha256", reason, "auditLogId"
    ) VALUES (
      $1, $2, $3, $4, $5, $6, 1, $7, 'CONFIRMED_PROVIDER_EFFECT',
      $8, CURRENT_TIMESTAMP, 'USABLE_REFUND', repeat('a', 64),
      'Verified the exact existing provider refund.', $9
    )
  `, [
    reconciliationId,
    orderId,
    claim.claimId,
    claim.claimGeneration,
    claimSource,
    eventId,
    claim.idempotencyScope,
    actorUserId,
    `${reconciliationId}:audit`,
  ]);
  return { claim, listingId };
}

async function reconcileBlockedRefund(database, {
  reconciliationId,
  claim,
  refundId,
}) {
  await database.exec("SET ROLE grainline_app_runtime");
  try {
    return (await database.query(`
      SELECT public.grainline_blocked_checkout_refund_reconciliation_record(
        $1, $2, $3, $4, 'succeeded', 'trr_existing', 1200
      ) AS result
    `, [
      reconciliationId,
      claim.claimId,
      claim.claimGeneration,
      refundId,
    ])).rows[0].result;
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
  }
}

test("blocked-checkout refund recovery preflight accepts only exact predecessor metadata and source", async () => {
  const database = await createDatabase();
  try {
    await database.exec(replaceFunctionDefinition(
      blockedCheckoutRefundWitness,
      "grainline_stripe_checkout_order_existing",
    ));
    await database.exec(replaceFunctionDefinition(
      reconciliationMigration,
      "grainline_blocked_checkout_refund_reconciliation_record",
    ));
    await database.exec(`
      ALTER FUNCTION public.grainline_stripe_checkout_order_existing(
        text, bigint, text
      ) PARALLEL UNSAFE;
      ALTER FUNCTION public.grainline_blocked_checkout_refund_reconciliation_record(
        text, text, bigint, text, text, text, integer
      ) PARALLEL UNSAFE;
      REVOKE ALL ON FUNCTION public.grainline_stripe_checkout_order_existing(
        text, bigint, text
      ) FROM PUBLIC, grainline_app_runtime;
      GRANT EXECUTE ON FUNCTION public.grainline_stripe_checkout_order_existing(
        text, bigint, text
      ) TO grainline_app_runtime;
      REVOKE ALL ON FUNCTION public.grainline_blocked_checkout_refund_reconciliation_record(
        text, text, bigint, text, text, text, integer
      ) FROM PUBLIC, grainline_app_runtime;
      GRANT EXECUTE ON FUNCTION public.grainline_blocked_checkout_refund_reconciliation_record(
        text, text, bigint, text, text, text, integer
      ) TO grainline_app_runtime;
    `);
    await database.exec(recoveryPreflight);

    await database.exec(`
      ALTER FUNCTION public.grainline_stripe_checkout_order_existing(
        text, bigint, text
      ) PARALLEL SAFE
    `);
    await assert.rejects(
      database.exec(recoveryPreflight),
      /predecessor catalog drifted/,
    );
    await database.exec(`
      ALTER FUNCTION public.grainline_stripe_checkout_order_existing(
        text, bigint, text
      ) PARALLEL UNSAFE
    `);

    const driftedPredecessor = replaceFunctionDefinition(
      reconciliationMigration,
      "grainline_blocked_checkout_refund_reconciliation_record",
    ).replace(
      "Blocked-checkout reconciliation record input is invalid",
      "Blocked-checkout reconciliation record input drifted",
    );
    assert.notEqual(
      driftedPredecessor,
      functionDefinition(
        reconciliationMigration,
        "grainline_blocked_checkout_refund_reconciliation_record",
      ),
    );
    await database.exec(driftedPredecessor);
    await assert.rejects(
      database.exec(recoveryPreflight),
      /predecessor catalog drifted/,
    );
  } finally {
    await database.close();
  }
});

test("blocked-checkout refund recovery postflight rejects source, metadata, and ACL drift", async () => {
  const database = await createDatabase();
  try {
    await database.exec(recoveryPostflight);

    await database.exec(`
      ALTER FUNCTION public.grainline_stripe_checkout_order_existing(
        text, bigint, text
      ) PARALLEL SAFE
    `);
    await assert.rejects(
      database.exec(recoveryPostflight),
      /postflight catalog drifted/,
    );
    await database.exec(`
      ALTER FUNCTION public.grainline_stripe_checkout_order_existing(
        text, bigint, text
      ) PARALLEL UNSAFE
    `);

    await database.exec(`
      REVOKE EXECUTE ON FUNCTION public.grainline_blocked_checkout_refund_reconciliation_record(
        text, text, bigint, text, text, text, integer
      ) FROM grainline_app_runtime
    `);
    await assert.rejects(
      database.exec(recoveryPostflight),
      /postflight catalog drifted/,
    );
    await database.exec(`
      GRANT EXECUTE ON FUNCTION public.grainline_blocked_checkout_refund_reconciliation_record(
        text, text, bigint, text, text, text, integer
      ) TO grainline_app_runtime
    `);

    const driftedSuccessor = functionDefinition(
      blockedCheckoutRefundRecovery,
      "grainline_blocked_checkout_refund_reconciliation_record",
    ).replace(
      "Blocked-checkout reconciliation completion raced",
      "Blocked-checkout reconciliation completion source drifted",
    );
    assert.notEqual(
      driftedSuccessor,
      functionDefinition(
        blockedCheckoutRefundRecovery,
        "grainline_blocked_checkout_refund_reconciliation_record",
      ),
    );
    await database.exec(driftedSuccessor);
    await assert.rejects(
      database.exec(recoveryPostflight),
      /postflight catalog drifted/,
    );
  } finally {
    await database.close();
  }
});

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
      blockedCheckoutRefundRequired: true,
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

    await assert.rejects(
      database.exec(`
        UPDATE public."Order"
           SET "blockedCheckoutRefundRecordedAt" = CURRENT_TIMESTAMP
         WHERE id = 'order-blocked'
      `),
      /lacks immutable payment evidence/,
    );

    const recorded = (await database.query(`
      SELECT public.grainline_blocked_checkout_refund_record(
        'evt_blocked', 2, $1, $2, 're_blocked', 'succeeded', NULL, NULL
      ) AS result
    `, [resumedClaim.claimId, resumedClaim.claimGeneration])).rows[0].result;
    assert.equal(recorded.action, "recorded");
    assert.equal(recorded.restoredActiveListingCount, 1);
    const witness = (await database.query(`
      SELECT
        "blockedCheckoutRefundRequiredAt" IS NOT NULL AS required,
        "blockedCheckoutRefundRecordedAt" IS NOT NULL AS recorded,
        EXISTS (
          SELECT 1
            FROM public."OrderPaymentEvent" AS payment_event
           WHERE payment_event."orderId" = orders.id
             AND payment_event."stripeObjectId" = orders."sellerRefundId"
             AND payment_event.metadata->>'localAction'
                   = 'BLOCKED_CHECKOUT_REFUND_RECORDED'
        ) AS immutable_evidence
      FROM public."Order" AS orders
      WHERE orders.id = 'order-blocked'
    `)).rows[0];
    assert.deepEqual(witness, {
      required: true,
      recorded: true,
      immutable_evidence: true,
    });
    await assert.rejects(
      database.exec(`
        UPDATE public."Order"
           SET "blockedCheckoutRefundRequiredAt" = NULL
         WHERE id = 'order-blocked'
      `),
      /requirement witness is immutable/,
    );
    await assert.rejects(
      database.exec(`
        UPDATE public."Order"
           SET "blockedCheckoutRefundRecordedAt" = NULL
         WHERE id = 'order-blocked'
      `),
      /record witness is immutable/,
    );
    const reconciliation = (await database.query(`
      SELECT
        seller."manualStripeReconciliationNeeded" AS public_needed,
        seller."manualStripeReconciliationNote" AS public_note,
        seller_private."manualStripeReconciliationNeeded" AS private_needed,
        seller_private."manualStripeReconciliationNote" AS private_note
      FROM public."SellerProfile" AS seller
      JOIN public."SellerProfilePrivate" AS seller_private
        ON seller_private."sellerProfileId" = seller.id
      WHERE seller.id = 'seller-profile'
    `)).rows[0];
    assert.deepEqual(reconciliation, {
      public_needed: true,
      public_note:
        "Blocked-checkout refund used a platform-only Stripe refund; staff must reconcile the seller transfer manually.",
      private_needed: true,
      private_note:
        "Blocked-checkout refund used a platform-only Stripe refund; staff must reconcile the seller transfer manually.",
    });
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

test("ADMIN reconciliation records an existing refund from a processed event and replays once", async () => {
  const database = await createDatabase();
  const reconciliationId =
    "order-refund-reconcile:11111111-1111-1111-1111-111111111111";
  try {
    const { claim, listingId } = await seedBlockedReconciliation(database, {
      orderId: "order-reconcile-processed",
      eventId: "evt_reconcile_processed",
      sessionId: "cs_reconcile_processed",
      reconciliationId,
    });
    await database.exec(`
      UPDATE public."StripeWebhookEvent"
         SET "processingStartedAt" = NULL,
             "processedAt" = CURRENT_TIMESTAMP
       WHERE id = 'evt_reconcile_processed'
    `);

    const recorded = await reconcileBlockedRefund(database, {
      reconciliationId,
      claim,
      refundId: "re_existing1",
    });
    assert.equal(recorded.action, "recorded");
    assert.equal(recorded.refundId, "re_existing1");
    assert.deepEqual(
      (await database.query(`
        SELECT "sellerRefundId" AS refund_id,
               "refundClaimId" AS claim_id,
               "blockedCheckoutRefundRequiredAt" IS NOT NULL AS required,
               "blockedCheckoutRefundRecordedAt" IS NOT NULL AS recorded
          FROM public."Order"
         WHERE id = 'order-reconcile-processed'
      `)).rows[0],
      {
        refund_id: "re_existing1",
        claim_id: null,
        required: true,
        recorded: true,
      },
    );
    assert.deepEqual(
      (await database.query(`
        SELECT "stockQuantity" AS stock, status::text AS status
          FROM public."Listing" WHERE id = $1
      `, [listingId])).rows[0],
      { stock: 2, status: "ACTIVE" },
    );
    assert.equal(
      (await database.query(`
        SELECT count(*)::integer AS count
          FROM public."OrderPaymentEvent"
         WHERE "stripeObjectId" = 're_existing1'
           AND metadata->>'localAction' = 'BLOCKED_CHECKOUT_REFUND_RECORDED'
      `)).rows[0].count,
      1,
    );

    const replay = await reconcileBlockedRefund(database, {
      reconciliationId,
      claim,
      refundId: "re_existing1",
    });
    assert.equal(replay.action, "replay");
    assert.equal(
      (await database.query(`
        SELECT count(*)::integer AS count
          FROM public."OrderPaymentEvent"
         WHERE "stripeObjectId" = 're_existing1'
      `)).rows[0].count,
      1,
    );
  } finally {
    await database.close();
  }
});

test("ADMIN reconciliation inherits a later processed event generation", async () => {
  const database = await createDatabase();
  const reconciliationId =
    "order-refund-reconcile:22222222-2222-2222-2222-222222222222";
  try {
    const { claim } = await seedBlockedReconciliation(database, {
      orderId: "order-reconcile-generation",
      eventId: "evt_reconcile_generation",
      sessionId: "cs_reconcile_generation",
      reconciliationId,
    });
    await database.exec(`
      UPDATE public."StripeWebhookEvent"
         SET "claimGeneration" = 2,
             "processingStartedAt" = NULL,
             "processedAt" = CURRENT_TIMESTAMP
       WHERE id = 'evt_reconcile_generation'
    `);

    const recorded = await reconcileBlockedRefund(database, {
      reconciliationId,
      claim,
      refundId: "re_generation2",
    });
    assert.equal(recorded.action, "recorded");
    assert.equal(
      (await database.query(`
        SELECT metadata->>'refundClaimSourceGeneration' AS source_generation
          FROM public."OrderPaymentEvent"
         WHERE "stripeObjectId" = 're_generation2'
      `)).rows[0].source_generation,
      "2",
    );

    const replay = await reconcileBlockedRefund(database, {
      reconciliationId,
      claim,
      refundId: "re_generation2",
    });
    assert.equal(replay.action, "replay");
    assert.equal(
      (await database.query(`
        SELECT count(*)::integer AS count
          FROM public."OrderPaymentEvent"
         WHERE "stripeObjectId" = 're_generation2'
      `)).rows[0].count,
      1,
    );
  } finally {
    await database.close();
  }
});

test("ADMIN reconciliation refuses an active event lease without recording", async () => {
  const database = await createDatabase();
  const reconciliationId =
    "order-refund-reconcile:33333333-3333-3333-3333-333333333333";
  try {
    const { claim } = await seedBlockedReconciliation(database, {
      orderId: "order-reconcile-active",
      eventId: "evt_reconcile_active",
      sessionId: "cs_reconcile_active",
      reconciliationId,
    });
    await assert.rejects(
      reconcileBlockedRefund(database, {
        reconciliationId,
        claim,
        refundId: "re_activelease",
      }),
      /source event is not recoverable/,
    );
    assert.deepEqual(
      (await database.query(`
        SELECT "refundClaimId" AS claim_id,
               "blockedCheckoutRefundRecordedAt" AS recorded_at
          FROM public."Order" WHERE id = 'order-reconcile-active'
      `)).rows[0],
      { claim_id: claim.claimId, recorded_at: null },
    );
    assert.equal(
      (await database.query(`
        SELECT count(*)::integer AS count
          FROM public."OrderPaymentEvent"
         WHERE "stripeObjectId" = 're_activelease'
      `)).rows[0].count,
      0,
    );
  } finally {
    await database.close();
  }
});

test("blocked-checkout reconciliation rejects wrong actor, authority, and event source", async () => {
  const database = await createDatabase();
  try {
    const employeeReconciliation =
      "order-refund-reconcile:44444444-4444-4444-4444-444444444444";
    const employee = await seedBlockedReconciliation(database, {
      orderId: "order-reconcile-employee",
      eventId: "evt_reconcile_employee",
      sessionId: "cs_reconcile_employee",
      reconciliationId: employeeReconciliation,
      actorUserId: "employee-user",
    });
    await database.exec(`
      UPDATE public."StripeWebhookEvent"
         SET "processingStartedAt" = NULL
       WHERE id = 'evt_reconcile_employee'
    `);
    await assert.rejects(
      reconcileBlockedRefund(database, {
        reconciliationId: employeeReconciliation,
        claim: employee.claim,
        refundId: "re_employee",
      }),
      /requires a current ADMIN/,
    );

    const wrongSourceReconciliation =
      "order-refund-reconcile:55555555-5555-5555-5555-555555555555";
    const wrongSource = await seedBlockedReconciliation(database, {
      orderId: "order-reconcile-source",
      eventId: "evt_reconcile_source",
      sessionId: "cs_reconcile_source",
      reconciliationId: wrongSourceReconciliation,
      claimSource: "SELLER",
    });
    await database.exec(`
      UPDATE public."StripeWebhookEvent"
         SET "processingStartedAt" = NULL
       WHERE id = 'evt_reconcile_source'
    `);
    await assert.rejects(
      reconcileBlockedRefund(database, {
        reconciliationId: wrongSourceReconciliation,
        claim: wrongSource.claim,
        refundId: "re_wrongsource",
      }),
      /authority is invalid/,
    );

    const wrongEventReconciliation =
      "order-refund-reconcile:66666666-6666-6666-6666-666666666666";
    const wrongEvent = await seedBlockedReconciliation(database, {
      orderId: "order-reconcile-event",
      eventId: "evt_reconcile_event",
      sessionId: "cs_reconcile_event",
      reconciliationId: wrongEventReconciliation,
    });
    await database.exec(`
      UPDATE public."StripeWebhookEvent"
         SET type = 'charge.refunded',
             "processingStartedAt" = NULL
       WHERE id = 'evt_reconcile_event'
    `);
    await assert.rejects(
      reconcileBlockedRefund(database, {
        reconciliationId: wrongEventReconciliation,
        claim: wrongEvent.claim,
        refundId: "re_wrongevent",
      }),
      /source event is not recoverable/,
    );
  } finally {
    await database.close();
  }
});

test("reconciliation bridge resolves Case seller identity and stays runtime-inaccessible", async () => {
  const database = await createDatabase();
  try {
    await database.exec(`
      SELECT public.grainline_seller_profile_reconciliation_required_compat(
        NULL::text,
        'seller-user',
        'Staff case refund used a platform-only Stripe refund; staff must reconcile the seller transfer manually.',
        pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
      )
    `);
    assert.deepEqual(
      (await database.query(`
        SELECT
          seller."manualStripeReconciliationNeeded" AS public_needed,
          seller."manualStripeReconciliationNote" AS public_note,
          seller_private."manualStripeReconciliationNeeded" AS private_needed,
          seller_private."manualStripeReconciliationNote" AS private_note
        FROM public."SellerProfile" AS seller
        JOIN public."SellerProfilePrivate" AS seller_private
          ON seller_private."sellerProfileId" = seller.id
        WHERE seller.id = 'seller-profile'
      `)).rows[0],
      {
        public_needed: true,
        public_note:
          "Staff case refund used a platform-only Stripe refund; staff must reconcile the seller transfer manually.",
        private_needed: true,
        private_note:
          "Staff case refund used a platform-only Stripe refund; staff must reconcile the seller transfer manually.",
      },
    );
    assert.equal(
      (await database.query(`
        SELECT pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_seller_profile_reconciliation_required_compat(text,text,text,timestamp without time zone)',
          'EXECUTE'
        ) AS allowed
      `)).rows[0].allowed,
      false,
    );
  } finally {
    await database.close();
  }
});

test("reconciliation bridge records a warning instead of rejecting missing seller targets", async () => {
  const database = await createDatabase();
  try {
    await database.exec(`
      DELETE FROM public."SellerProfilePrivate"
       WHERE "sellerProfileId" = 'seller-profile';

      SELECT public.grainline_seller_profile_reconciliation_required_compat(
        'seller-profile',
        NULL::text,
        'Provider refund needs manual seller-transfer reconciliation.',
        pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
      );

      SELECT public.grainline_seller_profile_reconciliation_required_compat(
        NULL::text,
        'missing-seller-user',
        'Provider refund needs manual seller-transfer reconciliation.',
        pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
      );
    `);

    assert.deepEqual(
      (await database.query(`
        SELECT
          "targetType" AS target_type,
          "targetId" AS target_id,
          reason,
          metadata ->> 'missingRelation' AS missing_relation,
          metadata ->> 'reconciliationNote' AS reconciliation_note
        FROM public."SystemAuditLog"
        WHERE action = 'SELLER_RECONCILIATION_FLAG_SKIPPED'
        ORDER BY reason
      `)).rows,
      [
        {
          target_type: "USER",
          target_id: "missing-seller-user",
          reason: "seller_profile_missing",
          missing_relation: "SellerProfile",
          reconciliation_note:
            "Provider refund needs manual seller-transfer reconciliation.",
        },
        {
          target_type: "SELLER_PROFILE",
          target_id: "seller-profile",
          reason: "seller_profile_private_missing",
          missing_relation: "SellerProfilePrivate",
          reconciliation_note:
            "Provider refund needs manual seller-transfer reconciliation.",
        },
      ],
    );
  } finally {
    await database.close();
  }
});

test("blocked-checkout refund stays fenced from fulfillment and label state", async () => {
  const database = await createDatabase();
  try {
    for (const [index, state] of [
      "READY_FOR_PICKUP", "SHIPPED", "DELIVERED", "PICKED_UP",
    ].entries()) {
      const orderId = `order-state-${index}`;
      const sessionId = `cs_state_${index}`;
      const eventId = `evt_state_${index}`;
      await seedOrder(database, { id: orderId, sessionId, transferId: null });
      await database.query(
        `UPDATE public."Order" SET "fulfillmentStatus" = $2 WHERE id = $1`,
        [orderId, state],
      );
      await database.query(`
        INSERT INTO public."StripeWebhookEvent" (
          id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
        ) VALUES ($1, 'checkout.session.completed', $2, 1, CURRENT_TIMESTAMP)
      `, [eventId, sessionId]);
      assert.equal(await blockedClaim(database, {
        eventId,
        eventGeneration: 1,
        sessionId,
        orderId,
      }), null, state);
    }

    await seedOrder(database, {
      id: "order-labeled",
      sessionId: "cs_labeled",
      transferId: null,
    });
    await database.exec(`
      UPDATE public."Order" SET "labelStatus" = 'PURCHASED'
       WHERE id = 'order-labeled';
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES (
        'evt_labeled', 'checkout.session.completed', 'cs_labeled', 1,
        CURRENT_TIMESTAMP
      )
    `);
    assert.equal(await blockedClaim(database, {
      eventId: "evt_labeled",
      eventGeneration: 1,
      sessionId: "cs_labeled",
      orderId: "order-labeled",
    }), null);

    const listingId = await seedOrder(database, {
      id: "order-record-race",
      sessionId: "cs_record_race",
      transferId: null,
      blockedCheckoutRefundRequired: true,
    });
    await database.exec(`
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES (
        'evt_record_race', 'checkout.session.completed', 'cs_record_race', 1,
        CURRENT_TIMESTAMP
      )
    `);
    const claim = await blockedClaim(database, {
      eventId: "evt_record_race",
      eventGeneration: 1,
      sessionId: "cs_record_race",
      orderId: "order-record-race",
    });
    await database.exec(`
      UPDATE public."Order" SET "fulfillmentStatus" = 'SHIPPED'
       WHERE id = 'order-record-race'
    `);
    await assert.rejects(
      database.query(`
        SELECT public.grainline_blocked_checkout_refund_record(
          'evt_record_race', 1, $1, $2, 're_RecordRace',
          'succeeded', NULL, NULL
        )
      `, [claim.claimId, claim.claimGeneration]),
      /claim is no longer active/,
    );
    assert.deepEqual(
      (await database.query(`
        SELECT "stockQuantity", status::text AS status
          FROM public."Listing" WHERE id = $1
      `, [listingId])).rows[0],
      { stockQuantity: 0, status: "SOLD_OUT" },
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
      blockedCheckoutRefundRequired: true,
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
          'public.grainline_blocked_checkout_refund_reconciliation_record(text,text,bigint,text,text,text,integer)',
          'EXECUTE'
        ) AS reconciliation_runtime,
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
          'public',
          'public.grainline_seller_refund_record(text,text,bigint,text,text,text,integer)',
          'EXECUTE'
        ) AS seller_public,
        pg_catalog.has_function_privilege(
          'public',
          'public.grainline_blocked_checkout_refund_reconciliation_record(text,text,bigint,text,text,text,integer)',
          'EXECUTE'
        ) AS reconciliation_public
    `)).rows[0];
    assert.deepEqual(privileges, {
      seller_runtime: true,
      blocked_runtime: true,
      resume_runtime: true,
      reconciliation_runtime: true,
      core_runtime: false,
      core_public: false,
      seller_public: false,
      reconciliation_public: false,
    });
  } finally {
    await database.close();
  }
});
