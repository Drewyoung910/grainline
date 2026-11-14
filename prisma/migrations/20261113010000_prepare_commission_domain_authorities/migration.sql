BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Additive compatible preparation only. CommissionRequest and
-- CommissionInterest keep predecessor grants and RLS remains off until the
-- converted application is live, predecessor traffic is drained, and the
-- separate activation is reviewed.
DO $grainline_commission_domain_preflight$
DECLARE
  expected_name text;
BEGIN
  IF (
    SELECT pg_catalog.count(*)
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'CommissionRequest'
       AND column_name IN (
         'id', 'buyerId', 'buyerAccountActive', 'buyerName', 'buyerImageUrl',
         'buyerSellerCity', 'buyerSellerState', 'title', 'description',
         'category', 'budgetMinCents', 'budgetMaxCents', 'timeline',
         'referenceImageUrls', 'status', 'interestedCount', 'expiresAt',
         'isNational', 'lat', 'lng', 'radiusMeters', 'createdAt', 'updatedAt',
         'metroId', 'cityMetroId'
       )
  ) <> 25 THEN
    RAISE EXCEPTION 'CommissionRequest column contract drifted';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'CommissionInterest'
       AND column_name IN (
         'id', 'commissionRequestId', 'sellerProfileId', 'conversationId',
         'createdAt'
       )
  ) <> 5 THEN
    RAISE EXCEPTION 'CommissionInterest column contract drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid IN (
       'public."CommissionRequest"'::pg_catalog.regclass,
       'public."CommissionInterest"'::pg_catalog.regclass
     )
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Commission domain RLS must remain off during compatible preparation';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid IN (
       'public."CommissionRequest"'::pg_catalog.regclass,
       'public."CommissionInterest"'::pg_catalog.regclass
     )
       AND NOT (
         pg_catalog.has_table_privilege('grainline_app_runtime', relation.oid, 'SELECT')
         AND pg_catalog.has_table_privilege('grainline_app_runtime', relation.oid, 'INSERT')
         AND pg_catalog.has_table_privilege('grainline_app_runtime', relation.oid, 'UPDATE')
         AND pg_catalog.has_table_privilege('grainline_app_runtime', relation.oid, 'DELETE')
       )
  ) THEN
    RAISE EXCEPTION 'Commission domain predecessor runtime CRUD drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid =
       'public.grainline_seller_owner_commission_interest_summaries(text[],integer)'::pg_catalog.regprocedure
       AND pg_catalog.md5(procedure.prosrc) = 'd8fc5bba0dda008f3c6e19cc0c9a351f'
  ) THEN
    RAISE EXCEPTION 'Commission owner-interest predecessor authority drifted';
  END IF;

  FOREACH expected_name IN ARRAY ARRAY[
    'grainline_commission_request_public_count',
    'grainline_commission_request_public_page',
    'grainline_commission_request_public_detail',
    'grainline_commission_request_public_sitemap_page',
    'grainline_commission_request_public_metro_ids',
    'grainline_commission_interest_actor_request_ids',
    'grainline_commission_interest_actor_create',
    'grainline_commission_request_owner_create',
    'grainline_commission_request_owner_assign_metros',
    'grainline_commission_request_owner_page',
    'grainline_commission_request_owner_export',
    'grainline_commission_request_owner_active_count',
    'grainline_commission_request_owner_reference_image_urls',
    'grainline_commission_interest_owner_export',
    'grainline_commission_request_owner_transition',
    'grainline_commission_account_deletion_prepare',
    'grainline_commission_account_deletion_redact',
    'grainline_commission_request_staff_ban_close',
    'grainline_commission_request_staff_ban_restore',
    'grainline_commission_request_service_expire_batch',
    'grainline_commission_request_service_expired_count'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public'
         AND procedure.proname = expected_name
    ) THEN
      RAISE EXCEPTION 'Commission preparation function % already exists', expected_name;
    END IF;
  END LOOP;
END
$grainline_commission_domain_preflight$;

CREATE FUNCTION public.grainline_commission_request_public_count(
  p_category text,
  p_metro_id text,
  p_city_metro_id text,
  p_viewer_lat double precision,
  p_viewer_lng double precision,
  p_near_radius_meters integer
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_request_public_count$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
BEGIN
  IF actor_id IS NOT NULL AND (
    actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
    OR NOT EXISTS (
      SELECT 1
        FROM public."User" AS actor
       WHERE actor.id = actor_id
         AND actor.banned = false
         AND actor."deletedAt" IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'Commission public actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF (p_category IS NOT NULL AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_enum AS enum_value
        WHERE enum_value.enumtypid = 'public."Category"'::pg_catalog.regtype
          AND enum_value.enumlabel = p_category
     ))
     OR (p_metro_id IS NOT NULL AND p_city_metro_id IS NOT NULL)
     OR (p_metro_id IS NOT NULL AND p_metro_id !~ '^[A-Za-z0-9._:-]{1,191}$')
     OR (p_city_metro_id IS NOT NULL AND p_city_metro_id !~ '^[A-Za-z0-9._:-]{1,191}$')
     OR ((p_viewer_lat IS NULL) <> (p_viewer_lng IS NULL))
     OR ((p_viewer_lat IS NULL) <> (p_near_radius_meters IS NULL))
     OR (p_viewer_lat IS NOT NULL AND (
       p_viewer_lat NOT BETWEEN -90 AND 90
       OR p_viewer_lng NOT BETWEEN -180 AND 180
       OR p_near_radius_meters NOT BETWEEN 1000 AND 500000
     )) THEN
    RAISE EXCEPTION 'Commission public count input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN (
    SELECT pg_catalog.count(*)::bigint
      FROM public."CommissionRequest" AS request
     WHERE request.status = 'OPEN'::public."CommissionStatus"
       AND (request."expiresAt" IS NULL OR request."expiresAt" >
         pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()))
       AND request."buyerAccountActive" = true
       AND pg_catalog.char_length(pg_catalog.btrim(request.title)) BETWEEN 1 AND 150
       AND pg_catalog.char_length(request.description) BETWEEN 1 AND 5000
       AND (request."budgetMinCents" IS NULL
            OR request."budgetMinCents" BETWEEN 0 AND 10000000)
       AND (request."budgetMaxCents" IS NULL
            OR request."budgetMaxCents" BETWEEN 0 AND 10000000)
       AND (request."budgetMinCents" IS NULL
            OR request."budgetMaxCents" IS NULL
            OR request."budgetMaxCents" >= request."budgetMinCents")
       AND (request.timeline IS NULL
            OR pg_catalog.char_length(request.timeline) BETWEEN 1 AND 200)
       AND pg_catalog.cardinality(request."referenceImageUrls") <= 3
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.unnest(request."referenceImageUrls") AS image(url)
          WHERE image.url IS NULL
             OR pg_catalog.char_length(image.url) NOT BETWEEN 1 AND 2048
             OR image.url !~ '^https://'
       )
       AND (request."buyerName" IS NULL
            OR pg_catalog.char_length(request."buyerName") <= 100)
       AND (request."buyerImageUrl" IS NULL
            OR pg_catalog.char_length(request."buyerImageUrl") <= 2048)
       AND (request."buyerSellerCity" IS NULL
            OR pg_catalog.char_length(request."buyerSellerCity") <= 100)
       AND (request."buyerSellerState" IS NULL
            OR pg_catalog.char_length(request."buyerSellerState") <= 50)
       AND (
         request."isNational" = true
         OR (
           request.lat BETWEEN -90 AND 90
           AND request.lng BETWEEN -180 AND 180
           AND request."radiusMeters" BETWEEN 5000 AND 500000
         )
       )
       AND (p_category IS NULL OR request.category::text = p_category)
       AND (p_metro_id IS NULL OR request."metroId" = p_metro_id)
       AND (p_city_metro_id IS NULL OR request."cityMetroId" = p_city_metro_id)
       AND (
         actor_id IS NULL
         OR NOT EXISTS (
           SELECT 1
             FROM public."Block" AS blocked_pair
            WHERE (blocked_pair."blockerId" = actor_id
                   AND blocked_pair."blockedId" = request."buyerId")
               OR (blocked_pair."blockerId" = request."buyerId"
                   AND blocked_pair."blockedId" = actor_id)
         )
       )
       AND (
         p_viewer_lat IS NULL
         OR request."isNational" = true
         OR (
           request.lat BETWEEN -90 AND 90
           AND request.lng BETWEEN -180 AND 180
           AND 6371000 * pg_catalog.acos(
             LEAST(1.0::double precision, GREATEST(-1.0::double precision,
               pg_catalog.cos(pg_catalog.radians(p_viewer_lat)) *
               pg_catalog.cos(pg_catalog.radians(LEAST(89.975::double precision, GREATEST(-89.975::double precision,
                 (pg_catalog.floor(request.lat::double precision * 20.0) + 0.5) / 20.0)))) *
               pg_catalog.cos(pg_catalog.radians(LEAST(179.975::double precision, GREATEST(-179.975::double precision,
                 (pg_catalog.floor(request.lng::double precision * 20.0) + 0.5) / 20.0))) -
                 pg_catalog.radians(p_viewer_lng)) +
               pg_catalog.sin(pg_catalog.radians(p_viewer_lat)) *
               pg_catalog.sin(pg_catalog.radians(LEAST(89.975::double precision, GREATEST(-89.975::double precision,
                 (pg_catalog.floor(request.lat::double precision * 20.0) + 0.5) / 20.0))))
             ))
           ) <= p_near_radius_meters
         )
       )
  );
