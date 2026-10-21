-- Move the admin listing approve/reject transition behind one atomic,
-- isolated-staff authority. The function locks the listing and seller,
-- preserves the seller-availability gate for approval, and commits the
-- matching AdminAuditLog row with the state transition.

BEGIN;

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

COMMIT;
