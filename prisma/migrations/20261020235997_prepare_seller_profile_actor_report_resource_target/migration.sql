-- Validate listing and review report targets through the authenticated actor
-- context. This removes the report route's nested Listing -> SellerProfile
-- reads while retaining participant access to historical reviews.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_actor_report_resource_target(
  p_target_type text,
  p_target_id text,
  p_reported_user_id text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_actor_report_resource_target$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_type IS NULL
     OR p_target_type NOT IN ('LISTING', 'REVIEW')
     OR p_target_id IS NULL
     OR p_target_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_reported_user_id IS NULL
     OR p_reported_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller report-resource target input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = actor_id
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Seller report-resource actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_target_type = 'LISTING' THEN
    RETURN EXISTS (
      SELECT 1
        FROM public."Listing" AS listing
        JOIN public."SellerProfile" AS seller
          ON seller.id = listing."sellerId"
       WHERE listing.id = p_target_id
         AND seller."userId" = p_reported_user_id
         AND listing."archivedAt" IS NULL
         AND (
           seller."userId" = actor_id
           OR (
             listing."isPrivate" = true
             AND listing.status::text IN ('ACTIVE', 'SOLD')
             AND listing."reservedForUserId" = actor_id
             AND seller."ownerAccountActive" = true
             AND seller."chargesEnabled" = true
             AND seller."stripeAccountSupported" = true
             AND seller."vacationMode" = false
           )
           OR (
             listing."isPrivate" = false
             AND listing.status::text IN ('ACTIVE', 'SOLD_OUT')
             AND seller."ownerAccountActive" = true
             AND seller."chargesEnabled" = true
             AND seller."stripeAccountSupported" = true
             AND seller."vacationMode" = false
           )
         )
    );
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public."Review" AS review
      JOIN public."Listing" AS listing
        ON listing.id = review."listingId"
      JOIN public."SellerProfile" AS seller
        ON seller.id = listing."sellerId"
     WHERE review.id = p_target_id
       AND (
         review."reviewerId" = p_reported_user_id
         OR seller."userId" = p_reported_user_id
       )
       AND (
         review."reviewerId" = actor_id
         OR seller."userId" = actor_id
         OR (
           listing."archivedAt" IS NULL
           AND (
             (
               listing."isPrivate" = true
               AND listing.status::text IN ('ACTIVE', 'SOLD')
               AND listing."reservedForUserId" = actor_id
               AND seller."ownerAccountActive" = true
               AND seller."chargesEnabled" = true
               AND seller."stripeAccountSupported" = true
               AND seller."vacationMode" = false
             )
             OR (
               listing."isPrivate" = false
               AND listing.status::text IN ('ACTIVE', 'SOLD_OUT')
               AND seller."ownerAccountActive" = true
               AND seller."chargesEnabled" = true
               AND seller."stripeAccountSupported" = true
               AND seller."vacationMode" = false
             )
           )
         )
       )
  );
END
$grainline_seller_actor_report_resource_target$;

REVOKE ALL ON FUNCTION public.grainline_seller_actor_report_resource_target(text,text,text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_actor_report_resource_target(text,text,text)
  TO grainline_app_runtime;

COMMIT;
