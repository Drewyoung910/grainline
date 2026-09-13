-- Compatible purpose-bound Case aggregates for seller metrics, Guild Member
-- eligibility and Guild revocation/reinstatement. These functions add no
-- policy, table grant, row mutation or RLS state change. Old direct Case reads
-- and the new fixed aggregates can coexist until the application conversion.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_case_seller_active_count(
  p_seller_profile_id text
)
RETURNS TABLE (
  "activeCount" bigint
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_seller_active_count$
DECLARE
  target_seller_user_id text;
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Case seller active-count input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller."userId"
    INTO target_seller_user_id
    FROM public."SellerProfile" AS seller
    INNER JOIN public."User" AS seller_user
      ON seller_user.id = seller."userId"
   WHERE seller.id = p_seller_profile_id
     AND seller_user.banned = false
     AND seller_user."deletedAt" IS NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT pg_catalog.count(*)::bigint
    FROM public."Case" AS case_row
   WHERE case_row."sellerId" = target_seller_user_id
     AND case_row.status IN (
       'OPEN'::public."CaseStatus",
       'IN_DISCUSSION'::public."CaseStatus",
       'PENDING_CLOSE'::public."CaseStatus",
       'UNDER_REVIEW'::public."CaseStatus"
     );
END
$grainline_case_seller_active_count$;

CREATE OR REPLACE FUNCTION public.grainline_case_seller_verification_eligibility(
  p_actor_user_id text,
  p_seller_profile_id text
)
RETURNS TABLE (
  "agedUnresolvedCount" bigint
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_seller_verification_eligibility$
DECLARE
  target_seller_user_id text;
  fixed_cutoff timestamp(3) without time zone;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Case seller verification input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller."userId"
    INTO target_seller_user_id
    FROM public."SellerProfile" AS seller
    INNER JOIN public."User" AS seller_user
      ON seller_user.id = seller."userId"
    INNER JOIN public."User" AS actor
      ON actor.id = p_actor_user_id
   WHERE seller.id = p_seller_profile_id
     AND seller_user.banned = false
     AND seller_user."deletedAt" IS NULL
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND (
       actor.id = seller."userId"
       OR actor.role IN (
         'EMPLOYEE'::public."Role",
         'ADMIN'::public."Role"
       )
     );
  IF NOT FOUND THEN
    RETURN;
  END IF;

  fixed_cutoff :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
    - INTERVAL '60 days';

  RETURN QUERY
  SELECT pg_catalog.count(*)::bigint
    FROM public."Case" AS case_row
   WHERE case_row."sellerId" = target_seller_user_id
     AND case_row.status IN (
       'OPEN'::public."CaseStatus",
       'IN_DISCUSSION'::public."CaseStatus",
       'PENDING_CLOSE'::public."CaseStatus",
       'UNDER_REVIEW'::public."CaseStatus"
     )
     AND case_row."createdAt" < fixed_cutoff;
END
$grainline_case_seller_verification_eligibility$;

CREATE OR REPLACE FUNCTION public.grainline_case_guild_unresolved_guard(
  p_seller_profile_id text
)
RETURNS TABLE (
  blocked boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_guild_unresolved_guard$
DECLARE
  target_seller_user_id text;
  fixed_cutoff timestamp(3) without time zone;
  blocking_case_id text;
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Case Guild unresolved guard input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller."userId"
    INTO target_seller_user_id
    FROM public."SellerProfile" AS seller
    INNER JOIN public."User" AS seller_user
      ON seller_user.id = seller."userId"
   WHERE seller.id = p_seller_profile_id
     AND seller_user.banned = false
     AND seller_user."deletedAt" IS NULL
     AND (
       seller."guildLevel" = 'GUILD_MEMBER'::public."GuildLevel"
       OR (
         seller."guildLevel" = 'NONE'::public."GuildLevel"
         AND seller."guildMemberApprovedAt" IS NOT NULL
       )
     );
  IF NOT FOUND THEN
    RETURN;
  END IF;

  fixed_cutoff :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
    - INTERVAL '90 days';

  SELECT case_row.id
    INTO blocking_case_id
    FROM public."Case" AS case_row
   WHERE case_row."sellerId" = target_seller_user_id
     AND case_row.status IN (
       'OPEN'::public."CaseStatus",
       'IN_DISCUSSION'::public."CaseStatus",
       'PENDING_CLOSE'::public."CaseStatus",
       'UNDER_REVIEW'::public."CaseStatus"
     )
     AND case_row."createdAt" < fixed_cutoff
   ORDER BY case_row."createdAt" ASC, case_row.id ASC
   FOR UPDATE OF case_row
   LIMIT 1;

  RETURN QUERY
  SELECT (blocking_case_id IS NOT NULL)::boolean;
END
$grainline_case_guild_unresolved_guard$;

REVOKE ALL ON FUNCTION
  public.grainline_case_seller_active_count(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_case_seller_verification_eligibility(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_case_guild_unresolved_guard(text)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_case_seller_active_count(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_seller_verification_eligibility(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_guild_unresolved_guard(text)
  TO grainline_app_runtime;

COMMIT;
