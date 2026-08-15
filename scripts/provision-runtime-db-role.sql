-- Grainline least-privilege runtime-role grants.
--
-- Run this only against staging first, from the same environment/secret set
-- that will run migrations:
--
--   psql "$DIRECT_URL" \
--     -v runtime_role=grainline_app_runtime \
--     -v migration_role=grainline_migration_owner \
--     -f scripts/provision-runtime-db-role.sql
--
-- The runtime role must already exist with a secret managed outside git:
--
--   CREATE ROLE grainline_app_runtime
--     LOGIN PASSWORD '[REDACTED]'
--     NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
--
-- Do not replace the explicit table allowlist below with GRANT ON ALL TABLES.
-- Default privileges intentionally apply to future tables, so migrations that
-- create non-model public tables must either add them to the grant audit
-- inventory or REVOKE runtime access in the same migration.

\set ON_ERROR_STOP on

\if :{?runtime_role}
\else
\echo 'missing required psql variable: -v runtime_role=grainline_app_runtime'
DO $grainline_role_provisioning_abort$
BEGIN
  RAISE EXCEPTION 'runtime-role provisioning refused';
END
$grainline_role_provisioning_abort$;
\endif

\if :{?migration_role}
\else
\echo 'missing required psql variable: -v migration_role=grainline_migration_owner'
DO $grainline_role_provisioning_abort$
BEGIN
  RAISE EXCEPTION 'runtime-role provisioning refused';
END
$grainline_role_provisioning_abort$;
\endif

WITH failure AS (
  SELECT format(
    'expected current_user and session_user to equal migration role %s, got current_user=%s session_user=%s',
    :'migration_role',
    current_user,
    session_user
  ) AS message
  WHERE current_user <> :'migration_role' OR session_user <> :'migration_role'
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_role_provisioning_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '') AS grainline_role_provisioning_failure;
\gset
\if :grainline_role_provisioning_failed
\echo :grainline_role_provisioning_failure
DO $grainline_role_provisioning_abort$
BEGIN
  RAISE EXCEPTION 'runtime-role provisioning refused';
END
$grainline_role_provisioning_abort$;
\endif
\unset grainline_role_provisioning_failed
\unset grainline_role_provisioning_failure

WITH failure AS (
  SELECT format('runtime role %s does not exist', :'runtime_role') AS message
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_role')
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_role_provisioning_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '') AS grainline_role_provisioning_failure;
\gset
\if :grainline_role_provisioning_failed
\echo :grainline_role_provisioning_failure
DO $grainline_role_provisioning_abort$
BEGIN
  RAISE EXCEPTION 'runtime-role provisioning refused';
END
$grainline_role_provisioning_abort$;
\endif
\unset grainline_role_provisioning_failed
\unset grainline_role_provisioning_failure

WITH failure AS (
  SELECT format('migration role %s does not exist', :'migration_role') AS message
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migration_role')
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_role_provisioning_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '') AS grainline_role_provisioning_failure;
\gset
\if :grainline_role_provisioning_failed
\echo :grainline_role_provisioning_failure
DO $grainline_role_provisioning_abort$
BEGIN
  RAISE EXCEPTION 'runtime-role provisioning refused';
END
$grainline_role_provisioning_abort$;
\endif
\unset grainline_role_provisioning_failed
\unset grainline_role_provisioning_failure

WITH failure AS (
  SELECT format('runtime role %s must differ from migration role %s', :'runtime_role', :'migration_role')
    AS message
  WHERE :'runtime_role' = :'migration_role'
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_role_provisioning_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '') AS grainline_role_provisioning_failure;
\gset
\if :grainline_role_provisioning_failed
\echo :grainline_role_provisioning_failure
DO $grainline_role_provisioning_abort$
BEGIN
  RAISE EXCEPTION 'runtime-role provisioning refused';
END
$grainline_role_provisioning_abort$;
\endif
\unset grainline_role_provisioning_failed
\unset grainline_role_provisioning_failure

WITH failure AS (
  SELECT format(
    'runtime role %s has disallowed role attributes: %s',
    rolname,
    concat_ws(
      ', ',
      CASE WHEN rolsuper THEN 'SUPERUSER' END,
      CASE WHEN rolcreatedb THEN 'CREATEDB' END,
      CASE WHEN rolcreaterole THEN 'CREATEROLE' END,
      CASE WHEN rolreplication THEN 'REPLICATION' END,
      CASE WHEN rolbypassrls THEN 'BYPASSRLS' END
    )
  ) AS message
  FROM pg_roles
  WHERE rolname = :'runtime_role'
    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_role_provisioning_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '') AS grainline_role_provisioning_failure;
\gset
\if :grainline_role_provisioning_failed
\echo :grainline_role_provisioning_failure
DO $grainline_role_provisioning_abort$
BEGIN
  RAISE EXCEPTION 'runtime-role provisioning refused';
END
$grainline_role_provisioning_abort$;
\endif
\unset grainline_role_provisioning_failed
\unset grainline_role_provisioning_failure

-- The production runtime principal must be able to authenticate, while
-- NOINHERIT ensures any future accidental membership does not become an
-- implicit privilege path before the membership-free guard catches it.
BEGIN;

SELECT format('ALTER ROLE %I LOGIN NOINHERIT', :'runtime_role');
\gexec

WITH RECURSIVE memberships AS (
    SELECT parent.oid, parent.rolname
      FROM pg_auth_members m
      JOIN pg_roles child ON child.oid = m.member
      JOIN pg_roles parent ON parent.oid = m.roleid
     WHERE child.rolname = :'runtime_role'
    UNION
    SELECT parent.oid, parent.rolname
      FROM memberships current_membership
      JOIN pg_auth_members m ON m.member = current_membership.oid
      JOIN pg_roles parent ON parent.oid = m.roleid
), failure AS (
  SELECT format('runtime role %s is member of role %s', :'runtime_role', rolname) AS message
  FROM memberships
  ORDER BY rolname
  LIMIT 1
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_role_provisioning_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '') AS grainline_role_provisioning_failure;
\gset
\if :grainline_role_provisioning_failed
\echo :grainline_role_provisioning_failure
DO $grainline_role_provisioning_abort$
BEGIN
  RAISE EXCEPTION 'runtime-role provisioning refused';
END
$grainline_role_provisioning_abort$;
\endif
\unset grainline_role_provisioning_failed
\unset grainline_role_provisioning_failure

GRANT USAGE ON SCHEMA public TO :"runtime_role";
REVOKE CREATE ON SCHEMA public FROM :"runtime_role";
SELECT format('REVOKE CREATE ON DATABASE %I FROM %I', current_database(), :'runtime_role');
\gexec

-- Converge historical direct grants without relying on a version-specific list
-- of table privileges. PostgreSQL 17 added MAINTAIN, for example. Public grants
-- are intentionally not mutated here; the grant audit fails if they widen the
-- runtime role and requires an explicit reviewed PUBLIC change.
WITH runtime_role AS (
  SELECT oid
    FROM pg_roles
   WHERE rolname = :'runtime_role'
), column_grants AS (
  SELECT
    n.nspname,
    c.relname,
    upper(acl.privilege_type) AS privilege_type,
    string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum) AS columns
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  CROSS JOIN runtime_role
  CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND acl.grantee = runtime_role.oid
  GROUP BY n.nspname, c.relname, upper(acl.privilege_type)
)
SELECT format(
  'REVOKE %s (%s) ON TABLE %I.%I FROM %I',
  privilege_type,
  columns,
  nspname,
  relname,
  :'runtime_role'
)
FROM column_grants
ORDER BY nspname, relname, privilege_type;
\gexec

