-- Correct three regressions in the already-applied email provider/deletion
-- fence without editing either sealed predecessor migration:
--   * transactional order/case source identities must be enqueueable;
--   * account deletion must handle the complete historical-address set;
--   * retryable failures retain the predecessor exponential retry window.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE
  email_outbox_owner oid;
BEGIN
  IF pg_catalog.to_regclass('public."EmailOutbox"') IS NULL THEN
    RAISE EXCEPTION 'Email outbox correction predecessor table is unavailable';
  END IF;

  SELECT class.relowner
    INTO STRICT email_outbox_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."EmailOutbox"'::pg_catalog.regclass
     AND class.relkind = 'r';

  IF EXISTS (
    SELECT 1
      FROM (
        VALUES
          (
            'public.grainline_email_outbox_enqueue_legacy(text,text,text,text,text,integer,text,text,text,text,text)',
            'c175b462cf5427e2f15dddbcc9a4ec1a'
          ),
          (
            'public.grainline_email_outbox_account_deletion_fence(text,text[])',
            '508a22265993fde9d14c062a76630d76'
          ),
          (
            'public.grainline_email_outbox_fail(text,bigint,uuid,text,text)',
            'cdfdfc38a37e4f7eda3df91fc1e98021'
          )
      ) AS expected(signature, source_hash)
      LEFT JOIN pg_catalog.pg_proc AS routine
        ON routine.oid = pg_catalog.to_regprocedure(expected.signature)
     WHERE routine.oid IS NULL
        OR pg_catalog.md5(routine.prosrc) <> expected.source_hash
        OR routine.proowner <> email_outbox_owner
        OR NOT routine.prosecdef
        OR routine.provolatile <> 'v'
        OR routine.proparallel <> 'u'
        OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'Email outbox correction predecessor definition drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime'
  ) OR EXISTS (
    SELECT 1
      FROM (
        VALUES
          ('public.grainline_email_outbox_enqueue_legacy(text,text,text,text,text,integer,text,text,text,text,text)'),
          ('public.grainline_email_outbox_account_deletion_fence(text,text[])'),
          ('public.grainline_email_outbox_fail(text,bigint,uuid,text,text)')
      ) AS expected(signature)
      JOIN pg_catalog.pg_proc AS routine
        ON routine.oid = pg_catalog.to_regprocedure(expected.signature)
     WHERE NOT pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           )
        OR EXISTS (
          SELECT 1
            FROM pg_catalog.aclexplode(
              COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
            ) AS acl
           WHERE acl.grantee = 0
             AND acl.privilege_type = 'EXECUTE'
        )
  ) THEN
    RAISE EXCEPTION 'Email outbox correction predecessor ACL drifted';
  END IF;
END
$preflight$;

-- Wait for active writers before replacing their definitions. CREATE OR
-- REPLACE retains each function's owner and ACL.
LOCK TABLE public."EmailOutbox" IN SHARE ROW EXCLUSIVE MODE;

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
       AND p_source_type NOT IN (
         'seller_broadcast',
         'followed_maker_new_listing',
         'order_payment',
         'order_fulfillment',
         'case'
       )
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
     OR pg_catalog.cardinality(p_email_keys) < 1
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_email_keys) AS supplied(value)
        WHERE supplied.value IS NULL
           OR supplied.value IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(supplied.value))
           OR pg_catalog.char_length(supplied.value) NOT BETWEEN 3 AND 254
           OR pg_catalog.strpos(supplied.value, '@') <= 1
     ) THEN
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
    retry_at := source_now + pg_catalog.make_interval(
      mins => LEAST(
        360,
        GREATEST(
          1,
          (2 ^ LEAST(9, GREATEST(0, locked_row.attempts - 1)))::integer
        )
      )
    );
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

DO $postflight$
DECLARE
  email_outbox_owner oid;
BEGIN
  SELECT class.relowner
    INTO STRICT email_outbox_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."EmailOutbox"'::pg_catalog.regclass
     AND class.relkind = 'r';

  IF EXISTS (
    SELECT 1
      FROM (
        VALUES
          (
            'public.grainline_email_outbox_enqueue_legacy(text,text,text,text,text,integer,text,text,text,text,text)',
            'f6ca99becfbc71f48f629ef008a012c6'
          ),
          (
            'public.grainline_email_outbox_account_deletion_fence(text,text[])',
            '2f40c6c4dacfca2f786dff06424d717e'
          ),
          (
            'public.grainline_email_outbox_fail(text,bigint,uuid,text,text)',
            'ab04f794d057ed823ffe1e47ffb9e25e'
          )
      ) AS expected(signature, source_hash)
      LEFT JOIN pg_catalog.pg_proc AS routine
        ON routine.oid = pg_catalog.to_regprocedure(expected.signature)
     WHERE routine.oid IS NULL
        OR pg_catalog.md5(routine.prosrc) <> expected.source_hash
        OR routine.proowner <> email_outbox_owner
        OR NOT routine.prosecdef
        OR routine.provolatile <> 'v'
        OR routine.proparallel <> 'u'
        OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
        OR NOT pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           )
        OR EXISTS (
          SELECT 1
            FROM pg_catalog.aclexplode(
              COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
            ) AS acl
           WHERE acl.grantee = 0
             AND acl.privilege_type = 'EXECUTE'
        )
  ) THEN
    RAISE EXCEPTION 'Email outbox correction postflight contract drifted';
  END IF;
END
$postflight$;

COMMIT;
