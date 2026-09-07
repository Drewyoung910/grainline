-- DRAFT: independently released CheckoutStockReservation integrity correction.
-- Reject NULL before any repair lookup, lease update, or stock restoration.
-- All six legitimate outcome branches, function ACLs and FORCE posture remain.
-- Not wired into migrations or any production workflow.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $repair_before$
BEGIN
  IF current_user <> 'neondb_owner' OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('public.grainline_checkout_reservation_repair_finalize(text,bigint,text)')
       AND proc.proowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neondb_owner')
       AND proc.prokind = 'f' AND proc.prosecdef AND NOT proc.proleakproof
       AND proc.provolatile = 'v' AND proc.proparallel = 'u'
       AND proc.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.md5(proc.prosrc) = '5df36cef68664c30cb985056b87e1254'
       AND pg_catalog.has_function_privilege('grainline_app_runtime', proc.oid, 'EXECUTE')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proc.proacl,
           pg_catalog.acldefault('f', proc.proowner))) AS acl
          WHERE acl.grantee NOT IN (proc.proowner,
            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime'))
             OR (acl.grantee <> proc.proowner AND acl.is_grantable)
       )
  ) THEN
    RAISE EXCEPTION 'Checkout repair before function authority drifted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS tbl
     WHERE tbl.oid = pg_catalog.to_regclass('public."CheckoutStockReservation"')
       AND tbl.relrowsecurity AND tbl.relforcerowsecurity
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = tbl.oid)
       AND NOT pg_catalog.has_table_privilege('grainline_app_runtime', tbl.oid,
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       AND NOT pg_catalog.has_any_column_privilege('grainline_app_runtime', tbl.oid,
         'SELECT,INSERT,UPDATE,REFERENCES')
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(tbl.relacl,
         pg_catalog.acldefault('r', tbl.relowner))) AS acl WHERE acl.grantee = 0)
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_attribute AS col,
           LATERAL pg_catalog.aclexplode(col.attacl) AS acl
          WHERE col.attrelid = tbl.oid AND acl.grantee = 0
       )
  ) THEN
    RAISE EXCEPTION 'Checkout repair before table posture drifted';
  END IF;
END
$repair_before$;

CREATE OR REPLACE FUNCTION public.grainline_checkout_reservation_repair_finalize(
  p_reservation_id text,
  p_repair_generation bigint,
  p_outcome text
)
RETURNS TABLE(result text, checkout_lock_key text, stripe_session_id text, stock_visibility_changed integer)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_repair_finalize$
DECLARE
  source_reservation public."CheckoutStockReservation"%ROWTYPE;
  source_session_id text;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  source_visibility integer := 0;
  source_reason text;