WITH runtime_role AS (
  SELECT oid
    FROM pg_roles
   WHERE rolname = :'runtime_role'
), unexpected AS (
  SELECT
    n.nspname,
    c.relname,
    string_agg(DISTINCT upper(acl.privilege_type), ', ' ORDER BY upper(acl.privilege_type)) AS privileges
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN runtime_role
  CROSS JOIN LATERAL aclexplode(
    COALESCE(c.relacl, acldefault('r', c.relowner))
  ) AS acl
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND acl.grantee = runtime_role.oid
    AND NOT (upper(acl.privilege_type) = ANY (ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']))
  GROUP BY n.nspname, c.relname
)
SELECT format(
  'REVOKE %s ON TABLE %I.%I FROM %I',
  privileges,
  nspname,
  relname,
  :'runtime_role'
)
FROM unexpected
ORDER BY nspname, relname;
\gexec

WITH runtime_role AS (
  SELECT oid
    FROM pg_roles
   WHERE rolname = :'runtime_role'
), grant_options AS (
  SELECT
    n.nspname,
    c.relname,
    string_agg(DISTINCT upper(acl.privilege_type), ', ' ORDER BY upper(acl.privilege_type)) AS privileges
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN runtime_role
  CROSS JOIN LATERAL aclexplode(
    COALESCE(c.relacl, acldefault('r', c.relowner))
  ) AS acl
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND acl.grantee = runtime_role.oid
    AND acl.is_grantable
  GROUP BY n.nspname, c.relname
)
SELECT format(
  'REVOKE GRANT OPTION FOR %s ON TABLE %I.%I FROM %I',
  privileges,
  nspname,
  relname,
  :'runtime_role'
)
FROM grant_options
ORDER BY nspname, relname;
\gexec

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."AccountDeletionSideEffect",
  public."AdminAuditLog",
  public."Block",
  public."BlogComment",
  public."BlogPost",
  public."Cart",
  public."CartItem",
  public."Case",
  public."CaseMessage",
  public."CaseMessageAttachment",
  public."CheckoutStockReservation",
  public."ClerkWebhookEvent",
  public."CommissionInterest",
  public."CommissionRequest",
  public."Conversation",
  public."CronRun",
  public."DirectUpload",
  public."EmailFailureCount",
  public."EmailOutbox",
  public."EmailSuppression",
  public."Favorite",
  public."Follow",
  public."FoundingMakerGrant",
  public."Listing",
  public."ListingVariantGroup",
  public."ListingVariantOption",
  public."ListingViewDaily",
  public."MakerVerification",
  public."Message",
  public."Metro",
  public."NewsletterSubscriber",
  public."Notification",
  public."Order",
  public."OrderItem",
  public."OrderPaymentEvent",
  public."OrderShippingRateQuote",
  public."Photo",
  public."ResendWebhookEvent",
  public."Review",
  public."ReviewPhoto",
  public."ReviewVote",
  public."SavedBlogPost",
  public."SavedSearch",
  public."SellerBroadcast",
  public."SellerFaq",
  public."SellerMetrics",
  public."SellerPayoutEvent",
  public."SellerProfile",
  public."SellerProfileViewDaily",
  public."SellerRatingSummary",
  public."SiteConfig",
  public."SiteMetricsSnapshot",
  public."StockNotification",
  public."StripeWebhookEvent",
  public."SupportRequest",
  public."SystemAuditLog",
  public."User",
  public."UserEmailAddress",
  public."UserReport"
TO :"runtime_role";

-- Phase A gives SavedSearch only the operations the application actually
-- performs. Keep this after the bulk grant so rerunning provisioning cannot
-- silently restore UPDATE after the RLS migration removes it.
REVOKE UPDATE ON TABLE public."SavedSearch" FROM :"runtime_role";

-- StripeWebhookEvent begins as a compatible CRUD table. Its separate
-- policyless service-ledger activation enables RLS with zero policies and
-- removes all direct runtime authority. FORCE may be either off (initial
-- activation) or on (later posture hardening); partial state is refused so a
-- provisioning rerun cannot silently reopen the ledger.
WITH table_state AS (
  SELECT
    c.relrowsecurity,
    c.relforcerowsecurity,
    COUNT(p.oid)::integer AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relname = 'StripeWebhookEvent'
    AND c.relkind IN ('r', 'p')
  GROUP BY c.relrowsecurity, c.relforcerowsecurity
), stripe_webhook_event_activation AS (
  SELECT
    COUNT(*) = 1
      AND bool_and(relrowsecurity AND policy_count = 0) AS active,
    COUNT(*) = 1
      AND bool_and(
        NOT relrowsecurity
        AND NOT relforcerowsecurity
        AND policy_count = 0
      ) AS clean_predecessor
  FROM table_state
), failure AS (
  SELECT
    'StripeWebhookEvent RLS is partially or unexpectedly configured; refusing runtime-role provisioning'
      AS message
  FROM stripe_webhook_event_activation
  WHERE NOT active AND NOT clean_predecessor
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_role_provisioning_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '')
    AS grainline_role_provisioning_failure,
  COALESCE(
    (SELECT active FROM stripe_webhook_event_activation),
    false
  ) AS stripe_webhook_event_rls_active;
\gset
\if :grainline_role_provisioning_failed
\echo :grainline_role_provisioning_failure
DO $grainline_role_provisioning_abort$
BEGIN
  RAISE EXCEPTION 'runtime-role provisioning refused';
END
$grainline_role_provisioning_abort$;
\endif
\unset grainline_role_provisioning_failed
\unset grainline_role_provisioning_failure

\if :stripe_webhook_event_rls_active
REVOKE ALL ON TABLE public."StripeWebhookEvent"
FROM :"runtime_role";
\endif

-- Notification keeps ordinary CRUD until its reviewed recipient policies are
-- installed. Once those exact policies exist, every provisioning rerun must
-- converge back to SELECT plus column-only UPDATE(read). The surrounding
-- transaction prevents the broad bulk grant above from becoming visible
-- between GRANT and this narrowing step.
WITH notification_activation AS (
  SELECT
    c.relrowsecurity
      AND COUNT(p.oid) = 2
      AND COUNT(p.oid) FILTER (
        WHERE p.polname IN (
          'grainline_notification_recipient_select',
          'grainline_notification_recipient_update'
        )
      ) = 2 AS active,
    c.relrowsecurity OR c.relforcerowsecurity OR COUNT(p.oid) > 0 AS started
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relname = 'Notification'
    AND c.relkind IN ('r', 'p')
  GROUP BY c.relrowsecurity, c.relforcerowsecurity
), failure AS (
  SELECT 'Notification RLS is partially or unexpectedly configured; refusing runtime-role provisioning' AS message
  FROM notification_activation
  WHERE started AND NOT active
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_role_provisioning_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '') AS grainline_role_provisioning_failure,
  COALESCE((SELECT active FROM notification_activation), false) AS notification_rls_active;
\gset
\if :grainline_role_provisioning_failed
\echo :grainline_role_provisioning_failure
DO $grainline_role_provisioning_abort$
BEGIN
  RAISE EXCEPTION 'runtime-role provisioning refused';
END
$grainline_role_provisioning_abort$;
\endif
\unset grainline_role_provisioning_failed
\unset grainline_role_provisioning_failure

\if :notification_rls_active
REVOKE INSERT, UPDATE, DELETE ON TABLE public."Notification" FROM :"runtime_role";
GRANT UPDATE (read) ON TABLE public."Notification" TO :"runtime_role";
\endif

-- Conversation and Message retain ordinary CRUD until their compatible
-- fixed-function application is live and the exact paired SELECT policies are
-- installed. Once activation is complete, every provisioning rerun must
-- converge both tables back to direct SELECT only. Partial or unexpected
-- catalog state fails closed instead of restoring broad writes.
WITH table_state AS (
  SELECT
    c.relname,
    c.relrowsecurity,
    c.relforcerowsecurity,
    COUNT(p.oid)::integer AS policy_count,
    COUNT(p.oid) FILTER (
      WHERE p.polcmd = 'r'
        AND p.polpermissive
        AND p.polroles = ARRAY[
          (SELECT oid FROM pg_roles WHERE rolname = :'runtime_role')
        ]::oid[]
        AND p.polqual IS NOT NULL
        AND p.polwithcheck IS NULL
        AND (
          (
            c.relname = 'Conversation'
            AND p.polname =
              'grainline_conversation_participant_or_reported_select'
          )
          OR (
            c.relname = 'Message'
            AND p.polname =
              'grainline_message_participant_or_reported_select'
          )
        )
    )::integer AS expected_policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relname IN ('Conversation', 'Message')
    AND c.relkind IN ('r', 'p')
  GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
), conversation_message_activation AS (
  SELECT
    COUNT(*) = 2 AS table_catalog_complete,
    COUNT(*) = 2
      AND COUNT(DISTINCT relforcerowsecurity) = 1
      AND bool_and(
        relrowsecurity
        AND policy_count = 1
        AND expected_policy_count = 1
      ) AS active,
    COUNT(*) = 2
      AND bool_and(
        NOT relrowsecurity
        AND NOT relforcerowsecurity
        AND policy_count = 0
      ) AS clean_predecessor,
    COALESCE(
      bool_or(relrowsecurity OR relforcerowsecurity OR policy_count > 0),
      false
    ) AS started
  FROM table_state
), failure AS (
  SELECT
    'Conversation/Message RLS is partially or unexpectedly configured; refusing runtime-role provisioning'
      AS message
  FROM conversation_message_activation
  WHERE NOT active AND NOT clean_predecessor
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_role_provisioning_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '')
    AS grainline_role_provisioning_failure,
  COALESCE(
    (SELECT active FROM conversation_message_activation),
    false
  ) AS conversation_message_rls_active;
\gset
\if :grainline_role_provisioning_failed
\echo :grainline_role_provisioning_failure
DO $grainline_role_provisioning_abort$
BEGIN
  RAISE EXCEPTION 'runtime-role provisioning refused';
END
$grainline_role_provisioning_abort$;
\endif
\unset grainline_role_provisioning_failed
\unset grainline_role_provisioning_failure

\if :conversation_message_rls_active
REVOKE INSERT, UPDATE, DELETE ON TABLE
  public."Conversation",
  public."Message"
FROM :"runtime_role";
\endif

-- Case, CaseMessage and CaseMessageAttachment activate together as
-- policyless service tables. The compatible predecessor keeps all three RLS
-- flags off with zero policies; the initial activation enables RLS, keeps
-- FORCE off, retains zero policies and removes every direct runtime grant.
-- Refuse partial state so provisioning cannot mask a failed activation.
WITH table_state AS (
  SELECT
    c.relname,
    c.relrowsecurity,
    c.relforcerowsecurity,
    COUNT(p.oid)::integer AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relname IN ('Case', 'CaseMessage', 'CaseMessageAttachment')
    AND c.relkind IN ('r', 'p')
  GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
), case_activation AS (
  SELECT
    COUNT(*) = 3
      AND bool_and(
        relrowsecurity
        AND policy_count = 0
      )
      AND COUNT(DISTINCT relforcerowsecurity) = 1 AS active,
    COUNT(*) = 3
      AND bool_and(
        NOT relrowsecurity
        AND NOT relforcerowsecurity
        AND policy_count = 0
      ) AS clean_predecessor
  FROM table_state
), failure AS (
  SELECT
    'Case-family RLS is partially or unexpectedly configured; refusing runtime-role provisioning'
      AS message
  FROM case_activation
  WHERE NOT active AND NOT clean_predecessor
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_role_provisioning_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '')
    AS grainline_role_provisioning_failure,
  COALESCE(
    (SELECT active FROM case_activation),
    false
  ) AS case_rls_active;
\gset
\if :grainline_role_provisioning_failed
\echo :grainline_role_provisioning_failure
DO $grainline_role_provisioning_abort$
BEGIN
  RAISE EXCEPTION 'runtime-role provisioning refused';
END
$grainline_role_provisioning_abort$;
\endif
\unset grainline_role_provisioning_failed
\unset grainline_role_provisioning_failure

\if :case_rls_active
REVOKE ALL ON TABLE
  public."Case",
  public."CaseMessage",
  public."CaseMessageAttachment"
FROM :"runtime_role";
\endif

-- DirectUpload starts as a legacy CRUD table while its service-only reference
-- ledger starts FORCE-hardened with zero policies. Activation is exact only
-- when both tables have ENABLE plus FORCE, zero policies and no direct runtime
-- authority. Refuse every partial state; never let a provisioning rerun
-- silently restore DirectUpload CRUD after activation.
WITH table_state AS (
  SELECT
    c.relname,
    c.relrowsecurity,
    c.relforcerowsecurity,
    COUNT(p.oid)::integer AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relname IN ('DirectUpload', 'DirectUploadReference')
    AND c.relkind IN ('r', 'p')
  GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
), direct_upload_activation AS (
  SELECT
    COUNT(*) = 2
      AND bool_and(
        relrowsecurity
        AND relforcerowsecurity
        AND policy_count = 0
      ) AS active,
    COUNT(*) = 1
      AND bool_and(
        relname = 'DirectUpload'
        AND NOT relrowsecurity
        AND NOT relforcerowsecurity
        AND policy_count = 0
      ) AS preparation_absent,
    COUNT(*) = 2
      AND bool_and(
        policy_count = 0
        AND (
          (
            relname = 'DirectUpload'
            AND NOT relrowsecurity
            AND NOT relforcerowsecurity
          )
          OR (
            relname = 'DirectUploadReference'
            AND relrowsecurity
            AND relforcerowsecurity
          )
        )
      ) AS clean_predecessor
  FROM table_state
), failure AS (
  SELECT
    'DirectUpload RLS is partially or unexpectedly configured; refusing runtime-role provisioning'
      AS message
  FROM direct_upload_activation
  WHERE NOT active AND NOT preparation_absent AND NOT clean_predecessor
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_role_provisioning_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '')
    AS grainline_role_provisioning_failure,
  COALESCE(
    (SELECT active FROM direct_upload_activation),
    false
  ) AS direct_upload_rls_active;
\gset
\if :grainline_role_provisioning_failed
\echo :grainline_role_provisioning_failure
DO $grainline_role_provisioning_abort$
BEGIN
  RAISE EXCEPTION 'runtime-role provisioning refused';
END
$grainline_role_provisioning_abort$;
\endif
\unset grainline_role_provisioning_failed
\unset grainline_role_provisioning_failure

\if :direct_upload_rls_active
REVOKE ALL ON TABLE public."DirectUpload" FROM :"runtime_role";
\endif

GRANT USAGE ON TYPE
  public."BlogAuthorType",
  public."BlogPostStatus",
  public."BlogPostType",
  public."CaseReason",
  public."CaseResolution",
  public."CaseMessageAuthorKind",
  public."CaseStatus",
  public."Category",
  public."CommissionStatus",
  public."EmailSuppressionReason",
  public."FulfillmentMethod",
  public."FulfillmentStatus",
  public."GuildLevel",
  public."LabelStatus",
  public."ListingStatus",
  public."ListingType",
  public."NotificationType",
  public."Role",
  public."SupportRequestKind",
  public."SupportRequestStatus",
  public."VerificationStatus"
TO :"runtime_role";

-- CaseResolutionClaimStatus is absent before the compatible Case preparation
-- migration. Keep provisioning valid on either side of that database-first
-- boundary while preserving its no-PUBLIC type posture.
SELECT format(
  'GRANT USAGE ON TYPE public."CaseResolutionClaimStatus" TO %I',
  :'runtime_role'
)
WHERE to_regtype('public."CaseResolutionClaimStatus"') IS NOT NULL;
\gexec

-- The first compatible Case service operation is absent before its
-- operation-and-private-ledger preparation migration. Converge it to zero PUBLIC/direct
-- runtime authority, then grant only EXECUTE when it exists.
SELECT
  'REVOKE ALL ON FUNCTION public.grainline_case_stripe_dispute_apply(text) FROM PUBLIC'
WHERE to_regprocedure(
  'public.grainline_case_stripe_dispute_apply(text)'
) IS NOT NULL;
\gexec

SELECT format(
  'REVOKE ALL ON FUNCTION public.grainline_case_stripe_dispute_apply(text) FROM %I',
  :'runtime_role'
)
WHERE to_regprocedure(
  'public.grainline_case_stripe_dispute_apply(text)'
) IS NOT NULL;
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION public.grainline_case_stripe_dispute_apply(text) TO %I',
  :'runtime_role'
)
WHERE to_regprocedure(
  'public.grainline_case_stripe_dispute_apply(text)'
) IS NOT NULL;
\gexec

-- The seller-refund Case operation is absent before its compatible
-- operation-and-private-ledger migration. Preserve zero PUBLIC/direct table
-- authority and grant only the exact fixed function when present.
SELECT
  'REVOKE ALL ON FUNCTION public.grainline_case_seller_refund_apply(text, text) FROM PUBLIC'
WHERE to_regprocedure(
  'public.grainline_case_seller_refund_apply(text,text)'
) IS NOT NULL;
\gexec

SELECT format(
  'REVOKE ALL ON FUNCTION public.grainline_case_seller_refund_apply(text, text) FROM %I',
  :'runtime_role'
)
WHERE to_regprocedure(
  'public.grainline_case_seller_refund_apply(text,text)'
) IS NOT NULL;
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION public.grainline_case_seller_refund_apply(text, text) TO %I',
  :'runtime_role'
)
WHERE to_regprocedure(
  'public.grainline_case_seller_refund_apply(text,text)'
) IS NOT NULL;
\gexec

