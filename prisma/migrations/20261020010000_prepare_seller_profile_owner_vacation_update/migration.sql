BEGIN;

-- Mutate only the active actor's exact SellerProfile vacation fields. Checkout
-- expiry and cache revalidation remain post-commit application side effects.
CREATE OR REPLACE FUNCTION public.grainline_seller_owner_vacation_update(
  p_seller_profile_id text,
  p_vacation_mode boolean,
  p_vacation_return_epoch_millis bigint,
  p_vacation_message text
)
RETURNS TABLE (
  "sellerProfileId" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_vacation_update$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner vacation context is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_vacation_mode IS NULL
     OR (
       p_vacation_return_epoch_millis IS NOT NULL
       AND (
         p_vacation_return_epoch_millis < 0
         OR p_vacation_return_epoch_millis > 253402300799999
       )
     )
     OR (
       p_vacation_message IS NOT NULL
       AND pg_catalog.char_length(p_vacation_message) > 200
     ) THEN
    RAISE EXCEPTION 'Seller owner vacation input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public."SellerProfile" AS seller
     SET "vacationMode" = p_vacation_mode,
         "vacationReturnDate" = CASE
           WHEN p_vacation_return_epoch_millis IS NULL THEN NULL
           ELSE pg_catalog.to_timestamp(
             p_vacation_return_epoch_millis::double precision / 1000
           ) AT TIME ZONE 'UTC'
         END,
         "vacationMessage" = p_vacation_message
    FROM public."User" AS actor
   WHERE seller.id = p_seller_profile_id
     AND seller."userId" = request_user_id
     AND actor.id = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
  RETURNING seller.id;
END
$grainline_seller_owner_vacation_update$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_vacation_update(
  text, boolean, bigint, text
) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_vacation_update(
  text, boolean, bigint, text
) TO grainline_app_runtime;

COMMIT;
