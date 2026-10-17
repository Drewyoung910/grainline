#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const CASE_REFUND_FOLLOWUP_MIGRATION =
  "20261016011000_correct_case_refund_followup_deadends";
export const CASE_REFUND_RECOVERY_CORE_MIGRATION =
  "20261016010000_correct_case_refund_recovery_core";
const ORDER_OPS_HEALTH_MIGRATION =
  "20260930033000_order_ops_health_summary";

const isolatedMigrationPaths = new Map([
  [
    CASE_REFUND_RECOVERY_CORE_MIGRATION,
    process.env.CASE_REFUND_RECOVERY_CORE_MIGRATION_PATH?.trim(),
  ],
  [
    CASE_REFUND_FOLLOWUP_MIGRATION,
    process.env.CASE_REFUND_FOLLOWUP_MIGRATION_PATH?.trim(),
  ],
  [
    ORDER_OPS_HEALTH_MIGRATION,
    process.env.ORDER_OPS_HEALTH_MIGRATION_PATH?.trim(),
  ],
]);

const sha256 = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex");

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `${label} predecessor text is missing`);
  assert.equal(
    source.indexOf(before, first + before.length),
    -1,
    `${label} predecessor text is ambiguous`,
  );
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function extractFunctionDefinition(sql, functionName) {
  const markers = [
    `CREATE OR REPLACE FUNCTION public.${functionName}(`,
    `CREATE FUNCTION public.${functionName}(`,
  ];
  const matches = markers
    .map((marker) => ({ marker, start: sql.indexOf(marker) }))
    .filter(({ start }) => start >= 0);
  assert.equal(matches.length, 1, `${functionName} definition is not unique`);
  const { marker, start } = matches[0];
  assert.equal(
    sql.indexOf(marker, start + marker.length),
    -1,
    `${functionName} definition is ambiguous`,
  );
  const opening = /AS (\$[A-Za-z0-9_]+\$)/u.exec(sql.slice(start));
  assert.ok(opening, `${functionName} body delimiter is missing`);
  const delimiter = opening[1];
  const openingStart = start + opening.index;
  const bodyStart = openingStart + opening[0].length;
  const closingStart = sql.indexOf(delimiter, bodyStart);
  assert.ok(closingStart >= 0, `${functionName} closing delimiter is missing`);
  const semicolon = sql.indexOf(";", closingStart + delimiter.length);
  assert.ok(semicolon >= 0, `${functionName} terminator is missing`);
  return sql
    .slice(start, semicolon + 1)
    .replace(/^CREATE FUNCTION/u, "CREATE OR REPLACE FUNCTION");
}

function extractFunctionSource(definition) {
  const opening = /AS (\$[A-Za-z0-9_]+\$)/u.exec(definition);
  assert.ok(opening, "function source delimiter is missing");
  const delimiter = opening[1];
  const bodyStart = opening.index + opening[0].length;
  const closingStart = definition.indexOf(delimiter, bodyStart);
  assert.ok(closingStart >= 0, "function source closing delimiter is missing");
  return definition.slice(bodyStart, closingStart);
}

function readMigration(rootDirectory, migration) {
  const isolatedPath = isolatedMigrationPaths.get(migration);
  return fs.readFileSync(
    isolatedPath ||
      path.join(rootDirectory, "prisma/migrations", migration, "migration.sql"),
    "utf8",
  );
}

