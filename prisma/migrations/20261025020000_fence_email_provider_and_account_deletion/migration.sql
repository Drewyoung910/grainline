-- Serialize email enqueue/provider-start with recipient and source-owner
-- account deletion. Locks are transaction-scoped and never span provider I/O.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public."EmailOutbox"') IS NULL
     OR pg_catalog.to_regclass('public."User"') IS NULL
     OR pg_catalog.to_regclass('public."SellerBroadcast"') IS NULL
     OR pg_catalog.to_regclass('public."Listing"') IS NULL
     OR pg_catalog.to_regprocedure(
          'public.grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)'
        ) IS NULL
     OR pg_catalog.to_regprocedure(
          'public.grainline_email_outbox_recipient_state(text,text,text,text)'
        ) IS NULL
     OR pg_catalog.to_regprocedure(
          'public.grainline_account_deletion_email_key_core(text)'
        ) IS NULL THEN
    RAISE EXCEPTION 'Email provider/deletion fence predecessors are unavailable';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public."EmailOutbox"'::pg_catalog.regclass
       AND attname IN (
         'recipientEmail', 'userId', 'preferenceKey', 'templateName',
         'templateVersion', 'sourceType', 'sourceId', 'subject', 'html',
         'dedupKey', 'status', 'attempts', 'claimGeneration', 'claimToken',
         'processingStartedAt', 'firstProviderAttemptAt',
         'providerAttemptGeneration', 'providerMessageId', 'nextAttemptAt',
         'sentAt', 'lastError', 'createdAt', 'updatedAt'
       )
       AND attisdropped
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public."EmailOutbox"'::pg_catalog.regclass
       AND attname IN (
         'recipientEmail', 'userId', 'preferenceKey', 'templateName',
         'templateVersion', 'sourceType', 'sourceId', 'subject', 'html',
         'dedupKey', 'status', 'attempts', 'claimGeneration', 'claimToken',
         'processingStartedAt', 'firstProviderAttemptAt',
         'providerAttemptGeneration', 'providerMessageId', 'nextAttemptAt',
         'sentAt', 'lastError', 'createdAt', 'updatedAt'
       )
       AND NOT attisdropped
  ) <> 23 THEN
    RAISE EXCEPTION 'EmailOutbox provider/deletion fence columns drifted';
  END IF;
END
$preflight$;

-- Historical seller fanout rows predate the durable source identity. Recover
-- the exact source from their deterministic dedup keys before account deletion
-- starts relying on source ownership. Hold the table lock through function
-- replacement so no worker can claim or mutate a candidate mid-reconciliation.
LOCK TABLE public."EmailOutbox" IN SHARE ROW EXCLUSIVE MODE;

