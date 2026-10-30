BEGIN;

-- Compatible preparation only. MakerVerification RLS and predecessor table
-- grants remain unchanged until the converted application is deployed and the
-- separately reviewed activation is approved.
DO $grainline_maker_verification_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."MakerVerification"'::pg_catalog.regclass
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'MakerVerification RLS must remain off during compatible preparation';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.grainline_maker_verification_owner_member_apply(text,integer,text,boolean)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_maker_verification_owner_master_apply(text,text,boolean)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_maker_verification_owner_export()'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_maker_verification_owner_delete_redact(timestamp without time zone)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_maker_verification_staff_pending_count(text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_maker_verification_staff_pending_page(text,timestamp without time zone,text,integer)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_guild_staff_master_pending_count(text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_guild_staff_master_pending_page(text,timestamp without time zone,text,integer)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_guild_staff_roster_count(text,text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_guild_staff_roster_page(text,text,timestamp without time zone,text,integer)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_guild_staff_transition_prepared_impl(text,text,text,text,text,boolean)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_guild_member_revoke_prepared_impl(text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_guild_metrics_apply_prepared_impl(text,timestamp without time zone)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'MakerVerification preparation function already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_seller_guild_staff_transition(text,text,text,text,text,boolean)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_guild_member_revoke(text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_guild_metrics_apply(text,timestamp without time zone)'
     ) IS NULL THEN
    RAISE EXCEPTION 'MakerVerification predecessor transition is missing';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM (
        VALUES
          (
            'public.grainline_seller_guild_staff_transition(text,text,text,text,text,boolean)'::pg_catalog.regprocedure::oid,
            '5cc52746e1be3955628192bf32364d7f'::text
          ),
          (
            'public.grainline_seller_guild_member_revoke(text)'::pg_catalog.regprocedure::oid,
            '5511d57e540b8051a22e51e06ce5d528'::text
          ),
          (
            'public.grainline_seller_guild_metrics_apply(text,timestamp without time zone)'::pg_catalog.regprocedure::oid,
            '09f24202b6869178b14f23782c6cbc2c'::text
          )
      ) AS expected(function_oid, source_md5)
      JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = expected.function_oid
     WHERE pg_catalog.md5(procedure.prosrc) <> expected.source_md5
  ) THEN
    RAISE EXCEPTION 'MakerVerification predecessor transition body drifted';
  END IF;
END;
$grainline_maker_verification_preflight$;

-- Keep the predecessor signature live, but put one canonical lock envelope in
-- front of every old and new staff caller. The predecessor implementation has
-- two target shapes with opposite row-lock orders; serializing both through
-- User -> SellerProfile -> MakerVerification -> SellerProfilePrivate prevents
-- the owner/staff and staff/staff deadlocks without changing transition results.
ALTER FUNCTION public.grainline_seller_guild_staff_transition(
  text, text, text, text, text, boolean
) RENAME TO grainline_seller_guild_staff_transition_prepared_impl;

ALTER FUNCTION public.grainline_seller_guild_member_revoke(text)
  RENAME TO grainline_seller_guild_member_revoke_prepared_impl;

ALTER FUNCTION public.grainline_seller_guild_metrics_apply(
  text, timestamp without time zone
) RENAME TO grainline_seller_guild_metrics_apply_prepared_impl;

