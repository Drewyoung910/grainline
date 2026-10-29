BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

-- Compatible preparation only. Block RLS and predecessor table grants remain
-- unchanged until every caller, retained cross-domain authority, rollback, and
-- full-chain PostgreSQL 17 proof has passed review.
DO $grainline_block_preparation_preflight$
DECLARE
  inbox record;
  unread record;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."Block"'::pg_catalog.regclass
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Block RLS must remain off during compatible preparation';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.grainline_user_block_pair_lock(text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_user_block_follow_cleanup(text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_stock_notification_block_cleanup(text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Block preparation predecessor authority is missing';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid IN (
       pg_catalog.to_regprocedure(
         'public.grainline_user_block_pair_is_blocked(text)'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_user_block_create(text)'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_user_block_remove(text)'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_user_block_export()'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_user_block_delete_owned()'
       )
     )
  ) THEN
    RAISE EXCEPTION 'Block preparation function already exists';
  END IF;

  SELECT procedure.prosecdef,
         pg_catalog.md5(procedure.prosrc) AS source_md5
    INTO STRICT inbox
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = pg_catalog.to_regprocedure(
     'public.grainline_conversation_inbox(text,boolean,text,timestamp without time zone,text,integer)'
   );
  SELECT procedure.prosecdef,
         pg_catalog.md5(procedure.prosrc) AS source_md5
    INTO STRICT unread
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = pg_catalog.to_regprocedure(
     'public.grainline_message_unread_count(text)'
   );
  IF inbox.prosecdef
     OR inbox.source_md5 IS DISTINCT FROM '4b2884765f4ca0db432c4678f98b1bdd'
     OR unread.prosecdef
     OR unread.source_md5 IS DISTINCT FROM '6465832d045b72cc2762907f66a461f3' THEN
    RAISE EXCEPTION 'Block messaging predecessor authority drifted';
  END IF;
END;
$grainline_block_preparation_preflight$;

CREATE FUNCTION public.grainline_user_block_pair_is_blocked(
  p_target_user_id text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_block_pair_is_blocked$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  pair_is_blocked boolean;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User block pair context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_target_user_id IS NULL
     OR p_target_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_user_id = request_user_id THEN
    RAISE EXCEPTION 'User block pair target is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = request_user_id
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'User block pair actor is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public."Block" AS relationship
     WHERE (
       relationship."blockerId" = request_user_id
       AND relationship."blockedId" = p_target_user_id
     ) OR (
       relationship."blockerId" = p_target_user_id
       AND relationship."blockedId" = request_user_id
     )
  ) INTO pair_is_blocked;

  RETURN pair_is_blocked;
END;
$grainline_user_block_pair_is_blocked$;

