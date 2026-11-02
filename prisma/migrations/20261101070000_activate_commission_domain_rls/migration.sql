-- Policyless activation for the coupled CommissionRequest and
-- CommissionInterest domain. The compatible fixed-operation application must
-- be live and predecessor traffic drained before this migration is released.

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
  role_state record;
  expected_columns text[];
  reviewed_preparation_functions regprocedure[] := ARRAY[
    'public.grainline_commission_account_deletion_prepare()',
    'public.grainline_commission_account_deletion_redact()',
    'public.grainline_commission_interest_actor_create(text,text,text,text)',
    'public.grainline_commission_interest_actor_request_ids(text[])',
    'public.grainline_commission_interest_owner_export()',
    'public.grainline_commission_request_actor_report_target(text,text)',
    'public.grainline_commission_request_owner_active_count()',
    'public.grainline_commission_request_owner_assign_metros(text,text,text)',
    'public.grainline_commission_request_owner_create(text,text,text,text,integer,integer,text,text[],boolean,double precision,double precision,integer)',
    'public.grainline_commission_request_owner_export()',
    'public.grainline_commission_request_owner_page(integer)',
    'public.grainline_commission_request_owner_reference_image_urls()',
    'public.grainline_commission_request_owner_transition(text,text)',
    'public.grainline_commission_request_public_count(text,text,text,double precision,double precision,integer)',
    'public.grainline_commission_request_public_detail(text)',
    'public.grainline_commission_request_public_metro_ids()',
    'public.grainline_commission_request_public_page(text,text,text,double precision,double precision,integer,integer,integer)',
    'public.grainline_commission_request_public_sitemap_page(integer,integer)',
    'public.grainline_commission_request_service_expire_batch(integer)',
    'public.grainline_commission_request_service_expired_count()',
    'public.grainline_commission_request_staff_ban_close(text,text)',
    'public.grainline_commission_request_staff_ban_restore(text,text,text[],text[])',
    'public.grainline_seller_owner_commission_interest_summaries(text[],integer)'
  ]::regprocedure[];
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'Commission activation requires a direct owner session';
  END IF;

  SELECT role.oid INTO runtime_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';
  SELECT role.oid INTO staff_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_staff_read_runtime';
  SELECT role.oid INTO owner_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;

  IF runtime_oid IS NULL OR staff_oid IS NULL OR owner_oid IS NULL THEN
    RAISE EXCEPTION 'Commission activation roles are missing';
  END IF;

  FOR role_state IN
    SELECT role.rolname, role.rolsuper, role.rolinherit, role.rolcanlogin,
           role.rolcreatedb, role.rolcreaterole, role.rolreplication,
           role.rolbypassrls
      FROM pg_catalog.pg_roles AS role
     WHERE role.oid IN (runtime_oid, staff_oid)
  LOOP
    IF role_state.rolsuper
       OR role_state.rolinherit
       OR NOT role_state.rolcanlogin
       OR role_state.rolcreatedb
       OR role_state.rolcreaterole
       OR role_state.rolreplication
       OR role_state.rolbypassrls THEN
      RAISE EXCEPTION
        'Commission restricted role posture is unsafe: %', role_state.rolname;
    END IF;
  END LOOP;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN ('CommissionRequest', 'CommissionInterest')
       AND relation.relkind = 'r'
       AND relation.relowner = owner_oid
  ) <> 2 OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles AS role
     WHERE role.oid = owner_oid
       AND (role.rolsuper OR role.rolbypassrls)
  ) THEN
    RAISE EXCEPTION
      'Commission activation requires both tables to share the bypass-capable owner';
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
    expected_columns := CASE relation_state.relname
      WHEN 'CommissionInterest' THEN ARRAY[
        'id', 'commissionRequestId', 'sellerProfileId', 'conversationId',
        'createdAt'
      ]::text[]
      WHEN 'CommissionRequest' THEN ARRAY[
        'id', 'buyerId', 'title', 'description', 'category',
        'budgetMinCents', 'budgetMaxCents', 'timeline',
        'referenceImageUrls', 'status', 'interestedCount', 'expiresAt',
        'createdAt', 'updatedAt', 'isNational', 'lat', 'lng',
        'radiusMeters', 'cityMetroId', 'metroId', 'buyerAccountActive',
        'buyerName', 'buyerImageUrl', 'buyerSellerCity', 'buyerSellerState'
      ]::text[]
      ELSE NULL
    END;

    IF expected_columns IS NULL OR (
      SELECT pg_catalog.array_agg(attribute.attname::text ORDER BY attribute.attnum)
        FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = relation_state.oid
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
    ) IS DISTINCT FROM expected_columns THEN
      RAISE EXCEPTION
        'Commission table column contract drifted: %', relation_state.relname;
    END IF;

    IF relation_state.relrowsecurity
       OR relation_state.relforcerowsecurity
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = relation_state.oid
       ) THEN
      RAISE EXCEPTION
        'Commission predecessor RLS posture drifted: %', relation_state.relname;
    END IF;

    IF NOT pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'SELECT')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'INSERT')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'UPDATE')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'DELETE')
       OR pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'TRUNCATE')
       OR pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'REFERENCES')
       OR pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'TRIGGER') THEN
      RAISE EXCEPTION
        'Commission runtime predecessor grants drifted: %', relation_state.relname;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM (VALUES
          ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
          ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
        ) AS privilege(name)
       WHERE pg_catalog.has_table_privilege(
         staff_oid, relation_state.oid, privilege.name
       ) OR pg_catalog.has_table_privilege(
         0, relation_state.oid, privilege.name
       )
    ) OR EXISTS (
      SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(
            relation_state.relacl,
            pg_catalog.acldefault('r', relation_state.relowner)
          )
        ) AS acl
       WHERE acl.grantee NOT IN (relation_state.relowner, runtime_oid)
    ) OR EXISTS (
      SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
        CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
       WHERE attribute.attrelid = relation_state.oid
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND acl.grantee <> relation_state.relowner
    ) THEN
      RAISE EXCEPTION
        'Commission non-owner predecessor authority drifted: %', relation_state.relname;
    END IF;
  END LOOP;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND (
         pg_catalog.strpos(procedure.prosrc, '"CommissionRequest"') > 0
         OR pg_catalog.strpos(procedure.prosrc, '"CommissionInterest"') > 0
       )
  ) <> 30 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_roles AS function_owner
        ON function_owner.oid = procedure.proowner
     WHERE namespace.nspname = 'public'
       AND (
         pg_catalog.strpos(procedure.prosrc, '"CommissionRequest"') > 0
         OR pg_catalog.strpos(procedure.prosrc, '"CommissionInterest"') > 0
       )
       AND (
         NOT procedure.prosecdef
         OR procedure.proconfig IS DISTINCT FROM
              ARRAY['search_path=pg_catalog']::text[]
         OR NOT (function_owner.rolsuper OR function_owner.rolbypassrls)
         OR pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE')
         OR pg_catalog.has_function_privilege(
              staff_oid, procedure.oid, 'EXECUTE'
            )
       )
  ) THEN
    RAISE EXCEPTION 'Commission retained function boundary drifted';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.oid = ANY(reviewed_preparation_functions)
       AND procedure.proowner = owner_oid
       AND procedure.prosecdef
       AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.has_function_privilege(
             runtime_oid, procedure.oid, 'EXECUTE'
           )
       AND NOT pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE')
       AND NOT pg_catalog.has_function_privilege(
                 staff_oid, procedure.oid, 'EXECUTE'
               )
  ) <> pg_catalog.cardinality(reviewed_preparation_functions) THEN
    RAISE EXCEPTION 'Commission preparation function catalog drifted';
  END IF;
