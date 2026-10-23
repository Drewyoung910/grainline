-- Resend's email.failed event is not a recipient-level transient bounce. It
-- may report provider configuration, API-key, quota, or invalid-message
-- failures. The predecessor handler incorrectly promoted five such events to
-- a durable BOUNCE suppression. Remove only suppressions written by that exact
-- predecessor path and its now-obsolete counters. Provider bounce, complaint,
-- manual, and account-deletion suppressions are left unchanged.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.email-suppression.c715-repair', 0)
);

LOCK TABLE
  public."EmailFailureCount",
  public."EmailSuppression"
IN SHARE ROW EXCLUSIVE MODE;

DO $email_suppression_recovery_preflight$
DECLARE
  accepted_table_count integer;
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'Email suppression recovery requires a direct owner session';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    JOIN pg_catalog.pg_roles AS owner
      ON owner.oid = class.relowner
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('EmailFailureCount', 'EmailSuppression')
     AND class.relkind = 'r'
     AND owner.rolname = current_user;
  IF accepted_table_count <> 2 THEN
    RAISE EXCEPTION 'Email suppression recovery table ownership drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."EmailSuppression"
     WHERE source = 'resend_transient_failure'
       AND reason <> 'BOUNCE'::public."EmailSuppressionReason"
  ) THEN
    RAISE EXCEPTION 'Email suppression recovery source contains an unreviewed reason';
  END IF;
END
$email_suppression_recovery_preflight$;

DELETE FROM public."EmailFailureCount";

DELETE FROM public."EmailSuppression"
WHERE source = 'resend_transient_failure'
  AND reason = 'BOUNCE'::public."EmailSuppressionReason";

DO $email_suppression_recovery_postflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."EmailSuppression"
     WHERE source = 'resend_transient_failure'
  ) OR EXISTS (
    SELECT 1
      FROM public."EmailFailureCount"
  ) THEN
    RAISE EXCEPTION 'Email suppression recovery postflight failed';
  END IF;
END
$email_suppression_recovery_postflight$;

COMMIT;
