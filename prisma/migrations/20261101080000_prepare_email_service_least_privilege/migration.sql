-- Prepare the five-table email service least-privilege boundary. This
-- migration is additive and predecessor-compatible: direct runtime grants are
-- retained until the separately reviewed activation after the compatible app
-- is deployed and drained.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '90s';

DO $preflight$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'NewsletterSubscriber',
    'EmailSuppression',
    'ResendWebhookEvent',
    'EmailFailureCount',
    'EmailOutbox'
  ]::text[] LOOP
    IF pg_catalog.to_regclass('public.' || pg_catalog.quote_ident(table_name)) IS NULL THEN
      RAISE EXCEPTION 'Email service predecessor table % is missing', table_name;
    END IF;
  END LOOP;

  IF pg_catalog.to_regprocedure(
       'public.grainline_email_outbox_lock_keys(text[],text[])'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_account_deletion_email_key_core(text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_follow_public_state_batch(text[])'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_user_block_targets()'
     ) IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime'
     ) THEN
    RAISE EXCEPTION 'Email service predecessor authority catalog is incomplete';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.grainline_email_suppression_exists(
  p_email text,
  p_mode text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_suppression_exists$
DECLARE
  normalized_email text;
  canonical_email text;
BEGIN
  normalized_email := pg_catalog.lower(pg_catalog.btrim(p_email));
  IF normalized_email IS NULL
     OR normalized_email IS DISTINCT FROM p_email
     OR pg_catalog.char_length(normalized_email) NOT BETWEEN 3 AND 254
     OR pg_catalog.strpos(normalized_email, '@') <= 1
     OR p_mode NOT IN ('any', 'newsletter', 'delivery') THEN
    RAISE EXCEPTION 'Email suppression lookup input is invalid'
      USING ERRCODE = '22023';
  END IF;
  canonical_email := public.grainline_account_deletion_email_key_core(
    normalized_email
  );

  RETURN EXISTS (
    SELECT 1
      FROM public."EmailSuppression" AS suppression
     WHERE (
       pg_catalog.lower(pg_catalog.btrim(suppression.email::text)) = normalized_email
       OR public.grainline_account_deletion_email_key_core(
            suppression.email::text
          ) = canonical_email
     )
       AND suppression.source IS DISTINCT FROM 'resend_transient_failure'
       AND CASE p_mode
         WHEN 'any' THEN true
         WHEN 'newsletter' THEN
           suppression.reason::text IN ('BOUNCE', 'COMPLAINT')
           OR suppression.source = 'account_deletion'
           OR (
             suppression.reason::text = 'MANUAL'
             AND suppression.source IS DISTINCT FROM 'one_click_unsubscribe'
           )
         WHEN 'delivery' THEN
           suppression.reason::text IN ('BOUNCE', 'COMPLAINT')
           OR suppression.source = 'account_deletion'
         ELSE false
       END
  );
END
$grainline_email_suppression_exists$;

CREATE OR REPLACE FUNCTION public.grainline_email_one_click_suppression_clear(
  p_email text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_one_click_suppression_clear$
DECLARE
  normalized_email text;
  canonical_email text;
  deleted_count integer;
BEGIN
  normalized_email := pg_catalog.lower(pg_catalog.btrim(p_email));
  IF normalized_email IS NULL
     OR normalized_email IS DISTINCT FROM p_email
     OR pg_catalog.char_length(normalized_email) NOT BETWEEN 3 AND 254
     OR pg_catalog.strpos(normalized_email, '@') <= 1 THEN
    RAISE EXCEPTION 'Email suppression clear input is invalid'
      USING ERRCODE = '22023';
  END IF;
  canonical_email := public.grainline_account_deletion_email_key_core(
    normalized_email
  );

  PERFORM public.grainline_email_outbox_lock_keys(
    ARRAY[]::text[],
    ARRAY[normalized_email]
  );

  DELETE FROM public."EmailSuppression" AS suppression
   WHERE (
     pg_catalog.lower(pg_catalog.btrim(suppression.email::text)) = normalized_email
     OR public.grainline_account_deletion_email_key_core(
          suppression.email::text
        ) = canonical_email
   )
     AND suppression.reason::text = 'MANUAL'
     AND suppression.source = 'one_click_unsubscribe';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$grainline_email_one_click_suppression_clear$;

CREATE OR REPLACE FUNCTION public.grainline_newsletter_signup_reserve(
  p_email text,
  p_name text,
  p_token_hash text,
  p_expires_at timestamp(3) without time zone,
  p_sent_at timestamp(3) without time zone,
  p_resend_cutoff timestamp(3) without time zone
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_newsletter_signup_reserve$
DECLARE
  subscriber_row record;
  inserted_count integer;
BEGIN
  IF p_email IS NULL
     OR p_email IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(p_email))
     OR pg_catalog.char_length(p_email) NOT BETWEEN 3 AND 254
     OR pg_catalog.strpos(p_email, '@') <= 1
     OR (p_name IS NOT NULL AND pg_catalog.char_length(p_name) > 200)
     OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_sent_at IS NULL OR p_expires_at IS NULL OR p_resend_cutoff IS NULL
     OR p_expires_at <= p_sent_at OR p_resend_cutoff >= p_sent_at THEN
    RAISE EXCEPTION 'Newsletter signup reservation input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.grainline_email_outbox_lock_keys(
    ARRAY[]::text[],
    ARRAY[p_email]
  );

  IF public.grainline_email_suppression_exists(p_email, 'newsletter') THEN
    RETURN 'hidden';
  END IF;

  SELECT subscriber.id, subscriber.active, subscriber."confirmationSentAt"
    INTO subscriber_row
    FROM public."NewsletterSubscriber" AS subscriber
   WHERE subscriber.email = p_email
   FOR UPDATE;

  IF FOUND THEN
    IF subscriber_row.active
       OR (
         subscriber_row."confirmationSentAt" IS NOT NULL
         AND subscriber_row."confirmationSentAt" > p_resend_cutoff
       ) THEN
      RETURN 'hidden';
    END IF;

    UPDATE public."NewsletterSubscriber" AS subscriber
       SET name = COALESCE(p_name, subscriber.name),
           active = false,
           "confirmedAt" = NULL,
           "confirmationTokenHash" = p_token_hash,
           "confirmationExpiresAt" = p_expires_at,
           "confirmationSentAt" = p_sent_at
     WHERE subscriber.id = subscriber_row.id;
    RETURN 'reserved';
  END IF;

  INSERT INTO public."NewsletterSubscriber" (
    id, email, name, "subscribedAt", active, "confirmedAt",
    "confirmationTokenHash", "confirmationExpiresAt", "confirmationSentAt"
  ) VALUES (
    'newsletter-' || pg_catalog.md5(p_email || ':' || p_token_hash),
    p_email,
    p_name,
    p_sent_at,
    false,
    NULL,
    p_token_hash,
    p_expires_at,
    p_sent_at
  )
  ON CONFLICT (email) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN CASE WHEN inserted_count = 1 THEN 'reserved' ELSE 'hidden' END;
END
$grainline_newsletter_signup_reserve$;

CREATE OR REPLACE FUNCTION public.grainline_newsletter_signup_release(
  p_email text,
  p_token_hash text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_newsletter_signup_release$
DECLARE
  updated_count integer;
BEGIN
  IF p_email IS NULL
     OR p_email IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(p_email))
     OR pg_catalog.char_length(p_email) NOT BETWEEN 3 AND 254
     OR pg_catalog.strpos(p_email, '@') <= 1
     OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Newsletter reservation release input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.grainline_email_outbox_lock_keys(
    ARRAY[]::text[],
    ARRAY[p_email]
  );
  UPDATE public."NewsletterSubscriber" AS subscriber
     SET "confirmationTokenHash" = NULL,
         "confirmationExpiresAt" = NULL,
         "confirmationSentAt" = NULL
   WHERE subscriber.email = p_email
     AND subscriber.active = false
     AND subscriber."confirmationTokenHash" = p_token_hash;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END
$grainline_newsletter_signup_release$;

CREATE OR REPLACE FUNCTION public.grainline_newsletter_confirmation_valid(
  p_token_hash text,
  p_now timestamp(3) without time zone
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_newsletter_confirmation_valid$
  SELECT CASE
    WHEN p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
      OR p_now IS NULL
      THEN false
    ELSE EXISTS (
      SELECT 1
        FROM public."NewsletterSubscriber" AS subscriber
       WHERE subscriber."confirmationTokenHash" = p_token_hash
         AND subscriber.active = false
         AND subscriber."confirmationExpiresAt" > p_now
    )
  END
$grainline_newsletter_confirmation_valid$;

CREATE OR REPLACE FUNCTION public.grainline_newsletter_confirm(
  p_token_hash text,
  p_now timestamp(3) without time zone
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_newsletter_confirm$
DECLARE
  subscriber_row record;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_now IS NULL THEN
    RETURN false;
  END IF;

  SELECT subscriber.id, subscriber.email
    INTO subscriber_row
    FROM public."NewsletterSubscriber" AS subscriber
   WHERE subscriber."confirmationTokenHash" = p_token_hash
     AND subscriber.active = false
     AND subscriber."confirmationExpiresAt" > p_now;
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM public.grainline_email_outbox_lock_keys(
    ARRAY[]::text[],
    ARRAY[subscriber_row.email]
  );
  SELECT subscriber.id, subscriber.email
    INTO subscriber_row
    FROM public."NewsletterSubscriber" AS subscriber
   WHERE subscriber.id = subscriber_row.id
     AND subscriber."confirmationTokenHash" = p_token_hash
     AND subscriber.active = false
     AND subscriber."confirmationExpiresAt" > p_now
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public."NewsletterSubscriber" AS subscriber
     SET active = true,
         "confirmedAt" = p_now,
         "subscribedAt" = p_now,
         "confirmationTokenHash" = NULL,
         "confirmationExpiresAt" = NULL,
         "confirmationSentAt" = NULL
   WHERE subscriber.id = subscriber_row.id;

  PERFORM public.grainline_email_one_click_suppression_clear(
    subscriber_row.email
  );
  RETURN true;
END
$grainline_newsletter_confirm$;

CREATE OR REPLACE FUNCTION public.grainline_newsletter_token_superseded(
  p_email text,
  p_issued_at timestamp(3) without time zone
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_newsletter_token_superseded$
DECLARE
  canonical_email text;
BEGIN
  IF p_email IS NULL
     OR p_email IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(p_email))
     OR pg_catalog.char_length(p_email) NOT BETWEEN 3 AND 254
     OR pg_catalog.strpos(p_email, '@') <= 1
     OR p_issued_at IS NULL THEN
    RETURN true;
  END IF;
  canonical_email := public.grainline_account_deletion_email_key_core(p_email);
  RETURN EXISTS (
    SELECT 1
      FROM public."NewsletterSubscriber" AS subscriber
     WHERE (
       pg_catalog.lower(pg_catalog.btrim(subscriber.email::text)) = p_email
       OR public.grainline_account_deletion_email_key_core(
            subscriber.email::text
          ) = canonical_email
     )
       AND subscriber."confirmedAt" > p_issued_at
  );
END
$grainline_newsletter_token_superseded$;

CREATE OR REPLACE FUNCTION public.grainline_email_unsubscribe_apply(
  p_email text,
  p_disabled_preferences jsonb
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_unsubscribe_apply$
DECLARE
  canonical_email text;
  newsletter_count integer;
  canonical_suppression text;
  has_hard_suppression boolean;
BEGIN
  IF p_email IS NULL
     OR p_email IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(p_email))
     OR pg_catalog.char_length(p_email) NOT BETWEEN 3 AND 254
     OR pg_catalog.strpos(p_email, '@') <= 1
     OR p_disabled_preferences IS NULL
     OR pg_catalog.jsonb_typeof(p_disabled_preferences) <> 'array'
     OR pg_catalog.jsonb_array_length(p_disabled_preferences) NOT BETWEEN 1 AND 8
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.jsonb_array_elements(p_disabled_preferences) AS preference(value)
        WHERE pg_catalog.jsonb_typeof(preference.value) <> 'string'
           OR preference.value #>> '{}' NOT IN (
             'EMAIL_NEW_MESSAGE',
             'EMAIL_CUSTOM_ORDER',
             'EMAIL_VERIFICATION_APPROVED',
             'EMAIL_VERIFICATION_REJECTED',
             'EMAIL_BACK_IN_STOCK',
             'EMAIL_NEW_REVIEW',
             'EMAIL_FOLLOWED_MAKER_NEW_LISTING',
             'EMAIL_SELLER_BROADCAST'
           )
     )
     OR (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.jsonb_array_elements_text(p_disabled_preferences) AS preference(value)
     ) IS DISTINCT FROM (
       SELECT pg_catalog.count(DISTINCT preference.value)
         FROM pg_catalog.jsonb_array_elements_text(p_disabled_preferences) AS preference(value)
     ) THEN
    RAISE EXCEPTION 'Email unsubscribe input is invalid'
      USING ERRCODE = '22023';
  END IF;
  canonical_email := public.grainline_account_deletion_email_key_core(p_email);
  canonical_suppression := canonical_email;

  PERFORM public.grainline_email_outbox_lock_keys(
    ARRAY[]::text[],
    ARRAY[p_email]
  );

  UPDATE public."NewsletterSubscriber" AS subscriber
     SET active = false,
         "confirmationTokenHash" = NULL,
         "confirmationExpiresAt" = NULL,
         "confirmationSentAt" = NULL,
         "deactivatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
   WHERE pg_catalog.lower(pg_catalog.btrim(subscriber.email::text)) = p_email
      OR public.grainline_account_deletion_email_key_core(
           subscriber.email::text
         ) = canonical_email;
  GET DIAGNOSTICS newsletter_count = ROW_COUNT;

  SELECT EXISTS (
    SELECT 1
      FROM public."EmailSuppression" AS suppression
     WHERE (
       pg_catalog.lower(pg_catalog.btrim(suppression.email::text)) = p_email
       OR public.grainline_account_deletion_email_key_core(
            suppression.email::text
          ) = canonical_email
     )
       AND (
         suppression.reason::text IN ('BOUNCE', 'COMPLAINT')
         OR suppression.source = 'account_deletion'
       )
  ) INTO has_hard_suppression;
  IF has_hard_suppression THEN RETURN newsletter_count; END IF;

  UPDATE public."EmailSuppression" AS suppression
     SET reason = 'MANUAL'::public."EmailSuppressionReason",
         source = 'one_click_unsubscribe',
         "eventId" = NULL,
         details = pg_catalog.jsonb_build_object(
           'disabledPreferences', p_disabled_preferences
         ),
         "updatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
   WHERE (
     pg_catalog.lower(pg_catalog.btrim(suppression.email::text)) = p_email
     OR public.grainline_account_deletion_email_key_core(
          suppression.email::text
        ) = canonical_email
   )
     AND suppression.reason::text = 'MANUAL';

  INSERT INTO public."EmailSuppression" (
    id, email, reason, source, "eventId", details, "createdAt", "updatedAt"
  )
  SELECT
    'suppression-' || pg_catalog.md5(canonical_suppression),
    canonical_suppression,
    'MANUAL'::public."EmailSuppressionReason",
    'one_click_unsubscribe',
    NULL,
    pg_catalog.jsonb_build_object('disabledPreferences', p_disabled_preferences),
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC',
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
  WHERE NOT EXISTS (
    SELECT 1
      FROM public."EmailSuppression" AS suppression
     WHERE suppression.email = canonical_suppression
  );
  RETURN newsletter_count;
END
$grainline_email_unsubscribe_apply$;

CREATE OR REPLACE FUNCTION public.grainline_email_account_deletion_suppression_clear(
  p_user_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_account_deletion_suppression_clear$
DECLARE
  email_keys text[];
  deleted_count integer;
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = p_user_id
          AND actor."deletedAt" IS NULL
          AND actor.email IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Account-deletion suppression clear input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT ARRAY[
           pg_catalog.lower(pg_catalog.btrim(actor.email::text)),
           public.grainline_account_deletion_email_key_core(actor.email::text)
         ]::text[]
    INTO email_keys
    FROM public."User" AS actor
   WHERE actor.id = p_user_id;

  PERFORM public.grainline_email_outbox_lock_keys(
    ARRAY[]::text[],
    email_keys
  );
  DELETE FROM public."EmailSuppression" AS suppression
   WHERE (
     pg_catalog.lower(pg_catalog.btrim(suppression.email::text)) = ANY(email_keys)
     OR public.grainline_account_deletion_email_key_core(
          suppression.email::text
        ) = ANY(email_keys)
   )
     AND suppression.source = 'account_deletion';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$grainline_email_account_deletion_suppression_clear$;

CREATE OR REPLACE FUNCTION public.grainline_email_service_owner_export()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_service_owner_export$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  result jsonb;
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS actor WHERE actor.id = actor_id
     ) THEN
    RAISE EXCEPTION 'Email service owner export context is invalid'
      USING ERRCODE = '42501';
  END IF;

  WITH fallback_emails AS MATERIALIZED (
    SELECT fallback.email
      FROM public.grainline_user_email_fallback_addresses() AS fallback
  ), email_keys AS MATERIALIZED (
    SELECT fallback.email FROM fallback_emails AS fallback
    UNION
    SELECT public.grainline_account_deletion_email_key_core(fallback.email)
      FROM fallback_emails AS fallback
  )
  SELECT pg_catalog.jsonb_build_object(
    'emailSuppressions', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(export_row) ORDER BY export_row."createdAt" DESC, export_row.id DESC)
        FROM (
          SELECT suppression.id,
                 suppression.email::text AS email,
                 suppression.reason::text AS reason,
                 suppression.source::text AS source,
                 suppression."eventId"::text AS "eventId",
                 suppression.details,
                 pg_catalog.to_char(
                   suppression."createdAt",
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                 ) AS "createdAt",
                 pg_catalog.to_char(
                   suppression."updatedAt",
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                 ) AS "updatedAt"
            FROM public."EmailSuppression" AS suppression
           WHERE suppression.email IN (SELECT email FROM email_keys)
        ) AS export_row
    ), '[]'::jsonb),
    'emailOutboxRows', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(export_row) ORDER BY export_row."createdAt" DESC, export_row.id DESC)
        FROM (
          SELECT outbox.id,
                 outbox."recipientEmail"::text AS "recipientEmail",
                 outbox."userId"::text AS "userId",
                 outbox."preferenceKey"::text AS "preferenceKey",
                 outbox."templateName"::text AS "templateName",
                 outbox."templateVersion",
                 outbox."sourceType"::text AS "sourceType",
                 outbox."sourceId"::text AS "sourceId",
                 outbox.subject::text AS subject,
                 outbox."payloadVersion",
                 outbox.payload,
                 outbox.status::text AS status,
                 outbox.attempts,
                 pg_catalog.to_char(
                   outbox."nextAttemptAt",
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                 ) AS "nextAttemptAt",
                 pg_catalog.to_char(
                   outbox."sentAt",
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                 ) AS "sentAt",
                 outbox."lastError"::text AS "lastError",
                 pg_catalog.to_char(
                   outbox."createdAt",
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                 ) AS "createdAt",
                 pg_catalog.to_char(
                   outbox."updatedAt",
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                 ) AS "updatedAt"
            FROM public."EmailOutbox" AS outbox
           WHERE outbox."userId" = actor_id
              OR (
                outbox."userId" IS NULL
                AND outbox."recipientEmail" IN (SELECT email FROM email_keys)
              )
        ) AS export_row
    ), '[]'::jsonb),
    'emailFailureCounts', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(export_row) ORDER BY export_row."lastFailedAt" DESC, export_row.email DESC)
        FROM (
          SELECT failure.email::text AS email,
                 failure.count,
                 pg_catalog.to_char(
                   failure."firstFailedAt",
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                 ) AS "firstFailedAt",
                 pg_catalog.to_char(
                   failure."lastFailedAt",
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                 ) AS "lastFailedAt",
                 failure."lastEventId"::text AS "lastEventId"
            FROM public."EmailFailureCount" AS failure
           WHERE failure.email IN (SELECT email FROM email_keys)
        ) AS export_row
    ), '[]'::jsonb),
    'newsletterSubscriptions', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(export_row) ORDER BY export_row."subscribedAt" DESC, export_row.id DESC)
        FROM (
          SELECT subscriber.id,
                 subscriber.email::text AS email,
                 subscriber.name::text AS name,
                 pg_catalog.to_char(
                   subscriber."subscribedAt",
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                 ) AS "subscribedAt",
                 subscriber.active,
                 pg_catalog.to_char(
                   subscriber."confirmedAt",
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                 ) AS "confirmedAt",
                 pg_catalog.to_char(
                   subscriber."confirmationSentAt",
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                 ) AS "confirmationSentAt"
            FROM public."NewsletterSubscriber" AS subscriber
           WHERE subscriber.email IN (SELECT email FROM email_keys)
        ) AS export_row
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END
$grainline_email_service_owner_export$;