END
$grainline_commission_domain_activation_preflight$;

REVOKE ALL PRIVILEGES ON TABLE
  public."CommissionRequest", public."CommissionInterest"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

ALTER TABLE public."CommissionRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionRequest" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionInterest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionInterest" FORCE ROW LEVEL SECURITY;

DO $grainline_commission_domain_activation_postflight$
DECLARE
  relation_state record;
BEGIN
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
    IF NOT relation_state.relrowsecurity
       OR NOT relation_state.relforcerowsecurity
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = relation_state.oid
       ) OR EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               relation_state.relacl,
               pg_catalog.acldefault('r', relation_state.relowner)
             )
           ) AS acl
          WHERE acl.grantee <> relation_state.relowner
       ) OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_attribute AS attribute
           CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
          WHERE attribute.attrelid = relation_state.oid
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND acl.grantee <> relation_state.relowner
       ) THEN
      RAISE EXCEPTION
        'Commission activation postflight drifted: %', relation_state.relname;
    END IF;
  END LOOP;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN ('CommissionRequest', 'CommissionInterest')
       AND relation.relrowsecurity
       AND relation.relforcerowsecurity
  ) <> 2 THEN
    RAISE EXCEPTION 'Commission activation did not reach policyless FORCE';
  END IF;
END
$grainline_commission_domain_activation_postflight$;

COMMIT;