-- Staged staff Case resolution is absent before its compatible four-operation
-- authority migration. Converge each exact signature without granting direct
-- access to the private CaseResolutionClaim ledger.
WITH staff_resolution_rpc(function_signature) AS (
  VALUES
    (
      'public.grainline_case_staff_resolution_prepare(text, text, public."CaseResolution", integer, jsonb)'
    ),
    (
      'public.grainline_case_staff_resolution_provider_record(text, text, text, text, text[], text[], text, integer, boolean, boolean)'
    ),
    (
      'public.grainline_case_staff_resolution_finalize(text, text)'
    ),
    (
      'public.grainline_case_staff_resolution_reconcile(text, text, text, text)'
    )
)
SELECT format(
  'REVOKE ALL ON FUNCTION %s FROM PUBLIC',
  function_signature
)
  FROM staff_resolution_rpc
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

WITH staff_resolution_rpc(function_signature) AS (
  VALUES
    (
      'public.grainline_case_staff_resolution_prepare(text, text, public."CaseResolution", integer, jsonb)'
    ),
    (
      'public.grainline_case_staff_resolution_provider_record(text, text, text, text, text[], text[], text, integer, boolean, boolean)'
    ),
    (
      'public.grainline_case_staff_resolution_finalize(text, text)'
    ),
    (
      'public.grainline_case_staff_resolution_reconcile(text, text, text, text)'
    )
)
SELECT format(
  'REVOKE ALL ON FUNCTION %s FROM %I',
  function_signature,
  :'runtime_role'
)
  FROM staff_resolution_rpc
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

WITH staff_resolution_rpc(function_signature) AS (
  VALUES
    (
      'public.grainline_case_staff_resolution_prepare(text, text, public."CaseResolution", integer, jsonb)'
    ),
    (
      'public.grainline_case_staff_resolution_provider_record(text, text, text, text, text[], text[], text, integer, boolean, boolean)'
    ),
    (
      'public.grainline_case_staff_resolution_finalize(text, text)'
    ),
    (
      'public.grainline_case_staff_resolution_reconcile(text, text, text, text)'
    )
)
SELECT format(
  'GRANT EXECUTE ON FUNCTION %s TO %I',
  function_signature,
  :'runtime_role'
)
  FROM staff_resolution_rpc
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

-- Participant Case resolution is absent before its compatible authority
-- migration. Keep PUBLIC closed and converge only the exact fixed operation.
SELECT
  'REVOKE ALL ON FUNCTION public.grainline_case_mark_resolved(text, text) FROM PUBLIC'
WHERE to_regprocedure(
  'public.grainline_case_mark_resolved(text,text)'
) IS NOT NULL;
\gexec

