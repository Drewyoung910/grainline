#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CASE_CORRECTNESS_MIGRATION =
  "20260901160000_correct_case_order_invariants";
export const CASE_CORRECTNESS_MIGRATION_SHA256 =
  "aaaf788a42d493c7cf77471cafa2b1ee69690c279df15574cef9d4b91547265e";

const PREDECESSORS = Object.freeze({
  caseAccountDeletion: Object.freeze({
    migration: "20260729061000_prepare_case_account_deletion_authority",
    sha256: "5c23eadcf394917aae69527befa16462300e5c1182fef378c772c3b2f4f07a59",
  }),
  caseMessagePage: Object.freeze({
    migration: "20260729054000_prepare_case_message_page_authority",
    sha256: "5cd4b3bf242980b60da4985bf0836ad4ae0605242468c85bc06f28d1ea2f9004",
  }),
  caseOrderActive: Object.freeze({
    migration: "20260729057000_prepare_case_order_active_authority",
    sha256: "1c72fcb23ac80d63fb7c330f636e67ee38aba8aa46945b1797cc7133fb4c2fc9",
  }),
  caseSellerRefund: Object.freeze({
    migration: "20260824050000_prepare_order_refund_inactive_seller_recovery",
    sha256: "e37d5ea925af5f4b82f90b1f1bcdeb9b14f5a4b34da7c228bdc94f8bfbbb9598",
  }),
  caseStaffResolution: Object.freeze({
    migration: "20260729045000_prepare_case_staff_resolution_authority",
    sha256: "8097580d0d8fe63830a7369295d48e465dead34fd5ef01ab940d7fa5754ee6a7",
  }),
  caseStripeDispute: Object.freeze({
    migration: "20260729043000_prepare_case_stripe_dispute_authority",
    sha256: "561c4307e7f74099623c9e975274dc247a14302ce1605e5e751974f68d8f889d",
  }),
});

const FUNCTIONS = Object.freeze([
  Object.freeze({
    key: "caseMessagePage",
    name: "grainline_case_message_page",
    identity:
      "public.grainline_case_message_page(text,text,timestamp,text,integer)",
    grantSignature: "text, text, timestamp, text, integer",
    predecessor: "caseMessagePage",
  }),
  Object.freeze({
    key: "caseStripeDispute",
    name: "grainline_case_stripe_dispute_apply",
    identity: "public.grainline_case_stripe_dispute_apply(text)",
    grantSignature: "text",
    predecessor: "caseStripeDispute",
  }),
  Object.freeze({
    key: "caseSellerRefund",
    name: "grainline_case_seller_refund_apply",
    identity: "public.grainline_case_seller_refund_apply(text,text)",
    grantSignature: "text, text",
    predecessor: "caseSellerRefund",
    // OrderPaymentEvent Phase A retired this predecessor entry point after
    // replacing its source binding. Redefining the body must not revive it.
    runtimeExecute: false,
  }),
  Object.freeze({
    key: "caseStaffPrepare",
    name: "grainline_case_staff_resolution_prepare",
    identity:
      "public.grainline_case_staff_resolution_prepare(text,text,public.\"CaseResolution\",integer,jsonb)",
    grantSignature:
      "text, text, public.\"CaseResolution\", integer, jsonb",
    predecessor: "caseStaffResolution",
  }),
  Object.freeze({
    key: "caseStaffProviderRecord",
    name: "grainline_case_staff_resolution_provider_record",
    identity:
      "public.grainline_case_staff_resolution_provider_record(text,text,text,text,text[],text[],text,integer,boolean,boolean)",
    grantSignature:
      "text, text, text, text, text[], text[], text, integer, boolean, boolean",
    predecessor: "caseStaffResolution",
  }),
  Object.freeze({
    key: "caseStaffFinalize",
    name: "grainline_case_staff_resolution_finalize",
    identity: "public.grainline_case_staff_resolution_finalize(text,text)",
    grantSignature: "text, text",
    predecessor: "caseStaffResolution",
  }),
  Object.freeze({
    key: "caseStaffReconcile",
    name: "grainline_case_staff_resolution_reconcile",
    identity:
      "public.grainline_case_staff_resolution_reconcile(text,text,text,text)",
    grantSignature: "text, text, text, text",
    predecessor: "caseStaffResolution",
  }),
  Object.freeze({
    key: "orderBuyerPiiPrune",
    name: "grainline_order_buyer_pii_prune_batch",
    identity: "public.grainline_order_buyer_pii_prune_batch(integer)",
    grantSignature: "integer",
    predecessor: "caseOrderActive",
  }),
  Object.freeze({
    key: "caseAccountDeletion",
    name: "grainline_case_account_deletion_redact",
    identity: "public.grainline_case_account_deletion_redact(text)",
    grantSignature: "text",
    predecessor: "caseAccountDeletion",
  }),
]);

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

