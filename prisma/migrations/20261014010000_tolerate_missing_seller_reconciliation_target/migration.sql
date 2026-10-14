-- A provider refund must remain recordable even if its best-effort seller
-- reconciliation flag has lost the expected SellerProfile/private target.
-- Preserve the compatibility writer's valid-target behavior, but degrade a
-- missing target to a durable operator-visible warning instead of rolling back
-- the already-completed provider-effect finalizer.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $seller_reconciliation_target_preflight$
BEGIN
  IF pg_catalog.to_regclass('public."SellerProfile"') IS NULL
     OR pg_catalog.to_regclass('public."SellerProfilePrivate"') IS NULL
     OR pg_catalog.to_regclass('public."SystemAuditLog"') IS NULL
     OR pg_catalog.to_regprocedure(
          'public.grainline_seller_profile_reconciliation_required_compat(text,text,text,timestamp without time zone)'
        ) IS NULL THEN
    RAISE EXCEPTION 'Seller reconciliation target dependencies are missing';
  END IF;
END
$seller_reconciliation_target_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_seller_profile_reconciliation_required_compat(
  p_seller_profile_id text,
  p_seller_user_id text,
  p_note text,
  p_updated_at timestamp without time zone
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_profile_reconciliation_required_compat$
DECLARE
  target_seller_profile_id text;
BEGIN
  IF (p_seller_profile_id IS NULL) = (p_seller_user_id IS NULL)
     OR COALESCE(p_seller_profile_id, p_seller_user_id) = ''
     OR pg_catalog.char_length(COALESCE(p_seller_profile_id, p_seller_user_id)) > 191
     OR p_note IS NULL
     OR pg_catalog.char_length(p_note) NOT BETWEEN 1 AND 1000
     OR p_updated_at IS NULL THEN
    RAISE EXCEPTION 'Seller reconciliation input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_seller_profile_id IS NOT NULL THEN
    SELECT seller.id
      INTO target_seller_profile_id
      FROM public."SellerProfile" AS seller
     WHERE seller.id = p_seller_profile_id
     FOR UPDATE;
  ELSE
    SELECT seller.id
      INTO target_seller_profile_id
      FROM public."SellerProfile" AS seller
     WHERE seller."userId" = p_seller_user_id
     FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public."SystemAuditLog" (
      id,
      "actorType",
      "actorId",
      action,
      "targetType",
      "targetId",
      reason,
      metadata,
      "createdAt"
    )
    VALUES (
      'seller-reconciliation-skip:' || pg_catalog.gen_random_uuid()::text,
      'system',
      NULL,
      'SELLER_RECONCILIATION_FLAG_SKIPPED',
      CASE
        WHEN p_seller_profile_id IS NOT NULL THEN 'SELLER_PROFILE'
        ELSE 'USER'
      END,
      COALESCE(p_seller_profile_id, p_seller_user_id),
      'seller_profile_missing',
      pg_catalog.jsonb_build_object(
        'missingRelation', 'SellerProfile',
        'reconciliationNote', p_note,
        'requestedAt', p_updated_at
      ),
      p_updated_at
    );
    RETURN;
  END IF;

  PERFORM seller_private."sellerProfileId"
    FROM public."SellerProfilePrivate" AS seller_private
   WHERE seller_private."sellerProfileId" = target_seller_profile_id
   FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public."SystemAuditLog" (
      id,
      "actorType",
      "actorId",
      action,
      "targetType",
      "targetId",
      reason,
      metadata,
      "createdAt"
    )
    VALUES (
      'seller-reconciliation-skip:' || pg_catalog.gen_random_uuid()::text,
      'system',
      NULL,
      'SELLER_RECONCILIATION_FLAG_SKIPPED',
      'SELLER_PROFILE',
      target_seller_profile_id,
      'seller_profile_private_missing',
      pg_catalog.jsonb_build_object(
        'missingRelation', 'SellerProfilePrivate',
        'reconciliationNote', p_note,
        'requestedAt', p_updated_at
      ),
      p_updated_at
    );
    RETURN;
  END IF;

  -- Update the predecessor first. Its installed mirror trigger writes the same
  -- values into the private row; the explicit private update then makes the
  -- intended source authoritative even after that trigger is retired.
  UPDATE public."SellerProfile" AS seller
     SET "manualStripeReconciliationNeeded" = true,
         "manualStripeReconciliationNote" = p_note,
         "updatedAt" = p_updated_at
   WHERE seller.id = target_seller_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller reconciliation predecessor update failed'
      USING ERRCODE = 'serialization_failure';
  END IF;

  UPDATE public."SellerProfilePrivate" AS seller_private
     SET "manualStripeReconciliationNeeded" = true,
         "manualStripeReconciliationNote" = p_note,
         "updatedAt" = p_updated_at
   WHERE seller_private."sellerProfileId" = target_seller_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller reconciliation private update failed'
      USING ERRCODE = 'serialization_failure';
  END IF;
END
$grainline_seller_profile_reconciliation_required_compat$;

REVOKE ALL ON FUNCTION
  public.grainline_seller_profile_reconciliation_required_compat(
    text, text, text, timestamp without time zone
  )
  FROM PUBLIC, grainline_app_runtime;

COMMIT;
