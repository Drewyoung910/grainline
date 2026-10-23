-- Compatible SupportRequest authority preparation.
--
-- This migration is additive: it adds purpose-bound functions and an
-- ephemeral email-delivery capability, but does not enable RLS or revoke any
-- existing table grants. Application callers migrate first; policyless
-- ENABLE/FORCE remains a separately reviewed release.

BEGIN;

ALTER TABLE public."SupportRequest"
  ADD COLUMN "emailDeliveryToken" uuid;

CREATE OR REPLACE FUNCTION public.grainline_support_request_submit(
  p_kind text,
  p_name text,
  p_email text,
  p_topic text,
  p_order_id text,
  p_listing_id text,
  p_message text
)
RETURNS TABLE (
  id text,
  "slaDueAt" timestamp without time zone,
  "emailDeliveryToken" uuid
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_support_request_submit$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  request_id text := pg_catalog.gen_random_uuid()::text;
  delivery_token uuid := pg_catalog.gen_random_uuid();
  storage_kind public."SupportRequestKind";
BEGIN
  IF actor_id IS NOT NULL THEN
    IF actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
       OR NOT EXISTS (SELECT 1 FROM public."User" AS actor WHERE actor.id = actor_id) THEN
      RAISE EXCEPTION 'Support request actor context is invalid'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_kind = 'support' THEN
    storage_kind := 'SUPPORT'::public."SupportRequestKind";
    IF p_topic NOT IN ('order', 'account', 'seller', 'payment', 'bug', 'other') THEN
      RAISE EXCEPTION 'Support request topic is invalid' USING ERRCODE = '22023';
    END IF;
  ELSIF p_kind = 'data_request' THEN
    storage_kind := 'DATA_REQUEST'::public."SupportRequestKind";
    IF p_topic NOT IN ('access', 'delete', 'correct', 'portability', 'opt_out', 'appeal', 'other') THEN
      RAISE EXCEPTION 'Data request topic is invalid' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'Support request kind is invalid' USING ERRCODE = '22023';
  END IF;

  IF p_email IS NULL
     OR p_email <> pg_catalog.lower(pg_catalog.btrim(p_email))
     OR pg_catalog.char_length(p_email) < 3
     OR pg_catalog.char_length(p_email) > 254
     OR p_email !~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$'
     OR p_email ~ '[[:cntrl:]]'
     OR (p_name IS NOT NULL AND pg_catalog.char_length(p_name) > 100)
     OR pg_catalog.char_length(p_topic) > 80
     OR (p_order_id IS NOT NULL AND pg_catalog.char_length(p_order_id) > 80)
     OR (p_listing_id IS NOT NULL AND pg_catalog.char_length(p_listing_id) > 80)
     OR p_message IS NULL
     OR pg_catalog.char_length(p_message) < 10
     OR pg_catalog.char_length(p_message) > 4000 THEN
    RAISE EXCEPTION 'Support request input is invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public."SupportRequest" (
    id, "userId", kind, status, name, email, topic, "orderId", "listingId",
    message, "slaDueAt", "emailLastError", "emailDeliveryToken",
    "createdAt", "updatedAt"
  ) VALUES (
    request_id, actor_id, storage_kind, 'OPEN'::public."SupportRequestStatus",
    p_name, p_email, p_topic, p_order_id, p_listing_id, p_message,
    source_now + INTERVAL '45 days',
    'Notification email delivery is pending confirmation; check Sentry or email provider logs if this remains after intake.',
    delivery_token, source_now, source_now
  );

  RETURN QUERY SELECT request_id, source_now + INTERVAL '45 days', delivery_token;
END
$grainline_support_request_submit$;