function replaceExactCount(source, before, after, expected, label) {
  const count = source.split(before).length - 1;
  assert.equal(count, expected, `${label} predecessor count drifted`);
  return source.split(before).join(after);
}

function readPredecessors(rootDirectory) {
  return Object.fromEntries(
    Object.entries(PREDECESSORS).map(([key, predecessor]) => {
      const migrationPath = path.join(
        rootDirectory,
        "prisma/migrations",
        predecessor.migration,
        "migration.sql",
      );
      const sql = fs.readFileSync(migrationPath, "utf8");
      assert.equal(
        sha256(sql),
        predecessor.sha256,
        `${predecessor.migration} checksum drifted`,
      );
      return [key, sql];
    }),
  );
}

function extractDefinition(sql, functionName) {
  const createMarkers = [
    `CREATE OR REPLACE FUNCTION public.${functionName}(`,
    `CREATE OR REPLACE FUNCTION\n  public.${functionName}(`,
    `CREATE FUNCTION public.${functionName}(`,
  ];
  const starts = createMarkers
    .map((marker) => sql.indexOf(marker))
    .filter((index) => index >= 0);
  assert.equal(starts.length, 1, `${functionName} definition is missing or ambiguous`);
  const start = starts[0];
  const closing = `$${functionName}$;`;
  const end = sql.indexOf(closing, start);
  assert.ok(end >= 0, `${functionName} closing delimiter is missing`);
  return sql.slice(start, end + closing.length);
}

export function extractFunctionSource(definition, functionName) {
  const opening = `AS $${functionName}$`;
  const closing = `$${functionName}$;`;
  const start = definition.indexOf(opening);
  const end = definition.indexOf(closing, start + opening.length);
  assert.ok(start >= 0 && end >= 0, `${functionName} function source is missing`);
  return definition.slice(start + opening.length, end);
}

function utcTimestamp(definition, functionName) {
  return replaceExactCount(
    definition,
    "pg_catalog.clock_timestamp()::timestamp(3)",
    "pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())",
    1,
    `${functionName} UTC timestamp`,
  );
}

function strengthenMessagePage(definition) {
  return replaceExactlyOnce(
    definition,
    "      ELSE NULL::text\n",
    "      ELSE 'STAFF'::text\n",
    "legacy staff Case-message projection",
  );
}

function strengthenPiiPrune(definition) {
  return replaceExactlyOnce(
    definition,
    "     WHERE order_row.\"reviewNeeded\" = false\n",
    "     WHERE order_row.\"reviewNeeded\" = false\n"
      + "       AND order_row.\"paymentOpenDisputeBlocked\" = false\n",
    "buyer-PII open-dispute fence",
  );
}

function strengthenAccountDeletion(definition) {
  let strengthened = replaceExactlyOnce(
    definition,
    "CREATE FUNCTION public.grainline_case_account_deletion_redact(",
    "CREATE OR REPLACE FUNCTION public.grainline_case_account_deletion_redact(",
    "Case account-deletion replacement",
  );
  strengthened = replaceExactlyOnce(
    strengthened,
    `  -- The earlier account-deletion preflight is advisory. Recheck after the
  -- User lock so a Case opened between preflight and anonymization fails
  -- closed. Case opening also takes a shared lock on both parties.
  SELECT pg_catalog.count(*)::bigint
`,
    `  -- The earlier account-deletion preflight is advisory. Lock every Order
  -- involving this buyer or seller in canonical id order before the final
  -- Case check. Buyer Case-open already blocks on the User lock; seller
  -- Case-open blocks on its Order lock, then observes the completed deletion.
  PERFORM order_row.id
    FROM public."Order" AS order_row
   WHERE order_row."buyerId" = locked_user.id
      OR EXISTS (
        SELECT 1
          FROM public."SellerProfile" AS seller
         WHERE seller.id = order_row."sellerProfileId"
           AND seller."userId" = locked_user.id
      )
   ORDER BY order_row.id
   FOR UPDATE OF order_row;

  -- Use a fresh READ COMMITTED statement snapshot after the Order locks so
  -- a concurrently committed Case is visible before any redaction begins.
  SELECT pg_catalog.count(*)::bigint
`,
    "Case account-deletion Order lock fence",
  );
  return strengthened;
}

