-- These narrow SECURITY INVOKER functions let read/delete SavedSearch paths
-- establish transaction-local user context and perform the owner-filtered
-- operation in one server round trip. RLS is enabled only by the later,
-- separately gated migration.

BEGIN;

CREATE FUNCTION public.grainline_saved_search_list(
  p_user_id text,
  p_take integer DEFAULT NULL,
  p_search_id text DEFAULT NULL
)
RETURNS SETOF public."SavedSearch"
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_saved_search_list$
DECLARE
  prior_user_id text := pg_catalog.current_setting('app.user_id', true);
  applied_user_id text;
BEGIN
  IF p_user_id IS NULL
     OR p_user_id = ''
     OR p_user_id <> pg_catalog.btrim(p_user_id)
     OR pg_catalog.char_length(p_user_id) > 128
     OR p_user_id !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION 'SavedSearch user context requires a bounded local user id'
      USING ERRCODE = '22023';
  END IF;

  IF p_take IS NOT NULL AND (p_take < 1 OR p_take > 25) THEN
    RAISE EXCEPTION 'SavedSearch list limit must be between 1 and 25'
      USING ERRCODE = '22023';
  END IF;

  IF prior_user_id IS NOT NULL
     AND prior_user_id <> ''
     AND prior_user_id <> p_user_id THEN
    RAISE EXCEPTION 'refusing to switch SavedSearch user context'
      USING ERRCODE = '42501';
  END IF;

  applied_user_id := pg_catalog.set_config('app.user_id', p_user_id, true);
  IF applied_user_id IS DISTINCT FROM p_user_id
     OR pg_catalog.current_setting('app.user_id', true) IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'failed to establish SavedSearch user context'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT saved_search.*
    FROM public."SavedSearch" AS saved_search
   WHERE saved_search."userId" = p_user_id
     AND (p_search_id IS NULL OR saved_search.id = p_search_id)
   ORDER BY saved_search."createdAt" DESC
   LIMIT p_take;
END;
$grainline_saved_search_list$;

CREATE FUNCTION public.grainline_saved_search_delete_one(
  p_user_id text,
  p_search_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_saved_search_delete_one$
DECLARE
  prior_user_id text := pg_catalog.current_setting('app.user_id', true);
  applied_user_id text;
  deleted_count integer;
BEGIN
  IF p_user_id IS NULL
     OR p_user_id = ''
     OR p_user_id <> pg_catalog.btrim(p_user_id)
     OR pg_catalog.char_length(p_user_id) > 128
     OR p_user_id !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION 'SavedSearch user context requires a bounded local user id'
      USING ERRCODE = '22023';
  END IF;

  IF prior_user_id IS NOT NULL
     AND prior_user_id <> ''
     AND prior_user_id <> p_user_id THEN
    RAISE EXCEPTION 'refusing to switch SavedSearch user context'
      USING ERRCODE = '42501';
  END IF;

  applied_user_id := pg_catalog.set_config('app.user_id', p_user_id, true);
  IF applied_user_id IS DISTINCT FROM p_user_id
     OR pg_catalog.current_setting('app.user_id', true) IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'failed to establish SavedSearch user context'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."SavedSearch" AS saved_search
   WHERE saved_search."userId" = p_user_id
     AND saved_search.id = p_search_id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$grainline_saved_search_delete_one$;

REVOKE ALL ON FUNCTION public.grainline_saved_search_list(text, integer, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_saved_search_delete_one(text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_saved_search_list(text, integer, text)
  FROM grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_saved_search_delete_one(text, text)
  FROM grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_saved_search_list(text, integer, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_saved_search_delete_one(text, text)
  TO grainline_app_runtime;

-- Fail the migration if default privileges or an unexpected pre-existing
-- overload broaden either RPC beyond the reviewed catalog posture.
DO $grainline_saved_search_rpc_posture$
DECLARE
  runtime_oid oid;
  migration_oid oid;
  rpc record;
BEGIN
  SELECT oid INTO runtime_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT oid INTO migration_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = current_user;

  IF runtime_oid IS NULL OR migration_oid IS NULL THEN
    RAISE EXCEPTION 'SavedSearch owner RPC posture roles could not be resolved';
  END IF;

  IF (
    SELECT count(*)
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname IN (
         'grainline_saved_search_list',
         'grainline_saved_search_delete_one'
       )
  ) <> 2 THEN
    RAISE EXCEPTION 'SavedSearch owner RPC signatures or overload count are unexpected';
  END IF;

  FOR rpc IN
    SELECT procedure.*
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname IN (
         'grainline_saved_search_list',
         'grainline_saved_search_delete_one'
       )
  LOOP
    IF rpc.proowner <> migration_oid THEN
      RAISE EXCEPTION 'SavedSearch owner RPC must be owned by the migration role';
    END IF;

    IF rpc.prosecdef
       OR rpc.proleakproof
       OR rpc.provolatile <> 'v'
       OR rpc.proparallel <> 'u'
       OR rpc.prokind <> 'f'
       OR rpc.prolang <> (
         SELECT language.oid
           FROM pg_catalog.pg_language AS language
          WHERE language.lanname = 'plpgsql'
       )
       OR rpc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
      RAISE EXCEPTION 'SavedSearch owner RPC routine posture is unexpected';
    END IF;

    IF rpc.proname = 'grainline_saved_search_list'
       AND NOT (
         rpc.proretset
         AND rpc.prorettype = 'public."SavedSearch"'::pg_catalog.regtype
       ) THEN
      RAISE EXCEPTION 'SavedSearch list RPC return contract is unexpected';
    END IF;
    IF rpc.proname = 'grainline_saved_search_delete_one'
       AND (
         rpc.proretset
         OR rpc.prorettype <> 'pg_catalog.int4'::pg_catalog.regtype
       ) THEN
      RAISE EXCEPTION 'SavedSearch delete RPC return contract is unexpected';
    END IF;

    IF (
      SELECT coalesce(
        pg_catalog.array_agg(
          DISTINCT pg_catalog.upper(acl.privilege_type)
          ORDER BY pg_catalog.upper(acl.privilege_type)
        ),
        ARRAY[]::text[]
      )
        FROM pg_catalog.aclexplode(
          coalesce(
            rpc.proacl,
            pg_catalog.acldefault('f', rpc.proowner)
          )
        ) AS acl
       WHERE acl.grantee = runtime_oid
    ) IS DISTINCT FROM ARRAY['EXECUTE']::text[]
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             coalesce(
               rpc.proacl,
               pg_catalog.acldefault('f', rpc.proowner)
             )
           ) AS acl
          WHERE acl.grantee = runtime_oid
            AND acl.is_grantable
       ) THEN
      RAISE EXCEPTION 'grainline_app_runtime must have only non-grantable EXECUTE on SavedSearch owner RPCs';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM pg_catalog.aclexplode(
          coalesce(
            rpc.proacl,
            pg_catalog.acldefault('f', rpc.proowner)
          )
        ) AS acl
       WHERE acl.grantee = 0
          OR acl.grantee NOT IN (runtime_oid, migration_oid)
    ) THEN
      RAISE EXCEPTION 'SavedSearch owner RPC privileges must be limited to owner and runtime role';
    END IF;
  END LOOP;
END;
$grainline_saved_search_rpc_posture$;

COMMIT;
