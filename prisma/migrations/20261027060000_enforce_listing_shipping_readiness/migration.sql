BEGIN;

-- C-264: publishing must not make a listing buyable when checkout cannot
-- produce either a configured rate, local pickup, or a calculated rate. The
-- latter needs both a complete origin and an effective package (listing value
-- first, seller default second), matching the checkout quote route.
DO $preflight$
DECLARE
  onboarding_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_seller_owner_onboarding_complete(text,text)'
  );
  staff_review_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_seller_staff_listing_review_transition(text,text,text,text)'
  );
BEGIN
  IF onboarding_oid IS NULL OR staff_review_oid IS NULL THEN
    RAISE EXCEPTION 'C-264 predecessor functions are missing';
  END IF;
  IF pg_catalog.to_regclass('public."SellerProfile"') IS NULL
     OR pg_catalog.to_regclass('public."SellerProfilePrivate"') IS NULL
     OR pg_catalog.to_regclass('public."Listing"') IS NULL THEN
    RAISE EXCEPTION 'C-264 predecessor tables are missing';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime', onboarding_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_app_runtime', staff_review_oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime', staff_review_oid, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'C-264 predecessor function privileges drifted';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = routine.proowner
     WHERE routine.oid IN (onboarding_oid, staff_review_oid)
       AND (
         NOT routine.prosecdef
         OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
         OR NOT (owner_role.rolsuper OR owner_role.rolbypassrls)
       )
  ) THEN
    RAISE EXCEPTION 'C-264 predecessor function safety properties drifted';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.grainline_listing_shipping_ready(
  p_shipping_flat_rate_cents integer,
  p_allow_local_pickup boolean,
  p_ship_from_line1 text,
  p_ship_from_city text,
  p_ship_from_state text,
  p_ship_from_postal text,
  p_ship_from_country text,
  p_listing_weight_grams integer,
  p_listing_length_cm double precision,
  p_listing_width_cm double precision,
  p_listing_height_cm double precision,
  p_default_weight_grams integer,
  p_default_length_cm double precision,
  p_default_width_cm double precision,
  p_default_height_cm double precision
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $grainline_listing_shipping_ready$
  SELECT COALESCE(p_shipping_flat_rate_cents >= 0, false)
      OR COALESCE(p_allow_local_pickup, false)
      OR (
        NULLIF(pg_catalog.btrim(p_ship_from_line1), '') IS NOT NULL
        AND NULLIF(pg_catalog.btrim(p_ship_from_city), '') IS NOT NULL
        AND NULLIF(pg_catalog.btrim(p_ship_from_state), '') IS NOT NULL
        AND NULLIF(pg_catalog.btrim(p_ship_from_postal), '') IS NOT NULL
        AND NULLIF(pg_catalog.btrim(p_ship_from_country), '') IS NOT NULL
        AND COALESCE(p_listing_weight_grams, p_default_weight_grams, 0) > 0
        AND COALESCE(p_listing_length_cm, p_default_length_cm, 0) > 0
        AND COALESCE(p_listing_width_cm, p_default_width_cm, 0) > 0
        AND COALESCE(p_listing_height_cm, p_default_height_cm, 0) > 0
      )
$grainline_listing_shipping_ready$;

REVOKE ALL ON FUNCTION public.grainline_listing_shipping_ready(
  integer, boolean, text, text, text, text, text,
  integer, double precision, double precision, double precision,
  integer, double precision, double precision, double precision
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_onboarding_complete(
  p_user_id text,
  p_seller_profile_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_onboarding_complete$
DECLARE
  private_step integer;
  changed_at timestamp(3);
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_seller_profile_id IS NULL OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner onboarding-complete input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller_private."onboardingStep"
    INTO private_step
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE account_user.id = p_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
     AND seller.id = p_seller_profile_id
     AND seller."chargesEnabled" = true
     AND EXISTS (
       SELECT 1
         FROM public."Listing" AS listing
        WHERE listing."sellerId" = seller.id
          AND listing."archivedAt" IS NULL
          AND public.grainline_listing_shipping_ready(
            seller."shippingFlatRateCents",
            seller."allowLocalPickup",
            seller_private."shipFromLine1",
            seller_private."shipFromCity",
            seller_private."shipFromState",
            seller_private."shipFromPostal",
            seller_private."shipFromCountry",
            listing."packagedWeightGrams",
            listing."packagedLengthCm",
            listing."packagedWidthCm",
            listing."packagedHeightCm",
            seller_private."defaultPkgWeightGrams",
            seller_private."defaultPkgLengthCm",
            seller_private."defaultPkgWidthCm",
            seller_private."defaultPkgHeightCm"
          )
     )
   FOR UPDATE OF seller, seller_private;

  IF NOT FOUND OR private_step < 5 THEN
    RETURN false;
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SellerProfilePrivate"
     SET "onboardingComplete" = true,
         "updatedAt" = changed_at
   WHERE "sellerProfileId" = p_seller_profile_id;
  UPDATE public."SellerProfile"
     SET "updatedAt" = changed_at
   WHERE id = p_seller_profile_id
     AND "userId" = p_user_id;
  RETURN true;
END
$grainline_seller_owner_onboarding_complete$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_onboarding_complete(text,text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_onboarding_complete(text,text)
  TO grainline_app_runtime;

CREATE OR REPLACE FUNCTION public.grainline_seller_staff_listing_review_transition(
  p_actor_id text,
  p_listing_id text,
  p_operation text,
  p_reason text
)
RETURNS TABLE (
  applied boolean,
  "auditId" text,
  "blockReason" text,
  "listingId" text,
  title text,
  "priceCents" integer,
  currency text,
  status text,
  "listingType" text,
  "stockQuantity" integer,
  "sellerProfileId" text,
  "customOrderConversationId" text,
  "reservedForUserId" text,
  "sellerUserId" text,
  "sellerDisplayName" text,
  "ownerAccountActive" boolean,
  "chargesEnabled" boolean,
  "vacationMode" boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_staff_listing_review_transition$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  source_listing public."Listing"%ROWTYPE;
  source_seller public."SellerProfile"%ROWTYPE;
  source_private public."SellerProfilePrivate"%ROWTYPE;
  final_status public."ListingStatus";
  audit_id text;
  block_reason text;
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller listing review transition requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_operation IS NULL
     OR p_operation NOT IN ('APPROVE', 'REJECT')
     OR p_reason IS NULL
     OR pg_catalog.length(p_reason) > 500 THEN
    RAISE EXCEPTION 'Seller listing review transition input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public."User" AS actor
   WHERE actor.id = p_actor_id
     AND actor.role::text IN ('ADMIN', 'EMPLOYEE')
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller listing review transition actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT listing.*
    INTO source_listing
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT seller.*
    INTO source_seller
    FROM public."SellerProfile" AS seller
   WHERE seller.id = source_listing."sellerId"
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller listing review transition seller is missing'
      USING ERRCODE = '23503';
  END IF;

  SELECT seller_private.*
    INTO source_private
    FROM public."SellerProfilePrivate" AS seller_private
   WHERE seller_private."sellerProfileId" = source_seller.id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller listing review transition private seller state is missing'
      USING ERRCODE = '23503';
  END IF;

  IF p_operation = 'REJECT' AND pg_catalog.btrim(p_reason) = '' THEN
    RETURN QUERY SELECT
      false, NULL::text, 'REASON_REQUIRED'::text,
      source_listing.id::text, source_listing.title::text,
      source_listing."priceCents", source_listing.currency::text,
      source_listing.status::text, source_listing."listingType"::text,
      source_listing."stockQuantity", source_seller.id::text,
      source_listing."customOrderConversationId"::text,
      source_listing."reservedForUserId"::text,
      source_seller."userId"::text, source_seller."displayName"::text,
      source_seller."ownerAccountActive", source_seller."chargesEnabled",
      source_seller."vacationMode";
    RETURN;
  END IF;

  IF p_operation = 'APPROVE' THEN
    block_reason := CASE
      WHEN NOT source_seller."ownerAccountActive" THEN 'SELLER_ACCOUNT_UNAVAILABLE'
      WHEN NOT source_seller."chargesEnabled" THEN 'SELLER_PAYOUTS_UNAVAILABLE'
      WHEN source_seller."vacationMode" THEN 'SELLER_VACATION'
      WHEN NOT public.grainline_listing_shipping_ready(
        source_seller."shippingFlatRateCents",
        source_seller."allowLocalPickup",
        source_private."shipFromLine1",
        source_private."shipFromCity",
        source_private."shipFromState",
        source_private."shipFromPostal",
        source_private."shipFromCountry",
        source_listing."packagedWeightGrams",
        source_listing."packagedLengthCm",
        source_listing."packagedWidthCm",
        source_listing."packagedHeightCm",
        source_private."defaultPkgWeightGrams",
        source_private."defaultPkgLengthCm",
        source_private."defaultPkgWidthCm",
        source_private."defaultPkgHeightCm"
      ) THEN 'SELLER_SHIPPING_UNAVAILABLE'
      ELSE NULL
    END;
    IF block_reason IS NOT NULL THEN
      RETURN QUERY SELECT
        false, NULL::text, block_reason,
        source_listing.id::text, source_listing.title::text,
        source_listing."priceCents", source_listing.currency::text,
        source_listing.status::text, source_listing."listingType"::text,
        source_listing."stockQuantity", source_seller.id::text,
        source_listing."customOrderConversationId"::text,
        source_listing."reservedForUserId"::text,
        source_seller."userId"::text, source_seller."displayName"::text,
        source_seller."ownerAccountActive", source_seller."chargesEnabled",
        source_seller."vacationMode";
      RETURN;
    END IF;
  END IF;

  IF source_listing.status <> 'PENDING_REVIEW'::public."ListingStatus" THEN
    RETURN QUERY SELECT
      false, NULL::text, NULL::text,
      source_listing.id::text, source_listing.title::text,
      source_listing."priceCents", source_listing.currency::text,
      source_listing.status::text, source_listing."listingType"::text,
      source_listing."stockQuantity", source_seller.id::text,
      source_listing."customOrderConversationId"::text,
      source_listing."reservedForUserId"::text,
      source_seller."userId"::text, source_seller."displayName"::text,
      source_seller."ownerAccountActive", source_seller."chargesEnabled",
      source_seller."vacationMode";
    RETURN;
  END IF;

  IF p_operation = 'APPROVE' THEN
    final_status := CASE
      WHEN source_listing."listingType" = 'IN_STOCK'::public."ListingType"
       AND COALESCE(source_listing."stockQuantity", 0) <= 0
        THEN 'SOLD_OUT'::public."ListingStatus"
      ELSE 'ACTIVE'::public."ListingStatus"
    END;
    UPDATE public."Listing"
       SET status = final_status,
           "reviewedByAdmin" = true,
           "reviewedAt" = source_now,
           "rejectionReason" = NULL,
           "updatedAt" = source_now
     WHERE id = source_listing.id;
  ELSE
    final_status := 'REJECTED'::public."ListingStatus";
    UPDATE public."Listing"
       SET status = final_status,
           "reviewedByAdmin" = true,
           "reviewedAt" = source_now,
           "rejectionReason" = p_reason,
           "updatedAt" = source_now
     WHERE id = source_listing.id;
  END IF;

  audit_id := pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", reason, metadata,
    undone, "createdAt"
  ) VALUES (
    audit_id,
    p_actor_id,
    CASE p_operation WHEN 'APPROVE' THEN 'APPROVE_LISTING' ELSE 'REJECT_LISTING' END,
    'LISTING',
    source_listing.id,
    CASE WHEN p_operation = 'APPROVE' THEN COALESCE(
      NULLIF(pg_catalog.btrim(p_reason), ''), 'Approved'
    ) ELSE p_reason END,
    CASE WHEN p_operation = 'APPROVE'
      THEN pg_catalog.jsonb_build_object('finalStatus', final_status::text)
      ELSE '{}'::jsonb
    END,
    false,
    source_now
  );

  source_listing.status := final_status;
  RETURN QUERY SELECT
    true, audit_id, NULL::text,
    source_listing.id::text, source_listing.title::text,
    source_listing."priceCents", source_listing.currency::text,
    source_listing.status::text, source_listing."listingType"::text,
    source_listing."stockQuantity", source_seller.id::text,
    source_listing."customOrderConversationId"::text,
    source_listing."reservedForUserId"::text,
    source_seller."userId"::text, source_seller."displayName"::text,
    source_seller."ownerAccountActive", source_seller."chargesEnabled",
    source_seller."vacationMode";
END
$grainline_seller_staff_listing_review_transition$;

REVOKE ALL ON FUNCTION public.grainline_seller_staff_listing_review_transition(text,text,text,text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_staff_listing_review_transition(text,text,text,text)
  TO grainline_staff_read_runtime;

DO $postflight$
DECLARE
  helper_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_listing_shipping_ready(integer,boolean,text,text,text,text,text,integer,double precision,double precision,double precision,integer,double precision,double precision,double precision)'
  );
  onboarding_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_seller_owner_onboarding_complete(text,text)'
  );
  staff_review_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_seller_staff_listing_review_transition(text,text,text,text)'
  );
BEGIN
  IF helper_oid IS NULL OR onboarding_oid IS NULL OR staff_review_oid IS NULL THEN
    RAISE EXCEPTION 'C-264 postflight functions are missing';
  END IF;
  IF EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS routine
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
         ) AS acl
        WHERE routine.oid IN (helper_oid, onboarding_oid, staff_review_oid)
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('grainline_app_runtime', helper_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('grainline_staff_read_runtime', helper_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('grainline_app_runtime', onboarding_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('grainline_staff_read_runtime', onboarding_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('grainline_app_runtime', staff_review_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('grainline_staff_read_runtime', staff_review_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'C-264 postflight function privileges are unsafe';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = routine.proowner
     WHERE routine.oid IN (helper_oid, onboarding_oid, staff_review_oid)
       AND (
         routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
         OR NOT (owner_role.rolsuper OR owner_role.rolbypassrls)
         OR (
           routine.oid IN (onboarding_oid, staff_review_oid)
           AND NOT routine.prosecdef
         )
         OR (routine.oid = helper_oid AND routine.prosecdef)
       )
  ) THEN
    RAISE EXCEPTION 'C-264 postflight function safety properties are unsafe';
  END IF;
END
$postflight$;

COMMIT;
