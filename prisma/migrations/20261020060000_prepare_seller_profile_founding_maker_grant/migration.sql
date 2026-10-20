-- Replace the multi-statement application allocator with one bounded database
-- authority. The durable FoundingMakerGrant ledger remains the source of
-- issued numbers; SellerProfile keeps only the public badge mirror.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_service_founding_maker_grant(
  p_seller_profile_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_service_founding_maker_grant$
DECLARE
  seller_badged boolean;
  existing_number integer;
  existing_granted_at timestamp without time zone;
  next_number integer;
  granted_at timestamp without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Founding Maker seller target is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller."isFoundingMaker"
    INTO seller_badged
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF seller_badged THEN
    RETURN true;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."Listing" AS listing
      JOIN public."SellerProfile" AS seller
        ON seller.id = listing."sellerId"
     WHERE listing."sellerId" = p_seller_profile_id
       AND listing.status = 'ACTIVE'::public."ListingStatus"
       AND listing."isPrivate" = false
       AND listing."archivedAt" IS NULL
       AND seller."chargesEnabled" = true
       AND seller."stripeAccountSupported" = true
       AND seller."vacationMode" = false
       AND seller."ownerAccountActive" = true
  ) THEN
    RETURN false;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(913337, 250);

  SELECT seller."isFoundingMaker"
    INTO seller_badged
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF seller_badged THEN
    RETURN true;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."Listing" AS listing
      JOIN public."SellerProfile" AS seller
        ON seller.id = listing."sellerId"
     WHERE listing."sellerId" = p_seller_profile_id
       AND listing.status = 'ACTIVE'::public."ListingStatus"
       AND listing."isPrivate" = false
       AND listing."archivedAt" IS NULL
       AND seller."chargesEnabled" = true
       AND seller."stripeAccountSupported" = true
       AND seller."vacationMode" = false
       AND seller."ownerAccountActive" = true
  ) THEN
    RETURN false;
  END IF;

  SELECT grant_row."foundingMakerNumber", grant_row."grantedAt"
    INTO existing_number, existing_granted_at
    FROM public."FoundingMakerGrant" AS grant_row
   WHERE grant_row."sellerProfileId" = p_seller_profile_id;

  IF FOUND THEN
    UPDATE public."SellerProfile"
       SET "isFoundingMaker" = true,
           "foundingMakerNumber" = existing_number,
           "foundingMakerAt" = existing_granted_at,
           "updatedAt" = granted_at
     WHERE id = p_seller_profile_id
       AND "isFoundingMaker" = false;
    RETURN true;
  END IF;

  SELECT COALESCE(MAX(grant_row."foundingMakerNumber"), 0) + 1
    INTO next_number
    FROM public."FoundingMakerGrant" AS grant_row;

  IF next_number > 250 THEN
    RETURN false;
  END IF;

  INSERT INTO public."FoundingMakerGrant" (
    id,
    "sellerProfileId",
    "foundingMakerNumber",
    "grantedAt",
    "createdAt",
    "updatedAt"
  ) VALUES (
    'fmg_' || p_seller_profile_id,
    p_seller_profile_id,
    next_number,
    granted_at,
    granted_at,
    granted_at
  );

  UPDATE public."SellerProfile"
     SET "isFoundingMaker" = true,
         "foundingMakerNumber" = next_number,
         "foundingMakerAt" = granted_at,
         "updatedAt" = granted_at
   WHERE id = p_seller_profile_id
     AND "isFoundingMaker" = false;

  RETURN true;
END
$grainline_seller_service_founding_maker_grant$;

REVOKE ALL ON FUNCTION public.grainline_seller_service_founding_maker_grant(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_service_founding_maker_grant(text)
  TO grainline_app_runtime;

COMMIT;