DO $legacy_source_reconciliation$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  UPDATE public."EmailOutbox" AS outbox
     SET "sourceType" = 'seller_broadcast',
         "sourceId" = pg_catalog.split_part(outbox."dedupKey", ':', 2),
         "updatedAt" = source_now
   WHERE outbox."templateName" = 'seller_broadcast'
     AND outbox."preferenceKey" = 'EMAIL_SELLER_BROADCAST'
     AND pg_catalog.split_part(outbox."dedupKey", ':', 1) = 'seller-broadcast'
     AND pg_catalog.split_part(outbox."dedupKey", ':', 2) <> ''
     AND EXISTS (
       SELECT 1
         FROM public."SellerBroadcast" AS broadcast
        WHERE broadcast.id = pg_catalog.split_part(outbox."dedupKey", ':', 2)
     )
     AND outbox."sourceType" IS NULL
     AND outbox."sourceId" IS NULL;

  UPDATE public."EmailOutbox" AS outbox
     SET "sourceType" = 'followed_maker_new_listing',
         "sourceId" = pg_catalog.split_part(outbox."dedupKey", ':', 2),
         "updatedAt" = source_now
   WHERE outbox."templateName" = 'followed_maker_new_listing'
     AND outbox."preferenceKey" = 'EMAIL_FOLLOWED_MAKER_NEW_LISTING'
     AND pg_catalog.split_part(outbox."dedupKey", ':', 1) IN (
       'followed-listing',
       'admin-approved-listing',
       'followed-listing-active'
     )
     AND pg_catalog.split_part(outbox."dedupKey", ':', 2) <> ''
     AND EXISTS (
       SELECT 1
         FROM public."Listing" AS listing
        WHERE listing.id = pg_catalog.split_part(outbox."dedupKey", ':', 2)
     )
     AND outbox."sourceType" IS NULL
     AND outbox."sourceId" IS NULL;

  -- A still-ambiguous provider call cannot be discarded or reassigned safely.
  -- Refuse the whole migration, leaving no partial SECURITY DEFINER functions
  -- or grants behind, until an operator resolves the row.
  IF EXISTS (
    SELECT 1
      FROM public."EmailOutbox" AS outbox
     WHERE (
       (outbox."templateName" = 'seller_broadcast'
        AND outbox."preferenceKey" = 'EMAIL_SELLER_BROADCAST')
       OR
       (outbox."templateName" = 'followed_maker_new_listing'
        AND outbox."preferenceKey" = 'EMAIL_FOLLOWED_MAKER_NEW_LISTING')
     )
       AND outbox."providerAttemptGeneration" IS NOT NULL
       AND outbox."providerMessageId" IS NULL
       AND (
         outbox."firstProviderAttemptAt" IS NULL
         OR outbox."firstProviderAttemptAt" > source_now - INTERVAL '23 hours'
       )
       AND NOT (
         (outbox."templateName" = 'seller_broadcast'
          AND outbox."sourceType" = 'seller_broadcast'
          AND EXISTS (
            SELECT 1
              FROM public."SellerBroadcast" AS broadcast
             WHERE broadcast.id = outbox."sourceId"
          ))
         OR
         (outbox."templateName" = 'followed_maker_new_listing'
          AND outbox."sourceType" = 'followed_maker_new_listing'
          AND EXISTS (
            SELECT 1
              FROM public."Listing" AS listing
             WHERE listing.id = outbox."sourceId"
          ))
       )
  ) THEN
    RAISE EXCEPTION
      'Email provider/deletion fence found an active ambiguous legacy seller fanout row';
  END IF;

  -- Rows with no possible provider ambiguity can be retired safely. Preserve
  -- the representation constraint for both legacy rendered and structured jobs.
  UPDATE public."EmailOutbox" AS outbox
     SET status = 'SKIPPED',
         "sentAt" = COALESCE(outbox."sentAt", source_now),
         "nextAttemptAt" = NULL,
         "claimToken" = NULL,
         "processingStartedAt" = NULL,
         "providerAttemptGeneration" = NULL,
         "sourceType" = NULL,
         "sourceId" = NULL,
         subject = CASE
           WHEN outbox."payloadVersion" IS NULL
             THEN 'Email removed because its historical source is unavailable'
           ELSE NULL
         END,
         html = CASE
           WHEN outbox."payloadVersion" IS NULL
             THEN '[Email removed because its historical source is unavailable]'
           ELSE NULL
         END,
         payload = CASE
           WHEN outbox."payloadVersion" IS NULL THEN NULL
           ELSE '{}'::jsonb
         END,
         "lastError" = 'Historical seller fanout source is unavailable; email skipped',
         "updatedAt" = source_now
   WHERE (
       (outbox."templateName" = 'seller_broadcast'
        AND outbox."preferenceKey" = 'EMAIL_SELLER_BROADCAST')
       OR
       (outbox."templateName" = 'followed_maker_new_listing'
        AND outbox."preferenceKey" = 'EMAIL_FOLLOWED_MAKER_NEW_LISTING')
     )
     AND (
       outbox.status IN ('PENDING', 'PROCESSING', 'FAILED')
       OR (
         outbox."providerAttemptGeneration" IS NOT NULL
         AND outbox."providerMessageId" IS NULL
         AND (
           outbox."firstProviderAttemptAt" IS NULL
           OR outbox."firstProviderAttemptAt" > source_now - INTERVAL '23 hours'
         )
       )
     )
     AND NOT (
       (outbox."templateName" = 'seller_broadcast'
        AND outbox."sourceType" = 'seller_broadcast'
        AND EXISTS (
          SELECT 1
            FROM public."SellerBroadcast" AS broadcast
           WHERE broadcast.id = outbox."sourceId"
        ))
       OR
       (outbox."templateName" = 'followed_maker_new_listing'
        AND outbox."sourceType" = 'followed_maker_new_listing'
        AND EXISTS (
          SELECT 1
            FROM public."Listing" AS listing
           WHERE listing.id = outbox."sourceId"
        ))
     );
END
$legacy_source_reconciliation$;

