#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION =
  "20260826010000_prepare_blocked_checkout_transfer_binding";
export const BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION_SHA256 =
  "c5a2f599a8b5ef711053e4cc8fb36e8fbfd080ecaebd4e7e27ff08ca016e3c06";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildBlockedCheckoutTransferBindingMigration() {
  return `-- Bind the provider-derived destination transfer to one paid blocked-checkout
-- Order before refund authority is claimed. The function is callable only by
-- the restricted runtime role, is fenced to the exact active signed webhook
-- generation, and cannot alter an Order once any refund claim or record exists.
-- This migration does not enable RLS or change table grants.

CREATE FUNCTION public.grainline_blocked_checkout_transfer_bind(
  p_event_id text,
  p_event_claim_generation bigint,
  p_session_id text,
  p_order_id text,
  p_payment_intent_id text,
  p_charge_id text,
  p_transfer_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_blocked_checkout_transfer_bind$
DECLARE
  locked_event public."StripeWebhookEvent"%ROWTYPE;
  locked_order public."Order"%ROWTYPE;
BEGIN
  IF p_event_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_event_id)) NOT BETWEEN 1 AND 255
     OR p_event_claim_generation IS NULL OR p_event_claim_generation < 1
     OR p_session_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_session_id)) NOT BETWEEN 1 AND 255
     OR p_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_order_id)) NOT BETWEEN 1 AND 191
     OR p_payment_intent_id IS NULL
     OR pg_catalog.char_length(p_payment_intent_id) NOT BETWEEN 1 AND 255
     OR p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$'
     OR p_charge_id IS NULL
     OR pg_catalog.char_length(p_charge_id) NOT BETWEEN 1 AND 255
     OR p_charge_id !~ '^ch_[A-Za-z0-9_]+$'
     OR p_transfer_id IS NULL
     OR pg_catalog.char_length(p_transfer_id) NOT BETWEEN 1 AND 255
     OR p_transfer_id !~ '^tr_[A-Za-z0-9_]+$' THEN
    RAISE EXCEPTION 'Blocked-checkout transfer binding input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT source_event.*
    INTO locked_event
    FROM public."StripeWebhookEvent" AS source_event
   WHERE source_event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_event.type NOT IN (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded'
     )
     OR locked_event."claimGeneration" IS DISTINCT FROM p_event_claim_generation
     OR locked_event."processingStartedAt" IS NULL
     OR locked_event."processedAt" IS NOT NULL
     OR locked_event."sourceObjectId" IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'Blocked-checkout transfer binding source lease is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT orders.*
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_order."stripeSessionId" IS DISTINCT FROM p_session_id
     OR locked_order."stripePaymentIntentId" IS DISTINCT FROM p_payment_intent_id
     OR locked_order."stripeChargeId" IS DISTINCT FROM p_charge_id
     OR locked_order."paidAt" IS NULL THEN
    RAISE EXCEPTION 'Blocked-checkout transfer binding Order source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF locked_order."stripeTransferId" IS NOT NULL THEN
    IF locked_order."stripeTransferId" IS DISTINCT FROM p_transfer_id THEN
      RAISE EXCEPTION 'Blocked-checkout transfer binding conflicts with the durable transfer'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'action', 'replay',
      'orderId', locked_order.id,
      'transferId', locked_order."stripeTransferId"
    );
  END IF;

  IF locked_order."sellerRefundId" IS NOT NULL
     OR locked_order."sellerRefundLockedAt" IS NOT NULL
     OR locked_order."refundClaimId" IS NOT NULL
     OR EXISTS (
       SELECT 1
         FROM public."OrderPaymentEvent" AS payment_event
        WHERE payment_event."orderId" = locked_order.id
          AND payment_event."eventType" = 'REFUND'
     ) THEN
    RAISE EXCEPTION 'Blocked-checkout transfer binding arrived after refund authority'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public."Order" AS orders
     SET "stripeTransferId" = p_transfer_id,
         "updatedAt" = (
           pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
         )::timestamp(3)
   WHERE orders.id = locked_order.id
     AND orders."stripeTransferId" IS NULL
     AND orders."sellerRefundId" IS NULL
     AND orders."sellerRefundLockedAt" IS NULL
     AND orders."refundClaimId" IS NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public."OrderPaymentEvent" AS payment_event
        WHERE payment_event."orderId" = orders.id
          AND payment_event."eventType" = 'REFUND'
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blocked-checkout transfer binding raced'
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'action', 'bound',
    'orderId', locked_order.id,
    'transferId', p_transfer_id
  );
END
$grainline_blocked_checkout_transfer_bind$;

REVOKE ALL ON FUNCTION public.grainline_blocked_checkout_transfer_bind(
  text, bigint, text, text, text, text, text
) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_blocked_checkout_transfer_bind(
  text, bigint, text, text, text, text, text
) TO grainline_app_runtime;

COMMENT ON FUNCTION public.grainline_blocked_checkout_transfer_bind(
  text, bigint, text, text, text, text, text
) IS
  'Binds one provider-derived destination transfer to an exact paid Order under the active signed blocked-checkout webhook generation before refund authority.';

DO $grainline_blocked_checkout_transfer_bind_verify$
DECLARE
  function_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_blocked_checkout_transfer_bind(text,bigint,text,text,text,text,text)'
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
    RAISE EXCEPTION 'Blocked-checkout transfer binding function catalog drifted';
  END IF;
END;
$grainline_blocked_checkout_transfer_bind_verify$;
`;
}

export function blockedCheckoutTransferBindingFunctionSource() {
  const migration = buildBlockedCheckoutTransferBindingMigration();
  const opening = "AS $grainline_blocked_checkout_transfer_bind$\n";
  const closing = "\n$grainline_blocked_checkout_transfer_bind$;";
  const start = migration.indexOf(opening);
  const end = migration.indexOf(closing, start + opening.length);
  if (start < 0 || end < 0) {
    throw new Error("blocked-checkout transfer binding function source is missing");
  }
  return migration.slice(start + opening.length, end);
}

export function verifyBlockedCheckoutTransferBindingMigrationBytes(
  rootDirectory = process.cwd(),
) {
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION,
    "migration.sql",
  );
  const expected = buildBlockedCheckoutTransferBindingMigration();
  if (!fs.existsSync(migrationPath)) {
    throw new Error("blocked-checkout transfer binding migration is missing");
  }
  const migration = fs.readFileSync(migrationPath, "utf8");
  if (migration !== expected) {
    throw new Error("blocked-checkout transfer binding migration bytes drifted");
  }
  if (sha256(migration) !== BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION_SHA256) {
    throw new Error("blocked-checkout transfer binding migration checksum drifted");
  }
  return Object.freeze({ migrationPath, migrationSha256: sha256(migration) });
}

function main() {
  const rootDirectory = process.cwd();
  const outputPath = path.join(
    rootDirectory,
    "prisma/migrations",
    BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION,
    "migration.sql",
  );
  const expected = buildBlockedCheckoutTransferBindingMigration();
  if (process.argv.includes("--write")) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, expected, "utf8");
  } else if (process.argv.includes("--verify")) {
    verifyBlockedCheckoutTransferBindingMigrationBytes(rootDirectory);
  } else {
    process.stdout.write(`${sha256(expected)}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
