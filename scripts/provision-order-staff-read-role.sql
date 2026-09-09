-- Grainline Order staff-read least-privilege convergence.
--
-- This script never creates a role or sets a password. The reviewed provider
-- operator must first create grainline_staff_read_runtime as a separately
-- authenticated LOGIN. Run this only after the corrected v2 projections exist:
--
--   psql "$DIRECT_URL" \
--     -v staff_role=grainline_staff_read_runtime \
--     -v runtime_role=grainline_app_runtime \
--     -v migration_role=neondb_owner \
--     -f scripts/provision-order-staff-read-role.sql

\set ON_ERROR_STOP on

\if :{?staff_role}
\else
\echo 'missing required psql variable: -v staff_role=grainline_staff_read_runtime'
DO $grainline_staff_role_abort$ BEGIN
  RAISE EXCEPTION 'Order staff-read role provisioning refused';
END $grainline_staff_role_abort$;
\endif

\if :{?runtime_role}
\else
\echo 'missing required psql variable: -v runtime_role=grainline_app_runtime'
DO $grainline_staff_role_abort$ BEGIN
  RAISE EXCEPTION 'Order staff-read role provisioning refused';
END $grainline_staff_role_abort$;
\endif

\if :{?migration_role}
\else
\echo 'missing required psql variable: -v migration_role=neondb_owner'
DO $grainline_staff_role_abort$ BEGIN
  RAISE EXCEPTION 'Order staff-read role provisioning refused';
END $grainline_staff_role_abort$;
\endif

WITH failure AS (
  SELECT pg_catalog.format(
    'expected owner %s, got current_user=%s session_user=%s',
    :'migration_role', current_user, session_user
  ) AS message
  WHERE current_user <> :'migration_role'
     OR session_user <> :'migration_role'
), required_role(role_name) AS (
  VALUES (:'staff_role'), (:'runtime_role'), (:'migration_role')
), missing AS (
  SELECT pg_catalog.format('required role does not exist: %s', role_name)
    AS message
  FROM required_role
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name
  )
  ORDER BY role_name
  LIMIT 1
), collision AS (
  SELECT 'staff, runtime, and migration roles must be pairwise distinct' AS message
  WHERE :'staff_role' IN (:'runtime_role', :'migration_role')
     OR :'runtime_role' = :'migration_role'
), wrong_target AS (
  SELECT 'staff and runtime role names must match the reviewed identities' AS message
  WHERE :'staff_role' <> 'grainline_staff_read_runtime'
     OR :'runtime_role' <> 'grainline_app_runtime'
), combined AS (
  SELECT message FROM failure
  UNION ALL SELECT message FROM missing
  UNION ALL SELECT message FROM collision
  UNION ALL SELECT message FROM wrong_target
  LIMIT 1
)
SELECT
  EXISTS (SELECT 1 FROM combined) AS grainline_staff_role_failed,
  COALESCE((SELECT message FROM combined), '') AS grainline_staff_role_failure;
\gset
\if :grainline_staff_role_failed
\echo :grainline_staff_role_failure
DO $grainline_staff_role_abort$ BEGIN
  RAISE EXCEPTION 'Order staff-read role provisioning refused';
END $grainline_staff_role_abort$;
\endif
\unset grainline_staff_role_failed
\unset grainline_staff_role_failure

BEGIN;

