import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  caseCorrectnessDefinitions,
} from "../scripts/build-case-correctness-migration.mjs";

function extractFunction(sql, functionName) {
  const marker = `public.${functionName}(`;
  let markerIndex = -1;
  let start = -1;
  while (true) {
    markerIndex = sql.indexOf(marker, markerIndex + 1);
    assert.ok(markerIndex >= 0, `${functionName} marker is missing`);
    start = sql.lastIndexOf("CREATE OR REPLACE FUNCTION", markerIndex);
    if (start >= 0 && markerIndex - start < 160) break;
  }
  const closing = `$${functionName}$;`;
  const end = sql.indexOf(closing, start);
  assert.ok(end >= 0, `${functionName} closing delimiter is missing`);
  return sql.slice(start, end + closing.length);
}

test("Case refund provider recovery applies to disposable PostgreSQL", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE grainline_app_runtime;
      CREATE TYPE public."Role" AS ENUM ('USER', 'EMPLOYEE', 'ADMIN');
      CREATE TYPE public."CaseResolution" AS ENUM (
        'REFUND_FULL', 'REFUND_PARTIAL', 'DISMISSED'
      );
      CREATE TYPE public."CaseResolutionClaimStatus" AS ENUM (
        'LOCAL_READY',
        'PROVIDER_PENDING',
        'PROVIDER_RECORDED',
        'RECONCILIATION_REQUIRED',
        'FINALIZED',
        'RELEASED_NO_PROVIDER_EFFECT'
      );
      CREATE TYPE public."CaseStatus" AS ENUM (
        'OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE', 'UNDER_REVIEW',
        'RESOLVED', 'CLOSED'
      );
      CREATE TYPE public."LabelStatus" AS ENUM (
        'PURCHASED', 'EXPIRED', 'VOIDED'
      );
      SET check_function_bodies = off;

      CREATE TABLE public."User" (
        id text PRIMARY KEY,
        role public."Role" NOT NULL DEFAULT 'USER',
        banned boolean NOT NULL DEFAULT false,
        "deletedAt" timestamp(3)
      );
      CREATE TABLE public."Order" (
        id text PRIMARY KEY,
        "caseResolutionClaimId" text,
        "itemsSubtotalCents" integer NOT NULL DEFAULT 1000,
        "shippingAmountCents" integer NOT NULL DEFAULT 100,
        "giftWrappingPriceCents" integer,
        "taxAmountCents" integer NOT NULL DEFAULT 0,
        "stripePaymentIntentId" text,
        "stripeTransferId" text,
        "sellerRefundId" text,
        "sellerRefundLockedAt" timestamp(3),
        "labelStatus" public."LabelStatus",
        "labelClaimStatus" varchar(32),
        "paymentOpenDisputeBlocked" boolean NOT NULL DEFAULT false,
        "reviewNeeded" boolean NOT NULL DEFAULT false,
        "reviewNote" text
      );
      CREATE TABLE public."Case" (
        id text PRIMARY KEY,
        "orderId" text NOT NULL UNIQUE,
        "buyerId" text,
        "sellerId" text NOT NULL,
        status public."CaseStatus" NOT NULL DEFAULT 'OPEN',
        "resolvedAt" timestamp(3)
      );
      CREATE TABLE public."AdminAuditLog" (
        id text PRIMARY KEY,
        "adminId" text NOT NULL,
        action text NOT NULL,
        "targetType" text NOT NULL,
        "targetId" text NOT NULL,
        reason text,
        metadata jsonb,
        undone boolean NOT NULL DEFAULT false,
        "createdAt" timestamp(3) NOT NULL
      );
      CREATE TABLE public."CaseResolutionClaim" (
        id text PRIMARY KEY,
        "caseId" text NOT NULL,
        "orderId" text NOT NULL,
        "staffActorId" text NOT NULL,
        resolution public."CaseResolution" NOT NULL,
        "refundAmountCents" integer,
        currency varchar(3) NOT NULL,
        "stockRestorePlan" jsonb NOT NULL DEFAULT '[]'::jsonb,
        status public."CaseResolutionClaimStatus" NOT NULL,
        "idempotencyScope" varchar(191),
        "orderPaymentEventId" text,
        "providerRecordedAt" timestamp(3),
        "finalizedAt" timestamp(3),
        "reconciledAt" timestamp(3),
        "reconciledById" text,
        "reconciliationAction" varchar(40),
        "reconciliationReason" varchar(1000),
        "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const { corrected } = caseCorrectnessDefinitions();
    const claimSchema = readFileSync(
      "prisma/migrations/20260729024500_prepare_case_resolution_claim_schema/migration.sql",
      "utf8",
    );
    await db.exec(corrected.caseStaffProviderRecord);
    await db.exec(corrected.caseStaffFinalize);
    await db.exec(extractFunction(
      claimSchema,
      "grainline_case_resolution_claim_immutable",
    ));
    await db.exec(`
      REVOKE ALL ON FUNCTION
        public.grainline_case_staff_resolution_provider_record(
          text, text, text, text, text[], text[], text,
          integer, boolean, boolean
        )
        FROM PUBLIC, grainline_app_runtime;
      GRANT EXECUTE ON FUNCTION
        public.grainline_case_staff_resolution_provider_record(
          text, text, text, text, text[], text[], text,
          integer, boolean, boolean
        )
        TO grainline_app_runtime;
      REVOKE ALL ON FUNCTION
        public.grainline_case_staff_resolution_finalize(text, text)
        FROM PUBLIC, grainline_app_runtime;
      GRANT EXECUTE ON FUNCTION
        public.grainline_case_staff_resolution_finalize(text, text)
        TO grainline_app_runtime;
      REVOKE ALL ON FUNCTION
        public.grainline_case_resolution_claim_immutable()
        FROM PUBLIC, grainline_app_runtime;
    `);

    const migration = readFileSync(
      "prisma/migrations/20261001070000_prepare_case_refund_provider_recovery/migration.sql",
      "utf8",
    );
    await db.exec(migration);

    const columns = await db.query(`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'CaseResolutionClaim'
         AND column_name LIKE 'providerRecovery%'
       ORDER BY column_name
    `);
    assert.equal(columns.rows.length, 7);

    const functions = await db.query(`
      SELECT
        routine.proname AS function_name,
        routine.prosecdef AS security_definer,
        routine.proconfig AS function_config,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime', routine.oid, 'EXECUTE'
        ) AS runtime_execute,
        pg_catalog.has_function_privilege(
          'public', routine.oid, 'EXECUTE'
        ) AS public_execute
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'public'
        AND routine.proname IN (
          'grainline_case_staff_resolution_provider_recovery_load',
          'grainline_case_staff_resolution_provider_clock',
          'grainline_case_staff_resolution_provider_recover',
          'grainline_case_staff_resolution_provider_recovery_record',
          'grainline_case_staff_resolution_recovery_finalize'
        )
      ORDER BY routine.proname
    `);
    assert.equal(functions.rows.length, 5);
    assert.ok(functions.rows.every((row) => row.security_definer === true));
    assert.ok(functions.rows.every((row) => row.runtime_execute === true));
    assert.ok(functions.rows.every((row) => row.public_execute === false));
    assert.ok(functions.rows.every(
      (row) => JSON.stringify(row.function_config)
        === JSON.stringify(["search_path=pg_catalog"]),
    ));

    const direct = await db.query(`
      SELECT pg_catalog.has_table_privilege(
        'grainline_app_runtime',
        'public."CaseResolutionClaim"',
        'SELECT, INSERT, UPDATE, DELETE'
      ) AS direct_table_access
    `);
    assert.equal(direct.rows[0].direct_table_access, false);

    await db.exec(`
      INSERT INTO public."User" (id, role)
      VALUES ('staff-original', 'EMPLOYEE'), ('admin-recovery', 'ADMIN');

      INSERT INTO public."Order" (
        id, "caseResolutionClaimId", "stripePaymentIntentId",
        "stripeTransferId", "sellerRefundId", "sellerRefundLockedAt"
      ) VALUES
        ('order-pending', 'claim-pending', 'pi_pending', 'tr_pending',
         'pending', CURRENT_TIMESTAMP),
        ('order-recorded', 'claim-recorded', 'pi_recorded', 'tr_recorded',
         're_recorded', NULL);

      INSERT INTO public."Case" (
        id, "orderId", "buyerId", "sellerId", status
      ) VALUES
        ('case-pending', 'order-pending', 'buyer', 'seller', 'OPEN'),
        ('case-recorded', 'order-recorded', 'buyer', 'seller', 'OPEN');

      INSERT INTO public."CaseResolutionClaim" (
        id, "caseId", "orderId", "staffActorId", resolution,
        "refundAmountCents", currency, status, "idempotencyScope",
        "orderPaymentEventId", "providerRecordedAt", "createdAt", "updatedAt"
      ) VALUES
        ('claim-pending', 'case-pending', 'order-pending', 'staff-original',
         'REFUND_FULL', 1100, 'usd', 'PROVIDER_PENDING',
         'case-resolve:claim-pending:REFUND_FULL:1100', NULL, NULL,
         CURRENT_TIMESTAMP - INTERVAL '1 minute', CURRENT_TIMESTAMP),
        ('claim-recorded', 'case-recorded', 'order-recorded', 'staff-original',
         'REFUND_FULL', 1100, 'usd', 'PROVIDER_RECORDED',
         'case-resolve:claim-recorded:REFUND_FULL:1100', 'payment-recorded',
         CURRENT_TIMESTAMP - INTERVAL '30 seconds',
         CURRENT_TIMESTAMP - INTERVAL '2 minutes', CURRENT_TIMESTAMP);

      SELECT public.grainline_case_staff_resolution_provider_recover(
        'admin-recovery', 'claim-pending', 'RETRY_EXISTING_SCOPE',
        EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::bigint,
        pg_catalog.repeat('a', 64)
      );

      SELECT public.grainline_case_staff_resolution_provider_recover(
        'admin-recovery', 'claim-recorded', 'RECORD_DISCOVERED_EFFECT',
        EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::bigint,
        pg_catalog.repeat('b', 64)
      );
    `);

    const recovery = await db.query(`
      SELECT
        id,
        status::text AS status,
        "providerRecoveryAction" AS recovery_action,
        "providerRecoveryRecordedAt" IS NOT NULL AS recovery_recorded,
        "providerRecoveryRecordedAt" >= "providerRecoveryAuthorizedAt"
          AS recovery_clock_valid
      FROM public."CaseResolutionClaim"
      WHERE id IN ('claim-pending', 'claim-recorded')
      ORDER BY id
    `);
    assert.deepEqual(recovery.rows, [
      {
        id: "claim-pending",
        status: "PROVIDER_PENDING",
        recovery_action: "RETRY_EXISTING_SCOPE",
        recovery_recorded: false,
        recovery_clock_valid: null,
      },
      {
        id: "claim-recorded",
        status: "PROVIDER_RECORDED",
        recovery_action: "RECORD_DISCOVERED_EFFECT",
        recovery_recorded: true,
        recovery_clock_valid: true,
      },
    ]);

    const audits = await db.query(`
      SELECT action
      FROM public."AdminAuditLog"
      WHERE "targetId" = 'claim-recorded'
      ORDER BY action
    `);
    assert.deepEqual(
      audits.rows.map((row) => row.action),
      [
        "AUTHORIZE_CASE_RESOLUTION_PROVIDER_RECOVERY",
        "RECOVER_CASE_RESOLUTION_PROVIDER_RECORD",
      ],
    );
  } finally {
    await db.close();
  }
});
