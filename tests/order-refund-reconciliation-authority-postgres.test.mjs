import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const claimMigration = readFileSync(
  "prisma/migrations/20260824010000_prepare_order_refund_claim_generation/migration.sql",
  "utf8",
);
const reconciliationMigration = readFileSync(
  "prisma/migrations/20260824040000_prepare_order_refund_reconciliation_authority/migration.sql",
  "utf8",
);

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TYPE public."Role" AS ENUM ('USER', 'EMPLOYEE', 'ADMIN');
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      role public."Role" NOT NULL DEFAULT 'USER',
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
      "reviewNeeded" boolean NOT NULL DEFAULT false,
      "reviewNote" text
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Order"
      TO grainline_app_runtime;
  `);
  await database.exec(claimMigration);
  await database.exec(reconciliationMigration);
  await database.exec(`
    INSERT INTO public."User" (id, role) VALUES
      ('seller-user', 'USER'),
      ('employee-user', 'EMPLOYEE'),
      ('admin-user', 'ADMIN');
    INSERT INTO public."SellerProfile" (id, "userId")
      VALUES ('seller-profile', 'seller-user');
  `);
  return database;
}

async function seedAmbiguousClaim(database, orderId) {
  await database.query(`
    INSERT INTO public."Order" (
      id, "sellerProfileId", "paidAt", "stripePaymentIntentId",
      "stripeTransferId", currency, "itemsSubtotalCents",
      "shippingAmountCents", "giftWrappingPriceCents", "taxAmountCents"
    ) VALUES (
      $1, 'seller-profile', CURRENT_TIMESTAMP, 'pi_reconcile', 'tr_reconcile',
      'usd', 1000, 200, 50, 75
    )
  `, [orderId]);
  const claim = (await database.query(`
    SELECT public.grainline_seller_refund_claim(
      'seller-user', $1
    ) AS claim
  `, [orderId])).rows[0].claim;
  await database.query(`
    UPDATE public."Order"
       SET "sellerRefundId" = 'ambiguous_refund_pending_reconciliation'
     WHERE id = $1
  `, [orderId]);
  return claim;
}

async function prepare(database, actorId, orderId) {
  return (await database.query(`
    SELECT public.grainline_order_refund_reconciliation_prepare(
      $1, $2
    ) AS result
  `, [actorId, orderId])).rows[0].result;
}

async function reconcile(database, {
  claim,
  action,
  disposition,
  digest,
  reason = "Reviewed the exact Stripe claim metadata and payment intent.",
}) {
  const inspectedAt = Math.floor(Date.now() / 1000);
  return (await database.query(`
    SELECT public.grainline_order_refund_reconcile(
      'admin-user', $1, $2, $3, $4, $5, $6, $7
    ) AS result
  `, [
    claim.claimId,
    claim.claimGeneration,
    action,
    reason,
    inspectedAt,
    disposition,
    digest,
  ])).rows[0].result;
}

test("disposable PostgreSQL proves ADMIN inspection and safe short-window retry", async () => {
  const database = await createDatabase();
  try {
    const claim = await seedAmbiguousClaim(database, "order-retry");
    await assert.rejects(
      prepare(database, "employee-user", "order-retry"),
      /requires a current ADMIN/,
    );
    const prepared = await prepare(database, "admin-user", "order-retry");
    assert.equal(prepared.claimId, claim.claimId);
    assert.equal(prepared.state, "RECONCILIATION_REQUIRED");
    assert.equal(prepared.refundAmountCents, 1325);

    await assert.rejects(
      reconcile(database, {
        claim,
        action: "RETRY_EXISTING_SCOPE",
        disposition: "ABSENT",
        digest: DIGEST_A,
        reason: "short",
      }),
      /transition input is invalid/,
    );

    const result = await reconcile(database, {
      claim,
      action: "RETRY_EXISTING_SCOPE",
      disposition: "ABSENT",
      digest: DIGEST_A,
    });
    assert.equal(result.action, "retry_authorized");
    assert.equal(
      (await database.query(`
        SELECT "sellerRefundId" FROM public."Order"
         WHERE id = 'order-retry'
      `)).rows[0].sellerRefundId,
      "pending",
    );
    assert.equal(
      (await database.query(`
        SELECT pg_catalog.count(*)::integer AS count
          FROM public."OrderRefundReconciliation"
         WHERE "claimId" = $1
      `, [claim.claimId])).rows[0].count,
      1,
    );
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL accepts evidence from the same whole second as claim authority", async () => {
  const database = await createDatabase();
  try {
    const claim = await seedAmbiguousClaim(database, "order-same-second");
    const authorizedAt = (await database.query(`
      SELECT pg_catalog.floor(EXTRACT(EPOCH FROM (
        "refundClaimProviderAuthorizedAt" AT TIME ZONE 'UTC'
      )))::bigint AS seconds
        FROM public."Order"
       WHERE id = 'order-same-second'
    `)).rows[0].seconds;
    const result = (await database.query(`
      SELECT public.grainline_order_refund_reconcile(
        'admin-user', $1, $2, 'RETRY_EXISTING_SCOPE',
        'Reviewed provider absence in the exact claim second.',
        $3, 'ABSENT', $4
      ) AS result
    `, [claim.claimId, claim.claimGeneration, authorizedAt, DIGEST_A])).rows[0]
      .result;
    assert.equal(result.action, "retry_authorized");
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL authorizes a confirmed provider effect but rejects mismatched evidence", async () => {
  const database = await createDatabase();
  try {
    const claim = await seedAmbiguousClaim(database, "order-effect");
    await assert.rejects(
      reconcile(database, {
        claim,
        action: "CONFIRMED_PROVIDER_EFFECT",
        disposition: "ABSENT",
        digest: DIGEST_A,
      }),
      /no confirmed provider effect/,
    );
    const result = await reconcile(database, {
      claim,
      action: "CONFIRMED_PROVIDER_EFFECT",
      disposition: "USABLE_REFUND",
      digest: DIGEST_B,
    });
    assert.equal(result.action, "provider_effect_authorized");
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL derives the ambiguous sentinel from a closed reason code", async () => {
  const database = await createDatabase();
  try {
    await database.exec(`
      INSERT INTO public."Order" (
        id, "sellerProfileId", "paidAt", "stripePaymentIntentId",
        "stripeTransferId", currency, "itemsSubtotalCents"
      ) VALUES (
        'order-ambiguous', 'seller-profile', CURRENT_TIMESTAMP,
        'pi_ambiguous', 'tr_ambiguous', 'usd', 1000
      )
    `);
    const claim = (await database.query(`
      SELECT public.grainline_seller_refund_claim(
        'seller-user', 'order-ambiguous'
      ) AS claim
    `)).rows[0].claim;
    await assert.rejects(
      database.query(`
        SELECT public.grainline_order_refund_claim_mark_ambiguous(
          $1, $2, 'CALLER_SELECTED_TEXT'
        )
      `, [claim.claimId, claim.claimGeneration]),
      /ambiguous transition input is invalid/,
    );
    const result = (await database.query(`
      SELECT public.grainline_order_refund_claim_mark_ambiguous(
        $1, $2, 'SELLER_PROVIDER_AMBIGUOUS'
      ) AS result
    `, [claim.claimId, claim.claimGeneration])).rows[0].result;
    assert.equal(result.action, "recorded");
    assert.deepEqual(
      (await database.query(`
        SELECT "sellerRefundId", "sellerRefundLockedAt", "reviewNeeded"
          FROM public."Order" WHERE id = 'order-ambiguous'
      `)).rows[0],
      {
        sellerRefundId: "ambiguous_refund_pending_reconciliation",
        sellerRefundLockedAt: null,
        reviewNeeded: true,
      },
    );
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL releases only aged exact no-effect claims and retains immutable evidence", async () => {
  const database = await createDatabase();
  try {
    const claim = await seedAmbiguousClaim(database, "order-release");
    await assert.rejects(
      reconcile(database, {
        claim,
        action: "CONFIRMED_NO_PROVIDER_EFFECT",
        disposition: "ABSENT",
        digest: DIGEST_A,
      }),
      /cannot be released as no-effect/,
    );
    await database.exec(`
      UPDATE public."Order"
         SET "refundClaimProviderAuthorizedAt" =
               CURRENT_TIMESTAMP - INTERVAL '26 hours'
       WHERE id = 'order-release'
    `);
    const released = await reconcile(database, {
      claim,
      action: "CONFIRMED_NO_PROVIDER_EFFECT",
      disposition: "TERMINAL_NO_EFFECT",
      digest: DIGEST_C,
    });
    assert.equal(released.action, "released_no_provider_effect");
    assert.deepEqual(
      (await database.query(`
        SELECT "sellerRefundId", "refundClaimId",
               "refundClaimGeneration", "reviewNeeded"
          FROM public."Order" WHERE id = 'order-release'
      `)).rows[0],
      {
        sellerRefundId: null,
        refundClaimId: null,
        refundClaimGeneration: 1,
        reviewNeeded: true,
      },
    );
    const evidence = (await database.query(`
      SELECT action, "providerDisposition", "providerEvidenceSha256"
        FROM public."OrderRefundReconciliation"
       WHERE "claimId" = $1
    `, [claim.claimId])).rows[0];
    assert.deepEqual(evidence, {
      action: "CONFIRMED_NO_PROVIDER_EFFECT",
      providerDisposition: "TERMINAL_NO_EFFECT",
      providerEvidenceSha256: DIGEST_C,
    });
    await assert.rejects(
      database.query(`
        UPDATE public."OrderRefundReconciliation"
           SET reason = 'rewritten'
         WHERE "claimId" = $1
      `, [claim.claimId]),
      /evidence is immutable/,
    );
    await assert.rejects(
      database.query(`
        DELETE FROM public."OrderRefundReconciliation"
         WHERE "claimId" = $1
      `, [claim.claimId]),
      /evidence is immutable/,
    );
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL keeps the ledger table private and fixed functions runtime-only", async () => {
  const database = await createDatabase();
  try {
    const acl = (await database.query(`
      SELECT
        pg_catalog.has_table_privilege(
          'grainline_app_runtime',
          'public."OrderRefundReconciliation"',
          'SELECT,INSERT,UPDATE,DELETE'
        ) AS table_acl,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_order_refund_reconciliation_prepare(text,text)',
          'EXECUTE'
        ) AS prepare_acl,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_order_refund_claim_mark_ambiguous(text,bigint,text)',
          'EXECUTE'
        ) AS ambiguous_acl,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_order_refund_reconcile(text,text,bigint,text,text,bigint,text,text)',
          'EXECUTE'
        ) AS reconcile_acl,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_blocked_checkout_refund_reconciliation_record(text,text,bigint,text,text,text,integer)',
          'EXECUTE'
        ) AS blocked_record_acl,
        pg_catalog.has_function_privilege(
          'public',
          'public.grainline_order_refund_reconcile(text,text,bigint,text,text,bigint,text,text)',
          'EXECUTE'
        ) AS public_acl
    `)).rows[0];
    assert.deepEqual(acl, {
      table_acl: false,
      prepare_acl: true,
      ambiguous_acl: true,
      reconcile_acl: true,
      blocked_record_acl: true,
      public_acl: false,
    });
  } finally {
    await database.close();
  }
});
