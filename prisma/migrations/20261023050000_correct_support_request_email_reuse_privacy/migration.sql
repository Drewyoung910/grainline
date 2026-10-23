-- Keep stable SupportRequest ownership ahead of historical-email fallback, and
-- exclude fallback addresses now claimed by another active account.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.support-request.email-reuse-privacy.c1150', 0)
);

LOCK TABLE public."SupportRequest", public."User", public."UserEmailAddress"
  IN SHARE ROW EXCLUSIVE MODE;

DO $grainline_support_request_email_reuse_preflight$
DECLARE
  table_owner oid;
  migration_role record;
  restricted_role_count integer;
  accepted_predecessor_count integer;
  accepted_corrected_count integer;
  fallback_function_count integer;
BEGIN
  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."SupportRequest"'::pg_catalog.regclass
     AND class.relkind = 'r';

  IF table_owner IS DISTINCT FROM (
    SELECT role.oid
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  ) OR current_user <> session_user THEN
    RAISE EXCEPTION 'Support request email-reuse correction requires a direct table-owner session';
  END IF;

  SELECT role.rolsuper, role.rolbypassrls
    INTO migration_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND OR NOT (migration_role.rolsuper OR migration_role.rolbypassrls) THEN
    RAISE EXCEPTION 'Support request owner must bypass RLS';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO restricted_role_count
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname IN (
     'grainline_app_runtime',
     'grainline_staff_read_runtime'
   )
     AND NOT role.rolsuper
     AND NOT role.rolinherit
     AND role.rolcanlogin
     AND NOT role.rolcreatedb
     AND NOT role.rolcreaterole
     AND NOT role.rolreplication
     AND NOT role.rolbypassrls;
  IF restricted_role_count <> 2 THEN
    RAISE EXCEPTION 'Support request restricted-role posture drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."SupportRequest"'::pg_catalog.regclass
       AND class.relrowsecurity
       AND NOT class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."SupportRequest"'::pg_catalog.regclass
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) AS acl
     WHERE class.oid = 'public."SupportRequest"'::pg_catalog.regclass
       AND acl.grantee <> class.relowner
       AND acl.privilege_type IN (
         'SELECT', 'INSERT', 'UPDATE', 'DELETE',
         'TRUNCATE', 'REFERENCES', 'TRIGGER'
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid = 'public."SupportRequest"'::pg_catalog.regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND acl.grantee <> table_owner
       AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
  ) THEN
    RAISE EXCEPTION 'Support request policyless ENABLE posture drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO fallback_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
   WHERE namespace.nspname = 'public'
     AND procedure.proname = 'grainline_user_email_fallback_addresses'
     AND pg_catalog.oidvectortypes(procedure.proargtypes)::text = ''
     AND procedure.proowner = table_owner
     AND (owner.rolsuper OR owner.rolbypassrls)
     AND procedure.prosecdef
     AND procedure.provolatile = 's'
     AND procedure.proparallel = 'u'
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(procedure.prosrc) = 'd72916d00bab1c26e1bc689f3d15722c'
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE');
  IF fallback_function_count <> 1 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname = 'grainline_user_email_fallback_addresses'
  ) <> 1 THEN
    RAISE EXCEPTION 'User email fallback authority drifted';
  END IF;

  WITH expected(name, arguments, volatility, source_md5) AS (
    VALUES
      ('grainline_support_request_owner_export', '', 's', '17358846ac44086be6591a74a402328c'),
      ('grainline_support_request_account_deletion_redact_batch', 'text[], text[]', 'v', 'c8ba331b2b2acaef8074b1b379c07dc1')
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_predecessor_count
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.proname = expected.name
     AND pg_catalog.oidvectortypes(procedure.proargtypes)::text = expected.arguments
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
   WHERE namespace.nspname = 'public'
     AND procedure.proowner = table_owner
     AND (owner.rolsuper OR owner.rolbypassrls)
     AND procedure.prosecdef
     AND procedure.provolatile::text = expected.volatility
     AND procedure.proparallel = 'u'
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(procedure.prosrc) = expected.source_md5
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE');

  WITH expected(name, arguments, volatility, source_md5) AS (
    VALUES
      ('grainline_support_request_owner_export', '', 's', '0181f0e21eea256d9adcb3d426354dec'),
      ('grainline_support_request_account_deletion_redact_batch', 'text[], text[]', 'v', '60b1f3e40e9e396231d3786bb0a79900')
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_corrected_count
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.proname = expected.name
     AND pg_catalog.oidvectortypes(procedure.proargtypes)::text = expected.arguments
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
   WHERE namespace.nspname = 'public'
     AND procedure.proowner = table_owner
     AND (owner.rolsuper OR owner.rolbypassrls)
     AND procedure.prosecdef
     AND procedure.provolatile::text = expected.volatility
     AND procedure.proparallel = 'u'
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(procedure.prosrc) = expected.source_md5
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE');

  IF (accepted_predecessor_count <> 2 AND accepted_corrected_count <> 2) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname IN (
         'grainline_support_request_owner_export',
         'grainline_support_request_account_deletion_redact_batch'
       )
  ) <> 2 THEN
    RAISE EXCEPTION 'Support request owner/deletion authority drifted';
  END IF;
END
$grainline_support_request_email_reuse_preflight$;

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
      OR (
        request."userId" IS NULL
        AND request.email IN (
          SELECT fallback.email
            FROM public.grainline_user_email_fallback_addresses() AS fallback
        )
      )
   ORDER BY request."createdAt" DESC, request.id DESC;
END
$grainline_support_request_owner_export$;

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
        OR (
          request."userId" IS NULL
          AND request.email IN (
            SELECT fallback.email
              FROM public.grainline_user_email_fallback_addresses() AS fallback
          )
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

REVOKE ALL ON FUNCTION public.grainline_support_request_owner_export()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_support_request_owner_export()
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_support_request_account_deletion_redact_batch(text[], text[])
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_support_request_account_deletion_redact_batch(text[], text[])
  TO grainline_app_runtime;

DO $grainline_support_request_email_reuse_postflight$
DECLARE
  table_owner oid;
  accepted_function_count integer;
BEGIN
  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."SupportRequest"'::pg_catalog.regclass
     AND class.relkind = 'r';

  WITH expected(name, arguments, volatility, source_md5) AS (
    VALUES
      ('grainline_support_request_owner_export', '', 's', '0181f0e21eea256d9adcb3d426354dec'),
      ('grainline_support_request_account_deletion_redact_batch', 'text[], text[]', 'v', '60b1f3e40e9e396231d3786bb0a79900')
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_function_count
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.proname = expected.name
     AND pg_catalog.oidvectortypes(procedure.proargtypes)::text = expected.arguments
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
   WHERE namespace.nspname = 'public'
     AND procedure.proowner = table_owner
     AND (owner.rolsuper OR owner.rolbypassrls)
     AND procedure.prosecdef
     AND procedure.provolatile::text = expected.volatility
     AND procedure.proparallel = 'u'
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(procedure.prosrc) = expected.source_md5
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE');
  IF accepted_function_count <> 2 THEN
    RAISE EXCEPTION 'Support request email-reuse correction did not establish exact authority';
  END IF;
END
$grainline_support_request_email_reuse_postflight$;

COMMIT;
