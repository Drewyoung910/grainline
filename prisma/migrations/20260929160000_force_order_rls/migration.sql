-- Reviewed posture-only Core Order FORCE hardening.
-- Apply only through the guarded main-only production migration workflow.
-- Core Order FORCE is a posture-only release after accepted policyless ENABLE.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.order-core.rls.force', 0)
);
LOCK TABLE public."Order" IN ACCESS EXCLUSIVE MODE;

DO $grainline_order_core_force_preflight$
DECLARE
  accepted_table_count integer;
  accepted_staff_functions integer;
BEGIN
  IF current_user <> session_user
     OR NOT (
       current_user = 'neondb_owner'
       OR (current_user = 'ci'
           AND pg_catalog.current_database() = 'grainline_ci')
     ) THEN
    RAISE EXCEPTION 'Core Order FORCE requires reviewed owner session';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."Order"'::pg_catalog.regclass
     AND class.relkind = 'r'
     AND class.relowner = (
       SELECT role.oid FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = current_user
     )
     AND class.relrowsecurity AND NOT class.relforcerowsecurity
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     )
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.aclexplode(
         COALESCE(class.relacl,
                  pg_catalog.acldefault('r', class.relowner))
       ) AS acl
        WHERE acl.grantee <> class.relowner
          AND acl.privilege_type IN (
            'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
          )
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION 'Core Order FORCE requires accepted policyless ENABLE';
  END IF;

  WITH expected(function_identity) AS (
    VALUES
      ('public.grainline_order_staff_page_v2(text,text,integer,integer)'),
      ('public.grainline_order_staff_detail_v2(text,text)'),
      ('public.grainline_order_staff_mark_reviewed(text,text)'),
      ('public.grainline_order_staff_record_label_voided(text,text)'),
      ('public.grainline_order_staff_append_note(text,text,text)'),
      ('public.grainline_order_staff_capability_mint(text,text,text,jsonb)')
  )
  SELECT pg_catalog.count(*)::integer INTO accepted_staff_functions
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
   WHERE procedure.proowner = (
     SELECT role.oid FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = current_user
   )
     AND procedure.prosecdef
     AND pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.aclexplode(
         COALESCE(procedure.proacl,
                  pg_catalog.acldefault('f', procedure.proowner))
       ) AS acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
     );
  IF accepted_staff_functions <> 6 THEN
    RAISE EXCEPTION 'Core Order FORCE staff-function authority drifted';
  END IF;
END
$grainline_order_core_force_preflight$;

ALTER TABLE public."Order" FORCE ROW LEVEL SECURITY;

DO $grainline_order_core_force_postflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."Order"'::pg_catalog.regclass
     AND class.relrowsecurity AND class.relforcerowsecurity
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     )
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION 'Core Order FORCE posture did not converge';
  END IF;
END
$grainline_order_core_force_postflight$;

COMMIT;
