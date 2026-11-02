import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20261101090000_activate_email_service_least_privilege/migration.sql";
const rollbackPath =
  "docs/rls-drafts/email-service-least-privilege-activation-rollback.sql";
const migration = readFileSync(migrationPath, "utf8");
const rollback = readFileSync(rollbackPath, "utf8");

const TABLES = [
  "NewsletterSubscriber",
  "EmailSuppression",
  "ResendWebhookEvent",
  "EmailOutbox",
  "EmailFailureCount",
];

const FUNCTIONS = [
  "grainline_email_suppression_exists",
  "grainline_email_one_click_suppression_clear",
  "grainline_newsletter_signup_reserve",
  "grainline_newsletter_signup_release",
  "grainline_newsletter_confirmation_valid",
  "grainline_newsletter_confirm",
  "grainline_newsletter_token_superseded",
  "grainline_email_unsubscribe_apply",
  "grainline_email_account_deletion_suppression_clear",
  "grainline_email_service_owner_export",
  "grainline_email_service_account_deletion_apply",
  "grainline_resend_webhook_event_reserve",
  "grainline_resend_webhook_event_complete",
  "grainline_resend_webhook_event_fail",
  "grainline_email_outbox_begin_provider_attempt",
  "grainline_newsletter_expired_unconfirmed_delete_batch",
  "grainline_email_outbox_retention_delete_batch",
  "grainline_resend_webhook_event_retention_delete_batch",
  "grainline_email_service_ops_health",
  "grainline_email_outbox_cancel_seller_broadcast",
  "grainline_email_outbox_redact_deleted_seller",
];

test("email service activation is grant-only, atomic, and bounded", () => {
  assert.match(migration, /^-- Activate[\s\S]*\nBEGIN;/u);
  assert.match(migration, /SET LOCAL lock_timeout = '10s'/u);
  assert.match(migration, /SET LOCAL statement_timeout = '60s'/u);
  assert.match(migration, /LOCK TABLE[\s\S]*IN ACCESS EXCLUSIVE MODE/u);
  assert.match(migration, /EmailFailureCount must be empty before activation/u);
  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES ON TABLE[\s\S]*FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime/u,
  );
  assert.match(
    migration,
    /REVOKE SELECT \(%1\$s\), INSERT \(%1\$s\), UPDATE \(%1\$s\), REFERENCES \(%1\$s\)/u,
  );
  assert.match(migration, /Email service zero-direct activation failed/u);
  assert.match(migration, /\nCOMMIT;\s*$/u);
  assert.doesNotMatch(
    migration,
    /ALTER TABLE[\s\S]*(?:ENABLE|FORCE|DISABLE|NO FORCE) ROW LEVEL SECURITY/u,
  );
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|FROM|TABLE|public\.)/u);
});

test("activation pins every table and fixed operation", () => {
  for (const table of TABLES) {
    assert.ok(migration.includes(`public."${table}"`), table);
    assert.ok(rollback.includes(`public."${table}"`), table);
  }
  for (const functionName of FUNCTIONS) {
    assert.ok(migration.includes(`public.${functionName}(`), functionName);
  }
  assert.equal(new Set(FUNCTIONS).size, 21);
  assert.match(migration, /NOT routine\.prosecdef/u);
  assert.match(migration, /search_path=pg_catalog/u);
  assert.match(migration, /owner_role\.rolsuper OR owner_role\.rolbypassrls/u);
  assert.match(migration, /acl\.grantee = 0 AND acl\.privilege_type = 'EXECUTE'/u);
});

test("rollback is database-first and restores only predecessor CRUD", () => {
  assert.match(rollback, /^-- Database-first emergency rollback/u);
  assert.ok(
    rollback.indexOf("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE")
      < rollback.indexOf("rollback_postflight"),
  );
  assert.match(rollback, /migrate resolve --rolled-back/u);
  assert.match(
    rollback,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE[\s\S]*TO grainline_app_runtime/u,
  );
  assert.match(rollback, /runtimeTruncate|TRUNCATE/u);
  assert.match(rollback, /REFERENCES/u);
  assert.match(rollback, /TRIGGER/u);
  assert.doesNotMatch(rollback, /\b(?:DROP|TRUNCATE)\s+TABLE\b/u);
  assert.match(rollback, /\nCOMMIT;\s*$/u);
});