BEGIN
  IF p_reservation_id IS NULL OR pg_catalog.char_length(p_reservation_id) NOT BETWEEN 1 AND 191
     OR p_repair_generation IS NULL OR p_repair_generation < 1
     OR p_outcome IS NULL OR p_outcome NOT IN (
       'NO_SESSION_RESTORE', 'SESSION_EXPIRED_RESTORE', 'PAID_OR_COMPLETE',
       'RETRIEVE_FAILED', 'UNRECOGNIZED', 'EXPIRE_FAILED'
     ) THEN
    RAISE EXCEPTION 'Checkout repair finalizer input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT reservation."stripeSessionId"
    INTO source_session_id
    FROM public."CheckoutStockReservation" AS reservation
   WHERE reservation.id = p_reservation_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'absent'::text, NULL::text, NULL::text, 0;
    RETURN;
  END IF;
  IF source_session_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(913337, pg_catalog.hashtext(source_session_id));
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(913338, pg_catalog.hashtext(p_reservation_id));
  END IF;

  SELECT reservation.*
    INTO STRICT source_reservation
    FROM public."CheckoutStockReservation" AS reservation
   WHERE reservation.id = p_reservation_id
   FOR UPDATE;
  IF source_reservation."repairGeneration" <> p_repair_generation
     OR source_reservation."repairClaimedAt" IS NULL
     OR source_reservation."repairClaimKind" IS NULL
     OR source_reservation."stripeSessionId" IS DISTINCT FROM source_session_id THEN
    RETURN QUERY
      SELECT 'superseded'::text, source_reservation."checkoutLockKey"::text,
             source_reservation."stripeSessionId"::text, 0;
    RETURN;
  END IF;

  IF source_session_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public."Order" AS source_order WHERE source_order."stripeSessionId" = source_session_id) THEN
    UPDATE public."CheckoutStockReservation" AS reservation
       SET status = 'COMPLETED',
           "repairClaimedAt" = NULL,
           "repairClaimKind" = NULL,
           "lastRepairError" = NULL,
           "updatedAt" = source_now
     WHERE reservation.id = source_reservation.id;
    RETURN QUERY SELECT 'completed'::text, source_reservation."checkoutLockKey"::text, source_session_id, 0;
    RETURN;
  END IF;

  IF source_reservation.status IN ('COMPLETED', 'RESTORED') THEN
    RETURN QUERY
      SELECT 'terminal'::text, source_reservation."checkoutLockKey"::text, source_session_id, 0;
    RETURN;
  END IF;

  IF p_outcome IN ('PAID_OR_COMPLETE', 'RETRIEVE_FAILED', 'UNRECOGNIZED', 'EXPIRE_FAILED') THEN
    UPDATE public."CheckoutStockReservation" AS reservation
       SET "repairClaimedAt" = NULL,
           "repairClaimKind" = NULL,
           "lastRepairError" = CASE p_outcome
             WHEN 'PAID_OR_COMPLETE' THEN 'paid_missing_local_order'
             WHEN 'RETRIEVE_FAILED' THEN 'session_retrieve_failed'
             WHEN 'UNRECOGNIZED' THEN 'unrecognized_session_state'
             ELSE 'session_expire_failed'
           END,
           "lastRepairAttemptAt" = source_now,
           "expiresAt" = source_now,
           "updatedAt" = source_now
     WHERE reservation.id = source_reservation.id;
    RETURN QUERY SELECT 'deferred'::text, source_reservation."checkoutLockKey"::text, source_session_id, 0;
    RETURN;
  END IF;

  IF (p_outcome = 'NO_SESSION_RESTORE' AND source_session_id IS NOT NULL)
     OR (p_outcome = 'SESSION_EXPIRED_RESTORE' AND source_session_id IS NULL) THEN
    RAISE EXCEPTION 'Checkout repair outcome does not match reservation session state'
      USING ERRCODE = 'check_violation';
  END IF;

  source_visibility := public.grainline_checkout_reservation_restore_items(
    source_reservation."reservedItems"
  );
  source_reason := CASE
    WHEN source_reservation."repairClaimKind" = 'ACCOUNT' AND source_session_id IS NULL
      THEN 'account_deletion_no_session'
    WHEN source_reservation."repairClaimKind" = 'ACCOUNT'
      THEN 'account_deletion_stripe_session_unpaid'
    WHEN source_session_id IS NULL THEN 'stale_no_session'
    ELSE 'stale_stripe_session_unpaid'
  END;

  UPDATE public."CheckoutStockReservation" AS reservation
     SET status = 'RESTORED',
         "restoredAt" = source_now,
         "restoreReason" = source_reason,
         "repairClaimedAt" = NULL,
         "repairClaimKind" = NULL,
         "lastRepairError" = NULL,
         "lastRepairAttemptAt" = source_now,
         "updatedAt" = source_now
   WHERE reservation.id = source_reservation.id;
  RETURN QUERY SELECT 'restored'::text, source_reservation."checkoutLockKey"::text, source_session_id, source_visibility;
END
$grainline_checkout_reservation_repair_finalize$;

DO $repair_after$
BEGIN
  IF current_user <> 'neondb_owner' OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('public.grainline_checkout_reservation_repair_finalize(text,bigint,text)')
       AND proc.proowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neondb_owner')
       AND proc.prokind = 'f' AND proc.prosecdef AND NOT proc.proleakproof
       AND proc.provolatile = 'v' AND proc.proparallel = 'u'
       AND proc.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.md5(proc.prosrc) = '5052b2e2190add196fee7a429e44755f'
       AND pg_catalog.has_function_privilege('grainline_app_runtime', proc.oid, 'EXECUTE')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proc.proacl,
           pg_catalog.acldefault('f', proc.proowner))) AS acl
          WHERE acl.grantee NOT IN (proc.proowner,
            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime'))
             OR (acl.grantee <> proc.proowner AND acl.is_grantable)
       )
  ) THEN
    RAISE EXCEPTION 'Checkout repair after function authority drifted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS tbl
     WHERE tbl.oid = pg_catalog.to_regclass('public."CheckoutStockReservation"')
       AND tbl.relrowsecurity AND tbl.relforcerowsecurity
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = tbl.oid)
       AND NOT pg_catalog.has_table_privilege('grainline_app_runtime', tbl.oid,
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       AND NOT pg_catalog.has_any_column_privilege('grainline_app_runtime', tbl.oid,
         'SELECT,INSERT,UPDATE,REFERENCES')
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(tbl.relacl,
         pg_catalog.acldefault('r', tbl.relowner))) AS acl WHERE acl.grantee = 0)
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_attribute AS col,
           LATERAL pg_catalog.aclexplode(col.attacl) AS acl
          WHERE col.attrelid = tbl.oid AND acl.grantee = 0
       )
  ) THEN
    RAISE EXCEPTION 'Checkout repair after table posture drifted';
  END IF;
END
$repair_after$;

COMMIT;
