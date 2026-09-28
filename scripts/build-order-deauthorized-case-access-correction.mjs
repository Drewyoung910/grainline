#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEAUTHORIZED_CASE_ACCESS_MIGRATION =
  "20260928010000_correct_order_deauthorized_case_access";
export const CASE_OPEN_PREDECESSOR_SOURCE_SHA256 =
  "e1bdb4a86f13c0115e2a450de06cb0881b115a58d9bb7b9c68b6963654649bc9";
export const BUYER_DETAIL_V3_SOURCE_SHA256 =
  "a70730f1adf31821aaf4b9c46619f3e026b7cd0312900c57b4b796bb93090d2a";
export const ORDER_DEAUTHORIZED_CASE_ACCESS_RUNTIME_FUNCTIONS = Object.freeze([
  "grainline_order_buyer_detail_v4(text,text)",
]);

const CASE_OPEN_NAME = "grainline_case_open";
const CASE_OPEN_IDENTITY =
  "public.grainline_case_open(text,text,text,text)";
const BUYER_DETAIL_V3_NAME = "grainline_order_buyer_detail_v3";
const BUYER_DETAIL_V3_IDENTITY =
  "public.grainline_order_buyer_detail_v3(text,text)";
const BUYER_DETAIL_V4_NAME = "grainline_order_buyer_detail_v4";
const BUYER_DETAIL_V4_IDENTITY =
  "public.grainline_order_buyer_detail_v4(text,text)";
