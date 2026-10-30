-- Database-first emergency rollback for Favorite ENABLE/FORCE activation.
-- Run only after the compatible preparation application is confirmed live.
-- The additive count projection, its maintenance triggers, and the eight fixed
-- operations remain; this restores the compatible predecessor table grants.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.favorite.rls.activation', 0)
);

-- As in activation, locking Favorite alone avoids a cross-table deadlock with
-- the Favorite count trigger and Listing cascades while still freezing every
-- write that can change the derived count projection.
LOCK TABLE public."Favorite" IN ACCESS EXCLUSIVE MODE;

DO $grainline_favorite_rollback_preflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  runtime_privileges text[];
  drift_count bigint;
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
     AND class.relname = 'Favorite'
     AND class.relkind = 'r';
  IF runtime_oid IS NULL OR table_oid IS NULL
     OR table_owner IS DISTINCT FROM (
       SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
        WHERE oid = table_owner AND (rolsuper OR rolbypassrls)
     ) THEN
    RAISE EXCEPTION 'Favorite rollback identity drifted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid = table_oid AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Favorite rollback requires ENABLE plus FORCE';
  END IF;
  IF (
    SELECT pg_catalog.array_agg(
             policy.polname::text || ':' || policy.polcmd::text
             ORDER BY policy.polname
           )
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
  ) IS DISTINCT FROM ARRAY[
    'favorite_owner_delete:d',
    'favorite_owner_select:r'
  ]::text[] OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
       AND NOT (
         policy.polpermissive
         AND policy.polroles = ARRAY[runtime_oid]::oid[]
         AND policy.polcmd IN ('r', 'd')
         AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) =
             '("userId" = NULLIF(current_setting(''app.user_id''::text, true), ''''::text))'
         AND policy.polwithcheck IS NULL
       )
  ) THEN
    RAISE EXCEPTION 'Favorite rollback policy posture drifted';
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
  IF runtime_privileges IS DISTINCT FROM ARRAY['DELETE', 'SELECT']::text[] THEN
    RAISE EXCEPTION 'Favorite rollback table grants drifted';
  END IF;

  SELECT pg_catalog.count(*)::bigint
    INTO drift_count
    FROM public."Listing" AS listing
    LEFT JOIN LATERAL (
      SELECT pg_catalog.count(*)::integer AS value
        FROM public."Favorite" AS favorite
       WHERE favorite."listingId" = listing.id
    ) AS actual ON true
   WHERE listing."favoriteCount" <> actual.value;
  IF drift_count <> 0 THEN
    RAISE EXCEPTION 'Favorite rollback found projection drift for % listings', drift_count;
  END IF;
END
$grainline_favorite_rollback_preflight$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Favorite"
  TO grainline_app_runtime;
ALTER TABLE public."Favorite" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."Favorite" DISABLE ROW LEVEL SECURITY;
DROP POLICY favorite_owner_select ON public."Favorite";
DROP POLICY favorite_owner_delete ON public."Favorite";

DO $grainline_favorite_rollback_postflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  runtime_privileges text[];
  drift_count bigint;
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
     AND class.relname = 'Favorite'
     AND class.relkind = 'r';
  IF runtime_oid IS NULL OR table_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid = table_oid AND NOT relrowsecurity AND NOT relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'Favorite rollback catalog did not converge';
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
         FROM pg_catalog.aclexplode(
           COALESCE(
             (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
             pg_catalog.acldefault('r', table_owner)
           )
         ) AS acl
        WHERE acl.grantee NOT IN (table_owner, runtime_oid)
     ) THEN
    RAISE EXCEPTION 'Favorite rollback grants did not converge';
  END IF;

  SELECT pg_catalog.count(*)::bigint
    INTO drift_count
    FROM public."Listing" AS listing
    LEFT JOIN LATERAL (
      SELECT pg_catalog.count(*)::integer AS value
        FROM public."Favorite" AS favorite
       WHERE favorite."listingId" = listing.id
    ) AS actual ON true
   WHERE listing."favoriteCount" <> actual.value;
  IF drift_count <> 0 THEN
    RAISE EXCEPTION 'Favorite rollback created projection drift for % listings', drift_count;
  END IF;
END
$grainline_favorite_rollback_postflight$;

COMMIT;
