-- Additive email-delivery ledger preparation.
--
-- This migration does not enable RLS or revoke predecessor table grants. It
-- adds generation-fenced worker operations and the compatible data shape that
-- the dual-reader application needs before the email tables can be isolated.

BEGIN;

DO $preflight$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'EmailOutbox',
    'EmailSuppression',
    'NewsletterSubscriber',
    'ResendWebhookEvent'
  ] LOOP
    IF pg_catalog.to_regclass('public.' || pg_catalog.quote_ident(relation_name)) IS NULL THEN
      RAISE EXCEPTION 'Required email-service relation % is missing', relation_name;
    END IF;
  END LOOP;

  IF pg_catalog.to_regprocedure('public.grainline_user_email_account_state_by_id(text,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.grainline_user_email_account_state_by_email(text)') IS NULL
     OR pg_catalog.to_regprocedure('public.grainline_user_email_recipient(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Required user email-delivery authorities are missing';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (
        VALUES
          ('public."EmailOutbox"'::pg_catalog.regclass, 'payloadVersion'::text),
          ('public."EmailOutbox"'::pg_catalog.regclass, 'payload'::text),
          ('public."EmailOutbox"'::pg_catalog.regclass, 'lane'::text),
          ('public."EmailOutbox"'::pg_catalog.regclass, 'claimGeneration'::text),
          ('public."EmailOutbox"'::pg_catalog.regclass, 'claimToken'::text),
          ('public."EmailOutbox"'::pg_catalog.regclass, 'processingStartedAt'::text),
          ('public."EmailOutbox"'::pg_catalog.regclass, 'firstProviderAttemptAt'::text),
          ('public."EmailOutbox"'::pg_catalog.regclass, 'providerMessageId'::text),
          ('public."EmailOutbox"'::pg_catalog.regclass, 'acknowledgedAt'::text),
          ('public."EmailOutbox"'::pg_catalog.regclass, 'acknowledgedById'::text),
          ('public."EmailOutbox"'::pg_catalog.regclass, 'acknowledgement'::text),
          ('public."ResendWebhookEvent"'::pg_catalog.regclass, 'claimGeneration'::text),
          ('public."ResendWebhookEvent"'::pg_catalog.regclass, 'claimToken'::text),
          ('public."ResendWebhookEvent"'::pg_catalog.regclass, 'attempts'::text),
          ('public."ResendWebhookEvent"'::pg_catalog.regclass, 'nextAttemptAt'::text),
          ('public."ResendWebhookEvent"'::pg_catalog.regclass, 'acknowledgedAt'::text),
          ('public."ResendWebhookEvent"'::pg_catalog.regclass, 'acknowledgedById'::text),
          ('public."ResendWebhookEvent"'::pg_catalog.regclass, 'acknowledgement'::text),
          ('public."NewsletterSubscriber"'::pg_catalog.regclass, 'deactivatedAt'::text)
      ) AS expected_new_column(attrelid, attname)
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = expected_new_column.attrelid
       AND attribute.attname = expected_new_column.attname
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'Email-service preparation columns already exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public."EmailOutbox"'::pg_catalog.regclass
       AND attname = 'subject'
       AND attnotnull
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public."EmailOutbox"'::pg_catalog.regclass
       AND attname = 'html'
       AND attnotnull
  ) THEN
    RAISE EXCEPTION 'EmailOutbox legacy representation columns drifted';
  END IF;
END
$preflight$;

ALTER TABLE public."EmailOutbox"
  ALTER COLUMN subject DROP NOT NULL,
  ALTER COLUMN html DROP NOT NULL,
  ADD COLUMN "payloadVersion" integer,
  ADD COLUMN payload jsonb,
  ADD COLUMN lane varchar(20),
  ADD COLUMN "claimGeneration" bigint NOT NULL DEFAULT 0,
  ADD COLUMN "claimToken" uuid,
  ADD COLUMN "processingStartedAt" timestamp(3) without time zone,
  ADD COLUMN "firstProviderAttemptAt" timestamp(3) without time zone,
  ADD COLUMN "providerMessageId" varchar(255),
  ADD COLUMN "acknowledgedAt" timestamp(3) without time zone,
  ADD COLUMN "acknowledgedById" varchar(191),
  ADD COLUMN acknowledgement varchar(1000);