function strengthenStaffPrepare(definition) {
  let strengthened = utcTimestamp(
    definition,
    "grainline_case_staff_resolution_prepare",
  );
  strengthened = replaceExactlyOnce(
    strengthened,
    `    orders."fulfillmentStatus",
    orders."caseResolutionClaimId"
`,
    `    orders."fulfillmentStatus",
    orders."paymentOpenDisputeBlocked",
    orders."caseResolutionClaimId"
`,
    "Case staff prepare current open-dispute projection",
  );
  strengthened = replaceExactlyOnce(
    strengthened,
    `      claim."idempotencyScope"
      INTO existing_claim
`,
    `      claim."idempotencyScope",
      claim."orderPaymentEventId"
      INTO existing_claim
`,
    "Case staff replay payment evidence",
  );
  strengthened = replaceExactlyOnce(
    strengthened,
    `    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'claimId', existing_claim.id,
`,
    `    END IF;

    IF existing_claim.status =
         'PROVIDER_PENDING'::public."CaseResolutionClaimStatus" THEN
      IF existing_claim.resolution NOT IN (
           'REFUND_FULL'::public."CaseResolution",
           'REFUND_PARTIAL'::public."CaseResolution"
         )
         OR locked_order."sellerRefundId" IS DISTINCT FROM 'pending'
         OR locked_order."sellerRefundLockedAt" IS NULL
         OR existing_claim."orderPaymentEventId" IS NOT NULL
         OR locked_order."stripePaymentIntentId" IS NULL
         OR pg_catalog.btrim(locked_order."stripePaymentIntentId") = ''
         OR locked_order."labelStatus" = 'PURCHASED'::public."LabelStatus"
         OR locked_order."paymentOpenDisputeBlocked"
         OR EXISTS (
           SELECT 1
             FROM public."OrderPaymentEvent" AS refund_event
            WHERE refund_event."orderId" = locked_order.id
              AND refund_event."eventType" = 'REFUND'
              AND (
                refund_event.status IS NULL
                OR pg_catalog.lower(refund_event.status)
                     NOT IN ('failed', 'canceled', 'cancelled')
              )
         ) THEN
        RAISE EXCEPTION
          'Case staff-resolution replay is no longer refund-eligible'
          USING ERRCODE = '23514';
      END IF;
    ELSIF existing_claim.status =
            'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus" THEN
      IF existing_claim.resolution NOT IN (
           'REFUND_FULL'::public."CaseResolution",
           'REFUND_PARTIAL'::public."CaseResolution"
         )
         OR existing_claim."orderPaymentEventId" IS NULL
         OR locked_order."sellerRefundId" IS NULL
         OR locked_order."sellerRefundId" = 'pending'
         OR locked_order."sellerRefundLockedAt" IS NOT NULL THEN
        RAISE EXCEPTION
          'Case staff-resolution recorded replay evidence is invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSIF existing_claim.status =
            'LOCAL_READY'::public."CaseResolutionClaimStatus" THEN
      IF existing_claim.resolution <>
           'DISMISSED'::public."CaseResolution"
         OR existing_claim."orderPaymentEventId" IS NOT NULL
         OR locked_order."sellerRefundId" IS NOT NULL
         OR locked_order."sellerRefundLockedAt" IS NOT NULL THEN
        RAISE EXCEPTION
          'Case staff-resolution local replay evidence is invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSIF existing_claim.status =
            'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus" THEN
      IF existing_claim.resolution NOT IN (
           'REFUND_FULL'::public."CaseResolution",
           'REFUND_PARTIAL'::public."CaseResolution"
         )
         OR existing_claim."orderPaymentEventId" IS NOT NULL
         OR locked_order."sellerRefundId" IS DISTINCT FROM
              'ambiguous_refund_pending_reconciliation'
         OR locked_order."sellerRefundLockedAt" IS NOT NULL THEN
        RAISE EXCEPTION
          'Case staff-resolution reconciliation replay evidence is invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Case staff-resolution replay status is invalid'
        USING ERRCODE = '23514';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'claimId', existing_claim.id,
`,
    "Case staff replay eligibility guard",
  );
  strengthened = replaceExactlyOnce(
    strengthened,
    `       OR locked_order."labelStatus" =
            'PURCHASED'::public."LabelStatus"
       OR EXISTS (
`,
    `       OR locked_order."labelStatus" =
            'PURCHASED'::public."LabelStatus"
       OR locked_order."paymentOpenDisputeBlocked"
       OR EXISTS (
`,
    "Case staff initial open-dispute projection guard",
  );
  return strengthened;
}

