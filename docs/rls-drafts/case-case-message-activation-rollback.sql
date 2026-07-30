-- DRAFT ONLY. Do not apply to any persistent database.
--
-- Database-first rollback for the initial ENABLE activation. This restores
-- the pre-activation table posture for an emergency old-application rollback.
-- It changes no row, function, invariant or private service ledger.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.case.rls.activation', 0)
);

LOCK TABLE
  public."Case",
  public."CaseMessage",
  public."CaseMessageAttachment"
IN ACCESS EXCLUSIVE MODE;

DO $grainline_case_activation_rollback_preflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
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
     AND NOT class.relforcerowsecurity
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       class.oid,
       'SELECT,INSERT,UPDATE,DELETE'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     );
  IF accepted_table_count <> 3 THEN
    RAISE EXCEPTION
      'Case activation rollback predecessor drifted: %',
      accepted_table_count;
  END IF;
END
$grainline_case_activation_rollback_preflight$;

ALTER TABLE public."Case" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."Case" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."CaseMessage" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CaseMessage" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."CaseMessageAttachment" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CaseMessageAttachment" DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."Case"
  TO grainline_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."CaseMessage"
  TO grainline_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."CaseMessageAttachment"
  TO grainline_app_runtime;

DO $grainline_case_activation_rollback_postflight$
DECLARE
  restored_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO restored_table_count
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
     AND NOT class.relrowsecurity
     AND NOT class.relforcerowsecurity
     AND pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       class.oid,
       'SELECT,INSERT,UPDATE,DELETE'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     );
  IF restored_table_count <> 3 THEN
    RAISE EXCEPTION
      'Case activation rollback did not restore predecessor posture: %',
      restored_table_count;
  END IF;
END
$grainline_case_activation_rollback_postflight$;

COMMIT;
