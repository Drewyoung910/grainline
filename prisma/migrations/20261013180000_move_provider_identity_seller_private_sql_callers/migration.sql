-- Move signed provider-account lookups and the bounded ban-repair
-- projection onto SellerProfilePrivate. The narrow compatibility writer keeps
-- the predecessor Stripe account column synchronized until deployment drain;
-- it has no runtime grant and must be replaced before that column is retired.
--
-- Existing public contracts, security modes and caller grants remain unchanged.

BEGIN;

DO $seller_private_provider_identity_preflight$
BEGIN
  IF pg_catalog.to_regclass('public."SellerProfilePrivate"') IS NULL THEN
    RAISE EXCEPTION 'SellerProfilePrivate table is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
           'public."SellerProfilePrivate"'::pg_catalog.regclass
       AND attribute.attname = 'stripeAccountId'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'SellerProfilePrivate stripeAccountId is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
           'public."SellerProfilePrivate"'::pg_catalog.regclass
       AND attribute.attname = 'updatedAt'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'SellerProfilePrivate updatedAt is missing';
  END IF;
END
$seller_private_provider_identity_preflight$;

-- Latest payout definition; only provider-account lookup moves to the private companion.
CREATE OR REPLACE FUNCTION public.grainline_seller_payout_event_apply(
  p_event_id text,
  p_claim_generation bigint,
  p_event_created_seconds bigint,
  p_connected_account_id text,
  p_payout_id text,
  p_amount_cents integer,
  p_currency text,
  p_failure_code text,
  p_failure_message text
)
RETURNS TABLE(action text, payout_event_id text, seller_user_id text)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_payout_event_apply$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_payout public."SellerPayoutEvent"%ROWTYPE;
  source_seller_id text;
  source_seller_user_id text;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  source_now_seconds bigint :=
    pg_catalog.floor(EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()))::bigint;
  normalized_failure_code text :=
    NULLIF(pg_catalog.btrim(p_failure_code), '');
  normalized_failure_message text :=
    NULLIF(pg_catalog.btrim(p_failure_message), '');
  target_payout_event_id text;
