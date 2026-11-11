import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  EMAIL_SERVICE_LEAST_PRIVILEGE_ACTIVATION_MIGRATION,
  EMAIL_SERVICE_LEAST_PRIVILEGE_ACTIVATION_MIGRATION_SHA256,
  EMAIL_SERVICE_LEAST_PRIVILEGE_EMERGENCY_ROLLBACK_MARKER,
  EMAIL_SERVICE_LEAST_PRIVILEGE_TABLES,
  REQUIRED_TABLE_PRIVILEGES,
  readEmailServiceLeastPrivilegeActivationState,
  requiredRuntimeTablePrivileges,
} from "../scripts/audit-runtime-db-grants.mjs";

const migrationPath =
  process.env.EMAIL_SERVICE_LEAST_PRIVILEGE_ACTIVATION_MIGRATION_PATH
  ?? "prisma/migrations/20261101090000_activate_email_service_least_privilege/migration.sql";
const rollbackPath =
  "docs/rls-drafts/email-service-least-privilege-activation-rollback.sql";
const migration = readFileSync(migrationPath, "utf8");
const rollback = readFileSync(rollbackPath, "utf8");
const provision = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");

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
  "grainline_email_hard_suppression_apply",
  "grainline_email_outbox_account_deletion_fence",
  "grainline_email_outbox_claim_batch",
  "grainline_email_outbox_claim_one",
  "grainline_email_outbox_complete",
  "grainline_email_outbox_defer",
  "grainline_email_outbox_enqueue_legacy",
  "grainline_email_outbox_fail",
  "grainline_email_outbox_skip",
  "grainline_email_outbox_begin_provider_attempt",
  "grainline_newsletter_expired_unconfirmed_delete_batch",
  "grainline_email_outbox_retention_delete_batch",
  "grainline_resend_webhook_event_retention_delete_batch",
  "grainline_email_service_ops_health",
  "grainline_email_outbox_cancel_seller_broadcast",
  "grainline_email_outbox_redact_deleted_seller",
];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/u.test(entry.name) ? [path] : [];
  });
}

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
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION\s+public\.grainline_account_deletion_email_key_core\(text\)\s+FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime/u,
  );
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
  assert.equal(new Set(FUNCTIONS).size, 30);
  assert.match(migration, /NOT routine\.prosecdef/u);
  assert.match(migration, /search_path=pg_catalog/u);
  assert.match(migration, /owner_role\.rolsuper OR owner_role\.rolbypassrls/u);
  assert.match(migration, /acl\.grantee = 0 AND acl\.privilege_type = 'EXECUTE'/u);
});

test("ordinary application source has zero direct email-service table access", () => {
  const prismaMember = /\.(?:emailOutbox|emailSuppression|emailFailureCount|newsletterSubscriber|resendWebhookEvent)\b/u;
  const rawTable = /\b(?:FROM|INTO|JOIN|UPDATE|TABLE)\s+(?:public\.)?"(?:EmailOutbox|EmailSuppression|EmailFailureCount|NewsletterSubscriber|ResendWebhookEvent)"/iu;
  const violations = [];
  for (const path of sourceFiles("src")) {
    const source = readFileSync(path, "utf8");
    if (prismaMember.test(source) || rawTable.test(source)) violations.push(path);
  }
  assert.deepEqual(violations, []);
});

test("rollback is database-first and restores only predecessor CRUD", () => {
  assert.match(rollback, /^-- Database-first emergency rollback/u);
  assert.ok(
    rollback.indexOf("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE")
      < rollback.indexOf("rollback_postflight"),
  );
  assert.match(rollback, /recurring role provisioner plus global grant audit preserve/u);
  assert.match(
    rollback,
    /activation[\s\S]*recorded as applied\. Prisma therefore cannot silently reapply/u,
  );
  assert.doesNotMatch(rollback, /SET rolled_back_at/u);
  assert.match(rollback, /rolled_back_at IS NULL/u);
  assert.doesNotMatch(rollback, /rolled_back_at IS NOT NULL/u);
  assert.match(rollback, /new reviewed[\s\S]*forward recovery migration/u);
  assert.match(rollback, new RegExp(EMAIL_SERVICE_LEAST_PRIVILEGE_EMERGENCY_ROLLBACK_MARKER, "u"));
  assert.doesNotMatch(rollback, /migrate resolve --rolled-back/u);
  assert.match(
    rollback,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE[\s\S]*TO grainline_app_runtime/u,
  );
  assert.match(
    rollback,
    /GRANT EXECUTE ON FUNCTION\s+public\.grainline_account_deletion_email_key_core\(text\)\s+TO grainline_app_runtime/u,
  );
  assert.match(rollback, /runtimeTruncate|TRUNCATE/u);
  assert.match(rollback, /REFERENCES/u);
  assert.match(rollback, /TRIGGER/u);
  assert.equal(
    (
      rollback.match(
        /NOT class\.relrowsecurity\s+AND NOT class\.relforcerowsecurity/gu,
      ) ?? []
    ).length,
    2,
  );
  assert.doesNotMatch(rollback, /\b(?:DROP|TRUNCATE)\s+TABLE\b/u);
  assert.match(rollback, /\nCOMMIT;\s*$/u);
});

