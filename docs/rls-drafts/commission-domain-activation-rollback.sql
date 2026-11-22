-- EMERGENCY DATABASE-FIRST rollback for the coupled Commission domain.
-- Run from a direct owner session while the compatible predecessor app is
-- ready. Keep the applied Prisma ledger row intact; a future reactivation must
-- use a new reviewed forward migration. The global release audit deliberately
-- remains fail-closed after this rollback because its applied-ledger view still
-- requires the active zero-direct posture; this incident state blocks later
-- releases until that new forward migration is reviewed and applied.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.commission-domain.rls.activation', 0)
);

LOCK TABLE public."CommissionRequest", public."CommissionInterest"
  IN ACCESS EXCLUSIVE MODE;

DO $grainline_commission_domain_rollback_preflight$
DECLARE
  runtime_oid oid;
  staff_oid oid;
  owner_oid oid;
  relation_state record;
  legacy record;
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'Commission rollback requires a direct owner session';
  END IF;

  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT oid INTO staff_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_staff_read_runtime';
  SELECT oid INTO owner_oid FROM pg_catalog.pg_roles
   WHERE rolname = current_user;

  IF runtime_oid IS NULL OR staff_oid IS NULL OR owner_oid IS NULL THEN
    RAISE EXCEPTION 'Commission rollback roles are missing';
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
    RAISE EXCEPTION 'Commission rollback requires two bypass-owned tables';
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
    IF NOT relation_state.relrowsecurity OR NOT relation_state.relforcerowsecurity
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = relation_state.oid)
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(relation_state.relacl,
                      pg_catalog.acldefault('r', relation_state.relowner))
           ) AS acl
          WHERE acl.grantee <> relation_state.relowner
       )
       OR (
         SELECT pg_catalog.count(*)
           FROM pg_catalog.aclexplode(
             COALESCE(relation_state.relacl,
                      pg_catalog.acldefault('r', relation_state.relowner))
           ) AS acl
          WHERE acl.grantee = relation_state.relowner
            AND acl.privilege_type IN (
              'SELECT', 'INSERT', 'UPDATE', 'DELETE',
              'TRUNCATE', 'REFERENCES', 'TRIGGER'
            )
            AND acl.is_grantable
       ) <> 7
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_attribute AS attribute
           CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
          WHERE attribute.attrelid = relation_state.oid
            AND attribute.attnum > 0 AND NOT attribute.attisdropped
       ) THEN
      RAISE EXCEPTION 'Commission active posture drifted before rollback: %', relation_state.relname;
    END IF;
  END LOOP;

  FOR legacy IN
    SELECT * FROM (VALUES
      ('public.grainline_message_create_commission_interest(text,text,text,text,text)', '8247283d3e79765eceac777d091b0dd0', 'v'),
      ('public.grainline_direct_upload_sync_commission_request(text,text)', 'ade11756e28500c0c17f053c6e0a5b65', 'v'),
      ('public.grainline_seller_service_commission_interest_targets(text,integer)', 'ea3bea27379b693177990a09cc5f2651', 's')
    ) AS expected(identity, source_md5, volatility)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = legacy.identity::pg_catalog.regprocedure
         AND procedure.proowner = owner_oid
         AND procedure.prosecdef
         AND NOT procedure.proleakproof
         AND procedure.prokind = 'f'
         AND procedure.prolang = (
           SELECT language.oid FROM pg_catalog.pg_language AS language
            WHERE language.lanname = 'plpgsql'
         )
         AND procedure.prorettype = 'pg_catalog.record'::pg_catalog.regtype
         AND procedure.proretset
         AND NOT procedure.proisstrict
         AND procedure.provolatile = legacy.volatility::"char"
         AND procedure.proparallel = 'u'
         AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND pg_catalog.md5(procedure.prosrc) = legacy.source_md5
         AND (
           SELECT pg_catalog.count(*)
             FROM pg_catalog.aclexplode(
               COALESCE(procedure.proacl,
                        pg_catalog.acldefault('f', procedure.proowner))
             ) AS acl
            WHERE acl.grantee = procedure.proowner
              AND acl.privilege_type = 'EXECUTE'
              AND acl.is_grantable
         ) = 1
         AND NOT EXISTS (
           SELECT 1
             FROM pg_catalog.aclexplode(
               COALESCE(procedure.proacl,
                        pg_catalog.acldefault('f', procedure.proowner))
             ) AS acl
            WHERE acl.grantee <> procedure.proowner
         )
    ) THEN
      RAISE EXCEPTION 'Commission retired function drifted before rollback: %', legacy.identity;
    END IF;
  END LOOP;
END
$grainline_commission_domain_rollback_preflight$;

