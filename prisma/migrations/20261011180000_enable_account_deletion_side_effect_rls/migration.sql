-- AccountDeletionSideEffect Phase A activation. The separately authenticated
-- worker role retains the ledger's bounded CRUD surface while the ordinary
-- application role loses direct row access. FORCE RLS remains a later,
-- posture-only decision after live proof and soak.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.account-deletion-side-effect.rls.activation',
    0
  )
);

LOCK TABLE public."AccountDeletionSideEffect" IN ACCESS EXCLUSIVE MODE;

DO $grainline_account_deletion_side_effect_activation_preflight$
DECLARE
  table_owner oid;
  table_rls boolean;
  table_force boolean;
  migration_role record;
  candidate_role record;
  policy_count integer;
  direct_column_acl_count integer;
  required_index_count integer;
  required_constraint_count integer;
  invalid_row_count bigint;
  required_function_count integer;
BEGIN
  SELECT class.relowner, class.relrowsecurity, class.relforcerowsecurity
    INTO STRICT table_owner, table_rls, table_force
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'AccountDeletionSideEffect'
     AND class.relkind = 'r';

  IF table_owner IS DISTINCT FROM (
    SELECT role.oid
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  ) THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect activation requires the table owner session';
  END IF;

  SELECT role.rolsuper, role.rolbypassrls
    INTO migration_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND OR NOT (migration_role.rolsuper OR migration_role.rolbypassrls) THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect owner must bypass later FORCE RLS';
  END IF;

  FOR candidate_role IN
    SELECT role.rolname, role.rolsuper, role.rolinherit, role.rolcanlogin,
           role.rolcreatedb, role.rolcreaterole, role.rolreplication,
           role.rolbypassrls
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname IN (
       'grainline_app_runtime',
       'grainline_account_deletion_runtime'
     )
  LOOP
    IF candidate_role.rolsuper
       OR candidate_role.rolinherit
       OR NOT candidate_role.rolcanlogin
       OR candidate_role.rolcreatedb
       OR candidate_role.rolcreaterole
       OR candidate_role.rolreplication
       OR candidate_role.rolbypassrls THEN
      RAISE EXCEPTION
        '% role posture is not AccountDeletionSideEffect-safe',
        candidate_role.rolname;
    END IF;
  END LOOP;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname IN (
       'grainline_app_runtime',
       'grainline_account_deletion_runtime'
     )
  ) <> 2 THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect activation requires both reviewed LOGIN roles';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = membership.roleid
      JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = membership.grantor
     WHERE (
       member.rolname IN (
         'grainline_app_runtime',
         'grainline_account_deletion_runtime'
       )
       OR granted_role.rolname IN (
         'grainline_app_runtime',
         'grainline_account_deletion_runtime'
       )
     )
       AND NOT (
         granted_role.rolname IN (
           'grainline_app_runtime',
           'grainline_account_deletion_runtime'
         )
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
       WHERE parent.rolname IN (
         'grainline_app_runtime',
         'grainline_account_deletion_runtime'
       )
      UNION
      SELECT child.oid, child.rolname
        FROM restricted_members AS parent
        JOIN pg_catalog.pg_auth_members AS membership
          ON membership.roleid = parent.oid
        JOIN pg_catalog.pg_roles AS child ON child.oid = membership.member
    )
    SELECT 1
      FROM restricted_members
     WHERE rolname <> 'neondb_owner'
  ) THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect roles retain unreviewed membership';
  END IF;

  IF table_rls OR table_force THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect activation requires the compatible predecessor';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
   WHERE policy.polrelid =
         'public."AccountDeletionSideEffect"'::pg_catalog.regclass;
  IF policy_count <> 0 THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect activation requires zero predecessor policies';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       'public."AccountDeletionSideEffect"',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       'public."AccountDeletionSideEffect"',
       'TRUNCATE,REFERENCES,TRIGGER'
     ) THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect predecessor runtime grants drifted';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_account_deletion_runtime',
       'public."AccountDeletionSideEffect"',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_account_deletion_runtime',
       'public."AccountDeletionSideEffect"',
       'TRUNCATE,REFERENCES,TRIGGER'
     ) THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect prepared worker table grants drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO direct_column_acl_count
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
   WHERE attribute.attrelid =
         'public."AccountDeletionSideEffect"'::pg_catalog.regclass
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND acl.grantee IN (
       0,
       (SELECT role.oid FROM pg_catalog.pg_roles AS role
         WHERE role.rolname = 'grainline_app_runtime'),
       (SELECT role.oid FROM pg_catalog.pg_roles AS role
         WHERE role.rolname = 'grainline_account_deletion_runtime')
     )
     AND acl.privilege_type IN (
       'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
     );
  IF direct_column_acl_count <> 0 THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect predecessor column ACLs drifted: %',
      direct_column_acl_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO required_constraint_count
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid =
         'public."AccountDeletionSideEffect"'::pg_catalog.regclass
     AND constraint_row.conname IN (
       'AccountDeletionSideEffect_claimGeneration_check',
       'AccountDeletionSideEffect_attempts_check'
     )
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated;
  IF required_constraint_count <> 2 THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect validated constraints drifted: %',
      required_constraint_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO required_index_count
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = index_row.indexrelid
   WHERE index_row.indrelid =
         'public."AccountDeletionSideEffect"'::pg_catalog.regclass
     AND index_class.relname IN (
       'AccountDeletionSideEffect_pkey',
       'AccountDeletionSideEffect_dedupKey_key',
       'AccountDeletionSideEffect_status_nextAttemptAt_idx',
       'AccountDeletionSideEffect_status_processingStartedAt_idx',
       'AccountDeletionSideEffect_status_processedAt_idx',
       'AccountDeletionSideEffect_userId_kind_idx'
     )
     AND index_row.indisvalid
     AND index_row.indisready;
  IF required_index_count <> 6 THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect required indexes drifted: %',
      required_index_count;
  END IF;

  SELECT pg_catalog.count(*)
    INTO invalid_row_count
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.kind NOT IN (
       'LOCAL_ANONYMIZE', 'STRIPE_REJECT', 'MEDIA_DELETE', 'AUDIT_REDACT'
     )
      OR effect.status NOT IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED')
      OR effect.attempts < 0
      OR effect."claimGeneration" < 0
      OR (
        effect.status = 'PROCESSING'
        AND (
          effect."claimGeneration" < 1
          OR effect."claimToken" IS NULL
          OR effect."processingStartedAt" IS NULL
        )
      )
      OR (
        effect.status = 'DONE'
        AND effect."processedAt" IS NULL
      )
      OR (
        effect.kind = 'LOCAL_ANONYMIZE'
        AND (
          effect."dedupKey" <> 'account-delete:local:' || effect."userId"
          OR effect.payload <> '{}'::jsonb
        )
      );
  IF invalid_row_count <> 0 THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect activation found invalid rows: %',
      invalid_row_count;
  END IF;

  WITH required(function_signature) AS (
    VALUES
      ('public."grainline_account_deletion_side_effect_claim"(text)'),
      ('public."grainline_account_deletion_side_effect_complete"(text,bigint,uuid)'),
      ('public."grainline_account_deletion_side_effect_fail"(text,bigint,uuid,text)'),
      ('public."grainline_account_deletion_media_enqueue_claimed"(text,bigint,uuid,text[])'),
      ('public."grainline_account_deletion_claim_user"(text,bigint,uuid)'),
      ('public."grainline_user_account_deletion_preflight"(text,bigint,uuid)'),
      ('public."grainline_user_account_deletion_snapshot"(text,bigint,uuid)'),
      ('public."grainline_user_account_deletion_finalize"(text,bigint,uuid)'),
      ('public."grainline_case_account_deletion_redact"(text,bigint,uuid)'),
      ('public."grainline_message_redact_for_account_deletion"(text,text,bigint,uuid)'),
      ('public."grainline_order_account_deletion_scrub"(text,text,bigint,uuid,text[])')
  )
  SELECT pg_catalog.count(*)::integer
    INTO required_function_count
    FROM required
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(required.function_signature)
   WHERE procedure.prokind = 'f'
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND procedure.proconfig IS NOT DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
     AND procedure.proowner = table_owner;
  IF required_function_count <> 11 THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect fixed-function catalog drifted: %',
      required_function_count;
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'grainline_account_deletion_runtime',
       'public.grainline_account_deletion_side_effect_claim(text)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_account_deletion_runtime',
       'public.grainline_account_deletion_side_effect_complete(text,bigint,uuid)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_account_deletion_runtime',
       'public.grainline_account_deletion_side_effect_fail(text,bigint,uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect prepared worker function grants drifted';
  END IF;
