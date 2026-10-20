-- Replace account deletion's broad SellerProfile/listing media read with one
-- claim-bound projection. No RLS or direct table grant changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_account_deletion_public_media_urls(
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS TABLE (url text)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_account_deletion_public_media_urls$
DECLARE
  claimed_user_id text;
BEGIN
  -- This helper validates the exact active LOCAL_ANONYMIZE claim and refreshes
  -- its lease. The caller cannot select a different user or seller.
  claimed_user_id := public.grainline_account_deletion_claim_user(
    p_side_effect_id,
    p_claim_generation,
    p_claim_token
  );

  RETURN QUERY
  SELECT media.url
    FROM (
      SELECT seller."avatarImageUrl"::text AS url
        FROM public."SellerProfile" AS seller
       WHERE seller."userId" = claimed_user_id
      UNION
      SELECT seller."bannerImageUrl"::text AS url
        FROM public."SellerProfile" AS seller
       WHERE seller."userId" = claimed_user_id
      UNION
      SELECT seller."workshopImageUrl"::text AS url
        FROM public."SellerProfile" AS seller
       WHERE seller."userId" = claimed_user_id
      UNION
      SELECT gallery.url::text
        FROM public."SellerProfile" AS seller
        CROSS JOIN LATERAL pg_catalog.unnest(seller."galleryImageUrls") AS gallery(url)
       WHERE seller."userId" = claimed_user_id
      UNION
      SELECT listing."videoUrl"::text
        FROM public."SellerProfile" AS seller
        JOIN public."Listing" AS listing
          ON listing."sellerId" = seller.id
       WHERE seller."userId" = claimed_user_id
      UNION
      SELECT photo.url::text
        FROM public."SellerProfile" AS seller
        JOIN public."Listing" AS listing
          ON listing."sellerId" = seller.id
        JOIN public."Photo" AS photo
          ON photo."listingId" = listing.id
       WHERE seller."userId" = claimed_user_id
      UNION
      SELECT photo."originalUrl"::text
        FROM public."SellerProfile" AS seller
        JOIN public."Listing" AS listing
          ON listing."sellerId" = seller.id
        JOIN public."Photo" AS photo
          ON photo."listingId" = listing.id
       WHERE seller."userId" = claimed_user_id
    ) AS media
   WHERE media.url IS NOT NULL
     AND pg_catalog.btrim(media.url) <> ''
   ORDER BY media.url;
END
$grainline_seller_account_deletion_public_media_urls$;

REVOKE ALL ON FUNCTION
  public.grainline_seller_account_deletion_public_media_urls(text,bigint,uuid)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_seller_account_deletion_public_media_urls(text,bigint,uuid)
  TO grainline_app_runtime;

COMMIT;
