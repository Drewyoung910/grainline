-- Reviewed policyless UserEmailAddress ENABLE and direct-grant retirement.
-- Apply only through the exact-main, CI-bound Production workflow after the
-- compatible four-operation application and six-function catalog are live.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.user-email-address.rls.activation', 0)
);
LOCK TABLE public."UserEmailAddress" IN ACCESS EXCLUSIVE MODE;

DO $grainline_user_email_address_enable_preflight$
DECLARE
  table_owner oid;
  runtime_role oid;
  accepted_functions integer;
  actual_function_count integer;
  table_index_count integer;
  valid_table_index_count integer;
  accepted_supporting_indexes integer;
  duplicate_current_groups bigint;
  current_without_active_user bigint;
  active_user_without_current bigint;
  accepted_triggers integer;
  nonowner_table_acl_count integer;
  nonowner_column_acl_count integer;
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'UserEmailAddress ENABLE requires a direct owner session';
  END IF;

  SELECT role.oid INTO STRICT runtime_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime'
     AND role.rolcanlogin
     AND NOT role.rolsuper
     AND NOT role.rolinherit
     AND NOT role.rolbypassrls;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.member = runtime_role
  ) THEN
    RAISE EXCEPTION 'UserEmailAddress ENABLE runtime role inherits another role';
  END IF;

  SELECT class.relowner INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."UserEmailAddress"'::pg_catalog.regclass
     AND class.relkind = 'r';
  IF table_owner <> (
    SELECT role.oid
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  ) THEN
    RAISE EXCEPTION 'UserEmailAddress ENABLE table owner drifted';
  END IF;
  IF NOT (
    (
      current_user = 'neondb_owner'
      AND pg_catalog.current_database() = 'neondb'
      AND NOT (
        SELECT role.rolsuper
          FROM pg_catalog.pg_roles AS role
         WHERE role.oid = table_owner
      )
      AND (
        SELECT role.rolbypassrls
          FROM pg_catalog.pg_roles AS role
         WHERE role.oid = table_owner
      )
    )
    OR
    (
      current_user = 'ci'
      AND pg_catalog.current_database() = 'grainline_ci'
      AND (
        SELECT role.rolsuper
          FROM pg_catalog.pg_roles AS role
         WHERE role.oid = table_owner
      )
    )
  ) THEN
    RAISE EXCEPTION 'UserEmailAddress ENABLE owner boundary is unreviewed';
  END IF;

  IF (
    SELECT class.relrowsecurity OR class.relforcerowsecurity
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."UserEmailAddress"'::pg_catalog.regclass
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."UserEmailAddress"'::pg_catalog.regclass
  ) <> 0 THEN
    RAISE EXCEPTION 'UserEmailAddress ENABLE requires policyless RLS-off predecessor';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO nonowner_table_acl_count
    FROM pg_catalog.pg_class AS class
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
    ) AS acl
   WHERE class.oid = 'public."UserEmailAddress"'::pg_catalog.regclass
     AND acl.grantee <> class.relowner;
  SELECT pg_catalog.count(*)::integer INTO nonowner_column_acl_count
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
   WHERE attribute.attrelid = 'public."UserEmailAddress"'::pg_catalog.regclass
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND acl.grantee <> table_owner;
  IF nonowner_table_acl_count <> 4
     OR nonowner_column_acl_count <> 0
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."UserEmailAddress"', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."UserEmailAddress"', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."UserEmailAddress"', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."UserEmailAddress"', 'DELETE'
     ) THEN
    RAISE EXCEPTION 'UserEmailAddress ENABLE predecessor grants drifted';
  END IF;

  SELECT pg_catalog.count(*) INTO duplicate_current_groups
    FROM (
      SELECT address."userId"
        FROM public."UserEmailAddress" AS address
       WHERE address."isCurrent" = true
       GROUP BY address."userId"
      HAVING pg_catalog.count(*) > 1
    ) AS duplicate_group;
  SELECT pg_catalog.count(*) INTO current_without_active_user
    FROM public."UserEmailAddress" AS address
    LEFT JOIN public."User" AS account_user
      ON account_user.id = address."userId"
     AND account_user."deletedAt" IS NULL
     AND account_user.email = address.email
   WHERE address."isCurrent" = true
     AND account_user.id IS NULL;
  SELECT pg_catalog.count(*) INTO active_user_without_current
    FROM public."User" AS account_user
   WHERE account_user."deletedAt" IS NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public."UserEmailAddress" AS address
        WHERE address."userId" = account_user.id
          AND address."isCurrent" = true
          AND address.email = account_user.email
     );
  IF duplicate_current_groups <> 0
     OR current_without_active_user <> 0
     OR active_user_without_current <> 0 THEN
    RAISE EXCEPTION
      'UserEmailAddress ENABLE data posture drifted: duplicate=%, unmatched=%, missing=%',
      duplicate_current_groups,
      current_without_active_user,
      active_user_without_current;
  END IF;

  SELECT pg_catalog.count(*)::integer,
         pg_catalog.count(*) FILTER (
           WHERE index_row.indisvalid
             AND index_row.indisready
             AND index_row.indislive
         )::integer
    INTO table_index_count, valid_table_index_count
    FROM pg_catalog.pg_index AS index_row
   WHERE index_row.indrelid = 'public."UserEmailAddress"'::pg_catalog.regclass;
  SELECT pg_catalog.count(*)::integer INTO accepted_supporting_indexes
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = index_row.indexrelid
   WHERE (
     (
       index_class.relname = 'User_active_email_suppression_key_idx'
       AND index_row.indrelid = 'public."User"'::pg_catalog.regclass
       AND NOT index_row.indisunique
     ) OR (
       index_class.relname = 'UserEmailAddress_current_suppression_key_idx'
       AND index_row.indrelid = 'public."UserEmailAddress"'::pg_catalog.regclass
       AND NOT index_row.indisunique
     ) OR (
       index_class.relname = 'UserEmailAddress_one_current_per_user_key'
       AND index_row.indrelid = 'public."UserEmailAddress"'::pg_catalog.regclass
       AND index_row.indisunique
     )
   )
     AND index_row.indisvalid
     AND index_row.indisready
     AND index_row.indislive;
  IF table_index_count <> 6
     OR valid_table_index_count <> 6
     OR accepted_supporting_indexes <> 3 THEN
    RAISE EXCEPTION 'UserEmailAddress ENABLE index posture drifted';
  END IF;

  WITH expected(
    function_identity,
    source_md5,
    volatility,
    parallel_safety
  ) AS (
    VALUES
      ('public.grainline_case_account_deletion_redact(text)',
       'b9e24ec8efa43b689b357f4965f8e722', 'v', 'u'),
      ('public.grainline_message_redact_for_account_deletion(text)',
       'e19c1b6b5b3adf968df8e2acab8851df', 'v', 'u'),
      ('public.grainline_user_email_address_delete_for_current_user()',
       'd570b850599eafe3629aa8240fe8c6d7', 'v', 'u'),
      ('public.grainline_user_email_address_newer_current_claim(text[],timestamp)',
       '873863dc1595a6fa738c9f5f31e5cb0b', 's', 'u'),
      ('public.grainline_user_email_address_owner_rows()',
       'd8c04787918ab4aafa1b630757cca39c', 's', 'u'),
      ('public.grainline_user_email_address_sync(text,text,text)',
       '04d09b22c99b0ce62ef2acdc16167c20', 'v', 'u')
  )
  SELECT pg_catalog.count(*)::integer INTO accepted_functions
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
   WHERE namespace.nspname = 'public'
     AND language.lanname = 'plpgsql'
     AND procedure.prokind = 'f'
     AND procedure.proowner = table_owner
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.provolatile = expected.volatility
     AND procedure.proparallel = expected.parallel_safety
     AND COALESCE(procedure.proconfig, ARRAY[]::text[]) = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(procedure.prosrc) = expected.source_md5
     AND pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') = 0
     AND (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.grantee <> procedure.proowner
     ) = 1
     AND (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.grantee = runtime_role
          AND acl.privilege_type = 'EXECUTE'
          AND NOT acl.is_grantable
     ) = 1;
  SELECT pg_catalog.count(*)::integer INTO actual_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND pg_catalog.strpos(procedure.prosrc, '"UserEmailAddress"') > 0;
  IF accepted_functions <> 6 OR actual_function_count <> 6 THEN
    RAISE EXCEPTION
      'UserEmailAddress ENABLE function catalog drifted: accepted=%, actual=%',
      accepted_functions,
      actual_function_count;
  END IF;

  SELECT pg_catalog.count(*)::integer INTO accepted_triggers
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = trigger_row.tgfoid
   WHERE trigger_row.tgrelid = 'public."UserEmailAddress"'::pg_catalog.regclass
     AND trigger_row.tgisinternal
     AND trigger_row.tgenabled = 'O'
     AND procedure.proname IN ('RI_FKey_check_ins', 'RI_FKey_check_upd');
  IF accepted_triggers <> 2 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public."UserEmailAddress"'::pg_catalog.regclass
  ) <> 2 THEN
    RAISE EXCEPTION 'UserEmailAddress ENABLE trigger posture drifted';
  END IF;
