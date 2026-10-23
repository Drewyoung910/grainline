-- Resend's email.failed event is not a recipient-level transient bounce. It
-- may report provider configuration, API-key, quota, or invalid-message
-- failures. The predecessor handler incorrectly promoted five such events to
-- a durable BOUNCE suppression. Remove only suppressions written by that exact
-- predecessor path and its now-obsolete counters. Provider bounce, complaint,
-- manual, and account-deletion suppressions are left unchanged.

DELETE FROM public."EmailSuppression"
WHERE source = 'resend_transient_failure'
  AND reason = 'BOUNCE'::public."EmailSuppressionReason";

DELETE FROM public."EmailFailureCount";
