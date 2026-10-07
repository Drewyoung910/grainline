BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.user.rls.activation', 0)
);

DO $grainline_conversation_inbox_user_authority_preflight$
DECLARE
  table_owner oid;
  runtime_role_oid oid;
  inbox_oid oid;
  participant_oid oid;
  claim_trigger_oid oid;
  actual record;
BEGIN
  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'User'
     AND class.relkind = 'r';

  SELECT role.oid
    INTO STRICT runtime_role_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime'
     AND NOT role.rolsuper
     AND NOT role.rolinherit
     AND role.rolcanlogin
     AND NOT role.rolcreatedb
     AND NOT role.rolcreaterole
     AND NOT role.rolreplication
     AND NOT role.rolbypassrls;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'User'
       AND class.relkind = 'r'
       AND NOT class.relrowsecurity
       AND NOT class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
      JOIN pg_catalog.pg_class AS class
        ON class.oid = policy.polrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'User'
  ) THEN
    RAISE EXCEPTION
      'Conversation inbox convergence requires the reviewed pre-User-RLS posture';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."User"', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."User"', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."User"', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."User"', 'DELETE'
     ) THEN
    RAISE EXCEPTION
      'Conversation inbox convergence requires predecessor User CRUD grants';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN ('Conversation', 'Message')
       AND class.relkind = 'r'
       AND class.relrowsecurity
       AND class.relforcerowsecurity
  ) <> 2 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_policy AS policy
      JOIN pg_catalog.pg_class AS class
        ON class.oid = policy.polrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN ('Conversation', 'Message')
  ) <> 2 THEN
    RAISE EXCEPTION
      'Conversation inbox convergence requires accepted Conversation/Message FORCE posture';
  END IF;

  inbox_oid := pg_catalog.to_regprocedure(
    'public.grainline_conversation_inbox(text,boolean,text,timestamp without time zone,text,integer)'
  );
  participant_oid := pg_catalog.to_regprocedure(
    'public.grainline_user_conversation_participants(text,text)'
  );
  claim_trigger_oid := pg_catalog.to_regprocedure(
    'public.grainline_case_resolution_claim_immutable()'
  );
  IF inbox_oid IS NULL OR participant_oid IS NULL OR claim_trigger_oid IS NULL THEN
    RAISE EXCEPTION
      'Conversation inbox convergence prerequisite function is missing';
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
    pg_catalog.md5(procedure.prosrc) AS source_md5,
    pg_catalog.has_function_privilege(
      'grainline_app_runtime', procedure.oid, 'EXECUTE'
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
    (
      SELECT pg_catalog.count(*)::integer
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
       WHERE acl.grantee NOT IN (0, procedure.proowner, runtime_role_oid)
         AND acl.privilege_type = 'EXECUTE'
    ) AS other_execute_count
    INTO STRICT actual
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
   WHERE procedure.oid = inbox_oid;

  IF actual.prokind IS DISTINCT FROM 'f'
     OR actual.prosecdef
     OR actual.proleakproof
     OR actual.provolatile IS DISTINCT FROM 'v'
     OR actual.proparallel IS DISTINCT FROM 'u'
     OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR actual.proowner IS DISTINCT FROM table_owner
     OR actual.language_name IS DISTINCT FROM 'plpgsql'
     OR actual.source_md5 IS DISTINCT FROM '2a7fceb40f06e9934749c06516209f3a'
     OR NOT actual.runtime_execute
     OR actual.public_execute
     OR actual.other_execute_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation inbox predecessor source, mode, owner or ACL drifted: kind=%, definer=%, leakproof=%, volatility=%, parallel=%, config=%, owner_match=%, language=%, source_md5=%, runtime_execute=%, public_execute=%, other_execute_count=%',
      actual.prokind,
      actual.prosecdef,
      actual.proleakproof,
      actual.provolatile,
      actual.proparallel,
      actual.proconfig,
      actual.proowner IS NOT DISTINCT FROM table_owner,
      actual.language_name,
      actual.source_md5,
      actual.runtime_execute,
      actual.public_execute,
      actual.other_execute_count;
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
    pg_catalog.md5(procedure.prosrc) AS source_md5,
    pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') > 0
      AS contains_dynamic_execute,
    pg_catalog.has_function_privilege(
      'grainline_app_runtime', procedure.oid, 'EXECUTE'
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
    (
      SELECT pg_catalog.count(*)::integer
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
       WHERE acl.grantee NOT IN (0, procedure.proowner, runtime_role_oid)
         AND acl.privilege_type = 'EXECUTE'
    ) AS other_execute_count
    INTO STRICT actual
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
   WHERE procedure.oid = participant_oid;

  IF actual.prokind IS DISTINCT FROM 'f'
     OR NOT actual.prosecdef
     OR actual.proleakproof
     OR actual.provolatile IS DISTINCT FROM 'v'
     OR actual.proparallel IS DISTINCT FROM 'u'
     OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR actual.proowner IS DISTINCT FROM table_owner
     OR actual.language_name IS DISTINCT FROM 'plpgsql'
     OR actual.source_md5 IS DISTINCT FROM '44c3946959d09676749bdf7e0c9e286c'
     OR actual.contains_dynamic_execute
     OR NOT actual.runtime_execute
     OR actual.public_execute
     OR actual.other_execute_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation participant authority source, mode, owner or ACL drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'CaseResolutionClaim'
       AND class.relkind = 'r'
       AND class.relowner = table_owner
       AND class.relrowsecurity
       AND class.relforcerowsecurity
       AND NOT pg_catalog.has_table_privilege(
         'grainline_app_runtime', class.oid, 'SELECT'
       )
       AND NOT pg_catalog.has_table_privilege(
         'grainline_app_runtime', class.oid, 'INSERT'
       )
       AND NOT pg_catalog.has_table_privilege(
         'grainline_app_runtime', class.oid, 'UPDATE'
       )
       AND NOT pg_catalog.has_table_privilege(
         'grainline_app_runtime', class.oid, 'DELETE'
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
      JOIN pg_catalog.pg_class AS class
        ON class.oid = policy.polrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'CaseResolutionClaim'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger
      JOIN pg_catalog.pg_class AS class
        ON class.oid = trigger.tgrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'CaseResolutionClaim'
       AND trigger.tgname = 'grainline_case_resolution_claim_immutable'
       AND NOT trigger.tgisinternal
       AND trigger.tgenabled = 'O'
       AND trigger.tgfoid = claim_trigger_oid
  ) THEN
    RAISE EXCEPTION
      'Case resolution claim trigger or private-table posture drifted';
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
    pg_catalog.md5(procedure.prosrc) AS source_md5,
    pg_catalog.has_function_privilege(
      'grainline_app_runtime', procedure.oid, 'EXECUTE'
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
    (
      SELECT pg_catalog.count(*)::integer
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
       WHERE acl.grantee NOT IN (0, procedure.proowner, runtime_role_oid)
         AND acl.privilege_type = 'EXECUTE'
    ) AS other_execute_count
    INTO STRICT actual
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
   WHERE procedure.oid = claim_trigger_oid;

  IF actual.prokind IS DISTINCT FROM 'f'
     OR actual.prosecdef
     OR actual.proleakproof
     OR actual.provolatile IS DISTINCT FROM 'v'
     OR actual.proparallel IS DISTINCT FROM 'u'
     OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR actual.proowner IS DISTINCT FROM table_owner
     OR actual.language_name IS DISTINCT FROM 'plpgsql'
     OR actual.source_md5 IS DISTINCT FROM '06289e9db780c559e07188c20e680887'
     OR actual.runtime_execute
     OR actual.public_execute
     OR actual.other_execute_count <> 0 THEN
    RAISE EXCEPTION
      'Case resolution claim trigger source, mode, owner or ACL drifted';
  END IF;
END
$grainline_conversation_inbox_user_authority_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_conversation_inbox(
  p_user_id text,
  p_archived boolean,
  p_query text,
  p_before_at timestamp(3),
  p_before_id text,
  p_limit integer
)
RETURNS TABLE (
  id text,
  "userAId" text,
  "userBId" text,
  "userAName" text,
  "userAImageUrl" text,
  "userBName" text,
  "userBImageUrl" text,
  "updatedAt" timestamp(3),
  "archivedAAt" timestamp(3),
  "archivedBAt" timestamp(3),
  "contextListingId" text,
  "contextListingTitle" text,
  "contextListingPhotoUrl" text,
  "latestMessageId" text,
  "latestMessageBody" text,
  "latestMessageKind" text,
  "latestMessageCreatedAt" timestamp(3),
  "latestMessageSenderId" text,
  "unreadCount" bigint
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_conversation_inbox$
DECLARE
  bounded_limit integer;
  bounded_query text;
  search_pattern text;
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'conversation inbox actor is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_archived IS NULL THEN
    RAISE EXCEPTION 'conversation inbox archive state is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_query IS NOT NULL AND pg_catalog.char_length(p_query) > 200 THEN
    RAISE EXCEPTION 'conversation inbox query is too long' USING ERRCODE = '22023';
  END IF;
  IF (p_before_at IS NULL) <> (p_before_id IS NULL)
     OR (
       p_before_id IS NOT NULL
       AND (
         p_before_id = ''
         OR pg_catalog.char_length(p_before_id) > 191
       )
     ) THEN
    RAISE EXCEPTION 'conversation inbox cursor is invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
    RAISE EXCEPTION 'conversation inbox actor context was not set'
      USING ERRCODE = '55000';
  END IF;
  bounded_limit := GREATEST(1, LEAST(COALESCE(p_limit, 51), 51));
  bounded_query := pg_catalog.btrim(COALESCE(p_query, ''));
  search_pattern := '%' ||
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(bounded_query, E'\\', E'\\\\'),
        '%',
        E'\\%'
      ),
      '_',
      E'\\_'
    ) || '%';

  RETURN QUERY
  SELECT
    conversation.id,
    conversation."userAId",
    conversation."userBId",
    participants."userAName",
    participants."userAImageUrl",
    participants."userBName",
    participants."userBImageUrl",
    conversation."updatedAt",
    conversation."archivedAAt",
    conversation."archivedBAt",
    listing.id,
    listing.title::text,
    listing_photo.url::text,
    latest_message.id,
    latest_message.body::text,
    latest_message.kind::text,
    latest_message."createdAt",
    latest_message."senderId",
    (
      SELECT pg_catalog.count(*)
        FROM public."Message" AS unread_message
       WHERE unread_message."conversationId" = conversation.id
         AND unread_message."recipientId" = p_user_id
         AND unread_message."readAt" IS NULL
    ) AS unread_count
    FROM public."Conversation" AS conversation
    JOIN LATERAL (
      SELECT
        pg_catalog.max(participant.name)
          FILTER (WHERE participant.id = conversation."userAId")::text
          AS "userAName",
        pg_catalog.max(participant."imageUrl")
          FILTER (WHERE participant.id = conversation."userAId")::text
          AS "userAImageUrl",
        pg_catalog.max(participant.name)
          FILTER (WHERE participant.id = conversation."userBId")::text
          AS "userBName",
        pg_catalog.max(participant."imageUrl")
          FILTER (WHERE participant.id = conversation."userBId")::text
          AS "userBImageUrl"
        FROM public.grainline_user_conversation_participants(
          p_user_id,
          conversation.id
        ) AS participant
       HAVING pg_catalog.count(*) = 2
          AND pg_catalog.count(DISTINCT participant.id) = 2
    ) AS participants ON true
    JOIN LATERAL (
      SELECT
        message.id,
        message.body,
        message.kind,
        message."createdAt",
        message."senderId"
        FROM public."Message" AS message
       WHERE message."conversationId" = conversation.id
       ORDER BY message."createdAt" DESC, message.id DESC
       LIMIT 1
    ) AS latest_message ON true
    LEFT JOIN public."Listing" AS listing
      ON listing.id = conversation."contextListingId"
    LEFT JOIN LATERAL (
      SELECT photo.url
        FROM public."Photo" AS photo
       WHERE photo."listingId" = listing.id
       ORDER BY photo."sortOrder" ASC, photo.id ASC
       LIMIT 1
    ) AS listing_photo ON true
   WHERE p_user_id IN (conversation."userAId", conversation."userBId")
     AND (
       (
         p_archived
         AND (
           (conversation."userAId" = p_user_id
            AND conversation."archivedAAt" IS NOT NULL)
           OR
           (conversation."userBId" = p_user_id
            AND conversation."archivedBAt" IS NOT NULL)
         )
       )
       OR
       (
         NOT p_archived
         AND (
           (conversation."userAId" = p_user_id
            AND conversation."archivedAAt" IS NULL)
           OR
           (conversation."userBId" = p_user_id
            AND conversation."archivedBAt" IS NULL)
         )
       )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public."Block" AS block
        WHERE (
          block."blockerId" = conversation."userAId"
          AND block."blockedId" = conversation."userBId"
        )
        OR (
          block."blockerId" = conversation."userBId"
          AND block."blockedId" = conversation."userAId"
        )
     )
     AND (
       bounded_query = ''
       OR participants."userAName" ILIKE search_pattern ESCAPE '\'
       OR participants."userBName" ILIKE search_pattern ESCAPE '\'
       OR listing.title ILIKE search_pattern ESCAPE '\'
       OR EXISTS (
         SELECT 1
           FROM public."Message" AS searched_message
          WHERE searched_message."conversationId" = conversation.id
            AND searched_message.body ILIKE search_pattern ESCAPE '\'
       )
     )
     AND (
       p_before_at IS NULL
       OR conversation."updatedAt" < p_before_at
       OR (
         conversation."updatedAt" = p_before_at
         AND conversation.id < p_before_id
       )
     )
   ORDER BY conversation."updatedAt" DESC, conversation.id DESC
   LIMIT bounded_limit;
END;
$grainline_conversation_inbox$;

REVOKE ALL ON FUNCTION public.grainline_conversation_inbox(
  text,
  boolean,
  text,
  timestamp,
  text,
  integer
) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_conversation_inbox(
  text,
  boolean,
  text,
  timestamp,
  text,
  integer
) TO grainline_app_runtime;

ALTER FUNCTION public.grainline_case_resolution_claim_immutable()
  SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.grainline_case_resolution_claim_immutable()
  FROM PUBLIC, grainline_app_runtime;

DO $grainline_conversation_inbox_user_authority_postflight$
DECLARE
  runtime_role_oid oid;
  actual record;
BEGIN
  SELECT role.oid
    INTO STRICT runtime_role_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';

  SELECT
    procedure.prosecdef,
    procedure.proleakproof,
    procedure.provolatile,
    procedure.proparallel,
    procedure.proconfig,
    pg_catalog.md5(procedure.prosrc) AS source_md5,
    pg_catalog.strpos(
      procedure.prosrc,
      'grainline_user_conversation_participants'
    ) > 0 AS uses_participant_authority,
    pg_catalog.strpos(procedure.prosrc, 'public."User"') > 0
      AS uses_user_table,
    pg_catalog.has_function_privilege(
      'grainline_app_runtime', procedure.oid, 'EXECUTE'
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
    (
      SELECT pg_catalog.count(*)::integer
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
       WHERE acl.grantee NOT IN (0, procedure.proowner, runtime_role_oid)
         AND acl.privilege_type = 'EXECUTE'
    ) AS other_execute_count
    INTO STRICT actual
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = pg_catalog.to_regprocedure(
     'public.grainline_conversation_inbox(text,boolean,text,timestamp without time zone,text,integer)'
   );

  IF actual.prosecdef
     OR actual.proleakproof
     OR actual.provolatile IS DISTINCT FROM 'v'
     OR actual.proparallel IS DISTINCT FROM 'u'
     OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR actual.source_md5 IS DISTINCT FROM '4b2884765f4ca0db432c4678f98b1bdd'
     OR NOT actual.uses_participant_authority
     OR actual.uses_user_table
     OR NOT actual.runtime_execute
     OR actual.public_execute
     OR actual.other_execute_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation inbox User-authority convergence postflight failed';
  END IF;

  SELECT
    procedure.prosecdef,
    procedure.proleakproof,
    procedure.provolatile,
    procedure.proparallel,
    procedure.proconfig,
    pg_catalog.md5(procedure.prosrc) AS source_md5,
    pg_catalog.has_function_privilege(
      'grainline_app_runtime', procedure.oid, 'EXECUTE'
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
    (
      SELECT pg_catalog.count(*)::integer
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
       WHERE acl.grantee NOT IN (0, procedure.proowner, runtime_role_oid)
         AND acl.privilege_type = 'EXECUTE'
    ) AS other_execute_count
    INTO STRICT actual
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = pg_catalog.to_regprocedure(
     'public.grainline_case_resolution_claim_immutable()'
   );

  IF NOT actual.prosecdef
     OR actual.proleakproof
     OR actual.provolatile IS DISTINCT FROM 'v'
     OR actual.proparallel IS DISTINCT FROM 'u'
     OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR actual.source_md5 IS DISTINCT FROM '06289e9db780c559e07188c20e680887'
     OR actual.runtime_execute
     OR actual.public_execute
     OR actual.other_execute_count <> 0 THEN
    RAISE EXCEPTION
      'Case resolution claim trigger convergence postflight failed';
  END IF;
END
$grainline_conversation_inbox_user_authority_postflight$;

COMMIT;
