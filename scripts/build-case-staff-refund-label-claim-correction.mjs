#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const CASE_STAFF_REFUND_LABEL_CLAIM_CORRECTION_MIGRATION =
  "20260901161000_correct_case_staff_refund_label_claim";
export const CASE_STAFF_REFUND_LABEL_CLAIM_PREDECESSOR_MIGRATION =
  "20260901160000_correct_case_order_invariants";
export const CASE_STAFF_REFUND_LABEL_CLAIM_PREDECESSOR_MIGRATION_SHA256 =
  "aaaf788a42d493c7cf77471cafa2b1ee69690c279df15574cef9d4b91547265e";
export const CASE_STAFF_REFUND_LABEL_CLAIM_PREDECESSOR_SOURCE_SHA256 =
  "c433e9d779eb6f482ab7ed34ee9d341220dec8a426f69e1954fa1002167b49ae";
export const CASE_STAFF_REFUND_LABEL_CLAIM_RECONCILE_PREDECESSOR_SOURCE_SHA256 =
  "20407470f8702837f7f98bab8a5ce684e084cc067d07ea0db013f7011b8e39a2";

const PREPARE_FUNCTION_NAME = "grainline_case_staff_resolution_prepare";
const PREPARE_FUNCTION_IDENTITY =
  'public.grainline_case_staff_resolution_prepare(text,text,public."CaseResolution",integer,jsonb)';
const PREPARE_FUNCTION_GRANT_SIGNATURE =
  'text, text, public."CaseResolution", integer, jsonb';
const RECONCILE_FUNCTION_NAME = "grainline_case_staff_resolution_reconcile";
const RECONCILE_FUNCTION_IDENTITY =
  "public.grainline_case_staff_resolution_reconcile(text,text,text,text)";
const RECONCILE_FUNCTION_GRANT_SIGNATURE = "text, text, text, text";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

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

function extractFunctionDefinition(sql, functionName = PREPARE_FUNCTION_NAME) {
  const marker = `CREATE OR REPLACE FUNCTION public.${functionName}(`;
  const start = sql.indexOf(marker);
  assert.ok(start >= 0, `${functionName} definition is missing`);
  assert.equal(
    sql.indexOf(marker, start + marker.length),
    -1,
    `${functionName} definition is ambiguous`,
  );
  const closing = `$${functionName}$;`;
  const end = sql.indexOf(closing, start);
  assert.ok(end >= 0, `${functionName} closing delimiter is missing`);
  return sql.slice(start, end + closing.length);
}

export function extractFunctionSource(
  definition,
  functionName = PREPARE_FUNCTION_NAME,
) {
  const opening = `AS $${functionName}$`;
  const closing = `$${functionName}$;`;
  const start = definition.indexOf(opening);
  const end = definition.indexOf(closing, start + opening.length);
  assert.ok(start >= 0 && end >= 0, `${functionName} source is missing`);
  return definition.slice(start + opening.length, end);
}

function correctedDefinitions(rootDirectory) {
  const predecessorPath = path.join(
    rootDirectory,
    "prisma/migrations",
    CASE_STAFF_REFUND_LABEL_CLAIM_PREDECESSOR_MIGRATION,
    "migration.sql",
  );
  const predecessor = fs.readFileSync(predecessorPath, "utf8");
  assert.equal(
    sha256(predecessor),
    CASE_STAFF_REFUND_LABEL_CLAIM_PREDECESSOR_MIGRATION_SHA256,
    "Case correctness predecessor migration checksum drifted",
  );

  let prepareDefinition = extractFunctionDefinition(
    predecessor,
    PREPARE_FUNCTION_NAME,
  );
  assert.equal(
    sha256(extractFunctionSource(prepareDefinition, PREPARE_FUNCTION_NAME)),
    CASE_STAFF_REFUND_LABEL_CLAIM_PREDECESSOR_SOURCE_SHA256,
    "Case staff-resolution predecessor source drifted",
  );

  let reconcileDefinition = extractFunctionDefinition(
    predecessor,
    RECONCILE_FUNCTION_NAME,
  );
  assert.equal(
    sha256(extractFunctionSource(reconcileDefinition, RECONCILE_FUNCTION_NAME)),
    CASE_STAFF_REFUND_LABEL_CLAIM_RECONCILE_PREDECESSOR_SOURCE_SHA256,
    "Case reconciliation predecessor source drifted",
  );

  prepareDefinition = replaceExactlyOnce(
    prepareDefinition,
    `    orders."labelStatus",
    orders."fulfillmentStatus",
`,
    `    orders."labelStatus",
    orders."labelClaimStatus",
    orders."fulfillmentStatus",
`,
    "locked label-claim projection",
  );

  prepareDefinition = replaceExactlyOnce(
    prepareDefinition,
    `         OR locked_order."labelStatus" = 'PURCHASED'::public."LabelStatus"
         OR locked_order."paymentOpenDisputeBlocked"
`,
    `         OR locked_order."labelStatus" = 'PURCHASED'::public."LabelStatus"
         OR locked_order."labelClaimStatus" IN (
           'PROVIDER_PENDING',
           'PROVIDER_AMBIGUOUS',
           'PROVIDER_RECORDED'
         )
         OR locked_order."paymentOpenDisputeBlocked"
`,
    "pending refund replay label-claim fence",
  );

  prepareDefinition = replaceExactlyOnce(
    prepareDefinition,
    `       OR locked_order."labelStatus" =
            'PURCHASED'::public."LabelStatus"
       OR locked_order."paymentOpenDisputeBlocked"
`,
    `       OR locked_order."labelStatus" =
            'PURCHASED'::public."LabelStatus"
       OR locked_order."labelClaimStatus" IN (
         'PROVIDER_PENDING',
         'PROVIDER_AMBIGUOUS',
         'PROVIDER_RECORDED'
       )
       OR locked_order."paymentOpenDisputeBlocked"
`,
    "new staff refund label-claim fence",
  );

  reconcileDefinition = replaceExactlyOnce(
    reconcileDefinition,
    `    orders."caseResolutionClaimId",
    orders."sellerRefundId",
    orders."sellerRefundLockedAt"
`,
    `    orders."caseResolutionClaimId",
    orders."sellerRefundId",
    orders."sellerRefundLockedAt",
    orders."labelStatus",
    orders."labelClaimStatus"
`,
    "reconciliation locked label-claim projection",
  );

  reconcileDefinition = replaceExactlyOnce(
    reconcileDefinition,
    `       OR locked_case."resolvedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Case reconciliation claim is not retryable'
`,
    `       OR locked_case."resolvedAt" IS NOT NULL
       OR locked_order."labelStatus" =
            'PURCHASED'::public."LabelStatus"
       OR locked_order."labelClaimStatus" IN (
         'PROVIDER_PENDING',
         'PROVIDER_AMBIGUOUS',
         'PROVIDER_RECORDED'
       ) THEN
      RAISE EXCEPTION 'Case reconciliation claim is not retryable'
`,
    "reconciliation retry label-claim fence",
  );

  return Object.freeze({ prepareDefinition, reconcileDefinition });
}