function correctStockFinalizer(definition, label) {
  let corrected = replaceExactlyOnce(
    definition,
    `  restored_active_count integer := 0;\n  changed_count integer;`,
    `  restored_active_count integer := 0;\n  skipped_stock_restore_count integer := 0;\n  changed_count integer;`,
    `${label} skipped-stock declaration`,
  );
  corrected = replaceExactlyOnce(
    corrected,
    `  IF pg_catalog.jsonb_array_length(locked_claim."stockRestorePlan") > 0
     AND locked_order."fulfillmentStatus" IN (
       'SHIPPED'::public."FulfillmentStatus",
       'DELIVERED'::public."FulfillmentStatus",
       'PICKED_UP'::public."FulfillmentStatus"
     ) THEN`,
    `  IF locked_order."fulfillmentStatus" IN (
       'SHIPPED'::public."FulfillmentStatus",
       'DELIVERED'::public."FulfillmentStatus",
       'PICKED_UP'::public."FulfillmentStatus"
     )
     AND EXISTS (
       SELECT 1
         FROM pg_catalog.jsonb_array_elements(
           locked_claim."stockRestorePlan"
         ) AS plan(value)
         JOIN public."Listing" AS listing
           ON listing.id = plan.value->>'listingId'
        WHERE listing."listingType" = 'IN_STOCK'::public."ListingType"
     ) THEN`,
    `${label} fulfilled-stock fence`,
  );
  corrected = replaceExactlyOnce(
    corrected,
    `    purchased AS (
      SELECT
        item."listingId" AS listing_id,
        pg_catalog.sum(item.quantity)::integer AS quantity
      FROM public."OrderItem" AS item
      JOIN public."Listing" AS listing ON listing.id = item."listingId"
      WHERE item."orderId" = locked_order.id
        AND listing."listingType" = 'IN_STOCK'::public."ListingType"
      GROUP BY item."listingId"
    )`,
    `    purchased AS (
      SELECT
        item."listingId" AS listing_id,
        pg_catalog.sum(item.quantity)::integer AS quantity
      FROM public."OrderItem" AS item
      WHERE item."orderId" = locked_order.id
      GROUP BY item."listingId"
    )`,
    `${label} immutable purchase validation`,
  );
  corrected = replaceExactlyOnce(
    corrected,
    `    IF changed_count <> 1 THEN
      RAISE EXCEPTION 'Case finalization stock target disappeared'
        USING ERRCODE = '40001';
    END IF;`,
    `    IF changed_count <> 1 THEN
      IF EXISTS (
        SELECT 1
          FROM public."Listing" AS listing
         WHERE listing.id = plan_listing_id
           AND listing."listingType" <>
                 'IN_STOCK'::public."ListingType"
      ) THEN
        skipped_stock_restore_count := skipped_stock_restore_count + 1;
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'Case finalization stock target disappeared'
        USING ERRCODE = '40001';
    END IF;`,
    `${label} changed listing-type handling`,
  );
  corrected = replaceExactlyOnce(
    corrected,
    `      'resolutionMessageId', message_id,
      'at', transition_at`,
    `      'resolutionMessageId', message_id,
      'skippedStockRestoreCount', skipped_stock_restore_count,
      'at', transition_at`,
    `${label} audit skipped-stock evidence`,
  );
  corrected = replaceExactlyOnce(
    corrected,
    `      'stockStatusRestoredCount', 0,
      'status', 'FINALIZED',`,
    `      'stockStatusRestoredCount', 0,
      'skippedStockRestoreCount', 0,
      'status', 'FINALIZED',`,
    `${label} replay skipped-stock evidence`,
  );
  corrected = replaceExactlyOnce(
    corrected,
    `    'stockStatusRestoredCount', restored_active_count,
    'status', 'FINALIZED',`,
    `    'stockStatusRestoredCount', restored_active_count,
    'skippedStockRestoreCount', skipped_stock_restore_count,
    'status', 'FINALIZED',`,
    `${label} result skipped-stock evidence`,
  );
  return corrected;
}

