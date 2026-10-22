-- Resolve one exact Guild verification target through the isolated staff
-- session without granting SellerProfile table access to either runtime role.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_staff_verification_target(
  p_actor_id text,
  p_verification_id text
)
RETURNS TABLE (
  "verificationId" text,
  "verificationStatus" text,
  "sellerProfileId" text,
  "sellerUserId" text,
  "sellerDisplayName" text,
  "ownerAccountActive" boolean,
  "metricsCalculatedAt" timestamp with time zone,
  "metricsPeriodMonths" integer,
  "metricsAverageRating" double precision,
  "metricsReviewCount" integer,
  "metricsOnTimeShippingRate" double precision,
  "metricsResponseRate" double precision,
  "metricsTotalSalesCents" bigint,
  "metricsCompletedOrderCount" integer,
  "metricsActiveCaseCount" integer,
  "metricsAccountAgeDays" integer
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_staff_verification_target$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller verification target requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_verification_id IS NULL
     OR p_verification_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller verification target input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = p_actor_id
       AND actor.role::text IN ('ADMIN', 'EMPLOYEE')
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Seller verification target actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT verification.id::text,
         verification.status::text,
         seller.id::text,
         seller."userId"::text,
         seller."displayName"::text,
         seller."ownerAccountActive",
         metrics."calculatedAt" AT TIME ZONE 'UTC',
         metrics."periodMonths",
         metrics."averageRating",
         metrics."reviewCount",
         metrics."onTimeShippingRate",
         metrics."responseRate",
         metrics."totalSalesCents",
         metrics."completedOrderCount",
         metrics."activeCaseCount",
         metrics."accountAgeDays"
    FROM public."MakerVerification" AS verification
    JOIN public."SellerProfile" AS seller
      ON seller.id = verification."sellerProfileId"
    LEFT JOIN public."SellerMetrics" AS metrics
      ON metrics."sellerProfileId" = seller.id
   WHERE verification.id = p_verification_id;
END
$grainline_seller_staff_verification_target$;

REVOKE ALL ON FUNCTION public.grainline_seller_staff_verification_target(text,text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_staff_verification_target(text,text)
  TO grainline_staff_read_runtime;

COMMIT;