test("recurring provisioning and the global grant audit preserve activation", () => {
  assert.deepEqual(EMAIL_SERVICE_LEAST_PRIVILEGE_TABLES, TABLES);
  for (const table of TABLES) {
    assert.deepEqual(
      requiredRuntimeTablePrivileges(table, {
        emailServiceLeastPrivilegeActivationApplied: false,
        rlsPolicyTables: [],
      }),
      REQUIRED_TABLE_PRIVILEGES,
      `${table} must keep predecessor CRUD before activation`,
    );
    assert.deepEqual(
      requiredRuntimeTablePrivileges(table, {
        emailServiceLeastPrivilegeActivationApplied: true,
        rlsPolicyTables: [],
      }),
      [],
      `${table} must keep zero direct authority after activation`,
    );
  }
  assert.match(
    provision,
    /20261101090000_activate_email_service_least_privilege/u,
  );
  assert.match(
    provision,
    /4c9c30b2b95854f5dfe587532ecfb98a0698e54c2c50cf49cfdb4fdf0c8f02cf/u,
  );
  assert.match(provision, /exact_rolled_back_count/u);
  assert.match(provision, /exact_emergency_rollback_count/u);
  assert.match(
    provision,
    new RegExp(EMAIL_SERVICE_LEAST_PRIVILEGE_EMERGENCY_ROLLBACK_MARKER, "u"),
  );
  assert.match(
    provision,
    /\\if :grainline_email_service_least_privilege_applied[\s\S]*REVOKE ALL ON TABLE[\s\S]*NewsletterSubscriber[\s\S]*EmailFailureCount[\s\S]*\\gexec/u,
  );
});

test("the grant audit accepts exact active, emergency, and rolled-back states", async () => {
  async function stateFor(row) {
    return readEmailServiceLeastPrivilegeActivationState({
      async query(sql, params) {
        if (sql.includes("to_regclass")) {
          return { rows: [{ migration_table: "_prisma_migrations" }] };
        }
        assert.deepEqual(params, [EMAIL_SERVICE_LEAST_PRIVILEGE_ACTIVATION_MIGRATION]);
        return { rows: row ? [row] : [] };
      },
    });
  }

  const base = {
    migration_name: EMAIL_SERVICE_LEAST_PRIVILEGE_ACTIVATION_MIGRATION,
    checksum: EMAIL_SERVICE_LEAST_PRIVILEGE_ACTIVATION_MIGRATION_SHA256,
    finished_at: new Date(),
    applied_steps_count: 0,
  };
  assert.deepEqual(await stateFor(null), { applied: false, issues: [] });
  assert.deepEqual(await stateFor({ ...base, rolled_back_at: null }), {
    applied: true,
    issues: [],
  });
  assert.deepEqual(await stateFor({ ...base, rolled_back_at: new Date() }), {
    applied: false,
    issues: [],
  });
  assert.deepEqual(await stateFor({
    ...base,
    rolled_back_at: null,
    logs: EMAIL_SERVICE_LEAST_PRIVILEGE_EMERGENCY_ROLLBACK_MARKER,
  }), {
    applied: false,
    issues: [],
  });
  const drifted = await stateFor({
    ...base,
    checksum: "drifted",
    rolled_back_at: null,
  });
  assert.equal(drifted.applied, false);
  assert.match(drifted.issues.join("\n"), /ledger is partial or drifted/u);
});