function correctedFunctions(rootDirectory) {
  const core = readMigration(
    rootDirectory,
    CASE_REFUND_RECOVERY_CORE_MIGRATION,
  );
  const refundMigration = readMigration(
    rootDirectory,
    "20260828010000_prepare_order_payment_signed_refund_identity",
  );
  const disputeMigration = readMigration(
    rootDirectory,
    "20260828020000_correct_order_payment_signed_dispute_identity",
  );
  const projectionMigration = readMigration(
    rootDirectory,
    "20260830010000_prepare_order_payment_event_aggregate_authority",
  );
  const healthMigration = readMigration(
    rootDirectory,
    ORDER_OPS_HEALTH_MIGRATION,
  );

  const functions = [
    {
      name: "grainline_case_staff_resolution_prepare",
      identity:
        'public.grainline_case_staff_resolution_prepare(text,text,public."CaseResolution",integer,jsonb)',
      predecessor:
        "151ee58a079a31f106d43d449d22836fda92183cbe338df3a0f733c80f0ab4b6",
      definition: extractFunctionDefinition(
        core,
        "grainline_case_staff_resolution_prepare",
      ),
    },
    {
      name: "grainline_case_staff_resolution_finalize",
      identity: "public.grainline_case_staff_resolution_finalize(text,text)",
      predecessor:
        "7c0033c9bc26e7f42ebec452e808e4aa8ac1a339710a2f25393ba34173fbd7de",
      definition: extractFunctionDefinition(
        core,
        "grainline_case_staff_resolution_finalize",
      ),
    },
    {
      name: "grainline_case_staff_resolution_provider_recovery_load",
      identity:
        'public.grainline_case_staff_resolution_provider_recovery_load(text,text,public."CaseResolution",integer)',
      predecessor:
        "e7a810360957b526a2cbc3e3af74d9bde4dca2bc658fccc4c58008b8c34c7ce5",
      definition: extractFunctionDefinition(
        core,
        "grainline_case_staff_resolution_provider_recovery_load",
      ),
    },
    {
      name: "grainline_case_staff_resolution_recovery_finalize",
      identity:
        "public.grainline_case_staff_resolution_recovery_finalize(text,text)",
      predecessor:
        "3fa0b657266a91846b0dd2294d289c8162248ca2a6b6ec07c09be1683fde86b3",
      definition: extractFunctionDefinition(
        core,
        "grainline_case_staff_resolution_recovery_finalize",
      ),
    },
    {
      name: "grainline_order_payment_signed_refund_apply",
      identity:
        "public.grainline_order_payment_signed_refund_apply(text,bigint,text,bigint,integer,text,text,integer,text,bigint,text)",
      predecessor:
        "382958aba3a01b33431033c3a04370141d380f79b01aed9a1d6492ea58cee3f4",
      definition: extractFunctionDefinition(
        refundMigration,
        "grainline_order_payment_signed_refund_apply",
      ),
    },
    {
      name: "grainline_order_payment_signed_dispute_apply",
      identity:
        "public.grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)",
      predecessor:
        "9507c46dedf252030f38c62d820fc8569376f9dfb888187980094294a244b96e",
      definition: extractFunctionDefinition(
        disputeMigration,
        "grainline_order_payment_signed_dispute_apply",
      ),
    },
    {
      name: "grainline_order_payment_projection_state",
      identity: "public.grainline_order_payment_projection_state(text)",
      predecessor:
        "ad3cd33562a5e92b0639322a28a5675d4264777988153801b0d70ed0983f7f79",
      runtimeExecute: false,
      definition: extractFunctionDefinition(
        projectionMigration,
        "grainline_order_payment_projection_state",
      ),
    },
    {
      name: "grainline_order_ops_health_summary",
      identity: "public.grainline_order_ops_health_summary()",
      predecessor:
        "37e7214b0963fe011a32be83375a1eac5ed6217fa85b5c53595306ac60b2a323",
      definition: extractFunctionDefinition(
        healthMigration,
        "grainline_order_ops_health_summary",
      ),
    },
  ];

  for (const item of functions) {
    assert.equal(
      sha256(extractFunctionSource(item.definition)),
      item.predecessor,
      `${item.name} predecessor source drifted`,
    );
  }

  const prepare = functions.find(
    ({ name }) => name === "grainline_case_staff_resolution_prepare",
  );
  prepare.definition = replaceExactlyOnce(
    prepare.definition,
    `  transition_at timestamp(3);\nBEGIN`,
    `  transition_at timestamp(3);\n  historical_refund_event_id text;\nBEGIN`,
    "#710 prepare historical event declaration",
  );
  prepare.definition = replaceExactlyOnce(
    prepare.definition,
    `      claim."idempotencyScope",
      claim."orderPaymentEventId"
      INTO existing_claim`,
    `      claim."idempotencyScope",
      claim."orderPaymentEventId",
      claim."createdAt"
      INTO existing_claim`,
    "#710 prepare claim timestamp evidence",
  );
  prepare.definition = replaceExactlyOnce(
    prepare.definition,
    `    IF existing_claim.status =
         'PROVIDER_PENDING'::public."CaseResolutionClaimStatus" THEN`,
    `    -- #710: repair the exact historical state created when a signed
    -- charge.refunded event overwrote an ambiguous Case marker. The Order is
    -- locked, the active claim is exact, and the signed ledger row must carry
    -- the false pending-local-lock value written by the predecessor after the
    -- ambiguous marker was overwritten.
    IF existing_claim.status =
         'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
       AND locked_order."sellerRefundId" IS NOT NULL
       AND locked_order."sellerRefundId" NOT IN (
         'pending',
         'ambiguous_refund_pending_reconciliation'
       )
       AND locked_order."sellerRefundLockedAt" IS NULL
       AND existing_claim."orderPaymentEventId" IS NULL THEN
      SELECT refund_event.id
        INTO historical_refund_event_id
        FROM public."OrderPaymentEvent" AS refund_event
       WHERE refund_event."orderId" = locked_order.id
         AND refund_event."eventType" = 'REFUND'
         AND refund_event."stripeObjectType" = 'refund'
         AND refund_event."stripeEventId" ~ '^evt_'
         AND refund_event."stripeObjectId" = locked_order."sellerRefundId"
         AND refund_event.currency = existing_claim.currency
         AND refund_event.metadata->>'totalRefundedCents' =
               existing_claim."refundAmountCents"::text
         AND refund_event.metadata->>'pendingLocalRefundLock' = 'false'
         AND refund_event.metadata->>'caseResolutionClaimId' IS NULL
         AND refund_event."createdAt" >= existing_claim."createdAt"
         AND (
           refund_event.status IS NULL
           OR pg_catalog.lower(refund_event.status)
                NOT IN ('failed', 'canceled', 'cancelled')
         )
       ORDER BY refund_event."createdAt" DESC, refund_event.id DESC
       LIMIT 1
       FOR SHARE;
      IF FOUND THEN
        transition_at :=
          pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
        UPDATE public."Order" AS orders
           SET "sellerRefundId" =
                 'ambiguous_refund_pending_reconciliation',
               "reviewNeeded" = true,
               "reviewNote" =
                 'Case refund marker restored for provider reconciliation.'
         WHERE orders.id = locked_order.id
           AND orders."caseResolutionClaimId" = existing_claim.id
           AND orders."sellerRefundId" = locked_order."sellerRefundId"
           AND orders."sellerRefundLockedAt" IS NULL;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Case refund marker repair lease was lost'
            USING ERRCODE = '40001';
        END IF;
        INSERT INTO public."AdminAuditLog" (
          id, "adminId", action, "targetType", "targetId", reason,
          metadata, undone, "createdAt"
        ) VALUES (
          'case-refund-marker-repair-audit:'
            || pg_catalog.gen_random_uuid()::text,
          locked_actor.id,
          'REPAIR_CASE_REFUND_RECONCILIATION_MARKER',
          'CASE_RESOLUTION_CLAIM',
          existing_claim.id,
          'signed_refund_overwrote_ambiguous_marker',
          pg_catalog.jsonb_build_object(
            'caseId', locked_case.id,
            'orderId', locked_order.id,
            'orderPaymentEventId', historical_refund_event_id,
            'overwrittenRefundId', locked_order."sellerRefundId"
          ),
          false,
          transition_at
        );
        locked_order."sellerRefundId" :=
          'ambiguous_refund_pending_reconciliation';
      END IF;
    END IF;

    IF existing_claim.status =
         'PROVIDER_PENDING'::public."CaseResolutionClaimStatus" THEN`,
    "#710 prepare historical marker normalization",
  );
  prepare.definition = replaceExactlyOnce(
    prepare.definition,
    `              AND (
                refund_event.status IS NULL
                OR pg_catalog.lower(refund_event.status)
                     NOT IN ('failed', 'canceled', 'cancelled')
              )
         ) THEN`,
    `              AND (
                refund_event.status IS NULL
                OR pg_catalog.lower(refund_event.status)
                     NOT IN ('failed', 'canceled', 'cancelled')
              )
              AND NOT (
                refund_event.metadata->>'pendingLocalRefundLock' = 'true'
                AND (
                  refund_event.metadata->>'caseResolutionClaimId'
                    IS NULL
                  OR refund_event.metadata->>'caseResolutionClaimId' =
                       existing_claim.id
                )
              )
         ) THEN`,
    "#712 own signed refund replay exclusion",
  );

  const recoveryLoad = functions.find(
    ({ name }) =>
      name === "grainline_case_staff_resolution_provider_recovery_load",
  );
  recoveryLoad.definition = replaceExactlyOnce(
    recoveryLoad.definition,
    `  audit_id text;\nBEGIN`,
    `  audit_id text;\n  historical_refund_event_id text;\nBEGIN`,
    "#710 recovery-load historical event declaration",
  );
  recoveryLoad.definition = replaceExactlyOnce(
    recoveryLoad.definition,
    `    claim."providerRecoveryAuthorizedAt",
    claim."providerRecoveryRecordedAt",
    claim."providerRecoveryFinalizedAt"
    INTO locked_claim`,
    `    claim."providerRecoveryAuthorizedAt",
    claim."providerRecoveryRecordedAt",
    claim."providerRecoveryFinalizedAt",
    claim."createdAt"
    INTO locked_claim`,
    "#710 recovery-load claim timestamp evidence",
  );
  recoveryLoad.definition = replaceExactlyOnce(
    recoveryLoad.definition,
    `  IF locked_claim.status =
       'PROVIDER_PENDING'::public."CaseResolutionClaimStatus" THEN`,
    `  -- #710: normalize the same exact historical marker for a successor
  -- ADMIN loading provider recovery directly after prepare returned 23505.
  IF locked_claim.status =
       'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
     AND locked_order."sellerRefundId" IS NOT NULL
     AND locked_order."sellerRefundId" NOT IN (
       'pending',
       'ambiguous_refund_pending_reconciliation'
     )
     AND locked_order."sellerRefundLockedAt" IS NULL
     AND locked_claim."orderPaymentEventId" IS NULL THEN
    SELECT refund_event.id
      INTO historical_refund_event_id
      FROM public."OrderPaymentEvent" AS refund_event
     WHERE refund_event."orderId" = locked_order.id
       AND refund_event."eventType" = 'REFUND'
       AND refund_event."stripeObjectType" = 'refund'
       AND refund_event."stripeEventId" ~ '^evt_'
       AND refund_event."stripeObjectId" = locked_order."sellerRefundId"
       AND refund_event.currency = locked_claim.currency
       AND refund_event.metadata->>'totalRefundedCents' =
             locked_claim."refundAmountCents"::text
       AND refund_event.metadata->>'pendingLocalRefundLock' = 'false'
       AND refund_event.metadata->>'caseResolutionClaimId' IS NULL
       AND refund_event."createdAt" >= locked_claim."createdAt"
       AND (
         refund_event.status IS NULL
         OR pg_catalog.lower(refund_event.status)
              NOT IN ('failed', 'canceled', 'cancelled')
       )
     ORDER BY refund_event."createdAt" DESC, refund_event.id DESC
     LIMIT 1
     FOR SHARE;
    IF FOUND THEN
      transition_at :=
        pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
      UPDATE public."Order" AS orders
         SET "sellerRefundId" =
               'ambiguous_refund_pending_reconciliation',
             "reviewNeeded" = true,
             "reviewNote" =
               'Case refund marker restored for provider reconciliation.'
       WHERE orders.id = locked_order.id
         AND orders."caseResolutionClaimId" = locked_claim.id
         AND orders."sellerRefundId" = locked_order."sellerRefundId"
         AND orders."sellerRefundLockedAt" IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Case refund marker repair lease was lost'
          USING ERRCODE = '40001';
      END IF;
      INSERT INTO public."AdminAuditLog" (
        id, "adminId", action, "targetType", "targetId", reason,
        metadata, undone, "createdAt"
      ) VALUES (
        'case-refund-marker-repair-audit:'
          || pg_catalog.gen_random_uuid()::text,
        locked_actor.id,
        'REPAIR_CASE_REFUND_RECONCILIATION_MARKER',
        'CASE_RESOLUTION_CLAIM',
        locked_claim.id,
        'signed_refund_overwrote_ambiguous_marker',
        pg_catalog.jsonb_build_object(
          'caseId', locked_case.id,
          'orderId', locked_order.id,
          'orderPaymentEventId', historical_refund_event_id,
          'overwrittenRefundId', locked_order."sellerRefundId"
        ),
        false,
        transition_at
      );
      locked_order."sellerRefundId" :=
        'ambiguous_refund_pending_reconciliation';
    END IF;
  END IF;

  IF locked_claim.status =
       'PROVIDER_PENDING'::public."CaseResolutionClaimStatus" THEN`,
    "#710 recovery-load historical marker normalization",
  );

  const finalize = functions.find(
    ({ name }) => name === "grainline_case_staff_resolution_finalize",
  );
  finalize.definition = correctStockFinalizer(
    finalize.definition,
    "staff finalizer #713",
  );
  const recoveryFinalize = functions.find(
    ({ name }) => name === "grainline_case_staff_resolution_recovery_finalize",
  );
  recoveryFinalize.definition = correctStockFinalizer(
    recoveryFinalize.definition,
    "recovery finalizer #713",
  );

  const refund = functions.find(
    ({ name }) => name === "grainline_order_payment_signed_refund_apply",
  );
  refund.definition = replaceExactlyOnce(
    refund.definition,
    `  has_active_claim :=
    source_order."refundClaimId" IS NOT NULL
    OR (
      source_order."sellerRefundId" = 'pending'
      AND (
        source_order."caseResolutionClaimId" IS NOT NULL
        OR (
          source_order."sellerRefundLockedAt" IS NOT NULL
          AND source_order."sellerRefundLockedAt" >= source_now - INTERVAL '15 minutes'
        )
      )
    );`,
    `  has_active_claim :=
    source_order."refundClaimId" IS NOT NULL
    OR (
      source_order."caseResolutionClaimId" IS NOT NULL
      AND source_order."sellerRefundId" IN (
        'pending',
        'ambiguous_refund_pending_reconciliation'
      )
    )
    OR (
      source_order."sellerRefundId" = 'pending'
      AND source_order."sellerRefundLockedAt" IS NOT NULL
      AND source_order."sellerRefundLockedAt" >= source_now - INTERVAL '15 minutes'
    );`,
    "#710 active ambiguous Case claim",
  );
  refund.definition = replaceExactlyOnce(
    refund.definition,
    `    'pendingLocalRefundLock', has_active_claim,
    'orderTotalCents', order_total,`,
    `    'pendingLocalRefundLock', has_active_claim,
    'caseResolutionClaimId', CASE
      WHEN has_active_claim THEN source_order."caseResolutionClaimId"
      ELSE NULL
    END,
    'orderTotalCents', order_total,`,
    "#710/#712 Case claim correlation",
  );

  const dispute = functions.find(
    ({ name }) => name === "grainline_order_payment_signed_dispute_apply",
  );
  dispute.definition = replaceExactlyOnce(
    dispute.definition,
    `         OR equal_payment.reason IS DISTINCT FROM normalized_reason
         OR equal_payment.metadata->>'stripeEventType'
              IS DISTINCT FROM source_event.type
       )`,
    `         OR equal_payment.reason IS DISTINCT FROM normalized_reason
         OR (
           source_event.type = 'charge.dispute.created'
           AND equal_payment.metadata->>'stripeEventType'
                 IS DISTINCT FROM source_event.type
           AND NOT EXISTS (
             SELECT 1
               FROM public."Case" AS case_row
              WHERE case_row."orderId" = source_order.id
           )
         )
       )`,
    "#714 same-second dispute equivalence",
  );
  dispute.definition = replaceExactlyOnce(
    dispute.definition,
    `              AND orders."refundClaimId" IS NULL
              AND (
                orders."sellerRefundLockedAt" IS NULL`,
    `              AND orders."refundClaimId" IS NULL
              AND orders."caseResolutionClaimId" IS NULL
              AND (
                orders."sellerRefundLockedAt" IS NULL`,
    "#711 preserve Case refund lock",
  );

  const projection = functions.find(
    ({ name }) => name === "grainline_order_payment_projection_state",
  );
  projection.definition = replaceExactlyOnce(
    projection.definition,
    `                   payment.status,
                   payment.reason,
                   payment.metadata->>'stripeEventType'
                 )) > 1`,
    `                   payment.status,
                   payment.reason
                 )) > 1`,
    "#714 projection same-second tuple",
  );

  const health = functions.find(
    ({ name }) => name === "grainline_order_ops_health_summary",
  );
  health.definition = replaceExactlyOnce(
    health.definition,
    `         WHERE source_order."sellerRefundId" = 'pending'
           AND COALESCE(
             source_order."refundClaimProviderAuthorizedAt",
             source_order."sellerRefundLockedAt",
             source_order."paidAt",
             source_order."createdAt"
           ) < source_clock.now_utc - interval '30 minutes'`,
    `         WHERE (
           source_order."sellerRefundId" = 'pending'
           AND COALESCE(
             source_order."refundClaimProviderAuthorizedAt",
             source_order."sellerRefundLockedAt",
             source_order."paidAt",
             source_order."createdAt"
           ) < source_clock.now_utc - interval '30 minutes'
         )
         OR EXISTS (
           SELECT 1
             FROM public."CaseResolutionClaim" AS case_claim
            WHERE case_claim.id = source_order."caseResolutionClaimId"
              AND case_claim.status NOT IN (
                'FINALIZED'::public."CaseResolutionClaimStatus",
                'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus"
              )
              AND case_claim."createdAt" <
                    source_clock.now_utc - interval '1 hour'
         )`,
    "#710 aged active Case claim health count",
  );

  return functions.map((item) => ({
    ...item,
    runtimeExecute: item.runtimeExecute ?? true,
    successor: sha256(extractFunctionSource(item.definition)),
  }));
}

