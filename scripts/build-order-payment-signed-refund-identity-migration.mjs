#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_PREDECESSOR =
  "20260824030000_prepare_order_payment_signed_authority";
export const ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_PREDECESSOR_SHA256 =
  "176ad2c17301dd1d6bd9a1c0e190e8d44b15463ec830f9a67eb43ec3070396f2";
export const ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION =
  "20260828010000_prepare_order_payment_signed_refund_identity";
export const ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION_SHA256 =
  "cff392a1d1d4def6b67e63c3e7ed13a035bc6b8908ce0a88ef945cbbe1301261";

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

function predecessorRefundDefinition(rootDirectory) {
  const predecessorPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_PREDECESSOR,
    "migration.sql",
  );
  const predecessor = fs.readFileSync(predecessorPath, "utf8");
  assert.equal(
    sha256(predecessor),
    ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_PREDECESSOR_SHA256,
    "signed-refund identity predecessor checksum drifted",
  );
  const opening =
    "CREATE FUNCTION public.grainline_order_payment_signed_refund_apply(";
  const closing = "$grainline_order_payment_signed_refund_apply$;";
  const start = predecessor.indexOf(opening);
  const end = predecessor.indexOf(closing, start);
  assert.ok(start >= 0 && end >= 0, "signed-refund predecessor function is missing");
  return predecessor.slice(start, end + closing.length);
}

export function predecessorOrderPaymentSignedRefundFunctionSource(
  rootDirectory = process.cwd(),
) {
  const definition = predecessorRefundDefinition(rootDirectory);
  const opening = "AS $grainline_order_payment_signed_refund_apply$";
  const closing = "$grainline_order_payment_signed_refund_apply$;";
  const start = definition.indexOf(opening);
  const end = definition.indexOf(closing, start + opening.length);
  assert.ok(start >= 0 && end >= 0, "signed-refund predecessor function source is missing");
  return definition.slice(start + opening.length, end);
}

