-- Policyless ClerkWebhookEvent ENABLE activation after the compatible
-- generation-bound lease and maintenance application has deployed, live proof
-- is accepted, and the predecessor delivery queue is drained.
-- FORCE RLS remains off for a later posture-only hardening release.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.clerk-webhook-event.rls.activation', 0)
);

LOCK TABLE public."ClerkWebhookEvent" IN ACCESS EXCLUSIVE MODE;

DO $grainline_clerk_webhook_event_activation_preflight$
DECLARE
  table_owner oid;
  table_rls boolean;
  table_force boolean;
  migration_role record;
  runtime_role record;
  policy_count integer;
  direct_column_acl_count integer;
  validated_constraint_count integer;
  required_index_count integer;
  invalid_row_count bigint;
  function_count integer;
  named_runtime_function_count integer;
  table_function_count integer;
BEGIN
  SELECT class.relowner, class.relrowsecurity, class.relforcerowsecurity
    INTO STRICT table_owner, table_rls, table_force
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'ClerkWebhookEvent'
     AND class.relkind = 'r';

  IF table_owner IS DISTINCT FROM (
    SELECT role.oid FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  ) THEN
    RAISE EXCEPTION
      'ClerkWebhookEvent activation requires the table owner session';
  END IF;

  SELECT role.rolsuper, role.rolbypassrls
    INTO migration_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND OR NOT (migration_role.rolsuper OR migration_role.rolbypassrls) THEN
    RAISE EXCEPTION
      'ClerkWebhookEvent function owner must bypass later FORCE RLS';
  END IF;

  SELECT
    role.rolsuper,
    role.rolinherit,
    role.rolcanlogin,
    role.rolcreatedb,
    role.rolcreaterole,
    role.rolreplication,
    role.rolbypassrls
    INTO runtime_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';
  IF NOT FOUND
     OR runtime_role.rolsuper
     OR runtime_role.rolinherit
     OR NOT runtime_role.rolcanlogin
     OR runtime_role.rolcreatedb
     OR runtime_role.rolcreaterole
     OR runtime_role.rolreplication
     OR runtime_role.rolbypassrls THEN
    RAISE EXCEPTION
      'grainline_app_runtime role posture is not ClerkWebhookEvent-safe';
  END IF;

  -- Neon may retain only this non-effective administrative bootstrap edge.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
      JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = membership.grantor
     WHERE (
       member.rolname = 'grainline_app_runtime'
       OR granted_role.rolname = 'grainline_app_runtime'
     )
       AND NOT (
         granted_role.rolname = 'grainline_app_runtime'
         AND member.rolname = 'neondb_owner'
         AND grantor.rolname = 'cloud_admin'
         AND membership.admin_option
         AND NOT membership.inherit_option
         AND NOT membership.set_option
       )
  ) OR EXISTS (
    WITH RECURSIVE restricted_members AS (
      SELECT child.oid, child.rolname
        FROM pg_catalog.pg_auth_members AS membership
        JOIN pg_catalog.pg_roles AS parent ON parent.oid = membership.roleid
        JOIN pg_catalog.pg_roles AS child ON child.oid = membership.member
       WHERE parent.rolname = 'grainline_app_runtime'
      UNION
      SELECT child.oid, child.rolname
        FROM restricted_members AS parent
        JOIN pg_catalog.pg_auth_members AS membership
          ON membership.roleid = parent.oid
        JOIN pg_catalog.pg_roles AS child ON child.oid = membership.member
    )
    SELECT 1 FROM restricted_members WHERE rolname <> 'neondb_owner'
  ) THEN
    RAISE EXCEPTION
      'ClerkWebhookEvent runtime role retains unreviewed role membership';
  END IF;

  IF table_rls OR table_force THEN
    RAISE EXCEPTION
      'ClerkWebhookEvent activation requires the clean compatible predecessor';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
   WHERE policy.polrelid = 'public."ClerkWebhookEvent"'::pg_catalog.regclass;
  IF policy_count <> 0 THEN
    RAISE EXCEPTION
      'ClerkWebhookEvent service-only activation requires zero policies';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."ClerkWebhookEvent"', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."ClerkWebhookEvent"', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."ClerkWebhookEvent"', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."ClerkWebhookEvent"', 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."ClerkWebhookEvent"',
       'TRUNCATE,REFERENCES,TRIGGER'
     ) THEN
    RAISE EXCEPTION
      'ClerkWebhookEvent predecessor runtime table grants drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) AS acl
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'ClerkWebhookEvent'
       AND acl.grantee = 0
       AND acl.privilege_type IN (
         'SELECT', 'INSERT', 'UPDATE', 'DELETE',
         'TRUNCATE', 'REFERENCES', 'TRIGGER'
       )
  ) THEN
    RAISE EXCEPTION
      'ClerkWebhookEvent predecessor retains PUBLIC table authority';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO direct_column_acl_count
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
   WHERE attribute.attrelid =
         'public."ClerkWebhookEvent"'::pg_catalog.regclass
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND acl.grantee IN (
       0,
       (SELECT role.oid FROM pg_catalog.pg_roles AS role
         WHERE role.rolname = 'grainline_app_runtime')
     )
     AND acl.privilege_type IN (
       'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
     );
  IF direct_column_acl_count <> 0 THEN
    RAISE EXCEPTION
      'ClerkWebhookEvent predecessor column ACLs drifted: %',
      direct_column_acl_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO validated_constraint_count
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid =
         'public."ClerkWebhookEvent"'::pg_catalog.regclass
     AND constraint_row.conname =
         'ClerkWebhookEvent_claimGeneration_check'
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated;
  IF validated_constraint_count <> 1 OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
           'public."ClerkWebhookEvent"'::pg_catalog.regclass
       AND attribute.attname = 'claimGeneration'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND attribute.attnotnull
       AND attribute.atthasdef
  ) THEN
    RAISE EXCEPTION
      'ClerkWebhookEvent claim-generation invariant drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO required_index_count
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = index_row.indexrelid
   WHERE index_row.indrelid =
         'public."ClerkWebhookEvent"'::pg_catalog.regclass
     AND index_class.relname IN (
       'ClerkWebhookEvent_pkey',
       'ClerkWebhookEvent_type_createdAt_idx',
       'ClerkWebhookEvent_processedAt_idx'
     )
     AND index_row.indisvalid
     AND index_row.indisready;
  IF required_index_count <> 3 THEN
    RAISE EXCEPTION
      'ClerkWebhookEvent required index catalog drifted: %',
      required_index_count;
  END IF;

  SELECT pg_catalog.count(*)
    INTO invalid_row_count
    FROM public."ClerkWebhookEvent" AS event
   WHERE pg_catalog.btrim(event."svixId") = ''
      OR pg_catalog.btrim(event.type) = ''
      OR event."claimGeneration" < 0
      OR (
        event."processedAt" IS NOT NULL
        AND event."processingStartedAt" IS NULL
      )
      OR (
        event."processedAt" IS NOT NULL
        AND event."processedAt" < event."processingStartedAt"
      )
      OR (
        event."processedAt" IS NOT NULL
        AND event."lastError" IS NOT NULL
      );
  IF invalid_row_count <> 0 THEN
    RAISE EXCEPTION
      'ClerkWebhookEvent activation found invalid rows: %',
      invalid_row_count;
  END IF;

  WITH expected(proname, identity_arguments, source_md5) AS (
    VALUES
      ('grainline_clerk_webhook_begin', 'text, text',
       '7a0c51172ff78879207a9052a4319132'),
      ('grainline_clerk_webhook_complete', 'text, bigint',
       '1f06d03edb937256ef8fab48f63acf9d'),
      ('grainline_clerk_webhook_fail', 'text, bigint, text',
       '21472983636832a7ff75d3e84b1bbf84'),
      ('grainline_clerk_webhook_prune_batch', 'integer',
       '1366d9cfa63ea4f61988085979995ff3'),
      ('grainline_clerk_webhook_health_summary', '',
       'e204c8120a8c26a421de3287e8b1e92b')
  )
  SELECT pg_catalog.count(*)::integer
    INTO function_count
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.proname = expected.proname
     AND pg_catalog.oidvectortypes(procedure.proargtypes) =
         expected.identity_arguments
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.prokind = 'f'
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND procedure.proconfig IS NOT DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
     AND procedure.proowner = table_owner
     AND pg_catalog.md5(procedure.prosrc) = expected.source_md5
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.privilege_type = 'EXECUTE'
          AND (
            acl.grantee NOT IN (
              procedure.proowner,
              (SELECT role.oid FROM pg_catalog.pg_roles AS role
                WHERE role.rolname = 'grainline_app_runtime')
            )
            OR (
              acl.grantee = (
                SELECT role.oid FROM pg_catalog.pg_roles AS role
                 WHERE role.rolname = 'grainline_app_runtime'
              )
              AND (
                acl.grantor <> procedure.proowner
                OR acl.is_grantable
              )
            )
          )
     )
     AND pg_catalog.strpos(
       pg_catalog.upper(procedure.prosrc), 'EXECUTE'
     ) = 0
     AND pg_catalog.strpos(
       pg_catalog.upper(procedure.prosrc), 'FORMAT('
     ) = 0;
  IF function_count <> 5 THEN
    RAISE EXCEPTION
      'ClerkWebhookEvent fixed-function catalog drifted: %',
      function_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO named_runtime_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname IN (
       'grainline_clerk_webhook_begin',
       'grainline_clerk_webhook_complete',
       'grainline_clerk_webhook_fail',
       'grainline_clerk_webhook_prune_batch',
       'grainline_clerk_webhook_health_summary'
     )
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     );
  IF named_runtime_function_count <> 5 THEN
    RAISE EXCEPTION
      'ClerkWebhookEvent trusted-name overload surface drifted: %',
      named_runtime_function_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO table_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND pg_catalog.strpos(procedure.prosrc, '"ClerkWebhookEvent"') > 0;
  IF table_function_count <> 5 THEN
    RAISE EXCEPTION
      'ClerkWebhookEvent runtime-executable function surface drifted: %',
      table_function_count;
  END IF;
END
$grainline_clerk_webhook_event_activation_preflight$;

ALTER TABLE public."ClerkWebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ClerkWebhookEvent" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."ClerkWebhookEvent"
  FROM PUBLIC, grainline_app_runtime;

DO $grainline_clerk_webhook_event_activation_postflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'ClerkWebhookEvent'
     AND class.relkind = 'r'
     AND class.relrowsecurity
     AND NOT class.relforcerowsecurity
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'DELETE',
            'TRUNCATE', 'REFERENCES', 'TRIGGER'
          )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = class.oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND acl.grantee IN (
            0,
            (SELECT role.oid FROM pg_catalog.pg_roles AS role
              WHERE role.rolname = 'grainline_app_runtime')
          )
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
          )
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION
      'ClerkWebhookEvent activation did not establish exact policyless posture';
  END IF;
END
$grainline_clerk_webhook_event_activation_postflight$;

COMMIT;