END
$grainline_commission_request_public_count$;

CREATE FUNCTION public.grainline_commission_request_public_page(
  p_category text,
  p_metro_id text,
  p_city_metro_id text,
  p_viewer_lat double precision,
  p_viewer_lng double precision,
  p_near_radius_meters integer,
  p_offset integer,
  p_limit integer
)
RETURNS TABLE (
  id text,
  title text,
  description text,
  category text,
  "budgetMinCents" integer,
  "budgetMaxCents" integer,
  timeline text,
  "referenceImageUrls" text[],
  status text,
  "expiresAt" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone,
  "updatedAt" timestamp(3) without time zone,
  "isNational" boolean,
  "buyerName" text,
  "buyerImageUrl" text,
  "buyerSellerCity" text,
  "buyerSellerState" text,
  "metroId" text,
  "cityMetroId" text,
  "distanceMeters" double precision
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_request_public_page$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
BEGIN
  IF p_offset IS NULL OR p_offset < 0 OR p_offset > 999000
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Commission public page bounds are invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT request.*,
           CASE
             WHEN p_viewer_lat IS NOT NULL
              AND request.lat BETWEEN -90 AND 90
              AND request.lng BETWEEN -180 AND 180
             THEN 6371000 * pg_catalog.acos(
               LEAST(1.0::double precision, GREATEST(-1.0::double precision,
                 pg_catalog.cos(pg_catalog.radians(p_viewer_lat)) *
                 pg_catalog.cos(pg_catalog.radians(LEAST(89.975::double precision, GREATEST(-89.975::double precision,
                   (pg_catalog.floor(request.lat::double precision * 20.0) + 0.5) / 20.0)))) *
                 pg_catalog.cos(pg_catalog.radians(LEAST(179.975::double precision, GREATEST(-179.975::double precision,
                   (pg_catalog.floor(request.lng::double precision * 20.0) + 0.5) / 20.0))) -
                   pg_catalog.radians(p_viewer_lng)) +
                 pg_catalog.sin(pg_catalog.radians(p_viewer_lat)) *
                 pg_catalog.sin(pg_catalog.radians(LEAST(89.975::double precision, GREATEST(-89.975::double precision,
                   (pg_catalog.floor(request.lat::double precision * 20.0) + 0.5) / 20.0))))
               ))
             )
             ELSE NULL
           END AS distance_meters
      FROM public."CommissionRequest" AS request
     WHERE request.status = 'OPEN'::public."CommissionStatus"
       AND (request."expiresAt" IS NULL OR request."expiresAt" >
         pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()))
       AND request."buyerAccountActive" = true
       AND pg_catalog.char_length(pg_catalog.btrim(request.title)) BETWEEN 1 AND 150
       AND pg_catalog.char_length(request.description) BETWEEN 1 AND 5000
       AND (request."budgetMinCents" IS NULL
            OR request."budgetMinCents" BETWEEN 0 AND 10000000)
       AND (request."budgetMaxCents" IS NULL
            OR request."budgetMaxCents" BETWEEN 0 AND 10000000)
       AND (request."budgetMinCents" IS NULL
            OR request."budgetMaxCents" IS NULL
            OR request."budgetMaxCents" >= request."budgetMinCents")
       AND (request.timeline IS NULL
            OR pg_catalog.char_length(request.timeline) BETWEEN 1 AND 200)
       AND pg_catalog.cardinality(request."referenceImageUrls") <= 3
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.unnest(request."referenceImageUrls") AS image(url)
          WHERE image.url IS NULL
             OR pg_catalog.char_length(image.url) NOT BETWEEN 1 AND 2048
             OR image.url !~ '^https://'
       )
       AND (request."buyerName" IS NULL
            OR pg_catalog.char_length(request."buyerName") <= 100)
       AND (request."buyerImageUrl" IS NULL
            OR pg_catalog.char_length(request."buyerImageUrl") <= 2048)
       AND (request."buyerSellerCity" IS NULL
            OR pg_catalog.char_length(request."buyerSellerCity") <= 100)
       AND (request."buyerSellerState" IS NULL
            OR pg_catalog.char_length(request."buyerSellerState") <= 50)
       AND (
         request."isNational" = true
         OR (
           request.lat BETWEEN -90 AND 90
           AND request.lng BETWEEN -180 AND 180
           AND request."radiusMeters" BETWEEN 5000 AND 500000
         )
       )
       AND (p_category IS NULL OR request.category::text = p_category)
       AND (p_metro_id IS NULL OR request."metroId" = p_metro_id)
       AND (p_city_metro_id IS NULL OR request."cityMetroId" = p_city_metro_id)
       AND (
         actor_id IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM public."Block" AS blocked_pair
            WHERE (blocked_pair."blockerId" = actor_id
                   AND blocked_pair."blockedId" = request."buyerId")
               OR (blocked_pair."blockerId" = request."buyerId"
                   AND blocked_pair."blockedId" = actor_id)
         )
       )
  )
  SELECT eligible.id::text,
         COALESCE(
           NULLIF(pg_catalog.btrim(eligible.title::text), ''),
           'Untitled commission request'::text
         ),
         eligible.description::text,
         eligible.category::text,
         eligible."budgetMinCents",
         eligible."budgetMaxCents",
         eligible.timeline::text,
         eligible."referenceImageUrls"::text[],
         eligible.status::text,
         eligible."expiresAt",
         eligible."createdAt",
         eligible."updatedAt",
         eligible."isNational",
         eligible."buyerName"::text,
         eligible."buyerImageUrl"::text,
         eligible."buyerSellerCity"::text,
         eligible."buyerSellerState"::text,
         eligible."metroId"::text,
         eligible."cityMetroId"::text,
         eligible.distance_meters
    FROM eligible
   WHERE p_viewer_lat IS NULL
      OR eligible."isNational" = true
      OR eligible.distance_meters <= p_near_radius_meters
   ORDER BY
     CASE
       WHEN p_viewer_lat IS NOT NULL
        AND eligible."isNational" = false
        AND eligible.distance_meters IS NOT NULL THEN 0
       ELSE 1
     END,
     CASE WHEN p_viewer_lat IS NOT NULL THEN eligible.distance_meters END ASC NULLS LAST,
     eligible."createdAt" DESC,
     eligible.id DESC
   OFFSET p_offset
   LIMIT p_limit;
