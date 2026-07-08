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

SELECT format(
  'expected current_user and session_user to equal migration role %s, got current_user=%s session_user=%s',
  :'migration_role',
  current_user,
  session_user
) AS grainline_role_provisioning_failure
WHERE current_user <> :'migration_role' OR session_user <> :'migration_role';
\gset
\if :{?grainline_role_provisioning_failure}
\echo :grainline_role_provisioning_failure
\quit 1
\endif
\unset grainline_role_provisioning_failure

SELECT format('runtime role %s does not exist', :'runtime_role') AS grainline_role_provisioning_failure
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_role');
\gset
\if :{?grainline_role_provisioning_failure}
\echo :grainline_role_provisioning_failure
\quit 1
\endif
\unset grainline_role_provisioning_failure

SELECT format('migration role %s does not exist', :'migration_role') AS grainline_role_provisioning_failure
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migration_role');
\gset
\if :{?grainline_role_provisioning_failure}
\echo :grainline_role_provisioning_failure
\quit 1
\endif
\unset grainline_role_provisioning_failure

SELECT format('runtime role %s must differ from migration role %s', :'runtime_role', :'migration_role')
  AS grainline_role_provisioning_failure
WHERE :'runtime_role' = :'migration_role';
\gset
\if :{?grainline_role_provisioning_failure}
\echo :grainline_role_provisioning_failure
\quit 1
\endif
\unset grainline_role_provisioning_failure

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
) AS grainline_role_provisioning_failure
FROM pg_roles
WHERE rolname = :'runtime_role'
  AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls);
\gset
\if :{?grainline_role_provisioning_failure}
\echo :grainline_role_provisioning_failure
\quit 1
\endif
\unset grainline_role_provisioning_failure

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
)
SELECT format('runtime role %s is member of role %s', :'runtime_role', rolname)
  AS grainline_role_provisioning_failure
FROM memberships
ORDER BY rolname
LIMIT 1;
\gset
\if :{?grainline_role_provisioning_failure}
\echo :grainline_role_provisioning_failure
\quit 1
\endif
\unset grainline_role_provisioning_failure

GRANT USAGE ON SCHEMA public TO :"runtime_role";
REVOKE CREATE ON SCHEMA public FROM :"runtime_role";
SELECT format('REVOKE CREATE ON DATABASE %I FROM %I', current_database(), :'runtime_role');
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

SELECT 'required extension pg_trgm is not installed' AS grainline_role_provisioning_failure
WHERE NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm');
\gset
\if :{?grainline_role_provisioning_failure}
\echo :grainline_role_provisioning_failure
\quit 1
\endif
\unset grainline_role_provisioning_failure

-- Public search/autocomplete SQL uses pg_trgm's similarity() function and `%`
-- operator. Grant all functions owned by the pg_trgm extension explicitly so a
-- future PUBLIC-function lockdown does not break runtime search.
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
ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON TABLE %s FROM %I',
  to_regclass('public._prisma_migrations'),
  :'runtime_role'
)
WHERE to_regclass('public._prisma_migrations') IS NOT NULL;
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
