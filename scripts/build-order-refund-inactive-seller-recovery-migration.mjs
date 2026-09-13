#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION =
  "20260824050000_prepare_order_refund_inactive_seller_recovery";

const CASE_MIGRATION =
  "prisma/migrations/20260729044000_prepare_case_seller_refund_authority/migration.sql";
const CASE_MIGRATION_SHA256 =
  "166669f6a53c88a6b1ee876f78e0bd54a2b33cd9804fd06782823e13f18addc1";
const RECORD_MIGRATION =
  "prisma/migrations/20260824020000_prepare_order_refund_record_authority/migration.sql";
const RECORD_MIGRATION_SHA256 =
  "e1cd79da8f6a0a22668cb612c6f7d579b7af1caf431f917d69771e6b0742d505";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readPinned(rootDirectory, relativePath, expectedSha256) {
  const value = fs.readFileSync(path.join(rootDirectory, relativePath), "utf8");
  const actualSha256 = sha256(value);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `${relativePath} drifted: expected ${expectedSha256}, got ${actualSha256}`,
    );
  }
  return value;
}

function extractFunction(source, start, end) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) throw new Error(`function start is missing: ${start}`);
  const endIndex = source.indexOf(end, startIndex);
  if (endIndex < 0) throw new Error(`function end is missing: ${end}`);
  return source.slice(startIndex, endIndex + end.length);
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  const last = source.lastIndexOf(before);
  if (first < 0 || first !== last) {
    throw new Error(`${label} expected exactly one source match`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function buildOrderRefundInactiveSellerRecoveryMigration(
  rootDirectory = process.cwd(),
) {
  const caseMigration = readPinned(
    rootDirectory,
    CASE_MIGRATION,
    CASE_MIGRATION_SHA256,
  );
  const recordMigration = readPinned(
    rootDirectory,
    RECORD_MIGRATION,
    RECORD_MIGRATION_SHA256,
  );

  let caseFunction = extractFunction(
    caseMigration,
    "CREATE OR REPLACE FUNCTION public.grainline_case_seller_refund_apply(",
    "$grainline_case_seller_refund_apply$;",
  );
  caseFunction = replaceOnce(
    caseFunction,
    `  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Case seller-refund actor is invalid'
      USING ERRCODE = '42501';
  END IF;`,
    `  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case seller-refund actor does not exist'
      USING ERRCODE = '42501';
  END IF;`,
    "Case actor posture split",
  );
  caseFunction = replaceOnce(
    caseFunction,
    `  IF source_event."eventType" <> 'REFUND'
     OR source_event."stripeObjectType" IS DISTINCT FROM 'refund'
     OR source_event."stripeObjectId" IS NULL
     OR pg_catalog.btrim(source_event."stripeObjectId") = ''
     OR source_event."stripeEventId" IS DISTINCT FROM
          'local:seller_refund_recorded:'
          || source_event."stripeObjectId"
     OR source_event."amountCents" IS NULL
     OR source_event."amountCents" <= 0
     OR source_event."amountCents"::bigint > order_total_cents
     OR source_event.currency !~ '^[a-z]{3}$'
     OR pg_catalog.lower(source_event.currency)
          IS DISTINCT FROM pg_catalog.lower(locked_order.currency)
     OR source_event.reason IS DISTINCT FROM 'seller_refund'
     OR pg_catalog.jsonb_typeof(source_event.metadata)
          IS DISTINCT FROM 'object'
     OR source_event.metadata->>'localAction'
          IS DISTINCT FROM 'SELLER_REFUND_RECORDED'
     OR source_event.metadata->>'refundType' IS NULL
     OR source_event.metadata->>'refundType'
          NOT IN ('FULL', 'PARTIAL')
     OR pg_catalog.jsonb_typeof(source_event.metadata->'refundIds')
          IS DISTINCT FROM 'array'
     OR NOT (
       source_event.metadata->'refundIds'
         @> pg_catalog.jsonb_build_array(source_event."stripeObjectId")
     )
     OR locked_order."sellerRefundId"
          IS DISTINCT FROM source_event."stripeObjectId"
     OR locked_order."sellerRefundAmountCents"
          IS DISTINCT FROM source_event."amountCents"
     OR locked_order."sellerRefundLockedAt" IS NOT NULL
     OR (
       source_event.metadata->>'refundType' = 'FULL'
       AND source_event."amountCents"::bigint <> order_total_cents
     ) THEN
    RAISE EXCEPTION 'Case seller-refund source is invalid'
      USING ERRCODE = '23514';
  END IF;`,
    `  IF source_event."eventType" <> 'REFUND'
     OR source_event."stripeObjectType" IS DISTINCT FROM 'refund'
     OR source_event."stripeObjectId" IS NULL
     OR pg_catalog.btrim(source_event."stripeObjectId") = ''
     OR source_event."stripeEventId" IS DISTINCT FROM
          'local:seller_refund_recorded:'
          || source_event."stripeObjectId"
     OR source_event."amountCents" IS NULL
     OR source_event."amountCents" <= 0
     OR source_event."amountCents"::bigint > order_total_cents
     OR source_event.currency !~ '^[a-z]{3}$'
     OR pg_catalog.lower(source_event.currency)
          IS DISTINCT FROM pg_catalog.lower(locked_order.currency)
     OR source_event.reason IS DISTINCT FROM 'seller_refund'
     OR pg_catalog.jsonb_typeof(source_event.metadata)
          IS DISTINCT FROM 'object'
     OR source_event.metadata->>'localAction'
          IS DISTINCT FROM 'SELLER_REFUND_RECORDED'
     OR source_event.metadata->>'refundType' IS NULL
     OR source_event.metadata->>'refundType'
          NOT IN ('FULL', 'PARTIAL')
     OR pg_catalog.jsonb_typeof(source_event.metadata->'refundIds')
          IS DISTINCT FROM 'array'
     OR NOT (
       source_event.metadata->'refundIds'
         @> pg_catalog.jsonb_build_array(source_event."stripeObjectId")
     )
     OR locked_order."sellerRefundId"
          IS DISTINCT FROM source_event."stripeObjectId"
     OR locked_order."sellerRefundAmountCents"
          IS DISTINCT FROM source_event."amountCents"
     OR locked_order."sellerRefundLockedAt" IS NOT NULL
     OR (
       source_event.metadata->>'refundType' = 'FULL'
       AND source_event."amountCents"::bigint <> order_total_cents
     ) THEN
    RAISE EXCEPTION 'Case seller-refund source is invalid'
      USING ERRCODE = '23514';
  END IF;

  -- Inactive sellers cannot initiate or normally finalize refunds. Permit
  -- only the already-authorized first local record whose exact claim and
  -- source are preserved in immutable ADMIN reconciliation evidence.
  IF locked_actor.banned OR locked_actor."deletedAt" IS NOT NULL THEN
    PERFORM 1
      FROM public."OrderRefundReconciliation" AS reconciliation
      JOIN public."User" AS administrator
        ON administrator.id = reconciliation."actorUserId"
     WHERE reconciliation."orderId" = locked_order.id
       AND reconciliation."claimId"
             = source_event.metadata->>'refundClaimId'
       AND reconciliation."claimGeneration"::text
             = source_event.metadata->>'refundClaimGeneration'
       AND reconciliation."claimSource" = 'SELLER'
       AND reconciliation."claimSourceId" = locked_actor.id
       AND reconciliation."claimSourceGeneration" IS NULL
       AND reconciliation.action IN (
         'RETRY_EXISTING_SCOPE',
         'CONFIRMED_PROVIDER_EFFECT'
       )
       AND source_event.metadata->>'refundClaimSource' = 'SELLER'
       AND source_event.metadata->>'refundClaimSourceId' = locked_actor.id
       AND source_event.metadata->>'refundClaimSourceGeneration' IS NULL
       AND administrator.role = 'ADMIN'::public."Role"
       AND NOT administrator.banned
       AND administrator."deletedAt" IS NULL
     FOR SHARE OF reconciliation, administrator;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Inactive Case seller-refund lacks exact ADMIN reconciliation'
        USING ERRCODE = '42501';
    END IF;
  END IF;`,
    "Case inactive seller reconciliation gate",
  );

  let sellerFunction = extractFunction(
    recordMigration,
    "CREATE FUNCTION public.grainline_seller_refund_record(",
    "$grainline_seller_refund_record$;",
  ).replace(
    "CREATE FUNCTION public.grainline_seller_refund_record(",
    "CREATE OR REPLACE FUNCTION public.grainline_seller_refund_record(",
  );
  sellerFunction = replaceOnce(
    sellerFunction,
    `  IF NOT FOUND OR locked_actor."deletedAt" IS NOT NULL OR locked_actor.banned THEN
    RAISE EXCEPTION 'Seller refund record actor is not active'
      USING ERRCODE = 'insufficient_privilege';
  END IF;`,
    `  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller refund record actor does not exist'
      USING ERRCODE = 'insufficient_privilege';
  END IF;`,
    "seller actor posture split",
  );
  sellerFunction = replaceOnce(
    sellerFunction,
    `  IF NOT FOUND
     OR locked_order."sellerProfileId" IS DISTINCT FROM locked_seller.id
     OR locked_order."sellerRefundId" IS DISTINCT FROM 'pending'
     OR locked_order."refundClaimSource" IS DISTINCT FROM 'SELLER'
     OR locked_order."refundClaimSourceId" IS DISTINCT FROM locked_actor.id
     OR locked_order."refundClaimSourceGeneration" IS NOT NULL
     OR locked_order."refundClaimProviderAuthorizedAt" IS NULL THEN
    RAISE EXCEPTION 'Seller refund record claim is no longer active'
      USING ERRCODE = 'serialization_failure';
  END IF;`,
    `  IF NOT FOUND
     OR locked_order."sellerProfileId" IS DISTINCT FROM locked_seller.id
     OR locked_order."sellerRefundId" IS DISTINCT FROM 'pending'
     OR locked_order."refundClaimSource" IS DISTINCT FROM 'SELLER'
     OR locked_order."refundClaimSourceId" IS DISTINCT FROM locked_actor.id
     OR locked_order."refundClaimSourceGeneration" IS NOT NULL
     OR locked_order."refundClaimProviderAuthorizedAt" IS NULL THEN
    RAISE EXCEPTION 'Seller refund record claim is no longer active'
      USING ERRCODE = 'serialization_failure';
  END IF;

  -- Do not weaken ordinary seller finalization. A banned or soft-deleted
  -- seller reaches the first local record only after a current ADMIN has
  -- committed one exact immutable reconciliation for this claim generation.
  IF locked_actor.banned OR locked_actor."deletedAt" IS NOT NULL THEN
    PERFORM 1
      FROM public."OrderRefundReconciliation" AS reconciliation
      JOIN public."User" AS administrator
        ON administrator.id = reconciliation."actorUserId"
     WHERE reconciliation."orderId" = locked_order.id
       AND reconciliation."claimId" = p_claim_id
       AND reconciliation."claimGeneration" = p_claim_generation
       AND reconciliation."claimSource" = 'SELLER'
       AND reconciliation."claimSourceId" = locked_actor.id
       AND reconciliation."claimSourceGeneration" IS NULL
       AND reconciliation."idempotencyScope"
             = locked_order."refundClaimIdempotencyScope"
       AND reconciliation.action IN (
         'RETRY_EXISTING_SCOPE',
         'CONFIRMED_PROVIDER_EFFECT'
       )
       AND administrator.role = 'ADMIN'::public."Role"
       AND NOT administrator.banned
       AND administrator."deletedAt" IS NULL
     FOR SHARE OF reconciliation, administrator;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Inactive seller refund lacks exact ADMIN reconciliation'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;`,
    "seller inactive reconciliation gate",
  );

  const migration = `-- Compatible recovery for an in-flight seller refund after the seller
-- becomes banned or soft-deleted. Authority is derived only from the exact
-- immutable ADMIN reconciliation row; no caller supplies a recovery target.

BEGIN;

DO $grainline_order_refund_inactive_seller_recovery_preflight$
BEGIN
  IF pg_catalog.to_regclass('public."OrderRefundReconciliation"') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_order_refund_reconcile(text,text,bigint,text,text,bigint,text,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_refund_record(text,text,bigint,text,text,text,integer)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_case_seller_refund_apply(text,text)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'Inactive seller refund recovery prerequisites are missing'
      USING ERRCODE = 'undefined_function';
  END IF;
END
$grainline_order_refund_inactive_seller_recovery_preflight$;

${caseFunction}

${sellerFunction}

REVOKE ALL ON FUNCTION
  public.grainline_case_seller_refund_apply(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_seller_refund_apply(text, text)
  TO grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_seller_refund_record(
    text,
    text,
    bigint,
    text,
    text,
    text,
    integer
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_seller_refund_record(
    text,
    text,
    bigint,
    text,
    text,
    text,
    integer
  )
  TO grainline_app_runtime;

COMMENT ON FUNCTION public.grainline_seller_refund_record(
  text, text, bigint, text, text, text, integer
) IS
  'Records a seller refund; inactive first-write recovery requires exact immutable ADMIN reconciliation evidence.';
COMMENT ON FUNCTION public.grainline_case_seller_refund_apply(text, text) IS
  'Applies seller-refund Case effects; inactive sources require exact immutable ADMIN reconciliation evidence.';

COMMIT;
`;

  if (/\bEXECUTE\s+[^\n]*\bformat\s*\(/iu.test(migration)) {
    throw new Error("inactive seller recovery introduced dynamic SQL");
  }
  if (/pg_catalog\.(?:greatest|least|nullif|coalesce)\b/iu.test(migration)) {
    throw new Error("inactive seller recovery qualified a PostgreSQL special form");
  }
  if ((migration.match(/CREATE OR REPLACE FUNCTION/gu) ?? []).length !== 2) {
    throw new Error("inactive seller recovery function count drifted");
  }
  if ((migration.match(/SECURITY DEFINER/gu) ?? []).length !== 2) {
    throw new Error("inactive seller recovery definer count drifted");
  }
  return Object.freeze({
    migration,
    migrationName: ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION,
    migrationSha256: sha256(migration),
  });
}

function main() {
  const mode = process.argv[2] ?? "--verify";
  const rootDirectory = process.cwd();
  const candidate = buildOrderRefundInactiveSellerRecoveryMigration(
    rootDirectory,
  );
  const migrationDirectory = path.join(
    rootDirectory,
    "prisma/migrations",
    candidate.migrationName,
  );
  const migrationPath = path.join(migrationDirectory, "migration.sql");

  if (mode === "--write") {
    fs.mkdirSync(migrationDirectory, { recursive: true });
    fs.writeFileSync(migrationPath, candidate.migration, { mode: 0o644 });
  } else if (mode === "--verify") {
    const actual = fs.readFileSync(migrationPath, "utf8");
    if (actual !== candidate.migration) {
      throw new Error("inactive seller recovery migration bytes drifted");
    }
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }

  process.stdout.write(`${JSON.stringify({
    mode,
    migration: candidate.migrationName,
    migrationSha256: candidate.migrationSha256,
    replacedFunctions: 2,
    newRuntimeFunctions: 0,
    tablePrivilegesChanged: false,
    rlsChanged: false,
    productionChanged: false,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
