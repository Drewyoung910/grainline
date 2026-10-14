-- Atomic staff Guild verification and seller-state transitions. Execution is
-- restricted to the isolated staff database role and every call revalidates
-- the application actor against current User state.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_guild_staff_transition(
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
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  source_actor_role text;
  source_seller public."SellerProfile"%ROWTYPE;
  source_private public."SellerProfilePrivate"%ROWTYPE;
  source_verification public."MakerVerification"%ROWTYPE;
  active_listing_count bigint;
  unresolved_case_blocked boolean;
  audit_action text;
  audit_reason text;
  audit_metadata jsonb := '{}'::jsonb;
  audit_id text;
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller Guild transition requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_operation NOT IN (
       'APPROVE_GUILD_MEMBER', 'REJECT_GUILD_MEMBER', 'REVOKE_GUILD_MEMBER',
       'APPROVE_GUILD_MASTER', 'REJECT_GUILD_MASTER', 'REVOKE_GUILD_MASTER',
       'REINSTATE_GUILD_MEMBER'
     )
     OR p_review_notes IS DISTINCT FROM pg_catalog.left(p_review_notes, 2000)
     OR p_admin_override IS NULL THEN
    RAISE EXCEPTION 'Seller Guild transition input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_operation IN (
       'APPROVE_GUILD_MEMBER', 'REJECT_GUILD_MEMBER',
       'APPROVE_GUILD_MASTER', 'REJECT_GUILD_MASTER'
     ) THEN
    IF p_verification_id IS NULL
       OR p_verification_id !~ '^[A-Za-z0-9._:-]{1,191}$'
       OR p_seller_profile_id IS NOT NULL THEN
      RAISE EXCEPTION 'Seller Guild verification transition input is invalid'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_seller_profile_id IS NULL
       OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
       OR p_verification_id IS NOT NULL THEN
      RAISE EXCEPTION 'Seller Guild profile transition input is invalid'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_admin_override AND p_operation <> 'APPROVE_GUILD_MEMBER' THEN
    RAISE EXCEPTION 'Seller Guild override is not valid for this transition'
      USING ERRCODE = '22023';
  END IF;

  SELECT actor.role::text
    INTO source_actor_role
    FROM public."User" AS actor
   WHERE actor.id = p_actor_id
     AND actor.role::text IN ('ADMIN', 'EMPLOYEE')
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND OR (
    p_operation = 'REINSTATE_GUILD_MEMBER' AND source_actor_role <> 'ADMIN'
  ) OR (
    p_admin_override AND source_actor_role <> 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Seller Guild transition actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_verification_id IS NOT NULL THEN
    SELECT verification.*
      INTO source_verification
      FROM public."MakerVerification" AS verification
     WHERE verification.id = p_verification_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::text, NULL::text;
      RETURN;
    END IF;
    SELECT seller.*
      INTO source_seller
      FROM public."SellerProfile" AS seller
     WHERE seller.id = source_verification."sellerProfileId"
     FOR UPDATE;
  ELSE
    SELECT seller.*
      INTO source_seller
      FROM public."SellerProfile" AS seller
     WHERE seller.id = p_seller_profile_id
     FOR UPDATE;
    IF FOUND THEN
      SELECT verification.*
        INTO source_verification
        FROM public."MakerVerification" AS verification
       WHERE verification."sellerProfileId" = source_seller.id
       FOR UPDATE;
    END IF;
  END IF;
  IF source_seller.id IS NULL OR source_verification.id IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::text, NULL::text;
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

  IF p_operation = 'APPROVE_GUILD_MEMBER' THEN
    IF source_verification.status <> 'PENDING'::public."VerificationStatus"
       OR NOT source_seller."ownerAccountActive" THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    UPDATE public."MakerVerification"
       SET status = 'APPROVED'::public."VerificationStatus",
           "reviewedById" = p_actor_id, "reviewedAt" = source_now,
           "reviewNotes" = CASE WHEN p_admin_override
             THEN 'Admin override: $250 sales requirement waived' ELSE NULL END,
           "updatedAt" = source_now
     WHERE id = source_verification.id;
    UPDATE public."SellerProfilePrivate" AS seller_private
       SET "guildMemberApprovedAt" = source_now, "updatedAt" = source_now
     WHERE seller_private."sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "isVerifiedMaker" = true, "verifiedAt" = source_now,
           "guildLevel" = 'GUILD_MEMBER'::public."GuildLevel",
           "guildMemberApprovedAt" = source_now, "updatedAt" = source_now
     WHERE id = source_seller.id;
    audit_metadata := pg_catalog.jsonb_build_object('verificationId', source_verification.id);
  ELSIF p_operation = 'REJECT_GUILD_MEMBER' THEN
    IF source_verification.status <> 'PENDING'::public."VerificationStatus" THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    UPDATE public."MakerVerification"
       SET status = 'REJECTED'::public."VerificationStatus",
           "reviewedById" = p_actor_id, "reviewedAt" = source_now,
           "reviewNotes" = p_review_notes, "updatedAt" = source_now
     WHERE id = source_verification.id;
    audit_reason := p_review_notes;
    audit_metadata := pg_catalog.jsonb_build_object('verificationId', source_verification.id);
  ELSIF p_operation = 'REVOKE_GUILD_MEMBER' THEN
    IF source_seller."guildLevel" <> 'GUILD_MEMBER'::public."GuildLevel"
       OR source_verification.status NOT IN (
         'APPROVED'::public."VerificationStatus",
         'GUILD_MASTER_REJECTED'::public."VerificationStatus"
       ) THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    audit_reason := 'Guild Member badge revoked by Grainline staff.';
    UPDATE public."MakerVerification"
       SET status = 'REJECTED'::public."VerificationStatus",
           "reviewedById" = p_actor_id, "reviewedAt" = source_now,
           "reviewNotes" = audit_reason, "updatedAt" = source_now
     WHERE id = source_verification.id;
    UPDATE public."SellerProfilePrivate" AS seller_private
       SET "consecutiveMetricFailures" = 0, "metricWarningSentAt" = NULL,
           "listingsBelowThresholdSince" = NULL, "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE seller_private."sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "guildLevel" = 'NONE'::public."GuildLevel", "isVerifiedMaker" = false,
           "consecutiveMetricFailures" = 0, "metricWarningSentAt" = NULL,
           "listingsBelowThresholdSince" = NULL, "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE id = source_seller.id;
  ELSIF p_operation = 'APPROVE_GUILD_MASTER' THEN
    IF source_verification.status <> 'GUILD_MASTER_PENDING'::public."VerificationStatus"
       OR NOT source_seller."ownerAccountActive"
       OR source_seller."guildLevel" <> 'GUILD_MEMBER'::public."GuildLevel" THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    UPDATE public."MakerVerification"
       SET status = 'GUILD_MASTER_APPROVED'::public."VerificationStatus",
           "reviewedById" = p_actor_id, "reviewedAt" = source_now,
           "updatedAt" = source_now
     WHERE id = source_verification.id;
    UPDATE public."SellerProfilePrivate" AS seller_private
       SET "guildMasterApprovedAt" = source_now, "updatedAt" = source_now
     WHERE seller_private."sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "guildLevel" = 'GUILD_MASTER'::public."GuildLevel",
           "guildMasterApprovedAt" = source_now, "updatedAt" = source_now
     WHERE id = source_seller.id;
    audit_metadata := pg_catalog.jsonb_build_object('verificationId', source_verification.id);
  ELSIF p_operation = 'REJECT_GUILD_MASTER' THEN
    IF source_verification.status <> 'GUILD_MASTER_PENDING'::public."VerificationStatus" THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    UPDATE public."MakerVerification"
       SET status = 'GUILD_MASTER_REJECTED'::public."VerificationStatus",
           "reviewedById" = p_actor_id, "reviewedAt" = source_now,
           "updatedAt" = source_now
     WHERE id = source_verification.id;
    UPDATE public."SellerProfilePrivate" AS seller_private
       SET "guildMasterReviewNotes" = p_review_notes, "updatedAt" = source_now
     WHERE seller_private."sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "guildMasterReviewNotes" = p_review_notes, "updatedAt" = source_now
     WHERE id = source_seller.id;
    audit_reason := p_review_notes;
    audit_metadata := pg_catalog.jsonb_build_object('verificationId', source_verification.id);
  ELSIF p_operation = 'REVOKE_GUILD_MASTER' THEN
    IF source_seller."guildLevel" <> 'GUILD_MASTER'::public."GuildLevel"
       OR source_verification.status <> 'GUILD_MASTER_APPROVED'::public."VerificationStatus" THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    audit_reason := 'Guild Master badge revoked by Grainline staff.';
    UPDATE public."MakerVerification"
       SET status = 'GUILD_MASTER_REJECTED'::public."VerificationStatus",
           "reviewedById" = p_actor_id, "reviewedAt" = source_now,
           "reviewNotes" = audit_reason, "updatedAt" = source_now
     WHERE id = source_verification.id;
    UPDATE public."SellerProfilePrivate" AS seller_private
       SET "guildMasterApprovedAt" = NULL, "guildMasterAppliedAt" = NULL,
           "guildMasterReviewNotes" = NULL, "consecutiveMetricFailures" = 0,
           "metricWarningSentAt" = NULL, "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE seller_private."sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "guildLevel" = 'GUILD_MEMBER'::public."GuildLevel",
           "guildMasterApprovedAt" = NULL, "guildMasterAppliedAt" = NULL,
           "guildMasterReviewNotes" = NULL, "consecutiveMetricFailures" = 0,
           "metricWarningSentAt" = NULL, "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE id = source_seller.id;
  ELSE
    IF source_seller."guildLevel" <> 'NONE'::public."GuildLevel"
       OR NOT source_seller."ownerAccountActive"
       OR source_private."guildMemberApprovedAt" IS NULL
       OR source_verification.status <> 'REJECTED'::public."VerificationStatus" THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    SELECT guard.blocked INTO unresolved_case_blocked
      FROM public.grainline_case_guild_unresolved_guard(source_seller.id) AS guard;
    IF COALESCE(unresolved_case_blocked, false) THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    SELECT pg_catalog.count(*)::bigint INTO active_listing_count
      FROM public."Listing" AS listing
     WHERE listing."sellerId" = source_seller.id
       AND listing.status = 'ACTIVE'::public."ListingStatus"
       AND listing."isPrivate" = false;
    IF active_listing_count < 5 THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    UPDATE public."MakerVerification"
       SET status = 'APPROVED'::public."VerificationStatus",
           "reviewedById" = p_actor_id, "reviewedAt" = source_now,
           "reviewNotes" = NULL, "updatedAt" = source_now
     WHERE id = source_verification.id;
    UPDATE public."SellerProfilePrivate" AS seller_private
       SET "consecutiveMetricFailures" = 0, "metricWarningSentAt" = NULL,
           "listingsBelowThresholdSince" = NULL, "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE seller_private."sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "guildLevel" = 'GUILD_MEMBER'::public."GuildLevel",
           "isVerifiedMaker" = true, "consecutiveMetricFailures" = 0,
           "metricWarningSentAt" = NULL, "listingsBelowThresholdSince" = NULL,
           "lastMetricCheckAt" = source_now, "updatedAt" = source_now
     WHERE id = source_seller.id;
  END IF;

  audit_action := p_operation;
  audit_id := pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", reason, metadata,
    undone, "createdAt"
  ) VALUES (
    audit_id, p_actor_id, audit_action, 'SELLER_PROFILE', source_seller.id,
    audit_reason, audit_metadata, false, source_now
  );

  RETURN QUERY SELECT true, audit_id, source_seller.id,
                      source_seller."userId", source_seller."displayName"::text;
END
$grainline_seller_guild_staff_transition$;

REVOKE ALL ON FUNCTION public.grainline_seller_guild_staff_transition(
  text, text, text, text, text, boolean
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_guild_staff_transition(
  text, text, text, text, text, boolean
) TO grainline_staff_read_runtime;

COMMIT;