BEGIN
  IF p_event_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_event_id)) NOT BETWEEN 1 AND 255
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_event_created_seconds IS NULL
     OR p_event_created_seconds < source_now_seconds - (30 * 24 * 60 * 60)
     OR p_event_created_seconds > source_now_seconds + (10 * 60)
     OR p_connected_account_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_connected_account_id)) NOT BETWEEN 1 AND 255
     OR p_payout_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_payout_id)) NOT BETWEEN 1 AND 255
     OR (p_amount_cents IS NOT NULL AND p_amount_cents < 0)
     OR p_currency IS NULL OR p_currency !~ '^[a-z]{3}$'
     OR (p_failure_code IS NOT NULL AND pg_catalog.char_length(p_failure_code) > 100)
     OR (p_failure_message IS NOT NULL AND pg_catalog.char_length(p_failure_message) > 1000) THEN
    RAISE EXCEPTION 'Seller payout event input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT event.*
    INTO source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_event.type IS DISTINCT FROM 'payout.failed'
     OR source_event."sourceObjectId" IS DISTINCT FROM p_payout_id
     OR source_event."claimGeneration" IS DISTINCT FROM p_claim_generation
     OR source_event."processingStartedAt" IS NULL
     OR source_event."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Seller payout webhook claim is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT seller.id, seller."userId"
    INTO source_seller_id, source_seller_user_id
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller_private."stripeAccountId" = p_connected_account_id
   FOR SHARE OF seller, seller_private;
  IF NOT FOUND THEN
    RETURN QUERY
      SELECT 'ignored_unknown_account'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- A row lock cannot serialize the first insert because no payout row exists
  -- yet. Lock the signed payout identity before the lookup so concurrent
  -- distinct events cannot race into a unique violation or apply out of order.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_payout_id, 620081501)
  );

  SELECT payout.*
    INTO source_payout
    FROM public."SellerPayoutEvent" AS payout
   WHERE payout."stripePayoutId" = p_payout_id
   FOR UPDATE;

  IF NOT FOUND THEN
    target_payout_event_id := pg_catalog.gen_random_uuid()::text;
    INSERT INTO public."SellerPayoutEvent" (
      id,
      "sellerProfileId",
      "stripePayoutId",
      status,
      "amountCents",
      currency,
      "failureCode",
      "failureMessage",
      "stripeEventId",
      "stripeEventCreatedSeconds",
      "createdAt",
      "updatedAt"
    ) VALUES (
      target_payout_event_id,
      source_seller_id,
      p_payout_id,
      'failed',
      p_amount_cents,
      p_currency,
      normalized_failure_code,
      normalized_failure_message,
      p_event_id,
      p_event_created_seconds,
      source_now,
      source_now
    );
    RETURN QUERY
      SELECT 'inserted'::text, target_payout_event_id, source_seller_user_id;
    RETURN;
  END IF;

  IF source_payout."sellerProfileId" IS DISTINCT FROM source_seller_id THEN
    RAISE EXCEPTION 'Seller payout ownership is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF source_payout."stripeEventId" = p_event_id THEN
    IF source_payout."stripeEventCreatedSeconds" IS NULL THEN
      UPDATE public."SellerPayoutEvent" AS payout
         SET status = 'failed',
             "amountCents" = p_amount_cents,
             currency = p_currency,
             "failureCode" = normalized_failure_code,
             "failureMessage" = normalized_failure_message,
             "stripeEventCreatedSeconds" = p_event_created_seconds,
             "updatedAt" = source_now
       WHERE payout.id = source_payout.id;
      RETURN QUERY
        SELECT 'legacy_converged'::text, source_payout.id, source_seller_user_id;
      RETURN;
    END IF;

    IF source_payout."stripeEventCreatedSeconds" IS DISTINCT FROM p_event_created_seconds
       OR source_payout.status IS DISTINCT FROM 'failed'
       OR source_payout."amountCents" IS DISTINCT FROM p_amount_cents
       OR source_payout.currency IS DISTINCT FROM p_currency
       OR source_payout."failureCode" IS DISTINCT FROM normalized_failure_code
       OR source_payout."failureMessage" IS DISTINCT FROM normalized_failure_message THEN
      RAISE EXCEPTION 'Seller payout replay payload is inconsistent'
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN QUERY
      SELECT 'already_applied'::text, source_payout.id, source_seller_user_id;
    RETURN;
  END IF;

  IF source_payout."stripeEventCreatedSeconds" IS NULL THEN
    RAISE EXCEPTION 'Legacy seller payout event requires ordering review'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_event_created_seconds < source_payout."stripeEventCreatedSeconds" THEN
    RETURN QUERY
      SELECT 'stale_ignored'::text, source_payout.id, source_seller_user_id;
    RETURN;
  END IF;

  IF p_event_created_seconds = source_payout."stripeEventCreatedSeconds" THEN
    RAISE EXCEPTION 'Seller payout event ordering is ambiguous'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public."SellerPayoutEvent" AS payout
     SET status = 'failed',
         "amountCents" = p_amount_cents,
         currency = p_currency,
         "failureCode" = normalized_failure_code,
         "failureMessage" = normalized_failure_message,
         "stripeEventId" = p_event_id,
         "stripeEventCreatedSeconds" = p_event_created_seconds,
         "updatedAt" = source_now
   WHERE payout.id = source_payout.id;

  RETURN QUERY
    SELECT 'updated'::text, source_payout.id, source_seller_user_id;
END
$grainline_seller_payout_event_apply$;