END
$grainline_account_deletion_side_effect_activation_preflight$;

ALTER TABLE public."AccountDeletionSideEffect" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AccountDeletionSideEffect" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."AccountDeletionSideEffect"
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;

CREATE POLICY "AccountDeletionSideEffect_account_deletion_runtime_all"
  ON public."AccountDeletionSideEffect"
  FOR ALL
  TO grainline_account_deletion_runtime
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."AccountDeletionSideEffect"
  TO grainline_account_deletion_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_account_deletion_side_effect_claim(text)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_account_deletion_side_effect_complete(text, bigint, uuid)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_account_deletion_side_effect_fail(text, bigint, uuid, text)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_account_deletion_side_effect_claim(text)
  TO grainline_account_deletion_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_account_deletion_side_effect_complete(text, bigint, uuid)
  TO grainline_account_deletion_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_account_deletion_side_effect_fail(text, bigint, uuid, text)
  TO grainline_account_deletion_runtime;

-- Old application instances are drained before this migration. Retire every
-- unbound destructive helper at the same boundary that removes ordinary table
-- and claim-lifecycle authority.
REVOKE ALL ON FUNCTION public.grainline_user_account_deletion_preflight(text)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_account_deletion_snapshot(text)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_account_deletion_finalize(text)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION public.grainline_case_account_deletion_redact(text)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION public.grainline_message_redact_for_account_deletion(text)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_account_deletion_scrub(text, text[])
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;

