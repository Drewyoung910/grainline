-- DRAFT ONLY. Do not apply to any persistent database.
--
-- Compatible pre-activation convergence for the four Case projections that
-- were originally prepared as SECURITY INVOKER. The completed application
-- inventory has no ordinary direct Case-family table access. Converting these
-- already source-validating, bounded projections to SECURITY DEFINER lets the
-- later activation remove every runtime Case-family table grant and use zero
-- policies, instead of retaining a broad direct SELECT surface solely for
-- these four functions.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.case.rls.activation', 0)
);

DO $grainline_case_read_mode_preflight$
DECLARE
  case_owner oid;
  runtime_role_oid oid;
  function_count integer;
  expected record;
  function_oid oid;
  actual record;
BEGIN
  SELECT class.relowner
    INTO STRICT case_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Case'
     AND class.relkind = 'r';

  SELECT role.oid
    INTO STRICT runtime_role_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';

  SELECT pg_catalog.count(*)::integer
    INTO function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname IN (
       'grainline_case_get',
       'grainline_case_get_by_order',
       'grainline_case_staff_active_count',
       'grainline_case_export_page'
     );
  IF function_count <> 4 THEN
    RAISE EXCEPTION
      'Case read-mode function overload catalog drifted: %',
      function_count;
  END IF;

  FOR expected IN
    SELECT *
      FROM (
        VALUES
          (
            'grainline_case_get',
            'text,text',
            '39a2419d2643b2fb622f4ed47e887477'
          ),
          (
            'grainline_case_get_by_order',
            'text,text',
            '044733e1a1f15449a854a939eae715e4'
          ),
          (
            'grainline_case_staff_active_count',
            'text',
            'f63ba05d231445525f1eeff2b068dd4a'
          ),
          (
            'grainline_case_export_page',
            'text,timestamp without time zone,text,integer',
            '97b9478d9abeafe86db5f599049828d0'
          )
      ) AS expected_function(
        function_name,
        identity_arguments,
        source_md5
      )
  LOOP
    function_oid := pg_catalog.to_regprocedure(
      pg_catalog.format(
        'public.%I(%s)',
        expected.function_name,
        expected.identity_arguments
      )
    );
    IF function_oid IS NULL THEN
      RAISE EXCEPTION
        'Case read-mode function is missing: %',
        expected.function_name;
    END IF;

    SELECT
      procedure.prokind,
      procedure.prosecdef,
      procedure.proleakproof,
      procedure.provolatile,
      procedure.proparallel,
      procedure.proconfig,
      procedure.proowner,
      language.lanname AS language_name,
      procedure.prosrc,
      pg_catalog.has_function_privilege(
        'grainline_app_runtime',
        procedure.oid,
        'EXECUTE'
      ) AS runtime_execute,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
      ) AS public_execute,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.grantee = runtime_role_oid
           AND acl.privilege_type = 'EXECUTE'
      ) AS runtime_direct_execute,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.grantee = runtime_role_oid
           AND acl.privilege_type = 'EXECUTE'
           AND acl.is_grantable
      ) AS runtime_execute_grantable,
      (
        SELECT pg_catalog.count(*)::integer
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.grantee NOT IN (
           0,
           procedure.proowner,
           runtime_role_oid
         )
           AND acl.privilege_type = 'EXECUTE'
      ) AS other_role_execute_count
      INTO STRICT actual
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_language AS language
        ON language.oid = procedure.prolang
     WHERE procedure.oid = function_oid;

    IF actual.prokind IS DISTINCT FROM 'f'
       OR actual.prosecdef
       OR actual.proleakproof
       OR actual.provolatile IS DISTINCT FROM 'v'
       OR actual.proparallel IS DISTINCT FROM 'u'
       OR actual.proconfig IS DISTINCT FROM
          ARRAY['search_path=pg_catalog']::text[]
       OR actual.proowner IS DISTINCT FROM case_owner
       OR actual.language_name IS DISTINCT FROM 'plpgsql'
       OR pg_catalog.md5(actual.prosrc) IS DISTINCT FROM expected.source_md5
       OR NOT actual.runtime_execute
       OR NOT actual.runtime_direct_execute
       OR actual.runtime_execute_grantable
       OR actual.public_execute
       OR actual.other_role_execute_count <> 0 THEN
      RAISE EXCEPTION
        'Case read-mode predecessor drifted: %',
        expected.function_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN (
         'Case',
         'CaseMessage',
         'CaseMessageAttachment'
       )
       AND (
         class.relkind IS DISTINCT FROM 'r'
         OR class.relrowsecurity
         OR class.relforcerowsecurity
       )
  ) THEN
    RAISE EXCEPTION
      'Case read-mode convergence requires pre-activation table posture';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
      JOIN pg_catalog.pg_class AS class
        ON class.oid = policy.polrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN (
         'Case',
         'CaseMessage',
         'CaseMessageAttachment'
       )
  ) THEN
    RAISE EXCEPTION
      'Case read-mode convergence refuses an existing Case-family policy';
  END IF;