CREATE OR REPLACE FUNCTION public.grainline_email_service_account_deletion_apply()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_service_account_deletion_apply$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  email_keys text[];
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  skipped_outbox_count integer := 0;
  redacted_outbox_count integer := 0;
  failure_count integer := 0;
  newsletter_count integer := 0;
  suppression_count integer := 0;
  created_suppression_count integer := 0;
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS actor WHERE actor.id = actor_id
     ) THEN
    RAISE EXCEPTION 'Email service account-deletion context is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(DISTINCT email ORDER BY email), ARRAY[]::text[])
    INTO email_keys
    FROM (
      SELECT fallback.email
        FROM public.grainline_user_email_fallback_addresses() AS fallback
      UNION
      SELECT public.grainline_account_deletion_email_key_core(fallback.email)
        FROM public.grainline_user_email_fallback_addresses() AS fallback
    ) AS candidate;

  PERFORM public.grainline_email_outbox_lock_keys(
    ARRAY[actor_id],
    email_keys
  );

  UPDATE public."EmailOutbox" AS outbox
     SET status = 'SKIPPED',
         "nextAttemptAt" = NULL,
         "sentAt" = source_now,
         "lastError" = 'Skipped because the recipient account was deleted.',
         "claimToken" = NULL,
         "processingStartedAt" = NULL,
         "providerAttemptGeneration" = NULL,
         "updatedAt" = source_now
   WHERE (
     outbox."userId" = actor_id
     OR (
       outbox."userId" IS NULL
       AND outbox."recipientEmail" = ANY(email_keys)
     )
   )
     AND outbox."sentAt" IS NULL
     AND outbox.status IN ('PENDING', 'PROCESSING', 'FAILED', 'DEAD');
  GET DIAGNOSTICS skipped_outbox_count = ROW_COUNT;

  UPDATE public."EmailOutbox" AS outbox
     SET "recipientEmail" = 'deleted-account@deleted.thegrainline.local',
         subject = CASE
           WHEN outbox."payloadVersion" IS NULL
             THEN 'Email removed after account deletion'
           ELSE NULL
         END,
         html = CASE
           WHEN outbox."payloadVersion" IS NULL
             THEN '[Email removed after account deletion]'
           ELSE NULL
         END,
         payload = CASE
           WHEN outbox."payloadVersion" IS NULL THEN NULL
           ELSE '{}'::jsonb
         END,
         "updatedAt" = source_now
   WHERE outbox."userId" = actor_id
      OR (
        outbox."userId" IS NULL
        AND outbox."recipientEmail" = ANY(email_keys)
      );
  GET DIAGNOSTICS redacted_outbox_count = ROW_COUNT;

  DELETE FROM public."EmailFailureCount" AS failure
   WHERE failure.email = ANY(email_keys);
  GET DIAGNOSTICS failure_count = ROW_COUNT;

  DELETE FROM public."NewsletterSubscriber" AS subscriber
   WHERE subscriber.email = ANY(email_keys);
  GET DIAGNOSTICS newsletter_count = ROW_COUNT;

  UPDATE public."EmailSuppression" AS suppression
     SET source = 'account_deletion',
         "eventId" = NULL,
         details = '{"accountDeleted":true}'::jsonb,
         "updatedAt" = source_now
   WHERE suppression.email = ANY(email_keys)
     AND suppression.reason::text = 'MANUAL';
  GET DIAGNOSTICS suppression_count = ROW_COUNT;

  INSERT INTO public."EmailSuppression" (
    id, email, reason, source, "eventId", details, "createdAt", "updatedAt"
  )
  SELECT 'account-deletion-' || pg_catalog.md5(candidate.email),
         candidate.email,
         'MANUAL'::public."EmailSuppressionReason",
         'account_deletion',
         NULL,
         '{"accountDeleted":true}'::jsonb,
         source_now,
         source_now
    FROM pg_catalog.unnest(email_keys) AS candidate(email)
   WHERE NOT EXISTS (
     SELECT 1
       FROM public."EmailSuppression" AS suppression
      WHERE suppression.email = candidate.email
   )
  ON CONFLICT (email) DO NOTHING;
  GET DIAGNOSTICS created_suppression_count = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'skippedOutboxCount', skipped_outbox_count,
    'redactedOutboxCount', redacted_outbox_count,
    'deletedFailureCount', failure_count,
    'deletedNewsletterCount', newsletter_count,
    'updatedSuppressionCount', suppression_count,
    'createdSuppressionCount', created_suppression_count
  );