WITH staff AS (
  SELECT * FROM pg_catalog.pg_roles WHERE rolname = :'staff_role'
), failure AS (
  SELECT 'staff role attributes are not exact' AS message
  FROM staff
  WHERE rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit
     OR NOT rolcanlogin OR rolreplication OR rolbypassrls
), parent_memberships AS (
  WITH RECURSIVE parents AS (
    SELECT parent.oid, parent.rolname
    FROM pg_catalog.pg_auth_members AS edge
    JOIN pg_catalog.pg_roles AS child ON child.oid = edge.member
    JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
    WHERE child.rolname = :'staff_role'
    UNION
    SELECT parent.oid, parent.rolname
    FROM parents AS child
    JOIN pg_catalog.pg_auth_members AS edge ON edge.member = child.oid
    JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
  )
  SELECT rolname FROM parents
), member_roles AS (
  WITH RECURSIVE members AS (
    SELECT member.oid, member.rolname
    FROM pg_catalog.pg_auth_members AS edge
    JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
    JOIN pg_catalog.pg_roles AS member ON member.oid = edge.member
    WHERE parent.rolname = :'staff_role'
    UNION
    SELECT member.oid, member.rolname
    FROM members AS parent
    JOIN pg_catalog.pg_auth_members AS edge ON edge.roleid = parent.oid
    JOIN pg_catalog.pg_roles AS member ON member.oid = edge.member
  )
  SELECT rolname FROM members
), direct_member_edges AS (
  SELECT member.rolname AS member_role,
         grantor.rolname AS grantor_role,
         edge.admin_option, edge.inherit_option, edge.set_option
  FROM pg_catalog.pg_auth_members AS edge
  JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
  JOIN pg_catalog.pg_roles AS member ON member.oid = edge.member
  JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = edge.grantor
  WHERE parent.rolname = :'staff_role'
), membership_failure AS (
  SELECT pg_catalog.format('staff role is a member of %s', rolname) AS message
  FROM parent_memberships
  UNION ALL
  SELECT pg_catalog.format('unexpected role is a member of staff role: %s', rolname)
  FROM member_roles
  WHERE rolname <> :'migration_role'
  UNION ALL
  SELECT pg_catalog.format('unexpected direct staff-role member edge: %s', member_role)
  FROM direct_member_edges
  WHERE NOT (
    :'migration_role' = 'neondb_owner'
    AND member_role = :'migration_role'
    AND grantor_role = 'cloud_admin'
    AND admin_option
    AND NOT inherit_option
    AND NOT set_option
  )
), combined AS (
  SELECT message FROM failure
  UNION ALL SELECT message FROM membership_failure
  LIMIT 1
)
SELECT
  EXISTS (SELECT 1 FROM combined) AS grainline_staff_role_failed,
  COALESCE((SELECT message FROM combined), '') AS grainline_staff_role_failure;
\gset
\if :grainline_staff_role_failed
\echo :grainline_staff_role_failure
DO $grainline_staff_role_abort$ BEGIN
  RAISE EXCEPTION 'Order staff-read role provisioning refused';
END $grainline_staff_role_abort$;
\endif
\unset grainline_staff_role_failed
\unset grainline_staff_role_failure

GRANT USAGE ON SCHEMA public TO :"staff_role";
REVOKE CREATE ON SCHEMA public FROM :"staff_role";
SELECT pg_catalog.format(
  'REVOKE CREATE ON DATABASE %I FROM %I',
  current_database(), :'staff_role'
);
\gexec

WITH column_grants AS (
  SELECT namespace.nspname, class.relname,
         pg_catalog.upper(acl.privilege_type) AS privilege_type,
         pg_catalog.string_agg(
           pg_catalog.format('%I', attribute.attname),
           ', ' ORDER BY attribute.attnum
         ) AS columns
  FROM pg_catalog.pg_class AS class
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
  JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = class.oid
  CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
  WHERE namespace.nspname = 'public'
    AND class.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND acl.grantee = (
      SELECT oid FROM pg_catalog.pg_roles WHERE rolname = :'staff_role'
    )
  GROUP BY namespace.nspname, class.relname,
           pg_catalog.upper(acl.privilege_type)
)
SELECT pg_catalog.format(
  'REVOKE %s (%s) ON TABLE %I.%I FROM %I',
  privilege_type, columns, nspname, relname, :'staff_role'
)
FROM column_grants
ORDER BY nspname, relname, privilege_type;
\gexec

SELECT pg_catalog.format(
  'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', :'staff_role'
);
\gexec
SELECT pg_catalog.format(
  'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', :'staff_role'
);
\gexec
SELECT pg_catalog.format(
  'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I', :'staff_role'
);
\gexec

WITH required(function_signature) AS (
  VALUES
    ('public."grainline_order_staff_page_v2"(text, text, integer, integer)'),
    ('public."grainline_order_staff_detail_v2"(text, text)')
), missing AS (
  SELECT function_signature FROM required
  WHERE pg_catalog.to_regprocedure(function_signature) IS NULL
  ORDER BY function_signature
  LIMIT 1
)
SELECT
  EXISTS (SELECT 1 FROM missing) AS grainline_staff_role_failed,
  COALESCE((SELECT 'missing staff projection: ' || function_signature FROM missing), '')
    AS grainline_staff_role_failure;
\gset
\if :grainline_staff_role_failed
\echo :grainline_staff_role_failure
DO $grainline_staff_role_abort$ BEGIN
  RAISE EXCEPTION 'Order staff-read role provisioning refused';
END $grainline_staff_role_abort$;
\endif
\unset grainline_staff_role_failed
\unset grainline_staff_role_failure

GRANT EXECUTE ON FUNCTION
  public.grainline_order_staff_page_v2(text, text, integer, integer)
  TO :"staff_role";
