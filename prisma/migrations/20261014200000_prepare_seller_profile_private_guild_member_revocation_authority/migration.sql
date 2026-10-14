-- Derive automatic Guild Member revocation from current database state.
-- The caller supplies only the seller identity; the function rechecks the
-- aged-case and sustained-listing guards, pairs verification and seller state,
-- and inserts the notification-authorizing audit in one transaction.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_guild_member_revoke(
  p_seller_profile_id text
)
RETURNS TABLE (
  applied boolean,
  "auditId" text,
  reason text,
  "sellerUserId" text,
  "guardKind" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_guild_member_revoke$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  source_seller public."SellerProfile"%ROWTYPE;
  source_private public."SellerProfilePrivate"%ROWTYPE;
  unresolved_case_blocked boolean := false;
  active_listing_count bigint := 0;
  revocation_reason text;
  revocation_guard_kind text;
  revocation_audit_id text;
  verification_changed integer;
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller Guild Member revocation input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.*
    INTO source_seller
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF source_seller."guildLevel" <> 'GUILD_MEMBER'::public."GuildLevel" THEN
    RETURN QUERY
    SELECT false, NULL::text, NULL::text,
           source_seller."userId", NULL::text;
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

  SELECT case_guard.blocked
    INTO unresolved_case_blocked
    FROM public.grainline_case_guild_unresolved_guard(
      source_seller.id
    ) AS case_guard;
  unresolved_case_blocked := COALESCE(unresolved_case_blocked, false);

  IF unresolved_case_blocked THEN
    revocation_guard_kind := 'unresolved_case';
    revocation_reason :=
      'An unresolved dispute has been open for over 90 days.';
  ELSIF source_private."listingsBelowThresholdSince" IS NOT NULL
        AND source_private."listingsBelowThresholdSince"
          < source_now - INTERVAL '30 days' THEN
    SELECT pg_catalog.count(*)::bigint
      INTO active_listing_count
      FROM public."Listing" AS listing
     WHERE listing."sellerId" = source_seller.id
       AND listing.status = 'ACTIVE'::public."ListingStatus"
       AND listing."isPrivate" = false;

    IF active_listing_count < 5 THEN
      revocation_guard_kind := 'listing_threshold';
      revocation_reason :=
        'Your shop has had fewer than 5 active listings for over 30 consecutive days.';
    END IF;
  END IF;

  IF revocation_guard_kind IS NULL THEN
    RETURN QUERY
    SELECT false, NULL::text, NULL::text,
           source_seller."userId", NULL::text;
    RETURN;
  END IF;

  UPDATE public."MakerVerification"
     SET status = 'REJECTED'::public."VerificationStatus",
         "reviewedAt" = source_now,
         "reviewNotes" = revocation_reason,
         "updatedAt" = source_now
   WHERE "sellerProfileId" = source_seller.id
     AND status IN (
       'APPROVED'::public."VerificationStatus",
       'GUILD_MASTER_REJECTED'::public."VerificationStatus"
     );
  GET DIAGNOSTICS verification_changed = ROW_COUNT;

  IF verification_changed = 0 THEN
    RETURN QUERY
    SELECT false, NULL::text, NULL::text,
           source_seller."userId", revocation_guard_kind;
    RETURN;
  END IF;

  UPDATE public."SellerProfilePrivate"
     SET "consecutiveMetricFailures" = 0,
         "metricWarningSentAt" = NULL,
         "updatedAt" = source_now
   WHERE "sellerProfileId" = source_seller.id;
  UPDATE public."SellerProfile"
     SET "guildLevel" = 'NONE'::public."GuildLevel",
         "isVerifiedMaker" = false,
         "consecutiveMetricFailures" = 0,
         "metricWarningSentAt" = NULL,
         "updatedAt" = source_now
   WHERE id = source_seller.id;

  revocation_audit_id :=
    'guild-member-revocation:' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."SystemAuditLog" (
    id, "actorType", "actorId", action, "targetType", "targetId",
    reason, metadata, "createdAt"
  ) VALUES (
    revocation_audit_id,
    'cron',
    'guild-member-check',
    'AUTO_REVOKE_GUILD_MEMBER',
    'SELLER_PROFILE',
    source_seller.id,
    revocation_reason,
    pg_catalog.jsonb_build_object(
      'jobName', 'guild-member-check',
      'sellerUserId', source_seller."userId",
      'guardKind', revocation_guard_kind
    ),
    source_now
  );

  RETURN QUERY
  SELECT true, revocation_audit_id, revocation_reason,
         source_seller."userId", revocation_guard_kind;
END
$grainline_seller_guild_member_revoke$;

REVOKE ALL ON FUNCTION public.grainline_seller_guild_member_revoke(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_guild_member_revoke(text)
  TO grainline_app_runtime;

COMMIT;
