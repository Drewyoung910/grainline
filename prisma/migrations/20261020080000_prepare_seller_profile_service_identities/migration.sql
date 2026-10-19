BEGIN;

-- A signed Clerk user lifecycle event needs only the existing seller display
-- name to render the optional seller welcome email. Preserve hidden/inactive
-- sellers because the predecessor lookup applied no public-visibility rule.
CREATE OR REPLACE FUNCTION public.grainline_seller_service_welcome_name(
  target_user_id text
)
RETURNS TABLE ("displayName" text)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_service_welcome_name$
BEGIN
  IF target_user_id IS NULL
     OR target_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller welcome target is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller."displayName"::text
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = target_user_id;
END
$grainline_seller_service_welcome_name$;

-- Block cleanup needs only the two possible buyer-to-seller targets. Returning
-- the seller user id lets the application validate the exact reversed pair
-- without exposing any additional SellerProfile state.
CREATE OR REPLACE FUNCTION public.grainline_seller_transaction_blocked_pair_targets(
  first_user_id text,
  second_user_id text
)
RETURNS TABLE (
  "buyerUserId" text,
  "sellerUserId" text,
  "sellerProfileId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_transaction_blocked_pair_targets$
BEGIN
  IF first_user_id IS NULL
     OR first_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR second_user_id IS NULL
     OR second_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller blocked-pair target is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT candidate.buyer_user_id::text,
         candidate.seller_user_id::text,
         seller.id::text
    FROM (VALUES
      (1, first_user_id, second_user_id),
      (2, second_user_id, first_user_id)
    ) AS candidate(sort_order, buyer_user_id, seller_user_id)
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = candidate.seller_user_id
   ORDER BY candidate.sort_order;
END
$grainline_seller_transaction_blocked_pair_targets$;

REVOKE ALL ON FUNCTION public.grainline_seller_service_welcome_name(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_transaction_blocked_pair_targets(text,text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_service_welcome_name(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_transaction_blocked_pair_targets(text,text)
  TO grainline_app_runtime;

COMMIT;
