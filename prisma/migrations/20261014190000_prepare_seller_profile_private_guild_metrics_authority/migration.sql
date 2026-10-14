-- Derive Guild metrics transitions from the exact persisted metrics snapshot.
-- The caller supplies identity plus the calculation token; it cannot select
-- warning, recovery or revocation state, timestamps, verification status or
-- audit contents.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_guild_metrics_apply(
  p_seller_profile_id text,
  p_calculated_at timestamp(3) without time zone
)
RETURNS TABLE (
  action text,
  "auditId" text,
  "warningSentAt" timestamp(3) without time zone,
  "sellerUserId" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_guild_metrics_apply$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  source_seller public."SellerProfile"%ROWTYPE;
  source_private public."SellerProfilePrivate"%ROWTYPE;
  source_metrics public."SellerMetrics"%ROWTYPE;
  metrics_all_met boolean;
  transition_action text;
  transition_audit_id text;
  transition_warning_at timestamp(3) without time zone;
  verification_changed integer;
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_calculated_at IS NULL THEN
    RAISE EXCEPTION 'Seller Guild metrics-apply input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.*
    INTO source_seller
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT seller_private.*
    INTO source_private
    FROM public."SellerProfilePrivate" AS seller_private
   WHERE seller_private."sellerProfileId" = source_seller.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller Guild private state is missing'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT metrics.*
    INTO source_metrics
    FROM public."SellerMetrics" AS metrics
   WHERE metrics."sellerProfileId" = source_seller.id
     AND metrics."calculatedAt" = p_calculated_at
     AND metrics."periodMonths" = 3
     AND metrics."calculatedAt" >= source_now - INTERVAL '10 minutes'
     AND metrics."calculatedAt" <= source_now + INTERVAL '1 minute'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller Guild metrics snapshot is absent, stale or replaced'
      USING ERRCODE = '22023';
  END IF;

  IF source_metrics."averageRating" < 0
     OR source_metrics."averageRating" > 5
     OR source_metrics."averageRating" = 'NaN'::double precision
     OR source_metrics."reviewCount" < 0
     OR source_metrics."onTimeShippingRate" < 0
     OR source_metrics."onTimeShippingRate" > 1
     OR source_metrics."onTimeShippingRate" = 'NaN'::double precision
     OR source_metrics."responseRate" < 0
     OR source_metrics."responseRate" > 1
     OR source_metrics."responseRate" = 'NaN'::double precision
     OR source_metrics."totalSalesCents" < 0
     OR source_metrics."completedOrderCount" < 0
     OR source_metrics."activeCaseCount" < 0
     OR source_metrics."accountAgeDays" < 0 THEN
    RAISE EXCEPTION 'Seller Guild metrics snapshot is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF source_seller."guildLevel" = 'GUILD_MEMBER'::public."GuildLevel" THEN
    UPDATE public."SellerProfilePrivate"
       SET "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE "sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE id = source_seller.id;

    RETURN QUERY
    SELECT 'MEMBER_CHECKED'::text, NULL::text,
           source_private."metricWarningSentAt", source_seller."userId";
    RETURN;
  END IF;

  IF source_seller."guildLevel" <> 'GUILD_MASTER'::public."GuildLevel" THEN
    RETURN QUERY
    SELECT 'NOOP'::text, NULL::text,
           source_private."metricWarningSentAt", source_seller."userId";
    RETURN;
  END IF;

  metrics_all_met :=
    source_metrics."averageRating" >= 4.5
    AND source_metrics."reviewCount" >= 25
    AND source_metrics."onTimeShippingRate" >= 0.95
    AND source_metrics."responseRate" >= 0.90
    AND source_metrics."accountAgeDays" >= 180
    AND source_metrics."totalSalesCents" >= 100000
    AND source_metrics."activeCaseCount" <= 0;

  IF metrics_all_met THEN
    transition_action := CASE
      WHEN source_private."consecutiveMetricFailures" > 0
        OR source_private."metricWarningSentAt" IS NOT NULL
      THEN 'MASTER_RECOVERED'
      ELSE 'MASTER_OK'
    END;

    UPDATE public."SellerProfilePrivate"
       SET "consecutiveMetricFailures" = 0,
           "metricWarningSentAt" = NULL,
           "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE "sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "consecutiveMetricFailures" = 0,
           "metricWarningSentAt" = NULL,
           "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE id = source_seller.id;

    RETURN QUERY
    SELECT transition_action, NULL::text, NULL::timestamp(3),
           source_seller."userId";
    RETURN;
  END IF;

  IF source_private."consecutiveMetricFailures" <= 0 THEN
    transition_warning_at := source_now;
    transition_audit_id :=
      'guild-metrics-warning:' || pg_catalog.gen_random_uuid()::text;

    UPDATE public."SellerProfilePrivate"
       SET "consecutiveMetricFailures" = 1,
           "metricWarningSentAt" = transition_warning_at,
           "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE "sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "consecutiveMetricFailures" = 1,
           "metricWarningSentAt" = transition_warning_at,
           "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE id = source_seller.id;

    INSERT INTO public."SystemAuditLog" (
      id, "actorType", "actorId", action, "targetType", "targetId",
      reason, metadata, "createdAt"
    ) VALUES (
      transition_audit_id,
      'cron',
      'guild-metrics',
      'WARN_GUILD_MASTER_METRICS',
      'SELLER_PROFILE',
      source_seller.id,
      'Guild Master metrics fell below requirements.',
      pg_catalog.jsonb_build_object(
        'jobName', 'guild-metrics',
        'sellerUserId', source_seller."userId",
        'warningSentAt', transition_warning_at,
        'metricsCalculatedAt', source_metrics."calculatedAt"
      ),
      source_now
    );

    RETURN QUERY
    SELECT 'MASTER_WARNED'::text, transition_audit_id,
           transition_warning_at, source_seller."userId";
    RETURN;
  END IF;

  transition_warning_at := COALESCE(
    source_private."metricWarningSentAt",
    source_now
  );

  IF transition_warning_at > source_now - INTERVAL '30 days' THEN
    UPDATE public."SellerProfilePrivate"
       SET "metricWarningSentAt" = transition_warning_at,
           "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE "sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "metricWarningSentAt" = transition_warning_at,
           "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE id = source_seller.id;

    RETURN QUERY
    SELECT 'MASTER_CONTINUED'::text, NULL::text,
           transition_warning_at, source_seller."userId";
    RETURN;
  END IF;

  UPDATE public."MakerVerification"
     SET status = 'GUILD_MASTER_REJECTED'::public."VerificationStatus",
         "reviewedAt" = source_now,
         "reviewNotes" =
           'Metrics fell below requirements for two consecutive months.',
         "updatedAt" = source_now
   WHERE "sellerProfileId" = source_seller.id
     AND status = 'GUILD_MASTER_APPROVED'::public."VerificationStatus";
  GET DIAGNOSTICS verification_changed = ROW_COUNT;

  IF verification_changed = 0 THEN
    RETURN QUERY
    SELECT 'NOOP'::text, NULL::text,
           transition_warning_at, source_seller."userId";
    RETURN;
  END IF;

  UPDATE public."SellerProfilePrivate"
     SET "consecutiveMetricFailures" = 0,
         "metricWarningSentAt" = NULL,
         "lastMetricCheckAt" = source_now,
         "guildMasterApprovedAt" = NULL,
         "guildMasterAppliedAt" = NULL,
         "guildMasterReviewNotes" = NULL,
         "updatedAt" = source_now
   WHERE "sellerProfileId" = source_seller.id;
  UPDATE public."SellerProfile"
     SET "guildLevel" = 'GUILD_MEMBER'::public."GuildLevel",
         "isVerifiedMaker" = true,
         "consecutiveMetricFailures" = 0,
         "metricWarningSentAt" = NULL,
         "lastMetricCheckAt" = source_now,
         "guildMasterApprovedAt" = NULL,
         "guildMasterAppliedAt" = NULL,
         "guildMasterReviewNotes" = NULL,
         "updatedAt" = source_now
   WHERE id = source_seller.id;

  transition_audit_id :=
    'guild-metrics-revocation:' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."SystemAuditLog" (
    id, "actorType", "actorId", action, "targetType", "targetId",
    reason, metadata, "createdAt"
  ) VALUES (
    transition_audit_id,
    'cron',
    'guild-metrics',
    'AUTO_REVOKE_GUILD_MASTER',
    'SELLER_PROFILE',
    source_seller.id,
    'Metrics fell below requirements for two consecutive months.',
    pg_catalog.jsonb_build_object(
      'jobName', 'guild-metrics',
      'sellerUserId', source_seller."userId",
      'warningSentAt', transition_warning_at,
      'metricsCalculatedAt', source_metrics."calculatedAt"
    ),
    source_now
  );

  RETURN QUERY
  SELECT 'MASTER_REVOKED'::text, transition_audit_id,
         transition_warning_at, source_seller."userId";
END
$grainline_seller_guild_metrics_apply$;

REVOKE ALL ON FUNCTION public.grainline_seller_guild_metrics_apply(
  text, timestamp without time zone
) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_guild_metrics_apply(
  text, timestamp without time zone
) TO grainline_app_runtime;

COMMIT;