GRANT EXECUTE ON FUNCTION
  public.grainline_order_staff_detail_v2(text, text)
  TO :"staff_role";

WITH table_authority AS (
  SELECT class.oid
  FROM pg_catalog.pg_class AS class
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
  WHERE namespace.nspname = 'public'
    AND class.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND CASE WHEN class.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
      pg_catalog.has_table_privilege(
        :'staff_role', class.oid,
        'SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER,TRUNCATE'
      )
    ELSE false END
), sequence_authority AS (
  SELECT class.oid
  FROM pg_catalog.pg_class AS class
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
  WHERE namespace.nspname = 'public' AND class.relkind = 'S'
    AND CASE WHEN class.relkind = 'S' THEN pg_catalog.has_sequence_privilege(
      :'staff_role', class.oid, 'USAGE,SELECT,UPDATE'
    ) ELSE false END
), column_authority AS (
  SELECT class.oid, attribute.attnum
  FROM pg_catalog.pg_class AS class
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
  JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = class.oid
  WHERE namespace.nspname = 'public'
    AND class.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND CASE WHEN class.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
      pg_catalog.has_column_privilege(
        :'staff_role', class.oid, attribute.attnum,
        'SELECT,INSERT,UPDATE,REFERENCES'
      )
    ELSE false END
), default_authority AS (
  SELECT defaults.oid
  FROM pg_catalog.pg_default_acl AS defaults
  CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
  WHERE acl.grantee = (
    SELECT oid FROM pg_catalog.pg_roles WHERE rolname = :'staff_role'
  )
), expected(function_signature) AS (
  VALUES
    ('public."grainline_order_staff_page_v2"(text, text, integer, integer)'),
    ('public."grainline_order_staff_detail_v2"(text, text)')
), expected_authority AS (
  SELECT function_signature,
         pg_catalog.has_function_privilege(
           :'staff_role', pg_catalog.to_regprocedure(function_signature), 'EXECUTE'
         ) AS staff_execute,
         pg_catalog.has_function_privilege(
           :'runtime_role', pg_catalog.to_regprocedure(function_signature), 'EXECUTE'
         ) AS runtime_execute,
         EXISTS (
           SELECT 1 FROM pg_catalog.pg_proc AS routine
           CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
             routine.proacl, pg_catalog.acldefault('f', routine.proowner)
           )) AS acl
           WHERE routine.oid = pg_catalog.to_regprocedure(function_signature)
             AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
         ) AS public_execute
  FROM expected
), unexpected_definer_authority AS (
  SELECT procedure.oid
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.prosecdef
    AND pg_catalog.has_function_privilege(:'staff_role', procedure.oid, 'EXECUTE')
    AND procedure.oid NOT IN (
      SELECT pg_catalog.to_regprocedure(function_signature) FROM expected
    )
), failure AS (
  SELECT 'staff role retains table authority' AS message
  WHERE EXISTS (SELECT 1 FROM table_authority)
  UNION ALL SELECT 'staff role retains column authority'
  WHERE EXISTS (SELECT 1 FROM column_authority)
  UNION ALL SELECT 'staff role retains sequence authority'
  WHERE EXISTS (SELECT 1 FROM sequence_authority)
  UNION ALL SELECT 'staff role retains default privilege grants'
  WHERE EXISTS (SELECT 1 FROM default_authority)
  UNION ALL SELECT 'staff projection execution authority is not exact'
  WHERE EXISTS (
    SELECT 1 FROM expected_authority
    WHERE NOT staff_execute OR runtime_execute OR public_execute
  )
  UNION ALL SELECT 'staff role can execute an unexpected definer function'
  WHERE EXISTS (SELECT 1 FROM unexpected_definer_authority)
  UNION ALL SELECT 'staff role schema/database authority is not exact'
  WHERE NOT pg_catalog.has_schema_privilege(:'staff_role', 'public', 'USAGE')
     OR pg_catalog.has_schema_privilege(:'staff_role', 'public', 'CREATE')
     OR pg_catalog.has_database_privilege(:'staff_role', current_database(), 'CREATE')
  LIMIT 1
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_staff_role_failed,
  COALESCE((SELECT message FROM failure), '') AS grainline_staff_role_failure;
\gset
\if :grainline_staff_role_failed
\echo :grainline_staff_role_failure
DO $grainline_staff_role_abort$ BEGIN
  RAISE EXCEPTION 'Order staff-read role provisioning refused';
END $grainline_staff_role_abort$;
\endif
\unset grainline_staff_role_failed
\unset grainline_staff_role_failure

COMMIT;
