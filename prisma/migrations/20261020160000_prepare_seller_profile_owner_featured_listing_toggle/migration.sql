-- Make the owner featured-listing toggle one actor-bound, row-locked operation.
-- No RLS or direct table grant changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_featured_listing_toggle(
  p_seller_profile_id text,
  p_listing_id text
)
RETURNS TABLE (applied boolean, featured boolean)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_featured_listing_toggle$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  source_featured_ids text[];
  source_is_featured boolean;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner featured-listing context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner featured-listing input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(seller."featuredListingIds", ARRAY[]::text[])
    INTO source_featured_ids
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
   WHERE account_user.id = request_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
     AND seller.id = p_seller_profile_id
   FOR UPDATE OF seller;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  PERFORM 1
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
     AND listing."sellerId" = p_seller_profile_id
   FOR KEY SHARE OF listing;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  source_is_featured := pg_catalog.array_position(
    source_featured_ids,
    p_listing_id
  ) IS NOT NULL;

  IF source_is_featured THEN
    UPDATE public."SellerProfile"
       SET "featuredListingIds" = pg_catalog.array_remove(
             source_featured_ids,
             p_listing_id
           ),
           "updatedAt" = source_now
     WHERE id = p_seller_profile_id;
    RETURN QUERY SELECT true, false;
    RETURN;
  END IF;

  IF pg_catalog.cardinality(source_featured_ids) >= 6 THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  UPDATE public."SellerProfile"
     SET "featuredListingIds" = pg_catalog.array_append(
           source_featured_ids,
           p_listing_id
         ),
         "updatedAt" = source_now
   WHERE id = p_seller_profile_id;
  RETURN QUERY SELECT true, true;
END
$grainline_seller_owner_featured_listing_toggle$;

REVOKE ALL ON FUNCTION
  public.grainline_seller_owner_featured_listing_toggle(text,text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_seller_owner_featured_listing_toggle(text,text)
  TO grainline_app_runtime;

COMMIT;
