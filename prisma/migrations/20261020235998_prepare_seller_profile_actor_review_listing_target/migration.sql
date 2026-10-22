-- Resolve one exact review-creation listing through the authenticated actor
-- context. The authority returns only the listing and seller fields already
-- consumed by the review route and keeps historical/private purchases
-- reviewable without retaining direct SellerProfile table access.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_actor_review_listing_target(
  p_listing_id text
)
RETURNS TABLE (
  "listingId" text,
  title text,
  "sellerProfileId" text,
  "sellerUserId" text,
  "sellerDisplayName" text,
  "ownerAccountActive" boolean
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_actor_review_listing_target$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller review-listing target input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = actor_id
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Seller review-listing actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT listing.id::text,
         listing.title::text,
         seller.id::text,
         seller."userId"::text,
         seller."displayName"::text,
         seller."ownerAccountActive"
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE listing.id = p_listing_id
   LIMIT 1;
END
$grainline_seller_actor_review_listing_target$;

REVOKE ALL ON FUNCTION public.grainline_seller_actor_review_listing_target(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_actor_review_listing_target(text)
  TO grainline_app_runtime;

COMMIT;
