-- Move the Case Guild unresolved guard's private approval-history read to
-- the SellerProfile private companion. The public Guild level and all Case
-- locking semantics remain unchanged; signature, owner and grants are retained.

BEGIN;

DO $case_guild_seller_private_preflight$
BEGIN
  IF pg_catalog.to_regclass('public."SellerProfilePrivate"') IS NULL THEN
    RAISE EXCEPTION 'SellerProfilePrivate table is missing';
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.grainline_case_guild_unresolved_guard(text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Case Guild unresolved guard predecessor is missing';
  END IF;
END
$case_guild_seller_private_preflight$;

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
    INNER JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
    INNER JOIN public."User" AS seller_user
      ON seller_user.id = seller."userId"
   WHERE seller.id = p_seller_profile_id
     AND seller_user.banned = false
     AND seller_user."deletedAt" IS NULL
     AND (
       seller."guildLevel" = 'GUILD_MEMBER'::public."GuildLevel"
       OR (
         seller."guildLevel" = 'NONE'::public."GuildLevel"
         AND seller_private."guildMemberApprovedAt" IS NOT NULL
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

COMMIT;