SELECT format(
  'REVOKE ALL ON FUNCTION public.grainline_case_mark_resolved(text, text) FROM %I',
  :'runtime_role'
)
WHERE to_regprocedure(
  'public.grainline_case_mark_resolved(text,text)'
) IS NOT NULL;
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION public.grainline_case_mark_resolved(text, text) TO %I',
  :'runtime_role'
)
WHERE to_regprocedure(
  'public.grainline_case_mark_resolved(text,text)'
) IS NOT NULL;
\gexec

-- Buyer Case opening is absent before its compatible authority migration.
-- Keep PUBLIC closed and converge only the exact fixed operation; the private
-- replay ledger remains table-inaccessible.
SELECT
  'REVOKE ALL ON FUNCTION public.grainline_case_open(text, text, text, text) FROM PUBLIC'
WHERE to_regprocedure(
  'public.grainline_case_open(text,text,text,text)'
) IS NOT NULL;
\gexec

SELECT format(
  'REVOKE ALL ON FUNCTION public.grainline_case_open(text, text, text, text) FROM %I',
  :'runtime_role'
)
WHERE to_regprocedure(
  'public.grainline_case_open(text,text,text,text)'
) IS NOT NULL;
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION public.grainline_case_open(text, text, text, text) TO %I',
  :'runtime_role'
)
WHERE to_regprocedure(
  'public.grainline_case_open(text,text,text,text)'
) IS NOT NULL;
\gexec

-- Case replies are absent before their compatible authority migration. Keep
-- PUBLIC closed and converge only the exact fixed operation; attachment
-- metadata and Case transitions remain source-derived inside the function.
SELECT
  'REVOKE ALL ON FUNCTION public.grainline_case_reply(text, text, text, text[]) FROM PUBLIC'
WHERE to_regprocedure(
  'public.grainline_case_reply(text,text,text,text[])'
) IS NOT NULL;
\gexec

SELECT format(
  'REVOKE ALL ON FUNCTION public.grainline_case_reply(text, text, text, text[]) FROM %I',
  :'runtime_role'
)
WHERE to_regprocedure(
  'public.grainline_case_reply(text,text,text,text[])'
) IS NOT NULL;
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION public.grainline_case_reply(text, text, text, text[]) TO %I',
  :'runtime_role'
)
WHERE to_regprocedure(
  'public.grainline_case_reply(text,text,text,text[])'
) IS NOT NULL;
\gexec

-- Case-message preflight is absent before its compatible authority migration.
-- Keep PUBLIC closed and converge only the exact recipient-scoped DEFINER
-- projection; the final Case-reply function remains the write authority.
SELECT
  'REVOKE ALL ON FUNCTION public.grainline_case_message_preflight(text, text) FROM PUBLIC'
WHERE to_regprocedure(
  'public.grainline_case_message_preflight(text,text)'
) IS NOT NULL;
\gexec

SELECT format(
  'REVOKE ALL ON FUNCTION public.grainline_case_message_preflight(text, text) FROM %I',
  :'runtime_role'
)
WHERE to_regprocedure(
  'public.grainline_case_message_preflight(text,text)'
) IS NOT NULL;
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION public.grainline_case_message_preflight(text, text) TO %I',
  :'runtime_role'
)
WHERE to_regprocedure(
  'public.grainline_case_message_preflight(text,text)'
) IS NOT NULL;
\gexec

-- Case-message history is absent before its compatible authority migration.
-- Keep PUBLIC closed and converge only the exact bounded source-validating
-- projection; direct Case-family reads remain unchanged until activation.
SELECT
  'REVOKE ALL ON FUNCTION public.grainline_case_message_page(text, text, timestamp, text, integer) FROM PUBLIC'
WHERE to_regprocedure(
  'public.grainline_case_message_page(text,text,timestamp without time zone,text,integer)'
) IS NOT NULL;
\gexec

SELECT format(
  'REVOKE ALL ON FUNCTION public.grainline_case_message_page(text, text, timestamp, text, integer) FROM %I',
  :'runtime_role'
)
WHERE to_regprocedure(
  'public.grainline_case_message_page(text,text,timestamp without time zone,text,integer)'
) IS NOT NULL;
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION public.grainline_case_message_page(text, text, timestamp, text, integer) TO %I',
  :'runtime_role'
)
WHERE to_regprocedure(
  'public.grainline_case_message_page(text,text,timestamp without time zone,text,integer)'
) IS NOT NULL;
\gexec

-- Recipient Case projections are absent before their compatible authority
-- migrations. Keep PUBLIC closed and converge only exact reviewed Case
-- operations; direct Case reads remain available until the later app
-- conversion and RLS activation.
WITH recipient_read(function_signature) AS (
  VALUES
    ('public.grainline_case_get(text,text)'),
    ('public.grainline_case_get_by_order(text,text)'),
    ('public.grainline_case_staff_active_count(text)'),
    ('public.grainline_case_staff_queue(text,text,integer,integer)'),
    ('public.grainline_case_order_active_for_buyer(text,text)'),
    ('public.grainline_case_order_active_for_seller(text,text)'),
    ('public.grainline_order_buyer_pii_prune_batch(integer)'),
    ('public.grainline_case_seller_active_count(text)'),
    ('public.grainline_case_seller_verification_eligibility(text,text)'),
    ('public.grainline_case_guild_unresolved_guard(text)'),
    ('public.grainline_case_export_page(text,timestamp without time zone,text,integer)'),
    ('public.grainline_case_escalate(text,text)'),
    ('public.grainline_case_cron_transition_batch(text,integer)'),
    ('public.grainline_case_account_deletion_blockers(text)'),
    ('public.grainline_case_account_deletion_redact(text)')
)
SELECT format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', function_signature)
  FROM recipient_read
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

WITH recipient_read(function_signature) AS (
  VALUES
    ('public.grainline_case_get(text,text)'),
    ('public.grainline_case_get_by_order(text,text)'),
    ('public.grainline_case_staff_active_count(text)'),
    ('public.grainline_case_staff_queue(text,text,integer,integer)'),
    ('public.grainline_case_order_active_for_buyer(text,text)'),
    ('public.grainline_case_order_active_for_seller(text,text)'),
    ('public.grainline_order_buyer_pii_prune_batch(integer)'),
    ('public.grainline_case_seller_active_count(text)'),
    ('public.grainline_case_seller_verification_eligibility(text,text)'),
    ('public.grainline_case_guild_unresolved_guard(text)'),
    ('public.grainline_case_export_page(text,timestamp without time zone,text,integer)'),
    ('public.grainline_case_escalate(text,text)'),
    ('public.grainline_case_cron_transition_batch(text,integer)'),
    ('public.grainline_case_account_deletion_blockers(text)'),
    ('public.grainline_case_account_deletion_redact(text)')
)
SELECT format(
  'REVOKE ALL ON FUNCTION %s FROM %I',
  function_signature,
  :'runtime_role'
)
  FROM recipient_read
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

WITH recipient_read(function_signature) AS (
  VALUES
    ('public.grainline_case_get(text,text)'),
    ('public.grainline_case_get_by_order(text,text)'),
    ('public.grainline_case_staff_active_count(text)'),
    ('public.grainline_case_staff_queue(text,text,integer,integer)'),
    ('public.grainline_case_order_active_for_buyer(text,text)'),
    ('public.grainline_case_order_active_for_seller(text,text)'),
    ('public.grainline_order_buyer_pii_prune_batch(integer)'),
    ('public.grainline_case_seller_active_count(text)'),
    ('public.grainline_case_seller_verification_eligibility(text,text)'),
    ('public.grainline_case_guild_unresolved_guard(text)'),
    ('public.grainline_case_export_page(text,timestamp without time zone,text,integer)'),
    ('public.grainline_case_escalate(text,text)'),
    ('public.grainline_case_cron_transition_batch(text,integer)'),
    ('public.grainline_case_account_deletion_blockers(text)'),
    ('public.grainline_case_account_deletion_redact(text)')
)
SELECT format(
  'GRANT EXECUTE ON FUNCTION %s TO %I',
  function_signature,
  :'runtime_role'
)
  FROM recipient_read
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

GRANT EXECUTE ON FUNCTION public."grainline_notification_preferences_valid"(jsonb) TO :"runtime_role";

-- Trigger functions are owner-internal invariants, not application RPCs.
-- They can be absent before their preparation migration; when present,
-- converge both inherited/public and direct runtime EXECUTE to none.
WITH private_trigger(function_signature) AS (
  VALUES
    ('public."grainline_case_resolution_claim_immutable"()'),
    ('public."grainline_case_resolution_claim_lease_valid"()'),
    ('public."grainline_case_relationship_valid"()'),
    ('public."grainline_case_authority_fields_immutable"()'),
    ('public."grainline_case_status_transition_valid"()'),
    ('public."grainline_case_message_author_valid"()'),
    ('public."grainline_case_message_authority_fields_immutable"()'),
    ('public."grainline_case_message_maintain_thread"()'),
    ('public."grainline_case_opening_evidence_valid"()'),
    ('public."grainline_case_attachment_parent_valid"()'),
    ('public."grainline_conversation_participants_immutable"()'),
    ('public."grainline_message_participants_match_conversation"()'),
    ('public."grainline_message_route_immutable"()'),
    ('public."grainline_message_maintain_thread_state"()'),
    ('public."grainline_order_item_seller_key_bind"()'),
    ('public."grainline_order_seller_key_assert"(text)'),
    ('public."grainline_order_seller_key_complete"()'),
    ('public."grainline_order_item_seller_key_complete"()'),
    ('public."grainline_stripe_webhook_bind_source"(text, text, bigint, text)'),
    ('public."grainline_checkout_reservation_items_valid"(jsonb, text, text)'),
    ('public."grainline_checkout_reservation_normalize_write"()'),
    ('public."grainline_checkout_reservation_restore_items"(jsonb)'),
    ('public."grainline_checkout_reservation_seller_witness"(text)'),
    ('public."grainline_checkout_reservation_listing_witness"(text)'),
    ('public."grainline_checkout_reservation_variant_source_valid"(text, text[], integer)')
)
SELECT format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', function_signature)
  FROM private_trigger
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