DO $grainline_account_deletion_side_effect_activation_postflight$
DECLARE
  accepted_table_count integer;
  accepted_function_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'AccountDeletionSideEffect'
     AND class.relkind = 'r'
     AND class.relrowsecurity
     AND NOT class.relforcerowsecurity
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND pg_catalog.has_table_privilege(
       'grainline_account_deletion_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE'
     )
     AND NOT pg_catalog.has_table_privilege(
       'grainline_account_deletion_runtime', class.oid,
       'TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'DELETE',
            'TRUNCATE', 'REFERENCES', 'TRIGGER'
          )
     )
     AND (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
          AND policy.polname =
              'AccountDeletionSideEffect_account_deletion_runtime_all'
          AND policy.polcmd = '*'
          AND policy.polpermissive
          AND policy.polroles = ARRAY[
            (SELECT role.oid
               FROM pg_catalog.pg_roles AS role
              WHERE role.rolname = 'grainline_account_deletion_runtime')
          ]::oid[]
          AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) = 'true'
          AND pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) = 'true'
     ) = 1;
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect activation did not establish exact table posture';
  END IF;

  WITH expected(function_signature, runtime_execute, worker_execute) AS (
    VALUES
      ('public."grainline_account_deletion_side_effect_claim"(text)', false, true),
      ('public."grainline_account_deletion_side_effect_complete"(text,bigint,uuid)', false, true),
      ('public."grainline_account_deletion_side_effect_fail"(text,bigint,uuid,text)', false, true),
      ('public."grainline_account_deletion_media_enqueue_claimed"(text,bigint,uuid,text[])', true, false),
      ('public."grainline_account_deletion_claim_user"(text,bigint,uuid)', false, false),
      ('public."grainline_user_account_deletion_preflight"(text,bigint,uuid)', true, false),
      ('public."grainline_user_account_deletion_snapshot"(text,bigint,uuid)', true, false),
      ('public."grainline_user_account_deletion_finalize"(text,bigint,uuid)', true, false),
      ('public."grainline_case_account_deletion_redact"(text,bigint,uuid)', true, false),
      ('public."grainline_message_redact_for_account_deletion"(text,text,bigint,uuid)', true, false),
      ('public."grainline_order_account_deletion_scrub"(text,text,bigint,uuid,text[])', true, false)
      ,('public."grainline_user_account_deletion_preflight"(text)', false, false)
      ,('public."grainline_user_account_deletion_snapshot"(text)', false, false)
      ,('public."grainline_user_account_deletion_finalize"(text)', false, false)
      ,('public."grainline_case_account_deletion_redact"(text)', false, false)
      ,('public."grainline_message_redact_for_account_deletion"(text)', false, false)
      ,('public."grainline_order_account_deletion_scrub"(text,text[])', false, false)
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_function_count
    FROM expected
   WHERE pg_catalog.has_function_privilege(
           'grainline_app_runtime',
           pg_catalog.to_regprocedure(function_signature),
           'EXECUTE'
         ) = runtime_execute
     AND pg_catalog.has_function_privilege(
           'grainline_account_deletion_runtime',
           pg_catalog.to_regprocedure(function_signature),
           'EXECUTE'
         ) = worker_execute
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS procedure
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE procedure.oid =
              pg_catalog.to_regprocedure(function_signature)
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     );
  IF accepted_function_count <> 17 THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect activation did not establish exact function posture: %',
      accepted_function_count;
  END IF;
END
$grainline_account_deletion_side_effect_activation_postflight$;

COMMIT;