END
$grainline_commission_request_public_page$;

CREATE FUNCTION public.grainline_commission_request_public_detail(p_request_id text)
RETURNS TABLE (
  id text,
  title text,
  description text,
  category text,
  "budgetMinCents" integer,
  "budgetMaxCents" integer,
  timeline text,
  "referenceImageUrls" text[],
  status text,
  "expiresAt" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone,
  "updatedAt" timestamp(3) without time zone,
  "isNational" boolean,
  "buyerName" text,
  "buyerImageUrl" text,
  "buyerSellerCity" text,
  "buyerSellerState" text,
  "metroId" text,
  "metroSlug" text,
  "metroName" text,
  "metroState" text,
  "cityMetroId" text,
  "cityMetroSlug" text,
  "cityMetroName" text,
  "cityMetroState" text,
  "isOwner" boolean,
  "alreadyInterested" boolean
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_request_public_detail$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
BEGIN
  IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (actor_id IS NOT NULL AND (
       actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
       OR NOT EXISTS (
         SELECT 1 FROM public."User" AS actor
          WHERE actor.id = actor_id
            AND actor.banned = false
            AND actor."deletedAt" IS NULL
       )
     )) THEN
    RAISE EXCEPTION 'Commission detail context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT request.id::text,
         COALESCE(
           NULLIF(pg_catalog.btrim(request.title::text), ''),
           'Untitled commission request'::text
         ),
         CASE
           WHEN pg_catalog.char_length(request.description) BETWEEN 1 AND 5000
             THEN request.description::text
           ELSE '[Request details unavailable]'::text
         END,
         request.category::text,
         CASE WHEN request."budgetMinCents" BETWEEN 0 AND 10000000
              THEN request."budgetMinCents" ELSE NULL END,
         CASE WHEN request."budgetMaxCents" BETWEEN 0 AND 10000000
                   AND (request."budgetMinCents" IS NULL
                        OR request."budgetMaxCents" >= request."budgetMinCents")
              THEN request."budgetMaxCents" ELSE NULL END,
         CASE WHEN pg_catalog.char_length(request.timeline) BETWEEN 1 AND 200
              THEN request.timeline::text ELSE NULL END,
         CASE
           WHEN pg_catalog.cardinality(request."referenceImageUrls") <= 3
            AND NOT EXISTS (
              SELECT 1
                FROM pg_catalog.unnest(request."referenceImageUrls") AS image(url)
               WHERE image.url IS NULL
                  OR pg_catalog.char_length(image.url) NOT BETWEEN 1 AND 2048
                  OR image.url !~ '^https://'
            )
             THEN request."referenceImageUrls"::text[]
           ELSE ARRAY[]::text[]
         END,
         request.status::text,
         request."expiresAt",
         request."createdAt",
         request."updatedAt",
         request."isNational",
         CASE WHEN pg_catalog.char_length(request."buyerName") <= 100
              THEN request."buyerName"::text ELSE NULL END,
         CASE WHEN pg_catalog.char_length(request."buyerImageUrl") <= 2048
              THEN request."buyerImageUrl"::text ELSE NULL END,
         CASE WHEN pg_catalog.char_length(request."buyerSellerCity") <= 100
              THEN request."buyerSellerCity"::text ELSE NULL END,
         CASE WHEN pg_catalog.char_length(request."buyerSellerState") <= 50
              THEN request."buyerSellerState"::text ELSE NULL END,
         request."metroId"::text,
         metro.slug::text,
         metro.name::text,
         metro.state::text,
         request."cityMetroId"::text,
         city_metro.slug::text,
         city_metro.name::text,
         city_metro.state::text,
         actor_id IS NOT NULL AND request."buyerId" = actor_id,
         EXISTS (
           SELECT 1
             FROM public."CommissionInterest" AS interest
             JOIN public."SellerProfile" AS seller
               ON seller.id = interest."sellerProfileId"
            WHERE interest."commissionRequestId" = request.id
              AND seller."userId" = actor_id
              AND NOT EXISTS (
                SELECT 1 FROM public."Block" AS blocked_pair
                 WHERE (blocked_pair."blockerId" = actor_id
                        AND blocked_pair."blockedId" = request."buyerId")
                    OR (blocked_pair."blockerId" = request."buyerId"
                        AND blocked_pair."blockedId" = actor_id)
              )
         )
    FROM public."CommissionRequest" AS request
    LEFT JOIN public."Metro" AS metro ON metro.id = request."metroId"
    LEFT JOIN public."Metro" AS city_metro ON city_metro.id = request."cityMetroId"
   WHERE request.id = p_request_id
     AND request."buyerAccountActive" = true
     AND (
       (
         request.status = 'OPEN'::public."CommissionStatus"
         AND (request."expiresAt" IS NULL OR request."expiresAt" >
           pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()))
         AND (
           actor_id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM public."Block" AS blocked_pair
              WHERE (blocked_pair."blockerId" = actor_id
                     AND blocked_pair."blockedId" = request."buyerId")
                 OR (blocked_pair."blockerId" = request."buyerId"
                     AND blocked_pair."blockedId" = actor_id)
           )
         )
       )
       OR request."buyerId" = actor_id
       OR EXISTS (
         SELECT 1
           FROM public."CommissionInterest" AS interest
           JOIN public."SellerProfile" AS seller
             ON seller.id = interest."sellerProfileId"
          WHERE interest."commissionRequestId" = request.id
            AND seller."userId" = actor_id
            AND NOT EXISTS (
              SELECT 1 FROM public."Block" AS blocked_pair
               WHERE (blocked_pair."blockerId" = actor_id
                      AND blocked_pair."blockedId" = request."buyerId")
                  OR (blocked_pair."blockerId" = request."buyerId"
                      AND blocked_pair."blockedId" = actor_id)
            )
       )
     )
   LIMIT 1;
