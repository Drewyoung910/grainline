-- Policyless activation for the coupled CommissionRequest and
-- CommissionInterest authority boundary. The fixed-operation application must
-- already be live and predecessor traffic drained before this migration runs.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.commission-domain.rls.activation', 0)
);

LOCK TABLE public."CommissionInterest", public."CommissionRequest"
  IN ACCESS EXCLUSIVE MODE;

DO $grainline_commission_domain_activation_preflight$
DECLARE
  runtime_oid oid;
  staff_oid oid;
  owner_oid oid;
  relation_state record;
  expected_columns text[];
  expected_constraints text[];
  expected_indexes text[];
  existing_privileges text[];
  reviewed_operations regprocedure[] := ARRAY[
    'public.grainline_commission_request_public_count(text,text,text,double precision,double precision,integer)',
    'public.grainline_commission_request_public_page(text,text,text,double precision,double precision,integer,integer,integer)',
    'public.grainline_commission_request_public_detail(text)',
    'public.grainline_commission_request_public_sitemap_page(integer,integer)',
    'public.grainline_commission_request_public_metro_ids()',
    'public.grainline_commission_interest_actor_request_ids(text[])',
    'public.grainline_commission_interest_actor_create(text,text,text,text)',
    'public.grainline_commission_request_owner_create(text,text,text,text,integer,integer,text,text[],boolean,double precision,double precision,integer)',
    'public.grainline_commission_request_owner_assign_metros(text,text,text)',
    'public.grainline_commission_request_owner_page(integer)',
    'public.grainline_commission_request_owner_export()',
    'public.grainline_commission_request_owner_active_count()',
    'public.grainline_commission_request_owner_reference_image_urls()',
    'public.grainline_commission_interest_owner_export()',
    'public.grainline_seller_owner_commission_interest_summaries(text[],integer)',
    'public.grainline_commission_request_owner_transition(text,text)',
    'public.grainline_commission_account_deletion_prepare(text,bigint,uuid)',
    'public.grainline_commission_account_deletion_redact(text,bigint,uuid)',
    'public.grainline_commission_request_staff_ban_close(text,text)',
    'public.grainline_commission_request_staff_ban_restore(text,text,text[],text[])',
    'public.grainline_commission_request_service_expire_batch(integer)',
    'public.grainline_commission_request_service_expired_count()'
  ]::regprocedure[];
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
    RAISE EXCEPTION 'Commission restricted role posture is unsafe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE oid = owner_oid AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Commission owner must bypass RLS';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM public._prisma_migrations
     WHERE migration_name = '20261113010000_prepare_commission_domain_authorities'
       AND checksum = 'a189c1114e11df5ae2e57370faeac80da76adbf8fc8cc2bedc31270dea15774c'
       AND finished_at IS NOT NULL
       AND rolled_back_at IS NULL
       AND applied_steps_count = 1
  ) <> 1 OR EXISTS (
    SELECT 1 FROM public._prisma_migrations
     WHERE migration_name = '20261113010000_prepare_commission_domain_authorities'
       AND NOT (
         checksum = 'a189c1114e11df5ae2e57370faeac80da76adbf8fc8cc2bedc31270dea15774c'
         AND finished_at IS NOT NULL
         AND rolled_back_at IS NULL
         AND applied_steps_count = 1
       )
  ) THEN
    RAISE EXCEPTION 'Commission preparation ledger drifted';
  END IF;

  FOR relation_state IN
    SELECT relation.oid, relation.relname, relation.relowner,
           relation.relrowsecurity, relation.relforcerowsecurity,
           relation.relacl
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN ('CommissionInterest', 'CommissionRequest')
       AND relation.relkind = 'r'
     ORDER BY relation.relname
  LOOP
    IF relation_state.relowner <> owner_oid
       OR relation_state.relrowsecurity
       OR relation_state.relforcerowsecurity
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy
          WHERE polrelid = relation_state.oid
       ) THEN
      RAISE EXCEPTION 'Commission predecessor posture drifted: %', relation_state.relname;
    END IF;

    expected_columns := CASE relation_state.relname
      WHEN 'CommissionInterest' THEN ARRAY[
        'id:text:true',
        'commissionRequestId:text:true',
        'sellerProfileId:text:true',
        'conversationId:text:false',
        'createdAt:timestamp(3) without time zone:true'
      ]::text[]
      WHEN 'CommissionRequest' THEN ARRAY[
        'id:text:true',
        'buyerId:text:true',
        'title:character varying(150):true',
        'description:character varying(5000):true',
        'category:"Category":false',
        'budgetMinCents:integer:false',
        'budgetMaxCents:integer:false',
        'timeline:character varying(200):false',
        'referenceImageUrls:text[]:false',
        'status:"CommissionStatus":true',
        'interestedCount:integer:true',
        'expiresAt:timestamp(3) without time zone:false',
        'createdAt:timestamp(3) without time zone:true',
        'updatedAt:timestamp(3) without time zone:true',
        'isNational:boolean:true',
        'lat:double precision:false',
        'lng:double precision:false',
        'radiusMeters:integer:false',
        'cityMetroId:text:false',
        'metroId:text:false',
        'buyerAccountActive:boolean:true',
        'buyerName:character varying(100):false',
        'buyerImageUrl:character varying(2048):false',
        'buyerSellerCity:character varying(100):false',
        'buyerSellerState:character varying(50):false'
      ]::text[]
      ELSE NULL
    END;
    IF expected_columns IS NULL OR (
      SELECT pg_catalog.array_agg(
        attribute.attname::text || ':'
        || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
        || ':' || attribute.attnotnull::text
        ORDER BY attribute.attnum
      )
        FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = relation_state.oid
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
    ) IS DISTINCT FROM expected_columns THEN
      RAISE EXCEPTION 'Commission column contract drifted: %', relation_state.relname;
    END IF;

    expected_constraints := CASE relation_state.relname
      WHEN 'CommissionInterest' THEN ARRAY[
        'CommissionInterest_commissionRequestId_fkey:f:FOREIGN KEY ("commissionRequestId") REFERENCES "CommissionRequest"(id) ON UPDATE CASCADE ON DELETE CASCADE',
        'CommissionInterest_conversationId_fkey:f:FOREIGN KEY ("conversationId") REFERENCES "Conversation"(id) ON UPDATE CASCADE ON DELETE SET NULL',
        'CommissionInterest_pkey:p:PRIMARY KEY (id)',
        'CommissionInterest_sellerProfileId_fkey:f:FOREIGN KEY ("sellerProfileId") REFERENCES "SellerProfile"(id) ON UPDATE CASCADE ON DELETE CASCADE'
      ]::text[]
      WHEN 'CommissionRequest' THEN ARRAY[
        'CommissionRequest_budget_valid_chk:c:CHECK (("budgetMinCents" IS NULL OR "budgetMinCents" >= 0 AND "budgetMinCents" <= 10000000) AND ("budgetMaxCents" IS NULL OR "budgetMaxCents" >= 0 AND "budgetMaxCents" <= 10000000) AND ("budgetMinCents" IS NULL OR "budgetMaxCents" IS NULL OR "budgetMinCents" <= "budgetMaxCents"))',
        'CommissionRequest_buyerId_fkey:f:FOREIGN KEY ("buyerId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT',
        'CommissionRequest_cityMetroId_fkey:f:FOREIGN KEY ("cityMetroId") REFERENCES "Metro"(id) ON UPDATE CASCADE ON DELETE SET NULL',
        'CommissionRequest_metroId_fkey:f:FOREIGN KEY ("metroId") REFERENCES "Metro"(id) ON UPDATE CASCADE ON DELETE SET NULL',
        'CommissionRequest_pkey:p:PRIMARY KEY (id)',
        'CommissionRequest_radiusMeters_range_chk:c:CHECK ("radiusMeters" IS NULL OR "radiusMeters" >= 0 AND "radiusMeters" <= 804672)'
      ]::text[]
      ELSE NULL
    END;
    IF (
      SELECT pg_catalog.array_agg(
        constraint_state.conname::text || ':' || constraint_state.contype::text
        || ':' || pg_catalog.pg_get_constraintdef(constraint_state.oid, true)
        ORDER BY constraint_state.conname
      )
        FROM pg_catalog.pg_constraint AS constraint_state
       WHERE constraint_state.conrelid = relation_state.oid
         AND constraint_state.convalidated
    ) IS DISTINCT FROM expected_constraints THEN
      RAISE EXCEPTION 'Commission constraint contract drifted: %', relation_state.relname;
    END IF;

    expected_indexes := CASE relation_state.relname
      WHEN 'CommissionInterest' THEN ARRAY[
        'CommissionInterest_commissionRequestId_sellerProfileId_key:false:true:CREATE UNIQUE INDEX "CommissionInterest_commissionRequestId_sellerProfileId_key" ON public."CommissionInterest" USING btree ("commissionRequestId", "sellerProfileId")',
        'CommissionInterest_conversationId_idx:false:false:CREATE INDEX "CommissionInterest_conversationId_idx" ON public."CommissionInterest" USING btree ("conversationId")',
        'CommissionInterest_pkey:true:true:CREATE UNIQUE INDEX "CommissionInterest_pkey" ON public."CommissionInterest" USING btree (id)',
        'CommissionInterest_sellerProfileId_idx:false:false:CREATE INDEX "CommissionInterest_sellerProfileId_idx" ON public."CommissionInterest" USING btree ("sellerProfileId")'
      ]::text[]
      WHEN 'CommissionRequest' THEN ARRAY[
        'CommissionRequest_buyerId_idx:false:false:CREATE INDEX "CommissionRequest_buyerId_idx" ON public."CommissionRequest" USING btree ("buyerId")',
        'CommissionRequest_category_idx:false:false:CREATE INDEX "CommissionRequest_category_idx" ON public."CommissionRequest" USING btree (category)',
        'CommissionRequest_cityMetroId_idx:false:false:CREATE INDEX "CommissionRequest_cityMetroId_idx" ON public."CommissionRequest" USING btree ("cityMetroId")',
        'CommissionRequest_metroId_idx:false:false:CREATE INDEX "CommissionRequest_metroId_idx" ON public."CommissionRequest" USING btree ("metroId")',
        'CommissionRequest_pkey:true:true:CREATE UNIQUE INDEX "CommissionRequest_pkey" ON public."CommissionRequest" USING btree (id)',
        'CommissionRequest_status_createdAt_idx:false:false:CREATE INDEX "CommissionRequest_status_createdAt_idx" ON public."CommissionRequest" USING btree (status, "createdAt")'
      ]::text[]
      ELSE NULL
    END;
    IF (
      SELECT pg_catalog.array_agg(
        index_relation.relname::text || ':' || index_state.indisprimary::text
        || ':' || index_state.indisunique::text || ':'
        || pg_catalog.pg_get_indexdef(index_state.indexrelid)
        ORDER BY index_relation.relname
      )
        FROM pg_catalog.pg_index AS index_state
        JOIN pg_catalog.pg_class AS index_relation
          ON index_relation.oid = index_state.indexrelid
       WHERE index_state.indrelid = relation_state.oid
         AND index_state.indisvalid AND index_state.indisready
         AND NOT index_state.indisexclusion
         AND index_state.indpred IS NULL AND index_state.indexprs IS NULL
    ) IS DISTINCT FROM expected_indexes THEN
      RAISE EXCEPTION 'Commission index contract drifted: %', relation_state.relname;
    END IF;

    SELECT COALESCE(pg_catalog.array_agg(
      DISTINCT pg_catalog.upper(acl.privilege_type)
      ORDER BY pg_catalog.upper(acl.privilege_type)
    ), ARRAY[]::text[])
      INTO existing_privileges
      FROM pg_catalog.aclexplode(COALESCE(
        relation_state.relacl,
        pg_catalog.acldefault('r', relation_state.relowner)
      )) AS acl
     WHERE acl.grantee = runtime_oid;
    IF existing_privileges IS DISTINCT FROM
         ARRAY['DELETE','INSERT','SELECT','UPDATE']::text[] THEN
      RAISE EXCEPTION 'Commission runtime predecessor grants drifted: %', relation_state.relname;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
        relation_state.relacl,
        pg_catalog.acldefault('r', relation_state.relowner)
      )) AS acl
       WHERE acl.grantee NOT IN (relation_state.relowner, runtime_oid)
    ) OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
      WHERE attribute.attrelid = relation_state.oid
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND acl.grantee <> relation_state.relowner
    ) THEN
      RAISE EXCEPTION 'Commission predecessor ACL drifted: %', relation_state.relname;
    END IF;
  END LOOP;
  IF NOT FOUND OR (
    SELECT pg_catalog.count(*) FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('CommissionInterest', 'CommissionRequest')
      AND relation.relkind = 'r'
  ) <> 2 THEN
    RAISE EXCEPTION 'Commission tables are missing';
  END IF;

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
  ) <> 29 OR EXISTS (
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
         procedure.proowner <> owner_oid
         OR NOT procedure.prosecdef
         OR procedure.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
         OR NOT (function_owner.rolsuper OR function_owner.rolbypassrls)
         OR pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE')
         OR pg_catalog.has_function_privilege(staff_oid, procedure.oid, 'EXECUTE')
       )
  ) THEN
    RAISE EXCEPTION 'Commission function boundary drifted';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = ANY(reviewed_operations)
       AND procedure.proowner = owner_oid
       AND procedure.prosecdef
       AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.has_function_privilege(runtime_oid, procedure.oid, 'EXECUTE')
       AND NOT pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE')
       AND NOT pg_catalog.has_function_privilege(staff_oid, procedure.oid, 'EXECUTE')
  ) <> pg_catalog.cardinality(reviewed_operations) THEN
    RAISE EXCEPTION 'Commission reviewed operation posture drifted';
  END IF;
