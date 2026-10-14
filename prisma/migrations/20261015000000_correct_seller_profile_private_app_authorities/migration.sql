-- Forward-only corrections for the live SellerProfile private operations.

-- No table shape, RLS state, or direct table grant changes occur here.

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
     OR p_cohort IS NULL
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
     OR p_operation IS NULL
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
    audit_reason := pg_catalog.left(p_review_notes, 500);
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
    audit_reason := pg_catalog.left(p_review_notes, 500);
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

CREATE OR REPLACE FUNCTION public.grainline_seller_account_deletion_reconciliation_clear(
  p_user_id text,
  p_stripe_account_id text,
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_account_deletion_reconciliation_clear$
DECLARE
  seller_profile_id text;
  public_needed boolean;
  private_needed boolean;
  public_note text;
  private_note text;
  changed_at timestamp(3);
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_stripe_account_id IS NULL
       OR p_stripe_account_id !~ '^acct_[A-Za-z0-9_]{1,249}$'
     OR p_side_effect_id IS NULL
       OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Seller reconciliation-clear input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id
     AND effect."userId" = p_user_id
     AND effect.kind = 'STRIPE_REJECT'
     AND effect.status = 'PROCESSING'
     AND effect."claimGeneration" = p_claim_generation
     AND effect."claimToken" = p_claim_token
     AND effect.payload->>'stripeAccountId' = p_stripe_account_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller reconciliation-clear source is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller.id,
         seller."manualStripeReconciliationNeeded",
         seller_private."manualStripeReconciliationNeeded",
         seller."manualStripeReconciliationNote",
         seller_private."manualStripeReconciliationNote"
    INTO seller_profile_id, public_needed, private_needed, public_note, private_note
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller."userId" = p_user_id
   FOR UPDATE OF seller, seller_private;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF public_needed IS DISTINCT FROM private_needed
     OR public_note IS DISTINCT FROM private_note THEN
    RAISE EXCEPTION 'Seller reconciliation representations disagree'
      USING ERRCODE = '40001';
  END IF;
  IF NOT private_needed
     OR private_note IS NULL
     OR pg_catalog.substr(
       private_note,
       1,
       pg_catalog.length(
         'Account deletion could not reject Stripe Connect account ' || p_stripe_account_id
       )
     ) <> 'Account deletion could not reject Stripe Connect account ' || p_stripe_account_id THEN
    RETURN false;
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SellerProfilePrivate"
     SET "manualStripeReconciliationNeeded" = false,
         "manualStripeReconciliationNote" = NULL,
         "updatedAt" = changed_at
   WHERE "sellerProfileId" = seller_profile_id;
  UPDATE public."SellerProfile"
     SET "manualStripeReconciliationNeeded" = false,
         "manualStripeReconciliationNote" = NULL,
         "updatedAt" = changed_at
   WHERE id = seller_profile_id
     AND "userId" = p_user_id;

  RETURN true;
END
$grainline_seller_account_deletion_reconciliation_clear$;

CREATE OR REPLACE FUNCTION public.grainline_seller_staff_orderability_state(
  p_actor_id text,
  p_target_user_id text
)
RETURNS TABLE (
  id text,
  "chargesEnabled" boolean,
  "vacationMode" boolean,
  "stripeAccountId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_staff_orderability_state$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller orderability state requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_user_id IS NULL
       OR p_target_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller orderability-state input is invalid'
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
    RAISE EXCEPTION 'Seller orderability-state actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."chargesEnabled",
         seller."vacationMode",
         seller_private."stripeAccountId"::text
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller."userId" = p_target_user_id;
END
$grainline_seller_staff_orderability_state$;

REVOKE ALL ON FUNCTION public.grainline_seller_guild_staff_roster(text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_guild_staff_transition(
  text, text, text, text, text, boolean
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_account_deletion_reconciliation_clear(
  text, text, text, bigint, uuid
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_staff_orderability_state(text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_seller_guild_staff_roster(text, text)
  TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_guild_staff_transition(
  text, text, text, text, text, boolean
) TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_account_deletion_reconciliation_clear(
  text, text, text, bigint, uuid
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_staff_orderability_state(text, text)
  TO grainline_staff_read_runtime;

COMMIT;