END
$grainline_commission_request_public_detail$;

CREATE FUNCTION public.grainline_commission_request_public_sitemap_page(
  p_offset integer,
  p_limit integer
)
RETURNS TABLE (
  id text,
  "updatedAt" timestamp(3) without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_request_public_sitemap_page$
BEGIN
  IF p_offset IS NULL OR p_offset < 0 OR p_offset > 999000
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 50000 THEN
    RAISE EXCEPTION 'Commission sitemap page bounds are invalid'
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT request.id::text, request."updatedAt"
    FROM public."CommissionRequest" AS request
   WHERE request.status = 'OPEN'::public."CommissionStatus"
     AND (request."expiresAt" IS NULL OR request."expiresAt" >
       pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()))
     AND request."buyerAccountActive" = true
       AND pg_catalog.char_length(pg_catalog.btrim(request.title)) BETWEEN 1 AND 150
       AND pg_catalog.char_length(request.description) BETWEEN 1 AND 5000
       AND (request."budgetMinCents" IS NULL
            OR request."budgetMinCents" BETWEEN 0 AND 10000000)
       AND (request."budgetMaxCents" IS NULL
            OR request."budgetMaxCents" BETWEEN 0 AND 10000000)
       AND (request."budgetMinCents" IS NULL
            OR request."budgetMaxCents" IS NULL
            OR request."budgetMaxCents" >= request."budgetMinCents")
       AND (request.timeline IS NULL
            OR pg_catalog.char_length(request.timeline) BETWEEN 1 AND 200)
       AND pg_catalog.cardinality(request."referenceImageUrls") <= 3
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.unnest(request."referenceImageUrls") AS image(url)
          WHERE image.url IS NULL
             OR pg_catalog.char_length(image.url) NOT BETWEEN 1 AND 2048
             OR image.url !~ '^https://'
       )
       AND (request."buyerName" IS NULL
            OR pg_catalog.char_length(request."buyerName") <= 100)
       AND (request."buyerImageUrl" IS NULL
            OR pg_catalog.char_length(request."buyerImageUrl") <= 2048)
       AND (request."buyerSellerCity" IS NULL
            OR pg_catalog.char_length(request."buyerSellerCity") <= 100)
       AND (request."buyerSellerState" IS NULL
            OR pg_catalog.char_length(request."buyerSellerState") <= 50)
       AND (
         request."isNational" = true
         OR (
           request.lat BETWEEN -90 AND 90
           AND request.lng BETWEEN -180 AND 180
           AND request."radiusMeters" BETWEEN 5000 AND 500000
         )
       )
   ORDER BY request."updatedAt" DESC, request.id ASC
   OFFSET p_offset
   LIMIT p_limit;
END
$grainline_commission_request_public_sitemap_page$;

CREATE FUNCTION public.grainline_commission_request_public_metro_ids()
RETURNS TABLE (id text)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_request_public_metro_ids$
  SELECT DISTINCT source.id::text
    FROM (
      SELECT request."metroId" AS id
        FROM public."CommissionRequest" AS request
       WHERE request.status = 'OPEN'::public."CommissionStatus"
         AND (request."expiresAt" IS NULL OR request."expiresAt" >
           pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()))
         AND request."buyerAccountActive" = true
      UNION
      SELECT request."cityMetroId" AS id
        FROM public."CommissionRequest" AS request
       WHERE request.status = 'OPEN'::public."CommissionStatus"
         AND (request."expiresAt" IS NULL OR request."expiresAt" >
           pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()))
         AND request."buyerAccountActive" = true
    ) AS source
   WHERE source.id IS NOT NULL
   ORDER BY source.id;
$grainline_commission_request_public_metro_ids$;

CREATE FUNCTION public.grainline_commission_interest_actor_request_ids(
  p_request_ids text[]
)
RETURNS TABLE ("commissionRequestId" text)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_interest_actor_request_ids$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  seller_id text;
BEGIN
  IF actor_id IS NULL OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_request_ids IS NULL
     OR pg_catalog.cardinality(p_request_ids) NOT BETWEEN 1 AND 1000
     OR pg_catalog.cardinality(p_request_ids) <> (
       SELECT pg_catalog.count(DISTINCT requested.id)
         FROM pg_catalog.unnest(p_request_ids) AS requested(id)
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.unnest(p_request_ids) AS requested(id)
        WHERE requested.id IS NULL
           OR requested.id !~ '^[A-Za-z0-9._:-]{1,191}$'
     ) THEN
    RAISE EXCEPTION 'Commission interest actor input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL;
  IF seller_id IS NULL THEN
    RAISE EXCEPTION 'Commission interest actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT interest."commissionRequestId"::text
    FROM public."CommissionInterest" AS interest
   WHERE interest."sellerProfileId" = seller_id
     AND interest."commissionRequestId" = ANY(p_request_ids)
   ORDER BY interest."commissionRequestId";
END
$grainline_commission_interest_actor_request_ids$;