function strengthenStaffFinalize(definition) {
  let strengthened = utcTimestamp(
    definition,
    "grainline_case_staff_resolution_finalize",
  );
  strengthened = replaceExactlyOnce(
    strengthened,
    `    orders."sellerRefundId",
    orders."sellerRefundAmountCents"
`,
    `    orders."sellerRefundId",
    orders."sellerRefundAmountCents",
    orders."fulfillmentStatus"
`,
    "Case finalization fulfillment projection",
  );
  strengthened = replaceExactlyOnce(
    strengthened,
    `  IF EXISTS (
    WITH plan AS (
`,
    `  IF pg_catalog.jsonb_array_length(locked_claim."stockRestorePlan") > 0
     AND locked_order."fulfillmentStatus" IN (
       'SHIPPED'::public."FulfillmentStatus",
       'DELIVERED'::public."FulfillmentStatus",
       'PICKED_UP'::public."FulfillmentStatus"
     ) THEN
    RAISE EXCEPTION 'Case finalization cannot restore fulfilled stock'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH plan AS (
`,
    "Case finalization fulfillment recheck",
  );
  return strengthened;
}

export function caseCorrectnessDefinitions(rootDirectory = process.cwd()) {
  const predecessors = readPredecessors(rootDirectory);
  const original = Object.fromEntries(
    FUNCTIONS.map((entry) => [
      entry.key,
      extractDefinition(predecessors[entry.predecessor], entry.name),
    ]),
  );

  const corrected = {
    ...original,
    caseAccountDeletion: strengthenAccountDeletion(original.caseAccountDeletion),
    caseMessagePage: strengthenMessagePage(original.caseMessagePage),
    caseSellerRefund: utcTimestamp(
      original.caseSellerRefund,
      "grainline_case_seller_refund_apply",
    ),
    caseStaffFinalize: strengthenStaffFinalize(original.caseStaffFinalize),
    caseStaffPrepare: strengthenStaffPrepare(original.caseStaffPrepare),
    caseStaffProviderRecord: utcTimestamp(
      original.caseStaffProviderRecord,
      "grainline_case_staff_resolution_provider_record",
    ),
    caseStaffReconcile: utcTimestamp(
      original.caseStaffReconcile,
      "grainline_case_staff_resolution_reconcile",
    ),
    caseStripeDispute: utcTimestamp(
      original.caseStripeDispute,
      "grainline_case_stripe_dispute_apply",
    ),
    orderBuyerPiiPrune: strengthenPiiPrune(original.orderBuyerPiiPrune),
  };

  return { corrected, original };
}

function sqlRows(definitions) {
  return FUNCTIONS.map((entry) => {
    const source = extractFunctionSource(definitions[entry.key], entry.name);
    const runtimeExecute = entry.runtimeExecute === false ? "false" : "true";
    return `      ('${entry.identity}', '${sha256(source)}', ${runtimeExecute})`;
  }).join(",\n");
}

