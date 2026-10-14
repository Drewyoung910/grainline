-- Bounded Guild cron batch projections from SellerProfilePrivate.
-- Public seller eligibility remains on SellerProfile; operational Guild
-- timestamps and counters come only from the private companion.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_guild_member_cron_batch(
  p_cursor_id text,
  p_page_size integer
)
RETURNS TABLE (
  id text,
  "userId" text,
  "guildLevel" text,
  "listingsBelowThresholdSince" timestamp(3) without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_guild_member_cron_batch$
BEGIN
  IF (p_cursor_id IS NOT NULL
        AND p_cursor_id !~ '^[A-Za-z0-9._:-]{1,191}$')
     OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Seller Guild Member cron-batch input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."userId",
         seller."guildLevel"::text,
         seller_private."listingsBelowThresholdSince"
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller."guildLevel" = 'GUILD_MEMBER'
     AND seller."vacationMode" = false
     AND (p_cursor_id IS NULL OR seller.id > p_cursor_id)
   ORDER BY seller.id ASC
   LIMIT p_page_size;
END
$grainline_seller_guild_member_cron_batch$;

CREATE OR REPLACE FUNCTION public.grainline_seller_guild_metrics_cron_batch(
  p_cursor_id text,
  p_page_size integer
)
RETURNS TABLE (
  id text,
  "userId" text,
  "guildLevel" text,
  "consecutiveMetricFailures" integer,
  "metricWarningSentAt" timestamp(3) without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_guild_metrics_cron_batch$
BEGIN
  IF (p_cursor_id IS NOT NULL
        AND p_cursor_id !~ '^[A-Za-z0-9._:-]{1,191}$')
     OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Seller Guild metrics cron-batch input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."userId",
         seller."guildLevel"::text,
         seller_private."consecutiveMetricFailures",
         seller_private."metricWarningSentAt"
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller."guildLevel" IN ('GUILD_MEMBER', 'GUILD_MASTER')
     AND seller."vacationMode" = false
     AND (p_cursor_id IS NULL OR seller.id > p_cursor_id)
   ORDER BY seller.id ASC
   LIMIT p_page_size;
END
$grainline_seller_guild_metrics_cron_batch$;

REVOKE ALL ON FUNCTION public.grainline_seller_guild_member_cron_batch(text, integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_guild_metrics_cron_batch(text, integer)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_seller_guild_member_cron_batch(text, integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_guild_metrics_cron_batch(text, integer)
  TO grainline_app_runtime;

COMMIT;