-- Bind the already-live atomic Conversation/Message/CommissionInterest writer
-- to the transaction-local authenticated actor. The predecessor function
-- remains the single implementation of the multi-table write.
CREATE FUNCTION public.grainline_commission_interest_actor_create(
  p_conversation_id text,
  p_message_id text,
  p_interest_id text,
  p_commission_request_id text
)
RETURNS TABLE (
  "conversationId" text,
  "messageId" text,
  "commissionInterestId" text,
  "buyerUserId" text,
  "commissionTitle" text,
  "sellerDisplayName" text,
  created boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_interest_actor_create$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = actor_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Commission interest actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT *
    FROM public.grainline_message_create_commission_interest(
      p_conversation_id,
      p_message_id,
      p_interest_id,
      actor_id,
      p_commission_request_id
    );
END
$grainline_commission_interest_actor_create$;

CREATE FUNCTION public.grainline_commission_request_owner_create(
  p_id text,
  p_title text,
  p_description text,
  p_category text,
  p_budget_min_cents integer,
  p_budget_max_cents integer,
  p_timeline text,
  p_reference_image_urls text[],
  p_is_national boolean,
  p_lat double precision,
  p_lng double precision,
  p_radius_meters integer
)
RETURNS TABLE (
  id text,
  "expiresAt" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_request_owner_create$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  source_now timestamp(3) without time zone :=
    pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())::timestamp(3);
  source_expires_at timestamp(3) without time zone;
  upload_result record;
BEGIN
  IF p_id IS NULL OR p_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_title IS NULL OR pg_catalog.char_length(p_title) NOT BETWEEN 1 AND 150
     OR p_description IS NULL OR pg_catalog.char_length(p_description) NOT BETWEEN 1 AND 5000
     OR (p_category IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_enum AS enum_value
        WHERE enum_value.enumtypid = 'public."Category"'::pg_catalog.regtype
          AND enum_value.enumlabel = p_category
     ))
     OR (p_budget_min_cents IS NOT NULL AND p_budget_min_cents NOT BETWEEN 0 AND 10000000)
     OR (p_budget_max_cents IS NOT NULL AND p_budget_max_cents NOT BETWEEN 0 AND 10000000)
     OR (p_budget_min_cents IS NOT NULL AND p_budget_max_cents IS NOT NULL
         AND p_budget_max_cents < p_budget_min_cents)
     OR (p_timeline IS NOT NULL AND pg_catalog.char_length(p_timeline) NOT BETWEEN 1 AND 200)
     OR p_reference_image_urls IS NULL
     OR pg_catalog.cardinality(p_reference_image_urls) > 3
     OR EXISTS (
       SELECT 1 FROM pg_catalog.unnest(p_reference_image_urls) AS image(url)
        WHERE image.url IS NULL
           OR pg_catalog.char_length(image.url) NOT BETWEEN 1 AND 2048
           OR image.url !~ '^https://'
     )
     OR p_is_national IS NULL
     OR (p_is_national AND (p_lat IS NOT NULL OR p_lng IS NOT NULL))
     OR (NOT p_is_national AND (
       p_lat IS NULL OR p_lng IS NULL
       OR p_lat NOT BETWEEN -90 AND 90
       OR p_lng NOT BETWEEN -180 AND 180
       OR p_radius_meters IS NULL
       OR p_radius_meters NOT BETWEEN 5000 AND 500000
     )) THEN
    RAISE EXCEPTION 'Commission owner create input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public."User" AS actor
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commission owner context is invalid'
      USING ERRCODE = '42501';
  END IF;

  source_expires_at := (source_now + INTERVAL '90 days')::timestamp(3);
  INSERT INTO public."CommissionRequest" (
    id, "buyerId", title, description, category,
    "budgetMinCents", "budgetMaxCents", timeline, "referenceImageUrls",
    status, "interestedCount", "expiresAt", "isNational", lat, lng,
    "radiusMeters", "createdAt", "updatedAt"
  ) VALUES (
    p_id, actor_id, p_title, p_description,
    CASE WHEN p_category IS NULL THEN NULL ELSE p_category::public."Category" END,
    p_budget_min_cents, p_budget_max_cents, p_timeline,
    p_reference_image_urls, 'OPEN'::public."CommissionStatus", 0,
    source_expires_at, p_is_national, p_lat, p_lng,
    CASE WHEN p_is_national THEN 80000 ELSE p_radius_meters END,
    source_now, source_now
  );

  SELECT * INTO upload_result
    FROM public.grainline_direct_upload_sync_commission_request(actor_id, p_id);
  IF upload_result.untracked <> 0
     OR upload_result.referenced <> pg_catalog.cardinality(p_reference_image_urls) THEN
    RAISE EXCEPTION 'Commission reference images are not verified owner uploads'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY SELECT p_id, source_expires_at, source_now;
END
$grainline_commission_request_owner_create$;

CREATE FUNCTION public.grainline_commission_request_owner_assign_metros(
  p_request_id text,
  p_metro_id text,
  p_city_metro_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_request_owner_assign_metros$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
BEGIN
  IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS actor
        WHERE actor.id = actor_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     )
     OR (p_metro_id IS NOT NULL AND p_metro_id !~ '^[A-Za-z0-9._:-]{1,191}$')
     OR (p_city_metro_id IS NOT NULL AND p_city_metro_id !~ '^[A-Za-z0-9._:-]{1,191}$')
     OR (p_metro_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public."Metro" AS metro
        WHERE metro.id = p_metro_id AND metro."isActive" = true
     ))
     OR (p_city_metro_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public."Metro" AS metro
        WHERE metro.id = p_city_metro_id AND metro."isActive" = true
     )) THEN
    RAISE EXCEPTION 'Commission metro assignment input is invalid'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public."CommissionRequest" AS request
     SET "metroId" = p_metro_id,
         "cityMetroId" = p_city_metro_id,
         "updatedAt" = pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())::timestamp(3)
   WHERE request.id = p_request_id
     AND request."buyerId" = actor_id
     AND request.status = 'OPEN'::public."CommissionStatus";
  RETURN FOUND;
END
$grainline_commission_request_owner_assign_metros$;

CREATE FUNCTION public.grainline_commission_request_owner_page(p_limit integer)
RETURNS TABLE (
  id text,
  title text,
  description text,
  category text,
  "budgetMinCents" integer,
  "budgetMaxCents" integer,
  timeline text,
  "referenceImageUrls" text[],
  status text,
  "expiresAt" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone,
  "updatedAt" timestamp(3) without time zone,
  "isNational" boolean,
  "metroId" text,
  "cityMetroId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_request_owner_page$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS actor
        WHERE actor.id = actor_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Commission owner page context is invalid'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT request.id::text, request.title::text, request.description::text,
         request.category::text, request."budgetMinCents", request."budgetMaxCents",
         request.timeline::text, request."referenceImageUrls"::text[],
         request.status::text, request."expiresAt", request."createdAt",
         request."updatedAt", request."isNational", request."metroId"::text,
         request."cityMetroId"::text
    FROM public."CommissionRequest" AS request
   WHERE request."buyerId" = actor_id
   ORDER BY request."createdAt" DESC, request.id DESC
   LIMIT p_limit;
END
$grainline_commission_request_owner_page$;

CREATE FUNCTION public.grainline_commission_request_owner_export()
RETURNS TABLE (
  id text,
  title text,
  description text,
  category text,
  "budgetMinCents" integer,
  "budgetMaxCents" integer,
  timeline text,
  "referenceImageUrls" text[],
  status text,
  "interestedCount" integer,
  "expiresAt" timestamp(3) without time zone,
  "isNational" boolean,
  lat double precision,
  lng double precision,
  "radiusMeters" integer,
  "metroId" text,
  "cityMetroId" text,
  "createdAt" timestamp(3) without time zone,
  "updatedAt" timestamp(3) without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_request_owner_export$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."User" AS actor
     WHERE actor.id = actor_id
  ) THEN
    RAISE EXCEPTION 'Commission owner export context is invalid'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT request.id::text, request.title::text, request.description::text,
         request.category::text, request."budgetMinCents", request."budgetMaxCents",
         request.timeline::text, request."referenceImageUrls"::text[],
         request.status::text,
         (SELECT pg_catalog.count(*)::integer
            FROM public."CommissionInterest" AS interest
           WHERE interest."commissionRequestId" = request.id),
         request."expiresAt", request."isNational", request.lat, request.lng,
         request."radiusMeters", request."metroId"::text,
         request."cityMetroId"::text, request."createdAt",
         request."updatedAt"
    FROM public."CommissionRequest" AS request
   WHERE request."buyerId" = actor_id
   ORDER BY request."createdAt" DESC, request.id DESC;
END
$grainline_commission_request_owner_export$;

CREATE FUNCTION public.grainline_commission_request_owner_active_count()
RETURNS bigint
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_request_owner_active_count$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."User" AS actor WHERE actor.id = actor_id) THEN
    RAISE EXCEPTION 'Commission owner count context is invalid'
      USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT pg_catalog.count(*)::bigint
      FROM public."CommissionRequest" AS request
     WHERE request."buyerId" = actor_id
       AND request.status IN (
         'OPEN'::public."CommissionStatus",
         'IN_PROGRESS'::public."CommissionStatus"
       )
  );