END
$grainline_email_service_account_deletion_apply$;

CREATE OR REPLACE FUNCTION public.grainline_resend_webhook_event_reserve(
  p_svix_id text,
  p_type text,
  p_now timestamp(3) without time zone,
  p_retry_before timestamp(3) without time zone,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_resend_webhook_event_reserve$
DECLARE
  inserted_count integer;
  event_row record;
BEGIN
  IF p_svix_id IS NULL OR pg_catalog.char_length(p_svix_id) NOT BETWEEN 1 AND 255
     OR p_type IS NULL OR pg_catalog.char_length(p_type) NOT BETWEEN 1 AND 100
     OR p_now IS NULL OR p_retry_before IS NULL OR p_retry_before >= p_now
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Resend webhook reservation input is invalid'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public."ResendWebhookEvent" (
    "svixId", type, "claimGeneration", "claimToken", attempts,
    "processingStartedAt", "nextAttemptAt", "createdAt", "updatedAt"
  ) VALUES (
    p_svix_id, p_type, 1, p_claim_token, 1,
    p_now, NULL, p_now, p_now
  ) ON CONFLICT ("svixId") DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count = 1 THEN
    RETURN pg_catalog.jsonb_build_object(
      'action', 'process',
      'claimGeneration', 1,
      'claimToken', p_claim_token
    );
  END IF;

  SELECT event."processedAt", event."processingStartedAt", event."lastError",
         event."claimGeneration"
    INTO event_row
    FROM public."ResendWebhookEvent" AS event
   WHERE event."svixId" = p_svix_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('action', 'in_progress');
  END IF;
  IF event_row."processedAt" IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('action', 'processed');
  END IF;
  IF event_row."lastError" IS NOT NULL
     OR event_row."processingStartedAt" IS NULL
     OR event_row."processingStartedAt" < p_retry_before THEN
    UPDATE public."ResendWebhookEvent" AS event
       SET type = p_type,
           "claimGeneration" = event_row."claimGeneration" + 1,
           "claimToken" = p_claim_token,
           attempts = event.attempts + 1,
           "processingStartedAt" = p_now,
           "nextAttemptAt" = NULL,
           "lastError" = NULL,
           "updatedAt" = p_now
     WHERE event."svixId" = p_svix_id;
    RETURN pg_catalog.jsonb_build_object(
      'action', 'process',
      'claimGeneration', event_row."claimGeneration" + 1,
      'claimToken', p_claim_token
    );
  END IF;
  RETURN pg_catalog.jsonb_build_object('action', 'in_progress');
