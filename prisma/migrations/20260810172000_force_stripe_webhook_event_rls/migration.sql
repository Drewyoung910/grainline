-- Reviewed posture-only StripeWebhookEvent FORCE hardening.
-- Apply only through the guarded main-only production migration workflow.
--
-- Separate posture-only FORCE hardening after the accepted policyless
-- StripeWebhookEvent Phase-A activation. This changes no row, policy, grant,
-- function, constraint, index or application/provider state.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.stripe-webhook-event.rls.activation', 0)
);

LOCK TABLE public."StripeWebhookEvent" IN ACCESS EXCLUSIVE MODE;

DO $grainline_stripe_webhook_event_force_preflight$
DECLARE
  table_owner oid;
  runtime_role record;
  runtime_role_oid oid;
  owner_role record;
  owner_session_count integer;
  accepted_table_count integer;
  accepted_function_count integer;
  named_runtime_function_count integer;
  table_function_count integer;
BEGIN
  SELECT
    role.oid,
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
      'grainline_app_runtime role posture is not StripeWebhookEvent FORCE-safe';
  END IF;
  runtime_role_oid := runtime_role.oid;

  -- Neon may retain only this non-effective administrative bootstrap edge:
  -- neondb_owner is a member of the restricted runtime role, granted by
  -- cloud_admin with ADMIN but without INHERIT or SET. The runtime role never
  -- becomes a member of the owner or another privileged role.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member
        ON member.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = membership.roleid
      JOIN pg_catalog.pg_roles AS grantor
        ON grantor.oid = membership.grantor
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
        JOIN pg_catalog.pg_roles AS parent
          ON parent.oid = membership.roleid
        JOIN pg_catalog.pg_roles AS child
          ON child.oid = membership.member
       WHERE parent.rolname = 'grainline_app_runtime'
      UNION
      SELECT child.oid, child.rolname
        FROM restricted_members AS parent
        JOIN pg_catalog.pg_auth_members AS membership
          ON membership.roleid = parent.oid
        JOIN pg_catalog.pg_roles AS child
          ON child.oid = membership.member
    )
    SELECT 1
      FROM restricted_members
     WHERE rolname <> 'neondb_owner'
  ) THEN
    RAISE EXCEPTION
      'StripeWebhookEvent runtime role retains unreviewed role membership';
  END IF;

  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'StripeWebhookEvent'
     AND class.relkind = 'r';

  SELECT
    role.oid,
    role.rolsuper,
    role.rolcanlogin,
    role.rolbypassrls
    INTO owner_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND
     OR NOT owner_role.rolcanlogin
     OR owner_role.oid IS DISTINCT FROM table_owner
     OR owner_role.oid = runtime_role_oid THEN
    RAISE EXCEPTION
      'StripeWebhookEvent FORCE migration owner identity drifted';
  END IF;

  IF current_user = 'neondb_owner' THEN
    IF owner_role.rolsuper OR NOT owner_role.rolbypassrls THEN
      RAISE EXCEPTION
        'neondb_owner role posture is not StripeWebhookEvent FORCE-safe';
    END IF;
  ELSIF current_user = 'ci'
        AND pg_catalog.current_database() = 'grainline_ci' THEN
    IF NOT owner_role.rolsuper THEN
      RAISE EXCEPTION
        'disposable CI migration owner posture drifted';
    END IF;
  ELSE
    RAISE EXCEPTION
      'StripeWebhookEvent FORCE must run as a reviewed migration owner';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO owner_session_count
    FROM pg_catalog.pg_stat_activity AS activity
   WHERE activity.datname = pg_catalog.current_database()
     AND activity.usename = current_user
     AND activity.backend_type = 'client backend'
     AND activity.pid <> pg_catalog.pg_backend_pid();
  IF owner_session_count <> 0 THEN
    RAISE EXCEPTION
      'StripeWebhookEvent owner-session drain is incomplete: % other owner sessions remain',
      owner_session_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'StripeWebhookEvent'
     AND class.relkind = 'r'
     AND class.relowner = table_owner
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
          AND acl.grantee IN (0, runtime_role_oid)
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
          )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION
      'StripeWebhookEvent FORCE predecessor drifted: %',
      accepted_table_count;
  END IF;

  WITH expected(proname, identity_arguments, source_md5) AS (
    VALUES
      ('grainline_stripe_webhook_begin', 'text, text',
       '76421b45f39a6d8f8888566c7fd0667f'),
      ('grainline_stripe_webhook_complete', 'text, bigint',
       'b7e9d6868d1486bdaa91f76ecebd9e7d'),
      ('grainline_stripe_webhook_fail', 'text, bigint, text',
       '3dd97d373d6b1ea656910cd35ca75f87'),
      ('grainline_stripe_webhook_prune_batch', 'integer',
       'f3e59deb8001d61005da054afd4f3b5c'),
      ('grainline_stripe_webhook_health_summary', '',
       'c2686377090f63e21198b3a4e33f97c0'),
      ('grainline_legacy_stock_restore_claim', 'text',
       'ab76c2d07eee3433973a7a72c1014864')
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_function_count
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
            acl.grantee NOT IN (procedure.proowner, runtime_role_oid)
            OR (
              acl.grantee = runtime_role_oid
              AND (acl.grantor <> procedure.proowner OR acl.is_grantable)
            )
          )
     )
     AND pg_catalog.strpos(
       pg_catalog.upper(procedure.prosrc), 'EXECUTE'
     ) = 0
     AND pg_catalog.strpos(
       pg_catalog.upper(procedure.prosrc), 'FORMAT('
     ) = 0;
  IF accepted_function_count <> 6 THEN
    RAISE EXCEPTION
      'StripeWebhookEvent FORCE function catalog drifted: %',
      accepted_function_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO named_runtime_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname IN (
       'grainline_stripe_webhook_begin',
       'grainline_stripe_webhook_complete',
       'grainline_stripe_webhook_fail',
       'grainline_stripe_webhook_prune_batch',
       'grainline_stripe_webhook_health_summary',
       'grainline_legacy_stock_restore_claim'
     )
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     );
  IF named_runtime_function_count <> 6 THEN
    RAISE EXCEPTION
      'StripeWebhookEvent FORCE trusted-name overload drifted: %',
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
     AND pg_catalog.strpos(procedure.prosrc, '"StripeWebhookEvent"') > 0;
  IF table_function_count <> 6 THEN
    RAISE EXCEPTION
      'StripeWebhookEvent FORCE runtime function surface drifted: %',
      table_function_count;
  END IF;
END
$grainline_stripe_webhook_event_force_preflight$;

ALTER TABLE public."StripeWebhookEvent" FORCE ROW LEVEL SECURITY;

DO $grainline_stripe_webhook_event_force_postflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'StripeWebhookEvent'
     AND class.relkind = 'r'
     AND class.relrowsecurity
     AND class.relforcerowsecurity
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
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION
      'StripeWebhookEvent FORCE did not establish the exact posture';
  END IF;
END
$grainline_stripe_webhook_event_force_postflight$;

COMMIT;