export function buildOrderPaymentSignedRefundIdentityMigration(
  rootDirectory = process.cwd(),
) {
  let definition = predecessorRefundDefinition(rootDirectory);
  definition = replaceExactlyOnce(
    definition,
    "CREATE FUNCTION public.grainline_order_payment_signed_refund_apply(",
    "CREATE OR REPLACE FUNCTION public.grainline_order_payment_signed_refund_apply(",
    "signed-refund replacement",
  );
  definition = replaceExactlyOnce(
    definition,
    '  existing_payment public."OrderPaymentEvent"%ROWTYPE;\n',
    '  existing_payment public."OrderPaymentEvent"%ROWTYPE;\n'
      + '  local_refund_evidence public."OrderPaymentEvent"%ROWTYPE;\n'
      + "  local_refund_evidence_count integer := 0;\n",
    "signed-refund evidence declaration",
  );
  definition = replaceExactlyOnce(
    definition,
    "  refund_object_id text;\n  event_amount integer;\n",
    "  refund_object_id text;\n"
      + "  event_amount integer;\n"
      + "  effective_refund_id text := p_refund_id;\n"
      + "  effective_refund_amount_cents integer := p_refund_amount_cents;\n"
      + "  local_refund_evidence_id text;\n"
      + "  local_refund_evidence_action text;\n"
      + "  local_refund_identity_derived boolean := false;\n",
    "signed-refund effective identity declaration",
  );

  const originalIdentityBlock = `  refund_object_id := COALESCE(p_refund_id, 'external:' || p_event_id);
  event_amount := COALESCE(p_refund_amount_cents, p_amount_refunded_cents);
  order_total :=
      source_order."itemsSubtotalCents"
    + source_order."shippingAmountCents"
    + COALESCE(source_order."giftWrappingPriceCents", 0)
    + source_order."taxAmountCents";
  IF order_total <= 0 OR order_total > 2147483647 THEN
    RAISE EXCEPTION 'Signed refund Order total is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT payment.*
    INTO existing_payment
    FROM public."OrderPaymentEvent" AS payment
   WHERE payment."stripeEventId" = p_event_id
   FOR SHARE;
  IF FOUND THEN
    IF existing_payment."orderId" IS DISTINCT FROM source_order.id
       OR existing_payment."stripeObjectId" IS DISTINCT FROM refund_object_id
       OR existing_payment."stripeObjectType" IS DISTINCT FROM 'refund'
       OR existing_payment."eventType" IS DISTINCT FROM 'REFUND'
       OR existing_payment."amountCents" IS DISTINCT FROM event_amount
       OR existing_payment.currency IS DISTINCT FROM normalized_currency
       OR existing_payment.status IS DISTINCT FROM normalized_status
       OR existing_payment."stripeEventCreatedSeconds"
            IS DISTINCT FROM p_event_created_seconds
       OR existing_payment.metadata->>'chargeId' IS DISTINCT FROM p_charge_id
       OR existing_payment.metadata->>'latestRefundId'
            IS DISTINCT FROM p_refund_id
       OR existing_payment.metadata->>'latestRefundAmountCents'
            IS DISTINCT FROM p_refund_amount_cents::text
       OR existing_payment.metadata->>'totalRefundedCents'
            IS DISTINCT FROM p_amount_refunded_cents::text
       OR existing_payment.metadata->>'refundCreatedSeconds'
            IS DISTINCT FROM p_refund_created_seconds::text
       OR existing_payment.metadata->>'refundReason'
            IS DISTINCT FROM normalized_reason THEN
      RAISE EXCEPTION 'Signed refund replay payload is inconsistent'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN QUERY SELECT
      'replay'::text,
      existing_payment.id::text,
      source_order.id::text,
      false;
    RETURN;
  END IF;
`;

  const correctedIdentityBlock = `  order_total :=
      source_order."itemsSubtotalCents"
    + source_order."shippingAmountCents"
    + COALESCE(source_order."giftWrappingPriceCents", 0)
    + source_order."taxAmountCents";
  IF order_total <= 0 OR order_total > 2147483647 THEN
    RAISE EXCEPTION 'Signed refund Order total is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_refund_id IS NULL
     AND source_order."sellerRefundId" ~ '^re_[A-Za-z0-9]+$'
     AND source_order."sellerRefundAmountCents"
          IS NOT DISTINCT FROM p_amount_refunded_cents THEN
    SELECT pg_catalog.count(*)::integer
      INTO local_refund_evidence_count
      FROM public."OrderPaymentEvent" AS payment
     WHERE payment."orderId" = source_order.id
       AND payment."stripeObjectId" = source_order."sellerRefundId"
       AND payment."stripeObjectType" = 'refund'
       AND payment."eventType" = 'REFUND'
       AND payment."amountCents" = p_amount_refunded_cents
       AND pg_catalog.lower(payment.currency) = normalized_currency
       AND payment.status IS NOT NULL
       AND pg_catalog.char_length(pg_catalog.btrim(payment.status)) BETWEEN 1 AND 100
       AND pg_catalog.jsonb_typeof(payment.metadata) = 'object'
       AND payment.metadata->>'localAction' IN (
         'SELLER_REFUND_RECORDED',
         'CASE_REFUND_RECORDED',
         'BLOCKED_CHECKOUT_REFUND_RECORDED'
       )
       AND payment.reason = CASE payment.metadata->>'localAction'
         WHEN 'SELLER_REFUND_RECORDED' THEN 'seller_refund'
         WHEN 'CASE_REFUND_RECORDED' THEN 'case_resolution_refund'
         WHEN 'BLOCKED_CHECKOUT_REFUND_RECORDED' THEN 'blocked_checkout'
       END
       AND payment."stripeEventId" =
         'local:' || pg_catalog.lower(payment.metadata->>'localAction')
         || ':' || source_order."sellerRefundId"
       AND pg_catalog.jsonb_typeof(payment.metadata->'refundIds') = 'array'
       AND payment.metadata->'refundIds'
            @> pg_catalog.jsonb_build_array(source_order."sellerRefundId")
       AND EXISTS (
         SELECT 1
           FROM public."SystemAuditLog" AS audit
          WHERE audit.action = payment.metadata->>'localAction'
            AND audit."targetType" = 'ORDER'
            AND audit."targetId" = source_order.id
            AND audit.metadata->>'orderPaymentEventId' = payment.id
            AND audit.metadata->>'stripeRefundId' = source_order."sellerRefundId"
            AND audit.metadata->>'amountCents' = p_amount_refunded_cents::text
            AND pg_catalog.lower(audit.metadata->>'currency') = normalized_currency
       );

    IF local_refund_evidence_count = 1 THEN
      SELECT payment.*
        INTO local_refund_evidence
        FROM public."OrderPaymentEvent" AS payment
       WHERE payment."orderId" = source_order.id
         AND payment."stripeObjectId" = source_order."sellerRefundId"
         AND payment."stripeObjectType" = 'refund'
         AND payment."eventType" = 'REFUND'
         AND payment."amountCents" = p_amount_refunded_cents
         AND pg_catalog.lower(payment.currency) = normalized_currency
         AND payment.status IS NOT NULL
         AND pg_catalog.char_length(pg_catalog.btrim(payment.status)) BETWEEN 1 AND 100
         AND pg_catalog.jsonb_typeof(payment.metadata) = 'object'
         AND payment.metadata->>'localAction' IN (
           'SELLER_REFUND_RECORDED',
           'CASE_REFUND_RECORDED',
           'BLOCKED_CHECKOUT_REFUND_RECORDED'
         )
         AND payment.reason = CASE payment.metadata->>'localAction'
           WHEN 'SELLER_REFUND_RECORDED' THEN 'seller_refund'
           WHEN 'CASE_REFUND_RECORDED' THEN 'case_resolution_refund'
           WHEN 'BLOCKED_CHECKOUT_REFUND_RECORDED' THEN 'blocked_checkout'
         END
         AND payment."stripeEventId" =
           'local:' || pg_catalog.lower(payment.metadata->>'localAction')
           || ':' || source_order."sellerRefundId"
         AND pg_catalog.jsonb_typeof(payment.metadata->'refundIds') = 'array'
         AND payment.metadata->'refundIds'
              @> pg_catalog.jsonb_build_array(source_order."sellerRefundId")
         AND EXISTS (
           SELECT 1
             FROM public."SystemAuditLog" AS audit
            WHERE audit.action = payment.metadata->>'localAction'
              AND audit."targetType" = 'ORDER'
              AND audit."targetId" = source_order.id
              AND audit.metadata->>'orderPaymentEventId' = payment.id
              AND audit.metadata->>'stripeRefundId' = source_order."sellerRefundId"
              AND audit.metadata->>'amountCents' = p_amount_refunded_cents::text
              AND pg_catalog.lower(audit.metadata->>'currency') = normalized_currency
         )
       FOR SHARE;
      effective_refund_id := local_refund_evidence."stripeObjectId";
      effective_refund_amount_cents := local_refund_evidence."amountCents";
      normalized_status := COALESCE(
        NULLIF(pg_catalog.lower(pg_catalog.btrim(local_refund_evidence.status)), ''),
        'refunded'
      );
      local_refund_evidence_id := local_refund_evidence.id;
      local_refund_evidence_action :=
        local_refund_evidence.metadata->>'localAction';
      local_refund_identity_derived := true;
    END IF;
  END IF;

  refund_object_id := COALESCE(
    effective_refund_id,
    'external:' || p_event_id
  );
  event_amount := COALESCE(
    effective_refund_amount_cents,
    p_amount_refunded_cents
  );

  SELECT payment.*
    INTO existing_payment
    FROM public."OrderPaymentEvent" AS payment
   WHERE payment."stripeEventId" = p_event_id
   FOR SHARE;
  IF FOUND THEN
    IF existing_payment."orderId" IS DISTINCT FROM source_order.id
       OR existing_payment."stripeObjectType" IS DISTINCT FROM 'refund'
       OR existing_payment."eventType" IS DISTINCT FROM 'REFUND'
       OR existing_payment.currency IS DISTINCT FROM normalized_currency
       OR existing_payment."stripeEventCreatedSeconds"
            IS DISTINCT FROM p_event_created_seconds
       OR existing_payment.metadata->>'chargeId' IS DISTINCT FROM p_charge_id
       OR existing_payment.metadata->>'totalRefundedCents'
            IS DISTINCT FROM p_amount_refunded_cents::text
       OR existing_payment.metadata->>'refundCreatedSeconds'
            IS DISTINCT FROM p_refund_created_seconds::text
       OR existing_payment.metadata->>'refundReason'
            IS DISTINCT FROM normalized_reason
       OR NOT (
         (
           existing_payment."stripeObjectId" IS NOT DISTINCT FROM refund_object_id
           AND existing_payment."amountCents" IS NOT DISTINCT FROM event_amount
           AND existing_payment.status IS NOT DISTINCT FROM normalized_status
           AND existing_payment.metadata->>'latestRefundId'
                IS NOT DISTINCT FROM effective_refund_id
           AND existing_payment.metadata->>'latestRefundAmountCents'
                IS NOT DISTINCT FROM effective_refund_amount_cents::text
           AND existing_payment.metadata->>'localRefundEvidenceId'
                IS NOT DISTINCT FROM local_refund_evidence_id
           AND existing_payment.metadata->>'localRefundEvidenceAction'
                IS NOT DISTINCT FROM local_refund_evidence_action
         )
         OR (
           p_refund_id IS NULL
           AND local_refund_identity_derived
           AND existing_payment."stripeObjectId" = 'external:' || p_event_id
           AND existing_payment."amountCents" = p_amount_refunded_cents
           AND existing_payment.status = 'refunded'
           AND existing_payment.metadata->>'latestRefundId' IS NULL
           AND existing_payment.metadata->>'latestRefundAmountCents' IS NULL
           AND existing_payment.metadata->>'localRefundEvidenceId' IS NULL
           AND existing_payment.metadata->>'localRefundEvidenceAction' IS NULL
         )
       ) THEN
      RAISE EXCEPTION 'Signed refund replay payload is inconsistent'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN QUERY SELECT
      'replay'::text,
      existing_payment.id::text,
      source_order.id::text,
      false;
    RETURN;
  END IF;
`;
  definition = replaceExactlyOnce(
    definition,
    originalIdentityBlock,
    correctedIdentityBlock,
    "signed-refund identity block",
  );
  definition = replaceExactlyOnce(
    definition,
    "    'latestRefundId', p_refund_id,\n"
      + "    'latestRefundAmountCents', p_refund_amount_cents,\n",
    "    'latestRefundId', effective_refund_id,\n"
      + "    'latestRefundAmountCents', effective_refund_amount_cents,\n"
      + "    'localRefundEvidenceId', local_refund_evidence_id,\n"
      + "    'localRefundEvidenceAction', local_refund_evidence_action,\n",
    "signed-refund canonical metadata",
  );

  return `-- Correct signed charge.refunded identity when the pinned Stripe payload omits
-- its nested refund collection. The function derives an identity only from one
-- exact local refund ledger plus its co-committed audit evidence; ambiguous or
-- mismatched evidence retains the external-refund behavior. OrderPaymentEvent
-- RLS and all table grants remain unchanged for deployment compatibility.

BEGIN;

${definition}

REVOKE ALL ON FUNCTION
  public.grainline_order_payment_signed_refund_apply(
    text, bigint, text, bigint, integer, text, text, integer, text, bigint, text
  ) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_order_payment_signed_refund_apply(
    text, bigint, text, bigint, integer, text, text, integer, text, bigint, text
  ) TO grainline_app_runtime;

COMMENT ON FUNCTION
  public.grainline_order_payment_signed_refund_apply(
    text, bigint, text, bigint, integer, text, text, integer, text, bigint, text
  ) IS
  'Applies one signed charge.refunded observation and derives an omitted refund identity only from exact durable local refund and audit evidence.';

DO $grainline_signed_refund_identity_verify$
DECLARE
  function_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_order_payment_signed_refund_apply(text,bigint,text,bigint,integer,text,text,integer,text,bigint,text)'
  );
BEGIN
  IF function_oid IS NULL
     OR NOT (
       SELECT routine.prosecdef
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = function_oid
     )
     OR (
       SELECT routine.proconfig
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = function_oid
     ) IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
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
    RAISE EXCEPTION 'Signed refund identity function catalog drifted';
  END IF;
END;
$grainline_signed_refund_identity_verify$;

COMMIT;
`;
}