CREATE FUNCTION public.grainline_user_block_create(
  p_target_user_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_block_create$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  locked_user_count integer := 0;
  active_actor_count integer := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User block create context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_target_user_id IS NULL
     OR p_target_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_user_id = request_user_id THEN
    RAISE EXCEPTION 'User block create target is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'User block create requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO locked_user_count
    FROM public.grainline_user_block_pair_lock(p_target_user_id) AS locked_user
   WHERE locked_user."deletedAt" IS NULL;
  IF locked_user_count <> 2 THEN
    RETURN false;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO active_actor_count
    FROM public."User" AS actor
   WHERE actor.id = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL;
  IF active_actor_count <> 1 THEN
    RAISE EXCEPTION 'User block create actor is unavailable'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public."Block" (
    id,
    "blockerId",
    "blockedId"
  ) VALUES (
    pg_catalog.gen_random_uuid()::text,
    request_user_id,
    p_target_user_id
  )
  ON CONFLICT ("blockerId", "blockedId") DO NOTHING;

  -- These existing fixed operations re-take the same sorted pair lock and run
  -- inside this transaction. A successful create therefore owns the durable
  -- Block plus both reciprocal cleanup families atomically.
  PERFORM public.grainline_user_block_follow_cleanup(p_target_user_id);
  PERFORM public.grainline_stock_notification_block_cleanup(p_target_user_id);

  RETURN true;
END;
$grainline_user_block_create$;

CREATE FUNCTION public.grainline_user_block_remove(
  p_target_user_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_block_remove$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  locked_user_count integer := 0;
  deleted_count integer := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User unblock context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_target_user_id IS NULL
     OR p_target_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_user_id = request_user_id THEN
    RAISE EXCEPTION 'User unblock target is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'User unblock requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO locked_user_count
    FROM public.grainline_user_block_pair_lock(p_target_user_id);
  IF locked_user_count <> 2 THEN
    RETURN 0;
  END IF;

  DELETE FROM public."Block" AS relationship
   WHERE relationship."blockerId" = request_user_id
     AND relationship."blockedId" = p_target_user_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$grainline_user_block_remove$;

CREATE FUNCTION public.grainline_user_block_export()
RETURNS TABLE (
  "blockerId" text,
  "blockedId" text,
  "createdAt" timestamp(3)
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_block_export$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User block export context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = request_user_id
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'User block export actor is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT relationship."blockerId",
         relationship."blockedId",
         relationship."createdAt"
    FROM public."Block" AS relationship
   WHERE relationship."blockerId" = request_user_id
      OR relationship."blockedId" = request_user_id
   ORDER BY relationship."createdAt" DESC, relationship.id DESC;
END;
$grainline_user_block_export$;

CREATE FUNCTION public.grainline_user_block_delete_owned()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_block_delete_owned$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  deleted_count integer := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User block deletion context is invalid'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."Block" AS relationship
   WHERE relationship."blockerId" = request_user_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$grainline_user_block_delete_owned$;

-- These two projections already enforce their actor/participant contracts and
-- set transaction-local app.user_id. Their only remaining dependency on broad
-- runtime table grants is the reciprocal Block predicate. Fixed ownership lets
-- that exact, source-pinned predicate survive policyless Block FORCE without
-- adding an incoming-row disclosure policy or generic runtime SELECT.
ALTER FUNCTION public.grainline_conversation_inbox(
  text,
  boolean,
  text,
  timestamp,
  text,
  integer
) SECURITY DEFINER;
ALTER FUNCTION public.grainline_message_unread_count(text)
  SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.grainline_user_block_pair_is_blocked(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_block_create(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_block_remove(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_block_export()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_block_delete_owned()
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_user_block_pair_is_blocked(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_block_create(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_block_remove(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_block_export()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_block_delete_owned()
  TO grainline_app_runtime;

DO $grainline_block_preparation_postflight$
DECLARE
  prepared_count integer := 0;
  messaging_count integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."Block"'::pg_catalog.regclass
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Block compatible preparation changed RLS posture';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO prepared_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.oid = procedure.proowner
   WHERE procedure.oid IN (
     'public.grainline_user_block_pair_is_blocked(text)'::pg_catalog.regprocedure,
     'public.grainline_user_block_create(text)'::pg_catalog.regprocedure,
     'public.grainline_user_block_remove(text)'::pg_catalog.regprocedure,
     'public.grainline_user_block_export()'::pg_catalog.regprocedure,
     'public.grainline_user_block_delete_owned()'::pg_catalog.regprocedure
   )
     AND (owner_role.rolsuper OR owner_role.rolbypassrls);
  IF prepared_count <> 5 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid IN (
       'public.grainline_user_block_pair_is_blocked(text)'::pg_catalog.regprocedure,
       'public.grainline_user_block_create(text)'::pg_catalog.regprocedure,
       'public.grainline_user_block_remove(text)'::pg_catalog.regprocedure,
       'public.grainline_user_block_export()'::pg_catalog.regprocedure,
       'public.grainline_user_block_delete_owned()'::pg_catalog.regprocedure
     )
       AND (
         NOT procedure.prosecdef
         OR procedure.proleakproof
         OR procedure.proparallel IS DISTINCT FROM 'u'
         OR procedure.proconfig IS DISTINCT FROM
              ARRAY['search_path=pg_catalog']::text[]
         OR NOT pg_catalog.has_function_privilege(
           'grainline_app_runtime',
           procedure.oid,
           'EXECUTE'
         )
         OR EXISTS (
           SELECT 1
             FROM pg_catalog.aclexplode(
               COALESCE(
                 procedure.proacl,
                 pg_catalog.acldefault('f', procedure.proowner)
               )
             ) AS acl
            WHERE acl.grantee = 0
              AND acl.privilege_type = 'EXECUTE'
         )
       )
  ) THEN
    RAISE EXCEPTION 'Block preparation function posture drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO messaging_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.oid = procedure.proowner
   WHERE procedure.oid IN (
     'public.grainline_conversation_inbox(text,boolean,text,timestamp without time zone,text,integer)'::pg_catalog.regprocedure,
     'public.grainline_message_unread_count(text)'::pg_catalog.regprocedure
   )
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.proparallel = 'u'
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND (owner_role.rolsuper OR owner_role.rolbypassrls)
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
     )
     AND (
       (
         procedure.oid = 'public.grainline_conversation_inbox(text,boolean,text,timestamp without time zone,text,integer)'::pg_catalog.regprocedure
         AND pg_catalog.md5(procedure.prosrc) = '4b2884765f4ca0db432c4678f98b1bdd'
       ) OR (
         procedure.oid = 'public.grainline_message_unread_count(text)'::pg_catalog.regprocedure
         AND pg_catalog.md5(procedure.prosrc) = '6465832d045b72cc2762907f66a461f3'
       )
     );
  IF messaging_count <> 2 THEN
    RAISE EXCEPTION 'Block messaging authority posture drifted';
  END IF;
END;
$grainline_block_preparation_postflight$;

COMMIT;