WITH private_trigger(function_signature) AS (
  VALUES
    ('public."grainline_case_resolution_claim_immutable"()'),
    ('public."grainline_case_resolution_claim_lease_valid"()'),
    ('public."grainline_case_relationship_valid"()'),
    ('public."grainline_case_authority_fields_immutable"()'),
    ('public."grainline_case_status_transition_valid"()'),
    ('public."grainline_case_message_author_valid"()'),
    ('public."grainline_case_message_authority_fields_immutable"()'),
    ('public."grainline_case_message_maintain_thread"()'),
    ('public."grainline_case_opening_evidence_valid"()'),
    ('public."grainline_case_attachment_parent_valid"()'),
    ('public."grainline_conversation_participants_immutable"()'),
    ('public."grainline_message_participants_match_conversation"()'),
    ('public."grainline_message_route_immutable"()'),
    ('public."grainline_message_maintain_thread_state"()'),
    ('public."grainline_order_item_seller_key_bind"()'),
    ('public."grainline_order_seller_key_assert"(text)'),
    ('public."grainline_order_seller_key_complete"()'),
    ('public."grainline_order_item_seller_key_complete"()'),
    ('public."grainline_stripe_webhook_bind_source"(text, text, bigint, text)'),
    ('public."grainline_checkout_reservation_items_valid"(jsonb, text, text)'),
    ('public."grainline_checkout_reservation_normalize_write"()'),
    ('public."grainline_checkout_reservation_restore_items"(jsonb)'),
    ('public."grainline_checkout_reservation_seller_witness"(text)'),
    ('public."grainline_checkout_reservation_listing_witness"(text)'),
    ('public."grainline_checkout_reservation_variant_source_valid"(text, text[], integer)')
)
SELECT format(
  'REVOKE ALL ON FUNCTION %s FROM %I',
  function_signature,
  :'runtime_role'
)
  FROM private_trigger
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

-- Stripe webhook generation-bound lease and maintenance operations are
-- additive before their later table-RLS boundary. Keep PUBLIC closed, remove
-- stale direct runtime ACLs, and grant only the exact reviewed signatures.
WITH stripe_webhook_service(function_signature) AS (
  VALUES
    ('public."grainline_stripe_webhook_begin"(text, text)'),
    ('public."grainline_stripe_webhook_begin"(text, text, text)'),
    ('public."grainline_stripe_webhook_complete"(text, bigint)'),
    ('public."grainline_stripe_webhook_fail"(text, bigint, text)'),
    ('public."grainline_stripe_webhook_prune_batch"(integer)'),
    ('public."grainline_stripe_webhook_health_summary"()'),
    ('public."grainline_legacy_stock_restore_claim"(text)')
)
SELECT format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', function_signature)
  FROM stripe_webhook_service
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

WITH stripe_webhook_service(function_signature) AS (
  VALUES
    ('public."grainline_stripe_webhook_begin"(text, text)'),
    ('public."grainline_stripe_webhook_begin"(text, text, text)'),
    ('public."grainline_stripe_webhook_complete"(text, bigint)'),
    ('public."grainline_stripe_webhook_fail"(text, bigint, text)'),
    ('public."grainline_stripe_webhook_prune_batch"(integer)'),
    ('public."grainline_stripe_webhook_health_summary"()'),
    ('public."grainline_legacy_stock_restore_claim"(text)')
)
SELECT format(
  'REVOKE ALL ON FUNCTION %s FROM %I',
  function_signature,
  :'runtime_role'
)
  FROM stripe_webhook_service
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

WITH stripe_webhook_service(function_signature) AS (
  VALUES
    ('public."grainline_stripe_webhook_begin"(text, text)'),
    ('public."grainline_stripe_webhook_begin"(text, text, text)'),
    ('public."grainline_stripe_webhook_complete"(text, bigint)'),
    ('public."grainline_stripe_webhook_fail"(text, bigint, text)'),
    ('public."grainline_stripe_webhook_prune_batch"(integer)'),
    ('public."grainline_stripe_webhook_health_summary"()'),
    ('public."grainline_legacy_stock_restore_claim"(text)')
)
SELECT format(
  'GRANT EXECUTE ON FUNCTION %s TO %I',
  function_signature,
  :'runtime_role'
)
  FROM stripe_webhook_service
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

-- CheckoutStockReservation compatible preparation keeps predecessor table
-- grants while adding only the fixed lifecycle surface. The functions may be
-- absent before that migration, so every convergence statement is catalog-
-- guarded. Private validation/trigger/source helpers are handled above.
WITH checkout_reservation_service(function_signature) AS (
  VALUES
    ('public."grainline_checkout_reservation_create_cart"(text, text, text, text, text)'),
    ('public."grainline_checkout_reservation_create_single"(text, text, integer, text)'),
    ('public."grainline_checkout_reservation_create_cart_consistent"(text, text, text, text, text, jsonb)'),
    ('public."grainline_checkout_reservation_create_single_consistent"(text, text, integer, text[], text, jsonb)'),
    ('public."grainline_checkout_reservation_bind_session"(text, text, text, text)'),
    ('public."grainline_checkout_reservation_complete"(text, bigint, text, text)'),
    ('public."grainline_checkout_reservation_checkout_abort"(text, text, text)'),
    ('public."grainline_checkout_reservation_webhook_restore"(text, bigint, text)'),
    ('public."grainline_checkout_reservation_buyer_expired_restore"(text, text)'),
    ('public."grainline_checkout_reservation_seller_expired_restore"(text, text)'),
    ('public."grainline_checkout_reservation_repair_claim_batch"(integer)'),
    ('public."grainline_checkout_reservation_account_claim_batch"(text, integer)'),
    ('public."grainline_checkout_reservation_repair_finalize"(text, bigint, text)'),
    ('public."grainline_checkout_reservation_prune_batch"(integer)'),
    ('public."grainline_checkout_reservation_resume"(text, text)'),
    ('public."grainline_checkout_reservation_export"(text)'),
    ('public."grainline_checkout_reservation_account_scrub"(text)')
)
SELECT format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', function_signature)
  FROM checkout_reservation_service
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

WITH checkout_reservation_service(function_signature) AS (
  VALUES
    ('public."grainline_checkout_reservation_create_cart"(text, text, text, text, text)'),
    ('public."grainline_checkout_reservation_create_single"(text, text, integer, text)'),
    ('public."grainline_checkout_reservation_create_cart_consistent"(text, text, text, text, text, jsonb)'),
    ('public."grainline_checkout_reservation_create_single_consistent"(text, text, integer, text[], text, jsonb)'),
    ('public."grainline_checkout_reservation_bind_session"(text, text, text, text)'),
    ('public."grainline_checkout_reservation_complete"(text, bigint, text, text)'),
    ('public."grainline_checkout_reservation_checkout_abort"(text, text, text)'),
    ('public."grainline_checkout_reservation_webhook_restore"(text, bigint, text)'),
    ('public."grainline_checkout_reservation_buyer_expired_restore"(text, text)'),
    ('public."grainline_checkout_reservation_seller_expired_restore"(text, text)'),
    ('public."grainline_checkout_reservation_repair_claim_batch"(integer)'),
    ('public."grainline_checkout_reservation_account_claim_batch"(text, integer)'),
    ('public."grainline_checkout_reservation_repair_finalize"(text, bigint, text)'),
    ('public."grainline_checkout_reservation_prune_batch"(integer)'),
    ('public."grainline_checkout_reservation_resume"(text, text)'),
    ('public."grainline_checkout_reservation_export"(text)'),
    ('public."grainline_checkout_reservation_account_scrub"(text)')
)
SELECT format(
  'REVOKE ALL ON FUNCTION %s FROM %I',
  function_signature,
  :'runtime_role'
)
  FROM checkout_reservation_service
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

WITH checkout_reservation_service(function_signature) AS (
  VALUES
    ('public."grainline_checkout_reservation_create_cart"(text, text, text, text, text)'),
    ('public."grainline_checkout_reservation_create_single"(text, text, integer, text)'),
    ('public."grainline_checkout_reservation_create_cart_consistent"(text, text, text, text, text, jsonb)'),
    ('public."grainline_checkout_reservation_create_single_consistent"(text, text, integer, text[], text, jsonb)'),
    ('public."grainline_checkout_reservation_bind_session"(text, text, text, text)'),
    ('public."grainline_checkout_reservation_complete"(text, bigint, text, text)'),
    ('public."grainline_checkout_reservation_checkout_abort"(text, text, text)'),
    ('public."grainline_checkout_reservation_webhook_restore"(text, bigint, text)'),
    ('public."grainline_checkout_reservation_buyer_expired_restore"(text, text)'),
    ('public."grainline_checkout_reservation_seller_expired_restore"(text, text)'),
    ('public."grainline_checkout_reservation_repair_claim_batch"(integer)'),
    ('public."grainline_checkout_reservation_account_claim_batch"(text, integer)'),
    ('public."grainline_checkout_reservation_repair_finalize"(text, bigint, text)'),
    ('public."grainline_checkout_reservation_prune_batch"(integer)'),
    ('public."grainline_checkout_reservation_resume"(text, text)'),
    ('public."grainline_checkout_reservation_export"(text)'),
    ('public."grainline_checkout_reservation_account_scrub"(text)')
)
SELECT format(
  'GRANT EXECUTE ON FUNCTION %s TO %I',
  function_signature,
  :'runtime_role'
)
  FROM checkout_reservation_service
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