CREATE OR REPLACE FUNCTION public.grainline_email_outbox_source_owner(
  p_source_type text,
  p_source_id text
)
RETURNS text
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_outbox_source_owner$
DECLARE
  source_user_id text;
BEGIN
  IF (p_source_type IS NULL) <> (p_source_id IS NULL) THEN
    RAISE EXCEPTION 'Email outbox source identity is incomplete'
      USING ERRCODE = '22023';
  END IF;
  IF p_source_type IS NULL THEN RETURN NULL; END IF;
  IF pg_catalog.char_length(p_source_type) NOT BETWEEN 1 AND 80
     OR pg_catalog.char_length(p_source_id) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Email outbox source identity is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_source_type = 'seller_broadcast' THEN
    SELECT seller."userId"
      INTO source_user_id
      FROM public."SellerBroadcast" AS broadcast
      JOIN public."SellerProfile" AS seller
        ON seller.id = broadcast."sellerProfileId"
     WHERE broadcast.id = p_source_id;
  ELSIF p_source_type = 'followed_maker_new_listing' THEN
    SELECT seller."userId"
      INTO source_user_id
      FROM public."Listing" AS listing
      JOIN public."SellerProfile" AS seller
        ON seller.id = listing."sellerId"
     WHERE listing.id = p_source_id;
  END IF;

  RETURN source_user_id;
END
$grainline_email_outbox_source_owner$;

CREATE OR REPLACE FUNCTION public.grainline_email_outbox_lock_keys(
  p_user_ids text[],
  p_emails text[]
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SET search_path = pg_catalog
AS $grainline_email_outbox_lock_keys$
DECLARE
  candidate text;
  normalized text;
  canonical text;
BEGIN
  FOR candidate IN
    SELECT DISTINCT supplied.value
      FROM pg_catalog.unnest(COALESCE(p_user_ids, ARRAY[]::text[])) AS supplied(value)
     WHERE supplied.value IS NOT NULL
       AND pg_catalog.char_length(supplied.value) BETWEEN 1 AND 191
     ORDER BY supplied.value
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('grainline.email.account:' || candidate, 0)
    );
  END LOOP;

  FOR candidate IN
    SELECT DISTINCT key_value
      FROM (
        SELECT pg_catalog.lower(pg_catalog.btrim(supplied.value)) AS key_value
          FROM pg_catalog.unnest(COALESCE(p_emails, ARRAY[]::text[])) AS supplied(value)
         WHERE supplied.value IS NOT NULL
        UNION ALL
        SELECT public.grainline_account_deletion_email_key_core(supplied.value)
          FROM pg_catalog.unnest(COALESCE(p_emails, ARRAY[]::text[])) AS supplied(value)
         WHERE supplied.value IS NOT NULL
      ) AS keys
     WHERE key_value IS NOT NULL
       AND pg_catalog.char_length(key_value) BETWEEN 3 AND 254
       AND pg_catalog.strpos(key_value, '@') > 1
     ORDER BY key_value
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('grainline.email.address:' || candidate, 0)
    );
  END LOOP;
END
$grainline_email_outbox_lock_keys$;