ALTER TABLE public."ResendWebhookEvent"
  ADD COLUMN "claimGeneration" bigint NOT NULL DEFAULT 0,
  ADD COLUMN "claimToken" uuid,
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" timestamp(3) without time zone,
  ADD COLUMN "acknowledgedAt" timestamp(3) without time zone,
  ADD COLUMN "acknowledgedById" varchar(191),
  ADD COLUMN acknowledgement varchar(1000);

ALTER TABLE public."NewsletterSubscriber"
  ADD COLUMN "deactivatedAt" timestamp(3) without time zone;

UPDATE public."NewsletterSubscriber"
   SET "deactivatedAt" = COALESCE("confirmedAt", "confirmationExpiresAt", "subscribedAt")
 WHERE active = false
   AND "deactivatedAt" IS NULL;

ALTER TABLE public."EmailOutbox"
  ADD CONSTRAINT "EmailOutbox_claimGeneration_chk"
  CHECK ("claimGeneration" >= 0) NOT VALID,
  ADD CONSTRAINT "EmailOutbox_attempts_nonnegative_chk"
  CHECK (attempts >= 0) NOT VALID,
  ADD CONSTRAINT "EmailOutbox_payloadVersion_chk"
  CHECK ("payloadVersion" IS NULL OR "payloadVersion" > 0) NOT VALID,
  ADD CONSTRAINT "EmailOutbox_payload_size_chk"
  CHECK (payload IS NULL OR pg_catalog.octet_length(payload::text) <= 131072) NOT VALID,
  ADD CONSTRAINT "EmailOutbox_lane_chk"
  CHECK (lane IS NULL OR lane IN ('TRANSACTIONAL', 'OPTIONAL')) NOT VALID,
  ADD CONSTRAINT "EmailOutbox_source_pair_chk"
  CHECK (("sourceType" IS NULL) = ("sourceId" IS NULL)) NOT VALID,
  ADD CONSTRAINT "EmailOutbox_representation_chk"
  CHECK (
    (subject IS NOT NULL AND html IS NOT NULL AND payload IS NULL AND "payloadVersion" IS NULL)
    OR
    (subject IS NULL AND html IS NULL AND payload IS NOT NULL AND "payloadVersion" IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT "EmailOutbox_claim_pair_chk"
  CHECK (("claimToken" IS NULL) = ("processingStartedAt" IS NULL)) NOT VALID,
  ADD CONSTRAINT "EmailOutbox_acknowledgement_pair_chk"
  CHECK (
    ("acknowledgedAt" IS NULL AND "acknowledgedById" IS NULL AND acknowledgement IS NULL)
    OR
    ("acknowledgedAt" IS NOT NULL AND "acknowledgedById" IS NOT NULL AND acknowledgement IS NOT NULL)
  ) NOT VALID;

ALTER TABLE public."ResendWebhookEvent"
  ADD CONSTRAINT "ResendWebhookEvent_claimGeneration_chk"
  CHECK ("claimGeneration" >= 0) NOT VALID,
  ADD CONSTRAINT "ResendWebhookEvent_attempts_nonnegative_chk"
  CHECK (attempts >= 0) NOT VALID,
  ADD CONSTRAINT "ResendWebhookEvent_claim_pair_chk"
  CHECK (("claimToken" IS NULL) = ("processingStartedAt" IS NULL)) NOT VALID,
  ADD CONSTRAINT "ResendWebhookEvent_acknowledgement_pair_chk"
  CHECK (
    ("acknowledgedAt" IS NULL AND "acknowledgedById" IS NULL AND acknowledgement IS NULL)
    OR
    ("acknowledgedAt" IS NOT NULL AND "acknowledgedById" IS NOT NULL AND acknowledgement IS NOT NULL)
  ) NOT VALID;

ALTER TABLE public."EmailOutbox"
  VALIDATE CONSTRAINT "EmailOutbox_claimGeneration_chk";
ALTER TABLE public."EmailOutbox"
  VALIDATE CONSTRAINT "EmailOutbox_attempts_nonnegative_chk";
ALTER TABLE public."EmailOutbox"
  VALIDATE CONSTRAINT "EmailOutbox_payloadVersion_chk";
ALTER TABLE public."EmailOutbox"
  VALIDATE CONSTRAINT "EmailOutbox_payload_size_chk";
ALTER TABLE public."EmailOutbox"
  VALIDATE CONSTRAINT "EmailOutbox_lane_chk";
ALTER TABLE public."EmailOutbox"
  VALIDATE CONSTRAINT "EmailOutbox_source_pair_chk";
ALTER TABLE public."EmailOutbox"
  VALIDATE CONSTRAINT "EmailOutbox_representation_chk";
ALTER TABLE public."EmailOutbox"
  VALIDATE CONSTRAINT "EmailOutbox_claim_pair_chk";
ALTER TABLE public."EmailOutbox"
  VALIDATE CONSTRAINT "EmailOutbox_acknowledgement_pair_chk";
ALTER TABLE public."ResendWebhookEvent"
  VALIDATE CONSTRAINT "ResendWebhookEvent_claimGeneration_chk";
ALTER TABLE public."ResendWebhookEvent"
  VALIDATE CONSTRAINT "ResendWebhookEvent_attempts_nonnegative_chk";
ALTER TABLE public."ResendWebhookEvent"
  VALIDATE CONSTRAINT "ResendWebhookEvent_claim_pair_chk";
ALTER TABLE public."ResendWebhookEvent"
  VALIDATE CONSTRAINT "ResendWebhookEvent_acknowledgement_pair_chk";

CREATE INDEX "EmailOutbox_status_lane_nextAttemptAt_createdAt_id_idx"
  ON public."EmailOutbox" (status, lane, "nextAttemptAt", "createdAt", id);

CREATE OR REPLACE FUNCTION public.grainline_email_outbox_safe_error(p_summary text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $grainline_email_outbox_safe_error$
  SELECT pg_catalog.left(
    pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(
        COALESCE(p_summary, 'Email delivery failed'),
        '[[:cntrl:]]+',
        ' ',
        'g'
      ),
      '[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}',
      '[redacted-email]',
      'g'
    ),
    1000
  )
$grainline_email_outbox_safe_error$;

REVOKE ALL ON FUNCTION public.grainline_email_outbox_safe_error(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.grainline_email_outbox_effective_lane(
  p_template_name text,
  p_lane text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $grainline_email_outbox_effective_lane$
BEGIN
  IF p_lane IN ('TRANSACTIONAL', 'OPTIONAL') THEN
    RETURN p_lane;
  END IF;
  IF p_template_name IN (
    'order_confirmed_buyer',
    'order_confirmed_seller',
    'refund_issued',
    'case_opened',
    'case_message',
    'case_resolved',
    'order_shipped',
    'ready_for_pickup'
  ) THEN
    RETURN 'TRANSACTIONAL';
  END IF;
  IF p_template_name IN (
    'welcome',
    'first_listing_congrats',
    'first_sale_congrats',
    'back_in_stock',
    'followed_maker_new_listing',
    'seller_broadcast'
  ) THEN
    RETURN 'OPTIONAL';
  END IF;
  RETURN NULL;
END
$grainline_email_outbox_effective_lane$;

REVOKE ALL ON FUNCTION public.grainline_email_outbox_effective_lane(text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.grainline_email_delivery_is_hard_suppressed(
  p_email text
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_delivery_is_hard_suppressed$
  SELECT CASE
    WHEN p_email IS NULL
      OR p_email IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(p_email))
      OR pg_catalog.char_length(p_email) NOT BETWEEN 3 AND 254
      OR pg_catalog.strpos(p_email, '@') <= 1
    THEN true
    ELSE EXISTS (
      SELECT 1
        FROM public."EmailSuppression" AS suppression
       WHERE suppression.source IS DISTINCT FROM 'resend_transient_failure'
         AND (
           suppression.reason::text IN ('BOUNCE', 'COMPLAINT')
           OR suppression.source = 'account_deletion'
         )
         AND (
           pg_catalog.lower(pg_catalog.btrim(suppression.email)) = p_email
           OR (
             pg_catalog.lower(pg_catalog.split_part(p_email, '@', 2))
               IN ('gmail.com', 'googlemail.com')
             AND pg_catalog.lower(pg_catalog.split_part(suppression.email, '@', 2))
               IN ('gmail.com', 'googlemail.com')
             AND pg_catalog.replace(
               pg_catalog.split_part(
                 pg_catalog.lower(pg_catalog.split_part(suppression.email, '@', 1)),
                 '+',
                 1
               ),
               '.',
               ''
             ) = pg_catalog.replace(
               pg_catalog.split_part(
                 pg_catalog.lower(pg_catalog.split_part(p_email, '@', 1)),
                 '+',
                 1
               ),
               '.',
               ''
             )
           )
         )
    )
  END
$grainline_email_delivery_is_hard_suppressed$;

REVOKE ALL ON FUNCTION public.grainline_email_delivery_is_hard_suppressed(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.grainline_email_outbox_claim_core(
  p_job_id text,
  p_limit integer
)
RETURNS TABLE (
  "jobId" text,
  "claimGeneration" bigint,
  "claimToken" uuid,
  "recipientEmail" text,
  "recipientUserId" text,
  "preferenceKey" text,
  "templateName" text,
  "templateVersion" integer,
  "payloadVersion" integer,
  payload jsonb,
  "dedupKey" text,
  "createdAt" timestamp with time zone,
  "legacySubject" text,
  "legacyHtml" text,
  lane text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_outbox_claim_core$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  candidate record;
  effective_lane text;
  account_state text;
  recipient_count integer;
  returned_count integer := 0;
  scan_limit integer;
  new_generation bigint;
  new_token uuid;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Email outbox claim limit is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_job_id IS NOT NULL AND (
    pg_catalog.char_length(p_job_id) < 1
    OR pg_catalog.char_length(p_job_id) > 191
    OR p_limit <> 1
  ) THEN
    RAISE EXCEPTION 'Email outbox job identity is invalid' USING ERRCODE = '22023';
  END IF;

  scan_limit := LEAST(400, p_limit * 4);

  FOR candidate IN
    SELECT source_row.*
      FROM public."EmailOutbox" AS source_row
     WHERE (p_job_id IS NULL OR source_row.id = p_job_id)
       AND (
         (
           source_row.status IN ('PENDING', 'FAILED')
           AND source_row."nextAttemptAt" <= source_now
         )
         OR
         (
           source_row.status = 'PROCESSING'
           AND COALESCE(source_row."processingStartedAt", source_row."updatedAt")
                 < source_now - INTERVAL '10 minutes'
         )
       )
     ORDER BY
       CASE public.grainline_email_outbox_effective_lane(
         source_row."templateName"::text,
         source_row.lane::text
       ) WHEN 'TRANSACTIONAL' THEN 0 ELSE 1 END,
       source_row."createdAt" ASC,
       source_row.id ASC
     LIMIT scan_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    effective_lane := public.grainline_email_outbox_effective_lane(
      candidate."templateName"::text,
      candidate.lane::text
    );

    IF candidate.attempts >= 10
       OR (
         candidate."firstProviderAttemptAt" IS NOT NULL
         AND candidate."firstProviderAttemptAt" <= source_now - INTERVAL '23 hours'
       ) THEN
      UPDATE public."EmailOutbox"
         SET status = 'DEAD',
             "nextAttemptAt" = NULL,
             "claimToken" = NULL,
             "processingStartedAt" = NULL,
             "lastError" = public.grainline_email_outbox_safe_error(
               CASE
                 WHEN candidate.attempts >= 10 THEN 'Automatic email attempt limit reached; manual review required'
                 ELSE 'Provider idempotency window expired; manual review required'
               END
             ),
             "updatedAt" = source_now
       WHERE id = candidate.id;
      CONTINUE;
    END IF;

    IF effective_lane IS NULL
       OR candidate."recipientEmail" IS NULL
       OR candidate."recipientEmail" IS DISTINCT FROM
            pg_catalog.lower(pg_catalog.btrim(candidate."recipientEmail"))
       OR pg_catalog.char_length(candidate."recipientEmail") NOT BETWEEN 3 AND 254
       OR pg_catalog.strpos(candidate."recipientEmail", '@') <= 1
       OR NOT (
         (
           candidate.subject IS NOT NULL
           AND candidate.html IS NOT NULL
           AND candidate.payload IS NULL
           AND candidate."payloadVersion" IS NULL
         )
         OR
         (
           candidate.subject IS NULL
           AND candidate.html IS NULL
           AND candidate.payload IS NOT NULL
           AND candidate."payloadVersion" IS NOT NULL
         )
       ) THEN
      UPDATE public."EmailOutbox"
         SET status = 'DEAD',
             "nextAttemptAt" = NULL,
             "claimToken" = NULL,
             "processingStartedAt" = NULL,
             "lastError" = 'Invalid email outbox representation; manual review required',
             "updatedAt" = source_now
       WHERE id = candidate.id;
      CONTINUE;
    END IF;

    account_state := 'active';
    IF candidate."userId" IS NOT NULL THEN
      SELECT public.grainline_user_email_account_state_by_id(
        candidate."userId"::text,
        candidate."recipientEmail"::text
      ) INTO account_state;
      IF account_state = 'active'
         AND effective_lane = 'OPTIONAL'
         AND candidate."preferenceKey" IS NOT NULL THEN
        SELECT pg_catalog.count(*)::integer
          INTO recipient_count
          FROM public.grainline_user_email_recipient(
            candidate."userId"::text,
            candidate."preferenceKey"::text
          );
        IF recipient_count <> 1 THEN
          account_state := 'optional_preference_disabled';
        END IF;
      END IF;
    ELSE
      SELECT public.grainline_user_email_account_state_by_email(
        candidate."recipientEmail"::text
      ) INTO account_state;
      IF account_state = 'missing' THEN
        account_state := 'active';
      END IF;
    END IF;

    IF account_state <> 'active'
       OR public.grainline_email_delivery_is_hard_suppressed(
         candidate."recipientEmail"::text
       ) THEN
      UPDATE public."EmailOutbox"
         SET status = 'SKIPPED',
             "sentAt" = source_now,
             "nextAttemptAt" = NULL,
             "claimToken" = NULL,
             "processingStartedAt" = NULL,
             "lastError" = public.grainline_email_outbox_safe_error(
               CASE
                 WHEN public.grainline_email_delivery_is_hard_suppressed(
                   candidate."recipientEmail"::text
                 ) THEN 'Recipient email is hard-suppressed'
                 ELSE 'Recipient is not eligible for email delivery: ' || account_state
               END
             ),
             "updatedAt" = source_now
       WHERE id = candidate.id;
      CONTINUE;
    END IF;

    new_generation := candidate."claimGeneration" + 1;
    new_token := pg_catalog.gen_random_uuid();
    UPDATE public."EmailOutbox"
       SET status = 'PROCESSING',
           attempts = candidate.attempts + 1,
           "claimGeneration" = new_generation,
           "claimToken" = new_token,
           "processingStartedAt" = source_now,
           "nextAttemptAt" = NULL,
           "lastError" = NULL,
           lane = COALESCE(candidate.lane, effective_lane),
           "updatedAt" = source_now
     WHERE id = candidate.id;

    "jobId" := candidate.id;
    "claimGeneration" := new_generation;
    "claimToken" := new_token;
    "recipientEmail" := candidate."recipientEmail"::text;
    "recipientUserId" := candidate."userId"::text;
    "preferenceKey" := candidate."preferenceKey"::text;
    "templateName" := candidate."templateName"::text;
    "templateVersion" := candidate."templateVersion";
    "payloadVersion" := candidate."payloadVersion";
    payload := candidate.payload;
    "dedupKey" := candidate."dedupKey"::text;
    "createdAt" := candidate."createdAt" AT TIME ZONE 'UTC';
    "legacySubject" := candidate.subject::text;
    "legacyHtml" := candidate.html;
    lane := effective_lane;
    RETURN NEXT;
    returned_count := returned_count + 1;
    EXIT WHEN returned_count >= p_limit;
  END LOOP;
END
$grainline_email_outbox_claim_core$;

REVOKE ALL ON FUNCTION public.grainline_email_outbox_claim_core(text, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.grainline_email_outbox_claim_batch(p_limit integer)
RETURNS TABLE (
  "jobId" text,
  "claimGeneration" bigint,
  "claimToken" uuid,
  "recipientEmail" text,
  "recipientUserId" text,
  "preferenceKey" text,
  "templateName" text,
  "templateVersion" integer,
  "payloadVersion" integer,
  payload jsonb,
  "dedupKey" text,
  "createdAt" timestamp with time zone,
  "legacySubject" text,
  "legacyHtml" text,
  lane text
)
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_outbox_claim_batch$
  SELECT * FROM public.grainline_email_outbox_claim_core(NULL, p_limit)
$grainline_email_outbox_claim_batch$;

CREATE OR REPLACE FUNCTION public.grainline_email_outbox_claim_one(p_job_id text)
RETURNS TABLE (
  "jobId" text,
  "claimGeneration" bigint,
  "claimToken" uuid,
  "recipientEmail" text,
  "recipientUserId" text,
  "preferenceKey" text,
  "templateName" text,
  "templateVersion" integer,
  "payloadVersion" integer,
  payload jsonb,
  "dedupKey" text,
  "createdAt" timestamp with time zone,
  "legacySubject" text,
  "legacyHtml" text,
  lane text
)
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_outbox_claim_one$
  SELECT * FROM public.grainline_email_outbox_claim_core(p_job_id, 1)
$grainline_email_outbox_claim_one$;

CREATE OR REPLACE FUNCTION public.grainline_email_outbox_defer(
  p_job_id text,
  p_claim_generation bigint,
  p_claim_token uuid,
  p_reason text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_outbox_defer$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  changed_count integer;
  retry_at timestamp(3) without time zone;
BEGIN
  IF p_reason NOT IN (
    'recipient_optional_quota',
    'optional_global_quota',
    'provider_unavailable'
  ) THEN
    RAISE EXCEPTION 'Email outbox defer reason is invalid' USING ERRCODE = '22023';
  END IF;
  retry_at := CASE
    WHEN p_reason IN ('recipient_optional_quota', 'optional_global_quota')
      THEN (pg_catalog.date_trunc('day', source_now) + INTERVAL '1 day')::timestamp(3)
    ELSE source_now + INTERVAL '5 minutes'
  END;
  UPDATE public."EmailOutbox"
     SET status = 'PENDING',
         attempts = GREATEST(attempts - 1, 0),
         "nextAttemptAt" = retry_at,
         "claimToken" = NULL,
         "processingStartedAt" = NULL,
         "lastError" = public.grainline_email_outbox_safe_error(p_reason),
         "updatedAt" = source_now
   WHERE id = p_job_id
     AND status = 'PROCESSING'
     AND "claimGeneration" = p_claim_generation
     AND "claimToken" = p_claim_token
     AND "firstProviderAttemptAt" IS NULL
     AND (
       p_reason = 'provider_unavailable'
       OR public.grainline_email_outbox_effective_lane(
         "templateName"::text,
         lane::text
       ) = 'OPTIONAL'
     );
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count = 1 THEN RETURN 'applied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."EmailOutbox" WHERE id = p_job_id) THEN RETURN 'missing'; END IF;
  IF EXISTS (SELECT 1 FROM public."EmailOutbox" WHERE id = p_job_id AND status IN ('SENT','SKIPPED','DEAD')) THEN
    RETURN 'already_terminal';
  END IF;
  RETURN 'stale_claim';
END
$grainline_email_outbox_defer$;

CREATE OR REPLACE FUNCTION public.grainline_email_outbox_begin_provider_attempt(
  p_job_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_outbox_begin_provider_attempt$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  locked_row record;
BEGIN
  SELECT * INTO locked_row
    FROM public."EmailOutbox"
   WHERE id = p_job_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF locked_row.status IN ('SENT','SKIPPED','DEAD') THEN RETURN 'already_terminal'; END IF;
  IF locked_row.status <> 'PROCESSING'
     OR locked_row."claimGeneration" <> p_claim_generation
     OR locked_row."claimToken" IS DISTINCT FROM p_claim_token THEN
    RETURN 'stale_claim';
  END IF;
  IF locked_row."firstProviderAttemptAt" IS NOT NULL
     AND locked_row."firstProviderAttemptAt" <= source_now - INTERVAL '23 hours' THEN
    UPDATE public."EmailOutbox"
       SET status = 'DEAD',
           "nextAttemptAt" = NULL,
           "claimToken" = NULL,
           "processingStartedAt" = NULL,
           "lastError" = 'Provider idempotency window expired; manual review required',
           "updatedAt" = source_now
     WHERE id = p_job_id;
    RETURN 'expired';
  END IF;
  UPDATE public."EmailOutbox"
     SET "firstProviderAttemptAt" = COALESCE("firstProviderAttemptAt", source_now),
         "updatedAt" = source_now
   WHERE id = p_job_id;
  RETURN 'ready';
END
$grainline_email_outbox_begin_provider_attempt$;

CREATE OR REPLACE FUNCTION public.grainline_email_outbox_complete(
  p_job_id text,
  p_claim_generation bigint,
  p_claim_token uuid,
  p_provider_message_id text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_outbox_complete$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  changed_count integer;
BEGIN
  IF p_provider_message_id IS NULL
     OR p_provider_message_id <> pg_catalog.btrim(p_provider_message_id)
     OR pg_catalog.char_length(p_provider_message_id) < 1
     OR pg_catalog.char_length(p_provider_message_id) > 255
     OR p_provider_message_id ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Provider message identity is invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public."EmailOutbox"
     SET status = 'SENT',
         "sentAt" = source_now,
         "providerMessageId" = p_provider_message_id,
         "nextAttemptAt" = NULL,
         "claimToken" = NULL,
         "processingStartedAt" = NULL,
         "lastError" = NULL,
         "updatedAt" = source_now
   WHERE id = p_job_id
     AND status = 'PROCESSING'
     AND "claimGeneration" = p_claim_generation
     AND "claimToken" = p_claim_token
     AND "firstProviderAttemptAt" IS NOT NULL;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count = 1 THEN RETURN 'applied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."EmailOutbox" WHERE id = p_job_id) THEN RETURN 'missing'; END IF;
  IF EXISTS (SELECT 1 FROM public."EmailOutbox" WHERE id = p_job_id AND status IN ('SENT','SKIPPED','DEAD')) THEN
    RETURN 'already_terminal';
  END IF;
  RETURN 'stale_claim';
END
$grainline_email_outbox_complete$;

CREATE OR REPLACE FUNCTION public.grainline_email_outbox_fail(
  p_job_id text,
  p_claim_generation bigint,
  p_claim_token uuid,
  p_error_class text,
  p_error_summary text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_outbox_fail$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  locked_row record;
  next_status text;
  retry_at timestamp(3) without time zone;
BEGIN
  IF p_error_class NOT IN (
    'provider_retryable',
    'provider_rejected',
    'invalid_payload',
    'configuration',
    'unexpected_internal'
  ) THEN
    RAISE EXCEPTION 'Email outbox failure class is invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO locked_row
    FROM public."EmailOutbox"
   WHERE id = p_job_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF locked_row.status IN ('SENT','SKIPPED','DEAD') THEN RETURN 'already_terminal'; END IF;
  IF locked_row.status <> 'PROCESSING'
     OR locked_row."claimGeneration" <> p_claim_generation
     OR locked_row."claimToken" IS DISTINCT FROM p_claim_token THEN
    RETURN 'stale_claim';
  END IF;

  IF p_error_class IN ('provider_rejected', 'invalid_payload', 'configuration')
     OR locked_row.attempts >= 10
     OR (
       locked_row."firstProviderAttemptAt" IS NOT NULL
       AND locked_row."firstProviderAttemptAt" <= source_now - INTERVAL '23 hours'
     ) THEN
    next_status := 'DEAD';
    retry_at := NULL;
  ELSE
    next_status := 'FAILED';
    retry_at := source_now + (
      LEAST(30, GREATEST(1, 2 ^ LEAST(4, locked_row.attempts - 1)))
      || ' minutes'
    )::interval;
  END IF;

  UPDATE public."EmailOutbox"
     SET status = next_status,
         "nextAttemptAt" = retry_at,
         "claimToken" = NULL,
         "processingStartedAt" = NULL,
         "lastError" = public.grainline_email_outbox_safe_error(p_error_summary),
         "updatedAt" = source_now
   WHERE id = p_job_id;
  RETURN 'applied';
END
$grainline_email_outbox_fail$;

CREATE OR REPLACE FUNCTION public.grainline_email_outbox_skip(
  p_job_id text,
  p_claim_generation bigint,
  p_claim_token uuid,
  p_reason text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_outbox_skip$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  changed_count integer;
BEGIN
  IF p_reason NOT IN (
    'inactive_account',
    'banned_account',
    'deleted_account',
    'email_changed',
    'optional_preference_disabled',
    'hard_suppression',
    'invalid_legacy_shape',
    'account_deletion'
  ) THEN
    RAISE EXCEPTION 'Email outbox skip reason is invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public."EmailOutbox"
     SET status = 'SKIPPED',
         "sentAt" = source_now,
         "nextAttemptAt" = NULL,
         "claimToken" = NULL,
         "processingStartedAt" = NULL,
         "lastError" = public.grainline_email_outbox_safe_error(p_reason),
         "updatedAt" = source_now
   WHERE id = p_job_id
     AND status = 'PROCESSING'
     AND "claimGeneration" = p_claim_generation
     AND "claimToken" = p_claim_token;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count = 1 THEN RETURN 'applied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."EmailOutbox" WHERE id = p_job_id) THEN RETURN 'missing'; END IF;
  IF EXISTS (SELECT 1 FROM public."EmailOutbox" WHERE id = p_job_id AND status IN ('SENT','SKIPPED','DEAD')) THEN
    RETURN 'already_terminal';
  END IF;
  RETURN 'stale_claim';
END
$grainline_email_outbox_skip$;

REVOKE ALL ON FUNCTION public.grainline_email_outbox_claim_batch(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_outbox_claim_one(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_outbox_defer(text, bigint, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_outbox_begin_provider_attempt(text, bigint, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_outbox_complete(text, bigint, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_outbox_fail(text, bigint, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_outbox_skip(text, bigint, uuid, text) FROM PUBLIC;

DO $grant_runtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.grainline_email_outbox_claim_batch(integer)
      TO grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION public.grainline_email_outbox_claim_one(text)
      TO grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION public.grainline_email_outbox_defer(text, bigint, uuid, text)
      TO grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION public.grainline_email_outbox_begin_provider_attempt(text, bigint, uuid)
      TO grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION public.grainline_email_outbox_complete(text, bigint, uuid, text)
      TO grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION public.grainline_email_outbox_fail(text, bigint, uuid, text, text)
      TO grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION public.grainline_email_outbox_skip(text, bigint, uuid, text)
      TO grainline_app_runtime;
  END IF;
END
$grant_runtime$;

DO $postflight$
DECLARE
  function_oid oid;
  function_identity text;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint
     WHERE conrelid IN (
       'public."EmailOutbox"'::pg_catalog.regclass,
       'public."ResendWebhookEvent"'::pg_catalog.regclass
     )
       AND conname IN (
         'EmailOutbox_claimGeneration_chk',
         'EmailOutbox_attempts_nonnegative_chk',
         'EmailOutbox_payloadVersion_chk',
         'EmailOutbox_payload_size_chk',
         'EmailOutbox_lane_chk',
         'EmailOutbox_source_pair_chk',
         'EmailOutbox_representation_chk',
         'EmailOutbox_claim_pair_chk',
         'EmailOutbox_acknowledgement_pair_chk',
         'ResendWebhookEvent_claimGeneration_chk',
         'ResendWebhookEvent_attempts_nonnegative_chk',
         'ResendWebhookEvent_claim_pair_chk',
         'ResendWebhookEvent_acknowledgement_pair_chk'
       )
       AND NOT convalidated
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_constraint
     WHERE conrelid IN (
       'public."EmailOutbox"'::pg_catalog.regclass,
       'public."ResendWebhookEvent"'::pg_catalog.regclass
     )
       AND conname IN (
         'EmailOutbox_claimGeneration_chk',
         'EmailOutbox_attempts_nonnegative_chk',
         'EmailOutbox_payloadVersion_chk',
         'EmailOutbox_payload_size_chk',
         'EmailOutbox_lane_chk',
         'EmailOutbox_source_pair_chk',
         'EmailOutbox_representation_chk',
         'EmailOutbox_claim_pair_chk',
         'EmailOutbox_acknowledgement_pair_chk',
         'ResendWebhookEvent_claimGeneration_chk',
         'ResendWebhookEvent_attempts_nonnegative_chk',
         'ResendWebhookEvent_claim_pair_chk',
         'ResendWebhookEvent_acknowledgement_pair_chk'
       )
  ) <> 13 THEN
    RAISE EXCEPTION 'Email-service preparation constraints are incomplete';
  END IF;

  FOREACH function_identity IN ARRAY ARRAY[
    'grainline_email_delivery_is_hard_suppressed(text)',
    'grainline_email_outbox_claim_core(text,integer)',
    'grainline_email_outbox_claim_batch(integer)',
    'grainline_email_outbox_claim_one(text)',
    'grainline_email_outbox_defer(text,bigint,uuid,text)',
    'grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)',
    'grainline_email_outbox_complete(text,bigint,uuid,text)',
    'grainline_email_outbox_fail(text,bigint,uuid,text,text)',
    'grainline_email_outbox_skip(text,bigint,uuid,text)'
  ] LOOP
    function_oid := pg_catalog.to_regprocedure('public.' || function_identity);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'Email-service authority % is missing', function_identity;
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = function_oid
         AND procedure.prosecdef
         AND procedure.proowner = (
           SELECT role.oid FROM pg_catalog.pg_roles AS role
            WHERE role.rolname = CURRENT_USER
         )
         AND procedure.proconfig @> ARRAY['search_path=pg_catalog']::text[]
    ) THEN
      RAISE EXCEPTION 'Email-service authority % has unsafe owner or execution posture',
        function_identity;
    END IF;
    IF pg_catalog.has_function_privilege('public', function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'PUBLIC can execute email-service authority %', function_identity;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid IN (
       'public."EmailOutbox"'::pg_catalog.regclass,
       'public."EmailSuppression"'::pg_catalog.regclass,
       'public."NewsletterSubscriber"'::pg_catalog.regclass,
       'public."ResendWebhookEvent"'::pg_catalog.regclass
     )
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Email-service preparation unexpectedly changed RLS state';
  END IF;
END
$postflight$;

COMMIT;
