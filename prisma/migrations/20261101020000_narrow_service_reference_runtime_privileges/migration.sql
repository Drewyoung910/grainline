BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $grainline_service_reference_preflight$
DECLARE
  runtime_role pg_catalog.pg_roles%ROWTYPE;
  target_count integer;
  target record;
  actual_runtime text[];
  public_privileges text[];
  runtime_grant_options text[];
  runtime_column_privileges text[];
BEGIN
  SELECT *
    INTO runtime_role
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';

  IF NOT FOUND
     OR NOT runtime_role.rolcanlogin
     OR runtime_role.rolsuper
     OR runtime_role.rolcreatedb
     OR runtime_role.rolcreaterole
     OR runtime_role.rolinherit
     OR runtime_role.rolreplication
     OR runtime_role.rolbypassrls THEN
    RAISE EXCEPTION 'grainline_app_runtime role posture drifted'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO target_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relkind = 'r'
     AND class.relname = ANY (ARRAY[
       'FoundingMakerGrant',
       'Metro',
       'SiteConfig',
       'SiteMetricsSnapshot',
       'SystemAuditLog'
     ]::text[]);

  IF target_count <> 5 THEN
    RAISE EXCEPTION 'service/reference table catalog drifted: found % of 5', target_count
      USING ERRCODE = '55000';
  END IF;

  FOR target IN
    SELECT table_name
      FROM (VALUES
        ('FoundingMakerGrant'::text),
        ('Metro'::text),
        ('SiteConfig'::text),
        ('SiteMetricsSnapshot'::text),
        ('SystemAuditLog'::text)
      ) AS expected(table_name)
  LOOP
    SELECT
      coalesce(
        pg_catalog.array_agg(DISTINCT pg_catalog.upper(acl.privilege_type)
          ORDER BY pg_catalog.upper(acl.privilege_type))
          FILTER (WHERE acl.grantee = runtime_role.oid),
        ARRAY[]::text[]
      ),
      coalesce(
        pg_catalog.array_agg(DISTINCT pg_catalog.upper(acl.privilege_type)
          ORDER BY pg_catalog.upper(acl.privilege_type))
          FILTER (WHERE acl.grantee = 0),
        ARRAY[]::text[]
      ),
      coalesce(
        pg_catalog.array_agg(DISTINCT pg_catalog.upper(acl.privilege_type)
          ORDER BY pg_catalog.upper(acl.privilege_type))
          FILTER (WHERE acl.grantee = runtime_role.oid AND acl.is_grantable),
        ARRAY[]::text[]
      )
      INTO actual_runtime, public_privileges, runtime_grant_options
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(
          class.relacl,
          pg_catalog.acldefault('r', class.relowner)
        )
      ) AS acl
     WHERE namespace.nspname = 'public'
       AND class.relname = target.table_name
       AND class.relkind = 'r'
       AND (acl.grantee = 0 OR acl.grantee = runtime_role.oid);

    SELECT coalesce(
      pg_catalog.array_agg(
        DISTINCT pg_catalog.format('%I:%s', attribute.attname, pg_catalog.upper(acl.privilege_type))
        ORDER BY pg_catalog.format('%I:%s', attribute.attname, pg_catalog.upper(acl.privilege_type))
      ),
      ARRAY[]::text[]
    )
      INTO runtime_column_privileges
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = class.oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE namespace.nspname = 'public'
       AND class.relname = target.table_name
       AND class.relkind = 'r'
       AND acl.grantee = runtime_role.oid;

    IF actual_runtime IS DISTINCT FROM ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[] THEN
      RAISE EXCEPTION 'predecessor runtime privileges for % drifted: found %',
        target.table_name, actual_runtime
        USING ERRCODE = '55000';
    END IF;
    IF public_privileges <> ARRAY[]::text[] THEN
      RAISE EXCEPTION 'predecessor PUBLIC privileges remain on %: %',
        target.table_name, public_privileges
        USING ERRCODE = '55000';
    END IF;
    IF runtime_grant_options <> ARRAY[]::text[] THEN
      RAISE EXCEPTION 'predecessor runtime grant options remain on %: %',
        target.table_name, runtime_grant_options
        USING ERRCODE = '55000';
    END IF;
    IF runtime_column_privileges <> ARRAY[]::text[] THEN
      RAISE EXCEPTION 'predecessor runtime column privileges remain on %: %',
        target.table_name, runtime_column_privileges
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$grainline_service_reference_preflight$;