REVOKE ALL ON FUNCTION public.grainline_seller_guild_staff_transition_prepared_impl(
  text, text, text, text, text, boolean
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_guild_member_revoke_prepared_impl(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_guild_metrics_apply_prepared_impl(
  text, timestamp without time zone
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

CREATE FUNCTION public.grainline_seller_guild_staff_transition(
  p_actor_id text,
  p_operation text,
  p_verification_id text,
  p_seller_profile_id text,
  p_review_notes text,
  p_admin_override boolean
)
RETURNS TABLE (
  applied boolean,
  "auditId" text,
  "sellerProfileId" text,
  "sellerUserId" text,
  "sellerDisplayName" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_guild_staff_transition$
DECLARE
  target_seller_profile_id text;
  source_verification_status public."VerificationStatus";
  source_seller_guild_level public."GuildLevel";
  source_seller_user_id text;
  source_seller_display_name text;
  transition_applied boolean;
  transition_audit_id text;
  transition_seller_profile_id text;
  transition_seller_user_id text;
  transition_seller_display_name text;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  verification_changed integer;
BEGIN
  -- The implementation repeats every authorization and input check. This
  -- envelope derives only the lock target and never treats it as authority.
  IF p_verification_id IS NOT NULL THEN
    SELECT verification."sellerProfileId"
      INTO target_seller_profile_id
      FROM public."MakerVerification" AS verification
     WHERE verification.id = p_verification_id;
  ELSE
    target_seller_profile_id := p_seller_profile_id;
  END IF;

  PERFORM 1
    FROM public."User" AS actor
   WHERE actor.id = p_actor_id
   FOR SHARE;

  IF target_seller_profile_id IS NOT NULL THEN
    PERFORM 1
      FROM public."SellerProfile" AS seller
     WHERE seller.id = target_seller_profile_id
     FOR UPDATE;
    PERFORM 1
      FROM public."MakerVerification" AS verification
     WHERE verification."sellerProfileId" = target_seller_profile_id
       AND (p_verification_id IS NULL OR verification.id = p_verification_id)
     FOR UPDATE;
    PERFORM 1
      FROM public."SellerProfilePrivate" AS seller_private
     WHERE seller_private."sellerProfileId" = target_seller_profile_id
     FOR UPDATE;
    SELECT verification.status,
           seller."guildLevel",
           seller."userId",
           seller."displayName"::text
      INTO source_verification_status,
           source_seller_guild_level,
           source_seller_user_id,
           source_seller_display_name
      FROM public."SellerProfile" AS seller
      JOIN public."MakerVerification" AS verification
        ON verification."sellerProfileId" = seller.id
     WHERE seller.id = target_seller_profile_id
       AND (p_verification_id IS NULL OR verification.id = p_verification_id);
  END IF;

  SELECT transition.applied,
         transition."auditId",
         transition."sellerProfileId",
         transition."sellerUserId",
         transition."sellerDisplayName"
    INTO transition_applied,
         transition_audit_id,
         transition_seller_profile_id,
         transition_seller_user_id,
         transition_seller_display_name
    FROM public.grainline_seller_guild_staff_transition_prepared_impl(
      p_actor_id,
      p_operation,
      p_verification_id,
      p_seller_profile_id,
      p_review_notes,
      p_admin_override
    ) AS transition;

  -- The predecessor rejected a Member revocation while that Member had a
  -- pending Master application. The staff action is still authoritative: the
  -- pending application is cancelled atomically with the Member badge, using
  -- the same actor checks and canonical lifecycle locks the predecessor just
  -- completed above.
  IF p_operation = 'REVOKE_GUILD_MEMBER'
     AND NOT COALESCE(transition_applied, false)
     AND source_seller_guild_level = 'GUILD_MEMBER'::public."GuildLevel"
     AND source_verification_status =
       'GUILD_MASTER_PENDING'::public."VerificationStatus" THEN
    UPDATE public."MakerVerification" AS verification
       SET status = 'REJECTED'::public."VerificationStatus",
           "reviewedById" = p_actor_id,
           "reviewedAt" = source_now,
           "reviewNotes" = 'Guild Member badge revoked by Grainline staff.',
           "updatedAt" = source_now
     WHERE verification."sellerProfileId" = target_seller_profile_id
       AND verification.status =
         'GUILD_MASTER_PENDING'::public."VerificationStatus";
    GET DIAGNOSTICS verification_changed = ROW_COUNT;

    IF verification_changed = 1 THEN
      UPDATE public."SellerProfilePrivate" AS seller_private
         SET "guildMasterAppliedAt" = NULL,
             "guildMasterReviewNotes" = NULL,
             "consecutiveMetricFailures" = 0,
             "metricWarningSentAt" = NULL,
             "listingsBelowThresholdSince" = NULL,
             "lastMetricCheckAt" = source_now,
             "updatedAt" = source_now
       WHERE seller_private."sellerProfileId" = target_seller_profile_id;
      UPDATE public."SellerProfile" AS seller
         SET "guildLevel" = 'NONE'::public."GuildLevel",
             "isVerifiedMaker" = false,
             "updatedAt" = source_now
       WHERE seller.id = target_seller_profile_id;

      transition_audit_id := pg_catalog.gen_random_uuid()::text;
      INSERT INTO public."AdminAuditLog" (
        id, "adminId", action, "targetType", "targetId", reason, metadata,
        undone, "createdAt"
      ) VALUES (
        transition_audit_id,
        p_actor_id,
        'REVOKE_GUILD_MEMBER',
        'SELLER_PROFILE',
        target_seller_profile_id,
        'Guild Member badge revoked by Grainline staff.',
        pg_catalog.jsonb_build_object(
          'cancelledGuildMasterApplication', true
        ),
        false,
        source_now
      );

      transition_applied := true;
      transition_seller_profile_id := target_seller_profile_id;
      transition_seller_user_id := source_seller_user_id;
      transition_seller_display_name := source_seller_display_name;
    END IF;
  END IF;

  RETURN QUERY
  SELECT transition_applied,
         transition_audit_id,
         transition_seller_profile_id,
         transition_seller_user_id,
         transition_seller_display_name;
END;
$grainline_seller_guild_staff_transition$;

REVOKE ALL ON FUNCTION public.grainline_seller_guild_staff_transition(
  text, text, text, text, text, boolean
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_guild_staff_transition(
  text, text, text, text, text, boolean
) TO grainline_staff_read_runtime;

CREATE FUNCTION public.grainline_seller_guild_member_revoke(
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
  source_verification_status public."VerificationStatus";
  transition_applied boolean;
  transition_audit_id text;
  transition_reason text;
  transition_seller_user_id text;
  transition_guard_kind text;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  verification_changed integer;
BEGIN
  -- The implementation keeps every validation and eligibility check. Acquire
  -- the shared Guild lifecycle locks first so cron, staff, and owner paths all
  -- serialize SellerProfile -> MakerVerification -> SellerProfilePrivate.
  PERFORM 1
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
   FOR UPDATE;
  IF FOUND THEN
    PERFORM 1
      FROM public."MakerVerification" AS verification
     WHERE verification."sellerProfileId" = p_seller_profile_id
     FOR UPDATE;
    SELECT verification.status
      INTO source_verification_status
      FROM public."MakerVerification" AS verification
     WHERE verification."sellerProfileId" = p_seller_profile_id;
    PERFORM 1
      FROM public."SellerProfilePrivate" AS seller_private
     WHERE seller_private."sellerProfileId" = p_seller_profile_id
     FOR UPDATE;
  END IF;

  SELECT transition.applied,
         transition."auditId",
         transition.reason,
         transition."sellerUserId",
         transition."guardKind"
    INTO transition_applied,
         transition_audit_id,
         transition_reason,
         transition_seller_user_id,
         transition_guard_kind
    FROM public.grainline_seller_guild_member_revoke_prepared_impl(
      p_seller_profile_id
    ) AS transition;

  -- The predecessor intentionally recognizes only the ordinary Member states.
  -- Once a Member has a pending Master application, that omission prevents a
  -- required Member revocation even after the unresolved-case or listing guard
  -- has fired. The predecessor still owns the guard calculation; complete only
  -- that exact pending-Master transition here while the lifecycle rows remain
  -- locked in the canonical order.
  IF source_verification_status IS DISTINCT FROM
       'GUILD_MASTER_PENDING'::public."VerificationStatus"
     OR COALESCE(transition_applied, false)
     OR transition_guard_kind IS NULL THEN
    RETURN QUERY
    SELECT transition_applied,
           transition_audit_id,
           transition_reason,
           transition_seller_user_id,
           transition_guard_kind;
    RETURN;
  END IF;

  transition_reason := CASE transition_guard_kind
    WHEN 'unresolved_case' THEN
      'An unresolved dispute has been open for over 90 days.'
    WHEN 'listing_threshold' THEN
      'Your shop has had fewer than 5 active listings for over 30 consecutive days.'
    ELSE NULL
  END;
  IF transition_reason IS NULL THEN
    RAISE EXCEPTION 'Seller Guild Member revocation guard is unsupported'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public."MakerVerification"
     SET status = 'REJECTED'::public."VerificationStatus",
         "reviewedAt" = source_now,
         "reviewNotes" = transition_reason,
         "updatedAt" = source_now
   WHERE "sellerProfileId" = p_seller_profile_id
     AND status = 'GUILD_MASTER_PENDING'::public."VerificationStatus";
  GET DIAGNOSTICS verification_changed = ROW_COUNT;
  IF verification_changed <> 1 THEN
    RETURN QUERY
    SELECT false,
           NULL::text,
           NULL::text,
           transition_seller_user_id,
           transition_guard_kind;
    RETURN;
  END IF;

  UPDATE public."SellerProfilePrivate"
     SET "consecutiveMetricFailures" = 0,
         "metricWarningSentAt" = NULL,
         "updatedAt" = source_now
   WHERE "sellerProfileId" = p_seller_profile_id;
  UPDATE public."SellerProfile"
     SET "guildLevel" = 'NONE'::public."GuildLevel",
         "isVerifiedMaker" = false,
         "updatedAt" = source_now
   WHERE id = p_seller_profile_id;

  transition_audit_id :=
    'guild-member-revocation:' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."SystemAuditLog" (
    id, "actorType", "actorId", action, "targetType", "targetId",
    reason, metadata, "createdAt"
  ) VALUES (
    transition_audit_id,
    'cron',
    'guild-member-check',
    'AUTO_REVOKE_GUILD_MEMBER',
    'SELLER_PROFILE',
    p_seller_profile_id,
    transition_reason,
    pg_catalog.jsonb_build_object(
      'jobName', 'guild-member-check',
      'sellerUserId', transition_seller_user_id,
      'guardKind', transition_guard_kind,
      'cancelledGuildMasterApplication', true
    ),
    source_now
  );

  RETURN QUERY
  SELECT true,
         transition_audit_id,
         transition_reason,
         transition_seller_user_id,
         transition_guard_kind;
END;
$grainline_seller_guild_member_revoke$;

CREATE FUNCTION public.grainline_seller_guild_metrics_apply(
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
BEGIN
  PERFORM 1
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
   FOR UPDATE;
  IF FOUND THEN
    PERFORM 1
      FROM public."MakerVerification" AS verification
     WHERE verification."sellerProfileId" = p_seller_profile_id
     FOR UPDATE;
    PERFORM 1
      FROM public."SellerProfilePrivate" AS seller_private
     WHERE seller_private."sellerProfileId" = p_seller_profile_id
     FOR UPDATE;
    PERFORM 1
      FROM public."SellerMetrics" AS metrics
     WHERE metrics."sellerProfileId" = p_seller_profile_id
       AND metrics."calculatedAt" = p_calculated_at
       AND metrics."periodMonths" = 3
     FOR UPDATE;
  END IF;

  RETURN QUERY
  SELECT transition.action,
         transition."auditId",
         transition."warningSentAt",
         transition."sellerUserId"
    FROM public.grainline_seller_guild_metrics_apply_prepared_impl(
      p_seller_profile_id,
      p_calculated_at
    ) AS transition;
END;
$grainline_seller_guild_metrics_apply$;

REVOKE ALL ON FUNCTION public.grainline_seller_guild_member_revoke(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_guild_metrics_apply(
  text, timestamp without time zone
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_guild_member_revoke(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_guild_metrics_apply(
  text, timestamp without time zone
) TO grainline_app_runtime;

CREATE FUNCTION public.grainline_maker_verification_owner_member_apply(
  p_craft_description text,
  p_years_experience integer,
  p_portfolio_url text,
  p_confirmed_handmade boolean
)
RETURNS TABLE (
  applied boolean,
  id text,
  status text,
  "appliedAt" timestamp(3) without time zone
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_maker_verification_owner_member_apply$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  source_seller public."SellerProfile"%ROWTYPE;
  source_verification public."MakerVerification"%ROWTYPE;
  new_id text;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Maker verification owner context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_confirmed_handmade IS DISTINCT FROM true
     OR p_craft_description IS NULL
     OR pg_catalog.btrim(p_craft_description) = ''
     OR pg_catalog.char_length(p_craft_description) > 500
     OR p_years_experience IS NULL
     OR p_years_experience < 0
     OR p_years_experience > 100
     OR (
       p_portfolio_url IS NOT NULL
       AND (
         pg_catalog.char_length(p_portfolio_url) > 500
         OR p_portfolio_url !~ '^https://[^[:space:]]+$'
       )
     ) THEN
    RAISE EXCEPTION 'Maker verification member application input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public."User" AS actor
   WHERE actor.id = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Maker verification owner is inactive'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller.*
    INTO source_seller
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = request_user_id
   FOR UPDATE;
  IF NOT FOUND OR NOT source_seller."ownerAccountActive" THEN
    RAISE EXCEPTION 'Maker verification seller is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT verification.*
    INTO source_verification
    FROM public."MakerVerification" AS verification
   WHERE verification."sellerProfileId" = source_seller.id
   FOR UPDATE;

  IF source_seller."guildLevel" <> 'NONE'::public."GuildLevel"
     OR (
       source_verification.id IS NOT NULL
       AND source_verification.status <> 'REJECTED'::public."VerificationStatus"
     )
     OR (
       source_verification.id IS NOT NULL
       AND source_verification."reviewedAt" IS NOT NULL
       AND source_verification."reviewedAt" > source_now - INTERVAL '30 days'
     ) THEN
    RETURN QUERY
    SELECT false,
           source_verification.id,
           source_verification.status::text,
           source_verification."appliedAt";
    RETURN;
  END IF;

  IF source_verification.id IS NULL THEN
    new_id := pg_catalog.gen_random_uuid()::text;
    INSERT INTO public."MakerVerification" (
      id,
      "sellerProfileId",
      "craftDescription",
      "guildMasterCraftBusiness",
      "yearsExperience",
      "portfolioUrl",
      status,
      "reviewedById",
      "reviewNotes",
      "appliedAt",
      "reviewedAt",
      "createdAt",
      "updatedAt"
    ) VALUES (
      new_id,
      source_seller.id,
      p_craft_description,
      NULL,
      p_years_experience,
      p_portfolio_url,
      'PENDING'::public."VerificationStatus",
      NULL,
      NULL,
      source_now,
      NULL,
      source_now,
      source_now
    );
  ELSE
    new_id := source_verification.id;
    UPDATE public."MakerVerification"
       SET "craftDescription" = p_craft_description,
           "yearsExperience" = p_years_experience,
           "portfolioUrl" = p_portfolio_url,
           status = 'PENDING'::public."VerificationStatus",
           "reviewedById" = NULL,
           "reviewNotes" = NULL,
           "appliedAt" = source_now,
           "reviewedAt" = NULL,
           "updatedAt" = source_now
     WHERE "MakerVerification".id = source_verification.id;
  END IF;

  RETURN QUERY SELECT true, new_id, 'PENDING'::text, source_now;
END;
$grainline_maker_verification_owner_member_apply$;

CREATE FUNCTION public.grainline_maker_verification_owner_master_apply(
  p_craft_business text,
  p_portfolio_url text,
  p_confirmed_standards boolean
)
RETURNS TABLE (
  applied boolean,
  id text,
  status text,
  "appliedAt" timestamp(3) without time zone
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_maker_verification_owner_master_apply$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  source_seller public."SellerProfile"%ROWTYPE;
  source_verification public."MakerVerification"%ROWTYPE;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Maker verification owner context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_confirmed_standards IS DISTINCT FROM true
     OR p_craft_business IS NULL
     OR pg_catalog.btrim(p_craft_business) = ''
     OR pg_catalog.char_length(p_craft_business) > 500
     OR (
       p_portfolio_url IS NOT NULL
       AND (
         pg_catalog.char_length(p_portfolio_url) > 500
         OR p_portfolio_url !~ '^https://[^[:space:]]+$'
       )
     ) THEN
    RAISE EXCEPTION 'Maker verification master application input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public."User" AS actor
   WHERE actor.id = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Maker verification owner is inactive'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller.*
    INTO source_seller
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = request_user_id
   FOR UPDATE;
  IF NOT FOUND
     OR NOT source_seller."ownerAccountActive"
     OR source_seller."guildLevel" <> 'GUILD_MEMBER'::public."GuildLevel" THEN
    RAISE EXCEPTION 'Maker verification seller is not an active Guild Member'
      USING ERRCODE = '42501';
  END IF;

  SELECT verification.*
    INTO source_verification
    FROM public."MakerVerification" AS verification
   WHERE verification."sellerProfileId" = source_seller.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Maker verification member record is missing'
      USING ERRCODE = 'P0002';
  END IF;

  IF source_verification.status NOT IN (
       'APPROVED'::public."VerificationStatus",
       'GUILD_MASTER_REJECTED'::public."VerificationStatus"
     )
     OR (
       source_verification.status = 'GUILD_MASTER_REJECTED'::public."VerificationStatus"
       AND source_verification."reviewedAt" IS NOT NULL
       AND source_verification."reviewedAt" > source_now - INTERVAL '30 days'
     ) THEN
    RETURN QUERY
    SELECT false,
           source_verification.id,
           source_verification.status::text,
           source_verification."appliedAt";
    RETURN;
  END IF;

  UPDATE public."MakerVerification"
     SET status = 'GUILD_MASTER_PENDING'::public."VerificationStatus",
         "guildMasterCraftBusiness" = p_craft_business,
         "portfolioUrl" = COALESCE(p_portfolio_url, "portfolioUrl"),
         "appliedAt" = source_now,
         "updatedAt" = source_now
   WHERE "MakerVerification".id = source_verification.id;

  UPDATE public."SellerProfilePrivate"
     SET "guildMasterAppliedAt" = source_now,
         "guildMasterReviewNotes" = NULL,
         "updatedAt" = source_now
   WHERE "sellerProfileId" = source_seller.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Maker verification private seller state is missing'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public."SellerProfile"
     SET "updatedAt" = source_now
   WHERE "SellerProfile".id = source_seller.id;

  RETURN QUERY
  SELECT true,
         source_verification.id,
         'GUILD_MASTER_PENDING'::text,
         source_now;
END;
$grainline_maker_verification_owner_master_apply$;

CREATE FUNCTION public.grainline_maker_verification_owner_export()
RETURNS TABLE (
  id text,
  "sellerProfileId" text,
  "craftDescription" text,
  "guildMasterCraftBusiness" text,
  "yearsExperience" integer,
  "portfolioUrl" text,
  status text,
  "reviewNotes" text,
  "appliedAt" timestamp(3) without time zone,
  "reviewedAt" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone,
  "updatedAt" timestamp(3) without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_maker_verification_owner_export$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Maker verification export context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT verification.id,
         verification."sellerProfileId",
         verification."craftDescription"::text,
         verification."guildMasterCraftBusiness"::text,
         verification."yearsExperience",
         verification."portfolioUrl"::text,
         verification.status::text,
         verification."reviewNotes"::text,
         verification."appliedAt",
         verification."reviewedAt",
         verification."createdAt",
         verification."updatedAt"
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
    JOIN public."MakerVerification" AS verification
      ON verification."sellerProfileId" = seller.id
   WHERE actor.id = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL;
END;
$grainline_maker_verification_owner_export$;

CREATE FUNCTION public.grainline_maker_verification_owner_delete_redact(
  p_applied_at timestamp without time zone
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_maker_verification_owner_delete_redact$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  source_seller_id text;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Maker verification deletion context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_applied_at IS NULL THEN
    RAISE EXCEPTION 'Maker verification deletion timestamp is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public."User" AS actor
   WHERE actor.id = request_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Maker verification deletion owner is missing'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT seller.id
    INTO source_seller_id
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = request_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM 1
    FROM public."MakerVerification" AS verification
   WHERE verification."sellerProfileId" = source_seller_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public."MakerVerification"
     SET "craftDescription" = '[Deleted]',
         "guildMasterCraftBusiness" = NULL,
         "yearsExperience" = 0,
         "portfolioUrl" = NULL,
         status = 'REJECTED'::public."VerificationStatus",
         "reviewedById" = NULL,
         "reviewNotes" = NULL,
         "appliedAt" = p_applied_at,
         "reviewedAt" = NULL,
         "updatedAt" = p_applied_at
   WHERE "sellerProfileId" = source_seller_id;

  RETURN true;
END;
$grainline_maker_verification_owner_delete_redact$;

CREATE FUNCTION public.grainline_maker_verification_staff_pending_count(
  p_actor_id text
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_maker_verification_staff_pending_count$
DECLARE
  result_count bigint;
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Maker verification staff count requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Maker verification staff count input is invalid'
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
    RAISE EXCEPTION 'Maker verification staff count actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.count(*)
    INTO result_count
    FROM public."MakerVerification" AS verification
   WHERE verification.status = 'PENDING'::public."VerificationStatus";
  RETURN result_count;
END;
$grainline_maker_verification_staff_pending_count$;

CREATE FUNCTION public.grainline_maker_verification_staff_pending_page(
  p_actor_id text,
  p_cursor_applied_at timestamp without time zone,
  p_cursor_id text,
  p_take integer
)
RETURNS TABLE (
  id text,
  "craftDescription" text,
  "yearsExperience" integer,
  "portfolioUrl" text,
  "appliedAt" timestamp(3) without time zone,
  "sellerProfileId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_maker_verification_staff_pending_page$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Maker verification staff page requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_take IS NULL
     OR p_take < 1
     OR p_take > 100
     OR ((p_cursor_applied_at IS NULL) <> (p_cursor_id IS NULL))
     OR (p_cursor_id IS NOT NULL AND p_cursor_id !~ '^[A-Za-z0-9._:-]{1,191}$') THEN
    RAISE EXCEPTION 'Maker verification staff page input is invalid'
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
    RAISE EXCEPTION 'Maker verification staff page actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT verification.id,
         verification."craftDescription"::text,
         verification."yearsExperience",
         verification."portfolioUrl"::text,
         verification."appliedAt",
         verification."sellerProfileId"
    FROM public."MakerVerification" AS verification
   WHERE verification.status = 'PENDING'::public."VerificationStatus"
     AND (
       p_cursor_applied_at IS NULL
       OR (verification."appliedAt", verification.id)
          > (p_cursor_applied_at, p_cursor_id)
     )
   ORDER BY verification."appliedAt" ASC, verification.id ASC
   LIMIT p_take;
END;
$grainline_maker_verification_staff_pending_page$;

CREATE FUNCTION public.grainline_seller_guild_staff_master_pending_count(
  p_actor_id text
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_guild_staff_master_pending_count$
DECLARE
  result_count bigint;
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller Guild Master count requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller Guild Master count input is invalid'
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
    RAISE EXCEPTION 'Seller Guild Master count actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.count(*)
    INTO result_count
    FROM public."MakerVerification" AS verification
    JOIN public."SellerProfile" AS seller
      ON seller.id = verification."sellerProfileId"
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE verification.status = 'GUILD_MASTER_PENDING'::public."VerificationStatus";
  RETURN result_count;
END;
$grainline_seller_guild_staff_master_pending_count$;

CREATE FUNCTION public.grainline_seller_guild_staff_master_pending_page(
  p_actor_id text,
  p_cursor_applied_at timestamp without time zone,
  p_cursor_id text,
  p_take integer
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
AS $grainline_seller_guild_staff_master_pending_page$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller Guild Master page requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_take IS NULL
     OR p_take < 1
     OR p_take > 100
     OR ((p_cursor_applied_at IS NULL) <> (p_cursor_id IS NULL))
     OR (p_cursor_id IS NOT NULL AND p_cursor_id !~ '^[A-Za-z0-9._:-]{1,191}$') THEN
    RAISE EXCEPTION 'Seller Guild Master page input is invalid'
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
    RAISE EXCEPTION 'Seller Guild Master page actor is not authorized'
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
     AND (
       p_cursor_applied_at IS NULL
       OR (verification."appliedAt", verification.id)
          > (p_cursor_applied_at, p_cursor_id)
     )
   ORDER BY verification."appliedAt" ASC, verification.id ASC
   LIMIT p_take;
END;
$grainline_seller_guild_staff_master_pending_page$;

CREATE FUNCTION public.grainline_seller_guild_staff_roster_count(
  p_actor_id text,
  p_cohort text
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_guild_staff_roster_count$
DECLARE
  result_count bigint;
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller Guild roster count requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_cohort IS NULL
     OR p_cohort NOT IN ('GUILD_MEMBER', 'GUILD_MASTER', 'REVOKED_MEMBER', 'FEATURED') THEN
    RAISE EXCEPTION 'Seller Guild roster count input is invalid'
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
    RAISE EXCEPTION 'Seller Guild roster count actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.count(*)
    INTO result_count
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE (p_cohort = 'GUILD_MEMBER'
          AND seller."guildLevel" = 'GUILD_MEMBER'::public."GuildLevel")
      OR (p_cohort = 'GUILD_MASTER'
          AND seller."guildLevel" = 'GUILD_MASTER'::public."GuildLevel")
      OR (p_cohort = 'REVOKED_MEMBER'
          AND seller."guildLevel" = 'NONE'::public."GuildLevel"
          AND seller_private."guildMemberApprovedAt" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
              FROM public."MakerVerification" AS verification
             WHERE verification."sellerProfileId" = seller.id
               AND verification.status = 'PENDING'::public."VerificationStatus"
          ))
      OR (p_cohort = 'FEATURED'
          AND seller."guildLevel" IN (
            'GUILD_MEMBER'::public."GuildLevel",
            'GUILD_MASTER'::public."GuildLevel"
          )
          AND seller."featuredUntil" > CURRENT_TIMESTAMP);
  RETURN result_count;
END;
$grainline_seller_guild_staff_roster_count$;

CREATE FUNCTION public.grainline_seller_guild_staff_roster_page(
  p_actor_id text,
  p_cohort text,
  p_cursor_approved_at timestamp without time zone,
  p_cursor_id text,
  p_take integer
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
AS $grainline_seller_guild_staff_roster_page$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller Guild roster page requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_cohort IS NULL
     OR p_cohort NOT IN ('GUILD_MEMBER', 'GUILD_MASTER', 'REVOKED_MEMBER', 'FEATURED')
     OR p_take IS NULL
     OR p_take < 1
     OR p_take > 100
     OR (p_cursor_id IS NULL AND p_cursor_approved_at IS NOT NULL)
     OR (p_cursor_id IS NOT NULL AND p_cursor_id !~ '^[A-Za-z0-9._:-]{1,191}$') THEN
    RAISE EXCEPTION 'Seller Guild roster page input is invalid'
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
    RAISE EXCEPTION 'Seller Guild roster page actor is not authorized'
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
   WHERE (
       (p_cohort = 'GUILD_MEMBER'
        AND seller."guildLevel" = 'GUILD_MEMBER'::public."GuildLevel")
       OR (p_cohort = 'GUILD_MASTER'
           AND seller."guildLevel" = 'GUILD_MASTER'::public."GuildLevel")
       OR (p_cohort = 'REVOKED_MEMBER'
           AND seller."guildLevel" = 'NONE'::public."GuildLevel"
           AND seller_private."guildMemberApprovedAt" IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
               FROM public."MakerVerification" AS verification
              WHERE verification."sellerProfileId" = seller.id
                AND verification.status = 'PENDING'::public."VerificationStatus"
           ))
       OR (p_cohort = 'FEATURED'
           AND seller."guildLevel" IN (
             'GUILD_MEMBER'::public."GuildLevel",
             'GUILD_MASTER'::public."GuildLevel"
           )
           AND seller."featuredUntil" > CURRENT_TIMESTAMP)
     )
     AND (
       p_cursor_id IS NULL
       OR (
         p_cursor_approved_at IS NOT NULL
         AND (
           CASE p_cohort
             WHEN 'FEATURED' THEN seller."featuredUntil"
             WHEN 'GUILD_MASTER' THEN seller_private."guildMasterApprovedAt"
             ELSE seller_private."guildMemberApprovedAt"
           END < p_cursor_approved_at
           OR CASE p_cohort
                WHEN 'FEATURED' THEN seller."featuredUntil"
                WHEN 'GUILD_MASTER' THEN seller_private."guildMasterApprovedAt"
                ELSE seller_private."guildMemberApprovedAt"
              END IS NULL
           OR (
             CASE p_cohort
               WHEN 'FEATURED' THEN seller."featuredUntil"
               WHEN 'GUILD_MASTER' THEN seller_private."guildMasterApprovedAt"
               ELSE seller_private."guildMemberApprovedAt"
             END = p_cursor_approved_at
             AND seller.id > p_cursor_id
           )
         )
       )
       OR (
         p_cursor_id IS NOT NULL
         AND p_cursor_approved_at IS NULL
         AND CASE p_cohort
               WHEN 'FEATURED' THEN seller."featuredUntil"
               WHEN 'GUILD_MASTER' THEN seller_private."guildMasterApprovedAt"
               ELSE seller_private."guildMemberApprovedAt"
             END IS NULL
         AND seller.id > p_cursor_id
       )
     )
   ORDER BY
     CASE p_cohort
       WHEN 'FEATURED' THEN seller."featuredUntil"
       WHEN 'GUILD_MASTER' THEN seller_private."guildMasterApprovedAt"
       ELSE seller_private."guildMemberApprovedAt"
     END DESC NULLS LAST,
     seller.id ASC
   LIMIT p_take;
END;
$grainline_seller_guild_staff_roster_page$;

REVOKE ALL ON FUNCTION public.grainline_maker_verification_owner_member_apply(
  text, integer, text, boolean
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_maker_verification_owner_master_apply(
  text, text, boolean
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_maker_verification_owner_export()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_maker_verification_owner_delete_redact(
  timestamp without time zone
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_maker_verification_staff_pending_count(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_maker_verification_staff_pending_page(
  text, timestamp without time zone, text, integer
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_guild_staff_master_pending_count(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_guild_staff_master_pending_page(
  text, timestamp without time zone, text, integer
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_guild_staff_roster_count(text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_guild_staff_roster_page(
  text, text, timestamp without time zone, text, integer
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_maker_verification_owner_member_apply(
  text, integer, text, boolean
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_maker_verification_owner_master_apply(
  text, text, boolean
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_maker_verification_owner_export()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_maker_verification_owner_delete_redact(
  timestamp without time zone
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_maker_verification_staff_pending_count(text)
  TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_maker_verification_staff_pending_page(
  text, timestamp without time zone, text, integer
) TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_guild_staff_master_pending_count(text)
  TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_guild_staff_master_pending_page(
  text, timestamp without time zone, text, integer
) TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_guild_staff_roster_count(text, text)
  TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_guild_staff_roster_page(
  text, text, timestamp without time zone, text, integer
) TO grainline_staff_read_runtime;

DO $grainline_maker_verification_postflight$
DECLARE
  function_oid oid;
  expected_runtime boolean;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."MakerVerification"'::pg_catalog.regclass
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'MakerVerification compatible preparation changed RLS posture';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (
        VALUES
          (
            'public.grainline_seller_guild_staff_transition_prepared_impl(text,text,text,text,text,boolean)'::pg_catalog.regprocedure::oid,
            '5cc52746e1be3955628192bf32364d7f'::text
          ),
          (
            'public.grainline_seller_guild_member_revoke_prepared_impl(text)'::pg_catalog.regprocedure::oid,
            '5511d57e540b8051a22e51e06ce5d528'::text
          ),
          (
            'public.grainline_seller_guild_metrics_apply_prepared_impl(text,timestamp without time zone)'::pg_catalog.regprocedure::oid,
            '09f24202b6869178b14f23782c6cbc2c'::text
          )
      ) AS expected(function_oid, source_md5)
      JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = expected.function_oid
     WHERE pg_catalog.md5(procedure.prosrc) <> expected.source_md5
  ) THEN
    RAISE EXCEPTION 'MakerVerification predecessor implementation body drifted';
  END IF;

  FOR function_oid, expected_runtime IN
    SELECT candidate.function_oid, candidate.expected_runtime
      FROM (
        VALUES
          (
            'public.grainline_maker_verification_owner_member_apply(text,integer,text,boolean)'::pg_catalog.regprocedure::oid,
            true
          ),
          (
            'public.grainline_maker_verification_owner_master_apply(text,text,boolean)'::pg_catalog.regprocedure::oid,
            true
          ),
          (
            'public.grainline_maker_verification_owner_export()'::pg_catalog.regprocedure::oid,
            true
          ),
          (
            'public.grainline_maker_verification_owner_delete_redact(timestamp without time zone)'::pg_catalog.regprocedure::oid,
            true
          ),
          (
            'public.grainline_maker_verification_staff_pending_count(text)'::pg_catalog.regprocedure::oid,
            false
          ),
          (
            'public.grainline_maker_verification_staff_pending_page(text,timestamp without time zone,text,integer)'::pg_catalog.regprocedure::oid,
            false
          ),
          (
            'public.grainline_seller_guild_staff_master_pending_count(text)'::pg_catalog.regprocedure::oid,
            false
          ),
          (
            'public.grainline_seller_guild_staff_master_pending_page(text,timestamp without time zone,text,integer)'::pg_catalog.regprocedure::oid,
            false
          ),
          (
            'public.grainline_seller_guild_staff_roster_count(text,text)'::pg_catalog.regprocedure::oid,
            false
          ),
          (
            'public.grainline_seller_guild_staff_roster_page(text,text,timestamp without time zone,text,integer)'::pg_catalog.regprocedure::oid,
            false
          )
      ) AS candidate(function_oid, expected_runtime)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_roles AS owner_role
          ON owner_role.oid = procedure.proowner
       WHERE procedure.oid = function_oid
         AND procedure.prosecdef
         AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND (owner_role.rolsuper OR owner_role.rolbypassrls)
    ) THEN
      RAISE EXCEPTION 'MakerVerification function owner/security/search_path drifted: %', function_oid::pg_catalog.regprocedure;
    END IF;
    IF EXISTS (
         SELECT 1
           FROM pg_catalog.pg_proc AS procedure
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(
               procedure.proacl,
               pg_catalog.acldefault('f', procedure.proowner)
             )
           ) AS acl
          WHERE procedure.oid = function_oid
            AND acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         CASE WHEN expected_runtime THEN 'grainline_staff_read_runtime' ELSE 'grainline_app_runtime' END,
         function_oid,
         'EXECUTE'
       )
       OR NOT pg_catalog.has_function_privilege(
         CASE WHEN expected_runtime THEN 'grainline_app_runtime' ELSE 'grainline_staff_read_runtime' END,
         function_oid,
         'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'MakerVerification function ACL drifted: %', function_oid::pg_catalog.regprocedure;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = procedure.proowner
     WHERE procedure.oid =
       'public.grainline_seller_guild_staff_transition(text,text,text,text,text,boolean)'::pg_catalog.regprocedure
       AND procedure.prosecdef
       AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND (owner_role.rolsuper OR owner_role.rolbypassrls)
       AND pg_catalog.has_function_privilege(
         'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
       )
       AND NOT pg_catalog.has_function_privilege(
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
    RAISE EXCEPTION 'MakerVerification staff transition envelope drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = procedure.proowner
     WHERE procedure.oid =
       'public.grainline_seller_guild_staff_transition_prepared_impl(text,text,text,text,text,boolean)'::pg_catalog.regprocedure
       AND procedure.prosecdef
       AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND (owner_role.rolsuper OR owner_role.rolbypassrls)
       AND NOT pg_catalog.has_function_privilege(
         'grainline_app_runtime', procedure.oid, 'EXECUTE'
       )
       AND NOT pg_catalog.has_function_privilege(
         'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
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
    RAISE EXCEPTION 'MakerVerification predecessor implementation ACL drifted';
  END IF;

  FOR function_oid IN
    SELECT candidate.function_oid
      FROM (
        VALUES
          (
            'public.grainline_seller_guild_member_revoke(text)'::pg_catalog.regprocedure::oid
          ),
          (
            'public.grainline_seller_guild_metrics_apply(text,timestamp without time zone)'::pg_catalog.regprocedure::oid
          )
      ) AS candidate(function_oid)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_roles AS owner_role
          ON owner_role.oid = procedure.proowner
       WHERE procedure.oid = function_oid
         AND procedure.prosecdef
         AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND (owner_role.rolsuper OR owner_role.rolbypassrls)
         AND pg_catalog.has_function_privilege(
           'grainline_app_runtime', procedure.oid, 'EXECUTE'
         )
         AND NOT pg_catalog.has_function_privilege(
           'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
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
      RAISE EXCEPTION 'MakerVerification system transition envelope drifted: %', function_oid::pg_catalog.regprocedure;
    END IF;
  END LOOP;

  FOR function_oid IN
    SELECT candidate.function_oid
      FROM (
        VALUES
          (
            'public.grainline_seller_guild_member_revoke_prepared_impl(text)'::pg_catalog.regprocedure::oid
          ),
          (
            'public.grainline_seller_guild_metrics_apply_prepared_impl(text,timestamp without time zone)'::pg_catalog.regprocedure::oid
          )
      ) AS candidate(function_oid)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_roles AS owner_role
          ON owner_role.oid = procedure.proowner
       WHERE procedure.oid = function_oid
         AND procedure.prosecdef
         AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND (owner_role.rolsuper OR owner_role.rolbypassrls)
         AND NOT pg_catalog.has_function_privilege(
           'grainline_app_runtime', procedure.oid, 'EXECUTE'
         )
         AND NOT pg_catalog.has_function_privilege(
           'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
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
      RAISE EXCEPTION 'MakerVerification system predecessor implementation drifted: %', function_oid::pg_catalog.regprocedure;
    END IF;
  END LOOP;
END;
$grainline_maker_verification_postflight$;

COMMIT;