const BUYER_DETAIL_SIGNATURE = "text, text";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function extractFunctionDefinition(sql, functionName, createMarker) {
  const marker = `${createMarker} public.${functionName}(`;
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

export function extractFunctionSource(definition, functionName) {
  const opening = `AS $${functionName}$`;
  const closing = `$${functionName}$;`;
  const start = definition.indexOf(opening);
  const end = definition.indexOf(closing, start + opening.length);
  assert.ok(start >= 0 && end >= 0, `${functionName} source is missing`);
  return definition.slice(start + opening.length, end);
}

function replaceExactly(source, before, after, count, label) {
  assert.equal(
    source.split(before).length - 1,
    count,
    `${label} predecessor text drifted`,
  );
  return source.replaceAll(before, after);
}

function correctedCaseOpenDefinition(rootDirectory) {
  const sql = fs.readFileSync(
    path.join(
      rootDirectory,
      "prisma/migrations/20260729051000_prepare_case_open_authority/migration.sql",
    ),
    "utf8",
  );
  let definition = extractFunctionDefinition(
    sql,
    CASE_OPEN_NAME,
    "CREATE OR REPLACE FUNCTION",
  );
  assert.equal(
    sha256(extractFunctionSource(definition, CASE_OPEN_NAME)),
    CASE_OPEN_PREDECESSOR_SOURCE_SHA256,
    "Case-open predecessor source drifted",
  );
  definition = replaceExactly(
    definition,
    `     AND locked_seller."deletedAt" IS NULL
     AND NOT locked_order."reviewNeeded" THEN`,
    `     AND locked_seller."deletedAt" IS NULL
     AND locked_order."sellerDeauthorizedAt" IS NULL
     AND NOT locked_order."reviewNeeded" THEN`,
    2,
    "deauthorized Case-open exception",
  );
  definition = replaceExactly(
    definition,
    `  IF window_reference_at IS NOT NULL
     AND window_reference_at + INTERVAL '30 days' < transition_at THEN`,
    `  IF window_reference_at IS NOT NULL
     AND window_reference_at + INTERVAL '30 days' < transition_at
     AND NOT (
       locked_order."sellerDeauthorizedAt" IS NOT NULL
       AND locked_order."fulfillmentStatus" =
             'PENDING'::public."FulfillmentStatus"
     ) THEN`,
    1,
    "deauthorized Case-window exception",
  );
  return definition;
}

function assertBuyerDetailV3(rootDirectory) {
  const sql = fs.readFileSync(
    path.join(
      rootDirectory,
      "prisma/migrations/20260901105000_correct_order_participant_snapshot_projection/migration.sql",
    ),
    "utf8",
  );
  const definition = extractFunctionDefinition(
    sql,
    BUYER_DETAIL_V3_NAME,
    "CREATE FUNCTION",
  );
  assert.equal(
    sha256(extractFunctionSource(definition, BUYER_DETAIL_V3_NAME)),
    BUYER_DETAIL_V3_SOURCE_SHA256,
    "Buyer-detail v3 predecessor source drifted",
  );
}

function buyerDetailV4Definition() {
  return `CREATE FUNCTION public.${BUYER_DETAIL_V4_NAME}(
  p_actor_user_id text,
  p_order_id text
)
RETURNS TABLE(
  order_id text,
  created_at_epoch_millis bigint,
  paid_at_epoch_millis bigint,
  currency text,
  items_subtotal_cents integer,
  shipping_title text,
  shipping_amount_cents integer,
  tax_amount_cents integer,
  fulfillment_method text,
  fulfillment_status text,
  tracking_carrier text,
  tracking_number text,
  pickup_ready_at_epoch_millis bigint,
  picked_up_at_epoch_millis bigint,
  shipped_at_epoch_millis bigint,
  delivered_at_epoch_millis bigint,
  estimated_delivery_at_epoch_millis bigint,
  shipping_carrier text,
  shipping_service text,
  review_needed boolean,
  deauthorized_case_access boolean,
  case_open_label_blocked boolean,
  gift_note text,
  gift_wrapping boolean,
  gift_wrapping_price_cents integer,
  buyer_data_purged_at_epoch_millis bigint,
  ship_to_line_1 text,
  ship_to_line_2 text,
  ship_to_city text,
  ship_to_state text,
  ship_to_postal_code text,
  ship_to_country text,
  seller_refund_state text,
  seller_refund_amount_cents integer,
  seller_user_id text,
  items jsonb
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $${BUYER_DETAIL_V4_NAME}$
  SELECT
    detail.order_id,
    detail.created_at_epoch_millis,
    detail.paid_at_epoch_millis,
    detail.currency,
    detail.items_subtotal_cents,
    detail.shipping_title,
    detail.shipping_amount_cents,
    detail.tax_amount_cents,
    detail.fulfillment_method,
    detail.fulfillment_status,
    detail.tracking_carrier,
    detail.tracking_number,
    detail.pickup_ready_at_epoch_millis,
    detail.picked_up_at_epoch_millis,
    detail.shipped_at_epoch_millis,
    detail.delivered_at_epoch_millis,
    detail.estimated_delivery_at_epoch_millis,
    detail.shipping_carrier,
    detail.shipping_service,
    detail.review_needed,
    source_order."sellerDeauthorizedAt" IS NOT NULL
      AND NOT (
        source_order."labelStatus"::text IS NOT DISTINCT FROM 'PURCHASED'
        AND source_order."fulfillmentStatus"::text IS NOT DISTINCT FROM 'PENDING'
      ),
    source_order."labelStatus"::text IS NOT DISTINCT FROM 'PURCHASED'
      AND source_order."fulfillmentStatus"::text IS NOT DISTINCT FROM 'PENDING',
    detail.gift_note,
    detail.gift_wrapping,
    detail.gift_wrapping_price_cents,
    detail.buyer_data_purged_at_epoch_millis,
    detail.ship_to_line_1,
    detail.ship_to_line_2,
    detail.ship_to_city,
    detail.ship_to_state,
    detail.ship_to_postal_code,
    detail.ship_to_country,
    detail.seller_refund_state,
    detail.seller_refund_amount_cents,
    detail.seller_user_id,
    detail.items
  FROM public.${BUYER_DETAIL_V3_NAME}(p_actor_user_id, p_order_id) AS detail
  JOIN public."Order" AS source_order
    ON source_order.id = detail.order_id;
$${BUYER_DETAIL_V4_NAME}$;`;
}

function functionAttestation(identity, sourceSha256, volatility, parallel) {
  return `IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = pg_catalog.to_regprocedure('${identity}')
       AND pg_catalog.pg_get_userbyid(routine.proowner) = current_user
       AND routine.prosecdef
       AND routine.provolatile = '${volatility}'
       AND routine.proparallel = '${parallel}'
       AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.encode(
             pg_catalog.sha256(pg_catalog.convert_to(routine.prosrc, 'UTF8')),
             'hex'
           ) = '${sourceSha256}'
       AND pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           )
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
                  COALESCE(
                    routine.proacl,
                    pg_catalog.acldefault('f', routine.proowner)
                  )
                ) AS acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       )
  ) THEN
    RAISE EXCEPTION 'Order deauthorized Case-access function drifted: ${identity}';
  END IF;`;
}

export function buildOrderDeauthorizedCaseAccessCorrection(rootDirectory = ROOT) {
  const caseOpenDefinition = correctedCaseOpenDefinition(rootDirectory);
  assertBuyerDetailV3(rootDirectory);
  const buyerV4Definition = buyerDetailV4Definition();
  const correctedCaseOpenSha256 = sha256(
    extractFunctionSource(caseOpenDefinition, CASE_OPEN_NAME),
  );
  const buyerV4Sha256 = sha256(
    extractFunctionSource(buyerV4Definition, BUYER_DETAIL_V4_NAME),
  );

  return `-- Keep the durable seller-deauthorization fulfillment hold while
-- giving the affected buyer an immediate Case recovery path. The label-purchase
-- exclusion remains intact, and no table grant or RLS posture changes.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.order.deauthorized-case-access', 0)
);

DO $grainline_order_deauthorized_case_access_preflight$
BEGIN
  ${functionAttestation(CASE_OPEN_IDENTITY, CASE_OPEN_PREDECESSOR_SOURCE_SHA256, "v", "u")}
  ${functionAttestation(BUYER_DETAIL_V3_IDENTITY, BUYER_DETAIL_V3_SOURCE_SHA256, "s", "s")}

  IF NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = 'public."Order"'::pg_catalog.regclass
          AND attribute.attname = 'sellerDeauthorizedAt'
          AND attribute.atttypid = 'pg_catalog.timestamp'::pg_catalog.regtype
          AND pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
                = 'timestamp(3) without time zone'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_state
        WHERE constraint_state.conrelid =
                'public."Order"'::pg_catalog.regclass
          AND constraint_state.conname = 'Order_sellerDeauthorization_check'
          AND constraint_state.contype = 'c'
          AND constraint_state.convalidated
     ) THEN
    RAISE EXCEPTION 'Order seller-deauthorization witness contract is missing';
  END IF;
END
$grainline_order_deauthorized_case_access_preflight$;

${caseOpenDefinition}

${buyerV4Definition}

REVOKE ALL ON FUNCTION public.${BUYER_DETAIL_V4_NAME}(${BUYER_DETAIL_SIGNATURE})
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.${BUYER_DETAIL_V4_NAME}(${BUYER_DETAIL_SIGNATURE})
  TO grainline_app_runtime;

COMMENT ON FUNCTION public.${BUYER_DETAIL_V4_NAME}(${BUYER_DETAIL_SIGNATURE}) IS
  'Returns buyer Order detail plus bounded Case-access signals for durable seller deauthorization and an active purchased-label claim.';

DO $grainline_order_deauthorized_case_access_postflight$
BEGIN
  ${functionAttestation(CASE_OPEN_IDENTITY, correctedCaseOpenSha256, "v", "u")}
  ${functionAttestation(BUYER_DETAIL_V4_IDENTITY, buyerV4Sha256, "s", "s")}
END
$grainline_order_deauthorized_case_access_postflight$;

COMMIT;
`;
}

export function verifyOrderDeauthorizedCaseAccessCorrectionBytes(
  rootDirectory = ROOT,
) {
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    DEAUTHORIZED_CASE_ACCESS_MIGRATION,
    "migration.sql",
  );
  const migration = fs.readFileSync(migrationPath, "utf8");
  assert.equal(
    migration,
    buildOrderDeauthorizedCaseAccessCorrection(rootDirectory),
    "Order deauthorized Case-access migration bytes drifted",
  );
  return Object.freeze({
    migration: DEAUTHORIZED_CASE_ACCESS_MIGRATION,
    migrationSha256: sha256(migration),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(buildOrderDeauthorizedCaseAccessCorrection());
}