export function buildCaseStaffRefundLabelClaimCorrection(rootDirectory = ROOT) {
  const { prepareDefinition, reconcileDefinition } =
    correctedDefinitions(rootDirectory);
  const correctedPrepareSourceSha256 = sha256(
    extractFunctionSource(prepareDefinition, PREPARE_FUNCTION_NAME),
  );
  const correctedReconcileSourceSha256 = sha256(
    extractFunctionSource(reconcileDefinition, RECONCILE_FUNCTION_NAME),
  );

  return `-- Prevent a staff Case refund from starting while a Shippo label
-- provider claim is active or has recorded a purchase. Both authorities lock
-- the same Order row; this replacement makes the staff path inspect the
-- locked label-claim state before any Stripe refund reservation is created.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.case.staff-refund-label-claim.correction',
    0
  )
);

DO $grainline_case_staff_refund_label_claim_preflight$
DECLARE
  expected record;
  function_oid oid;
  actual_hash text;
BEGIN
  FOR expected IN
    SELECT *
      FROM (
        VALUES
          ('${PREPARE_FUNCTION_IDENTITY}',
           '${CASE_STAFF_REFUND_LABEL_CLAIM_PREDECESSOR_SOURCE_SHA256}'),
          ('${RECONCILE_FUNCTION_IDENTITY}',
           '${CASE_STAFF_REFUND_LABEL_CLAIM_RECONCILE_PREDECESSOR_SOURCE_SHA256}')
      ) AS expected_functions(identity, source_sha256)
  LOOP
    function_oid := pg_catalog.to_regprocedure(expected.identity);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'Case predecessor function % is missing',
        expected.identity;
    END IF;

    SELECT pg_catalog.encode(
             pg_catalog.sha256(
               pg_catalog.convert_to(routine.prosrc, 'UTF8')
             ),
             'hex'
           )
      INTO actual_hash
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = function_oid
       AND routine.prosecdef
       AND routine.provolatile = 'v'
       AND routine.proparallel = 'u'
       AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[];

    IF actual_hash IS DISTINCT FROM expected.source_sha256 THEN
      RAISE EXCEPTION 'Case predecessor function % drifted',
        expected.identity;
    END IF;

    IF NOT pg_catalog.has_function_privilege(
         'grainline_app_runtime', function_oid, 'EXECUTE'
       )
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_proc AS routine,
                LATERAL pg_catalog.aclexplode(
                  COALESCE(
                    routine.proacl,
                    pg_catalog.acldefault('f', routine.proowner)
                  )
                ) AS acl
          WHERE routine.oid = function_oid
            AND acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Case predecessor grant posture % drifted',
        expected.identity;
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = 'public."Order"'::pg_catalog.regclass
          AND attribute.attname = 'labelClaimStatus'
          AND attribute.atttypid = 'pg_catalog.varchar'::pg_catalog.regtype
          AND pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
                = 'character varying(32)'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_state
        WHERE constraint_state.conrelid =
                'public."Order"'::pg_catalog.regclass
          AND constraint_state.conname = 'Order_labelClaimStatus_check'
          AND constraint_state.contype = 'c'
          AND constraint_state.convalidated
     ) THEN
    RAISE EXCEPTION 'Order label-claim state contract is missing';
  END IF;
END
$grainline_case_staff_refund_label_claim_preflight$;

${prepareDefinition}

${reconcileDefinition}

REVOKE ALL ON FUNCTION
  public.${PREPARE_FUNCTION_NAME}(${PREPARE_FUNCTION_GRANT_SIGNATURE})
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.${PREPARE_FUNCTION_NAME}(${PREPARE_FUNCTION_GRANT_SIGNATURE})
  TO grainline_app_runtime;

COMMENT ON FUNCTION
  public.${PREPARE_FUNCTION_NAME}(${PREPARE_FUNCTION_GRANT_SIGNATURE}) IS
  'Prepares a fixed staff Case resolution after locking the Order; refund resolutions reject active or recorded shipping-label provider claims.';

REVOKE ALL ON FUNCTION
  public.${RECONCILE_FUNCTION_NAME}(${RECONCILE_FUNCTION_GRANT_SIGNATURE})
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.${RECONCILE_FUNCTION_NAME}(${RECONCILE_FUNCTION_GRANT_SIGNATURE})
  TO grainline_app_runtime;

COMMENT ON FUNCTION
  public.${RECONCILE_FUNCTION_NAME}(${RECONCILE_FUNCTION_GRANT_SIGNATURE}) IS
  'Reconciles a staff Case refund claim; retries reject active or recorded shipping-label provider claims while no-effect releases remain available.';

DO $grainline_case_staff_refund_label_claim_postflight$
DECLARE
  expected record;
  function_oid oid;
  actual_hash text;
BEGIN
  FOR expected IN
    SELECT *
      FROM (
        VALUES
          ('${PREPARE_FUNCTION_IDENTITY}',
           '${correctedPrepareSourceSha256}'),
          ('${RECONCILE_FUNCTION_IDENTITY}',
           '${correctedReconcileSourceSha256}')
      ) AS expected_functions(identity, source_sha256)
  LOOP
    function_oid := pg_catalog.to_regprocedure(expected.identity);
    SELECT pg_catalog.encode(
             pg_catalog.sha256(
               pg_catalog.convert_to(routine.prosrc, 'UTF8')
             ),
             'hex'
           )
      INTO actual_hash
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = function_oid
       AND routine.prosecdef
       AND routine.provolatile = 'v'
       AND routine.proparallel = 'u'
       AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[];

    IF actual_hash IS DISTINCT FROM expected.source_sha256
       OR NOT pg_catalog.has_function_privilege(
         'grainline_app_runtime', function_oid, 'EXECUTE'
       )
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_proc AS routine,
                LATERAL pg_catalog.aclexplode(
                  COALESCE(
                    routine.proacl,
                    pg_catalog.acldefault('f', routine.proowner)
                  )
                ) AS acl
          WHERE routine.oid = function_oid
            AND acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Corrected Case function % drifted', expected.identity;
    END IF;
  END LOOP;
END
$grainline_case_staff_refund_label_claim_postflight$;

COMMIT;
`;
}

