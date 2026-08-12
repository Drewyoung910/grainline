\set ON_ERROR_STOP on

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;

DO $grainline_case_resolution_window_production_postflight$
DECLARE
  reviewed_migration_count integer;
  queued_migration_count integer;
  cron_function_count integer;
  participant_function_count integer;
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
         '1297332140016e0ae9dfba6509d1d3d34d6fd8400e9bf12901ab42ec90b10d40'
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

  SELECT pg_catalog.count(*)::integer
    INTO participant_function_count
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
     )
     AND pg_catalog.pg_get_functiondef(procedure.oid) ~
         'audit_id_prefix :=[[:space:]]+''case_resolution_mark_'''
     AND pg_catalog.pg_get_functiondef(procedure.oid) ~
         'pg_catalog\.gen_random_uuid\(\)::text'
     AND pg_catalog.pg_get_functiondef(procedure.oid) ~
         'audit_id := existing_audit\.id'
     AND pg_catalog.pg_get_functiondef(procedure.oid) ~
         'locked_case\."updatedAt"'
     AND pg_catalog.pg_get_functiondef(procedure.oid) !~
         'p_audit|p_dedup|p_source_id';
  IF participant_function_count <> 1 THEN
    RAISE EXCEPTION
      'Case participant-resolution function catalog drifted: %',
      participant_function_count;
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
