-- Fixed staff Guild projections over public badge state and private lifecycle
-- timestamps. Only the isolated staff database role can execute them, and each
-- call revalidates the authenticated application actor in the database.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_guild_staff_roster(
  p_actor_id text,
  p_cohort text
)
RETURNS TABLE (
  id text,
  "displayName" text,
  "guildMemberApprovedAt" timestamp(3) without time zone,
  "guildMasterApprovedAt" timestamp(3) without time zone,
  "featuredUntil" timestamp(3) without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_guild_staff_roster$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller Guild roster requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_cohort NOT IN ('GUILD_MEMBER', 'GUILD_MASTER', 'REVOKED_MEMBER') THEN
    RAISE EXCEPTION 'Seller Guild roster input is invalid'
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
    RAISE EXCEPTION 'Seller Guild roster actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."displayName"::text,
         seller_private."guildMemberApprovedAt",
         seller_private."guildMasterApprovedAt",
         seller."featuredUntil"
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE (p_cohort = 'GUILD_MEMBER'
          AND seller."guildLevel" = 'GUILD_MEMBER'::public."GuildLevel")
      OR (p_cohort = 'GUILD_MASTER'
          AND seller."guildLevel" = 'GUILD_MASTER'::public."GuildLevel")
      OR (p_cohort = 'REVOKED_MEMBER'
          AND seller."guildLevel" = 'NONE'::public."GuildLevel"
          AND seller_private."guildMemberApprovedAt" IS NOT NULL)
   ORDER BY
     CASE p_cohort
       WHEN 'GUILD_MASTER' THEN seller_private."guildMasterApprovedAt"
       ELSE seller_private."guildMemberApprovedAt"
     END DESC NULLS LAST,
     seller.id ASC
   LIMIT 50;
END
$grainline_seller_guild_staff_roster$;

CREATE OR REPLACE FUNCTION public.grainline_seller_guild_staff_master_pending(
  p_actor_id text
)
RETURNS TABLE (
  id text,
  "craftDescription" text,
  "guildMasterCraftBusiness" text,
  "yearsExperience" integer,
  "portfolioUrl" text,
  "appliedAt" timestamp(3) without time zone,
  "sellerProfileId" text,
  "sellerDisplayName" text,
  "guildMasterAppliedAt" timestamp(3) without time zone,
  "metricsCalculatedAt" timestamp(3) without time zone,
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
AS $grainline_seller_guild_staff_master_pending$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller Guild review queue requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller Guild review queue input is invalid'
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
    RAISE EXCEPTION 'Seller Guild review queue actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT verification.id,
         verification."craftDescription"::text,
         verification."guildMasterCraftBusiness"::text,
         verification."yearsExperience",
         verification."portfolioUrl"::text,
         verification."appliedAt",
         seller.id,
         seller."displayName"::text,
         seller_private."guildMasterAppliedAt",
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
    FROM public."MakerVerification" AS verification
    JOIN public."SellerProfile" AS seller
      ON seller.id = verification."sellerProfileId"
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
    LEFT JOIN public."SellerMetrics" AS metrics
      ON metrics."sellerProfileId" = seller.id
   WHERE verification.status = 'GUILD_MASTER_PENDING'::public."VerificationStatus"
   ORDER BY verification."appliedAt" ASC, verification.id ASC
   LIMIT 50;
END
$grainline_seller_guild_staff_master_pending$;

REVOKE ALL ON FUNCTION public.grainline_seller_guild_staff_roster(text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_guild_staff_master_pending(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_guild_staff_roster(text, text)
  TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_guild_staff_master_pending(text)
  TO grainline_staff_read_runtime;

COMMIT;
