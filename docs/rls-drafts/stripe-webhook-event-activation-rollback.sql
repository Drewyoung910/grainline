-- DRAFT ONLY. Do not apply to any persistent database.
--
-- Database-first emergency rollback for the initial policyless ENABLE
-- activation. Restore direct predecessor CRUD before rolling the application
-- back to a version that still touches StripeWebhookEvent directly.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.stripe-webhook-event.rls.activation', 0)
);

LOCK TABLE public."StripeWebhookEvent" IN ACCESS EXCLUSIVE MODE;

DO $grainline_stripe_webhook_event_activation_rollback_preflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'StripeWebhookEvent'
     AND class.relkind = 'r'
     AND class.relrowsecurity
     AND NOT class.relforcerowsecurity
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION
      'StripeWebhookEvent activation rollback predecessor drifted';
  END IF;
END
$grainline_stripe_webhook_event_activation_rollback_preflight$;

ALTER TABLE public."StripeWebhookEvent" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."StripeWebhookEvent" DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."StripeWebhookEvent"
  TO grainline_app_runtime;

DO $grainline_stripe_webhook_event_activation_rollback_postflight$
DECLARE
  restored_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO restored_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'StripeWebhookEvent'
     AND class.relkind = 'r'
     AND NOT class.relrowsecurity
     AND NOT class.relforcerowsecurity
     AND pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid, 'SELECT'
     )
     AND pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid, 'INSERT'
     )
     AND pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid, 'UPDATE'
     )
     AND pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid, 'DELETE'
     )
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     );
  IF restored_table_count <> 1 THEN
    RAISE EXCEPTION
      'StripeWebhookEvent activation rollback did not restore predecessor';
  END IF;
END
$grainline_stripe_webhook_event_activation_rollback_postflight$;

COMMIT;