END
$grainline_commission_domain_activation_preflight$;

REVOKE ALL PRIVILEGES ON TABLE
  public."CommissionInterest", public."CommissionRequest"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

ALTER TABLE public."CommissionInterest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionInterest" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionRequest" FORCE ROW LEVEL SECURITY;

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
       AND relation.relname IN ('CommissionInterest', 'CommissionRequest')
       AND relation.relkind = 'r'
     ORDER BY relation.relname
  LOOP
    IF NOT relation_state.relrowsecurity
       OR NOT relation_state.relforcerowsecurity
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = relation_state.oid
       ) OR EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
           relation_state.relacl,
           pg_catalog.acldefault('r', relation_state.relowner)
         )) AS acl
          WHERE acl.grantee <> relation_state.relowner
       ) OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
          WHERE attribute.attrelid = relation_state.oid
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND acl.grantee <> relation_state.relowner
       ) THEN
      RAISE EXCEPTION 'Commission activation postflight drifted: %', relation_state.relname;
    END IF;
  END LOOP;
  IF (
    SELECT pg_catalog.count(*) FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('CommissionInterest', 'CommissionRequest')
      AND relation.relrowsecurity AND relation.relforcerowsecurity
  ) <> 2 THEN
    RAISE EXCEPTION 'Commission activation did not reach policyless FORCE';
  END IF;
END
$grainline_commission_domain_activation_postflight$;

COMMIT;
