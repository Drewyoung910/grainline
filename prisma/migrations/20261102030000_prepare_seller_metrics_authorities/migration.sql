-- Compatible SellerMetrics preparation. This migration adds database-derived,
-- purpose-bound operations and validated invariants while leaving RLS off and
-- retaining predecessor runtime CRUD for deployment compatibility.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $grainline_seller_metrics_preflight$
DECLARE
  invalid_rows bigint;
BEGIN
  IF pg_catalog.to_regclass('public."SellerMetrics"') IS NULL THEN
    RAISE EXCEPTION 'SellerMetrics table is absent';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."SellerMetrics"'::pg_catalog.regclass
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."SellerMetrics"'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION 'SellerMetrics compatible preparation requires predecessor RLS posture';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SellerMetrics"', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SellerMetrics"', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SellerMetrics"', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SellerMetrics"', 'DELETE'
     ) THEN
    RAISE EXCEPTION 'SellerMetrics predecessor runtime CRUD drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = 'public."SellerMetrics"'::pg_catalog.regclass
       AND constraint_row.conname IN (
         'SellerMetrics_period_months_chk',
         'SellerMetrics_average_rating_chk',
         'SellerMetrics_review_count_chk',
         'SellerMetrics_on_time_shipping_rate_chk',
         'SellerMetrics_response_rate_chk',
         'SellerMetrics_total_sales_cents_chk',
         'SellerMetrics_completed_order_count_chk',
         'SellerMetrics_active_case_count_chk',
         'SellerMetrics_account_age_days_chk'
       )
  ) THEN
    RAISE EXCEPTION 'SellerMetrics compatible constraints already exist';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.grainline_seller_metrics_refresh_prepared_impl(text,integer,boolean,text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_metrics_owner_state(integer,boolean)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_metrics_guild_refresh(text,integer)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_metrics_account_deletion_clear(text,bigint,uuid)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_metrics_inactive_owner_cleanup()'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'SellerMetrics prepared function catalog already exists';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public."SellerProfile"'::pg_catalog.regclass
       AND trigger_row.tgname = 'grainline_seller_metrics_inactive_owner_cleanup'
       AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'SellerMetrics inactive-owner cleanup trigger already exists';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.grainline_order_seller_metrics_facts(text,bigint)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_case_seller_active_count(text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_message_response_metrics(text,timestamp without time zone)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_service_metrics_identity(text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'SellerMetrics source authority catalog is incomplete';
  END IF;

  SELECT pg_catalog.count(*)
    INTO invalid_rows
    FROM public."SellerMetrics" AS metrics
   WHERE metrics."periodMonths" NOT BETWEEN 1 AND 12
      OR metrics."averageRating" < 0
      OR metrics."averageRating" > 5
      OR metrics."reviewCount" < 0
      OR metrics."onTimeShippingRate" < 0
      OR metrics."onTimeShippingRate" > 1
      OR metrics."responseRate" < 0
      OR metrics."responseRate" > 1
      OR metrics."totalSalesCents" < 0
      OR metrics."completedOrderCount" < 0
      OR metrics."activeCaseCount" < 0
      OR metrics."accountAgeDays" < 0;
  IF invalid_rows <> 0 THEN
    RAISE EXCEPTION 'SellerMetrics contains invalid predecessor rows: %', invalid_rows;
  END IF;
END
$grainline_seller_metrics_preflight$;

ALTER TABLE public."SellerMetrics"
  ADD CONSTRAINT "SellerMetrics_period_months_chk"
    CHECK ("periodMonths" BETWEEN 1 AND 12) NOT VALID,
  ADD CONSTRAINT "SellerMetrics_average_rating_chk"
    CHECK ("averageRating" >= 0 AND "averageRating" <= 5) NOT VALID,
  ADD CONSTRAINT "SellerMetrics_review_count_chk"
    CHECK ("reviewCount" >= 0) NOT VALID,
  ADD CONSTRAINT "SellerMetrics_on_time_shipping_rate_chk"
    CHECK ("onTimeShippingRate" >= 0 AND "onTimeShippingRate" <= 1) NOT VALID,
  ADD CONSTRAINT "SellerMetrics_response_rate_chk"
    CHECK ("responseRate" >= 0 AND "responseRate" <= 1) NOT VALID,
  ADD CONSTRAINT "SellerMetrics_total_sales_cents_chk"
    CHECK ("totalSalesCents" >= 0) NOT VALID,
  ADD CONSTRAINT "SellerMetrics_completed_order_count_chk"
    CHECK ("completedOrderCount" >= 0) NOT VALID,
  ADD CONSTRAINT "SellerMetrics_active_case_count_chk"
    CHECK ("activeCaseCount" >= 0) NOT VALID,
  ADD CONSTRAINT "SellerMetrics_account_age_days_chk"
    CHECK ("accountAgeDays" >= 0) NOT VALID;

ALTER TABLE public."SellerMetrics"
  VALIDATE CONSTRAINT "SellerMetrics_period_months_chk";
ALTER TABLE public."SellerMetrics"
  VALIDATE CONSTRAINT "SellerMetrics_average_rating_chk";
ALTER TABLE public."SellerMetrics"
  VALIDATE CONSTRAINT "SellerMetrics_review_count_chk";
ALTER TABLE public."SellerMetrics"
  VALIDATE CONSTRAINT "SellerMetrics_on_time_shipping_rate_chk";
ALTER TABLE public."SellerMetrics"
  VALIDATE CONSTRAINT "SellerMetrics_response_rate_chk";
ALTER TABLE public."SellerMetrics"
  VALIDATE CONSTRAINT "SellerMetrics_total_sales_cents_chk";
ALTER TABLE public."SellerMetrics"
  VALIDATE CONSTRAINT "SellerMetrics_completed_order_count_chk";
ALTER TABLE public."SellerMetrics"
  VALIDATE CONSTRAINT "SellerMetrics_active_case_count_chk";
ALTER TABLE public."SellerMetrics"
  VALIDATE CONSTRAINT "SellerMetrics_account_age_days_chk";

CREATE FUNCTION public.grainline_seller_metrics_refresh_prepared_impl(
  p_seller_profile_id text,
  p_period_months integer,
  p_reuse_fresh boolean,
  p_authority text
)
RETURNS TABLE (
  "sellerProfileId" text,
  "calculatedAt" timestamp(3) without time zone,
  "periodMonths" integer,
  "averageRating" double precision,
  "reviewCount" integer,
  "onTimeShippingRate" double precision,
  "responseRate" double precision,
  "totalSalesCents" bigint,
  "completedOrderCount" integer,
  "activeCaseCount" integer,
  "accountAgeDays" integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_metrics_refresh_prepared_impl$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  database_now timestamp(3) without time zone := (
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone;
  period_start timestamp(3) without time zone;
  source_seller_user_id text;
  source_created_at_millis bigint;
  source_created_at timestamp(3) without time zone;
  source_review_count bigint;
  source_average_rating double precision;
  source_completed_order_count bigint;
  source_total_sales_cents bigint;
  source_shipped_count bigint;
  source_on_time_count bigint;
  source_active_case_count bigint;
  source_buyer_initiated_count bigint;
  source_seller_responded_count bigint;
  source_account_age_days bigint;
  result_id text;
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_period_months IS NULL
     OR p_period_months NOT BETWEEN 1 AND 12
     OR p_reuse_fresh IS NULL
     OR p_authority IS NULL
     OR p_authority NOT IN ('OWNER', 'GUILD_SERVICE') THEN
    RAISE EXCEPTION 'Seller metrics refresh input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    913344,
    pg_catalog.hashtext(p_seller_profile_id)
  );

  IF p_authority = 'OWNER' THEN
    IF request_user_id IS NULL
       OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
       OR NOT EXISTS (
         SELECT 1
           FROM public."SellerProfile" AS seller
           JOIN public."User" AS actor
             ON actor.id = seller."userId"
          WHERE seller.id = p_seller_profile_id
            AND seller."userId" = request_user_id
            AND seller."ownerAccountActive" = true
            AND actor.banned = false
            AND actor."deletedAt" IS NULL
       ) THEN
      RAISE EXCEPTION 'Seller metrics owner source is not authorized'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
      FROM public."SellerProfile" AS seller
     WHERE seller.id = p_seller_profile_id
       AND seller."ownerAccountActive" = true
       AND seller."guildLevel" IN (
         'GUILD_MEMBER'::public."GuildLevel",
         'GUILD_MASTER'::public."GuildLevel"
       )
       AND seller."vacationMode" = false
  ) THEN
    RAISE EXCEPTION 'Seller metrics Guild source is not authorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_reuse_fresh THEN
    RETURN QUERY
    SELECT metrics."sellerProfileId",
           metrics."calculatedAt",
           metrics."periodMonths",
           metrics."averageRating",
           metrics."reviewCount",
           metrics."onTimeShippingRate",
           metrics."responseRate",
           metrics."totalSalesCents",
           metrics."completedOrderCount",
           metrics."activeCaseCount",
           metrics."accountAgeDays"
      FROM public."SellerMetrics" AS metrics
     WHERE metrics."sellerProfileId" = p_seller_profile_id
       AND metrics."periodMonths" = p_period_months
       AND metrics."calculatedAt" >= database_now - INTERVAL '7 days'
       AND metrics."calculatedAt" <= database_now + INTERVAL '5 minutes';
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  SELECT identity_row."sellerUserId",
         identity_row."createdAtEpochMillis"
    INTO source_seller_user_id,
         source_created_at_millis
    FROM public.grainline_seller_service_metrics_identity(
      p_seller_profile_id
    ) AS identity_row;
  IF NOT FOUND
     OR source_seller_user_id IS NULL
     OR source_created_at_millis IS NULL
     OR source_created_at_millis NOT BETWEEN 0 AND 253402300799999 THEN
    RAISE EXCEPTION 'Seller metrics identity source is unavailable'
      USING ERRCODE = '42501';
  END IF;

  source_created_at := (
    pg_catalog.to_timestamp(source_created_at_millis::double precision / 1000.0)
      AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone;
  IF source_created_at > database_now + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'Seller metrics account clock is invalid'
      USING ERRCODE = '23514';
  END IF;

  period_start := (
    database_now - pg_catalog.make_interval(days => p_period_months * 30)
  )::timestamp(3) without time zone;

  SELECT pg_catalog.count(*)::bigint,
         COALESCE(
           pg_catalog.avg(review."ratingX2")::double precision / 2.0,
           0::double precision
         )
    INTO source_review_count,
         source_average_rating
    FROM public."Review" AS review
    JOIN public."Listing" AS listing
      ON listing.id = review."listingId"
   WHERE listing."sellerId" = p_seller_profile_id;

  SELECT facts.completed_order_count,
         facts.total_sales_cents,
         facts.shipped_count,
         facts.on_time_count
    INTO source_completed_order_count,
         source_total_sales_cents,
         source_shipped_count,
         source_on_time_count
    FROM public.grainline_order_seller_metrics_facts(
      p_seller_profile_id,
      pg_catalog.floor(
        EXTRACT(EPOCH FROM period_start) * 1000
      )::bigint
    ) AS facts;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller metrics Order source is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT active."activeCount"
    INTO source_active_case_count
    FROM public.grainline_case_seller_active_count(
      p_seller_profile_id
    ) AS active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller metrics Case source is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT response."buyerInitiatedCount",
         response."sellerRespondedCount"
    INTO source_buyer_initiated_count,
         source_seller_responded_count
    FROM public.grainline_seller_message_response_metrics(
      source_seller_user_id,
      period_start
    ) AS response;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller metrics response source is unavailable'
      USING ERRCODE = '42501';
  END IF;

  source_account_age_days := GREATEST(
    0::numeric,
    pg_catalog.floor(
      EXTRACT(EPOCH FROM (database_now - source_created_at)) / 86400
    )
  )::bigint;

  IF source_review_count NOT BETWEEN 0 AND 2147483647
     OR source_average_rating < 0
     OR source_average_rating > 5
     OR source_completed_order_count NOT BETWEEN 0 AND 2147483647
     OR source_total_sales_cents NOT BETWEEN 0 AND 9007199254740991
     OR source_shipped_count < 0
     OR source_on_time_count < 0
     OR source_on_time_count > source_shipped_count
     OR source_active_case_count NOT BETWEEN 0 AND 2147483647
     OR source_buyer_initiated_count < 0
     OR source_seller_responded_count < 0
     OR source_seller_responded_count > source_buyer_initiated_count
     OR source_account_age_days NOT BETWEEN 0 AND 2147483647 THEN
    RAISE EXCEPTION 'Seller metrics source result is outside the supported range'
      USING ERRCODE = '22003';
  END IF;

  SELECT metrics.id
    INTO result_id
    FROM public."SellerMetrics" AS metrics
   WHERE metrics."sellerProfileId" = p_seller_profile_id;

  IF result_id IS NULL THEN
    result_id := 'sm_' || pg_catalog.replace(
      pg_catalog.gen_random_uuid()::text,
      '-',
      ''
    );
    INSERT INTO public."SellerMetrics" (
      id,
      "sellerProfileId",
      "calculatedAt",
      "periodMonths",
      "averageRating",
      "reviewCount",
      "onTimeShippingRate",
      "responseRate",
      "totalSalesCents",
      "completedOrderCount",
      "activeCaseCount",
      "accountAgeDays"
    ) VALUES (
      result_id,
      p_seller_profile_id,
      database_now,
      p_period_months,
      source_average_rating,
      source_review_count::integer,
      CASE
        WHEN source_shipped_count = 0 THEN 0::double precision
        ELSE source_on_time_count::double precision
          / source_shipped_count::double precision
      END,
      CASE
        WHEN source_buyer_initiated_count = 0 THEN 0::double precision
        ELSE source_seller_responded_count::double precision
          / source_buyer_initiated_count::double precision
      END,
      source_total_sales_cents,
      source_completed_order_count::integer,
      source_active_case_count::integer,
      source_account_age_days::integer
    );
  ELSE
    UPDATE public."SellerMetrics" AS metrics
       SET "calculatedAt" = database_now,
           "periodMonths" = p_period_months,
           "averageRating" = source_average_rating,
           "reviewCount" = source_review_count::integer,
           "onTimeShippingRate" = CASE
             WHEN source_shipped_count = 0 THEN 0::double precision
             ELSE source_on_time_count::double precision
               / source_shipped_count::double precision
           END,
           "responseRate" = CASE
             WHEN source_buyer_initiated_count = 0 THEN 0::double precision
             ELSE source_seller_responded_count::double precision
               / source_buyer_initiated_count::double precision
           END,
           "totalSalesCents" = source_total_sales_cents,
           "completedOrderCount" = source_completed_order_count::integer,
           "activeCaseCount" = source_active_case_count::integer,
           "accountAgeDays" = source_account_age_days::integer
     WHERE metrics.id = result_id
       AND metrics."sellerProfileId" = p_seller_profile_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Seller metrics cache row changed during refresh'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  RETURN QUERY
  SELECT metrics."sellerProfileId",
         metrics."calculatedAt",
         metrics."periodMonths",
         metrics."averageRating",
         metrics."reviewCount",
         metrics."onTimeShippingRate",
         metrics."responseRate",
         metrics."totalSalesCents",
         metrics."completedOrderCount",
         metrics."activeCaseCount",
         metrics."accountAgeDays"
    FROM public."SellerMetrics" AS metrics
   WHERE metrics."sellerProfileId" = p_seller_profile_id;
END
$grainline_seller_metrics_refresh_prepared_impl$;

CREATE FUNCTION public.grainline_seller_metrics_owner_state(
  p_period_months integer,
  p_force_refresh boolean
)
RETURNS TABLE (
  "sellerProfileId" text,
  "calculatedAt" timestamp(3) without time zone,
  "periodMonths" integer,
  "averageRating" double precision,
  "reviewCount" integer,
  "onTimeShippingRate" double precision,
  "responseRate" double precision,
  "totalSalesCents" bigint,
  "completedOrderCount" integer,
  "activeCaseCount" integer,
  "accountAgeDays" integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_metrics_owner_state$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  source_seller_profile_id text;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_period_months IS NULL
     OR p_period_months NOT BETWEEN 1 AND 12
     OR p_force_refresh IS NULL THEN
    RAISE EXCEPTION 'Seller metrics owner input is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller.id
    INTO source_seller_profile_id
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = request_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller metrics owner source is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT *
    FROM public.grainline_seller_metrics_refresh_prepared_impl(
      source_seller_profile_id,
      p_period_months,
      NOT p_force_refresh,
      'OWNER'
    );
END
$grainline_seller_metrics_owner_state$;

CREATE FUNCTION public.grainline_seller_metrics_account_deletion_clear(
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
AS $grainline_seller_metrics_account_deletion_clear$
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
    RAISE EXCEPTION 'Seller metrics deletion input is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller.id
    INTO source_seller_profile_id
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = request_user_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    913344,
    pg_catalog.hashtext(source_seller_profile_id)
  );

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
    RAISE EXCEPTION 'Seller metrics deletion source is not authorized'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."SellerMetrics"
   WHERE "sellerProfileId" = source_seller_profile_id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$grainline_seller_metrics_account_deletion_clear$;

CREATE FUNCTION public.grainline_seller_metrics_inactive_owner_cleanup()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_metrics_inactive_owner_cleanup$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    913344,
    pg_catalog.hashtext(NEW.id)
  );

  DELETE FROM public."SellerMetrics"
   WHERE "sellerProfileId" = NEW.id;

  RETURN NULL;
END
$grainline_seller_metrics_inactive_owner_cleanup$;

CREATE TRIGGER grainline_seller_metrics_inactive_owner_cleanup
AFTER UPDATE OF "ownerAccountActive"
ON public."SellerProfile"
FOR EACH ROW
WHEN (
  OLD."ownerAccountActive" = true
  AND NEW."ownerAccountActive" = false
)
EXECUTE FUNCTION public.grainline_seller_metrics_inactive_owner_cleanup();

REVOKE ALL ON FUNCTION public.grainline_seller_metrics_refresh_prepared_impl(
  text, integer, boolean, text
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_metrics_owner_state(
  integer, boolean
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_metrics_account_deletion_clear(
  text, bigint, uuid
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_metrics_inactive_owner_cleanup()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_seller_metrics_owner_state(
  integer, boolean
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_metrics_account_deletion_clear(
  text, bigint, uuid
) TO grainline_app_runtime;

DO $grainline_seller_metrics_postflight$
DECLARE
  unexpected_count bigint;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."SellerMetrics"'::pg_catalog.regclass
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."SellerMetrics"'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION 'SellerMetrics compatible preparation changed RLS state';
  END IF;

  SELECT pg_catalog.count(*)
    INTO unexpected_count
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid = 'public."SellerMetrics"'::pg_catalog.regclass
     AND constraint_row.conname IN (
       'SellerMetrics_period_months_chk',
       'SellerMetrics_average_rating_chk',
       'SellerMetrics_review_count_chk',
       'SellerMetrics_on_time_shipping_rate_chk',
       'SellerMetrics_response_rate_chk',
       'SellerMetrics_total_sales_cents_chk',
       'SellerMetrics_completed_order_count_chk',
       'SellerMetrics_active_case_count_chk',
       'SellerMetrics_account_age_days_chk'
     )
     AND constraint_row.convalidated;
  IF unexpected_count <> 9 THEN
    RAISE EXCEPTION 'SellerMetrics validated constraint catalog drifted: %', unexpected_count;
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SellerMetrics"', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SellerMetrics"', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SellerMetrics"', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SellerMetrics"', 'DELETE'
     ) THEN
    RAISE EXCEPTION 'SellerMetrics compatible preparation changed predecessor CRUD';
  END IF;

  SELECT pg_catalog.count(*)
    INTO unexpected_count
    FROM (
      VALUES
        ('public.grainline_seller_metrics_refresh_prepared_impl(text,integer,boolean,text)'::pg_catalog.regprocedure, false),
        ('public.grainline_seller_metrics_owner_state(integer,boolean)'::pg_catalog.regprocedure, true),
        ('public.grainline_seller_metrics_account_deletion_clear(text,bigint,uuid)'::pg_catalog.regprocedure, true),
        ('public.grainline_seller_metrics_inactive_owner_cleanup()'::pg_catalog.regprocedure, false)
    ) AS expected(function_oid, runtime_execute)
    JOIN pg_catalog.pg_proc AS function_row
      ON function_row.oid = expected.function_oid
    JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.oid = function_row.proowner
   WHERE function_row.prosecdef
     AND function_row.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND owner_role.rolname = CURRENT_USER
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             function_row.proacl,
             pg_catalog.acldefault('f', function_row.proowner)
           )
         ) AS function_acl
        WHERE function_acl.grantee = 0
          AND function_acl.privilege_type = 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime', function_row.oid, 'EXECUTE'
     )
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', function_row.oid, 'EXECUTE'
     ) = expected.runtime_execute;
  IF unexpected_count <> 4 THEN
    RAISE EXCEPTION 'SellerMetrics prepared function posture drifted: %', unexpected_count;
  END IF;

  SELECT pg_catalog.count(*)
    INTO unexpected_count
    FROM pg_catalog.pg_trigger AS trigger_row
   WHERE trigger_row.tgrelid = 'public."SellerProfile"'::pg_catalog.regclass
     AND trigger_row.tgname = 'grainline_seller_metrics_inactive_owner_cleanup'
     AND trigger_row.tgfoid =
       'public.grainline_seller_metrics_inactive_owner_cleanup()'::pg_catalog.regprocedure
     AND trigger_row.tgenabled = 'O'
     AND trigger_row.tgtype = 17
     AND NOT trigger_row.tgisinternal;
  IF unexpected_count <> 1 THEN
    RAISE EXCEPTION 'SellerMetrics inactive-owner cleanup trigger drifted';
  END IF;
END
$grainline_seller_metrics_postflight$;

COMMIT;