CREATE OR REPLACE FUNCTION public.grainline_email_outbox_enqueue_legacy(
  p_id text,
  p_recipient_email text,
  p_user_id text,
  p_preference_key text,
  p_template_name text,
  p_template_version integer,
  p_source_type text,
  p_source_id text,
  p_subject text,
  p_html text,
  p_dedup_key text
)
RETURNS TABLE (
  "jobId" text,
  created boolean,
  outcome text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_outbox_enqueue_legacy$
DECLARE
  source_user_id text;
  source_active boolean;
  effective_lane text;
  account_state text;
  inserted_id text;
  retained_row record;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  IF p_id IS NULL OR pg_catalog.char_length(p_id) NOT BETWEEN 1 AND 191
     OR p_recipient_email IS NULL
     OR p_recipient_email IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(p_recipient_email))
     OR pg_catalog.char_length(p_recipient_email) NOT BETWEEN 3 AND 254
     OR pg_catalog.strpos(p_recipient_email, '@') <= 1
     OR (p_user_id IS NOT NULL AND pg_catalog.char_length(p_user_id) NOT BETWEEN 1 AND 191)
     OR (p_preference_key IS NOT NULL AND pg_catalog.char_length(p_preference_key) NOT BETWEEN 1 AND 80)
     OR p_template_name IS NULL
     OR pg_catalog.char_length(p_template_name) NOT BETWEEN 1 AND 80
     OR p_template_version IS NULL OR p_template_version < 1
     OR (p_source_type IS NULL) <> (p_source_id IS NULL)
     OR (
       p_source_type IS NOT NULL
       AND p_source_type NOT IN ('seller_broadcast', 'followed_maker_new_listing')
     )
     OR p_subject IS NULL OR pg_catalog.char_length(p_subject) > 300
     OR p_html IS NULL OR pg_catalog.char_length(p_html) > 200000
     OR p_dedup_key IS NULL OR pg_catalog.char_length(p_dedup_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'Email outbox enqueue input is invalid'
      USING ERRCODE = '22023';
  END IF;

  effective_lane := public.grainline_email_outbox_effective_lane(
    p_template_name,
    NULL
  );
  IF effective_lane IS NULL THEN
    RAISE EXCEPTION 'Email outbox template is invalid'
      USING ERRCODE = '22023';
  END IF;

  source_user_id := public.grainline_email_outbox_source_owner(
    p_source_type,
    p_source_id
  );
  PERFORM public.grainline_email_outbox_lock_keys(
    ARRAY[p_user_id, source_user_id],
    ARRAY[p_recipient_email]
  );

  -- Re-derive all mutable eligibility after acquiring the shared fence.
  source_user_id := public.grainline_email_outbox_source_owner(
    p_source_type,
    p_source_id
  );
  IF p_source_type IN ('seller_broadcast', 'followed_maker_new_listing') THEN
    IF source_user_id IS NULL THEN
      RETURN QUERY SELECT NULL::text, false, 'source_ineligible'::text;
      RETURN;
    END IF;
    SELECT NOT account_user.banned AND account_user."deletedAt" IS NULL
      INTO source_active
      FROM public."User" AS account_user
     WHERE account_user.id = source_user_id;
    IF COALESCE(source_active, false) = false THEN
      RETURN QUERY SELECT NULL::text, false, 'source_ineligible'::text;
      RETURN;
    END IF;
  END IF;

  account_state := public.grainline_email_outbox_recipient_state(
    p_user_id,
    p_recipient_email,
    p_preference_key,
    effective_lane
  );
  IF account_state <> 'active' THEN
    RETURN QUERY SELECT NULL::text, false, account_state;
    RETURN;
  END IF;

  INSERT INTO public."EmailOutbox" (
    id, "recipientEmail", "userId", "preferenceKey", "templateName",
    "templateVersion", "sourceType", "sourceId", subject, html, lane,
    "dedupKey", status, attempts, "claimGeneration", "nextAttemptAt",
    "createdAt", "updatedAt"
  ) VALUES (
    p_id, p_recipient_email, p_user_id, p_preference_key, p_template_name,
    p_template_version, p_source_type, p_source_id, p_subject, p_html,
    effective_lane, p_dedup_key, 'PENDING', 0, 0, source_now,
    source_now, source_now
  )
  ON CONFLICT ("dedupKey") DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NOT NULL THEN
    RETURN QUERY SELECT inserted_id, true, 'ready'::text;
    RETURN;
  END IF;

  SELECT * INTO retained_row
    FROM public."EmailOutbox"
   WHERE "dedupKey" = p_dedup_key;
  IF NOT FOUND
     OR retained_row."recipientEmail" IS DISTINCT FROM p_recipient_email
     OR retained_row."userId" IS DISTINCT FROM p_user_id
     OR retained_row."preferenceKey" IS DISTINCT FROM p_preference_key
     OR retained_row."templateName" IS DISTINCT FROM p_template_name
     OR retained_row."templateVersion" IS DISTINCT FROM p_template_version
     OR retained_row."sourceType" IS DISTINCT FROM p_source_type
     OR retained_row."sourceId" IS DISTINCT FROM p_source_id THEN
    RAISE EXCEPTION 'Email outbox dedup identity conflicts with retained row'
      USING ERRCODE = '23505';
  END IF;

  RETURN QUERY SELECT retained_row.id::text, false, 'ready'::text;
END
$grainline_email_outbox_enqueue_legacy$;

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
  IF locked_row.status IN ('SENT','SKIPPED','DEAD') THEN RETURN 'already_terminal'; END IF;
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

CREATE OR REPLACE FUNCTION public.grainline_email_outbox_account_deletion_fence(
  p_user_id text,
  p_email_keys text[]
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_outbox_account_deletion_fence$
DECLARE
  candidate record;
  pending_count integer := 0;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  IF p_user_id IS NULL OR pg_catalog.char_length(p_user_id) NOT BETWEEN 1 AND 191
     OR pg_catalog.current_setting('app.user_id', true) IS DISTINCT FROM p_user_id
     OR p_email_keys IS NULL
     OR pg_catalog.cardinality(p_email_keys) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Email outbox account-deletion fence is unauthorized'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.grainline_email_outbox_lock_keys(
    ARRAY[p_user_id],
    p_email_keys
  );

  FOR candidate IN
    SELECT outbox.id
      FROM public."EmailOutbox" AS outbox
     WHERE outbox."providerAttemptGeneration" IS NOT NULL
       AND outbox."providerMessageId" IS NULL
       AND (
         outbox."firstProviderAttemptAt" IS NULL
         OR outbox."firstProviderAttemptAt" > source_now - INTERVAL '23 hours'
       )
       AND (
         outbox."userId" = p_user_id
         OR public.grainline_account_deletion_email_key_core(
              outbox."recipientEmail"::text
            ) = ANY(p_email_keys)
         OR public.grainline_email_outbox_source_owner(
              outbox."sourceType"::text,
              outbox."sourceId"::text
            ) = p_user_id
       )
     ORDER BY outbox.id
     FOR UPDATE
  LOOP
    pending_count := pending_count + 1;
  END LOOP;

  RETURN pending_count;
END
$grainline_email_outbox_account_deletion_fence$;

-- Definitive local/provider rejection proves that no provider request remains
-- ambiguous. Retryable and unexpected outcomes retain the current marker.
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
  definitive_failure boolean;
BEGIN
  IF p_error_class NOT IN (
    'provider_retryable', 'provider_rejected', 'invalid_payload',
    'configuration', 'unexpected_internal'
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

  definitive_failure := p_error_class IN (
    'provider_rejected', 'invalid_payload', 'configuration'
  );
  IF definitive_failure
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
         "providerAttemptGeneration" = CASE
           WHEN definitive_failure THEN NULL
           ELSE "providerAttemptGeneration"
         END,
         "lastError" = public.grainline_email_outbox_safe_error(p_error_summary),
         "updatedAt" = source_now
   WHERE id = p_job_id;
  RETURN 'applied';
END
$grainline_email_outbox_fail$;

REVOKE ALL ON FUNCTION public.grainline_email_outbox_source_owner(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_outbox_lock_keys(text[], text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_outbox_enqueue_legacy(
  text, text, text, text, text, integer, text, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_email_outbox_account_deletion_fence(text, text[])
  FROM PUBLIC;

DO $grant_runtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.grainline_email_outbox_enqueue_legacy(
      text, text, text, text, text, integer, text, text, text, text, text
    ) TO grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION public.grainline_email_outbox_account_deletion_fence(text, text[])
      TO grainline_app_runtime;
  END IF;
END
$grant_runtime$;

DO $postflight$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.grainline_email_outbox_enqueue_legacy(text,text,text,text,text,integer,text,text,text,text,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_email_outbox_account_deletion_fence(text,text[])'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Email provider/deletion fence functions are incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."EmailOutbox" AS outbox
     WHERE (
       (outbox."templateName" = 'seller_broadcast'
        AND outbox."preferenceKey" = 'EMAIL_SELLER_BROADCAST')
       OR
       (outbox."templateName" = 'followed_maker_new_listing'
        AND outbox."preferenceKey" = 'EMAIL_FOLLOWED_MAKER_NEW_LISTING')
     )
       AND (
         outbox.status IN ('PENDING', 'PROCESSING', 'FAILED')
         OR (
           outbox."providerAttemptGeneration" IS NOT NULL
           AND outbox."providerMessageId" IS NULL
           AND (
             outbox."firstProviderAttemptAt" IS NULL
             OR outbox."firstProviderAttemptAt" >
                (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
                  - INTERVAL '23 hours'
           )
         )
       )
       AND public.grainline_email_outbox_source_owner(
         outbox."sourceType"::text,
         outbox."sourceId"::text
       ) IS NULL
  ) THEN
    RAISE EXCEPTION 'Email provider/deletion fence left an active seller fanout source unresolved';
  END IF;
END
$postflight$;

COMMIT;
