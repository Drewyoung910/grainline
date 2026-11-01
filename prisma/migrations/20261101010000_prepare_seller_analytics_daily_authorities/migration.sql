BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Refuse to bless predecessor rows that violate the reviewed aggregate shape.
DO $grainline_seller_analytics_daily_inventory$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ListingViewDaily" AS daily
     WHERE daily.views < 0
        OR daily.clicks < 0
        OR daily.views >= 2147483647
        OR daily.clicks >= 2147483647
        OR daily.date IS DISTINCT FROM pg_catalog.date_trunc('day', daily.date)
        OR NOT EXISTS (
          SELECT 1
            FROM public."Listing" AS listing
           WHERE listing.id = daily."listingId"
             AND listing."sellerId" = daily."sellerProfileId"
        )
  ) THEN
    RAISE EXCEPTION 'ListingViewDaily contains invalid predecessor rows'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."SellerProfileViewDaily" AS daily
     WHERE daily.views < 0
        OR daily.views >= 2147483647
        OR daily.date IS DISTINCT FROM pg_catalog.date_trunc('day', daily.date)
  ) THEN
    RAISE EXCEPTION 'SellerProfileViewDaily contains invalid predecessor rows'
      USING ERRCODE = '23514';
  END IF;
END
$grainline_seller_analytics_daily_inventory$;

ALTER TABLE public."ListingViewDaily"
  ADD CONSTRAINT "ListingViewDaily_counts_non_negative_chk"
  CHECK (views >= 0 AND clicks >= 0) NOT VALID;
ALTER TABLE public."ListingViewDaily"
  VALIDATE CONSTRAINT "ListingViewDaily_counts_non_negative_chk";

ALTER TABLE public."ListingViewDaily"
  ADD CONSTRAINT "ListingViewDaily_date_midnight_utc_chk"
  CHECK (date = pg_catalog.date_trunc('day', date)) NOT VALID;
ALTER TABLE public."ListingViewDaily"
  VALIDATE CONSTRAINT "ListingViewDaily_date_midnight_utc_chk";

ALTER TABLE public."SellerProfileViewDaily"
  ADD CONSTRAINT "SellerProfileViewDaily_views_non_negative_chk"
  CHECK (views >= 0) NOT VALID;
ALTER TABLE public."SellerProfileViewDaily"
  VALIDATE CONSTRAINT "SellerProfileViewDaily_views_non_negative_chk";

ALTER TABLE public."SellerProfileViewDaily"
  ADD CONSTRAINT "SellerProfileViewDaily_date_midnight_utc_chk"
  CHECK (date = pg_catalog.date_trunc('day', date)) NOT VALID;
ALTER TABLE public."SellerProfileViewDaily"
  VALIDATE CONSTRAINT "SellerProfileViewDaily_date_midnight_utc_chk";