END
$grainline_user_email_address_enable_preflight$;

REVOKE ALL PRIVILEGES ON TABLE public."UserEmailAddress"
  FROM PUBLIC, grainline_app_runtime;

ALTER TABLE public."UserEmailAddress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."UserEmailAddress" NO FORCE ROW LEVEL SECURITY;

DO $grainline_user_email_address_enable_postflight$
DECLARE
  nonowner_table_acl_count integer;
  nonowner_column_acl_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO nonowner_table_acl_count
    FROM pg_catalog.pg_class AS class
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
    ) AS acl
   WHERE class.oid = 'public."UserEmailAddress"'::pg_catalog.regclass
     AND acl.grantee <> class.relowner;
  SELECT pg_catalog.count(*)::integer INTO nonowner_column_acl_count
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
   WHERE attribute.attrelid = 'public."UserEmailAddress"'::pg_catalog.regclass
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND acl.grantee <> (
       SELECT class.relowner
         FROM pg_catalog.pg_class AS class
        WHERE class.oid = 'public."UserEmailAddress"'::pg_catalog.regclass
     );
  IF NOT (
    SELECT class.relrowsecurity AND NOT class.relforcerowsecurity
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."UserEmailAddress"'::pg_catalog.regclass
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."UserEmailAddress"'::pg_catalog.regclass
  ) <> 0
     OR nonowner_table_acl_count <> 0
     OR nonowner_column_acl_count <> 0
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."UserEmailAddress"', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."UserEmailAddress"', 'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."UserEmailAddress"', 'UPDATE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."UserEmailAddress"', 'DELETE'
     ) THEN
    RAISE EXCEPTION 'UserEmailAddress ENABLE postflight did not reach policyless zero-direct state';
  END IF;
END
$grainline_user_email_address_enable_postflight$;

COMMIT;
