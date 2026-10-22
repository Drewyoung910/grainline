-- Replace the final staff-side direct SellerProfile reads and writes with one
-- actor-bound, compare-and-set transition. No RLS or table grants change.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_staff_orderability_transition(
  p_target_user_id text,
  p_expected_seller_profile_id text,
  p_expected_charges_enabled boolean,
  p_expected_vacation_mode boolean,
  p_next_charges_enabled boolean,
  p_next_vacation_mode boolean
)
RETURNS TABLE (
  "sellerProfileId" text,
  "previousChargesEnabled" boolean,
  "previousVacationMode" boolean,
  changed boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_staff_orderability_transition$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  current_seller_profile_id text;
  current_charges_enabled boolean;
  current_vacation_mode boolean;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller staff orderability context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_target_user_id IS NULL
     OR p_target_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (
       p_expected_seller_profile_id IS NOT NULL
       AND p_expected_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     )
     OR (
       p_expected_seller_profile_id IS NULL
       AND (
         p_expected_charges_enabled IS NOT NULL
         OR p_expected_vacation_mode IS NOT NULL
         OR p_next_charges_enabled IS NOT NULL
         OR p_next_vacation_mode IS NOT NULL
       )
     )
     OR (
       p_expected_seller_profile_id IS NOT NULL
       AND (
         p_expected_charges_enabled IS NULL
         OR p_expected_vacation_mode IS NULL
       )
     )
     OR ((p_next_charges_enabled IS NULL) <> (p_next_vacation_mode IS NULL)) THEN
    RAISE EXCEPTION 'Seller staff orderability input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = request_user_id
       AND actor.role::text IN ('ADMIN', 'EMPLOYEE')
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Seller staff orderability actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller.id,
         seller."chargesEnabled",
         seller."vacationMode"
    INTO current_seller_profile_id,
         current_charges_enabled,
         current_vacation_mode
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = p_target_user_id
   FOR UPDATE;

  IF p_expected_seller_profile_id IS NULL THEN
    IF current_seller_profile_id IS NOT NULL THEN
      RAISE EXCEPTION 'Seller staff orderability target changed'
        USING ERRCODE = '40001';
    END IF;
    RETURN;
  END IF;

  IF current_seller_profile_id IS NULL
     OR current_seller_profile_id <> p_expected_seller_profile_id
     OR current_charges_enabled IS DISTINCT FROM p_expected_charges_enabled
     OR current_vacation_mode IS DISTINCT FROM p_expected_vacation_mode THEN
    RAISE EXCEPTION 'Seller staff orderability state changed'
      USING ERRCODE = '40001';
  END IF;

  IF p_next_charges_enabled IS NOT NULL THEN
    UPDATE public."SellerProfile"
       SET "chargesEnabled" = p_next_charges_enabled,
           "vacationMode" = p_next_vacation_mode,
           "updatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
     WHERE id = current_seller_profile_id;
  END IF;

  RETURN QUERY
  SELECT current_seller_profile_id,
         current_charges_enabled,
         current_vacation_mode,
         p_next_charges_enabled IS NOT NULL;
END
$grainline_seller_staff_orderability_transition$;

REVOKE ALL ON FUNCTION public.grainline_seller_staff_orderability_transition(
  text, text, boolean, boolean, boolean, boolean
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_seller_staff_orderability_transition(
  text, text, boolean, boolean, boolean, boolean
) TO grainline_app_runtime;

COMMIT;