END
$grainline_case_read_mode_preflight$;

ALTER FUNCTION public.grainline_case_get(text, text)
  SECURITY DEFINER;
ALTER FUNCTION public.grainline_case_get_by_order(text, text)
  SECURITY DEFINER;
ALTER FUNCTION public.grainline_case_staff_active_count(text)
  SECURITY DEFINER;
ALTER FUNCTION public.grainline_case_export_page(
  text,
  timestamp,
  text,
  integer
) SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.grainline_case_get(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_case_get_by_order(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_case_staff_active_count(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_case_export_page(
  text,
  timestamp,
  text,
  integer
) FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_case_get(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_case_get_by_order(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_case_staff_active_count(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_case_export_page(
  text,
  timestamp,
  text,
  integer
) TO grainline_app_runtime;

DO $grainline_case_read_mode_postflight$
DECLARE
  case_owner oid;
  runtime_role_oid oid;
  function_count integer;
  expected record;
  function_oid oid;
  actual record;
BEGIN
  SELECT class.relowner
    INTO STRICT case_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Case'
     AND class.relkind = 'r';

  SELECT role.oid
    INTO STRICT runtime_role_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';

  SELECT pg_catalog.count(*)::integer
    INTO function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname IN (
       'grainline_case_get',
       'grainline_case_get_by_order',
       'grainline_case_staff_active_count',
       'grainline_case_export_page'
     );
  IF function_count <> 4 THEN
    RAISE EXCEPTION
      'Case read-mode function overload catalog drifted after convergence: %',
      function_count;
  END IF;

  FOR expected IN
    SELECT *
      FROM (
        VALUES
          (
            'grainline_case_get',
            'text,text',
            '39a2419d2643b2fb622f4ed47e887477'
          ),
          (
            'grainline_case_get_by_order',
            'text,text',
            '044733e1a1f15449a854a939eae715e4'
          ),
          (
            'grainline_case_staff_active_count',
            'text',
            'f63ba05d231445525f1eeff2b068dd4a'
          ),
          (
            'grainline_case_export_page',
            'text,timestamp without time zone,text,integer',
            '97b9478d9abeafe86db5f599049828d0'
          )
      ) AS expected_function(
        function_name,
        identity_arguments,
        source_md5
      )
  LOOP
    function_oid := pg_catalog.to_regprocedure(
      pg_catalog.format(
        'public.%I(%s)',
        expected.function_name,
        expected.identity_arguments
      )
    );
    IF function_oid IS NULL THEN
      RAISE EXCEPTION
        'Case read-mode function disappeared after convergence: %',
        expected.function_name;
    END IF;

    SELECT
      procedure.prokind,
      procedure.prosecdef,
      procedure.proleakproof,
      procedure.provolatile,
      procedure.proparallel,
      procedure.proconfig,
      procedure.proowner,
      language.lanname AS language_name,
      procedure.prosrc,
      pg_catalog.has_function_privilege(
        'grainline_app_runtime',
        procedure.oid,
        'EXECUTE'
      ) AS runtime_execute,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
      ) AS public_execute,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.grantee = runtime_role_oid
           AND acl.privilege_type = 'EXECUTE'
      ) AS runtime_direct_execute,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.grantee = runtime_role_oid
           AND acl.privilege_type = 'EXECUTE'
           AND acl.is_grantable
      ) AS runtime_execute_grantable,
      (
        SELECT pg_catalog.count(*)::integer
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.grantee NOT IN (
           0,
           procedure.proowner,
           runtime_role_oid
         )
           AND acl.privilege_type = 'EXECUTE'
      ) AS other_role_execute_count
      INTO STRICT actual
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_language AS language
        ON language.oid = procedure.prolang
     WHERE procedure.oid = function_oid;

    IF actual.prokind IS DISTINCT FROM 'f'
       OR NOT actual.prosecdef
       OR actual.proleakproof
       OR actual.provolatile IS DISTINCT FROM 'v'
       OR actual.proparallel IS DISTINCT FROM 'u'
       OR actual.proconfig IS DISTINCT FROM
          ARRAY['search_path=pg_catalog']::text[]
       OR actual.proowner IS DISTINCT FROM case_owner
       OR actual.language_name IS DISTINCT FROM 'plpgsql'
       OR pg_catalog.md5(actual.prosrc) IS DISTINCT FROM expected.source_md5
       OR NOT actual.runtime_execute
       OR NOT actual.runtime_direct_execute
       OR actual.runtime_execute_grantable
       OR actual.public_execute
       OR actual.other_role_execute_count <> 0 THEN
      RAISE EXCEPTION
        'Case read-mode convergence did not accept function source, mode or ACL: %',
        expected.function_name;
    END IF;
  END LOOP;
END
$grainline_case_read_mode_postflight$;

COMMIT;