-- Record one accepted public listing telemetry event. Application abuse
-- controls run before this operation; the database owns final visibility,
-- seller derivation, current-day bucketing, self exclusion and counter parity.
CREATE OR REPLACE FUNCTION public.grainline_listing_analytics_record(
  p_listing_id text,
  p_metric_kind text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_analytics_record$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  source_seller_profile_id text;
  source_owner_user_id text;
  source_view_count integer;
  source_click_count integer;
  daily_seller_profile_id text;
  daily_views integer;
  daily_clicks integer;
  changed_at timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  today_bucket timestamp(3) without time zone;
BEGIN
  IF p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_metric_kind IS NULL
     OR p_metric_kind NOT IN ('view', 'click')
     OR (
       request_user_id IS NOT NULL
       AND request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     ) THEN
    RAISE EXCEPTION 'Listing analytics input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT listing."sellerId",
         seller."userId",
         listing."viewCount",
         listing."clickCount"
    INTO source_seller_profile_id,
         source_owner_user_id,
         source_view_count,
         source_click_count
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE listing.id = p_listing_id
     AND listing.status = 'ACTIVE'::public."ListingStatus"
     AND listing."isPrivate" = false
     AND listing."archivedAt" IS NULL
     AND listing."sellerPubliclyOrderable" = true
   FOR UPDATE OF listing;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF request_user_id IS NOT NULL
     AND request_user_id = source_owner_user_id
     AND EXISTS (
       SELECT 1
         FROM public."User" AS account_user
        WHERE account_user.id = request_user_id
          AND account_user.banned = false
          AND account_user."deletedAt" IS NULL
     ) THEN
    RETURN false;
  END IF;

  IF (p_metric_kind = 'view' AND source_view_count >= 2147483647)
     OR (p_metric_kind = 'click' AND source_click_count >= 2147483647) THEN
    RAISE EXCEPTION 'Listing analytics scalar counter is exhausted'
      USING ERRCODE = '22003';
  END IF;

  today_bucket := pg_catalog.date_trunc('day', changed_at);
  SELECT daily."sellerProfileId", daily.views, daily.clicks
    INTO daily_seller_profile_id, daily_views, daily_clicks
    FROM public."ListingViewDaily" AS daily
   WHERE daily."listingId" = p_listing_id
     AND daily.date = today_bucket
   FOR UPDATE;

  IF FOUND THEN
    IF daily_seller_profile_id IS DISTINCT FROM source_seller_profile_id THEN
      RAISE EXCEPTION 'Listing analytics seller identity drifted'
        USING ERRCODE = '23514';
    END IF;
    IF (p_metric_kind = 'view' AND daily_views >= 2147483647)
       OR (p_metric_kind = 'click' AND daily_clicks >= 2147483647) THEN
      RAISE EXCEPTION 'Listing analytics daily counter is exhausted'
        USING ERRCODE = '22003';
    END IF;
  END IF;

  IF p_metric_kind = 'view' THEN
    UPDATE public."Listing"
       SET "viewCount" = "viewCount" + 1,
           "updatedAt" = changed_at
     WHERE id = p_listing_id;
  ELSE
    UPDATE public."Listing"
       SET "clickCount" = "clickCount" + 1,
           "updatedAt" = changed_at
     WHERE id = p_listing_id;
  END IF;

  IF daily_seller_profile_id IS NULL THEN
    INSERT INTO public."ListingViewDaily" (
      id, "listingId", "sellerProfileId", date, views, clicks
    ) VALUES (
      'lvd_' || pg_catalog.md5(p_listing_id || ':' || today_bucket::text),
      p_listing_id,
      source_seller_profile_id,
      today_bucket,
      CASE WHEN p_metric_kind = 'view' THEN 1 ELSE 0 END,
      CASE WHEN p_metric_kind = 'click' THEN 1 ELSE 0 END
    );
  ELSIF p_metric_kind = 'view' THEN
    UPDATE public."ListingViewDaily"
       SET views = views + 1
     WHERE "listingId" = p_listing_id
       AND date = today_bucket;
  ELSE
    UPDATE public."ListingViewDaily"
       SET clicks = clicks + 1
     WHERE "listingId" = p_listing_id
       AND date = today_bucket;
  END IF;

  RETURN true;
END
$grainline_listing_analytics_record$;

-- Harden the retained profile recorder against an independently exhausted
-- daily row while preserving its parent-first lock order and exact behavior.
CREATE OR REPLACE FUNCTION public.grainline_seller_profile_view_record(
  p_seller_profile_id text,
  p_viewed_on date
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_profile_view_record$
DECLARE
  private_views integer;
  daily_views integer;
  changed_at timestamp(3);
BEGIN
  IF p_seller_profile_id IS NULL
       OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_viewed_on IS NULL
     OR p_viewed_on IS DISTINCT FROM
       (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'Seller profile-view input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller_private."profileViews"
    INTO private_views
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller.id = p_seller_profile_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."ownerAccountActive" = true
   FOR UPDATE OF seller, seller_private;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT daily.views
    INTO daily_views
    FROM public."SellerProfileViewDaily" AS daily
   WHERE daily."sellerProfileId" = p_seller_profile_id
     AND daily.date = p_viewed_on::timestamp
   FOR UPDATE;

  IF private_views >= 2147483647
     OR (daily_views IS NOT NULL AND daily_views >= 2147483647) THEN
    RAISE EXCEPTION 'Seller profile-view counter is exhausted'
      USING ERRCODE = '22003';
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SellerProfilePrivate"
     SET "profileViews" = "profileViews" + 1,
         "updatedAt" = changed_at
   WHERE "sellerProfileId" = p_seller_profile_id;
  UPDATE public."SellerProfile"
     SET "updatedAt" = changed_at
   WHERE id = p_seller_profile_id;

  INSERT INTO public."SellerProfileViewDaily" (
    id, "sellerProfileId", date, views
  ) VALUES (
    'spv_' || pg_catalog.md5(p_seller_profile_id || ':' || p_viewed_on::text),
    p_seller_profile_id,
    p_viewed_on::timestamp,
    1
  )
  ON CONFLICT ("sellerProfileId", date) DO UPDATE
    SET views = public."SellerProfileViewDaily".views + 1;

  RETURN true;
END
$grainline_seller_profile_view_record$;

-- Return only the authenticated seller's totals and already-grouped chart
-- buckets. The actor comes from transaction-local server context.
CREATE OR REPLACE FUNCTION public.grainline_seller_engagement_analytics(
  p_start_epoch_millis bigint,
  p_end_epoch_millis bigint,
  p_end_exclusive boolean,
  p_grouping text
)
RETURNS TABLE (
  listing_views bigint,
  listing_clicks bigint,
  profile_views bigint,
  bucket_epoch_millis bigint,
  bucket_views bigint,
  bucket_clicks bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_engagement_analytics$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  source_seller_profile_id text;
  range_start timestamp(3) without time zone;
  range_end timestamp(3) without time zone;
  bucket_kind text;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller engagement context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_start_epoch_millis IS NULL
     OR p_end_epoch_millis IS NULL
     OR p_start_epoch_millis NOT BETWEEN 0 AND 253402300799999
     OR p_end_epoch_millis NOT BETWEEN 0 AND 253402300799999
     OR p_start_epoch_millis > p_end_epoch_millis
     OR p_end_epoch_millis - p_start_epoch_millis > 3155760000000
     OR p_end_exclusive IS NULL
     OR p_grouping IS NULL
     OR p_grouping NOT IN ('hour', 'day', 'month', 'year') THEN
    RAISE EXCEPTION 'Seller engagement range is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id
    INTO source_seller_profile_id
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
   WHERE account_user.id = request_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  range_start := (
    pg_catalog.to_timestamp(p_start_epoch_millis::double precision / 1000.0)
    AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone;
  range_end := (
    pg_catalog.to_timestamp(p_end_epoch_millis::double precision / 1000.0)
    AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone;
  bucket_kind := CASE WHEN p_grouping = 'hour' THEN 'day' ELSE p_grouping END;

  RETURN QUERY
  WITH listing_totals AS (
    SELECT COALESCE(pg_catalog.sum(daily.views), 0)::bigint AS views,
           COALESCE(pg_catalog.sum(daily.clicks), 0)::bigint AS clicks
      FROM public."ListingViewDaily" AS daily
     WHERE daily."sellerProfileId" = source_seller_profile_id
       AND daily.date >= range_start
       AND (
         (p_end_exclusive AND daily.date < range_end)
         OR (NOT p_end_exclusive AND daily.date <= range_end)
       )
  ),
  profile_totals AS (
    SELECT COALESCE(pg_catalog.sum(daily.views), 0)::bigint AS views
      FROM public."SellerProfileViewDaily" AS daily
     WHERE daily."sellerProfileId" = source_seller_profile_id
       AND daily.date >= range_start
       AND (
         (p_end_exclusive AND daily.date < range_end)
         OR (NOT p_end_exclusive AND daily.date <= range_end)
       )
  ),
  buckets AS (
    SELECT pg_catalog.date_trunc(bucket_kind, daily.date) AS bucket,
           pg_catalog.sum(daily.views)::bigint AS views,
           pg_catalog.sum(daily.clicks)::bigint AS clicks
      FROM public."ListingViewDaily" AS daily
     WHERE daily."sellerProfileId" = source_seller_profile_id
       AND daily.date >= range_start
       AND (
         (p_end_exclusive AND daily.date < range_end)
         OR (NOT p_end_exclusive AND daily.date <= range_end)
       )
     GROUP BY bucket
  )
  SELECT listing_totals.views,
         listing_totals.clicks,
         profile_totals.views,
         CASE WHEN buckets.bucket IS NULL THEN NULL::bigint ELSE
           pg_catalog.floor(
             EXTRACT(EPOCH FROM (buckets.bucket AT TIME ZONE 'UTC')) * 1000
           )::bigint
         END,
         COALESCE(buckets.views, 0)::bigint,
         COALESCE(buckets.clicks, 0)::bigint
    FROM listing_totals
    CROSS JOIN profile_totals
    LEFT JOIN buckets ON true
   ORDER BY buckets.bucket ASC NULLS FIRST;
END
$grainline_seller_engagement_analytics$;

-- Delete only rows outside the fixed retention window. One call removes at
-- most p_batch_size rows from each table and reports whether another call may
-- be needed.
CREATE OR REPLACE FUNCTION public.grainline_seller_analytics_retention_prune(
  p_batch_size integer
)
RETURNS TABLE (
  listing_deleted integer,
  profile_deleted integer,
  listing_complete boolean,
  profile_complete boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_analytics_retention_prune$
DECLARE
  cutoff timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '730 days';
  removed_listing integer := 0;
  removed_profile integer := 0;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Seller analytics retention batch is invalid'
      USING ERRCODE = '22023';
  END IF;

  WITH doomed AS (
    SELECT daily.id
      FROM public."ListingViewDaily" AS daily
     WHERE daily.date < cutoff
     ORDER BY daily.date ASC, daily.id ASC
     LIMIT p_batch_size
     FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public."ListingViewDaily" AS daily
     USING doomed
     WHERE daily.id = doomed.id
     RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer INTO removed_listing FROM deleted;

  WITH doomed AS (
    SELECT daily.id
      FROM public."SellerProfileViewDaily" AS daily
     WHERE daily.date < cutoff
     ORDER BY daily.date ASC, daily.id ASC
     LIMIT p_batch_size
     FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public."SellerProfileViewDaily" AS daily
     USING doomed
     WHERE daily.id = doomed.id
     RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer INTO removed_profile FROM deleted;

  RETURN QUERY SELECT
    removed_listing,
    removed_profile,
    removed_listing < p_batch_size,
    removed_profile < p_batch_size;
END
$grainline_seller_analytics_retention_prune$;

-- Clear only the profile-view history of the exact account-deletion claim.
CREATE OR REPLACE FUNCTION
  public.grainline_seller_profile_view_daily_account_deletion_clear(
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
AS $grainline_seller_profile_view_daily_account_deletion_clear$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  source_seller_profile_id text;
  removed integer := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_side_effect_id IS NULL
     OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Seller profile-view deletion input is invalid'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id
     AND effect."userId" = request_user_id
     AND effect.kind = 'LOCAL_ANONYMIZE'
     AND effect."dedupKey" = 'account-delete:local:' || request_user_id
     AND effect.payload = '{}'::jsonb
     AND effect.status = 'PROCESSING'
     AND effect."claimGeneration" = p_claim_generation
     AND effect."claimToken" = p_claim_token
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller profile-view deletion source is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller.id
    INTO source_seller_profile_id
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = request_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  DELETE FROM public."SellerProfileViewDaily"
   WHERE "sellerProfileId" = source_seller_profile_id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$grainline_seller_profile_view_daily_account_deletion_clear$;

REVOKE ALL ON FUNCTION public.grainline_listing_analytics_record(text,text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_profile_view_record(text,date)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_engagement_analytics(
  bigint,bigint,boolean,text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_analytics_retention_prune(integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_seller_profile_view_daily_account_deletion_clear(
    text,bigint,uuid
  ) FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_listing_analytics_record(text,text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_profile_view_record(text,date)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_engagement_analytics(
  bigint,bigint,boolean,text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_analytics_retention_prune(integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_seller_profile_view_daily_account_deletion_clear(
    text,bigint,uuid
  ) TO grainline_app_runtime;

DO $grainline_seller_analytics_daily_postflight$
DECLARE
  function_oid oid;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ListingViewDaily" AS daily
     WHERE daily.views < 0
        OR daily.clicks < 0
        OR daily.views >= 2147483647
        OR daily.clicks >= 2147483647
        OR daily.date IS DISTINCT FROM pg_catalog.date_trunc('day', daily.date)
        OR NOT EXISTS (
          SELECT 1
            FROM public."Listing" AS listing
           WHERE listing.id = daily."listingId"
             AND listing."sellerId" = daily."sellerProfileId"
        )
  ) OR EXISTS (
    SELECT 1
      FROM public."SellerProfileViewDaily" AS daily
     WHERE daily.views < 0
        OR daily.views >= 2147483647
        OR daily.date IS DISTINCT FROM pg_catalog.date_trunc('day', daily.date)
  ) THEN
    RAISE EXCEPTION 'Seller analytics daily postflight inventory drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (
        VALUES
          ('public."ListingViewDaily"'::pg_catalog.regclass),
          ('public."SellerProfileViewDaily"'::pg_catalog.regclass)
      ) AS expected(table_oid)
      JOIN pg_catalog.pg_class AS relation ON relation.oid = expected.table_oid
     WHERE relation.relrowsecurity
        OR relation.relforcerowsecurity
        OR (SELECT pg_catalog.count(*)
              FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = relation.oid) <> 0
  ) THEN
    RAISE EXCEPTION 'Seller analytics daily RLS changed during compatible preparation';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (
        VALUES
          ('public."ListingViewDaily"'::pg_catalog.regclass),
          ('public."SellerProfileViewDaily"'::pg_catalog.regclass)
      ) AS expected(table_oid)
     WHERE NOT pg_catalog.has_table_privilege(
             'grainline_app_runtime', expected.table_oid, 'SELECT'
           )
        OR NOT pg_catalog.has_table_privilege(
             'grainline_app_runtime', expected.table_oid, 'INSERT'
           )
        OR NOT pg_catalog.has_table_privilege(
             'grainline_app_runtime', expected.table_oid, 'UPDATE'
           )
        OR NOT pg_catalog.has_table_privilege(
             'grainline_app_runtime', expected.table_oid, 'DELETE'
           )
  ) THEN
    RAISE EXCEPTION 'Seller analytics predecessor runtime CRUD drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (
        VALUES
          ('public."ListingViewDaily"'::pg_catalog.regclass,
           'ListingViewDaily_counts_non_negative_chk'::text),
          ('public."ListingViewDaily"'::pg_catalog.regclass,
           'ListingViewDaily_date_midnight_utc_chk'::text),
          ('public."SellerProfileViewDaily"'::pg_catalog.regclass,
           'SellerProfileViewDaily_views_non_negative_chk'::text),
          ('public."SellerProfileViewDaily"'::pg_catalog.regclass,
           'SellerProfileViewDaily_date_midnight_utc_chk'::text)
      ) AS expected(table_oid, constraint_name)
     WHERE NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_state
        WHERE constraint_state.conrelid = expected.table_oid
          AND constraint_state.conname = expected.constraint_name
          AND constraint_state.contype = 'c'
          AND constraint_state.convalidated
     )
  ) THEN
    RAISE EXCEPTION 'Seller analytics daily constraints are incomplete';
  END IF;

  FOR function_oid IN
    SELECT expected.signature::pg_catalog.regprocedure::oid
      FROM (
        VALUES
          ('public.grainline_listing_analytics_record(text,text)'),
          ('public.grainline_seller_profile_view_record(text,date)'),
          ('public.grainline_seller_engagement_analytics(bigint,bigint,boolean,text)'),
          ('public.grainline_seller_analytics_retention_prune(integer)'),
          ('public.grainline_seller_profile_view_daily_account_deletion_clear(text,bigint,uuid)')
      ) AS expected(signature)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
       WHERE procedure.oid = function_oid
         AND procedure.prosecdef
         AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND (owner.rolsuper OR owner.rolbypassrls)
         AND pg_catalog.has_function_privilege(
               'grainline_app_runtime', procedure.oid, 'EXECUTE'
             )
         AND NOT EXISTS (
           SELECT 1
             FROM pg_catalog.aclexplode(
                    COALESCE(
                      procedure.proacl,
                      pg_catalog.acldefault('f', procedure.proowner)
                    )
                  ) AS acl
            WHERE acl.grantee = 0
              AND acl.privilege_type = 'EXECUTE'
         )
    ) THEN
      RAISE EXCEPTION 'Seller analytics function envelope drifted: %',
        function_oid::pg_catalog.regprocedure;
    END IF;
  END LOOP;
END
$grainline_seller_analytics_daily_postflight$;

COMMIT;
