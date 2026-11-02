-- Activate the reviewed email-service least-privilege boundary. The compatible
-- app and fixed-purpose functions must already be live. This migration changes
-- grants only: it does not rewrite rows, remove schema, or enable RLS.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.email-service.least-privilege.activation', 0)
);

LOCK TABLE
  public."NewsletterSubscriber",
  public."EmailSuppression",
  public."ResendWebhookEvent",
  public."EmailOutbox",
  public."EmailFailureCount"
IN ACCESS EXCLUSIVE MODE;

DO $grainline_email_service_activation_preflight$
DECLARE
  table_name text;
  table_oid oid;
  table_owner oid;
  runtime_oid oid;
  staff_oid oid;
  expected_signature text;
  expected_signatures constant text[] := ARRAY[
    'public.grainline_email_account_deletion_suppression_clear(text)',
    'public.grainline_email_hard_suppression_apply(text,text,"EmailSuppressionReason",text,text,jsonb)',
    'public.grainline_email_one_click_suppression_clear(text)',
    'public.grainline_email_outbox_account_deletion_fence(text,text[])',
    'public.grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)',
    'public.grainline_email_outbox_cancel_seller_broadcast(text)',
    'public.grainline_email_outbox_claim_batch(integer)',
    'public.grainline_email_outbox_claim_one(text)',
    'public.grainline_email_outbox_complete(text,bigint,uuid,text)',
    'public.grainline_email_outbox_defer(text,bigint,uuid,text)',
    'public.grainline_email_outbox_enqueue_legacy(text,text,text,text,text,integer,text,text,text,text,text)',
    'public.grainline_email_outbox_fail(text,bigint,uuid,text,text)',
    'public.grainline_email_outbox_redact_deleted_seller(text)',
    'public.grainline_email_outbox_retention_delete_batch(timestamp without time zone,timestamp without time zone,integer)',
    'public.grainline_email_outbox_skip(text,bigint,uuid,text)',
    'public.grainline_email_service_account_deletion_apply()',
    'public.grainline_email_service_ops_health(timestamp without time zone,timestamp without time zone)',
    'public.grainline_email_service_owner_export()',
    'public.grainline_email_suppression_exists(text,text)',
    'public.grainline_email_unsubscribe_apply(text,jsonb)',
    'public.grainline_newsletter_confirm(text,timestamp without time zone)',
    'public.grainline_newsletter_confirmation_valid(text,timestamp without time zone)',
    'public.grainline_newsletter_expired_unconfirmed_delete_batch(timestamp without time zone,integer)',
    'public.grainline_newsletter_signup_release(text,text)',
    'public.grainline_newsletter_signup_reserve(text,text,text,timestamp without time zone,timestamp without time zone,timestamp without time zone)',
    'public.grainline_newsletter_token_superseded(text,timestamp without time zone)',
    'public.grainline_resend_webhook_event_complete(text,bigint,uuid,timestamp without time zone)',
    'public.grainline_resend_webhook_event_fail(text,bigint,uuid,text,timestamp without time zone)',
    'public.grainline_resend_webhook_event_reserve(text,text,timestamp without time zone,timestamp without time zone,uuid)',
    'public.grainline_resend_webhook_event_retention_delete_batch(timestamp without time zone,integer)'
  ]::text[];
  role_state record;
