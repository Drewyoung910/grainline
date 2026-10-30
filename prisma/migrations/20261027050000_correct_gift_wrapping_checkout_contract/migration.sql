BEGIN;

DO $preflight$
DECLARE
  update_routine regprocedure := pg_catalog.to_regprocedure(
    'public.grainline_seller_owner_profile_update(text,text,text,text,text,text,text,integer,text,text,text,text[],text[],boolean,text,text,text,text,text,text,text,text,boolean,boolean,integer,boolean,integer)'
  );
  routine_row record;
BEGIN
  IF pg_catalog.to_regclass('public."SellerProfile"') IS NULL
     OR update_routine IS NULL THEN
    RAISE EXCEPTION 'Gift-wrapping checkout predecessor is missing';
  END IF;

  SELECT * INTO STRICT routine_row
    FROM pg_catalog.pg_proc
   WHERE oid = update_routine;

  IF NOT routine_row.prosecdef
     OR routine_row.provolatile <> 'v'
     OR routine_row.proparallel <> 'u'
     OR routine_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_roles AS owner_role
        WHERE owner_role.oid = routine_row.proowner
          AND (owner_role.rolsuper OR owner_role.rolbypassrls)
     )
     OR pg_catalog.strpos(
          routine_row.prosrc,
          'WHEN p_offers_gift_wrapping THEN p_gift_wrapping_price_cents'
        ) = 0 THEN
    RAISE EXCEPTION 'Gift-wrapping profile-update predecessor drifted';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime', update_routine, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime', update_routine, 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             routine_row.proacl,
             pg_catalog.acldefault('f', routine_row.proowner)
           )
         ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Gift-wrapping profile-update ACL drifted';
  END IF;
END
$preflight$;

LOCK TABLE public."SellerProfile" IN SHARE ROW EXCLUSIVE MODE;

UPDATE public."SellerProfile"
   SET "giftWrappingPriceCents" = 0,
       "updatedAt" = pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC'
 WHERE "offersGiftWrapping" = true
   AND "giftWrappingPriceCents" IS NULL;

ALTER TABLE public."SellerProfile"
  ADD CONSTRAINT "SellerProfile_gift_wrapping_price_present_chk"
  CHECK (
    "offersGiftWrapping" = false
    OR "giftWrappingPriceCents" IS NOT NULL
  ) NOT VALID;

