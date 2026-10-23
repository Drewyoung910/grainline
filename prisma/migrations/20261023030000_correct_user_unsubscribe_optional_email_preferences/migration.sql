-- Keep transactional order, case, and refund email preferences always on when
-- a signed one-click unsubscribe disables optional email categories.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.user.unsubscribe-preferences.c875', 0)
);

LOCK TABLE public."User" IN SHARE ROW EXCLUSIVE MODE;

DO $grainline_user_unsubscribe_optional_preflight$
DECLARE
  table_owner oid;
  migration_role record;
  restricted_role_count integer;
  accepted_function_count integer;
BEGIN
  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."User"'::pg_catalog.regclass
     AND class.relkind = 'r';

  IF table_owner IS DISTINCT FROM (
    SELECT role.oid
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  ) OR current_user <> session_user THEN
    RAISE EXCEPTION 'User unsubscribe correction requires a direct table-owner session';
  END IF;

  SELECT role.rolsuper, role.rolbypassrls
    INTO migration_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND OR NOT (migration_role.rolsuper OR migration_role.rolbypassrls) THEN
    RAISE EXCEPTION 'User owner must bypass FORCE RLS';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO restricted_role_count
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname IN (
     'grainline_app_runtime',
     'grainline_staff_read_runtime'
   )
     AND NOT role.rolsuper
     AND NOT role.rolinherit
     AND role.rolcanlogin
     AND NOT role.rolcreatedb
     AND NOT role.rolcreaterole
     AND NOT role.rolreplication
     AND NOT role.rolbypassrls;
  IF restricted_role_count <> 2 THEN
    RAISE EXCEPTION 'User unsubscribe restricted-role posture drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."User"'::pg_catalog.regclass
       AND class.relrowsecurity
       AND class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."User"'::pg_catalog.regclass
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) AS acl
     WHERE class.oid = 'public."User"'::pg_catalog.regclass
       AND acl.grantee <> class.relowner
       AND acl.privilege_type IN (
         'SELECT', 'INSERT', 'UPDATE', 'DELETE',
         'TRUNCATE', 'REFERENCES', 'TRIGGER'
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid = 'public."User"'::pg_catalog.regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND acl.grantee <> table_owner
       AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
  ) THEN
    RAISE EXCEPTION 'User policyless FORCE posture drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO accepted_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
   WHERE namespace.nspname = 'public'
     AND procedure.proname = 'grainline_user_unsubscribe_preferences_disable'
     AND pg_catalog.oidvectortypes(procedure.proargtypes)::text = 'text[]'
     AND procedure.proowner = table_owner
     AND (owner.rolsuper OR owner.rolbypassrls)
     AND procedure.prosecdef
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(procedure.prosrc) = '11485f55b3bec34f2091430245a4a2cf'
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE');
  IF accepted_function_count <> 1 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname = 'grainline_user_unsubscribe_preferences_disable'
  ) <> 1 THEN
    RAISE EXCEPTION 'User unsubscribe preference authority drifted';
  END IF;
END
$grainline_user_unsubscribe_optional_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_user_unsubscribe_preferences_disable(
  p_suppression_keys text[]
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_unsubscribe_preferences_disable$
DECLARE
  candidate_key text;
  changed_at timestamp(3);
  updated_rows integer := 0;
BEGIN
  IF p_suppression_keys IS NULL
     OR pg_catalog.cardinality(p_suppression_keys) < 1
     OR pg_catalog.cardinality(p_suppression_keys) > 20 THEN
    RAISE EXCEPTION 'User unsubscribe preference input is invalid'
      USING ERRCODE = '22023';
  END IF;
  FOREACH candidate_key IN ARRAY p_suppression_keys LOOP
    IF candidate_key IS NULL
       OR candidate_key = ''
       OR pg_catalog.char_length(candidate_key) > 254
       OR candidate_key IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(candidate_key))
       OR pg_catalog.strpos(candidate_key, '@') <= 1 THEN
      RAISE EXCEPTION 'User unsubscribe suppression key is invalid'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."User" AS account_user
     SET "notificationPreferences" =
           COALESCE(account_user."notificationPreferences", '{}'::jsonb)
           || pg_catalog.jsonb_build_object(
             'EMAIL_NEW_MESSAGE', false,
             'EMAIL_CUSTOM_ORDER', false,
             'EMAIL_VERIFICATION_APPROVED', false,
             'EMAIL_VERIFICATION_REJECTED', false,
             'EMAIL_BACK_IN_STOCK', false,
             'EMAIL_NEW_REVIEW', false,
             'EMAIL_FOLLOWED_MAKER_NEW_LISTING', false,
             'EMAIL_SELLER_BROADCAST', false
           ),
         "updatedAt" = changed_at
   WHERE CASE
     WHEN pg_catalog.lower(
            pg_catalog.split_part(pg_catalog.btrim(account_user.email), '@', 2)
          ) IN ('gmail.com', 'googlemail.com')
     THEN pg_catalog.replace(
       pg_catalog.split_part(
         pg_catalog.lower(
           pg_catalog.split_part(pg_catalog.btrim(account_user.email), '@', 1)
         ),
         '+',
         1
       ),
       '.',
       ''
     ) || '@gmail.com'
     ELSE pg_catalog.lower(pg_catalog.btrim(account_user.email))
   END = ANY (p_suppression_keys);

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows;
END
$grainline_user_unsubscribe_preferences_disable$;

REVOKE ALL ON FUNCTION
  public.grainline_user_unsubscribe_preferences_disable(text[])
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_unsubscribe_preferences_disable(text[])
  TO grainline_app_runtime;

DO $grainline_user_unsubscribe_optional_postflight$
DECLARE
  table_owner oid;
  accepted_function_count integer;
BEGIN
  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."User"'::pg_catalog.regclass
     AND class.relkind = 'r';

  SELECT pg_catalog.count(*)::integer
    INTO accepted_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = 'grainline_user_unsubscribe_preferences_disable'
     AND pg_catalog.oidvectortypes(procedure.proargtypes)::text = 'text[]'
     AND procedure.proowner = table_owner
     AND procedure.prosecdef
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(procedure.prosrc) = 'd8f4e2a60455233fc7da9f19e242b0a9'
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE');
  IF accepted_function_count <> 1 THEN
    RAISE EXCEPTION 'User unsubscribe preference correction did not establish exact authority';
  END IF;
END
$grainline_user_unsubscribe_optional_postflight$;

COMMIT;