BEGIN
  SELECT role.oid INTO runtime_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';
  SELECT role.oid INTO staff_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_staff_read_runtime';

  IF runtime_oid IS NULL OR staff_oid IS NULL OR current_user <> session_user THEN
    RAISE EXCEPTION 'Email service activation role boundary is incomplete';
  END IF;

  FOR role_state IN
    SELECT role.rolname,
           role.rolsuper,
           role.rolinherit,
           role.rolcanlogin,
           role.rolcreatedb,
           role.rolcreaterole,
           role.rolreplication,
           role.rolbypassrls
      FROM pg_catalog.pg_roles AS role
     WHERE role.oid IN (runtime_oid, staff_oid)
  LOOP
    IF role_state.rolsuper
       OR role_state.rolinherit
       OR NOT role_state.rolcanlogin
       OR role_state.rolcreatedb
       OR role_state.rolcreaterole
       OR role_state.rolreplication
       OR role_state.rolbypassrls THEN
      RAISE EXCEPTION 'Email service role posture is unsafe: %', role_state.rolname;
    END IF;
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'NewsletterSubscriber',
    'EmailSuppression',
    'ResendWebhookEvent',
    'EmailOutbox',
    'EmailFailureCount'
  ]::text[] LOOP
    SELECT class.oid, class.relowner
      INTO table_oid, table_owner
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = table_name
       AND class.relkind = 'r';

    IF table_oid IS NULL
       OR table_owner IS DISTINCT FROM (
         SELECT role.oid
           FROM pg_catalog.pg_roles AS role
          WHERE role.rolname = current_user
       )
       OR NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_roles AS role
          WHERE role.oid = table_owner
            AND (role.rolsuper OR role.rolbypassrls)
       ) THEN
      RAISE EXCEPTION 'Email service activation requires the owner of %', table_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_class AS class
       WHERE class.oid = table_oid
         AND NOT class.relrowsecurity
         AND NOT class.relforcerowsecurity
    ) OR EXISTS (
      SELECT 1
        FROM pg_catalog.pg_policy AS policy
       WHERE policy.polrelid = table_oid
    ) THEN
      RAISE EXCEPTION 'Email service table % RLS posture drifted', table_name;
    END IF;

    IF NOT pg_catalog.has_table_privilege(runtime_oid, table_oid, 'SELECT')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, table_oid, 'INSERT')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, table_oid, 'UPDATE')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, table_oid, 'DELETE')
       OR pg_catalog.has_table_privilege(runtime_oid, table_oid, 'TRUNCATE')
       OR pg_catalog.has_table_privilege(runtime_oid, table_oid, 'REFERENCES')
       OR pg_catalog.has_table_privilege(runtime_oid, table_oid, 'TRIGGER') THEN
      RAISE EXCEPTION 'Email service predecessor grants drifted for %', table_name;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM (VALUES
          ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
          ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
        ) AS privilege(name)
       WHERE pg_catalog.has_table_privilege(staff_oid, table_oid, privilege.name)
    ) OR EXISTS (
      SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(
            (SELECT class.relacl
               FROM pg_catalog.pg_class AS class
              WHERE class.oid = table_oid),
            pg_catalog.acldefault('r', table_owner)
          )
        ) AS acl
       WHERE acl.grantee = 0
         AND acl.privilege_type IN (
           'SELECT', 'INSERT', 'UPDATE', 'DELETE',
           'TRUNCATE', 'REFERENCES', 'TRIGGER'
         )
    ) OR EXISTS (
      SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
        CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
       WHERE attribute.attrelid = table_oid
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND acl.grantee IN (runtime_oid, staff_oid, 0::oid)
    ) THEN
      RAISE EXCEPTION 'Email service staff, PUBLIC, or column grants drifted for %', table_name;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public."EmailFailureCount") THEN
    RAISE EXCEPTION 'EmailFailureCount must be empty before activation';
  END IF;

  FOREACH expected_signature IN ARRAY expected_signatures LOOP
    IF pg_catalog.to_regprocedure(expected_signature) IS NULL
       OR NOT pg_catalog.has_function_privilege(
         runtime_oid, expected_signature, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Email service function % is incomplete', expected_signature;
    END IF;
  END LOOP;

  IF (
    SELECT pg_catalog.array_agg(actual.signature ORDER BY actual.signature)
      FROM (
        SELECT pg_catalog.format(
                 '%I.%I(%s)',
                 namespace.nspname,
                 routine.proname,
                 pg_catalog.replace(
                   pg_catalog.oidvectortypes(routine.proargtypes),
                   ', ',
                   ','
                 )
               ) AS signature
          FROM pg_catalog.pg_proc AS routine
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = routine.pronamespace
         WHERE namespace.nspname = 'public'
           AND (
             routine.proname LIKE 'grainline\_email\_%' ESCAPE '\'
             OR routine.proname LIKE 'grainline\_newsletter\_%' ESCAPE '\'
             OR routine.proname LIKE 'grainline\_resend\_%' ESCAPE '\'
           )
           AND pg_catalog.has_function_privilege(runtime_oid, routine.oid, 'EXECUTE')
      ) AS actual
  ) IS DISTINCT FROM (
    SELECT pg_catalog.array_agg(expected.signature ORDER BY expected.signature)
      FROM pg_catalog.unnest(expected_signatures) AS expected(signature)
  ) THEN
    RAISE EXCEPTION 'Email service runtime function catalog drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.unnest(expected_signatures) AS expected(signature)
      JOIN pg_catalog.pg_proc AS routine
        ON routine.oid = pg_catalog.to_regprocedure(expected.signature)
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = routine.proowner
     WHERE (
         NOT routine.prosecdef
         OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
         OR NOT (owner_role.rolsuper OR owner_role.rolbypassrls)
         OR EXISTS (
           SELECT 1
             FROM pg_catalog.aclexplode(
               COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
             ) AS acl
            WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
         )
       )
  ) THEN
    RAISE EXCEPTION 'Email service function security drifted';
  END IF;
