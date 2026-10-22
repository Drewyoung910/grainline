-- Move the daily quality-score cron's remaining SellerProfile reads behind
-- bounded service operations. No RLS or table grants change in this preparation.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_service_quality_score_batch(
  p_after_listing_id text,
  p_limit integer
)
RETURNS TABLE (
  id text,
  "sellerId" text,
  "viewCount" integer,
  "clickCount" integer,
  "photoCount" bigint,
  "hasAltText" boolean,
  "descLength" integer,
  "aiReviewFlags" text[],
  "createdAt" timestamp without time zone,
  "sellerCreatedAt" timestamp without time zone,
  "guildLevel" text,
  "sellerAvgRating" double precision,
  "sellerReviewCount" bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_service_quality_score_batch$
BEGIN
  IF (p_after_listing_id IS NOT NULL
      AND p_after_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$')
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 200 THEN
    RAISE EXCEPTION 'Seller quality-score batch input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT listing.id::text,
         listing."sellerId"::text,
         listing."viewCount",
         listing."clickCount",
         COALESCE(photo_state.count, 0)::bigint,
         COALESCE(photo_state."hasAltText", false),
         COALESCE(pg_catalog.length(listing.description), 0)::integer,
         listing."aiReviewFlags",
         listing."createdAt",
         seller."createdAt",
         seller."guildLevel"::text,
         rating."averageRating",
         COALESCE(rating."reviewCount", 0)::bigint
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
    LEFT JOIN LATERAL (
      SELECT pg_catalog.count(*) AS count,
             pg_catalog.bool_or(
               photo."altText" IS NOT NULL AND photo."altText" <> ''
             ) AS "hasAltText"
        FROM public."Photo" AS photo
       WHERE photo."listingId" = listing.id
    ) AS photo_state ON true
    LEFT JOIN public."SellerRatingSummary" AS rating
      ON rating."sellerProfileId" = listing."sellerId"
   WHERE (p_after_listing_id IS NULL OR listing.id > p_after_listing_id)
     AND listing.status::text = 'ACTIVE'
     AND listing."isPrivate" = false
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND seller."ownerAccountActive" = true
   ORDER BY listing.id ASC
   LIMIT p_limit;
END
$grainline_seller_service_quality_score_batch$;

CREATE OR REPLACE FUNCTION public.grainline_seller_service_quality_score_zero_ineligible()
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_service_quality_score_zero_ineligible$
DECLARE
  zeroed_count bigint;
BEGIN
  UPDATE public."Listing" AS listing
     SET "qualityScore" = 0
   WHERE listing."qualityScore" > 0
     AND (
       listing.status::text <> 'ACTIVE'
       OR listing."isPrivate" = true
       OR EXISTS (
         SELECT 1
           FROM public."SellerProfile" AS seller
          WHERE seller.id = listing."sellerId"
            AND (
              seller."chargesEnabled" = false
              OR seller."vacationMode" = true
              OR seller."ownerAccountActive" = false
            )
       )
     );

  GET DIAGNOSTICS zeroed_count = ROW_COUNT;
  RETURN zeroed_count;
END
$grainline_seller_service_quality_score_zero_ineligible$;

REVOKE ALL ON FUNCTION public.grainline_seller_service_quality_score_batch(text, integer)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_service_quality_score_batch(text, integer)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_seller_service_quality_score_zero_ineligible()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_service_quality_score_zero_ineligible()
  TO grainline_app_runtime;

COMMIT;