function grantSql() {
  return FUNCTIONS.map((entry) => {
    const grant = entry.runtimeExecute === false
      ? ""
      : `
GRANT EXECUTE ON FUNCTION
  public.${entry.name}(${entry.grantSignature})
  TO grainline_app_runtime;`;
    return `REVOKE ALL ON FUNCTION
  public.${entry.name}(${entry.grantSignature})
  FROM PUBLIC, grainline_app_runtime;${grant}`;
  }).join("\n\n");
}

function verificationBlock(label, rows, expectedPhase) {
  return `DO $grainline_case_correctness_${label}$
DECLARE
  expected record;
  function_oid oid;
  actual_hash text;
BEGIN
  FOR expected IN
    SELECT *
      FROM (VALUES
${rows}
      ) AS expected_functions(identity, source_sha256, runtime_execute)
  LOOP
    function_oid := pg_catalog.to_regprocedure(expected.identity);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION '${expectedPhase} Case correctness function % is missing',
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
      RAISE EXCEPTION '${expectedPhase} Case correctness function % drifted',
        expected.identity;
    END IF;

    IF pg_catalog.has_function_privilege(
         'grainline_app_runtime', function_oid, 'EXECUTE'
       ) IS DISTINCT FROM expected.runtime_execute
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
      RAISE EXCEPTION '${expectedPhase} Case function % grant posture drifted',
        expected.identity;
    END IF;
  END LOOP;
END
$grainline_case_correctness_${label}$;`;
}

export function buildCaseCorrectnessMigration(rootDirectory = process.cwd()) {
  const { corrected, original } = caseCorrectnessDefinitions(rootDirectory);
  return `-- Correct reviewed Case/Order invariants before continuing Order RLS.
-- This additive migration preserves existing signatures, policies and table
-- grants. It fail-closes on predecessor function-body drift, replaces only the
-- reviewed fixed-authority functions, and reconverges exact EXECUTE grants.

BEGIN;

${verificationBlock("preflight", sqlRows(original), "Predecessor")}

${FUNCTIONS.map((entry) => corrected[entry.key]).join("\n\n")}

${grantSql()}

${verificationBlock("postflight", sqlRows(corrected), "Corrected")}

COMMIT;
`;
}

export function verifyCaseCorrectnessMigrationBytes(
  rootDirectory = process.cwd(),
) {
  const expected = buildCaseCorrectnessMigration(rootDirectory);
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    CASE_CORRECTNESS_MIGRATION,
    "migration.sql",
  );
  assert.ok(
    fs.existsSync(migrationPath),
    `${CASE_CORRECTNESS_MIGRATION} is missing`,
  );
  const committed = fs.readFileSync(migrationPath, "utf8");
  assert.equal(
    committed,
    expected,
    `${CASE_CORRECTNESS_MIGRATION} bytes drifted from the reviewed builder`,
  );
  const migrationSha256 = sha256(committed);
  assert.equal(
    migrationSha256,
    CASE_CORRECTNESS_MIGRATION_SHA256,
    `${CASE_CORRECTNESS_MIGRATION} checksum drifted`,
  );
  return Object.freeze({
    migration: CASE_CORRECTNESS_MIGRATION,
    migrationSha256,
  });
}

export function verifyOptionalCaseCorrectnessSuccessor(
  rootDirectory = process.cwd(),
) {
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    CASE_CORRECTNESS_MIGRATION,
    "migration.sql",
  );
  return fs.existsSync(migrationPath)
    ? verifyCaseCorrectnessMigrationBytes(rootDirectory)
    : null;
}

export function writeCaseCorrectnessMigration(rootDirectory = process.cwd()) {
  const migrationDirectory = path.join(
    rootDirectory,
    "prisma/migrations",
    CASE_CORRECTNESS_MIGRATION,
  );
  fs.mkdirSync(migrationDirectory, { recursive: true });
  const migrationPath = path.join(migrationDirectory, "migration.sql");
  fs.writeFileSync(
    migrationPath,
    buildCaseCorrectnessMigration(rootDirectory),
    "utf8",
  );
  return migrationPath;
}

const isMain =
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  process.stdout.write(`${writeCaseCorrectnessMigration()}\n`);
}