-- CheckoutStockReservation is a policyless service ledger once Phase A is
-- active. Refuse partial posture, and ensure the broad compatibility grant
-- above cannot escape this transaction after activation.
WITH table_state AS (
  SELECT
    class.relrowsecurity,
    class.relforcerowsecurity,
    (SELECT pg_catalog.count(*)::integer
       FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid = class.oid) AS policy_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'CheckoutStockReservation'
     AND class.relkind = 'r'
), posture AS (
  SELECT
    COUNT(*) = 1
      AND bool_and(relrowsecurity AND policy_count = 0) AS active,
    COUNT(*) = 1
      AND bool_and(
        NOT relrowsecurity
        AND NOT relforcerowsecurity
        AND policy_count = 0
      ) AS clean_predecessor
    FROM table_state
), failure AS (
  SELECT
    'CheckoutStockReservation RLS is partially or unexpectedly configured; refusing runtime-role provisioning'
      AS message
    FROM posture
   WHERE NOT active AND NOT clean_predecessor
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_role_provisioning_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '')
    AS grainline_role_provisioning_failure,
  COALESCE((SELECT active FROM posture), false)
    AS checkout_stock_reservation_rls_active;
\gset
\if :grainline_role_provisioning_failed
\echo :grainline_role_provisioning_failure
DO $grainline_reservation_provisioning_abort$
BEGIN
  RAISE EXCEPTION 'runtime-role provisioning refused';
END
$grainline_reservation_provisioning_abort$;
\endif
\unset grainline_role_provisioning_failed
\unset grainline_role_provisioning_failure

\if :checkout_stock_reservation_rls_active
REVOKE ALL ON TABLE public."CheckoutStockReservation"
  FROM PUBLIC, :"runtime_role";
REVOKE EXECUTE ON FUNCTION
  public.grainline_checkout_reservation_create_cart(text, text, text, text, text),
  public.grainline_checkout_reservation_create_single(text, text, integer, text)
  FROM PUBLIC, :"runtime_role";
\endif
\unset checkout_stock_reservation_rls_active

-- These owner-operated ledgers sit behind fixed functions. They intentionally
-- have FORCE RLS with zero policies and no runtime/PUBLIC table authority.
SELECT format(
  'REVOKE ALL ON TABLE public.%I FROM PUBLIC, %I',
  private_table.table_name,
  :'runtime_role'
)
FROM (
  VALUES
    ('CaseResolutionClaim'),
    ('CaseStripeDisputeApplication'),
    ('CaseSellerRefundApplication'),
    ('CaseOpenApplication'),
    ('DirectUploadReference')
) AS private_table(table_name)
WHERE to_regclass(format('public.%I', private_table.table_name)) IS NOT NULL;
\gexec

-- DirectUpload preparation may be absent before its reviewed migrations.
-- When present, converge every function to zero PUBLIC authority, revoke all
-- direct runtime authority, then re-grant only the 21 fixed operations.
WITH direct_upload_authority(function_signature, runtime_execute) AS (
  VALUES
    ('public."grainline_direct_upload_actor_valid"(text)', false),
    ('public."grainline_direct_upload_case_attachment_bind"()', false),
    ('public."grainline_direct_upload_case_attachment_reference_trigger"()', false),
    ('public."grainline_direct_upload_identity_immutable"()', false),
    ('public."grainline_direct_upload_message_url_core"(text, text)', false),
    ('public."grainline_direct_upload_record_core"(text, text, text, text, text, integer, text, text, text)', false),
    ('public."grainline_direct_upload_reference_core"(text, text, text)', false),
    ('public."grainline_direct_upload_reference_guard"()', false),
    ('public."grainline_direct_upload_release_core"(text, text, text, text)', false),
    ('public."grainline_direct_upload_release_source_core"(text[], text, text)', false),
    ('public."grainline_direct_upload_source_delete_trigger"()', false),
    ('public."grainline_direct_upload_status_transition"()', false),
    ('public."grainline_direct_upload_sync_public_core"(text, text, text, text[], text[])', false),
    ('public."grainline_direct_upload_utc_now"()', false),
    ('public."grainline_direct_upload_record_processed_public"(text, text, text, text, text, integer)', true),
    ('public."grainline_direct_upload_record_presigned_public"(text, text, text, text, text, integer)', true),
    ('public."grainline_direct_upload_record_private_case"(text, text, text, text, integer)', true),
    ('public."grainline_direct_upload_record_private_message"(text, text, text, text, integer)', true),
    ('public."grainline_direct_upload_verify_public"(text, text, text)', true),
    ('public."grainline_direct_upload_owned_lookup"(text, text)', true),
    ('public."grainline_direct_upload_reference_case_attachment"(text, text)', true),
    ('public."grainline_direct_upload_case_attachment_read"(text, text, text)', true),
    ('public."grainline_direct_upload_cleanup_lease"(integer)', true),
    ('public."grainline_direct_upload_cleanup_complete"(text, text)', true),
    ('public."grainline_direct_upload_cleanup_fail"(text, text, text)', true),
    ('public."grainline_direct_upload_export"(text)', true),
    ('public."grainline_direct_upload_account_public_urls"(text)', true),
    ('public."grainline_direct_upload_release_for_account"(text)', true),
    ('public."grainline_direct_upload_sync_listing"(text, text)', true),
    ('public."grainline_direct_upload_sync_seller_profile"(text, text)', true),
    ('public."grainline_direct_upload_sync_review"(text, text)', true),
    ('public."grainline_direct_upload_sync_blog_post"(text, text)', true),
    ('public."grainline_direct_upload_sync_commission_request"(text, text)', true),
    ('public."grainline_direct_upload_sync_seller_broadcast"(text, text)', true),
    ('public."grainline_direct_upload_sync_legacy_message"(text, text)', true)
)
SELECT format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', function_signature)
  FROM direct_upload_authority
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

WITH direct_upload_authority(function_signature, runtime_execute) AS (
  VALUES
    ('public."grainline_direct_upload_actor_valid"(text)', false),
    ('public."grainline_direct_upload_case_attachment_bind"()', false),
    ('public."grainline_direct_upload_case_attachment_reference_trigger"()', false),
    ('public."grainline_direct_upload_identity_immutable"()', false),
    ('public."grainline_direct_upload_message_url_core"(text, text)', false),
    ('public."grainline_direct_upload_record_core"(text, text, text, text, text, integer, text, text, text)', false),
    ('public."grainline_direct_upload_reference_core"(text, text, text)', false),
    ('public."grainline_direct_upload_reference_guard"()', false),
    ('public."grainline_direct_upload_release_core"(text, text, text, text)', false),
    ('public."grainline_direct_upload_release_source_core"(text[], text, text)', false),
    ('public."grainline_direct_upload_source_delete_trigger"()', false),
    ('public."grainline_direct_upload_status_transition"()', false),
    ('public."grainline_direct_upload_sync_public_core"(text, text, text, text[], text[])', false),
    ('public."grainline_direct_upload_utc_now"()', false),
    ('public."grainline_direct_upload_record_processed_public"(text, text, text, text, text, integer)', true),
    ('public."grainline_direct_upload_record_presigned_public"(text, text, text, text, text, integer)', true),
    ('public."grainline_direct_upload_record_private_case"(text, text, text, text, integer)', true),
    ('public."grainline_direct_upload_record_private_message"(text, text, text, text, integer)', true),
    ('public."grainline_direct_upload_verify_public"(text, text, text)', true),
    ('public."grainline_direct_upload_owned_lookup"(text, text)', true),
    ('public."grainline_direct_upload_reference_case_attachment"(text, text)', true),
    ('public."grainline_direct_upload_case_attachment_read"(text, text, text)', true),
    ('public."grainline_direct_upload_cleanup_lease"(integer)', true),
    ('public."grainline_direct_upload_cleanup_complete"(text, text)', true),
    ('public."grainline_direct_upload_cleanup_fail"(text, text, text)', true),
    ('public."grainline_direct_upload_export"(text)', true),
    ('public."grainline_direct_upload_account_public_urls"(text)', true),
    ('public."grainline_direct_upload_release_for_account"(text)', true),
    ('public."grainline_direct_upload_sync_listing"(text, text)', true),
    ('public."grainline_direct_upload_sync_seller_profile"(text, text)', true),
    ('public."grainline_direct_upload_sync_review"(text, text)', true),
    ('public."grainline_direct_upload_sync_blog_post"(text, text)', true),
    ('public."grainline_direct_upload_sync_commission_request"(text, text)', true),
    ('public."grainline_direct_upload_sync_seller_broadcast"(text, text)', true),
    ('public."grainline_direct_upload_sync_legacy_message"(text, text)', true)
)
SELECT format(
  'REVOKE ALL ON FUNCTION %s FROM %I',
  function_signature,
  :'runtime_role'
)
  FROM direct_upload_authority
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