CREATE OR REPLACE FUNCTION public.grainline_support_request_delivery_record(
  p_request_id text,
  p_delivery_token uuid,
  p_sent boolean,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_support_request_delivery_record$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  changed_count integer;
BEGIN
  IF p_request_id IS NULL
     OR pg_catalog.char_length(p_request_id) > 191
     OR p_delivery_token IS NULL
     OR p_sent IS NULL
     OR (p_sent AND p_error IS NOT NULL)
     OR (NOT p_sent AND (p_error IS NULL OR pg_catalog.char_length(p_error) > 1000)) THEN
    RAISE EXCEPTION 'Support request delivery result is invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE public."SupportRequest"
     SET "emailSentAt" = CASE WHEN p_sent THEN source_now ELSE NULL END,
         "emailLastError" = CASE WHEN p_sent THEN NULL ELSE p_error END,
         "emailDeliveryToken" = NULL,
         "updatedAt" = source_now
   WHERE id = p_request_id
     AND "emailDeliveryToken" = p_delivery_token;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  RETURN changed_count = 1;
END
$grainline_support_request_delivery_record$;

CREATE OR REPLACE FUNCTION public.grainline_support_request_owner_export()
RETURNS TABLE (
  id text,
  kind text,
  status text,
  name text,
  email text,
  topic text,
  "orderId" text,
  "listingId" text,
  message text,
  "slaDueAt" timestamp without time zone,
  "emailSentAt" timestamp without time zone,
  "emailLastError" text,
  "closedAt" timestamp without time zone,
  "closureEvidence" text,
  "closureEvidenceAt" timestamp without time zone,
  "createdAt" timestamp without time zone,
  "updatedAt" timestamp without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_support_request_owner_export$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (SELECT 1 FROM public."User" AS actor WHERE actor.id = actor_id) THEN
    RAISE EXCEPTION 'Support request owner context is invalid' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT request.id,
         request.kind::text,
         request.status::text,
         request.name::text,
         request.email::text,
         request.topic::text,
         request."orderId"::text,
         request."listingId"::text,
         request.message::text,
         request."slaDueAt",
         request."emailSentAt",
         request."emailLastError"::text,
         request."closedAt",
         request."closureEvidence"::text,
         request."closureEvidenceAt",
         request."createdAt",
         request."updatedAt"
    FROM public."SupportRequest" AS request
   WHERE request."userId" = actor_id
      OR request.email IN (
        SELECT actor.email FROM public."User" AS actor WHERE actor.id = actor_id
        UNION
        SELECT address.email FROM public."UserEmailAddress" AS address WHERE address."userId" = actor_id
      )
   ORDER BY request."createdAt" DESC, request.id DESC;
END
$grainline_support_request_owner_export$;

CREATE OR REPLACE FUNCTION public.grainline_support_request_staff_state(
  p_page integer,
  p_page_size integer,
  p_recent_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_support_request_staff_state$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  active_count bigint;
  active_rows jsonb;
  recent_rows jsonb;
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS actor
        WHERE actor.id = actor_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
          AND actor.role IN ('EMPLOYEE'::public."Role", 'ADMIN'::public."Role")
     ) THEN
    RAISE EXCEPTION 'Support request staff context is invalid' USING ERRCODE = '42501';
  END IF;
  IF p_page IS NULL OR p_page < 1 OR p_page > 1000
     OR p_page_size IS NULL OR p_page_size < 0 OR p_page_size > 50
     OR p_recent_limit IS NULL OR p_recent_limit < 0 OR p_recent_limit > 20 THEN
    RAISE EXCEPTION 'Support request staff page input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(*)::bigint
    INTO active_count
    FROM public."SupportRequest" AS request
   WHERE request.status IN (
     'OPEN'::public."SupportRequestStatus",
     'IN_PROGRESS'::public."SupportRequestStatus"
   );

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(source_row)), '[]'::jsonb)
    INTO active_rows
    FROM (
      SELECT request.id,
             request.kind::text AS kind,
             request.status::text AS status,
             request.name::text AS name,
             request.email::text AS email,
             request.topic::text AS topic,
             request."orderId"::text AS "orderId",
             request."listingId"::text AS "listingId",
             request.message::text AS message,
             request."slaDueAt" AS "slaDueAt",
             request."emailSentAt" AS "emailSentAt",
             request."emailLastError"::text AS "emailLastError",
             request."closureEvidence"::text AS "closureEvidence",
             request."closureEvidenceAt" AS "closureEvidenceAt",
             request."closureEvidenceById"::text AS "closureEvidenceById",
             request."createdAt" AS "createdAt"
        FROM public."SupportRequest" AS request
       WHERE request.status IN (
         'OPEN'::public."SupportRequestStatus",
         'IN_PROGRESS'::public."SupportRequestStatus"
       )
       ORDER BY request."slaDueAt" ASC, request."createdAt" ASC, request.id ASC
       OFFSET ((p_page - 1) * p_page_size)
       LIMIT p_page_size
    ) AS source_row;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(source_row)), '[]'::jsonb)
    INTO recent_rows
    FROM (
      SELECT request.id,
             request.kind::text AS kind,
             request.status::text AS status,
             request.name::text AS name,
             request.email::text AS email,
             request.topic::text AS topic,
             request."orderId"::text AS "orderId",
             request."listingId"::text AS "listingId",
             request.message::text AS message,
             request."slaDueAt" AS "slaDueAt",
             request."emailSentAt" AS "emailSentAt",
             request."emailLastError"::text AS "emailLastError",
             request."closureEvidence"::text AS "closureEvidence",
             request."closureEvidenceAt" AS "closureEvidenceAt",
             request."closureEvidenceById"::text AS "closureEvidenceById",
             request."createdAt" AS "createdAt"
        FROM public."SupportRequest" AS request
       WHERE request.status = 'CLOSED'::public."SupportRequestStatus"
       ORDER BY request."closedAt" DESC, request.id DESC
       LIMIT p_recent_limit
    ) AS source_row;

  RETURN pg_catalog.jsonb_build_object(
    'activeCount', active_count,
    'active', active_rows,
    'recent', recent_rows
  );
