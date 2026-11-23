-- Atomically activate the CommissionRequest / CommissionInterest boundary.
-- The compatible application reaches both tables only through the 22 reviewed
-- fixed operations installed by the preceding preparation.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.commission-domain.rls.activation', 0)
);

LOCK TABLE public."CommissionRequest", public."CommissionInterest"
  IN ACCESS EXCLUSIVE MODE;

DO $grainline_commission_domain_activation_preflight$
DECLARE
  runtime_oid oid;
  staff_oid oid;
  owner_oid oid;
  relation_state record;
  operation record;
  legacy record;
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'Commission activation requires a direct owner session';
  END IF;

  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT oid INTO staff_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_staff_read_runtime';
  SELECT oid INTO owner_oid FROM pg_catalog.pg_roles
   WHERE rolname = current_user;

  IF runtime_oid IS NULL OR staff_oid IS NULL OR owner_oid IS NULL THEN
    RAISE EXCEPTION 'Commission activation roles are missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE oid IN (runtime_oid, staff_oid)
       AND (rolsuper OR rolinherit OR NOT rolcanlogin OR rolcreatedb
            OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
     WHERE member IN (runtime_oid, staff_oid)
  ) THEN
    RAISE EXCEPTION 'Commission restricted-role posture is unsafe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE oid = owner_oid AND (rolsuper OR rolbypassrls)
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN ('CommissionRequest', 'CommissionInterest')
       AND relation.relkind = 'r'
       AND relation.relowner = owner_oid
  ) <> 2 THEN
    RAISE EXCEPTION 'Commission activation requires two bypass-owned tables';
  END IF;

  FOR relation_state IN
    SELECT relation.oid, relation.relname, relation.relowner,
           relation.relrowsecurity, relation.relforcerowsecurity,
           relation.relacl
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN ('CommissionRequest', 'CommissionInterest')
     ORDER BY relation.relname
  LOOP
    IF relation_state.relrowsecurity OR relation_state.relforcerowsecurity
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy
          WHERE polrelid = relation_state.oid
       ) THEN
      RAISE EXCEPTION 'Commission predecessor RLS posture drifted: %', relation_state.relname;
    END IF;
    IF NOT pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'SELECT')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'INSERT')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'UPDATE')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'DELETE')
       OR pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'TRUNCATE')
       OR pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'REFERENCES')
       OR pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'TRIGGER') THEN
      RAISE EXCEPTION 'Commission predecessor runtime grants drifted: %', relation_state.relname;
    END IF;
    IF EXISTS (
      SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(relation_state.relacl,
                   pg_catalog.acldefault('r', relation_state.relowner))
        ) AS acl
       WHERE acl.grantee NOT IN (relation_state.relowner, runtime_oid)
    ) OR EXISTS (
      SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
        CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
       WHERE attribute.attrelid = relation_state.oid
         AND attribute.attnum > 0 AND NOT attribute.attisdropped
    ) THEN
      RAISE EXCEPTION 'Commission predecessor ACL drifted: %', relation_state.relname;
    END IF;
  END LOOP;

  IF (
    SELECT pg_catalog.count(*)
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'CommissionRequest'
       AND column_name IN (
         'id', 'buyerId', 'buyerAccountActive', 'buyerName', 'buyerImageUrl',
         'buyerSellerCity', 'buyerSellerState', 'title', 'description',
         'category', 'budgetMinCents', 'budgetMaxCents', 'timeline',
         'referenceImageUrls', 'status', 'interestedCount', 'expiresAt',
         'isNational', 'lat', 'lng', 'radiusMeters', 'createdAt', 'updatedAt',
         'metroId', 'cityMetroId'
       )
  ) <> 25 OR (
    SELECT pg_catalog.count(*)
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'CommissionInterest'
       AND column_name IN (
         'id', 'commissionRequestId', 'sellerProfileId', 'conversationId',
         'createdAt'
       )
  ) <> 5 THEN
    RAISE EXCEPTION 'Commission table column contract drifted';
  END IF;

  FOR operation IN
    SELECT * FROM (VALUES
      ('public.grainline_commission_request_public_count(text,text,text,double precision,double precision,integer)', 's'),
      ('public.grainline_commission_request_public_page(text,text,text,double precision,double precision,integer,integer,integer)', 's'),
      ('public.grainline_commission_request_public_detail(text)', 's'),
      ('public.grainline_commission_request_public_sitemap_page(integer,integer)', 's'),
      ('public.grainline_commission_request_public_metro_ids()', 's'),
      ('public.grainline_commission_interest_actor_request_ids(text[])', 's'),
      ('public.grainline_commission_interest_actor_create(text,text,text,text)', 'v'),
      ('public.grainline_commission_request_owner_create(text,text,text,text,integer,integer,text,text[],boolean,double precision,double precision,integer)', 'v'),
      ('public.grainline_commission_request_owner_assign_metros(text,text,text)', 'v'),
      ('public.grainline_commission_request_owner_page(integer)', 's'),
      ('public.grainline_commission_request_owner_export()', 's'),
      ('public.grainline_commission_request_owner_active_count()', 's'),
      ('public.grainline_commission_request_owner_reference_image_urls()', 's'),
      ('public.grainline_commission_interest_owner_export()', 's'),
      ('public.grainline_seller_owner_commission_interest_summaries(text[],integer)', 's'),
      ('public.grainline_commission_request_owner_transition(text,text)', 'v'),
      ('public.grainline_commission_account_deletion_prepare(text,bigint,uuid)', 'v'),
      ('public.grainline_commission_account_deletion_redact(text,bigint,uuid)', 'v'),
      ('public.grainline_commission_request_staff_ban_close(text,text)', 'v'),
      ('public.grainline_commission_request_staff_ban_restore(text,text,text[],text[])', 'v'),
      ('public.grainline_commission_request_service_expire_batch(integer)', 'v'),
      ('public.grainline_commission_request_service_expired_count()', 's')
    ) AS expected(identity, volatility)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = operation.identity::pg_catalog.regprocedure
         AND procedure.proowner = owner_oid
         AND procedure.prosecdef
         AND procedure.provolatile = operation.volatility::"char"
         AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND pg_catalog.has_function_privilege(runtime_oid, procedure.oid, 'EXECUTE')
         AND NOT pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'Commission reviewed operation drifted: %', operation.identity;
    END IF;
  END LOOP;

  FOR legacy IN
    SELECT * FROM (VALUES
      ('public.grainline_message_create_commission_interest(text,text,text,text,text)', '8247283d3e79765eceac777d091b0dd0'),
      ('public.grainline_direct_upload_sync_commission_request(text,text)', 'ade11756e28500c0c17f053c6e0a5b65'),
      ('public.grainline_seller_service_commission_interest_targets(text,integer)', 'ea3bea27379b693177990a09cc5f2651')
    ) AS expected(identity, source_md5)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = legacy.identity::pg_catalog.regprocedure
         AND procedure.proowner = owner_oid
         AND procedure.prosecdef
         AND pg_catalog.md5(procedure.prosrc) = legacy.source_md5
         AND pg_catalog.has_function_privilege(runtime_oid, procedure.oid, 'EXECUTE')
         AND NOT pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'Commission legacy authority drifted: %', legacy.identity;
    END IF;
  END LOOP;