export function verifyCaseStaffRefundLabelClaimCorrectionBytes(
  rootDirectory = ROOT,
) {
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    CASE_STAFF_REFUND_LABEL_CLAIM_CORRECTION_MIGRATION,
    "migration.sql",
  );
  const expected = buildCaseStaffRefundLabelClaimCorrection(rootDirectory);
  const actual = fs.readFileSync(migrationPath, "utf8");
  assert.equal(
    actual,
    expected,
    "Case staff-refund label correction bytes drifted",
  );
  return Object.freeze({
    migration: CASE_STAFF_REFUND_LABEL_CLAIM_CORRECTION_MIGRATION,
    migrationSha256: sha256(actual),
    functionSourceSha256: sha256(
      extractFunctionSource(
        extractFunctionDefinition(actual, PREPARE_FUNCTION_NAME),
        PREPARE_FUNCTION_NAME,
      ),
    ),
    reconciliationSourceSha256: sha256(
      extractFunctionSource(
        extractFunctionDefinition(actual, RECONCILE_FUNCTION_NAME),
        RECONCILE_FUNCTION_NAME,
      ),
    ),
  });
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const output = buildCaseStaffRefundLabelClaimCorrection();
  if (process.argv[2] === "--write" && process.argv.length === 3) {
    const directory = path.join(
      ROOT,
      "prisma/migrations",
      CASE_STAFF_REFUND_LABEL_CLAIM_CORRECTION_MIGRATION,
    );
    fs.mkdirSync(directory, { recursive: false });
    fs.writeFileSync(path.join(directory, "migration.sql"), output, {
      encoding: "utf8",
      flag: "wx",
    });
  } else if (process.argv.length === 2) {
    process.stdout.write(output);
  } else {
    throw new Error("Use no arguments or --write");
  }
}