END
$grainline_resend_webhook_event_reserve$;

CREATE OR REPLACE FUNCTION public.grainline_resend_webhook_event_complete(
  p_svix_id text,
  p_claim_generation bigint,
  p_claim_token uuid,
  p_now timestamp(3) without time zone
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_resend_webhook_event_complete$
DECLARE
  updated_count integer;
BEGIN
  IF p_svix_id IS NULL OR pg_catalog.char_length(p_svix_id) NOT BETWEEN 1 AND 255
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_claim_token IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'Resend webhook completion input is invalid'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public."ResendWebhookEvent" AS event
     SET "processedAt" = p_now,
         "claimToken" = NULL,
         "processingStartedAt" = NULL,
         "nextAttemptAt" = NULL,
         "lastError" = NULL,
         "updatedAt" = p_now
   WHERE event."svixId" = p_svix_id
     AND event."processedAt" IS NULL
     AND event."claimGeneration" = p_claim_generation
     AND event."claimToken" = p_claim_token;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RETURN false;
  END IF;
  RETURN true;
END
$grainline_resend_webhook_event_complete$;

CREATE OR REPLACE FUNCTION public.grainline_resend_webhook_event_fail(
  p_svix_id text,
  p_claim_generation bigint,
  p_claim_token uuid,
  p_error text,
  p_now timestamp(3) without time zone
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_resend_webhook_event_fail$
DECLARE
  updated_count integer;
BEGIN
  IF p_svix_id IS NULL OR pg_catalog.char_length(p_svix_id) NOT BETWEEN 1 AND 255
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_claim_token IS NULL
     OR p_error IS NULL OR pg_catalog.char_length(p_error) NOT BETWEEN 1 AND 2000
     OR p_now IS NULL THEN
    RAISE EXCEPTION 'Resend webhook failure input is invalid'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public."ResendWebhookEvent" AS event
     SET "processingStartedAt" = NULL,
         "claimToken" = NULL,
         "nextAttemptAt" = NULL,
         "lastError" = p_error,
         "updatedAt" = p_now
   WHERE event."svixId" = p_svix_id
     AND event."processedAt" IS NULL
     AND event."claimGeneration" = p_claim_generation
     AND event."claimToken" = p_claim_token;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RETURN false;
  END IF;
  RETURN true;
END
$grainline_resend_webhook_event_fail$;

-- Re-check optional fanout immediately before provider contact. The enqueue
-- snapshot is not authority after an unfollow, block, or listing removal.
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
  identity_row record;
  locked_row record;
  initial_source_user_id text;
  locked_source_user_id text;
  source_active boolean;
  audience_eligible boolean;
  source_public boolean;
  source_seller_profile_id text;
  prior_actor_id text;
  recipient_follows boolean;
  block_clear boolean;
  effective_lane text;
  account_state text;
BEGIN
  SELECT id, "userId", "recipientEmail", "sourceType", "sourceId"
    INTO identity_row
    FROM public."EmailOutbox"
   WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN 'missing'; END IF;

  initial_source_user_id := public.grainline_email_outbox_source_owner(
    identity_row."sourceType"::text,
    identity_row."sourceId"::text
  );
  PERFORM public.grainline_email_outbox_lock_keys(
    ARRAY[identity_row."userId"::text, initial_source_user_id],
    ARRAY[identity_row."recipientEmail"::text]
  );

  SELECT * INTO locked_row
    FROM public."EmailOutbox"
   WHERE id = p_job_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF locked_row."userId" IS DISTINCT FROM identity_row."userId"
     OR locked_row."recipientEmail" IS DISTINCT FROM identity_row."recipientEmail"
     OR locked_row."sourceType" IS DISTINCT FROM identity_row."sourceType"
     OR locked_row."sourceId" IS DISTINCT FROM identity_row."sourceId" THEN
    RETURN 'stale_claim';
  END IF;
  IF locked_row.status IN ('SENT','SKIPPED','DEAD') THEN
    RETURN 'already_terminal';
  END IF;
  IF locked_row.status <> 'PROCESSING'
     OR locked_row."claimGeneration" <> p_claim_generation
     OR locked_row."claimToken" IS DISTINCT FROM p_claim_token THEN
    RETURN 'stale_claim';
  END IF;

  locked_source_user_id := public.grainline_email_outbox_source_owner(
    locked_row."sourceType"::text,
    locked_row."sourceId"::text
  );
  IF locked_source_user_id IS DISTINCT FROM initial_source_user_id THEN
    RETURN 'stale_claim';
  END IF;
  IF locked_row."sourceType" IN ('seller_broadcast', 'followed_maker_new_listing') THEN
    SELECT NOT account_user.banned AND account_user."deletedAt" IS NULL
      INTO source_active
      FROM public."User" AS account_user
     WHERE account_user.id = locked_source_user_id;
    IF locked_source_user_id IS NULL OR COALESCE(source_active, false) = false THEN
      UPDATE public."EmailOutbox"
         SET status = 'SKIPPED', "sentAt" = source_now, "nextAttemptAt" = NULL,
             "claimToken" = NULL, "processingStartedAt" = NULL,
             "lastError" = 'Email source became unavailable before provider attempt',
             "updatedAt" = source_now
       WHERE id = p_job_id;
      RETURN 'ineligible';
    END IF;

    IF locked_row."sourceType" = 'seller_broadcast' THEN
      SELECT broadcast."sellerProfileId", true
        INTO source_seller_profile_id, source_public
        FROM public."SellerBroadcast" AS broadcast
       WHERE broadcast.id = locked_row."sourceId";
    ELSE
      SELECT listing."sellerId",
             listing.status::text = 'ACTIVE'
             AND NOT listing."isPrivate"
             AND listing."archivedAt" IS NULL
             AND listing."sellerPubliclyOrderable"
        INTO source_seller_profile_id, source_public
        FROM public."Listing" AS listing
       WHERE listing.id = locked_row."sourceId";
    END IF;

    audience_eligible := false;
    IF locked_row."userId" IS NOT NULL
       AND source_seller_profile_id IS NOT NULL
       AND COALESCE(source_public, false) THEN
      prior_actor_id := pg_catalog.current_setting('app.user_id', true);
      PERFORM pg_catalog.set_config('app.user_id', locked_row."userId", true);
      BEGIN
        SELECT state.following
          INTO recipient_follows
          FROM public.grainline_follow_public_state_batch(
            ARRAY[source_seller_profile_id]
          ) AS state;
        SELECT NOT EXISTS (
          SELECT 1
            FROM public.grainline_user_block_targets() AS target
           WHERE target."userId" = locked_source_user_id
        ) INTO block_clear;
      EXCEPTION WHEN OTHERS THEN
        PERFORM pg_catalog.set_config(
          'app.user_id', COALESCE(prior_actor_id, ''), true
        );
        RAISE;
      END;
      PERFORM pg_catalog.set_config(
        'app.user_id', COALESCE(prior_actor_id, ''), true
      );
      audience_eligible := COALESCE(recipient_follows, false)
                           AND COALESCE(block_clear, false);
    END IF;
    IF NOT COALESCE(audience_eligible, false) THEN
      UPDATE public."EmailOutbox"
         SET status = 'SKIPPED', "sentAt" = source_now, "nextAttemptAt" = NULL,
             "claimToken" = NULL, "processingStartedAt" = NULL,
             "lastError" = 'Optional email audience became ineligible before provider attempt',
             "updatedAt" = source_now
       WHERE id = p_job_id;
      RETURN 'ineligible';
    END IF;
  END IF;

  effective_lane := public.grainline_email_outbox_effective_lane(
    locked_row."templateName"::text,
    locked_row.lane::text
  );
  account_state := public.grainline_email_outbox_recipient_state(
    locked_row."userId"::text,
    locked_row."recipientEmail"::text,
    locked_row."preferenceKey"::text,
    effective_lane
  );
  IF account_state <> 'active' THEN
    UPDATE public."EmailOutbox"
       SET status = 'SKIPPED', "sentAt" = source_now, "nextAttemptAt" = NULL,
           "claimToken" = NULL, "processingStartedAt" = NULL,
           "lastError" = public.grainline_email_outbox_safe_error(
             CASE WHEN account_state = 'hard_suppression'
               THEN 'Recipient email is hard-suppressed before provider attempt'
               ELSE 'Recipient became ineligible before provider attempt: ' || account_state
             END
           ),
           "updatedAt" = source_now
     WHERE id = p_job_id;
    RETURN 'ineligible';
  END IF;
  IF locked_row."firstProviderAttemptAt" IS NOT NULL
     AND locked_row."firstProviderAttemptAt" <= source_now - INTERVAL '23 hours' THEN
    UPDATE public."EmailOutbox"
       SET status = 'DEAD', "nextAttemptAt" = NULL, "claimToken" = NULL,
           "processingStartedAt" = NULL,
           "lastError" = 'Provider idempotency window expired; manual review required',
           "updatedAt" = source_now
     WHERE id = p_job_id;
    RETURN 'expired';
  END IF;
  UPDATE public."EmailOutbox"
     SET "firstProviderAttemptAt" = COALESCE("firstProviderAttemptAt", source_now),
         "providerAttemptGeneration" = p_claim_generation,
         "updatedAt" = source_now
   WHERE id = p_job_id;
  RETURN 'ready';
END
$grainline_email_outbox_begin_provider_attempt$;

CREATE OR REPLACE FUNCTION public.grainline_newsletter_expired_unconfirmed_delete_batch(
  p_cutoff timestamp(3) without time zone,
  p_limit integer
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_newsletter_expired_unconfirmed_delete_batch$
DECLARE
  effective_cutoff timestamp(3) without time zone;
  deleted_count integer;
BEGIN
  IF p_cutoff IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Newsletter retention input is invalid'
      USING ERRCODE = '22023';
  END IF;
  effective_cutoff := LEAST(
    p_cutoff,
    (
      pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
      - INTERVAL '30 days'
    )::timestamp(3)
  );
  WITH candidates AS (
    SELECT subscriber.id
      FROM public."NewsletterSubscriber" AS subscriber
     WHERE NOT subscriber.active
       AND subscriber."confirmedAt" IS NULL
       AND subscriber."confirmationExpiresAt" IS NOT NULL
       AND subscriber."confirmationExpiresAt" < effective_cutoff
     ORDER BY subscriber."confirmationExpiresAt" ASC, subscriber.id ASC
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public."NewsletterSubscriber" AS subscriber
   USING candidates
   WHERE subscriber.id = candidates.id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$grainline_newsletter_expired_unconfirmed_delete_batch$;

CREATE OR REPLACE FUNCTION public.grainline_email_outbox_retention_delete_batch(
  p_sent_or_skipped_cutoff timestamp(3) without time zone,
  p_dead_cutoff timestamp(3) without time zone,
  p_limit integer
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_outbox_retention_delete_batch$
DECLARE
  effective_sent_or_skipped_cutoff timestamp(3) without time zone;
  effective_dead_cutoff timestamp(3) without time zone;
  deleted_count integer;
BEGIN
  IF p_sent_or_skipped_cutoff IS NULL OR p_dead_cutoff IS NULL
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Email outbox retention input is invalid'
      USING ERRCODE = '22023';
  END IF;
  effective_sent_or_skipped_cutoff := LEAST(
    p_sent_or_skipped_cutoff,
    (
      pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
      - INTERVAL '30 days'
    )::timestamp(3)
  );
  effective_dead_cutoff := LEAST(
    p_dead_cutoff,
    (
      pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
      - INTERVAL '30 days'
    )::timestamp(3)
  );
  WITH candidates AS (
    SELECT outbox.id
      FROM public."EmailOutbox" AS outbox
     WHERE (
       outbox.status IN ('SENT', 'SKIPPED')
       AND COALESCE(outbox."sentAt", outbox."updatedAt") < effective_sent_or_skipped_cutoff
     ) OR (
       outbox.status = 'DEAD'
       AND outbox."updatedAt" < effective_dead_cutoff
     )
     ORDER BY outbox."updatedAt" ASC, outbox.id ASC
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public."EmailOutbox" AS outbox
   USING candidates
   WHERE outbox.id = candidates.id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$grainline_email_outbox_retention_delete_batch$;

CREATE OR REPLACE FUNCTION public.grainline_resend_webhook_event_retention_delete_batch(
  p_cutoff timestamp(3) without time zone,
  p_limit integer
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_resend_webhook_event_retention_delete_batch$
DECLARE
  effective_cutoff timestamp(3) without time zone;
  deleted_count integer;
BEGIN
  IF p_cutoff IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Resend webhook retention input is invalid'
      USING ERRCODE = '22023';
  END IF;
  effective_cutoff := LEAST(
    p_cutoff,
    (
      pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
      - INTERVAL '90 days'
    )::timestamp(3)
  );
  WITH candidates AS (
    SELECT event."svixId"
      FROM public."ResendWebhookEvent" AS event
     WHERE event."processedAt" IS NOT NULL
       AND event."processedAt" < effective_cutoff
     ORDER BY event."processedAt" ASC, event."svixId" ASC
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public."ResendWebhookEvent" AS event
   USING candidates
   WHERE event."svixId" = candidates."svixId";
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$grainline_resend_webhook_event_retention_delete_batch$;

CREATE OR REPLACE FUNCTION public.grainline_email_service_ops_health(
  p_stale_email_before timestamp(3) without time zone,
  p_stale_svix_before timestamp(3) without time zone
)
RETURNS TABLE (
  "staleEmailCount" integer,
  "deadEmailCount" integer,
  "stalledResendCount" integer
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_service_ops_health$
BEGIN
  IF p_stale_email_before IS NULL OR p_stale_svix_before IS NULL THEN
    RAISE EXCEPTION 'Email service health input is invalid'
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT
    (
      SELECT pg_catalog.count(*)::integer
        FROM public."EmailOutbox" AS outbox
       WHERE outbox.status IN ('PENDING', 'PROCESSING')
         AND outbox."nextAttemptAt" < p_stale_email_before
    ),
    (
      SELECT pg_catalog.count(*)::integer
        FROM public."EmailOutbox" AS outbox
       WHERE outbox.status = 'DEAD'
         AND outbox."acknowledgedAt" IS NULL
    ),
    (
      SELECT pg_catalog.count(*)::integer
        FROM public."ResendWebhookEvent" AS event
       WHERE event."processedAt" IS NULL
         AND event."acknowledgedAt" IS NULL
         AND (
           event."lastError" IS NOT NULL
           OR event."processingStartedAt" IS NULL
           OR event."processingStartedAt" < p_stale_svix_before
         )
    )
  ;
END
$grainline_email_service_ops_health$;

CREATE OR REPLACE FUNCTION public.grainline_email_outbox_cancel_seller_broadcast(
  p_broadcast_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_outbox_cancel_seller_broadcast$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  deleted_count integer;
BEGIN
  IF actor_id IS NULL OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_broadcast_id IS NULL
     OR pg_catalog.char_length(p_broadcast_id) NOT BETWEEN 1 AND 191
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = actor_id
          AND actor."deletedAt" IS NULL
          AND NOT actor.banned
          AND actor.role::text IN ('EMPLOYEE', 'ADMIN')
     ) THEN
    RAISE EXCEPTION 'Seller broadcast email cancellation context is invalid'
      USING ERRCODE = '42501';
  END IF;
  DELETE FROM public."EmailOutbox" AS outbox
   WHERE outbox."preferenceKey" = 'EMAIL_SELLER_BROADCAST'
     AND outbox."sourceType" = 'seller_broadcast'
     AND outbox."sourceId" = p_broadcast_id
     AND outbox.status IN ('PENDING', 'FAILED');
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$grainline_email_outbox_cancel_seller_broadcast$;

CREATE OR REPLACE FUNCTION public.grainline_email_outbox_redact_deleted_seller(
  p_seller_profile_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_outbox_redact_deleted_seller$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  updated_count integer;
BEGIN
  IF actor_id IS NULL OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_seller_profile_id IS NULL
     OR pg_catalog.char_length(p_seller_profile_id) NOT BETWEEN 1 AND 191
     OR NOT EXISTS (
       SELECT 1
         FROM public."SellerProfile" AS seller
        WHERE seller.id = p_seller_profile_id
          AND seller."userId" = actor_id
     ) THEN
    RAISE EXCEPTION 'Deleted-seller email redaction context is invalid'
      USING ERRCODE = '42501';
  END IF;

  WITH source_rows AS MATERIALIZED (
    SELECT 'seller_broadcast'::text AS source_type, broadcast.id AS source_id
      FROM public."SellerBroadcast" AS broadcast
     WHERE broadcast."sellerProfileId" = p_seller_profile_id
    UNION ALL
    SELECT 'followed_maker_new_listing'::text, listing.id
      FROM public."Listing" AS listing
     WHERE listing."sellerId" = p_seller_profile_id
  ), candidate_ids AS MATERIALIZED (
    SELECT outbox.id
      FROM source_rows AS source
      JOIN public."EmailOutbox" AS outbox
        ON outbox."sourceType" = source.source_type
       AND outbox."sourceId" = source.source_id
    UNION
    SELECT outbox.id
      FROM public."EmailOutbox" AS outbox
      JOIN source_rows AS source
        ON source.source_type = 'seller_broadcast'
       AND source.source_id = pg_catalog.split_part(outbox."dedupKey", ':', 2)
     WHERE outbox."templateName" = 'seller_broadcast'
       AND outbox."preferenceKey" = 'EMAIL_SELLER_BROADCAST'
       AND pg_catalog.split_part(outbox."dedupKey", ':', 1) = 'seller-broadcast'
       AND pg_catalog.char_length(outbox."dedupKey")
             > pg_catalog.char_length('seller-broadcast:' || source.source_id)
    UNION
    SELECT outbox.id
      FROM public."EmailOutbox" AS outbox
      JOIN source_rows AS source
        ON source.source_type = 'followed_maker_new_listing'
       AND source.source_id = pg_catalog.split_part(outbox."dedupKey", ':', 2)
     WHERE outbox."templateName" = 'followed_maker_new_listing'
       AND outbox."preferenceKey" = 'EMAIL_FOLLOWED_MAKER_NEW_LISTING'
       AND pg_catalog.split_part(outbox."dedupKey", ':', 1) IN (
         'followed-listing',
         'admin-approved-listing',
         'followed-listing-active'
       )
       AND pg_catalog.char_length(outbox."dedupKey")
             > pg_catalog.char_length(
                 pg_catalog.split_part(outbox."dedupKey", ':', 1)
                 || ':' || source.source_id
               )
  ), candidates AS (
    SELECT outbox.id
      FROM public."EmailOutbox" AS outbox
      JOIN candidate_ids AS candidate
        ON candidate.id = outbox.id
     FOR UPDATE OF outbox
  )
  UPDATE public."EmailOutbox" AS outbox
     SET status = CASE
           WHEN outbox."sentAt" IS NULL
                AND outbox.status IN ('PENDING', 'PROCESSING', 'FAILED', 'DEAD')
             THEN 'SKIPPED'
           ELSE outbox.status
         END,
         "nextAttemptAt" = CASE
           WHEN outbox."sentAt" IS NULL
                AND outbox.status IN ('PENDING', 'PROCESSING', 'FAILED', 'DEAD')
             THEN NULL
           ELSE outbox."nextAttemptAt"
         END,
         "sentAt" = CASE
           WHEN outbox."sentAt" IS NULL
                AND outbox.status IN ('PENDING', 'PROCESSING', 'FAILED', 'DEAD')
             THEN source_now
           ELSE outbox."sentAt"
         END,
         "claimToken" = NULL,
         "processingStartedAt" = NULL,
         "providerAttemptGeneration" = NULL,
         "lastError" = CASE
           WHEN outbox."sentAt" IS NULL
             THEN 'Skipped because the source maker account was deleted.'
           ELSE outbox."lastError"
         END,
         subject = CASE
           WHEN outbox."payloadVersion" IS NULL
             THEN 'Email removed after maker deletion'
           ELSE NULL
         END,
         html = CASE
           WHEN outbox."payloadVersion" IS NULL
             THEN '[Email removed after maker deletion]'
           ELSE NULL
         END,
         payload = CASE
           WHEN outbox."payloadVersion" IS NULL THEN NULL
           ELSE '{}'::jsonb
         END,
         "updatedAt" = source_now
    FROM candidates
   WHERE outbox.id = candidates.id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END
$grainline_email_outbox_redact_deleted_seller$;

REVOKE ALL ON FUNCTION public.grainline_email_suppression_exists(text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_one_click_suppression_clear(text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_newsletter_signup_reserve(
  text, text, text, timestamp without time zone,
  timestamp without time zone, timestamp without time zone
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_newsletter_signup_release(text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_newsletter_confirmation_valid(
  text, timestamp without time zone
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_newsletter_confirm(
  text, timestamp without time zone
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_newsletter_token_superseded(
  text, timestamp without time zone
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_unsubscribe_apply(text, jsonb)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_account_deletion_suppression_clear(text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_service_owner_export()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_service_account_deletion_apply()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_resend_webhook_event_reserve(
  text, text, timestamp without time zone, timestamp without time zone, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_resend_webhook_event_complete(
  text, bigint, uuid, timestamp without time zone
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_resend_webhook_event_fail(
  text, bigint, uuid, text, timestamp without time zone
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_outbox_begin_provider_attempt(
  text, bigint, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_newsletter_expired_unconfirmed_delete_batch(
  timestamp without time zone, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_outbox_retention_delete_batch(
  timestamp without time zone, timestamp without time zone, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_resend_webhook_event_retention_delete_batch(
  timestamp without time zone, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_service_ops_health(
  timestamp without time zone, timestamp without time zone
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_outbox_cancel_seller_broadcast(text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_outbox_redact_deleted_seller(text)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.grainline_email_suppression_exists(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_email_one_click_suppression_clear(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_newsletter_signup_reserve(
  text, text, text, timestamp without time zone,
  timestamp without time zone, timestamp without time zone
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_newsletter_signup_release(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_newsletter_confirmation_valid(
  text, timestamp without time zone
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_newsletter_confirm(
  text, timestamp without time zone
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_newsletter_token_superseded(
  text, timestamp without time zone
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_email_unsubscribe_apply(text, jsonb)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_email_account_deletion_suppression_clear(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_email_service_owner_export()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_email_service_account_deletion_apply()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_resend_webhook_event_reserve(
  text, text, timestamp without time zone, timestamp without time zone, uuid
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_resend_webhook_event_complete(
  text, bigint, uuid, timestamp without time zone
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_resend_webhook_event_fail(
  text, bigint, uuid, text, timestamp without time zone
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_email_outbox_begin_provider_attempt(
  text, bigint, uuid
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_newsletter_expired_unconfirmed_delete_batch(
  timestamp without time zone, integer
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_email_outbox_retention_delete_batch(
  timestamp without time zone, timestamp without time zone, integer
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_resend_webhook_event_retention_delete_batch(
  timestamp without time zone, integer
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_email_service_ops_health(
  timestamp without time zone, timestamp without time zone
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_email_outbox_cancel_seller_broadcast(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_email_outbox_redact_deleted_seller(text)
  TO grainline_app_runtime;

DO $postflight$
DECLARE
  expected_signature text;
BEGIN
  FOREACH expected_signature IN ARRAY ARRAY[
    'public.grainline_email_suppression_exists(text,text)',
    'public.grainline_email_one_click_suppression_clear(text)',
    'public.grainline_newsletter_signup_reserve(text,text,text,timestamp without time zone,timestamp without time zone,timestamp without time zone)',
    'public.grainline_newsletter_signup_release(text,text)',
    'public.grainline_newsletter_confirmation_valid(text,timestamp without time zone)',
    'public.grainline_newsletter_confirm(text,timestamp without time zone)',
    'public.grainline_newsletter_token_superseded(text,timestamp without time zone)',
    'public.grainline_email_unsubscribe_apply(text,jsonb)',
    'public.grainline_email_account_deletion_suppression_clear(text)',
    'public.grainline_email_service_owner_export()',
    'public.grainline_email_service_account_deletion_apply()',
    'public.grainline_resend_webhook_event_reserve(text,text,timestamp without time zone,timestamp without time zone,uuid)',
    'public.grainline_resend_webhook_event_complete(text,bigint,uuid,timestamp without time zone)',
    'public.grainline_resend_webhook_event_fail(text,bigint,uuid,text,timestamp without time zone)',
    'public.grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)',
    'public.grainline_newsletter_expired_unconfirmed_delete_batch(timestamp without time zone,integer)',
    'public.grainline_email_outbox_retention_delete_batch(timestamp without time zone,timestamp without time zone,integer)',
    'public.grainline_resend_webhook_event_retention_delete_batch(timestamp without time zone,integer)',
    'public.grainline_email_service_ops_health(timestamp without time zone,timestamp without time zone)',
    'public.grainline_email_outbox_cancel_seller_broadcast(text)',
    'public.grainline_email_outbox_redact_deleted_seller(text)'
  ]::text[] LOOP
    IF pg_catalog.to_regprocedure(expected_signature) IS NULL
       OR NOT pg_catalog.has_function_privilege(
         'grainline_app_runtime', expected_signature, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Email service preparation function % is incomplete',
        expected_signature;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = ANY(ARRAY[
       'public.grainline_email_suppression_exists(text,text)'::pg_catalog.regprocedure,
       'public.grainline_email_one_click_suppression_clear(text)'::pg_catalog.regprocedure,
       'public.grainline_newsletter_signup_reserve(text,text,text,timestamp without time zone,timestamp without time zone,timestamp without time zone)'::pg_catalog.regprocedure,
       'public.grainline_newsletter_signup_release(text,text)'::pg_catalog.regprocedure,
       'public.grainline_newsletter_confirmation_valid(text,timestamp without time zone)'::pg_catalog.regprocedure,
       'public.grainline_newsletter_confirm(text,timestamp without time zone)'::pg_catalog.regprocedure,
       'public.grainline_newsletter_token_superseded(text,timestamp without time zone)'::pg_catalog.regprocedure,
       'public.grainline_email_unsubscribe_apply(text,jsonb)'::pg_catalog.regprocedure,
       'public.grainline_email_account_deletion_suppression_clear(text)'::pg_catalog.regprocedure,
       'public.grainline_email_service_owner_export()'::pg_catalog.regprocedure,
       'public.grainline_email_service_account_deletion_apply()'::pg_catalog.regprocedure,
       'public.grainline_resend_webhook_event_reserve(text,text,timestamp without time zone,timestamp without time zone,uuid)'::pg_catalog.regprocedure,
       'public.grainline_resend_webhook_event_complete(text,bigint,uuid,timestamp without time zone)'::pg_catalog.regprocedure,
       'public.grainline_resend_webhook_event_fail(text,bigint,uuid,text,timestamp without time zone)'::pg_catalog.regprocedure,
       'public.grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)'::pg_catalog.regprocedure,
       'public.grainline_newsletter_expired_unconfirmed_delete_batch(timestamp without time zone,integer)'::pg_catalog.regprocedure,
       'public.grainline_email_outbox_retention_delete_batch(timestamp without time zone,timestamp without time zone,integer)'::pg_catalog.regprocedure,
       'public.grainline_resend_webhook_event_retention_delete_batch(timestamp without time zone,integer)'::pg_catalog.regprocedure,
       'public.grainline_email_service_ops_health(timestamp without time zone,timestamp without time zone)'::pg_catalog.regprocedure,
       'public.grainline_email_outbox_cancel_seller_broadcast(text)'::pg_catalog.regprocedure,
       'public.grainline_email_outbox_redact_deleted_seller(text)'::pg_catalog.regprocedure
     ])
       AND (
         NOT routine.prosecdef
         OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
         OR NOT EXISTS (
           SELECT 1
             FROM pg_catalog.pg_roles AS owner_role
            WHERE owner_role.oid = routine.proowner
              AND (owner_role.rolsuper OR owner_role.rolbypassrls)
         )
         OR EXISTS (
           SELECT 1
             FROM pg_catalog.aclexplode(
               COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
             ) AS acl
            WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
         )
       )
  ) THEN
    RAISE EXCEPTION 'Email service preparation function security drifted';
  END IF;
END
$postflight$;

COMMIT;
