-- Fixed remaining ordinary-runtime operations for private SellerProfile state.
-- These keep the predecessor representation synchronized until cutover.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_profile_view_record(
  p_seller_profile_id text,
  p_viewed_on date
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_profile_view_record$
DECLARE
  public_views integer;
  private_views integer;
  changed_at timestamp(3);
BEGIN
  IF p_seller_profile_id IS NULL
       OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_viewed_on IS NULL
     OR p_viewed_on IS DISTINCT FROM
       (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'Seller profile-view input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller."profileViews", seller_private."profileViews"
    INTO public_views, private_views
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller.id = p_seller_profile_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."ownerAccountActive" = true
   FOR UPDATE OF seller, seller_private;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF public_views IS DISTINCT FROM private_views THEN
    RAISE EXCEPTION 'Seller profile-view representations disagree'
      USING ERRCODE = '40001';
  END IF;
  IF private_views >= 2147483647 THEN
    RAISE EXCEPTION 'Seller profile-view counter is exhausted'
      USING ERRCODE = '22003';
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SellerProfilePrivate"
     SET "profileViews" = "profileViews" + 1,
         "updatedAt" = changed_at
   WHERE "sellerProfileId" = p_seller_profile_id;
  UPDATE public."SellerProfile"
     SET "profileViews" = "profileViews" + 1,
         "updatedAt" = changed_at
   WHERE id = p_seller_profile_id;

  INSERT INTO public."SellerProfileViewDaily" (
    id, "sellerProfileId", date, views
  ) VALUES (
    'spv_' || pg_catalog.md5(p_seller_profile_id || ':' || p_viewed_on::text),
    p_seller_profile_id,
    p_viewed_on::timestamp,
    1
  )
  ON CONFLICT ("sellerProfileId", date) DO UPDATE
    SET views = public."SellerProfileViewDaily".views + 1;

  RETURN true;
END
$grainline_seller_profile_view_record$;

CREATE OR REPLACE FUNCTION public.grainline_seller_account_deletion_reconciliation_clear(
  p_user_id text,
  p_stripe_account_id text,
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_account_deletion_reconciliation_clear$
DECLARE
  seller_profile_id text;
  public_needed boolean;
  private_needed boolean;
  public_note text;
  private_note text;
  changed_at timestamp(3);
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_stripe_account_id IS NULL
       OR p_stripe_account_id !~ '^acct_[A-Za-z0-9_]{1,249}$'
     OR p_side_effect_id IS NULL
       OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Seller reconciliation-clear input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id
     AND effect."userId" = p_user_id
     AND effect.kind = 'STRIPE_REJECT'
     AND effect.status = 'PROCESSING'
     AND effect."claimGeneration" = p_claim_generation
     AND effect."claimToken" = p_claim_token
     AND effect.payload->>'stripeAccountId' = p_stripe_account_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller reconciliation-clear source is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller.id,
         seller."manualStripeReconciliationNeeded",
         seller_private."manualStripeReconciliationNeeded",
         seller."manualStripeReconciliationNote",
         seller_private."manualStripeReconciliationNote"
    INTO seller_profile_id, public_needed, private_needed, public_note, private_note
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller."userId" = p_user_id
     AND seller_private."stripeAccountId" = p_stripe_account_id
   FOR UPDATE OF seller, seller_private;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF public_needed IS DISTINCT FROM private_needed
     OR public_note IS DISTINCT FROM private_note THEN
    RAISE EXCEPTION 'Seller reconciliation representations disagree'
      USING ERRCODE = '40001';
  END IF;
  IF NOT private_needed
     OR private_note IS NULL
     OR private_note NOT LIKE
       'Account deletion could not reject Stripe Connect account%' THEN
    RETURN false;
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SellerProfilePrivate"
     SET "manualStripeReconciliationNeeded" = false,
         "manualStripeReconciliationNote" = NULL,
         "updatedAt" = changed_at
   WHERE "sellerProfileId" = seller_profile_id;
  UPDATE public."SellerProfile"
     SET "manualStripeReconciliationNeeded" = false,
         "manualStripeReconciliationNote" = NULL,
         "updatedAt" = changed_at
   WHERE id = seller_profile_id
     AND "userId" = p_user_id;

  RETURN true;
END
$grainline_seller_account_deletion_reconciliation_clear$;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_guild_master_application_record(
  p_user_id text,
  p_seller_profile_id text,
  p_applied_at timestamp without time zone
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_guild_master_application_record$
DECLARE
  changed_at timestamp(3);
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_seller_profile_id IS NULL
       OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_applied_at IS NULL
     OR p_applied_at < (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 minutes'
     OR p_applied_at > (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') + INTERVAL '1 minute' THEN
    RAISE EXCEPTION 'Seller Guild Master application input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE account_user.id = p_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
     AND seller.id = p_seller_profile_id
     AND seller."guildLevel" = 'GUILD_MEMBER'
   FOR UPDATE OF seller, seller_private;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SellerProfilePrivate"
     SET "guildMasterAppliedAt" = p_applied_at,
         "guildMasterReviewNotes" = NULL,
         "updatedAt" = changed_at
   WHERE "sellerProfileId" = p_seller_profile_id;
  UPDATE public."SellerProfile"
     SET "guildMasterAppliedAt" = p_applied_at,
         "guildMasterReviewNotes" = NULL,
         "updatedAt" = changed_at
   WHERE id = p_seller_profile_id
     AND "userId" = p_user_id;

  RETURN true;
END
$grainline_seller_owner_guild_master_application_record$;

CREATE OR REPLACE FUNCTION public.grainline_seller_staff_orderability_state(
  p_actor_id text,
  p_target_user_id text
)
RETURNS TABLE (
  id text,
  "chargesEnabled" boolean,
  "vacationMode" boolean,
  "stripeAccountId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_staff_orderability_state$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller orderability state requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_user_id IS NULL
       OR p_target_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller orderability-state input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = p_actor_id
       AND actor.role::text IN ('ADMIN', 'EMPLOYEE')
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Seller orderability-state actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."chargesEnabled",
         seller."vacationMode",
         seller_private."stripeAccountId"
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller."userId" = p_target_user_id;
END
$grainline_seller_staff_orderability_state$;

REVOKE ALL ON FUNCTION public.grainline_seller_profile_view_record(text, date)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_account_deletion_reconciliation_clear(
  text, text, text, bigint, uuid
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_owner_guild_master_application_record(
  text, text, timestamp without time zone
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_staff_orderability_state(text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_seller_profile_view_record(text, date)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_account_deletion_reconciliation_clear(
  text, text, text, bigint, uuid
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_guild_master_application_record(
  text, text, timestamp without time zone
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_staff_orderability_state(text, text)
  TO grainline_staff_read_runtime;

COMMIT;