END
$grainline_commission_domain_activation_preflight$;

REVOKE ALL PRIVILEGES ON TABLE
  public."CommissionRequest", public."CommissionInterest"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_message_create_commission_interest(text, text, text, text, text),
  public.grainline_direct_upload_sync_commission_request(text, text),
  public.grainline_seller_service_commission_interest_targets(text, integer)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

ALTER TABLE public."CommissionRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionRequest" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionInterest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionInterest" FORCE ROW LEVEL SECURITY;

DO $grainline_commission_domain_activation_postflight$
DECLARE
  relation_state record;
  legacy_identity text;
BEGIN
  FOR relation_state IN
    SELECT relation.oid, relation.relname, relation.relrowsecurity,
           relation.relforcerowsecurity
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN ('CommissionRequest', 'CommissionInterest')
     ORDER BY relation.relname
  LOOP
    IF NOT relation_state.relrowsecurity OR NOT relation_state.relforcerowsecurity
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = relation_state.oid)
       OR pg_catalog.has_table_privilege('grainline_app_runtime', relation_state.oid, 'SELECT')
       OR pg_catalog.has_table_privilege('grainline_app_runtime', relation_state.oid, 'INSERT')
       OR pg_catalog.has_table_privilege('grainline_app_runtime', relation_state.oid, 'UPDATE')
       OR pg_catalog.has_table_privilege('grainline_app_runtime', relation_state.oid, 'DELETE')
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
          WHERE attribute.attrelid = relation_state.oid
            AND attribute.attnum > 0 AND NOT attribute.attisdropped
       ) THEN
      RAISE EXCEPTION 'Commission activation postflight drifted: %', relation_state.relname;
    END IF;
  END LOOP;

  FOREACH legacy_identity IN ARRAY ARRAY[
    'public.grainline_message_create_commission_interest(text,text,text,text,text)',
    'public.grainline_direct_upload_sync_commission_request(text,text)',
    'public.grainline_seller_service_commission_interest_targets(text,integer)'
  ]
  LOOP
    IF pg_catalog.has_function_privilege(
      'grainline_app_runtime', legacy_identity::pg_catalog.regprocedure, 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      'public', legacy_identity::pg_catalog.regprocedure, 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'Commission retired authority remains callable: %', legacy_identity;
    END IF;
  END LOOP;
END
$grainline_commission_domain_activation_postflight$;

COMMIT;