-- Restore the complete predecessor authority while ACCESS EXCLUSIVE locks keep
-- runtime traffic out, then remove FORCE/ENABLE. No request can observe a
-- partially restored authorization posture.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."CommissionRequest", public."CommissionInterest"
  TO grainline_app_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_message_create_commission_interest(text, text, text, text, text),
  public.grainline_direct_upload_sync_commission_request(text, text),
  public.grainline_seller_service_commission_interest_targets(text, integer)
  TO grainline_app_runtime;

ALTER TABLE public."CommissionRequest" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionRequest" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionInterest" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionInterest" DISABLE ROW LEVEL SECURITY;

DO $grainline_commission_domain_rollback_postflight$
DECLARE
  runtime_oid oid;
  owner_oid oid;
  relation_state record;
  legacy record;
BEGIN
  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT oid INTO owner_oid FROM pg_catalog.pg_roles
   WHERE rolname = current_user;

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
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = relation_state.oid)
       OR relation_state.relowner <> owner_oid
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_attribute AS attribute
           CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
          WHERE attribute.attrelid = relation_state.oid
            AND attribute.attnum > 0 AND NOT attribute.attisdropped
       )
       OR (
         SELECT pg_catalog.count(*)
           FROM pg_catalog.aclexplode(
             COALESCE(relation_state.relacl,
                      pg_catalog.acldefault('r', relation_state.relowner))
           ) AS acl
          WHERE acl.grantee = runtime_oid
            AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
            AND NOT acl.is_grantable
       ) <> 4
       OR (
         SELECT pg_catalog.count(*)
           FROM pg_catalog.aclexplode(
             COALESCE(relation_state.relacl,
                      pg_catalog.acldefault('r', relation_state.relowner))
           ) AS acl
          WHERE acl.grantee = relation_state.relowner
            AND acl.privilege_type IN (
              'SELECT', 'INSERT', 'UPDATE', 'DELETE',
              'TRUNCATE', 'REFERENCES', 'TRIGGER'
            )
            AND acl.is_grantable
       ) <> 7
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(relation_state.relacl,
                      pg_catalog.acldefault('r', relation_state.relowner))
           ) AS acl
          WHERE acl.grantee <> relation_state.relowner
            AND (
              acl.grantee <> runtime_oid
              OR acl.privilege_type NOT IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
              OR acl.is_grantable
            )
       ) THEN
      RAISE EXCEPTION 'Commission rollback postflight drifted: %', relation_state.relname;
    END IF;
  END LOOP;

  FOR legacy IN
    SELECT * FROM (VALUES
      ('public.grainline_message_create_commission_interest(text,text,text,text,text)', '8247283d3e79765eceac777d091b0dd0', 'v'),
      ('public.grainline_direct_upload_sync_commission_request(text,text)', 'ade11756e28500c0c17f053c6e0a5b65', 'v'),
      ('public.grainline_seller_service_commission_interest_targets(text,integer)', 'ea3bea27379b693177990a09cc5f2651', 's')
    ) AS expected(identity, source_md5, volatility)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = legacy.identity::pg_catalog.regprocedure
         AND procedure.proowner = owner_oid
         AND procedure.prosecdef
         AND NOT procedure.proleakproof
         AND procedure.prokind = 'f'
         AND procedure.prolang = (
           SELECT language.oid FROM pg_catalog.pg_language AS language
            WHERE language.lanname = 'plpgsql'
         )
         AND procedure.prorettype = 'pg_catalog.record'::pg_catalog.regtype
         AND procedure.proretset
         AND NOT procedure.proisstrict
         AND procedure.provolatile = legacy.volatility::"char"
         AND procedure.proparallel = 'u'
         AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND pg_catalog.md5(procedure.prosrc) = legacy.source_md5
         AND (
           SELECT pg_catalog.count(*)
             FROM pg_catalog.aclexplode(
               COALESCE(procedure.proacl,
                        pg_catalog.acldefault('f', procedure.proowner))
             ) AS acl
            WHERE acl.grantee = procedure.proowner
              AND acl.privilege_type = 'EXECUTE'
              AND acl.is_grantable
         ) = 1
         AND (
           SELECT pg_catalog.count(*)
             FROM pg_catalog.aclexplode(
               COALESCE(procedure.proacl,
                        pg_catalog.acldefault('f', procedure.proowner))
             ) AS acl
            WHERE acl.grantee = runtime_oid
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
         ) = 1
         AND NOT EXISTS (
           SELECT 1
             FROM pg_catalog.aclexplode(
               COALESCE(procedure.proacl,
                        pg_catalog.acldefault('f', procedure.proowner))
             ) AS acl
            WHERE acl.grantee <> procedure.proowner
              AND (
                acl.grantee <> runtime_oid
                OR acl.privilege_type <> 'EXECUTE'
                OR acl.is_grantable
              )
         )
    ) THEN
      RAISE EXCEPTION 'Commission predecessor function authority drifted: %', legacy.identity;
    END IF;
  END LOOP;
END
$grainline_commission_domain_rollback_postflight$;

COMMIT;
