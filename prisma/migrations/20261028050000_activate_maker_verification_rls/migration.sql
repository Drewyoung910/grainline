-- Policyless MakerVerification activation. Compatible fixed operations must be
-- live before this migration. This release changes authority only: it does not
-- rewrite rows, add policies, or remove schema.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.maker-verification.rls.activation', 0)
);

LOCK TABLE public."MakerVerification" IN ACCESS EXCLUSIVE MODE;

DO $grainline_maker_verification_activation_preflight$
DECLARE
  table_oid oid;
  table_owner oid;
  runtime_oid oid;
  staff_oid oid;
  role_state record;
BEGIN
  SELECT class.oid, class.relowner
    INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'MakerVerification'
     AND class.relkind = 'r';
  SELECT role.oid INTO runtime_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';
  SELECT role.oid INTO staff_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_staff_read_runtime';

  IF table_oid IS NULL OR runtime_oid IS NULL OR staff_oid IS NULL
     OR current_user <> session_user
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
    RAISE EXCEPTION
      'MakerVerification activation requires the bypass-capable table owner';
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
      RAISE EXCEPTION
        'MakerVerification role posture is unsafe: %', role_state.rolname;
    END IF;
  END LOOP;

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
    RAISE EXCEPTION
      'MakerVerification activation requires the policyless compatible predecessor';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       runtime_oid, table_oid, 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       runtime_oid, table_oid, 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       runtime_oid, table_oid, 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       runtime_oid, table_oid, 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       runtime_oid, table_oid, 'TRUNCATE'
     )
     OR pg_catalog.has_table_privilege(
       runtime_oid, table_oid, 'REFERENCES'
     )
     OR pg_catalog.has_table_privilege(
       runtime_oid, table_oid, 'TRIGGER'
     ) THEN
    RAISE EXCEPTION
      'MakerVerification predecessor runtime table grants drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
        ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
      ) AS privilege(name)
     WHERE pg_catalog.has_table_privilege(
       staff_oid, table_oid, privilege.name
     )
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
    RAISE EXCEPTION
      'MakerVerification predecessor staff, PUBLIC, or column grants drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = procedure.proowner
     WHERE namespace.nspname = 'public'
       AND pg_catalog.strpos(procedure.prosrc, '"MakerVerification"') > 0
       AND (
         NOT procedure.prosecdef
         OR procedure.proconfig IS DISTINCT FROM
              ARRAY['search_path=pg_catalog']::text[]
         OR NOT (owner_role.rolsuper OR owner_role.rolbypassrls)
       )
  ) THEN
    RAISE EXCEPTION
      'MakerVerification retained function cannot cross policyless FORCE RLS';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid IN (
       'public.grainline_maker_verification_owner_member_apply(text,integer,text,boolean)'::pg_catalog.regprocedure,
       'public.grainline_maker_verification_owner_master_apply(text,text,boolean)'::pg_catalog.regprocedure,
       'public.grainline_maker_verification_owner_export()'::pg_catalog.regprocedure,
       'public.grainline_maker_verification_owner_delete_redact(timestamp without time zone)'::pg_catalog.regprocedure,
       'public.grainline_maker_verification_staff_pending_count(text)'::pg_catalog.regprocedure,
       'public.grainline_maker_verification_staff_pending_page(text,timestamp without time zone,text,integer)'::pg_catalog.regprocedure,
       'public.grainline_seller_guild_staff_master_pending_count(text)'::pg_catalog.regprocedure,
       'public.grainline_seller_guild_staff_master_pending_page(text,timestamp without time zone,text,integer)'::pg_catalog.regprocedure,
       'public.grainline_seller_guild_staff_roster_count(text,text)'::pg_catalog.regprocedure,
       'public.grainline_seller_guild_staff_roster_page(text,text,timestamp without time zone,text,integer)'::pg_catalog.regprocedure,
       'public.grainline_seller_guild_staff_transition(text,text,text,text,text,boolean)'::pg_catalog.regprocedure,
       'public.grainline_seller_guild_member_revoke(text)'::pg_catalog.regprocedure,
       'public.grainline_seller_guild_metrics_apply(text,timestamp without time zone)'::pg_catalog.regprocedure
     )
  ) <> 13 THEN
    RAISE EXCEPTION
      'MakerVerification reviewed operation catalog is incomplete';
  END IF;
END;
$grainline_maker_verification_activation_preflight$;

REVOKE ALL PRIVILEGES ON TABLE public."MakerVerification"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

ALTER TABLE public."MakerVerification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MakerVerification" FORCE ROW LEVEL SECURITY;

DO $grainline_maker_verification_activation_postflight$
DECLARE
  table_oid oid := 'public."MakerVerification"'::pg_catalog.regclass;
  table_owner oid;
BEGIN
  SELECT class.relowner INTO table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = table_oid;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = table_oid
       AND class.relrowsecurity
       AND class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
  ) THEN
    RAISE EXCEPTION
      'MakerVerification activation did not reach policyless ENABLE plus FORCE';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(
          (SELECT class.relacl
             FROM pg_catalog.pg_class AS class
            WHERE class.oid = table_oid),
          pg_catalog.acldefault('r', table_owner)
        )
      ) AS acl
     WHERE acl.grantee <> table_owner
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND acl.grantee <> table_owner
  ) THEN
    RAISE EXCEPTION
      'MakerVerification activation retained direct table or column authority';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = procedure.proowner
     WHERE namespace.nspname = 'public'
       AND pg_catalog.strpos(procedure.prosrc, '"MakerVerification"') > 0
       AND (
         NOT procedure.prosecdef
         OR procedure.proconfig IS DISTINCT FROM
              ARRAY['search_path=pg_catalog']::text[]
         OR NOT (owner_role.rolsuper OR owner_role.rolbypassrls)
       )
  ) THEN
    RAISE EXCEPTION
      'MakerVerification retained function posture drifted during activation';
  END IF;
END;
$grainline_maker_verification_activation_postflight$;

COMMIT;
