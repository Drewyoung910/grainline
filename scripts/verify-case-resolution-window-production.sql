\set ON_ERROR_STOP on

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;

DO $grainline_case_resolution_window_production_postflight$
DECLARE
  reviewed_migration_count integer;
  queued_migration_count integer;
  cron_function_count integer;
  participant_function_count integer;
  participant_function_oid oid;
  participant_function_definition text;
  participant_body_issues text[] := ARRAY[]::text[];
  forced_table_count integer;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation')
       <> 'repeatable read'
     OR pg_catalog.current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION
      'Case resolution-window postflight is not engine-enforced read-only';
  END IF;

  IF CURRENT_USER NOT IN ('ci', 'neondb_owner')
     OR SESSION_USER IS DISTINCT FROM CURRENT_USER THEN
    RAISE EXCEPTION
      'Case resolution-window postflight database identity drifted: %/%',
      CURRENT_USER,
      SESSION_USER;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO reviewed_migration_count
    FROM public._prisma_migrations AS migration
   WHERE migration.migration_name =
         '20260811170000_align_case_resolution_window'
     AND migration.checksum =
         'b73f0887935cfd45ed15065c2807e3a556ddffcb8154f5bba8b29ae2981e1387'
     AND migration.finished_at IS NOT NULL
     AND migration.rolled_back_at IS NULL
     AND migration.applied_steps_count = 1;
  IF reviewed_migration_count <> 1 THEN
    RAISE EXCEPTION
      'Case resolution-window migration ledger drifted: %',
      reviewed_migration_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO queued_migration_count
    FROM public._prisma_migrations AS migration
   WHERE migration.migration_name IN (
     '20260810172000_force_stripe_webhook_event_rls',
     '20260810190000_prepare_checkout_stock_reservation_authority'
   )
     AND migration.finished_at IS NOT NULL
     AND migration.rolled_back_at IS NULL;
  IF queued_migration_count <> 0 THEN
    RAISE EXCEPTION
      'Case resolution-window release crossed a queued migration boundary: %',
      queued_migration_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO cron_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = 'grainline_case_cron_transition_batch'
     AND pg_catalog.oidvectortypes(procedure.proargtypes) = 'text, integer'
     AND procedure.prokind = 'f'
     AND procedure.prosecdef
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND procedure.proconfig IS NOT DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
     AND procedure.proowner = pg_catalog.to_regrole(CURRENT_USER)
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
     AND pg_catalog.pg_get_functiondef(procedure.oid) ~
         'case_row\."buyerMarkedResolved" = true[[:space:]]+AND case_row\."sellerMarkedResolved" = false'
     AND pg_catalog.pg_get_functiondef(procedure.oid) ~
         'locked_case\."buyerMarkedResolved" IS DISTINCT FROM true[[:space:]]+OR locked_case\."sellerMarkedResolved" IS DISTINCT FROM false'
     AND pg_catalog.pg_get_functiondef(procedure.oid) ~
         'audit_reason := ''Buyer resolution window expired'''
     AND pg_catalog.pg_get_functiondef(procedure.oid) !~
         'locked_case\."sellerMarkedResolved" IS DISTINCT FROM true';
  IF cron_function_count <> 1 THEN
    RAISE EXCEPTION
      'Case resolution-window function catalog drifted: %',
      cron_function_count;
  END IF;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.min(procedure.oid)
    INTO participant_function_count, participant_function_oid
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = 'grainline_case_mark_resolved'
     AND pg_catalog.oidvectortypes(procedure.proargtypes) = 'text, text'
     AND procedure.prokind = 'f'
     AND procedure.prosecdef
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND procedure.proconfig IS NOT DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
     AND procedure.proowner = pg_catalog.to_regrole(CURRENT_USER)
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
  IF participant_function_count <> 1 THEN
    RAISE EXCEPTION
      'Case participant-resolution function authority drifted: %',
      participant_function_count;
  END IF;

  SELECT pg_catalog.pg_get_functiondef(participant_function_oid)
    INTO STRICT participant_function_definition;

  IF pg_catalog.strpos(
       participant_function_definition,
       'audit_id_prefix :='
     ) = 0 THEN
    participant_body_issues := pg_catalog.array_append(
      participant_body_issues,
      'audit-prefix assignment missing'
    );
  END IF;
  IF pg_catalog.strpos(
       participant_function_definition,
       '''case_resolution_mark_'''
     ) = 0 THEN
    participant_body_issues := pg_catalog.array_append(
      participant_body_issues,
      'audit-prefix value missing'
    );
  END IF;
  IF pg_catalog.strpos(
       participant_function_definition,
       'pg_catalog.gen_random_uuid()'
     ) = 0 THEN
    participant_body_issues := pg_catalog.array_append(
      participant_body_issues,
      'database nonce missing'
    );
  END IF;
  IF pg_catalog.strpos(
       participant_function_definition,
       'audit_id := existing_audit.id'
     ) = 0 THEN
    participant_body_issues := pg_catalog.array_append(
      participant_body_issues,
      'stable replay assignment missing'
    );
  END IF;
  IF pg_catalog.strpos(
       participant_function_definition,
       'ORDER BY audit."createdAt" DESC, audit.id DESC'
     ) = 0 THEN
    participant_body_issues := pg_catalog.array_append(
      participant_body_issues,
      'newest-audit ordering missing'
    );
  END IF;
  IF pg_catalog.strpos(
       participant_function_definition,
       '~ ''^[0-9a-f]{32}$'''
     ) = 0 THEN
    participant_body_issues := pg_catalog.array_append(
      participant_body_issues,
      'cycle-suffix validation missing'
    );
  END IF;
  IF pg_catalog.strpos(
       participant_function_definition,
       'actor_is_buyer AND locked_case."buyerMarkedResolved"'
     ) = 0 THEN
    participant_body_issues := pg_catalog.array_append(
      participant_body_issues,
      'active buyer-mark replay gate missing'
    );
  END IF;
  IF pg_catalog.strpos(
       participant_function_definition,
       'actor_is_seller AND locked_case."sellerMarkedResolved"'
     ) = 0 THEN
    participant_body_issues := pg_catalog.array_append(
      participant_body_issues,
      'active seller-mark replay gate missing'
    );
  END IF;
  IF participant_function_definition ~
       'p_audit|p_dedup|p_source_id' THEN
    participant_body_issues := pg_catalog.array_append(
      participant_body_issues,
      'caller-controlled source parameter present'
    );
  END IF;
  IF participant_function_definition ~
       'existing_audit\.metadata[[:space:]]*->[[:space:]]*>[[:space:]]*''at''[[:space:]]*=[[:space:]]*pg_catalog\.to_char\([[:space:]]*locked_case\."updatedAt"' THEN
    participant_body_issues := pg_catalog.array_append(
      participant_body_issues,
      'timestamp-coupled replay predicate present'
    );
  END IF;
  IF pg_catalog.cardinality(participant_body_issues) <> 0 THEN
    RAISE EXCEPTION
      'Case participant-resolution function body drifted: %',
      pg_catalog.array_to_string(participant_body_issues, '; ');
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO forced_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN (
       'Case',
       'CaseMessage',
       'CaseMessageAttachment'
     )
     AND class.relkind = 'r'
     AND class.relrowsecurity
     AND class.relforcerowsecurity
     AND class.relowner = pg_catalog.to_regrole(CURRENT_USER)
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_app_runtime',
       class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     );
  IF forced_table_count <> 3 THEN
    RAISE EXCEPTION
      'Case resolution-window FORCE posture drifted: %',
      forced_table_count;
  END IF;
END
$grainline_case_resolution_window_production_postflight$;

ROLLBACK;
