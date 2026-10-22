-- Replace both owner onboarding SellerProfile reads with one actor-bound
-- projection. No RLS or direct table grant changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_onboarding_state(
  p_expected_seller_profile_id text
)
RETURNS TABLE (
  "sellerProfileId" text,
  "userId" text,
  "displayName" text,
  bio text,
  tagline text,
  "avatarImageUrl" text,
  "yearsInBusiness" integer,
  city text,
  state text,
  "returnPolicy" text,
  "shippingPolicy" text,
  "acceptsCustomOrders" boolean,
  "chargesEnabled" boolean,
  "totalListingCount" bigint,
  "latestListingId" text,
  "latestListingTitle" text,
  "latestListingStatus" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_onboarding_state$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner onboarding context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_expected_seller_profile_id IS NOT NULL
     AND p_expected_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner onboarding input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."userId",
         seller."displayName"::text,
         seller.bio::text,
         seller.tagline::text,
         seller."avatarImageUrl"::text,
         seller."yearsInBusiness",
         seller.city::text,
         seller.state::text,
         seller."returnPolicy"::text,
         seller."shippingPolicy"::text,
         seller."acceptsCustomOrders",
         seller."chargesEnabled",
         (
           SELECT pg_catalog.count(*)
             FROM public."Listing" AS counted_listing
            WHERE counted_listing."sellerId" = seller.id
         ),
         latest_listing.id,
         latest_listing.title::text,
         latest_listing.status::text
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
    LEFT JOIN LATERAL (
      SELECT listing.id, listing.title, listing.status
        FROM public."Listing" AS listing
       WHERE listing."sellerId" = seller.id
       ORDER BY listing."createdAt" DESC, listing.id DESC
       LIMIT 1
    ) AS latest_listing ON true
   WHERE actor.id = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND (
       p_expected_seller_profile_id IS NULL
       OR seller.id = p_expected_seller_profile_id
     );
END
$grainline_seller_owner_onboarding_state$;

REVOKE ALL ON FUNCTION
  public.grainline_seller_owner_onboarding_state(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_seller_owner_onboarding_state(text)
  TO grainline_app_runtime;

COMMIT;