END
$grainline_support_request_staff_state$;

CREATE OR REPLACE FUNCTION public.grainline_support_request_staff_transition(
  p_request_id text,
  p_status text,
  p_closure_evidence text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_support_request_staff_transition$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  source_request public."SupportRequest"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  next_closed_at timestamp(3) without time zone;
  audit_id text := pg_catalog.gen_random_uuid()::text;
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS actor
        WHERE actor.id = actor_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
          AND actor.role IN ('EMPLOYEE'::public."Role", 'ADMIN'::public."Role")
     ) THEN
    RAISE EXCEPTION 'Support request staff context is invalid' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.char_length(p_request_id) > 191
     OR p_status NOT IN ('OPEN', 'IN_PROGRESS', 'CLOSED') THEN
    RAISE EXCEPTION 'Support request transition input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT request.*
    INTO source_request
    FROM public."SupportRequest" AS request
   WHERE request.id = p_request_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;
  IF source_request.status = 'CLOSED'::public."SupportRequestStatus"
     AND p_status <> 'CLOSED' THEN
    RETURN 'closed_terminal';
  END IF;
  IF source_request.kind = 'DATA_REQUEST'::public."SupportRequestKind"
     AND source_request.status <> 'CLOSED'::public."SupportRequestStatus"
     AND p_status = 'CLOSED'
     AND (
       p_closure_evidence IS NULL
       OR pg_catalog.char_length(pg_catalog.btrim(p_closure_evidence)) < 40
       OR pg_catalog.char_length(p_closure_evidence) > 4000
     ) THEN
    RETURN 'missing_closure_evidence';
  END IF;

  next_closed_at := CASE
    WHEN p_status = 'CLOSED' THEN COALESCE(source_request."closedAt", source_now)
    ELSE NULL
  END;
  UPDATE public."SupportRequest"
     SET status = p_status::public."SupportRequestStatus",
         "closedAt" = next_closed_at,
         "closureEvidence" = CASE
           WHEN source_request.kind = 'DATA_REQUEST'::public."SupportRequestKind"
            AND source_request.status <> 'CLOSED'::public."SupportRequestStatus"
            AND p_status = 'CLOSED'
             THEN p_closure_evidence
           ELSE source_request."closureEvidence"
         END,
         "closureEvidenceAt" = CASE
           WHEN source_request.kind = 'DATA_REQUEST'::public."SupportRequestKind"
            AND source_request.status <> 'CLOSED'::public."SupportRequestStatus"
            AND p_status = 'CLOSED'
             THEN source_now
           ELSE source_request."closureEvidenceAt"
         END,
         "closureEvidenceById" = CASE
           WHEN source_request.kind = 'DATA_REQUEST'::public."SupportRequestKind"
            AND source_request.status <> 'CLOSED'::public."SupportRequestStatus"
            AND p_status = 'CLOSED'
             THEN actor_id
           ELSE source_request."closureEvidenceById"
         END,
         "updatedAt" = source_now
   WHERE id = source_request.id;

  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", metadata, undone, "createdAt"
  ) VALUES (
    audit_id,
    actor_id,
    'UPDATE_SUPPORT_REQUEST',
    'SUPPORT_REQUEST',
    source_request.id,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'previousStatus', source_request.status::text,
      'status', p_status,
      'previousClosedAt', source_request."closedAt",
      'closedAt', next_closed_at,
      'closureEvidenceRecorded', CASE
        WHEN source_request.kind = 'DATA_REQUEST'::public."SupportRequestKind"
         AND source_request.status <> 'CLOSED'::public."SupportRequestStatus"
         AND p_status = 'CLOSED' THEN true ELSE NULL END,
      'closureEvidenceLength', CASE
        WHEN source_request.kind = 'DATA_REQUEST'::public."SupportRequestKind"
         AND source_request.status <> 'CLOSED'::public."SupportRequestStatus"
         AND p_status = 'CLOSED' THEN pg_catalog.char_length(p_closure_evidence) ELSE NULL END,
      'closureEvidenceAt', CASE
        WHEN source_request.kind = 'DATA_REQUEST'::public."SupportRequestKind"
         AND source_request.status <> 'CLOSED'::public."SupportRequestStatus"
         AND p_status = 'CLOSED' THEN source_now ELSE NULL END
    )),
    false,
    source_now
  );
  RETURN 'updated';
