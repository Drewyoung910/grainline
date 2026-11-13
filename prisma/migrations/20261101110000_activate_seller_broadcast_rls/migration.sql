-- Policyless SellerBroadcast activation. The compatible fixed-operation app
-- and exact 20261101100000 preparation must be live before this migration.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.seller-broadcast.rls.activation', 0)
);

LOCK TABLE public."SellerBroadcast" IN ACCESS EXCLUSIVE MODE;

DO $grainline_seller_broadcast_activation_preflight$
DECLARE
  table_oid oid := 'public."SellerBroadcast"'::pg_catalog.regclass;
  table_owner oid;
  runtime_oid oid;
  staff_oid oid;
BEGIN
  SELECT class.relowner INTO table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = table_oid
     AND class.relkind = 'r';
  SELECT role.oid INTO runtime_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';
  SELECT role.oid INTO staff_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_staff_read_runtime';

  IF table_owner IS NULL OR runtime_oid IS NULL OR staff_oid IS NULL
     OR current_user <> session_user
     OR table_owner IS DISTINCT FROM (
       SELECT role.oid FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = current_user
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles AS role
        WHERE role.oid = table_owner
          AND (role.rolsuper OR role.rolbypassrls)
     ) THEN
    RAISE EXCEPTION 'SellerBroadcast activation requires the bypass-capable table owner';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS role
     WHERE role.oid IN (runtime_oid, staff_oid)
       AND (role.rolsuper OR role.rolinherit OR NOT role.rolcanlogin
            OR role.rolcreatedb OR role.rolcreaterole
            OR role.rolreplication OR role.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'SellerBroadcast activation role posture is unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS class
     WHERE class.oid = table_oid
       AND NOT class.relrowsecurity
       AND NOT class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'SellerBroadcast activation requires the policyless predecessor';
  END IF;

  IF NOT pg_catalog.has_table_privilege(runtime_oid, table_oid, 'SELECT')
     OR NOT pg_catalog.has_table_privilege(runtime_oid, table_oid, 'INSERT')
     OR NOT pg_catalog.has_table_privilege(runtime_oid, table_oid, 'UPDATE')
     OR NOT pg_catalog.has_table_privilege(runtime_oid, table_oid, 'DELETE')
     OR pg_catalog.has_table_privilege(runtime_oid, table_oid, 'TRUNCATE')
     OR pg_catalog.has_table_privilege(runtime_oid, table_oid, 'REFERENCES')
     OR pg_catalog.has_table_privilege(runtime_oid, table_oid, 'TRIGGER')
     OR EXISTS (
       SELECT 1 FROM (VALUES
         ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
         ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
       ) AS privilege(name)
       WHERE pg_catalog.has_table_privilege(staff_oid, table_oid, privilege.name)
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_class AS class
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE class.oid = table_oid
          AND acl.grantee = 0
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'DELETE',
            'TRUNCATE', 'REFERENCES', 'TRIGGER'
          )
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = table_oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND acl.grantee IN (runtime_oid, staff_oid, 0::oid)
     ) THEN
    RAISE EXCEPTION 'SellerBroadcast predecessor grants drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('public.grainline_seller_broadcast_owner_cooldown()', 'runtime'),
        ('public.grainline_seller_broadcast_owner_create(text,text,text,integer)', 'runtime'),
        ('public.grainline_seller_broadcast_owner_count()', 'runtime'),
        ('public.grainline_seller_broadcast_owner_page(integer,integer)', 'runtime'),
        ('public.grainline_seller_broadcast_owner_export()', 'runtime'),
        ('public.grainline_seller_broadcast_public_latest(text)', 'runtime'),
        ('public.grainline_seller_broadcast_actor_feed_page(text[],timestamp without time zone,timestamp without time zone,text,text,integer)', 'runtime'),
        ('public.grainline_seller_broadcast_owner_delivery_source(text)', 'runtime'),
        ('public.grainline_seller_broadcast_owner_record_delivery(text,integer)', 'runtime'),
        ('public.grainline_seller_broadcast_staff_count(text,text)', 'staff'),
        ('public.grainline_seller_broadcast_staff_page(text,text,integer,integer)', 'staff'),
        ('public.grainline_seller_broadcast_staff_delete(text,text)', 'staff'),
        ('public.grainline_seller_broadcast_account_deletion_ids(text,text,bigint,uuid)', 'runtime'),
        ('public.grainline_seller_broadcast_account_deletion_cleanup(text,text,bigint,uuid)', 'runtime'),
        ('public.grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)', 'runtime'),
        ('public.grainline_email_outbox_cancel_seller_broadcast(text)', 'runtime'),
        ('public.grainline_notification_delete_seller_broadcast(text)', 'runtime')
      ) AS expected(signature, execute_role)
     WHERE pg_catalog.to_regprocedure(expected.signature) IS NULL
        OR pg_catalog.has_function_privilege(
             0, pg_catalog.to_regprocedure(expected.signature), 'EXECUTE'
           )
        OR pg_catalog.has_function_privilege(
             runtime_oid, pg_catalog.to_regprocedure(expected.signature), 'EXECUTE'
           ) IS DISTINCT FROM (expected.execute_role = 'runtime')
        OR pg_catalog.has_function_privilege(
             staff_oid, pg_catalog.to_regprocedure(expected.signature), 'EXECUTE'
           ) IS DISTINCT FROM (expected.execute_role = 'staff')
  ) THEN
    RAISE EXCEPTION 'SellerBroadcast reviewed operation grants drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = procedure.proowner
     WHERE namespace.nspname = 'public'
       AND pg_catalog.strpos(procedure.prosrc, '"SellerBroadcast"') > 0
       AND (
         NOT procedure.prosecdef
         OR procedure.proconfig IS DISTINCT FROM
              ARRAY['search_path=pg_catalog']::text[]
         OR NOT (owner_role.rolsuper OR owner_role.rolbypassrls)
       )
  ) THEN
    RAISE EXCEPTION 'SellerBroadcast retained function cannot cross policyless FORCE RLS';
  END IF;
END;
$grainline_seller_broadcast_activation_preflight$;

REVOKE ALL PRIVILEGES ON TABLE public."SellerBroadcast"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_email_outbox_cancel_seller_broadcast(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_delete_seller_broadcast(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

ALTER TABLE public."SellerBroadcast" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SellerBroadcast" FORCE ROW LEVEL SECURITY;

DO $grainline_seller_broadcast_activation_postflight$
DECLARE
  table_oid oid := 'public."SellerBroadcast"'::pg_catalog.regclass;
  table_owner oid;
BEGIN
  SELECT class.relowner INTO table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = table_oid;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS class
     WHERE class.oid = table_oid
       AND class.relrowsecurity
       AND class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) AS acl
     WHERE class.oid = table_oid
       AND acl.grantee <> table_owner
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND acl.grantee <> table_owner
  ) THEN
    RAISE EXCEPTION 'SellerBroadcast activation did not reach policyless zero-direct FORCE';
  END IF;
  IF pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_email_outbox_cancel_seller_broadcast(text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime',
       'public.grainline_email_outbox_cancel_seller_broadcast(text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       0,
       'public.grainline_email_outbox_cancel_seller_broadcast(text)'::pg_catalog.regprocedure,
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_notification_delete_seller_broadcast(text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime',
       'public.grainline_notification_delete_seller_broadcast(text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       0,
       'public.grainline_notification_delete_seller_broadcast(text)'::pg_catalog.regprocedure,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'SellerBroadcast retired cleanup functions remain callable';
  END IF;
END;
$grainline_seller_broadcast_activation_postflight$;

COMMIT;
