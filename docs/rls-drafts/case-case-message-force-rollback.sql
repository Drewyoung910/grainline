-- DRAFT ONLY. Do not apply to any persistent database.
--
-- Post-FORCE rollback. This restores the accepted policyless ENABLE posture
-- and changes no row, policy, grant, function, invariant or private ledger.

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

DO $grainline_case_force_rollback_preflight$
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
     AND class.relforcerowsecurity
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
         FROM pg_catalog.aclexplode(
           COALESCE(
             class.relacl,
             pg_catalog.acldefault('r', class.relowner)
           )
         ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type IN (
            'SELECT',
            'INSERT',
            'UPDATE',
            'DELETE',
            'TRUNCATE',
            'REFERENCES',
            'TRIGGER'
          )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = class.oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND acl.grantee = 0
          AND acl.privilege_type IN (
            'SELECT',
            'INSERT',
            'UPDATE',
            'REFERENCES'
          )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     );
  IF accepted_table_count <> 3 THEN
    RAISE EXCEPTION
      'Case FORCE rollback predecessor drifted: %',
      accepted_table_count;
  END IF;
END
$grainline_case_force_rollback_preflight$;

ALTER TABLE public."Case" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CaseMessage" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CaseMessageAttachment" NO FORCE ROW LEVEL SECURITY;

DO $grainline_case_force_rollback_postflight$
DECLARE
  enabled_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO enabled_table_count
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
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_app_runtime',
       class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             class.relacl,
             pg_catalog.acldefault('r', class.relowner)
           )
         ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type IN (
            'SELECT',
            'INSERT',
            'UPDATE',
            'DELETE',
            'TRUNCATE',
            'REFERENCES',
            'TRIGGER'
          )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = class.oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND acl.grantee = 0
          AND acl.privilege_type IN (
            'SELECT',
            'INSERT',
            'UPDATE',
            'REFERENCES'
          )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     );
  IF enabled_table_count <> 3 THEN
    RAISE EXCEPTION
      'Case FORCE rollback did not restore ENABLE posture: %',
      enabled_table_count;
  END IF;
END
$grainline_case_force_rollback_postflight$;

COMMIT;
