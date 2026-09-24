-- DRAFT ONLY. Do not apply to any persistent database.
-- Core Order policyless ENABLE follows compatible app smoke and predecessor
-- drain. OrderItem and OrderShippingRateQuote remain separate releases.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.order-core.rls.activation', 0)
);
LOCK TABLE public."Order" IN ACCESS EXCLUSIVE MODE;

DO $grainline_order_core_activation_preflight$
DECLARE
  order_owner oid;
  runtime_oid oid;
  staff_oid oid;
  accepted_table_count integer;
  child_count integer;
  column_acl_count integer;
  accepted_staff_functions integer;
BEGIN
  IF current_user <> session_user
     OR NOT (
       current_user = 'neondb_owner'
       OR (current_user = 'ci'
           AND pg_catalog.current_database() = 'grainline_ci')
     ) THEN
    RAISE EXCEPTION 'Core Order activation requires reviewed owner session';
  END IF;

  SELECT role.oid INTO runtime_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime'
     AND NOT role.rolsuper AND NOT role.rolbypassrls;
  SELECT role.oid INTO staff_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_staff_read_runtime'
     AND role.rolcanlogin AND NOT role.rolsuper AND NOT role.rolbypassrls;
  IF runtime_oid IS NULL OR staff_oid IS NULL OR runtime_oid = staff_oid THEN
    RAISE EXCEPTION 'Core Order activation role identities drifted';
  END IF;

  SELECT class.relowner INTO order_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."Order"'::pg_catalog.regclass;
  IF order_owner <> (
    SELECT role.oid FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  ) THEN
    RAISE EXCEPTION 'Core Order activation table owner drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."Order"'::pg_catalog.regclass
     AND class.relkind = 'r'
     AND NOT class.relrowsecurity AND NOT class.relforcerowsecurity
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     )
     AND pg_catalog.has_table_privilege(runtime_oid, class.oid, 'SELECT')
     AND pg_catalog.has_table_privilege(runtime_oid, class.oid, 'INSERT')
     AND pg_catalog.has_table_privilege(runtime_oid, class.oid, 'UPDATE')
     AND pg_catalog.has_table_privilege(runtime_oid, class.oid, 'DELETE')
     AND NOT pg_catalog.has_table_privilege(
       runtime_oid, class.oid, 'TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT pg_catalog.has_table_privilege(
       staff_oid, class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.aclexplode(
         COALESCE(class.relacl,
                  pg_catalog.acldefault('r', class.relowner))
       ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type IN (
            'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
          )
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION 'Core Order activation predecessor table posture drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO child_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('OrderItem', 'OrderShippingRateQuote')
     AND class.relkind = 'r'
     AND NOT class.relrowsecurity AND NOT class.relforcerowsecurity
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     );
  IF child_count <> 2 THEN
    RAISE EXCEPTION 'Core Order activation child-table boundary drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO column_acl_count
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
   WHERE attribute.attrelid = 'public."Order"'::pg_catalog.regclass
     AND attribute.attnum > 0 AND NOT attribute.attisdropped
     AND acl.grantee IN (0, runtime_oid, staff_oid)
     AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','REFERENCES');
  IF column_acl_count <> 0 THEN
    RAISE EXCEPTION 'Core Order activation column ACL drifted';
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
   WHERE procedure.proowner = order_owner
     AND procedure.prosecdef
     AND pg_catalog.has_function_privilege(staff_oid, procedure.oid, 'EXECUTE')
     AND NOT pg_catalog.has_function_privilege(
       runtime_oid, procedure.oid, 'EXECUTE'
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.aclexplode(
         COALESCE(procedure.proacl,
                  pg_catalog.acldefault('f', procedure.proowner))
       ) AS acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
     );
  IF accepted_staff_functions <> 6 THEN
    RAISE EXCEPTION 'Core Order activation staff-function authority drifted';
  END IF;
END
$grainline_order_core_activation_preflight$;

ALTER TABLE public."Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Order" NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Order"
  FROM PUBLIC, grainline_app_runtime;

DO $grainline_order_core_activation_postflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."Order"'::pg_catalog.regclass
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
     AND NOT pg_catalog.has_table_privilege(
       'grainline_staff_read_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
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
    RAISE EXCEPTION 'Core Order activation posture did not converge';
  END IF;
END
$grainline_order_core_activation_postflight$;

COMMIT;
