-- Emergency database-first rollback for
-- 20261101020000_narrow_service_reference_runtime_privileges.
--
-- Run only through the protected migration owner after reviewing the exact
-- production catalog. This restores the predecessor application's direct CRUD
-- authority; it does not change rows, RLS, policies, functions or PUBLIC.
-- After the database rollback, restore compatible application source and the
-- predecessor provisioning/audit expectations. If the forward migration must
-- run again, reconcile its Prisma ledger row with `prisma migrate resolve
-- --rolled-back 20261101020000_narrow_service_reference_runtime_privileges`
-- only after the database rollback and an owner-reviewed ledger inspection.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $grainline_service_reference_rollback_preflight$
DECLARE
  runtime_oid oid;
  target record;
  actual_runtime text[];
BEGIN
  SELECT oid
    INTO runtime_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';

  IF runtime_oid IS NULL THEN
    RAISE EXCEPTION 'grainline_app_runtime is missing'
      USING ERRCODE = '55000';
  END IF;

  FOR target IN
    SELECT *
      FROM (VALUES
        ('FoundingMakerGrant'::text, ARRAY['SELECT']::text[]),
        ('Metro'::text, ARRAY['INSERT', 'SELECT', 'UPDATE']::text[]),
        ('SiteConfig'::text, ARRAY['SELECT']::text[]),
        ('SiteMetricsSnapshot'::text, ARRAY['INSERT', 'SELECT', 'UPDATE']::text[]),
        ('SystemAuditLog'::text, ARRAY['INSERT', 'SELECT']::text[])
      ) AS expected(table_name, privileges)
  LOOP
    SELECT coalesce(
      pg_catalog.array_agg(DISTINCT pg_catalog.upper(acl.privilege_type)
        ORDER BY pg_catalog.upper(acl.privilege_type)),
      ARRAY[]::text[]
    )
      INTO actual_runtime
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) AS acl
     WHERE namespace.nspname = 'public'
       AND class.relname = target.table_name
       AND class.relkind = 'r'
       AND acl.grantee = runtime_oid;

    IF actual_runtime IS DISTINCT FROM target.privileges THEN
      RAISE EXCEPTION 'refusing rollback: runtime privileges for % are %, expected %',
        target.table_name, actual_runtime, target.privileges
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$grainline_service_reference_rollback_preflight$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."FoundingMakerGrant",
  public."Metro",
  public."SiteConfig",
  public."SiteMetricsSnapshot",
  public."SystemAuditLog"
TO grainline_app_runtime;

COMMIT;
