-- Replace the remaining owner and service SellerProfile relation reads in the
-- commission-interest domain. No RLS or table grants change.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_commission_interest_summaries(
  p_commission_request_ids text[],
  p_limit integer
)
RETURNS TABLE (
  "commissionRequestId" text,
  "interestedCount" bigint,
  "interestId" text,
  "sellerProfileId" text,
  "displayName" text,
  "avatarImageUrl" text,
  "ownerImageUrl" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_commission_interest_summaries$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_commission_request_ids IS NULL
     OR pg_catalog.cardinality(p_commission_request_ids) < 1
     OR pg_catalog.cardinality(p_commission_request_ids) > 30
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 10
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_commission_request_ids) AS requested(id)
        WHERE requested.id IS NULL
           OR requested.id !~ '^[A-Za-z0-9._:-]{1,191}$'
     )
     OR (
       SELECT pg_catalog.count(DISTINCT requested.id)
         FROM pg_catalog.unnest(p_commission_request_ids) AS requested(id)
     ) <> pg_catalog.cardinality(p_commission_request_ids) THEN
    RAISE EXCEPTION 'Seller owner commission-interest input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = request_user_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Seller owner commission-interest context is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM public."CommissionRequest" AS commission
     WHERE commission.id = ANY(p_commission_request_ids)
       AND commission."buyerId" = request_user_id
  ) <> pg_catalog.cardinality(p_commission_request_ids) THEN
    RAISE EXCEPTION 'Seller owner commission-interest actor does not own every request'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH requested AS (
    SELECT input.id,
           input.position
      FROM pg_catalog.unnest(p_commission_request_ids)
           WITH ORDINALITY AS input(id, position)
  )
  SELECT requested.id::text,
         counts.value,
         card."interestId",
         card."sellerProfileId",
         card."displayName",
         card."avatarImageUrl",
         card."ownerImageUrl"
    FROM requested
    JOIN public."CommissionRequest" AS commission
      ON commission.id = requested.id
     AND commission."buyerId" = request_user_id
    CROSS JOIN LATERAL (
      SELECT pg_catalog.count(*)::bigint AS value
        FROM public."CommissionInterest" AS interest
       WHERE interest."commissionRequestId" = commission.id
    ) AS counts
    LEFT JOIN LATERAL (
      SELECT interest.id::text AS "interestId",
             seller.id::text AS "sellerProfileId",
             seller."displayName"::text AS "displayName",
             seller."avatarImageUrl"::text AS "avatarImageUrl",
             seller."ownerImageUrl"::text AS "ownerImageUrl",
             interest."createdAt" AS sort_created_at
        FROM public."CommissionInterest" AS interest
        JOIN public."SellerProfile" AS seller
          ON seller.id = interest."sellerProfileId"
       WHERE interest."commissionRequestId" = commission.id
       ORDER BY interest."createdAt" ASC, interest.id ASC
       LIMIT p_limit
    ) AS card ON true
   ORDER BY requested.position, card.sort_created_at ASC, card."interestId" ASC;
END
$grainline_seller_owner_commission_interest_summaries$;

CREATE OR REPLACE FUNCTION public.grainline_seller_service_commission_interest_targets(
  p_commission_request_id text,
  p_limit integer
)
RETURNS TABLE ("userId" text)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_service_commission_interest_targets$
BEGIN
  IF p_commission_request_id IS NULL
     OR p_commission_request_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 10000 THEN
    RAISE EXCEPTION 'Seller service commission-interest target input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller."userId"::text
    FROM public."CommissionRequest" AS commission
    JOIN public."CommissionInterest" AS interest
      ON interest."commissionRequestId" = commission.id
    JOIN public."SellerProfile" AS seller
      ON seller.id = interest."sellerProfileId"
   WHERE commission.id = p_commission_request_id
     AND commission.status::text = 'OPEN'
     AND seller."ownerAccountActive" = true
   GROUP BY seller."userId"
   ORDER BY pg_catalog.min(interest."createdAt") ASC, seller."userId" ASC
   LIMIT p_limit;
END
$grainline_seller_service_commission_interest_targets$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_commission_interest_summaries(text[], integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_commission_interest_summaries(text[], integer)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_seller_service_commission_interest_targets(text, integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_service_commission_interest_targets(text, integer)
  TO grainline_app_runtime;

COMMIT;
