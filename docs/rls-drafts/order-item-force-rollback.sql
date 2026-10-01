-- DRAFT ONLY. Do not apply to any persistent database.
-- Emergency rollback for policyless OrderItem FORCE. The accepted predecessor
-- remains policyless ENABLE with zero direct table and column authority.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.order-item.rls.force', 0)
);
LOCK TABLE public."OrderItem" IN ACCESS EXCLUSIVE MODE;

DO $grainline_order_item_force_rollback_preflight$
DECLARE
  table_owner oid;
  runtime_role record;
  runtime_role_oid oid;
  staff_role record;
  staff_role_oid oid;
  owner_role record;
  owner_session_count integer;
  accepted_table_count integer;
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'OrderItem FORCE rollback requires a direct owner session';
  END IF;

  SELECT
    role.oid, role.rolsuper, role.rolinherit, role.rolcanlogin,
    role.rolcreatedb, role.rolcreaterole, role.rolreplication,
    role.rolbypassrls
    INTO runtime_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';
  IF NOT FOUND
     OR runtime_role.rolsuper OR runtime_role.rolinherit
     OR NOT runtime_role.rolcanlogin OR runtime_role.rolcreatedb
     OR runtime_role.rolcreaterole OR runtime_role.rolreplication
     OR runtime_role.rolbypassrls THEN
    RAISE EXCEPTION 'grainline_app_runtime role posture is not OrderItem FORCE rollback-safe';
  END IF;
  runtime_role_oid := runtime_role.oid;

  -- Neon may retain only its non-effective administrative bootstrap edge:
  -- neondb_owner is a member of the restricted role, granted by cloud_admin
  -- with ADMIN but without INHERIT or SET. The restricted role must never be
  -- a member of the owner or another privileged role.
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
        JOIN pg_catalog.pg_auth_members AS membership ON membership.roleid = parent.oid
        JOIN pg_catalog.pg_roles AS child ON child.oid = membership.member
    )
    SELECT 1 FROM restricted_members WHERE rolname <> 'neondb_owner'
  ) THEN
    RAISE EXCEPTION 'OrderItem runtime role retains unreviewed role membership';
  END IF;

  SELECT
    role.oid, role.rolsuper, role.rolinherit, role.rolcanlogin,
    role.rolcreatedb, role.rolcreaterole, role.rolreplication,
    role.rolbypassrls
    INTO staff_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_staff_read_runtime';
  IF NOT FOUND
     OR staff_role.rolsuper OR staff_role.rolinherit
     OR NOT staff_role.rolcanlogin OR staff_role.rolcreatedb
     OR staff_role.rolcreaterole OR staff_role.rolreplication
     OR staff_role.rolbypassrls OR staff_role.oid = runtime_role_oid THEN
    RAISE EXCEPTION
      'grainline_staff_read_runtime role posture is not OrderItem FORCE rollback-safe';
  END IF;
  staff_role_oid := staff_role.oid;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
      JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = membership.grantor
     WHERE (
       member.rolname = 'grainline_staff_read_runtime'
       OR granted_role.rolname = 'grainline_staff_read_runtime'
     )
       AND NOT (
         granted_role.rolname = 'grainline_staff_read_runtime'
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
       WHERE parent.rolname = 'grainline_staff_read_runtime'
      UNION
      SELECT child.oid, child.rolname
        FROM restricted_members AS parent
        JOIN pg_catalog.pg_auth_members AS membership ON membership.roleid = parent.oid
        JOIN pg_catalog.pg_roles AS child ON child.oid = membership.member
    )
    SELECT 1 FROM restricted_members WHERE rolname <> 'neondb_owner'
  ) THEN
    RAISE EXCEPTION 'OrderItem staff role retains unreviewed role membership';
  END IF;

  SELECT class.relowner INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."OrderItem"'::pg_catalog.regclass
     AND class.relkind = 'r';
  SELECT
    role.oid, role.rolsuper, role.rolcanlogin, role.rolbypassrls
    INTO owner_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND
     OR NOT owner_role.rolcanlogin
     OR owner_role.oid IS DISTINCT FROM table_owner
     OR owner_role.oid IN (runtime_role_oid, staff_role_oid) THEN
    RAISE EXCEPTION 'OrderItem FORCE owner identity drifted';
  END IF;
  IF current_user = 'neondb_owner' THEN
    IF owner_role.rolsuper OR NOT owner_role.rolbypassrls
       OR pg_catalog.current_database() <> 'neondb' THEN
      RAISE EXCEPTION 'neondb_owner role posture is not OrderItem FORCE rollback-safe';
    END IF;
  ELSIF current_user = 'ci'
        AND pg_catalog.current_database() = 'grainline_ci' THEN
    IF NOT owner_role.rolsuper THEN
      RAISE EXCEPTION 'disposable CI migration owner posture drifted';
    END IF;
  ELSE
    RAISE EXCEPTION 'OrderItem FORCE rollback requires a reviewed migration owner';
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
      'OrderItem rollback owner-session drain is incomplete: % other owner sessions remain',
      owner_session_count;
  END IF;

  SELECT pg_catalog.count(*)::integer INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."OrderItem"'::pg_catalog.regclass
     AND class.relowner = table_owner
     AND class.relrowsecurity AND class.relforcerowsecurity
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy WHERE policy.polrelid = class.oid
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.aclexplode(
         COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
       ) AS acl
       WHERE acl.grantee <> class.relowner
         AND acl.privilege_type IN (
           'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
         )
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION 'OrderItem FORCE rollback source posture drifted';
  END IF;
END
$grainline_order_item_force_rollback_preflight$;

ALTER TABLE public."OrderItem" NO FORCE ROW LEVEL SECURITY;

DO $grainline_order_item_force_rollback_postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."OrderItem"'::pg_catalog.regclass
       AND class.relrowsecurity AND NOT class.relforcerowsecurity
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy AS policy WHERE policy.polrelid = class.oid
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
         WHERE acl.grantee <> class.relowner
           AND acl.privilege_type IN (
             'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
           )
       )
  ) THEN
    RAISE EXCEPTION 'OrderItem FORCE rollback did not restore ENABLE posture';
  END IF;
END
$grainline_order_item_force_rollback_postflight$;

COMMIT;