END
$grainline_email_service_activation_preflight$;

REVOKE ALL PRIVILEGES ON TABLE
  public."NewsletterSubscriber",
  public."EmailSuppression",
  public."ResendWebhookEvent",
  public."EmailOutbox",
  public."EmailFailureCount"
FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

DO $grainline_email_service_column_revoke$
DECLARE
  table_name text;
  table_oid oid;
  column_list text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'NewsletterSubscriber',
    'EmailSuppression',
    'ResendWebhookEvent',
    'EmailOutbox',
    'EmailFailureCount'
  ]::text[] LOOP
    table_oid := pg_catalog.to_regclass(pg_catalog.format('public.%I', table_name));
    SELECT pg_catalog.string_agg(pg_catalog.format('%I', attribute.attname), ', ')
      INTO column_list
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped;
    EXECUTE pg_catalog.format(
      'REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON TABLE public.%2$I FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime',
      column_list,
      table_name
    );
  END LOOP;
END
$grainline_email_service_column_revoke$;

DO $grainline_email_service_activation_postflight$
DECLARE
  table_name text;
  table_oid oid;
  table_owner oid;
  runtime_oid oid := (
    SELECT role.oid FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = 'grainline_app_runtime'
  );
  staff_oid oid := (
    SELECT role.oid FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = 'grainline_staff_read_runtime'
  );
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'NewsletterSubscriber',
    'EmailSuppression',
    'ResendWebhookEvent',
    'EmailOutbox',
    'EmailFailureCount'
  ]::text[] LOOP
    table_oid := pg_catalog.to_regclass(pg_catalog.format('public.%I', table_name));
    SELECT class.relowner INTO table_owner
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = table_oid;

    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_class AS class
       WHERE class.oid = table_oid
         AND NOT class.relrowsecurity
         AND NOT class.relforcerowsecurity
    ) OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy AS policy
       WHERE policy.polrelid = table_oid
    ) OR EXISTS (
      SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(
            (SELECT class.relacl FROM pg_catalog.pg_class AS class
              WHERE class.oid = table_oid),
            pg_catalog.acldefault('r', table_owner)
          )
        ) AS acl
       WHERE acl.grantee IN (runtime_oid, staff_oid, 0::oid)
    ) OR EXISTS (
      SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
        CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
       WHERE attribute.attrelid = table_oid
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND acl.grantee IN (runtime_oid, staff_oid, 0::oid)
    ) THEN
      RAISE EXCEPTION 'Email service zero-direct activation failed for %', table_name;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public."EmailFailureCount") THEN
    RAISE EXCEPTION 'EmailFailureCount changed during activation';
  END IF;
END
$grainline_email_service_activation_postflight$;

COMMIT;
