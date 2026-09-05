-- DRAFT ONLY: restart-safe Stripe seller deauthorization authority.
--
-- This candidate is additive. Promotion requires independent catalog, role,
-- migration-tree, compatibility, application and production review.

BEGIN;

ALTER TABLE public."Order"
  ADD COLUMN "sellerDeauthorizedAt" timestamp(3) without time zone,
  ADD COLUMN "sellerDeauthorizationEventId" varchar(255);

ALTER TABLE public."Order"
  ADD CONSTRAINT "Order_sellerDeauthorization_check"
  CHECK (
    ("sellerDeauthorizedAt" IS NULL AND "sellerDeauthorizationEventId" IS NULL)
    OR (
      "sellerDeauthorizedAt" IS NOT NULL
      AND "sellerDeauthorizationEventId" ~ '^evt_[A-Za-z0-9_]+$'
      AND pg_catalog.char_length("sellerDeauthorizationEventId") <= 255
    )
  ) NOT VALID;

ALTER TABLE public."Order"
  VALIDATE CONSTRAINT "Order_sellerDeauthorization_check";

CREATE INDEX "Order_sellerProfileId_sellerDeauthorizedAt_idx"
  ON public."Order" ("sellerProfileId", "sellerDeauthorizedAt")
  WHERE "sellerDeauthorizedAt" IS NOT NULL;

CREATE TABLE public."SellerDeauthorizationApplication" (
  "eventId" varchar(255) PRIMARY KEY,
  "sourceAccountId" varchar(255) NOT NULL,
  "sellerProfileId" varchar(191),
  "eventCreatedAt" timestamp(3) without time zone NOT NULL,
  "appliedAt" timestamp(3) without time zone NOT NULL,
  "publicVisibilityChanged" boolean NOT NULL,
  "orderCount" integer NOT NULL,
  CONSTRAINT "SellerDeauthorizationApplication_eventId_check"
    CHECK (
      "eventId" ~ '^evt_[A-Za-z0-9_]+$'
      AND pg_catalog.char_length("eventId") <= 255
    ),
  CONSTRAINT "SellerDeauthorizationApplication_sourceAccountId_check"
    CHECK (
      "sourceAccountId" ~ '^acct_[A-Za-z0-9_]+$'
      AND pg_catalog.char_length("sourceAccountId") <= 255
    ),
  CONSTRAINT "SellerDeauthorizationApplication_sellerProfileId_check"
    CHECK (
      "sellerProfileId" IS NULL
      OR pg_catalog.char_length("sellerProfileId") BETWEEN 1 AND 191
    ),
  CONSTRAINT "SellerDeauthorizationApplication_orderCount_check"
    CHECK ("orderCount" BETWEEN 0 AND 1000000)
);

CREATE INDEX "SellerDeauthorizationApplication_sourceAccountId_appliedAt_idx"
  ON public."SellerDeauthorizationApplication" ("sourceAccountId", "appliedAt" DESC, "eventId");

ALTER TABLE public."SellerDeauthorizationApplication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SellerDeauthorizationApplication" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."SellerDeauthorizationApplication"
  FROM PUBLIC, grainline_app_runtime;

CREATE FUNCTION public.grainline_seller_deauthorization_application_immutable()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_deauthorization_application_immutable$
BEGIN
  RAISE EXCEPTION 'Seller deauthorization applications are immutable'
    USING ERRCODE = 'object_not_in_prerequisite_state';
END
$grainline_seller_deauthorization_application_immutable$;

CREATE TRIGGER "SellerDeauthorizationApplication_immutable"
BEFORE UPDATE OR DELETE ON public."SellerDeauthorizationApplication"
FOR EACH ROW EXECUTE FUNCTION public.grainline_seller_deauthorization_application_immutable();

CREATE FUNCTION public.grainline_stripe_seller_deauthorization_apply(
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
     OR p_event_created_at < source_now - interval '8 days'
     OR p_event_created_at > source_now + interval '5 minutes' THEN
    RAISE EXCEPTION 'Stripe seller deauthorization input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT event.*
    INTO source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_event.type <> 'account.application.deauthorized'
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
   WHERE seller."stripeAccountId" = p_account_id;

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
    SELECT seller."stripeAccountId" = p_account_id
           AND seller."chargesEnabled"
      INTO STRICT seller_was_public
      FROM public."SellerProfile" AS seller
     WHERE seller.id = source_seller_id;

    UPDATE public."SellerProfile" AS seller
       SET "chargesEnabled" = false,
           "stripeAccountId" = NULL
     WHERE seller.id = source_seller_id
       AND seller."stripeAccountId" = p_account_id;

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

REVOKE ALL ON FUNCTION public.grainline_seller_deauthorization_application_immutable()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_stripe_seller_deauthorization_apply(
  text, bigint, text, timestamp without time zone
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grainline_stripe_seller_deauthorization_apply(
  text, bigint, text, timestamp without time zone
) TO grainline_app_runtime;

COMMIT;