REVOKE ALL ON TABLE
  public."FoundingMakerGrant",
  public."Metro",
  public."SiteConfig",
  public."SiteMetricsSnapshot",
  public."SystemAuditLog"
FROM PUBLIC, grainline_app_runtime;

GRANT SELECT ON TABLE
  public."FoundingMakerGrant",
  public."Metro",
  public."SiteConfig",
  public."SiteMetricsSnapshot",
  public."SystemAuditLog"
TO grainline_app_runtime;

GRANT INSERT ON TABLE
  public."Metro",
  public."SiteMetricsSnapshot",
  public."SystemAuditLog"
TO grainline_app_runtime;

GRANT UPDATE ON TABLE
  public."Metro",
  public."SiteMetricsSnapshot"
TO grainline_app_runtime;

DO $grainline_service_reference_postflight$
DECLARE
  runtime_oid oid;
  target record;
  actual_runtime text[];
  public_privileges text[];
  runtime_grant_options text[];
  runtime_column_privileges text[];
BEGIN
  SELECT oid
    INTO runtime_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';

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
    SELECT
      coalesce(
        pg_catalog.array_agg(DISTINCT pg_catalog.upper(acl.privilege_type)
          ORDER BY pg_catalog.upper(acl.privilege_type)),
        ARRAY[]::text[]
      )
      INTO actual_runtime
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(
          class.relacl,
          pg_catalog.acldefault('r', class.relowner)
        )
      ) AS acl
     WHERE namespace.nspname = 'public'
       AND class.relname = target.table_name
       AND class.relkind = 'r'
       AND acl.grantee = runtime_oid;

    IF actual_runtime IS DISTINCT FROM target.privileges THEN
      RAISE EXCEPTION 'runtime privileges for % drifted: expected %, found %',
        target.table_name, target.privileges, actual_runtime
        USING ERRCODE = '55000';
    END IF;

    SELECT
      coalesce(
        pg_catalog.array_agg(DISTINCT pg_catalog.upper(acl.privilege_type)
          ORDER BY pg_catalog.upper(acl.privilege_type))
          FILTER (WHERE acl.grantee = 0),
        ARRAY[]::text[]
      ),
      coalesce(
        pg_catalog.array_agg(DISTINCT pg_catalog.upper(acl.privilege_type)
          ORDER BY pg_catalog.upper(acl.privilege_type))
          FILTER (WHERE acl.grantee = runtime_oid AND acl.is_grantable),
        ARRAY[]::text[]
      )
      INTO public_privileges, runtime_grant_options
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(
          class.relacl,
          pg_catalog.acldefault('r', class.relowner)
        )
      ) AS acl
     WHERE namespace.nspname = 'public'
       AND class.relname = target.table_name
       AND class.relkind = 'r'
       AND (acl.grantee = 0 OR acl.grantee = runtime_oid);

    SELECT coalesce(
      pg_catalog.array_agg(
        DISTINCT pg_catalog.format('%I:%s', attribute.attname, pg_catalog.upper(acl.privilege_type))
        ORDER BY pg_catalog.format('%I:%s', attribute.attname, pg_catalog.upper(acl.privilege_type))
      ),
      ARRAY[]::text[]
    )
      INTO runtime_column_privileges
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = class.oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE namespace.nspname = 'public'
       AND class.relname = target.table_name
       AND class.relkind = 'r'
       AND acl.grantee = runtime_oid;

    IF public_privileges <> ARRAY[]::text[] THEN
      RAISE EXCEPTION 'PUBLIC privileges remain on %: %', target.table_name, public_privileges
        USING ERRCODE = '55000';
    END IF;
    IF runtime_grant_options <> ARRAY[]::text[] THEN
      RAISE EXCEPTION 'runtime grant options remain on %: %', target.table_name, runtime_grant_options
        USING ERRCODE = '55000';
    END IF;
    IF runtime_column_privileges <> ARRAY[]::text[] THEN
      RAISE EXCEPTION 'runtime column privileges remain on %: %',
        target.table_name, runtime_column_privileges
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$grainline_service_reference_postflight$;

COMMIT;