WITH direct_upload_authority(function_signature, runtime_execute) AS (
  VALUES
    ('public."grainline_direct_upload_record_processed_public"(text, text, text, text, text, integer)', true),
    ('public."grainline_direct_upload_record_presigned_public"(text, text, text, text, text, integer)', true),
    ('public."grainline_direct_upload_record_private_case"(text, text, text, text, integer)', true),
    ('public."grainline_direct_upload_record_private_message"(text, text, text, text, integer)', true),
    ('public."grainline_direct_upload_verify_public"(text, text, text)', true),
    ('public."grainline_direct_upload_owned_lookup"(text, text)', true),
    ('public."grainline_direct_upload_reference_case_attachment"(text, text)', true),
    ('public."grainline_direct_upload_case_attachment_read"(text, text, text)', true),
    ('public."grainline_direct_upload_cleanup_lease"(integer)', true),
    ('public."grainline_direct_upload_cleanup_complete"(text, text)', true),
    ('public."grainline_direct_upload_cleanup_fail"(text, text, text)', true),
    ('public."grainline_direct_upload_export"(text)', true),
    ('public."grainline_direct_upload_account_public_urls"(text)', true),
    ('public."grainline_direct_upload_release_for_account"(text)', true),
    ('public."grainline_direct_upload_sync_listing"(text, text)', true),
    ('public."grainline_direct_upload_sync_seller_profile"(text, text)', true),
    ('public."grainline_direct_upload_sync_review"(text, text)', true),
    ('public."grainline_direct_upload_sync_blog_post"(text, text)', true),
    ('public."grainline_direct_upload_sync_commission_request"(text, text)', true),
    ('public."grainline_direct_upload_sync_seller_broadcast"(text, text)', true),
    ('public."grainline_direct_upload_sync_legacy_message"(text, text)', true)
)
SELECT format(
  'GRANT EXECUTE ON FUNCTION %s TO %I',
  function_signature,
  :'runtime_role'
)
  FROM direct_upload_authority
 WHERE runtime_execute
   AND to_regprocedure(function_signature) IS NOT NULL;
\gexec

\if :direct_upload_rls_active
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_record_private_message(
    text, text, text, text, integer
  )
  FROM :"runtime_role";
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_cleanup_lease(integer)
  FROM :"runtime_role";
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_cleanup_complete(text, text)
  FROM :"runtime_role";
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_cleanup_fail(text, text, text)
  FROM :"runtime_role";
\endif
\unset direct_upload_rls_active

-- These RPCs are introduced by a migration that runs after first-time role
-- provisioning. Skip them when they do not exist yet; their migration applies
-- the same least-privilege grants, and later provisioning runs converge drift.
WITH saved_search_rpc(function_signature) AS (
  VALUES
    ('public."grainline_saved_search_list"(text, integer, text)'),
    ('public."grainline_saved_search_delete_one"(text, text)')
)
SELECT format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', function_signature)
  FROM saved_search_rpc
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