END
$grainline_commission_request_owner_active_count$;

CREATE FUNCTION public.grainline_commission_request_owner_reference_image_urls()
RETURNS TABLE (url text)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_request_owner_reference_image_urls$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."User" AS actor WHERE actor.id = actor_id) THEN
    RAISE EXCEPTION 'Commission owner media context is invalid'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT DISTINCT image.url::text
    FROM public."CommissionRequest" AS request
    CROSS JOIN LATERAL pg_catalog.unnest(request."referenceImageUrls") AS image(url)
   WHERE request."buyerId" = actor_id
   ORDER BY image.url;
END
$grainline_commission_request_owner_reference_image_urls$;

CREATE FUNCTION public.grainline_commission_interest_owner_export()
RETURNS TABLE (
  "commissionRequestId" text,
  "conversationId" text,
  "createdAt" timestamp(3) without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_interest_owner_export$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  seller_id text;
BEGIN
  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller ON seller."userId" = actor.id
   WHERE actor.id = actor_id;
  IF seller_id IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT interest."commissionRequestId"::text,
         interest."conversationId"::text,
         interest."createdAt"
    FROM public."CommissionInterest" AS interest
   WHERE interest."sellerProfileId" = seller_id
   ORDER BY interest."createdAt" DESC, interest.id DESC;
END
$grainline_commission_interest_owner_export$;

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
        JOIN public."SellerProfile" AS seller
          ON seller.id = interest."sellerProfileId"
         AND seller."chargesEnabled" = true
         AND seller."stripeAccountSupported" = true
         AND seller."vacationMode" = false
         AND seller."ownerAccountActive" = true
       WHERE interest."commissionRequestId" = commission.id
         AND NOT EXISTS (
           SELECT 1
             FROM public."Block" AS relationship
            WHERE (
              relationship."blockerId" = request_user_id
              AND relationship."blockedId" = seller."userId"
            ) OR (
              relationship."blockerId" = seller."userId"
              AND relationship."blockedId" = request_user_id
            )
         )
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
         AND seller."chargesEnabled" = true
         AND seller."stripeAccountSupported" = true
         AND seller."vacationMode" = false
         AND seller."ownerAccountActive" = true
       WHERE interest."commissionRequestId" = commission.id
         AND NOT EXISTS (
           SELECT 1
             FROM public."Block" AS relationship
            WHERE (
              relationship."blockerId" = request_user_id
              AND relationship."blockedId" = seller."userId"
            ) OR (
              relationship."blockerId" = seller."userId"
              AND relationship."blockedId" = request_user_id
            )
         )
       ORDER BY interest."createdAt" ASC, interest.id ASC
       LIMIT p_limit
    ) AS card ON true
   ORDER BY requested.position, card.sort_created_at ASC, card."interestId" ASC;
END
$grainline_seller_owner_commission_interest_summaries$;

CREATE FUNCTION public.grainline_commission_request_owner_transition(
  p_request_id text,
  p_status text
)
RETURNS TABLE (
  outcome text,
  "requestId" text,
  title text,
  status text,
  "sellerUserIds" text[]
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_request_owner_transition$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  request_row record;
  seller_user_ids text[];
  source_now timestamp(3) without time zone :=
    pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())::timestamp(3);
BEGIN
  IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_status NOT IN ('FULFILLED', 'CLOSED') THEN
    RAISE EXCEPTION 'Commission owner transition input is invalid'
      USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public."User" AS actor
   WHERE actor.id = actor_id AND actor.banned = false AND actor."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commission owner transition context is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT request.id, request.title, request.status, request."expiresAt"
    INTO request_row
    FROM public."CommissionRequest" AS request
   WHERE request.id = p_request_id
     AND request."buyerId" = actor_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found', NULL::text, NULL::text, NULL::text, ARRAY[]::text[];
    RETURN;
  END IF;
  IF request_row.status <> 'OPEN'::public."CommissionStatus"
     OR (request_row."expiresAt" IS NOT NULL AND request_row."expiresAt" <= source_now) THEN
    RETURN QUERY SELECT 'not_open', request_row.id::text, request_row.title::text,
      request_row.status::text, ARRAY[]::text[];
    RETURN;
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(target."userId" ORDER BY target.first_interest, target."userId"), ARRAY[]::text[])
    INTO seller_user_ids
    FROM (
      SELECT seller."userId"::text AS "userId", pg_catalog.min(interest."createdAt") AS first_interest
        FROM public."CommissionInterest" AS interest
        JOIN public."SellerProfile" AS seller ON seller.id = interest."sellerProfileId"
       WHERE interest."commissionRequestId" = request_row.id
         AND seller."ownerAccountActive" = true
         AND NOT EXISTS (
           SELECT 1 FROM public."Block" AS blocked_pair
            WHERE (blocked_pair."blockerId" = actor_id
                   AND blocked_pair."blockedId" = seller."userId")
               OR (blocked_pair."blockerId" = seller."userId"
                   AND blocked_pair."blockedId" = actor_id)
         )
       GROUP BY seller."userId"
    ) AS target;
  IF p_status = 'FULFILLED' AND pg_catalog.cardinality(seller_user_ids) = 0 THEN
    RETURN QUERY SELECT 'needs_interest', request_row.id::text, request_row.title::text,
      request_row.status::text, seller_user_ids;
    RETURN;
  END IF;

  UPDATE public."CommissionRequest" AS request
     SET status = p_status::public."CommissionStatus", "updatedAt" = source_now
   WHERE request.id = request_row.id;
  RETURN QUERY SELECT 'transitioned', request_row.id::text, request_row.title::text,
    p_status, seller_user_ids;
END
$grainline_commission_request_owner_transition$;

