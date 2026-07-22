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
\quit 1
\endif

\if :{?migration_role}
\else
\echo 'missing required psql variable: -v migration_role=grainline_migration_owner'
\quit 1
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
\quit 1
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
\quit 1
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
\quit 1
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
\quit 1
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
\quit 1
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
\quit 1
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
\quit 1
\endif
\unset grainline_role_provisioning_failed
\unset grainline_role_provisioning_failure

\if :notification_rls_active
REVOKE INSERT, UPDATE, DELETE ON TABLE public."Notification" FROM :"runtime_role";
GRANT UPDATE (read) ON TABLE public."Notification" TO :"runtime_role";
\endif

GRANT USAGE ON TYPE
  public."BlogAuthorType",
  public."BlogPostStatus",
  public."BlogPostType",
  public."CaseReason",
  public."CaseResolution",
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

GRANT EXECUTE ON FUNCTION public."grainline_notification_preferences_valid"(jsonb) TO :"runtime_role";

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
\quit 1
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
\quit 1
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