export function orderPaymentSignedRefundIdentityFunctionSource(
  rootDirectory = process.cwd(),
) {
  const migration = buildOrderPaymentSignedRefundIdentityMigration(rootDirectory);
  const opening = "AS $grainline_order_payment_signed_refund_apply$";
  const closing = "$grainline_order_payment_signed_refund_apply$;";
  const start = migration.indexOf(opening);
  const end = migration.indexOf(closing, start + opening.length);
  assert.ok(start >= 0 && end >= 0, "signed-refund identity function source is missing");
  return migration.slice(start + opening.length, end);
}

export function verifyOrderPaymentSignedRefundIdentityMigrationBytes(
  rootDirectory = process.cwd(),
) {
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION,
    "migration.sql",
  );
  const expected = buildOrderPaymentSignedRefundIdentityMigration(rootDirectory);
  assert.ok(fs.existsSync(migrationPath), "signed-refund identity migration is missing");
  const migration = fs.readFileSync(migrationPath, "utf8");
  assert.equal(migration, expected, "signed-refund identity migration bytes drifted");
  assert.equal(
    sha256(migration),
    ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION_SHA256,
    "signed-refund identity migration checksum drifted",
  );
  return Object.freeze({ migrationPath, migrationSha256: sha256(migration) });
}

function main() {
  const rootDirectory = process.cwd();
  const outputPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION,
    "migration.sql",
  );
  const expected = buildOrderPaymentSignedRefundIdentityMigration(rootDirectory);
  if (process.argv.includes("--write")) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, expected, "utf8");
  } else if (process.argv.includes("--verify")) {
    verifyOrderPaymentSignedRefundIdentityMigrationBytes(rootDirectory);
  } else {
    process.stdout.write(`${sha256(expected)}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