CREATE FUNCTION public.grainline_commission_account_deletion_prepare(
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS TABLE (
  "closedRequestCount" integer,
  "removedInterestCount" integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_account_deletion_prepare$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  seller_id text;
  affected_request_ids text[] := ARRAY[]::text[];
  closed_count integer := 0;
  removed_count integer := 0;
  source_now timestamp(3) without time zone :=
    pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())::timestamp(3);
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_side_effect_id IS NULL
     OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Commission account-deletion input is invalid'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public."User" AS actor WHERE actor.id = actor_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commission account-deletion context is invalid'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id
     AND effect."userId" = actor_id
     AND effect.kind = 'LOCAL_ANONYMIZE'
     AND effect."dedupKey" = 'account-delete:local:' || actor_id
     AND effect.payload = '{}'::jsonb
     AND effect.status = 'PROCESSING'
     AND effect."claimGeneration" = p_claim_generation
     AND effect."claimToken" = p_claim_token
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commission account-deletion claim is not authorized'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public."CommissionRequest" AS request
     SET status = 'CLOSED'::public."CommissionStatus",
         "updatedAt" = source_now
   WHERE request."buyerId" = actor_id
     AND request.status IN (
       'OPEN'::public."CommissionStatus",
       'IN_PROGRESS'::public."CommissionStatus"
     );
  GET DIAGNOSTICS closed_count = ROW_COUNT;

  SELECT seller.id INTO seller_id
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = actor_id
   FOR UPDATE;
  IF seller_id IS NOT NULL THEN
    SELECT COALESCE(
             pg_catalog.array_agg(DISTINCT interest."commissionRequestId"),
             ARRAY[]::text[]
           )
      INTO affected_request_ids
      FROM public."CommissionInterest" AS interest
     WHERE interest."sellerProfileId" = seller_id;

    DELETE FROM public."CommissionInterest" AS interest
     WHERE interest."sellerProfileId" = seller_id;
    GET DIAGNOSTICS removed_count = ROW_COUNT;

    UPDATE public."CommissionRequest" AS request
       SET "interestedCount" = (
             SELECT pg_catalog.count(*)::integer
               FROM public."CommissionInterest" AS interest
              WHERE interest."commissionRequestId" = request.id
           ),
           "updatedAt" = source_now
     WHERE request.id = ANY(affected_request_ids);
  END IF;

  RETURN QUERY SELECT closed_count, removed_count;
END
$grainline_commission_account_deletion_prepare$;

CREATE FUNCTION public.grainline_commission_account_deletion_redact(
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_account_deletion_redact$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  redacted_count integer;
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_side_effect_id IS NULL
     OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Commission account-deletion redaction input is invalid'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public."User" AS actor WHERE actor.id = actor_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commission account-deletion redaction context is invalid'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id
     AND effect."userId" = actor_id
     AND effect.kind = 'LOCAL_ANONYMIZE'
     AND effect."dedupKey" = 'account-delete:local:' || actor_id
     AND effect.payload = '{}'::jsonb
     AND effect.status = 'PROCESSING'
     AND effect."claimGeneration" = p_claim_generation
     AND effect."claimToken" = p_claim_token
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commission account-deletion redaction claim is not authorized'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public."CommissionRequest" AS request
     SET title = 'Deleted commission request',
         description = '[Request deleted]',
         timeline = NULL,
         "referenceImageUrls" = ARRAY[]::text[],
         lat = NULL,
         lng = NULL,
         "radiusMeters" = NULL,
         "isNational" = true,
         "updatedAt" = pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())::timestamp(3)
   WHERE request."buyerId" = actor_id;
  GET DIAGNOSTICS redacted_count = ROW_COUNT;
  RETURN redacted_count;
END
$grainline_commission_account_deletion_redact$;

CREATE FUNCTION public.grainline_commission_request_staff_ban_close(
  p_capability_id text,
  p_target_user_id text
)
RETURNS TABLE (id text, status text)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_request_staff_ban_close$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  capability_actor_id text;
BEGIN
  IF p_capability_id IS NULL
     OR p_capability_id !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
     OR p_target_user_id IS NULL
     OR p_target_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS actor
        WHERE actor.id = actor_id
          AND actor.role::text = 'ADMIN'
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Commission staff ban context is invalid'
      USING ERRCODE = '42501';
  END IF;
  SELECT capability."actorUserId"
    INTO capability_actor_id
    FROM public."OrderStaffCapability" AS capability
   WHERE capability.id = p_capability_id
     AND capability."targetUserId" = p_target_user_id
     AND capability.operation = 'BAN_REVIEW_FLAG'
     AND capability."payloadHash" IS NULL
     AND capability."expiresAt" >= pg_catalog.clock_timestamp()
   FOR SHARE;
  IF capability_actor_id IS NULL OR capability_actor_id <> actor_id THEN
    RAISE EXCEPTION 'Commission staff ban capability is invalid or expired'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public."User" AS target
   WHERE target.id = p_target_user_id
     AND target.banned = true
     AND target."bannedBy" = actor_id
     AND target."deletedAt" IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commission staff ban witness changed'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT request.id, request.status
      FROM public."CommissionRequest" AS request
     WHERE request."buyerId" = p_target_user_id
       AND request.status IN (
         'OPEN'::public."CommissionStatus",
         'IN_PROGRESS'::public."CommissionStatus"
       )
     ORDER BY request.id
     FOR UPDATE
  ), updated AS (
    UPDATE public."CommissionRequest" AS request
       SET status = 'CLOSED'::public."CommissionStatus",
           "updatedAt" = pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())::timestamp(3)
      FROM candidates
     WHERE request.id = candidates.id
    RETURNING request.id
  )
  SELECT candidates.id::text, candidates.status::text
    FROM candidates
    JOIN updated ON updated.id = candidates.id
   ORDER BY candidates.id;
END
$grainline_commission_request_staff_ban_close$;

