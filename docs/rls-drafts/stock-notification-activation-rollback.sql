-- Database-first emergency rollback for
-- 20261027040000_activate_stock_notification_rls.
-- Run this database rollback before restoring any predecessor application.
-- It restores the predecessor CRUD grants before disabling RLS and removes
-- only the two activation policies. Preparation functions and subscription
-- data remain.
-- After a successful rollback, reconcile the Prisma ledger with:
--   npx prisma migrate resolve --rolled-back 20261027040000_activate_stock_notification_rls

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.stock-notification.rls.activation', 0)
);

LOCK TABLE public."StockNotification" IN ACCESS EXCLUSIVE MODE;

DO $grainline_stock_notification_rollback_preflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  runtime_privileges text[];
  reviewed_function text;
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
     AND class.relname = 'StockNotification'
     AND class.relkind = 'r';
  IF runtime_oid IS NULL OR table_oid IS NULL OR current_user <> session_user
     OR table_owner IS DISTINCT FROM (
       SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user
     ) THEN
    RAISE EXCEPTION 'StockNotification rollback identity drifted';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles
     WHERE oid = table_owner
       AND (rolsuper OR rolbypassrls)
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND relrowsecurity
       AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'StockNotification rollback requires the active reviewed posture';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(policy.polname::text ORDER BY policy.polname)
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
  ) IS DISTINCT FROM ARRAY[
    'stock_notification_owner_delete',
    'stock_notification_owner_select'
  ]::text[] OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
       AND (
         NOT policy.polpermissive
         OR policy.polroles IS DISTINCT FROM ARRAY[runtime_oid]::oid[]
         OR (policy.polname = 'stock_notification_owner_select'
             AND (policy.polcmd <> 'r'
                  OR pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
                     <> '("userId" = NULLIF(current_setting(''app.user_id''::text, true), ''''::text))'
                  OR policy.polwithcheck IS NOT NULL))
         OR (policy.polname = 'stock_notification_owner_delete'
             AND (policy.polcmd <> 'd'
                  OR pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
                     <> '("userId" = NULLIF(current_setting(''app.user_id''::text, true), ''''::text))'
                  OR policy.polwithcheck IS NOT NULL))
       )
  ) THEN
    RAISE EXCEPTION 'StockNotification rollback policy posture drifted';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(
             DISTINCT pg_catalog.upper(acl.privilege_type)
             ORDER BY pg_catalog.upper(acl.privilege_type)
           ),
           ARRAY[]::text[]
         )
    INTO runtime_privileges
    FROM pg_catalog.aclexplode(
      COALESCE(
        (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
        pg_catalog.acldefault('r', table_owner)
      )
    ) AS acl
   WHERE acl.grantee = runtime_oid;
  IF runtime_privileges IS DISTINCT FROM ARRAY['DELETE', 'SELECT']::text[]
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = table_oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
     ) THEN
    RAISE EXCEPTION 'StockNotification rollback grants drifted';
  END IF;

  FOREACH reviewed_function IN ARRAY ARRAY[
    'public.grainline_stock_notification_owner_subscribe(text,text)',
    'public.grainline_stock_notification_seller_counts(text[])',
    'public.grainline_stock_notification_seller_range_count(timestamp without time zone,timestamp without time zone,boolean)',
    'public.grainline_stock_notification_restock_candidates(text,integer)',
    'public.grainline_stock_notification_seller_listing_cleanup(text)',
    'public.grainline_stock_notification_admin_listing_cleanup(text)',
    'public.grainline_stock_notification_block_cleanup(text)',
    'public.grainline_stock_notification_owner_export()',
    'public.grainline_notification_claim_back_in_stock(text,text,text)'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = pg_catalog.to_regprocedure(reviewed_function)
         AND procedure.proowner = table_owner
         AND procedure.prosecdef
         AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
    ) OR NOT pg_catalog.has_function_privilege(
      'grainline_app_runtime',
      pg_catalog.to_regprocedure(reviewed_function),
      'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      0,
      pg_catalog.to_regprocedure(reviewed_function),
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'StockNotification rollback function posture drifted: %', reviewed_function;
    END IF;
  END LOOP;
END
$grainline_stock_notification_rollback_preflight$;

GRANT INSERT, UPDATE ON TABLE public."StockNotification"
  TO grainline_app_runtime;
ALTER TABLE public."StockNotification" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."StockNotification" DISABLE ROW LEVEL SECURITY;
DROP POLICY stock_notification_owner_select
  ON public."StockNotification";
DROP POLICY stock_notification_owner_delete
  ON public."StockNotification";

DO $grainline_stock_notification_rollback_postflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  runtime_privileges text[];
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
     AND class.relname = 'StockNotification'
     AND class.relkind = 'r';
  IF runtime_oid IS NULL OR table_oid IS NULL OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND NOT relrowsecurity
       AND NOT relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'StockNotification rollback catalog did not converge';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(
             DISTINCT pg_catalog.upper(acl.privilege_type)
             ORDER BY pg_catalog.upper(acl.privilege_type)
           ),
           ARRAY[]::text[]
         )
    INTO runtime_privileges
    FROM pg_catalog.aclexplode(
      COALESCE(
        (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
        pg_catalog.acldefault('r', table_owner)
      )
    ) AS acl
   WHERE acl.grantee = runtime_oid;
  IF runtime_privileges IS DISTINCT FROM
       ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = table_oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
     ) OR EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
             pg_catalog.acldefault('r', table_owner)
           )
         ) AS acl
        WHERE acl.grantee NOT IN (table_owner, runtime_oid)
     ) THEN
    RAISE EXCEPTION 'StockNotification rollback grants did not converge';
  END IF;
END
$grainline_stock_notification_rollback_postflight$;

COMMIT;
