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

  FOR expected IN
    SELECT *
      FROM (
        VALUES
          ('grainline_case_get', 'text,text'),
          ('grainline_case_get_by_order', 'text,text'),
          ('grainline_case_staff_active_count', 'text'),
          (
            'grainline_case_export_page',
            'text,timestamp without time zone,text,integer'
          )
      ) AS expected_function(function_name, identity_arguments)
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
      ) AS public_execute
      INTO STRICT actual
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = function_oid;

    IF actual.prokind IS DISTINCT FROM 'f'
       OR actual.prosecdef
       OR actual.proleakproof
       OR actual.provolatile IS DISTINCT FROM 'v'
       OR actual.proparallel IS DISTINCT FROM 'u'
       OR actual.proconfig IS DISTINCT FROM
          ARRAY['search_path=pg_catalog']::text[]
       OR actual.proowner IS DISTINCT FROM case_owner
       OR NOT actual.runtime_execute
       OR actual.public_execute THEN
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
  accepted_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO accepted_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname IN (
       'grainline_case_get',
       'grainline_case_get_by_order',
       'grainline_case_staff_active_count',
       'grainline_case_export_page'
     )
     AND procedure.prokind = 'f'
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND procedure.proconfig IS NOT DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       procedure.oid,
       'EXECUTE'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     );

  IF accepted_count <> 4 THEN
    RAISE EXCEPTION
      'Case read-mode convergence did not accept all four functions: %',
      accepted_count;
  END IF;
END
$grainline_case_read_mode_postflight$;

COMMIT;
