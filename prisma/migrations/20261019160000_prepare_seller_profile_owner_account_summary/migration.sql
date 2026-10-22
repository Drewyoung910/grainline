BEGIN;

-- Serve the small SellerProfile subset shared by authenticated account chrome.
-- The owner identity comes only from transaction-local server context.
CREATE OR REPLACE FUNCTION public.grainline_seller_owner_account_summary()
RETURNS TABLE (
  "sellerProfileId" text,
  "avatarImageUrl" text,
  "activeListingCount" bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_account_summary$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner account-summary context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."avatarImageUrl"::text,
         pg_catalog.count(listing.id)::bigint
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    LEFT JOIN public."Listing" AS listing
      ON listing."sellerId" = seller.id
     AND listing.status = 'ACTIVE'
   WHERE account_user.id = request_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
   GROUP BY seller.id, seller."avatarImageUrl";
END
$grainline_seller_owner_account_summary$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_account_summary()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_account_summary()
  TO grainline_app_runtime;

COMMIT;
