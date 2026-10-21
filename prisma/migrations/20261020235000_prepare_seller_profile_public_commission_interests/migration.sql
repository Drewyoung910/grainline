BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_commission_interest_counts(
  p_commission_request_ids text[]
)
RETURNS TABLE (
  "commissionRequestId" text,
  value bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_commission_interest_counts$
DECLARE
  viewer_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_commission_request_ids IS NULL
     OR pg_catalog.cardinality(p_commission_request_ids) < 1
     OR pg_catalog.cardinality(p_commission_request_ids) > 100
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
    RAISE EXCEPTION 'Seller public commission-interest input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF viewer_user_id IS NOT NULL
     AND (
       viewer_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
       OR NOT EXISTS (
         SELECT 1
           FROM public."User" AS viewer
          WHERE viewer.id = viewer_user_id
            AND viewer.banned = false
            AND viewer."deletedAt" IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'Seller public commission-interest viewer context is invalid'
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
         pg_catalog.count(seller.id)::bigint
    FROM requested
    JOIN public."CommissionRequest" AS commission
      ON commission.id = requested.id
     AND commission.status::text = 'OPEN'
     AND commission."buyerAccountActive" = true
     AND (
       commission."expiresAt" IS NULL
       OR commission."expiresAt" > CURRENT_TIMESTAMP
     )
    LEFT JOIN public."CommissionInterest" AS interest
      ON interest."commissionRequestId" = commission.id
    LEFT JOIN public."SellerProfile" AS seller
      ON seller.id = interest."sellerProfileId"
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND seller."ownerAccountActive" = true
     AND (
       viewer_user_id IS NULL
       OR NOT EXISTS (
         SELECT 1
           FROM public."Block" AS relationship
          WHERE (
            relationship."blockerId" = viewer_user_id
            AND relationship."blockedId" = seller."userId"
          ) OR (
            relationship."blockerId" = seller."userId"
            AND relationship."blockedId" = viewer_user_id
          )
       )
     )
   GROUP BY requested.id, requested.position
   ORDER BY requested.position;
END
$grainline_seller_public_commission_interest_counts$;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_commission_interest_cards(
  p_commission_request_id text,
  p_limit integer
)
RETURNS TABLE (
  "interestId" text,
  "createdAt" timestamp without time zone,
  "sellerProfileId" text,
  "displayName" text,
  "avatarImageUrl" text,
  "ownerImageUrl" text,
  "guildLevel" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_commission_interest_cards$
DECLARE
  viewer_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_commission_request_id IS NULL
     OR p_commission_request_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 100 THEN
    RAISE EXCEPTION 'Seller public commission-interest input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF viewer_user_id IS NOT NULL
     AND (
       viewer_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
       OR NOT EXISTS (
         SELECT 1
           FROM public."User" AS viewer
          WHERE viewer.id = viewer_user_id
            AND viewer.banned = false
            AND viewer."deletedAt" IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'Seller public commission-interest viewer context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT interest.id::text,
         interest."createdAt"::timestamp without time zone,
         seller.id::text,
         seller."displayName"::text,
         seller."avatarImageUrl"::text,
         seller."ownerImageUrl"::text,
         seller."guildLevel"::text
    FROM public."CommissionRequest" AS commission
    JOIN public."CommissionInterest" AS interest
      ON interest."commissionRequestId" = commission.id
    JOIN public."SellerProfile" AS seller
      ON seller.id = interest."sellerProfileId"
   WHERE commission.id = p_commission_request_id
     AND commission.status::text = 'OPEN'
     AND commission."buyerAccountActive" = true
     AND (
       commission."expiresAt" IS NULL
       OR commission."expiresAt" > CURRENT_TIMESTAMP
     )
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND seller."ownerAccountActive" = true
     AND (
       viewer_user_id IS NULL
       OR NOT EXISTS (
         SELECT 1
           FROM public."Block" AS relationship
          WHERE (
            relationship."blockerId" = viewer_user_id
            AND relationship."blockedId" = seller."userId"
          ) OR (
            relationship."blockerId" = seller."userId"
            AND relationship."blockedId" = viewer_user_id
          )
       )
     )
   ORDER BY interest."createdAt" ASC, interest.id ASC
   LIMIT p_limit;
END
$grainline_seller_public_commission_interest_cards$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_commission_interest_counts(text[])
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_commission_interest_counts(text[])
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_seller_public_commission_interest_cards(text, integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_commission_interest_cards(text, integer)
  TO grainline_app_runtime;

COMMIT;