export function buildCaseRefundFollowupCorrection(rootDirectory = ROOT) {
  const functions = correctedFunctions(rootDirectory);
  const predecessor = Object.fromEntries(
    functions.map(({ identity, predecessor: hash, runtimeExecute }) => [
      identity,
      { sha: hash, runtime: runtimeExecute },
    ]),
  );
  const successor = Object.fromEntries(
    functions.map(({ identity, successor: hash }) => [identity, hash]),
  );
  const definitions = functions.map(({ definition }) => definition).join("\n\n");
  return `-- Close verified Case-refund recovery dead ends (#710-#714).
-- Function signatures, owners, SECURITY DEFINER settings, search paths, and
-- ACLs are preserved. No table, trigger, constraint, or grant changes occur.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.case.refund-followup-deadends.correction',
    0
  )
);

CREATE TEMP TABLE _case_followup_fn_snapshot (
  sig text PRIMARY KEY, owner text, secdef boolean, cfg text[], acl text
);

DO $preflight$
DECLARE
  expected jsonb := '${JSON.stringify(predecessor).replaceAll("'", "''")}'::jsonb;
  item record;
  fn regprocedure;
  actual text;
BEGIN
  FOR item IN
    SELECT key,
           value->>'sha' AS sha,
           (value->>'runtime')::boolean AS runtime
      FROM pg_catalog.jsonb_each(expected)
  LOOP
    fn := pg_catalog.to_regprocedure(item.key);
    IF fn IS NULL THEN
      RAISE EXCEPTION 'case follow-up preflight: % is missing', item.key;
    END IF;
    SELECT pg_catalog.encode(
             pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')),
             'hex'
           )
      INTO actual
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = fn
       AND p.prosecdef
       AND p.proconfig = ARRAY['search_path=pg_catalog']::text[];
    IF actual IS DISTINCT FROM item.sha
       OR pg_catalog.has_function_privilege(
         'grainline_app_runtime', fn, 'EXECUTE'
       ) IS DISTINCT FROM item.runtime
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_proc AS p,
                LATERAL pg_catalog.aclexplode(
                  COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
                ) AS acl
          WHERE p.oid = fn
            AND acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'case follow-up preflight: % drifted', item.key;
    END IF;
    INSERT INTO _case_followup_fn_snapshot
    SELECT item.key, pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef,
           p.proconfig, COALESCE(p.proacl::text, '')
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = fn;
  END LOOP;
END
$preflight$;

${definitions}

DO $postflight$
DECLARE
  expected jsonb := '${JSON.stringify(successor).replaceAll("'", "''")}'::jsonb;
  item record;
  snap record;
  cur record;
BEGIN
  FOR item IN SELECT key, value #>> '{}' AS sha FROM pg_catalog.jsonb_each(expected) LOOP
    SELECT * INTO snap FROM _case_followup_fn_snapshot WHERE sig = item.key;
    SELECT pg_catalog.pg_get_userbyid(p.proowner) AS owner,
           p.prosecdef AS secdef,
           p.proconfig AS cfg,
           COALESCE(p.proacl::text, '') AS acl,
           pg_catalog.encode(
             pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')),
             'hex'
           ) AS sha
      INTO cur
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = pg_catalog.to_regprocedure(item.key);
    IF snap.sig IS NULL
       OR cur.owner IS DISTINCT FROM snap.owner
       OR cur.secdef IS DISTINCT FROM snap.secdef
       OR cur.cfg IS DISTINCT FROM snap.cfg
       OR cur.acl IS DISTINCT FROM snap.acl
       OR cur.sha IS DISTINCT FROM item.sha THEN
      RAISE EXCEPTION 'case follow-up postflight: % drifted', item.key;
    END IF;
  END LOOP;
END
$postflight$;

DROP TABLE _case_followup_fn_snapshot;

COMMIT;
`;
}

function writeMigration(rootDirectory = ROOT) {
  const outputDirectory = path.join(
    rootDirectory,
    "prisma/migrations",
    CASE_REFUND_FOLLOWUP_MIGRATION,
  );
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirectory, "migration.sql"),
    buildCaseRefundFollowupCorrection(rootDirectory),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeMigration();
}