ALTER TABLE public."SellerProfile"
  VALIDATE CONSTRAINT "SellerProfile_gift_wrapping_price_present_chk";

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_profile_update(
  p_seller_profile_id text,
  p_display_name text,
  p_display_name_normalized text,
  p_tagline text,
  p_bio text,
  p_story_title text,
  p_story_body text,
  p_years_in_business integer,
  p_banner_image_url text,
  p_avatar_image_url text,
  p_workshop_image_url text,
  p_gallery_image_urls text[],
  p_gallery_alt_texts text[],
  p_gallery_images_touched boolean,
  p_instagram_url text,
  p_facebook_url text,
  p_pinterest_url text,
  p_tiktok_url text,
  p_website_url text,
  p_return_policy text,
  p_custom_order_policy text,
  p_shipping_policy text,
  p_accepts_custom_orders boolean,
  p_accepting_new_orders boolean,
  p_custom_order_turnaround_days integer,
  p_offers_gift_wrapping boolean,
  p_gift_wrapping_price_cents integer
)
RETURNS TABLE (
  "sellerProfileId" text,
  "duplicateDisplayName" boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_profile_update$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  target_seller_profile_id text;
  duplicate_display_name boolean;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner profile-update context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_display_name IS NULL
     OR pg_catalog.char_length(p_display_name) NOT BETWEEN 1 AND 100
     OR p_display_name_normalized IS NULL
     OR pg_catalog.char_length(p_display_name_normalized) NOT BETWEEN 1 AND 100
     OR p_accepts_custom_orders IS NULL
     OR p_accepting_new_orders IS NULL
     OR p_offers_gift_wrapping IS NULL
     OR p_gallery_images_touched IS NULL THEN
    RAISE EXCEPTION 'Seller owner profile-update input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.char_length(p_tagline) > 140
     OR pg_catalog.char_length(p_bio) > 500
     OR pg_catalog.char_length(p_story_title) > 200
     OR pg_catalog.char_length(p_story_body) > 2000
     OR pg_catalog.char_length(p_banner_image_url) > 2048
     OR pg_catalog.char_length(p_avatar_image_url) > 2048
     OR pg_catalog.char_length(p_workshop_image_url) > 2048
     OR pg_catalog.char_length(p_instagram_url) > 2048
     OR pg_catalog.char_length(p_facebook_url) > 2048
     OR pg_catalog.char_length(p_pinterest_url) > 2048
     OR pg_catalog.char_length(p_tiktok_url) > 2048
     OR pg_catalog.char_length(p_website_url) > 2048
     OR pg_catalog.char_length(p_return_policy) > 2000
     OR pg_catalog.char_length(p_custom_order_policy) > 2000
     OR pg_catalog.char_length(p_shipping_policy) > 2000
     OR (p_years_in_business IS NOT NULL
         AND p_years_in_business NOT BETWEEN 0 AND 200)
     OR (p_custom_order_turnaround_days IS NOT NULL
         AND p_custom_order_turnaround_days < 1)
     OR (p_gift_wrapping_price_cents IS NOT NULL
         AND p_gift_wrapping_price_cents NOT BETWEEN 0 AND 10000) THEN
    RAISE EXCEPTION 'Seller owner profile-update value is out of bounds'
      USING ERRCODE = '22023';
  END IF;
  IF p_gallery_images_touched AND (
       p_gallery_image_urls IS NULL
       OR p_gallery_alt_texts IS NULL
       OR pg_catalog.cardinality(p_gallery_image_urls) > 10
       OR pg_catalog.cardinality(p_gallery_image_urls)
          <> pg_catalog.cardinality(p_gallery_alt_texts)
       OR EXISTS (
            SELECT 1
              FROM pg_catalog.unnest(p_gallery_image_urls) AS image_url
             WHERE image_url IS NULL
                OR pg_catalog.char_length(image_url) > 2048
          )
       OR EXISTS (
            SELECT 1
              FROM pg_catalog.unnest(p_gallery_alt_texts) AS alt_text
             WHERE alt_text IS NULL
                OR pg_catalog.char_length(alt_text) > 240
          )
     ) THEN
    RAISE EXCEPTION 'Seller owner profile-update gallery is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id
    INTO target_seller_profile_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller.id = p_seller_profile_id
   FOR UPDATE OF seller;

  IF target_seller_profile_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
           SELECT 1
             FROM public."SellerProfile" AS candidate
            WHERE candidate.id <> target_seller_profile_id
              AND (
                pg_catalog.lower(candidate."displayName")
                  = pg_catalog.lower(p_display_name)
                OR pg_catalog.lower(candidate."displayNameNormalized")
                  = pg_catalog.lower(p_display_name_normalized)
              )
         )
    INTO duplicate_display_name;

  UPDATE public."SellerProfile" AS seller
     SET "displayName" = p_display_name,
         "displayNameNormalized" = p_display_name_normalized,
         tagline = p_tagline,
         bio = p_bio,
         "storyTitle" = p_story_title,
         "storyBody" = p_story_body,
         "yearsInBusiness" = p_years_in_business,
         "bannerImageUrl" = p_banner_image_url,
         "avatarImageUrl" = p_avatar_image_url,
         "workshopImageUrl" = p_workshop_image_url,
         "galleryImageUrls" = CASE
           WHEN p_gallery_images_touched THEN p_gallery_image_urls
           ELSE seller."galleryImageUrls"
         END,
         "galleryAltTexts" = CASE
           WHEN p_gallery_images_touched THEN p_gallery_alt_texts
           ELSE seller."galleryAltTexts"
         END,
         "instagramUrl" = p_instagram_url,
         "facebookUrl" = p_facebook_url,
         "pinterestUrl" = p_pinterest_url,
         "tiktokUrl" = p_tiktok_url,
         "websiteUrl" = p_website_url,
         "returnPolicy" = p_return_policy,
         "customOrderPolicy" = p_custom_order_policy,
         "shippingPolicy" = p_shipping_policy,
         "acceptsCustomOrders" = p_accepts_custom_orders,
         "acceptingNewOrders" = p_accepting_new_orders,
         "customOrderTurnaroundDays" = p_custom_order_turnaround_days,
         "offersGiftWrapping" = p_offers_gift_wrapping,
         "giftWrappingPriceCents" = CASE
           WHEN p_offers_gift_wrapping
             THEN COALESCE(p_gift_wrapping_price_cents, 0)
           ELSE NULL
         END,
         "updatedAt" = pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC'
   WHERE seller.id = target_seller_profile_id;

  RETURN QUERY SELECT target_seller_profile_id, duplicate_display_name;
END
$grainline_seller_owner_profile_update$;

DO $postflight$
DECLARE
  update_routine regprocedure := pg_catalog.to_regprocedure(
    'public.grainline_seller_owner_profile_update(text,text,text,text,text,text,text,integer,text,text,text,text[],text[],boolean,text,text,text,text,text,text,text,text,boolean,boolean,integer,boolean,integer)'
  );
  routine_row record;
BEGIN
  SELECT * INTO STRICT routine_row
    FROM pg_catalog.pg_proc
   WHERE oid = update_routine;

  IF pg_catalog.strpos(
       routine_row.prosrc,
       'THEN COALESCE(p_gift_wrapping_price_cents, 0)'
     ) = 0
     OR NOT routine_row.prosecdef
     OR routine_row.provolatile <> 'v'
     OR routine_row.proparallel <> 'u'
     OR routine_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_roles AS owner_role
        WHERE owner_role.oid = routine_row.proowner
          AND (owner_role.rolsuper OR owner_role.rolbypassrls)
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime', update_routine, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime', update_routine, 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             routine_row.proacl,
             pg_catalog.acldefault('f', routine_row.proowner)
           )
         ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Gift-wrapping profile-update postflight drifted';
  END IF;

  IF EXISTS (
       SELECT 1
         FROM public."SellerProfile"
        WHERE "offersGiftWrapping" = true
          AND "giftWrappingPriceCents" IS NULL
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public."SellerProfile"'::pg_catalog.regclass
          AND conname = 'SellerProfile_gift_wrapping_price_present_chk'
          AND convalidated
     ) THEN
    RAISE EXCEPTION 'Gift-wrapping profile state postflight failed';
  END IF;
END
$postflight$;

COMMIT;
