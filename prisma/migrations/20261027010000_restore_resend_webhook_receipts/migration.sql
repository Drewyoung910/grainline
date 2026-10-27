-- Restore the existing Resend webhook receipt path. The route owns a short
-- replay lease through processingStartedAt and does not use the separate
-- delivery-worker claimToken protocol. Replace the incompatible equality with
-- the narrower invariant shared by both protocols: a worker claim token needs
-- a processing timestamp, while a signed webhook may hold a timestamp-only
-- lease.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.resend-webhook.receipt-compatibility.c1180', 0)
);

DO $grainline_resend_webhook_receipt_preflight$
DECLARE
  table_owner oid;
  constraint_definition text;
BEGIN
  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."ResendWebhookEvent"'::pg_catalog.regclass
     AND class.relkind = 'r';

  IF table_owner IS DISTINCT FROM (
    SELECT role.oid
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  ) OR current_user <> session_user THEN
    RAISE EXCEPTION 'Resend webhook receipt recovery requires a direct table-owner session';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
    INTO constraint_definition
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid = 'public."ResendWebhookEvent"'::pg_catalog.regclass
     AND constraint_row.conname = 'ResendWebhookEvent_claim_pair_chk'
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated;

  IF constraint_definition IS DISTINCT FROM
       'CHECK (("claimToken" IS NULL) = ("processingStartedAt" IS NULL))' THEN
    RAISE EXCEPTION 'Resend webhook claim-pair predecessor drifted: %',
      COALESCE(constraint_definition, '<missing>');
  END IF;

  IF NOT pg_catalog.has_table_privilege(
    'grainline_app_runtime', 'public."ResendWebhookEvent"', 'INSERT'
  ) OR NOT pg_catalog.has_table_privilege(
    'grainline_app_runtime', 'public."ResendWebhookEvent"', 'UPDATE'
  ) OR NOT pg_catalog.has_table_privilege(
    'grainline_app_runtime', 'public."ResendWebhookEvent"', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Resend webhook runtime receipt authority drifted';
  END IF;
END
$grainline_resend_webhook_receipt_preflight$;

LOCK TABLE public."ResendWebhookEvent" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public."ResendWebhookEvent"
  DROP CONSTRAINT "ResendWebhookEvent_claim_pair_chk",
  ADD CONSTRAINT "ResendWebhookEvent_claim_pair_chk"
  CHECK ("claimToken" IS NULL OR "processingStartedAt" IS NOT NULL) NOT VALID;

ALTER TABLE public."ResendWebhookEvent"
  VALIDATE CONSTRAINT "ResendWebhookEvent_claim_pair_chk";

DO $grainline_resend_webhook_receipt_postflight$
DECLARE
  constraint_definition text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
    INTO constraint_definition
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid = 'public."ResendWebhookEvent"'::pg_catalog.regclass
     AND constraint_row.conname = 'ResendWebhookEvent_claim_pair_chk'
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated;

  IF constraint_definition IS DISTINCT FROM
       'CHECK ("claimToken" IS NULL OR "processingStartedAt" IS NOT NULL)' THEN
    RAISE EXCEPTION 'Compatible Resend webhook claim-pair constraint drifted: %',
      COALESCE(constraint_definition, '<missing>');
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = 'public."ResendWebhookEvent"'::pg_catalog.regclass
       AND constraint_row.conname IN (
         'ResendWebhookEvent_claimGeneration_chk',
         'ResendWebhookEvent_attempts_nonnegative_chk',
         'ResendWebhookEvent_acknowledgement_pair_chk'
       )
       AND constraint_row.contype = 'c'
       AND constraint_row.convalidated
  ) <> 3 THEN
    RAISE EXCEPTION 'Retained Resend webhook constraints drifted';
  END IF;
END
$grainline_resend_webhook_receipt_postflight$;

COMMIT;
