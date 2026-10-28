BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.follow.rls.activation', 0)
);

-- Freeze only Follow. The relationship operations already serialize with the
-- shared user-pair advisory lock; taking User, SellerProfile or Block table
-- locks here would create an avoidable lock-order cycle with those operations.
LOCK TABLE public."Follow" IN ACCESS EXCLUSIVE MODE;

DO $grainline_follow_rls_preflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  current_role_oid oid;
  reviewed_function text;
  expected_source_md5 text;
  expected_volatility "char";
  expected_runtime_execute boolean;
  existing_privileges text[];
BEGIN
  SELECT oid INTO runtime_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  IF runtime_oid IS NULL THEN
    RAISE EXCEPTION 'grainline_app_runtime is missing';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles
     WHERE oid = runtime_oid
       AND (
         rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit
         OR rolreplication OR rolbypassrls
       )
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = runtime_oid
  ) THEN
    RAISE EXCEPTION 'grainline_app_runtime posture is unsafe';
  END IF;

  SELECT class.oid, class.relowner
    INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Follow'
     AND class.relkind = 'r';
  IF table_oid IS NULL THEN
    RAISE EXCEPTION 'public.Follow is missing';
  END IF;
  SELECT oid INTO current_role_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = current_user;
  IF table_owner IS DISTINCT FROM current_role_oid
     OR table_owner = runtime_oid THEN
    RAISE EXCEPTION 'Follow activation must run as the non-runtime table owner';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles
     WHERE oid = table_owner
       AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Follow owner must bypass RLS';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND (relrowsecurity OR relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'Follow predecessor RLS posture drifted';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
             attribute.attname::text || ':'
             || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
             || ':' || attribute.attnotnull::text
             ORDER BY attribute.attnum
           )
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) IS DISTINCT FROM ARRAY[
    'id:text:true',
    'followerId:text:true',
    'sellerProfileId:text:true',
    'createdAt:timestamp(3) without time zone:true'
  ]::text[] THEN
    RAISE EXCEPTION 'Follow columns drifted';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
             constraint_state.conname::text || ':'
             || constraint_state.contype::text || ':'
             || pg_catalog.pg_get_constraintdef(constraint_state.oid, true)
             ORDER BY constraint_state.conname
           )
      FROM pg_catalog.pg_constraint AS constraint_state
     WHERE constraint_state.conrelid = table_oid
       AND constraint_state.convalidated
  ) IS DISTINCT FROM ARRAY[
    'Follow_followerId_fkey:f:FOREIGN KEY ("followerId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE',
    'Follow_pkey:p:PRIMARY KEY (id)',
    'Follow_sellerProfileId_fkey:f:FOREIGN KEY ("sellerProfileId") REFERENCES "SellerProfile"(id) ON UPDATE CASCADE ON DELETE CASCADE'
  ]::text[] THEN
    RAISE EXCEPTION 'Follow constraints drifted';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
             index_class.relname::text || ':'
             || index_state.indisprimary::text || ':'
             || index_state.indisunique::text || ':'
             || pg_catalog.pg_get_indexdef(index_state.indexrelid)
             ORDER BY index_class.relname
           )
      FROM pg_catalog.pg_index AS index_state
      JOIN pg_catalog.pg_class AS index_class
        ON index_class.oid = index_state.indexrelid
     WHERE index_state.indrelid = table_oid
       AND index_state.indisvalid
       AND index_state.indisready
       AND NOT index_state.indisexclusion
       AND index_state.indpred IS NULL
       AND index_state.indexprs IS NULL
  ) IS DISTINCT FROM ARRAY[
    'Follow_followerId_idx:false:false:CREATE INDEX "Follow_followerId_idx" ON public."Follow" USING btree ("followerId")',
    'Follow_followerId_sellerProfileId_key:false:true:CREATE UNIQUE INDEX "Follow_followerId_sellerProfileId_key" ON public."Follow" USING btree ("followerId", "sellerProfileId")',
    'Follow_pkey:true:true:CREATE UNIQUE INDEX "Follow_pkey" ON public."Follow" USING btree (id)',
    'Follow_sellerProfileId_idx:false:false:CREATE INDEX "Follow_sellerProfileId_idx" ON public."Follow" USING btree ("sellerProfileId")'
  ]::text[] THEN
    RAISE EXCEPTION 'Follow indexes drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."Follow" AS relationship
      JOIN public."SellerProfile" AS seller
        ON seller.id = relationship."sellerProfileId"
     WHERE relationship."followerId" = seller."userId"
  ) THEN
    RAISE EXCEPTION 'Follow contains a self relationship';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public."Follow" AS relationship
      JOIN public."SellerProfile" AS seller
        ON seller.id = relationship."sellerProfileId"
      JOIN public."Block" AS blocked_pair
        ON (
          blocked_pair."blockerId" = relationship."followerId"
          AND blocked_pair."blockedId" = seller."userId"
        ) OR (
          blocked_pair."blockerId" = seller."userId"
          AND blocked_pair."blockedId" = relationship."followerId"
        )
  ) THEN
    RAISE EXCEPTION 'Follow contains a blocked relationship';
  END IF;

  FOR reviewed_function, expected_source_md5, expected_volatility,
      expected_runtime_execute IN
    SELECT expected.identity, expected.source_md5, expected.volatility,
           expected.runtime_execute
      FROM (VALUES
        ('public.grainline_follow_account_deletion_cleanup(text,text,bigint,uuid)', '20d0a97a9c79ea5f071b9401182624a0', 'v'::"char", true),
        ('public.grainline_follow_owner_outgoing_count()', 'a4e8d1fc10a4593b544b897ea8bc8443', 's'::"char", true),
        ('public.grainline_follow_owner_target_ids(integer)', '01a14940a6dd29f877828737b8f7635a', 's'::"char", true),
        ('public.grainline_follow_public_state_batch(text[])', '356fba4afac454f4d2bace4a02fadca7', 's'::"char", true),
        ('public.grainline_follow_seller_owner_incoming_count()', 'a413e9faf1a31784b151973b69a6a38d', 's'::"char", true),
        ('public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)', '974a228c0b6feb00564f107a858ff526', 'v'::"char", false),
        ('public.grainline_seller_actor_account_feed_cards(text[])', '566d9d330a5be2c09833f3a71c5b686d', 's'::"char", true),
        ('public.grainline_seller_owner_follow_export()', '7c86080194edaf57ee2dabbd5bc5278d', 's'::"char", true),
        ('public.grainline_seller_owner_following_count()', 'a3fe8257c06914f261184c52f506aa2a', 's'::"char", true),
        ('public.grainline_seller_owner_following_page(integer,integer)', '8bb4451e9188141401efb97fd1ec0d7b', 's'::"char", true),
        ('public.grainline_seller_public_follow_create(text,text)', 'd0693e5b81d867cd5673504522fcdf66', 'v'::"char", true),
        ('public.grainline_seller_public_follow_delete(text)', '5fc1ec6be1a21e574fb5f341be5f4fda', 'v'::"char", true),
        ('public.grainline_seller_public_follow_state(text)', 'a5ad09ee4c473aae420121567baec62e', 's'::"char", true),
        ('public.grainline_seller_public_metro_makers(text,boolean,integer)', 'b71ce80b7fc475ebcf58d284ddb0a617', 's'::"char", true),
        ('public.grainline_seller_public_similar_makers(text,integer)', 'befb22f0f5371a03804d884db7de40b6', 's'::"char", true),
        ('public.grainline_user_block_follow_cleanup(text)', '3a7518030c42294660ce9a8be79f24ee', 'v'::"char", true),
        ('public.grainline_user_follower_notification_page(text,text,integer)', '471b1caf9907d6d370ec1cb8ea5aa718', 's'::"char", true),
        ('public.grainline_user_owner_broadcast_follower_page(text,text,integer,boolean)', '0986f9362622c2c1e4caaf27ca083308', 's'::"char", true)
      ) AS expected(identity, source_md5, volatility, runtime_execute)
  LOOP
    IF pg_catalog.to_regprocedure(reviewed_function) IS NULL THEN
      RAISE EXCEPTION 'Follow reviewed function is missing: %', reviewed_function;
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
       WHERE procedure.oid = pg_catalog.to_regprocedure(reviewed_function)
         AND procedure.proowner = table_owner
         AND procedure.prosecdef
         AND procedure.prokind = 'f'
         AND procedure.provolatile = expected_volatility
         AND procedure.proparallel = 'u'
         AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND pg_catalog.md5(procedure.prosrc) = expected_source_md5
         AND (owner.rolsuper OR owner.rolbypassrls)
    ) OR pg_catalog.has_function_privilege(
      0, pg_catalog.to_regprocedure(reviewed_function), 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      'grainline_app_runtime',
      pg_catalog.to_regprocedure(reviewed_function),
      'EXECUTE'
    ) IS DISTINCT FROM expected_runtime_execute THEN
      RAISE EXCEPTION 'Follow reviewed function posture drifted: %', reviewed_function;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.prosrc LIKE '%public."Follow"%'
       AND procedure.oid <> ALL (ARRAY[
         pg_catalog.to_regprocedure('public.grainline_follow_account_deletion_cleanup(text,text,bigint,uuid)'),
         pg_catalog.to_regprocedure('public.grainline_follow_owner_outgoing_count()'),
         pg_catalog.to_regprocedure('public.grainline_follow_owner_target_ids(integer)'),
         pg_catalog.to_regprocedure('public.grainline_follow_public_state_batch(text[])'),
         pg_catalog.to_regprocedure('public.grainline_follow_seller_owner_incoming_count()'),
         pg_catalog.to_regprocedure('public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)'),
         pg_catalog.to_regprocedure('public.grainline_seller_actor_account_feed_cards(text[])'),
         pg_catalog.to_regprocedure('public.grainline_seller_owner_follow_export()'),
         pg_catalog.to_regprocedure('public.grainline_seller_owner_following_count()'),
         pg_catalog.to_regprocedure('public.grainline_seller_owner_following_page(integer,integer)'),
         pg_catalog.to_regprocedure('public.grainline_seller_public_follow_create(text,text)'),
         pg_catalog.to_regprocedure('public.grainline_seller_public_follow_delete(text)'),
         pg_catalog.to_regprocedure('public.grainline_seller_public_follow_state(text)'),
         pg_catalog.to_regprocedure('public.grainline_seller_public_metro_makers(text,boolean,integer)'),
         pg_catalog.to_regprocedure('public.grainline_seller_public_similar_makers(text,integer)'),
         pg_catalog.to_regprocedure('public.grainline_user_block_follow_cleanup(text)'),
         pg_catalog.to_regprocedure('public.grainline_user_follower_notification_page(text,text,integer)'),
         pg_catalog.to_regprocedure('public.grainline_user_owner_broadcast_follower_page(text,text,integer,boolean)')
       ]::oid[])
  ) THEN
    RAISE EXCEPTION 'Follow has an unreviewed function reader';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(
             DISTINCT pg_catalog.upper(acl.privilege_type)
             ORDER BY pg_catalog.upper(acl.privilege_type)
           ),
           ARRAY[]::text[]
         )
    INTO existing_privileges
    FROM pg_catalog.aclexplode(
      COALESCE(
        (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
        pg_catalog.acldefault('r', table_owner)
      )
    ) AS acl
   WHERE acl.grantee = runtime_oid;
  IF existing_privileges IS DISTINCT FROM
       ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[] THEN
    RAISE EXCEPTION 'Follow runtime predecessor grants drifted';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(
          (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
          pg_catalog.acldefault('r', table_owner)
        )
      ) AS acl
     WHERE acl.grantee NOT IN (table_owner, runtime_oid)
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'Follow unexpected ACL drifted';
  END IF;
END
$grainline_follow_rls_preflight$;

REVOKE ALL ON TABLE public."Follow"
  FROM PUBLIC, grainline_app_runtime;

ALTER TABLE public."Follow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Follow" FORCE ROW LEVEL SECURITY;

DO $grainline_follow_rls_postflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  reviewed_function text;
  expected_source_md5 text;
  expected_volatility "char";
  expected_runtime_execute boolean;
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
     AND class.relname = 'Follow'
     AND class.relkind = 'r';

  IF table_oid IS NULL OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND relrowsecurity
       AND relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'Follow policyless ENABLE/FORCE did not persist';
  END IF;

  IF pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'SELECT'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'INSERT'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'UPDATE'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'DELETE'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'TRUNCATE'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'REFERENCES'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'TRIGGER'
     ) THEN
    RAISE EXCEPTION 'Follow runtime table authority remains';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(
          (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
          pg_catalog.acldefault('r', table_owner)
        )
      ) AS acl
     WHERE acl.grantee <> table_owner
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'Follow table ACL drifted';
  END IF;

  FOR reviewed_function, expected_source_md5, expected_volatility,
      expected_runtime_execute IN
    SELECT expected.identity, expected.source_md5, expected.volatility,
           expected.runtime_execute
      FROM (VALUES
        ('public.grainline_follow_account_deletion_cleanup(text,text,bigint,uuid)', '20d0a97a9c79ea5f071b9401182624a0', 'v'::"char", true),
        ('public.grainline_follow_owner_outgoing_count()', 'a4e8d1fc10a4593b544b897ea8bc8443', 's'::"char", true),
        ('public.grainline_follow_owner_target_ids(integer)', '01a14940a6dd29f877828737b8f7635a', 's'::"char", true),
        ('public.grainline_follow_public_state_batch(text[])', '356fba4afac454f4d2bace4a02fadca7', 's'::"char", true),
        ('public.grainline_follow_seller_owner_incoming_count()', 'a413e9faf1a31784b151973b69a6a38d', 's'::"char", true),
        ('public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)', '974a228c0b6feb00564f107a858ff526', 'v'::"char", false),
        ('public.grainline_seller_actor_account_feed_cards(text[])', '566d9d330a5be2c09833f3a71c5b686d', 's'::"char", true),
        ('public.grainline_seller_owner_follow_export()', '7c86080194edaf57ee2dabbd5bc5278d', 's'::"char", true),
        ('public.grainline_seller_owner_following_count()', 'a3fe8257c06914f261184c52f506aa2a', 's'::"char", true),
        ('public.grainline_seller_owner_following_page(integer,integer)', '8bb4451e9188141401efb97fd1ec0d7b', 's'::"char", true),
        ('public.grainline_seller_public_follow_create(text,text)', 'd0693e5b81d867cd5673504522fcdf66', 'v'::"char", true),
        ('public.grainline_seller_public_follow_delete(text)', '5fc1ec6be1a21e574fb5f341be5f4fda', 'v'::"char", true),
        ('public.grainline_seller_public_follow_state(text)', 'a5ad09ee4c473aae420121567baec62e', 's'::"char", true),
        ('public.grainline_seller_public_metro_makers(text,boolean,integer)', 'b71ce80b7fc475ebcf58d284ddb0a617', 's'::"char", true),
        ('public.grainline_seller_public_similar_makers(text,integer)', 'befb22f0f5371a03804d884db7de40b6', 's'::"char", true),
        ('public.grainline_user_block_follow_cleanup(text)', '3a7518030c42294660ce9a8be79f24ee', 'v'::"char", true),
        ('public.grainline_user_follower_notification_page(text,text,integer)', '471b1caf9907d6d370ec1cb8ea5aa718', 's'::"char", true),
        ('public.grainline_user_owner_broadcast_follower_page(text,text,integer,boolean)', '0986f9362622c2c1e4caaf27ca083308', 's'::"char", true)
      ) AS expected(identity, source_md5, volatility, runtime_execute)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
       WHERE procedure.oid = pg_catalog.to_regprocedure(reviewed_function)
         AND procedure.proowner = table_owner
         AND procedure.prosecdef
         AND procedure.prokind = 'f'
         AND procedure.provolatile = expected_volatility
         AND procedure.proparallel = 'u'
         AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND pg_catalog.md5(procedure.prosrc) = expected_source_md5
         AND (owner.rolsuper OR owner.rolbypassrls)
    ) OR pg_catalog.has_function_privilege(
      0, pg_catalog.to_regprocedure(reviewed_function), 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      'grainline_app_runtime',
      pg_catalog.to_regprocedure(reviewed_function),
      'EXECUTE'
    ) IS DISTINCT FROM expected_runtime_execute THEN
      RAISE EXCEPTION 'Follow function posture drifted: %', reviewed_function;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.prosrc LIKE '%public."Follow"%'
       AND procedure.oid <> ALL (ARRAY[
         pg_catalog.to_regprocedure('public.grainline_follow_account_deletion_cleanup(text,text,bigint,uuid)'),
         pg_catalog.to_regprocedure('public.grainline_follow_owner_outgoing_count()'),
         pg_catalog.to_regprocedure('public.grainline_follow_owner_target_ids(integer)'),
         pg_catalog.to_regprocedure('public.grainline_follow_public_state_batch(text[])'),
         pg_catalog.to_regprocedure('public.grainline_follow_seller_owner_incoming_count()'),
         pg_catalog.to_regprocedure('public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)'),
         pg_catalog.to_regprocedure('public.grainline_seller_actor_account_feed_cards(text[])'),
         pg_catalog.to_regprocedure('public.grainline_seller_owner_follow_export()'),
         pg_catalog.to_regprocedure('public.grainline_seller_owner_following_count()'),
         pg_catalog.to_regprocedure('public.grainline_seller_owner_following_page(integer,integer)'),
         pg_catalog.to_regprocedure('public.grainline_seller_public_follow_create(text,text)'),
         pg_catalog.to_regprocedure('public.grainline_seller_public_follow_delete(text)'),
         pg_catalog.to_regprocedure('public.grainline_seller_public_follow_state(text)'),
         pg_catalog.to_regprocedure('public.grainline_seller_public_metro_makers(text,boolean,integer)'),
         pg_catalog.to_regprocedure('public.grainline_seller_public_similar_makers(text,integer)'),
         pg_catalog.to_regprocedure('public.grainline_user_block_follow_cleanup(text)'),
         pg_catalog.to_regprocedure('public.grainline_user_follower_notification_page(text,text,integer)'),
         pg_catalog.to_regprocedure('public.grainline_user_owner_broadcast_follower_page(text,text,integer,boolean)')
       ]::oid[])
  ) THEN
    RAISE EXCEPTION 'Follow has an unreviewed function reader after activation';
  END IF;
END
$grainline_follow_rls_postflight$;

COMMIT;