-- Transition-only fixed writer. It is private to database-owned functions.
CREATE OR REPLACE FUNCTION public.grainline_seller_profile_deauthorize_compat(
  p_seller_profile_id text,
  p_account_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_profile_deauthorize_compat$
DECLARE
  seller_was_public boolean := false;
  private_account_matches boolean := false;
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id = ''
     OR pg_catalog.char_length(p_seller_profile_id) > 191
     OR p_account_id IS NULL
     OR p_account_id !~ '^acct_[A-Za-z0-9_]+$'
     OR pg_catalog.char_length(p_account_id) > 255 THEN
    RAISE EXCEPTION 'Seller provider deauthorization input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT
    seller_private."stripeAccountId" = p_account_id,
    seller_private."stripeAccountId" = p_account_id
      AND seller."chargesEnabled"
    INTO private_account_matches, seller_was_public
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller.id = p_seller_profile_id
   FOR UPDATE OF seller, seller_private;

  IF NOT FOUND OR private_account_matches IS DISTINCT FROM true THEN
    RETURN false;
  END IF;

  UPDATE public."SellerProfilePrivate" AS seller_private
     SET "stripeAccountId" = NULL,
         "updatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
   WHERE seller_private."sellerProfileId" = p_seller_profile_id
     AND seller_private."stripeAccountId" = p_account_id;

  -- Keep the predecessor representation compatible until old deployments are
  -- drained. The final cutover must replace this bridge before dropping the
  -- predecessor column.
  UPDATE public."SellerProfile" AS seller
     SET "chargesEnabled" = false,
         "stripeAccountId" = NULL
   WHERE seller.id = p_seller_profile_id;

  RETURN seller_was_public;
END
$grainline_seller_profile_deauthorize_compat$;

REVOKE ALL ON FUNCTION public.grainline_seller_profile_deauthorize_compat(text, text)
  FROM PUBLIC, grainline_app_runtime;

-- Latest deauthorization definition; lookup and mutation use the private boundary.
CREATE OR REPLACE FUNCTION public.grainline_stripe_seller_deauthorization_apply(
  p_event_id text,
  p_claim_generation bigint,
  p_account_id text,
  p_event_created_at timestamp(3) without time zone
)
RETURNS TABLE(
  outcome text,
  seller_profile_id text,
  public_visibility_changed boolean,
  affected_order_count integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_stripe_seller_deauthorization_apply$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  prior_application public."SellerDeauthorizationApplication"%ROWTYPE;
  source_seller_id text;
  source_seller_user_id text;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  seller_was_public boolean := false;
  changed_order_count integer := 0;
BEGIN
  IF p_event_id IS NULL
     OR p_event_id !~ '^evt_[A-Za-z0-9_]+$'
     OR pg_catalog.char_length(p_event_id) > 255
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_account_id IS NULL
     OR p_account_id !~ '^acct_[A-Za-z0-9_]+$'
     OR pg_catalog.char_length(p_account_id) > 255
     OR p_event_created_at IS NULL
     -- Keep the fixed writer aligned with the signed-envelope gate. Stripe
     -- permits a manually resent event for 30 days, and the Accounts-v2 route
     -- accepts ten minutes of positive clock skew. Preserve one minute beyond
     -- the age gate for that route's bounded 30-second execution plus clock
     -- transit; a narrower database window could accept the envelope and then
     -- strand seller-account closure processing.
     OR p_event_created_at < source_now - interval '30 days 1 minute'
     OR p_event_created_at > source_now + interval '10 minutes' THEN
    RAISE EXCEPTION 'Stripe seller deauthorization input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT event.*
    INTO source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_event.type <> 'v2.core.account.closed'
     OR source_event."sourceObjectId" IS DISTINCT FROM p_account_id
     OR source_event."claimGeneration" IS DISTINCT FROM p_claim_generation
     OR source_event."processingStartedAt" IS NULL
     OR source_event."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Stripe seller deauthorization authority is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT application.*
    INTO prior_application
    FROM public."SellerDeauthorizationApplication" AS application
   WHERE application."eventId" = p_event_id;
  IF FOUND THEN
    IF prior_application."sourceAccountId" IS DISTINCT FROM p_account_id
       OR prior_application."eventCreatedAt" IS DISTINCT FROM p_event_created_at THEN
      RAISE EXCEPTION 'Stripe seller deauthorization replay drifted'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN QUERY SELECT
      CASE WHEN prior_application."sellerProfileId" IS NULL THEN 'absent' ELSE 'replayed' END,
      prior_application."sellerProfileId"::text,
      prior_application."publicVisibilityChanged",
      prior_application."orderCount";
    RETURN;
  END IF;

  -- Serialize distinct signed events for the same Connect account before
  -- consulting current or historical ownership.
  PERFORM pg_catalog.pg_advisory_xact_lock(913346, pg_catalog.hashtext(p_account_id));

  SELECT seller.id, seller."userId"
    INTO source_seller_id, source_seller_user_id
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller_private."stripeAccountId" = p_account_id;

  IF source_seller_id IS NULL THEN
    SELECT application."sellerProfileId"
      INTO source_seller_id
      FROM public."SellerDeauthorizationApplication" AS application
     WHERE application."sourceAccountId" = p_account_id
       AND application."sellerProfileId" IS NOT NULL
     ORDER BY application."appliedAt" DESC, application."eventId" DESC
     LIMIT 1;
    IF source_seller_id IS NOT NULL THEN
      SELECT seller."userId"
        INTO source_seller_user_id
        FROM public."SellerProfile" AS seller
       WHERE seller.id = source_seller_id;
    END IF;
  END IF;

  IF source_seller_user_id IS NOT NULL THEN
    PERFORM actor.id
      FROM public."User" AS actor
     WHERE actor.id = source_seller_user_id
     FOR SHARE;
    IF NOT FOUND THEN
      source_seller_user_id := NULL;
    END IF;
  END IF;

  IF source_seller_user_id IS NOT NULL THEN
    PERFORM seller.id
      FROM public."SellerProfile" AS seller
     WHERE seller.id = source_seller_id
       AND seller."userId" = source_seller_user_id
     FOR UPDATE;
    IF NOT FOUND THEN
      source_seller_user_id := NULL;
    END IF;
  END IF;

  IF source_seller_user_id IS NOT NULL THEN
    SELECT public.grainline_seller_profile_deauthorize_compat(
      source_seller_id,
      p_account_id
    )
      INTO STRICT seller_was_public;

    UPDATE public."Order" AS target_order
       SET "sellerDeauthorizedAt" = p_event_created_at,
           "sellerDeauthorizationEventId" = p_event_id,
           "reviewNeeded" = true,
           "reviewNote" = CASE
             WHEN pg_catalog.btrim(COALESCE(target_order."reviewNote", '')) = ''
               THEN 'Seller Stripe account was deauthorized after payment. Staff review is required before fulfillment.'
             ELSE target_order."reviewNote"
           END
     WHERE target_order."sellerProfileId" = source_seller_id
       AND target_order."paidAt" IS NOT NULL
       AND target_order."paidAt" <= p_event_created_at
       AND target_order."fulfillmentStatus"::text IN ('PENDING', 'READY_FOR_PICKUP', 'SHIPPED')
       AND target_order."sellerDeauthorizedAt" IS NULL;
    GET DIAGNOSTICS changed_order_count = ROW_COUNT;

    INSERT INTO public."SystemAuditLog" (
      id, "actorType", "actorId", action, "targetType", "targetId",
      reason, metadata, "createdAt"
    ) VALUES (
      'stripe-deauthorization:' || pg_catalog.gen_random_uuid()::text,
      'webhook', p_event_id, 'STRIPE_ACCOUNT_DEAUTHORIZED',
      'SELLER_PROFILE', source_seller_id, NULL,
      pg_catalog.jsonb_build_object(
        'stripeEventType', source_event.type,
        'stripeAccountId', p_account_id,
        'previousChargesEnabled', seller_was_public,
        'chargesEnabled', false,
        'stripeAccountCleared', true,
        'affectedOrderCount', changed_order_count
      ),
      source_now
    );
  END IF;

  INSERT INTO public."SellerDeauthorizationApplication" (
    "eventId", "sourceAccountId", "sellerProfileId", "eventCreatedAt",
    "appliedAt", "publicVisibilityChanged", "orderCount"
  ) VALUES (
    p_event_id, p_account_id, source_seller_id, p_event_created_at,
    source_now, seller_was_public, changed_order_count
  );

  RETURN QUERY SELECT
    CASE WHEN source_seller_id IS NULL THEN 'absent' ELSE 'applied' END,
    source_seller_id,
    seller_was_public,
    changed_order_count;
END
$grainline_stripe_seller_deauthorization_apply$;

-- Latest ban-repair projection; provider identity comes from the private companion.
CREATE OR REPLACE FUNCTION public.grainline_user_ban_repair_target(
  p_original_action_id text,
  p_target_id text
)
RETURNS TABLE (
  "clerkId" text,
  banned boolean,
  "deletedAt" timestamp(3),
  "sellerProfileId" text,
  "stripeAccountId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_ban_repair_target$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'User ban repair requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_original_action_id IS NULL OR p_original_action_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_id IS NULL OR p_target_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User ban repair target input is invalid' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT target."clerkId"::text, target.banned, target."deletedAt",
         seller.id, seller_private."stripeAccountId"::text
    FROM public."User" AS target
    LEFT JOIN public."SellerProfile" AS seller ON seller."userId" = target.id
    LEFT JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE target.id = p_target_id
     AND target.banned = true
     AND target."deletedAt" IS NULL
     AND EXISTS (
       SELECT 1
         FROM public."AdminAuditLog" AS audit
        WHERE audit.id = p_original_action_id
          AND audit.action = 'BAN_USER'
          AND audit."targetType" = 'USER'
          AND audit."targetId" = p_target_id
          AND audit.undone = false
          AND audit.metadata->>'externalSyncVersion' = '1'
          AND audit.metadata->>'appliedBannedAt' = pg_catalog.to_char(
            target."bannedAt",
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
     );
END
$grainline_user_ban_repair_target$;

COMMIT;
