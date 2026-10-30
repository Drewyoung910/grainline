BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.follow.rls.activation', 0)
);

LOCK TABLE public."Follow" IN ACCESS EXCLUSIVE MODE;

DO $grainline_follow_rollback_preflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
BEGIN
  SELECT oid INTO runtime_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT class.oid, class.relowner
    INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Follow'
     AND class.relkind = 'r';

  IF runtime_oid IS NULL OR table_oid IS NULL THEN
    RAISE EXCEPTION 'Follow rollback prerequisites are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND relrowsecurity
       AND relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'Follow rollback requires the exact policyless active state';
  END IF;
  IF pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'SELECT'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'INSERT'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'UPDATE'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'DELETE'
     ) THEN
    RAISE EXCEPTION 'Follow rollback found unexpected runtime table authority';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(
          (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
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
  ) THEN
    RAISE EXCEPTION 'Follow rollback ACL posture drifted';
  END IF;
END
$grainline_follow_rollback_preflight$;

-- Restore the predecessor app's direct statements before removing the row
-- security fence. The transaction keeps both changes atomic to observers.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Follow"
  TO grainline_app_runtime;

ALTER TABLE public."Follow" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."Follow" DISABLE ROW LEVEL SECURITY;

DO $grainline_follow_rollback_postflight$
DECLARE
  table_oid oid;
  table_owner oid;
  runtime_oid oid;
  existing_privileges text[];
BEGIN
  SELECT oid INTO runtime_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT class.oid, class.relowner
    INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Follow'
     AND class.relkind = 'r';

  IF table_oid IS NULL OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND (relrowsecurity OR relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'Follow rollback did not restore predecessor RLS posture';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(
             DISTINCT pg_catalog.upper(acl.privilege_type)
             ORDER BY pg_catalog.upper(acl.privilege_type)
           ),
           ARRAY[]::text[]
         )
    INTO existing_privileges
    FROM pg_catalog.aclexplode(
      COALESCE(
        (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
        pg_catalog.acldefault('r', table_owner)
      )
    ) AS acl
   WHERE acl.grantee = runtime_oid;
  IF existing_privileges IS DISTINCT FROM
       ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[] THEN
    RAISE EXCEPTION 'Follow rollback did not restore predecessor grants';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'Follow rollback left unexpected column privileges';
  END IF;
END
$grainline_follow_rollback_postflight$;

COMMIT;

-- Production ledger reconciliation is a separate owner-authorized operation:
-- npx prisma migrate resolve --rolled-back 20261028060000_activate_follow_rls
