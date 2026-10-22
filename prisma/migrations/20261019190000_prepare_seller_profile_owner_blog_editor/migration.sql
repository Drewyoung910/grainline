BEGIN;

-- Serve the seller identity and active listing choices used by the owner's
-- blog editor. The owner identity comes only from transaction-local server
-- context; a LEFT JOIN preserves the distinction between no seller profile
-- and a seller with no active listings.
CREATE OR REPLACE FUNCTION public.grainline_seller_owner_blog_editor()
RETURNS TABLE (
  "sellerProfileId" text,
  "listingId" text,
  "listingTitle" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_blog_editor$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner blog-editor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         listing.id,
         listing.title::text
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    LEFT JOIN public."Listing" AS listing
      ON listing."sellerId" = seller.id
     AND listing.status = 'ACTIVE'::public."ListingStatus"
   WHERE account_user.id = request_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
   ORDER BY listing."updatedAt" DESC NULLS LAST,
            listing.id ASC NULLS LAST;
END
$grainline_seller_owner_blog_editor$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_blog_editor()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_blog_editor()
  TO grainline_app_runtime;

COMMIT;