CREATE FUNCTION public.grainline_commission_request_staff_ban_restore(
  p_capability_id text,
  p_target_user_id text,
  p_request_ids text[],
  p_statuses text[]
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_request_staff_ban_restore$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  capability_actor_id text;
  restored_count integer := 0;
BEGIN
  IF p_capability_id IS NULL
     OR p_capability_id !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
     OR p_target_user_id IS NULL
     OR p_target_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_request_ids IS NULL
     OR p_statuses IS NULL
     OR pg_catalog.cardinality(p_request_ids) <> pg_catalog.cardinality(p_statuses)
     OR pg_catalog.cardinality(p_request_ids) > 1000
     OR pg_catalog.cardinality(p_request_ids) <> (
       SELECT pg_catalog.count(DISTINCT source.id)
         FROM pg_catalog.unnest(p_request_ids) AS source(id)
     )
     OR EXISTS (
       SELECT 1
         FROM ROWS FROM (
           pg_catalog.unnest(p_request_ids),
           pg_catalog.unnest(p_statuses)
         ) AS source(id, status)
        WHERE source.id IS NULL
           OR source.id !~ '^[A-Za-z0-9._:-]{1,191}$'
           OR source.status NOT IN ('OPEN', 'IN_PROGRESS')
     )
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS actor
        WHERE actor.id = actor_id
          AND actor.role::text = 'ADMIN'
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Commission staff restore input is invalid'
      USING ERRCODE = '22023';
  END IF;
  SELECT capability."actorUserId"
    INTO capability_actor_id
    FROM public."OrderStaffCapability" AS capability
   WHERE capability.id = p_capability_id
     AND capability."targetUserId" = p_target_user_id
     AND capability.operation = 'BAN_REVIEW_RESTORE'
     AND capability."payloadHash" ~ '^[a-f0-9]{64}$'
     AND capability."expiresAt" >= pg_catalog.clock_timestamp()
   FOR SHARE;
  IF capability_actor_id IS NULL OR capability_actor_id <> actor_id THEN
    RAISE EXCEPTION 'Commission staff restore capability is invalid or expired'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public."User" AS target
   WHERE target.id = p_target_user_id
     AND target.banned = true
     AND target."deletedAt" IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commission staff restore witness changed'
      USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.unnest(p_request_ids) AS requested(id)
      LEFT JOIN public."CommissionRequest" AS request
        ON request.id = requested.id
       AND request."buyerId" = p_target_user_id
       AND request.status = 'CLOSED'::public."CommissionStatus"
     WHERE request.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Commission staff restore rows changed'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public."CommissionRequest" AS request
     SET status = source.status::public."CommissionStatus",
         "updatedAt" = pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())::timestamp(3)
    FROM ROWS FROM (
      pg_catalog.unnest(p_request_ids),
      pg_catalog.unnest(p_statuses)
    ) AS source(id, status)
   WHERE request.id = source.id
     AND request."buyerId" = p_target_user_id
     AND request.status = 'CLOSED'::public."CommissionStatus";
  GET DIAGNOSTICS restored_count = ROW_COUNT;
  IF restored_count <> pg_catalog.cardinality(p_request_ids) THEN
    RAISE EXCEPTION 'Commission staff restore raced'
      USING ERRCODE = '40001';
  END IF;
  RETURN restored_count;
END
$grainline_commission_request_staff_ban_restore$;

CREATE FUNCTION public.grainline_commission_request_service_expire_batch(p_limit integer)
RETURNS TABLE (
  "requestId" text,
  title text,
  "buyerUserId" text,
  "sellerUserIds" text[]
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_request_service_expire_batch$
DECLARE
  source_now timestamp(3) without time zone :=
    pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())::timestamp(3);
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Commission expiry batch limit is invalid'
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT request.id
      FROM public."CommissionRequest" AS request
     WHERE request.status = 'OPEN'::public."CommissionStatus"
       AND request."expiresAt" IS NOT NULL
       AND request."expiresAt" <= source_now
     ORDER BY request."expiresAt" ASC, request.id ASC
     FOR UPDATE OF request SKIP LOCKED
     LIMIT p_limit
  ), updated AS (
    UPDATE public."CommissionRequest" AS request
       SET status = 'EXPIRED'::public."CommissionStatus",
           "updatedAt" = source_now
      FROM candidates
     WHERE request.id = candidates.id
    RETURNING request.id, request.title, request."buyerId"
  )
  SELECT updated.id::text,
         updated.title::text,
         updated."buyerId"::text,
         COALESCE(targets."sellerUserIds", ARRAY[]::text[])
    FROM updated
    LEFT JOIN LATERAL (
      SELECT pg_catalog.array_agg(target."userId" ORDER BY target.first_interest, target."userId")
        AS "sellerUserIds"
        FROM (
          SELECT seller."userId"::text AS "userId",
                 pg_catalog.min(interest."createdAt") AS first_interest
            FROM public."CommissionInterest" AS interest
            JOIN public."SellerProfile" AS seller ON seller.id = interest."sellerProfileId"
           WHERE interest."commissionRequestId" = updated.id
             AND seller."ownerAccountActive" = true
             AND NOT EXISTS (
               SELECT 1 FROM public."Block" AS blocked_pair
                WHERE (blocked_pair."blockerId" = updated."buyerId"
                       AND blocked_pair."blockedId" = seller."userId")
                   OR (blocked_pair."blockerId" = seller."userId"
                       AND blocked_pair."blockedId" = updated."buyerId")
             )
           GROUP BY seller."userId"
           ORDER BY pg_catalog.min(interest."createdAt") ASC, seller."userId" ASC
           LIMIT 10000
        ) AS target
    ) AS targets ON true
   ORDER BY updated.id;
END
$grainline_commission_request_service_expire_batch$;

CREATE FUNCTION public.grainline_commission_request_service_expired_count()
RETURNS bigint
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_request_service_expired_count$
  SELECT pg_catalog.count(*)::bigint
    FROM public."CommissionRequest" AS request
   WHERE request.status = 'OPEN'::public."CommissionStatus"
     AND request."expiresAt" IS NOT NULL
     AND request."expiresAt" <=
       pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
$grainline_commission_request_service_expired_count$;

REVOKE ALL ON FUNCTION public.grainline_commission_request_public_count(
  text,text,text,double precision,double precision,integer
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_request_public_page(
  text,text,text,double precision,double precision,integer,integer,integer
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_request_public_detail(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_request_public_sitemap_page(integer,integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_request_public_metro_ids()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_interest_actor_request_ids(text[])
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_interest_actor_create(text,text,text,text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_request_owner_create(
  text,text,text,text,integer,integer,text,text[],boolean,double precision,double precision,integer
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_request_owner_assign_metros(text,text,text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_request_owner_page(integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_request_owner_export()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_request_owner_active_count()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_request_owner_reference_image_urls()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_interest_owner_export()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_request_owner_transition(text,text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_account_deletion_prepare(text,bigint,uuid)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_account_deletion_redact(text,bigint,uuid)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_request_staff_ban_close(text,text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_request_staff_ban_restore(text,text,text[],text[])
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_request_service_expire_batch(integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_commission_request_service_expired_count()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_owner_commission_interest_summaries(text[],integer)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_commission_request_public_count(
  text,text,text,double precision,double precision,integer
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_request_public_page(
  text,text,text,double precision,double precision,integer,integer,integer
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_request_public_detail(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_request_public_sitemap_page(integer,integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_request_public_metro_ids()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_interest_actor_request_ids(text[])
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_interest_actor_create(text,text,text,text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_request_owner_create(
  text,text,text,text,integer,integer,text,text[],boolean,double precision,double precision,integer
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_request_owner_assign_metros(text,text,text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_request_owner_page(integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_request_owner_export()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_request_owner_active_count()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_request_owner_reference_image_urls()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_interest_owner_export()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_request_owner_transition(text,text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_account_deletion_prepare(text,bigint,uuid)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_account_deletion_redact(text,bigint,uuid)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_request_staff_ban_close(text,text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_request_staff_ban_restore(text,text,text[],text[])
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_request_service_expire_batch(integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_commission_request_service_expired_count()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_commission_interest_summaries(text[],integer)
  TO grainline_app_runtime;

COMMIT;