END
$grainline_support_request_staff_transition$;

CREATE OR REPLACE FUNCTION public.grainline_support_request_account_deletion_redact_batch(
  p_sensitive_values text[],
  p_audit_sensitive_values text[]
)
RETURNS TABLE ("requestCount" bigint, "closureCount" bigint)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_support_request_account_deletion_redact_batch$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  request_count bigint;
  closure_count bigint;
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (SELECT 1 FROM public."User" AS actor WHERE actor.id = actor_id) THEN
    RAISE EXCEPTION 'Support request account-deletion context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_sensitive_values IS NULL OR p_audit_sensitive_values IS NULL
     OR pg_catalog.cardinality(p_sensitive_values) > 100
     OR pg_catalog.cardinality(p_audit_sensitive_values) > 100
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_sensitive_values) AS value WHERE value IS NULL OR pg_catalog.char_length(value) > 4000)
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_audit_sensitive_values) AS value WHERE value IS NULL OR pg_catalog.char_length(value) > 4000) THEN
    RAISE EXCEPTION 'Support request account-deletion redaction input is invalid'
      USING ERRCODE = '22023';
  END IF;

  WITH request_ids AS (
    SELECT request.id
      FROM public."SupportRequest" AS request
     WHERE request."userId" = actor_id
        OR request.email IN (
          SELECT actor.email FROM public."User" AS actor WHERE actor.id = actor_id
          UNION
          SELECT address.email FROM public."UserEmailAddress" AS address WHERE address."userId" = actor_id
        )
     ORDER BY request.id
     LIMIT 500
     FOR UPDATE
  ), changed AS (
    UPDATE public."SupportRequest" AS request
       SET "userId" = NULL,
           name = NULL,
           email = 'deleted-account@deleted.thegrainline.local',
           "orderId" = NULL,
           "listingId" = NULL,
           message = '[Support request removed after account deletion]',
           "emailLastError" = CASE WHEN request."emailLastError" IS NULL THEN NULL ELSE
             pg_catalog.left(public.grainline_account_deletion_redact_text_core(request."emailLastError", p_sensitive_values), 1000) END,
           "closureEvidence" = CASE WHEN request."closureEvidence" IS NULL THEN NULL ELSE
             pg_catalog.left(public.grainline_account_deletion_redact_text_core(request."closureEvidence", p_sensitive_values), 4000) END,
           "updatedAt" = (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
      FROM request_ids
     WHERE request.id = request_ids.id
    RETURNING request.id
  )
  SELECT pg_catalog.count(*)::bigint INTO request_count FROM changed;

  WITH request_ids AS (
    SELECT request.id
      FROM public."SupportRequest" AS request
     WHERE request."closureEvidenceById" = actor_id
     ORDER BY request.id
     LIMIT 500
     FOR UPDATE
  ), changed AS (
    UPDATE public."SupportRequest" AS request
       SET "closureEvidenceById" = NULL,
           "closureEvidence" = CASE WHEN request."closureEvidence" IS NULL THEN NULL ELSE
             pg_catalog.left(public.grainline_account_deletion_redact_text_core(request."closureEvidence", p_audit_sensitive_values), 4000) END,
           "updatedAt" = (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
      FROM request_ids
     WHERE request.id = request_ids.id
    RETURNING request.id
  )
  SELECT pg_catalog.count(*)::bigint INTO closure_count FROM changed;

  RETURN QUERY SELECT request_count, closure_count;
END
$grainline_support_request_account_deletion_redact_batch$;

CREATE OR REPLACE FUNCTION public.grainline_support_request_provider_deletion_upsert(
  p_message text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_support_request_provider_deletion_upsert$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  actor public."User"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  request_id text;
BEGIN
  IF actor_id IS NULL OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_message IS NULL OR pg_catalog.char_length(p_message) < 10
     OR pg_catalog.char_length(p_message) > 4000 THEN
    RAISE EXCEPTION 'Support request provider-deletion input is invalid'
      USING ERRCODE = '22023';
  END IF;
  SELECT source_actor.* INTO actor
    FROM public."User" AS source_actor
   WHERE source_actor.id = actor_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Support request provider-deletion actor is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT request.id INTO request_id
    FROM public."SupportRequest" AS request
   WHERE request."userId" = actor_id
     AND request.kind = 'DATA_REQUEST'::public."SupportRequestKind"
     AND request.status IN (
       'OPEN'::public."SupportRequestStatus",
       'IN_PROGRESS'::public."SupportRequestStatus"
     )
     AND request.topic = 'delete'
   ORDER BY request."createdAt" DESC, request.id DESC
   LIMIT 1
   FOR UPDATE;

  IF request_id IS NOT NULL THEN
    UPDATE public."SupportRequest"
       SET message = p_message,
           "slaDueAt" = source_now + INTERVAL '45 days',
           "updatedAt" = source_now
     WHERE id = request_id;
  ELSE
    request_id := pg_catalog.gen_random_uuid()::text;
    INSERT INTO public."SupportRequest" (
      id, "userId", kind, status, name, email, topic, message,
      "slaDueAt", "createdAt", "updatedAt"
    ) VALUES (
      request_id, actor_id, 'DATA_REQUEST'::public."SupportRequestKind",
      'OPEN'::public."SupportRequestStatus", actor.name, actor.email,
      'delete', p_message, source_now + INTERVAL '45 days', source_now, source_now
    );
  END IF;
  RETURN request_id;
END
$grainline_support_request_provider_deletion_upsert$;

CREATE OR REPLACE FUNCTION public.grainline_support_request_overdue_count()
RETURNS bigint
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_support_request_overdue_count$
  SELECT pg_catalog.count(*)::bigint
    FROM public."SupportRequest" AS request
   WHERE request.status IN (
     'OPEN'::public."SupportRequestStatus",
     'IN_PROGRESS'::public."SupportRequestStatus"
   )
     AND request."slaDueAt" < (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
$grainline_support_request_overdue_count$;

CREATE OR REPLACE FUNCTION public.grainline_support_request_retention_delete_batch(
  p_limit integer
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_support_request_retention_delete_batch$
DECLARE
  deleted_count bigint;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'Support request retention batch input is invalid'
      USING ERRCODE = '22023';
  END IF;
  WITH deletable AS (
    SELECT request.id
      FROM public."SupportRequest" AS request
     WHERE request.status = 'CLOSED'::public."SupportRequestStatus"
       AND request."closedAt" IS NOT NULL
       AND request."closedAt" < (
         (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '730 days'
       )
     ORDER BY request."closedAt" ASC, request.id ASC
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public."SupportRequest" AS request
     USING deletable
     WHERE request.id = deletable.id
    RETURNING request.id
  )
  SELECT pg_catalog.count(*)::bigint INTO deleted_count FROM deleted;
  RETURN deleted_count;
END
$grainline_support_request_retention_delete_batch$;

REVOKE ALL ON FUNCTION public.grainline_support_request_submit(text,text,text,text,text,text,text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_support_request_submit(text,text,text,text,text,text,text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_support_request_delivery_record(text,uuid,boolean,text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_support_request_delivery_record(text,uuid,boolean,text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_support_request_owner_export()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_support_request_owner_export()
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_support_request_staff_state(integer,integer,integer)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_support_request_staff_state(integer,integer,integer)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_support_request_staff_transition(text,text,text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_support_request_staff_transition(text,text,text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_support_request_account_deletion_redact_batch(text[],text[])
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_support_request_account_deletion_redact_batch(text[],text[])
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_support_request_provider_deletion_upsert(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_support_request_provider_deletion_upsert(text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_support_request_overdue_count()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_support_request_overdue_count()
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_support_request_retention_delete_batch(integer)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_support_request_retention_delete_batch(integer)
  TO grainline_app_runtime;

COMMIT;