-- Once Notification RLS is active, provisioning also converges the entire
-- fixed RPC surface. The generic core remains owner-private; every other
-- recipient/service function gets direct non-grantable runtime EXECUTE only.
\if :notification_rls_active
REVOKE ALL ON FUNCTION public.grainline_notification_unread_count(text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_bell(text, integer) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_page(text, integer, integer) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_mark_one_read(text, text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_mark_many_read(text, text[]) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_mark_conversation_read(text, text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_export(text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_recent_low_stock(text, text, timestamp) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_create_core(text, text, public."NotificationType", text, text, text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_create_source_fanout(text, text, public."NotificationType", text, text, text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_create_social_event(text, text, public."NotificationType", text, text, text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_create_message_event(text, text, public."NotificationType", text, text, text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_create_case_event(text, text, public."NotificationType", text, text, text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_create_commission_event(text, text, public."NotificationType", text, text, text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_create_inventory_event(text, text, public."NotificationType", text, text, text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_create_verification_event(text, text, public."NotificationType", text, text, text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_create_moderation_event(text, text, public."NotificationType", text, text, text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_create_account_warning(text, text, public."NotificationType", text, text, text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_create_order_event(text, text, public."NotificationType", text, text, text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_claim_back_in_stock(text, text, text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_delete_for_account(text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_delete_blog_comment(text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_delete_seller_broadcast(text) FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_prune_read_batch() FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.grainline_notification_prune_unread_batch() FROM PUBLIC, :"runtime_role";

GRANT EXECUTE ON FUNCTION public.grainline_notification_unread_count(text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_bell(text, integer) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_page(text, integer, integer) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_mark_one_read(text, text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_mark_many_read(text, text[]) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_mark_conversation_read(text, text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_export(text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_recent_low_stock(text, text, timestamp) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_source_fanout(text, text, public."NotificationType", text, text, text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_social_event(text, text, public."NotificationType", text, text, text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_message_event(text, text, public."NotificationType", text, text, text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_case_event(text, text, public."NotificationType", text, text, text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_commission_event(text, text, public."NotificationType", text, text, text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_inventory_event(text, text, public."NotificationType", text, text, text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_verification_event(text, text, public."NotificationType", text, text, text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_moderation_event(text, text, public."NotificationType", text, text, text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_account_warning(text, text, public."NotificationType", text, text, text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_order_event(text, text, public."NotificationType", text, text, text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_claim_back_in_stock(text, text, text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_delete_for_account(text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_delete_blog_comment(text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_delete_seller_broadcast(text) TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_prune_read_batch() TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.grainline_notification_prune_unread_batch() TO :"runtime_role";
\endif
\unset notification_rls_active

-- Conversation/Message authority preparation may be absent before its
-- reviewed migration. When present, converge all function ACLs:
-- six generic helper cores stay owner-only and the 19 fixed projections /
-- operations are runtime-callable. Paired table-grant convergence is handled
-- above once exact RLS activation is detected.
WITH conversation_message_authority(function_signature) AS (
  VALUES
    ('public."grainline_conversation_staff_report_visible"(text)'),
    ('public."grainline_conversation_get"(text, text)'),
    ('public."grainline_conversation_pair"(text, text)'),
    ('public."grainline_message_list"(text, text, text, timestamp, text, integer)'),
    ('public."grainline_message_unread_count"(text)'),
    ('public."grainline_message_latest_custom_request"(text, text, text)'),
    ('public."grainline_message_report_target_valid"(text, text, text, text)'),
    ('public."grainline_message_export"(text)'),
    ('public."grainline_conversation_inbox"(text, boolean, text, timestamp, text, integer)'),
    ('public."grainline_conversation_lock_pair_core"(text, text)'),
    ('public."grainline_conversation_listing_core"(text, text, text)'),
    ('public."grainline_conversation_get_or_create_core"(text, text, text, text)'),
    ('public."grainline_conversation_start"(text, text, text, text)'),
    ('public."grainline_message_send_ordinary"(text, text, text, text, text, text)'),
    ('public."grainline_conversation_set_archived"(text, text, boolean)'),
    ('public."grainline_message_mark_read"(text, text)'),
    ('public."grainline_conversation_claim_message_email"(text, text)'),
    ('public."grainline_message_send_custom_request"(text, text, text, text, text, text, integer, text, text)'),
    ('public."grainline_message_create_commission_interest"(text, text, text, text, text)'),
    ('public."grainline_message_send_custom_order_ready"(text, text, text)'),
    ('public."grainline_account_deletion_email_key_core"(text)'),
    ('public."grainline_account_deletion_regex_escape_core"(text)'),
    ('public."grainline_account_deletion_redact_text_core"(text, text[])'),
    ('public."grainline_message_redact_for_account_deletion"(text)'),
    ('public."grainline_seller_message_response_metrics"(text, timestamp)')
)
SELECT format(
  'REVOKE ALL ON FUNCTION %s FROM PUBLIC',
  function_signature
)
  FROM conversation_message_authority
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

WITH conversation_message_authority(function_signature) AS (
  VALUES
    ('public."grainline_conversation_staff_report_visible"(text)'),
    ('public."grainline_conversation_get"(text, text)'),
    ('public."grainline_conversation_pair"(text, text)'),
    ('public."grainline_message_list"(text, text, text, timestamp, text, integer)'),
    ('public."grainline_message_unread_count"(text)'),
    ('public."grainline_message_latest_custom_request"(text, text, text)'),
    ('public."grainline_message_report_target_valid"(text, text, text, text)'),
    ('public."grainline_message_export"(text)'),
    ('public."grainline_conversation_inbox"(text, boolean, text, timestamp, text, integer)'),
    ('public."grainline_conversation_lock_pair_core"(text, text)'),
    ('public."grainline_conversation_listing_core"(text, text, text)'),
    ('public."grainline_conversation_get_or_create_core"(text, text, text, text)'),
    ('public."grainline_conversation_start"(text, text, text, text)'),
    ('public."grainline_message_send_ordinary"(text, text, text, text, text, text)'),
    ('public."grainline_conversation_set_archived"(text, text, boolean)'),
    ('public."grainline_message_mark_read"(text, text)'),
    ('public."grainline_conversation_claim_message_email"(text, text)'),
    ('public."grainline_message_send_custom_request"(text, text, text, text, text, text, integer, text, text)'),
    ('public."grainline_message_create_commission_interest"(text, text, text, text, text)'),
    ('public."grainline_message_send_custom_order_ready"(text, text, text)'),
    ('public."grainline_account_deletion_email_key_core"(text)'),
    ('public."grainline_account_deletion_regex_escape_core"(text)'),
    ('public."grainline_account_deletion_redact_text_core"(text, text[])'),
    ('public."grainline_message_redact_for_account_deletion"(text)'),
    ('public."grainline_seller_message_response_metrics"(text, timestamp)')
)
SELECT format(
  'REVOKE ALL ON FUNCTION %s FROM %I',
  function_signature,
  :'runtime_role'
)
  FROM conversation_message_authority
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

WITH conversation_message_public_authority(function_signature) AS (
  VALUES
    ('public."grainline_conversation_staff_report_visible"(text)'),
    ('public."grainline_conversation_get"(text, text)'),
    ('public."grainline_conversation_pair"(text, text)'),
    ('public."grainline_message_list"(text, text, text, timestamp, text, integer)'),
    ('public."grainline_message_unread_count"(text)'),
    ('public."grainline_message_latest_custom_request"(text, text, text)'),
    ('public."grainline_message_report_target_valid"(text, text, text, text)'),
    ('public."grainline_message_export"(text)'),
    ('public."grainline_conversation_inbox"(text, boolean, text, timestamp, text, integer)'),
    ('public."grainline_conversation_start"(text, text, text, text)'),
    ('public."grainline_message_send_ordinary"(text, text, text, text, text, text)'),
    ('public."grainline_conversation_set_archived"(text, text, boolean)'),
    ('public."grainline_message_mark_read"(text, text)'),
    ('public."grainline_conversation_claim_message_email"(text, text)'),
    ('public."grainline_message_send_custom_request"(text, text, text, text, text, text, integer, text, text)'),
    ('public."grainline_message_create_commission_interest"(text, text, text, text, text)'),
    ('public."grainline_message_send_custom_order_ready"(text, text, text)'),
    ('public."grainline_message_redact_for_account_deletion"(text)'),
    ('public."grainline_seller_message_response_metrics"(text, timestamp)')
)
SELECT format(
  'GRANT EXECUTE ON FUNCTION %s TO %I',
  function_signature,
  :'runtime_role'
)
  FROM conversation_message_public_authority
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec
\unset conversation_message_rls_active

WITH saved_search_rpc(function_signature) AS (
  VALUES
    ('public."grainline_saved_search_list"(text, integer, text)'),
    ('public."grainline_saved_search_delete_one"(text, text)')
)
SELECT format(
  'REVOKE ALL ON FUNCTION %s FROM %I',
  function_signature,
  :'runtime_role'
)
  FROM saved_search_rpc
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

WITH saved_search_rpc(function_signature) AS (
  VALUES
    ('public."grainline_saved_search_list"(text, integer, text)'),
    ('public."grainline_saved_search_delete_one"(text, text)')
)
SELECT format(
  'GRANT EXECUTE ON FUNCTION %s TO %I',
  function_signature,
  :'runtime_role'
)
  FROM saved_search_rpc
 WHERE to_regprocedure(function_signature) IS NOT NULL;
\gexec

WITH failure AS (
  SELECT 'required extension pg_trgm is not installed' AS message
  WHERE NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm')
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_role_provisioning_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '') AS grainline_role_provisioning_failure;
\gset
\if :grainline_role_provisioning_failed
\echo :grainline_role_provisioning_failure
DO $grainline_role_provisioning_abort$
BEGIN
  RAISE EXCEPTION 'runtime-role provisioning refused';
END
$grainline_role_provisioning_abort$;
\endif
\unset grainline_role_provisioning_failed
\unset grainline_role_provisioning_failure

-- Public search/autocomplete SQL uses pg_trgm's similarity() function and `%`
-- operator. Trusted extension functions may be owned by a bootstrap/admin role
-- even when CREATE EXTENSION runs as the migration role. Grant explicitly where
-- this role has grant option; otherwise verify runtime EXECUTE still exists,
-- normally through PostgreSQL's PUBLIC function default.
WITH failure AS (
  SELECT format(
    'runtime role %s lacks EXECUTE on pg_trgm function %s owned by %s, and migration role %s cannot grant it; use reviewed admin-owned provisioning',
    :'runtime_role',
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
    pg_get_userbyid(p.proowner),
    :'migration_role'
  ) AS message
  FROM pg_extension e
  JOIN pg_depend d ON d.refclassid = 'pg_extension'::regclass
                    AND d.refobjid = e.oid
                    AND d.classid = 'pg_proc'::regclass
                    AND d.deptype = 'e'
  JOIN pg_proc p ON p.oid = d.objid
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE e.extname = 'pg_trgm'
    AND NOT has_function_privilege(:'runtime_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege(:'migration_role', p.oid, 'EXECUTE WITH GRANT OPTION')
  ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
  LIMIT 1
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_role_provisioning_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '') AS grainline_role_provisioning_failure;
\gset
\if :grainline_role_provisioning_failed
\echo :grainline_role_provisioning_failure
DO $grainline_role_provisioning_abort$
BEGIN
  RAISE EXCEPTION 'runtime-role provisioning refused';
END
$grainline_role_provisioning_abort$;
\endif
\unset grainline_role_provisioning_failed
\unset grainline_role_provisioning_failure

SELECT format(
  'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO %I',
  n.nspname,
  p.proname,
  pg_get_function_identity_arguments(p.oid),
  :'runtime_role'
)
FROM pg_extension e
JOIN pg_depend d ON d.refclassid = 'pg_extension'::regclass
                  AND d.refobjid = e.oid
                  AND d.classid = 'pg_proc'::regclass
                  AND d.deptype = 'e'
JOIN pg_proc p ON p.oid = d.objid
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE e.extname = 'pg_trgm'
  AND has_function_privilege(:'migration_role', p.oid, 'EXECUTE WITH GRANT OPTION')
ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON TABLE %s FROM %I',
  to_regclass('public._prisma_migrations'),
  :'runtime_role'
)
WHERE to_regclass('public._prisma_migrations') IS NOT NULL;
\gexec

-- Default table ACLs must converge as tightly as current table ACLs. Revoke
-- every direct runtime privilege outside CRUD and every grant option using the
-- privilege names reported by this PostgreSQL version (including MAINTAIN when
-- present). PUBLIC default grants are not mutated implicitly; the audit rejects
-- them so any broader change is explicit and reviewed.
WITH roles AS (
  SELECT
    (SELECT oid FROM pg_roles WHERE rolname = :'migration_role') AS migration_oid,
    (SELECT oid FROM pg_roles WHERE rolname = :'runtime_role') AS runtime_oid
), unexpected AS (
  SELECT
    d.defaclnamespace,
    n.nspname,
    string_agg(DISTINCT upper(acl.privilege_type), ', ' ORDER BY upper(acl.privilege_type)) AS privileges
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN roles
  CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
  WHERE d.defaclrole = roles.migration_oid
    AND d.defaclobjtype = 'r'
    AND acl.grantee = roles.runtime_oid
    AND (d.defaclnamespace = 0 OR n.nspname = 'public')
    AND NOT (upper(acl.privilege_type) = ANY (ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']))
  GROUP BY d.defaclnamespace, n.nspname
)
SELECT CASE
  WHEN defaclnamespace = 0 THEN format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE %s ON TABLES FROM %I',
    :'migration_role',
    privileges,
    :'runtime_role'
  )
  ELSE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE %s ON TABLES FROM %I',
    :'migration_role',
    nspname,
    privileges,
    :'runtime_role'
  )
END
FROM unexpected
ORDER BY defaclnamespace, nspname;
\gexec

WITH roles AS (
  SELECT
    (SELECT oid FROM pg_roles WHERE rolname = :'migration_role') AS migration_oid,
    (SELECT oid FROM pg_roles WHERE rolname = :'runtime_role') AS runtime_oid
), grant_options AS (
  SELECT
    d.defaclnamespace,
    n.nspname,
    string_agg(DISTINCT upper(acl.privilege_type), ', ' ORDER BY upper(acl.privilege_type)) AS privileges
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN roles
  CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
  WHERE d.defaclrole = roles.migration_oid
    AND d.defaclobjtype = 'r'
    AND acl.grantee = roles.runtime_oid
    AND (d.defaclnamespace = 0 OR n.nspname = 'public')
    AND acl.is_grantable
  GROUP BY d.defaclnamespace, n.nspname
)
SELECT CASE
  WHEN defaclnamespace = 0 THEN format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE GRANT OPTION FOR %s ON TABLES FROM %I',
    :'migration_role',
    privileges,
    :'runtime_role'
  )
  ELSE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE GRANT OPTION FOR %s ON TABLES FROM %I',
    :'migration_role',
    nspname,
    privileges,
    :'runtime_role'
  )
END
FROM grant_options
ORDER BY defaclnamespace, nspname;
\gexec

ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"runtime_role";

ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"runtime_role";

-- Function and type default privileges are intentionally not changed while
-- Postgres PUBLIC defaults remain intact. Current extension function
-- dependencies are granted explicitly above. If future migrations revoke PUBLIC
-- defaults for functions or types, add explicit runtime default privileges here
-- and update tests/db-grant-inventory.test.mjs.

COMMIT;
