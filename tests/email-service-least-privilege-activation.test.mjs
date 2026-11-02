import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EMAIL_SERVICE_LEAST_PRIVILEGE_ACTIVATION_MIGRATION,
  EMAIL_SERVICE_LEAST_PRIVILEGE_ACTIVATION_MIGRATION_SHA256,
  readEmailServiceLeastPrivilegeActivationState,
  requiredRuntimeTablePrivileges,
} from "../scripts/audit-runtime-db-grants.mjs";
import { privilegeRelease } from "../scripts/privilege-release-catalog.mjs";
import {
  classifyFunctionNamespace,
  classifyFunctions,
} from "../scripts/privilege-release-production-inspect.mjs";
import {
  REVIEWED_MANUALLY_APPLIED_MIGRATIONS,
} from "../scripts/reviewed-manually-applied-migrations.mjs";

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
  "grainline_email_account_deletion_suppression_clear",
  "grainline_email_hard_suppression_apply",
  "grainline_email_one_click_suppression_clear",
  "grainline_email_outbox_account_deletion_fence",
  "grainline_email_outbox_begin_provider_attempt",
  "grainline_email_outbox_cancel_seller_broadcast",
  "grainline_email_outbox_claim_batch",
  "grainline_email_outbox_claim_one",
  "grainline_email_outbox_complete",
  "grainline_email_outbox_defer",
  "grainline_email_outbox_enqueue_legacy",
  "grainline_email_outbox_fail",
  "grainline_email_outbox_redact_deleted_seller",
  "grainline_email_outbox_retention_delete_batch",
  "grainline_email_outbox_skip",
  "grainline_email_service_account_deletion_apply",
  "grainline_email_service_ops_health",
  "grainline_email_service_owner_export",
  "grainline_email_suppression_exists",
  "grainline_email_unsubscribe_apply",
  "grainline_newsletter_confirm",
  "grainline_newsletter_confirmation_valid",
  "grainline_newsletter_expired_unconfirmed_delete_batch",
  "grainline_newsletter_signup_reserve",
  "grainline_newsletter_signup_release",
  "grainline_newsletter_token_superseded",
  "grainline_resend_webhook_event_complete",
  "grainline_resend_webhook_event_fail",
  "grainline_resend_webhook_event_reserve",
  "grainline_resend_webhook_event_retention_delete_batch",
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
  assert.equal(new Set(FUNCTIONS).size, 30);
  const contracts = privilegeRelease("email_service_v1").functions;
  assert.equal(Object.keys(contracts).length, 30);
  for (const contract of Object.values(contracts)) {
    assert.deepEqual(Object.keys(contract).sort(), [
      "kind",
      "language",
      "leakproof",
      "parallelSafety",
      "result",
      "sourceSha256",
      "strict",
      "volatility",
    ]);
  }
  assert.match(migration, /NOT routine\.prosecdef/u);
  assert.match(migration, /search_path=pg_catalog/u);
  assert.match(migration, /owner_role\.rolsuper OR owner_role\.rolbypassrls/u);
  assert.match(migration, /acl\.grantee = 0 AND acl\.privilege_type = 'EXECUTE'/u);
  assert.match(migration, /Email service runtime function catalog drifted/u);
  assert.match(migration, /FROM actual[\s\S]*EXCEPT[\s\S]*FROM expected/u);
  assert.match(migration, /FROM expected[\s\S]*EXCEPT[\s\S]*FROM actual/u);
  assert.doesNotMatch(migration, /array_agg\(actual\.signature/u);
  assert.deepEqual(
    privilegeRelease("email_service_v1").functionNamespacePrefixes,
    ["grainline_email_", "grainline_newsletter_", "grainline_resend_"],
  );
});

test("rollback is database-first and restores only predecessor CRUD", () => {
  assert.match(rollback, /^-- Database-first emergency rollback/u);
  assert.ok(
    rollback.indexOf("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE")
      < rollback.indexOf("rollback_postflight"),
  );
  assert.doesNotMatch(rollback, /migrate resolve --rolled-back/u);
  assert.match(rollback, /Keep the successfully[\s\S]*Prisma ledger row intact/u);
  assert.match(rollback, /new reviewed forward[\s\S]*migration with a new name/u);
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

test("manual activation ledger state changes the recurring grant expectation", async () => {
  assert.equal(
    REVIEWED_MANUALLY_APPLIED_MIGRATIONS.get(
      EMAIL_SERVICE_LEAST_PRIVILEGE_ACTIVATION_MIGRATION,
    ),
    EMAIL_SERVICE_LEAST_PRIVILEGE_ACTIVATION_MIGRATION_SHA256,
  );
  const state = await readEmailServiceLeastPrivilegeActivationState({
    async query(sql, params) {
      if (sql.includes("to_regclass")) {
        return { rows: [{ migration_table: "_prisma_migrations" }] };
      }
      assert.deepEqual(params, [EMAIL_SERVICE_LEAST_PRIVILEGE_ACTIVATION_MIGRATION]);
      return { rows: [{
        migration_name: EMAIL_SERVICE_LEAST_PRIVILEGE_ACTIVATION_MIGRATION,
        checksum: EMAIL_SERVICE_LEAST_PRIVILEGE_ACTIVATION_MIGRATION_SHA256,
        finished_at: new Date(),
        rolled_back_at: null,
        applied_steps_count: 0,
      }] };
    },
  });
  assert.deepEqual(state, { applied: true, issues: [] });
  assert.deepEqual(
    requiredRuntimeTablePrivileges("EmailOutbox", {
      rlsPolicyTables: [],
      emailServiceLeastPrivilegeActivationApplied: false,
    }),
    ["SELECT", "INSERT", "UPDATE", "DELETE"],
  );
  assert.deepEqual(
    requiredRuntimeTablePrivileges("EmailOutbox", {
      rlsPolicyTables: [],
      emailServiceLeastPrivilegeActivationApplied: true,
    }),
    [],
  );
});

test("function inspection pins behavior-changing PostgreSQL attributes", () => {
  const signature = "public.example_fixed(text)";
  const source = "BEGIN RETURN 1; END";
  const contract = {
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    language: "plpgsql",
    result: "integer",
    volatility: "v",
    strict: false,
    leakproof: false,
    parallelSafety: "u",
    kind: "f",
  };
  const row = {
    signature,
    exists: true,
    source,
    security_definer: true,
    configuration: ["search_path=pg_catalog"],
    owner_bypasses_rls: true,
    public_execute: false,
    runtime_execute: true,
    language: contract.language,
    result: contract.result,
    volatility: contract.volatility,
    strict: contract.strict,
    leakproof: contract.leakproof,
    parallel_safety: contract.parallelSafety,
    function_kind: contract.kind,
  };
  const release = { functions: { [signature]: contract } };
  assert.equal(classifyFunctions([row], release)[0].result, "integer");
  assert.throws(
    () => classifyFunctions([{ ...row, volatility: "s" }], release),
    /volatility drifted/u,
  );
  assert.throws(
    () => classifyFunctions([{ ...row, result: "text" }], release),
    /result drifted/u,
  );
});

test("function inspection rejects unreviewed executable email authorities", () => {
  const release = privilegeRelease("email_service_v1");
  const reviewedRows = Object.keys(release.functions)
    .sort()
    .map((signature) => ({ signature }));
  assert.equal(classifyFunctionNamespace(reviewedRows, release).length, 30);
  assert.throws(
    () => classifyFunctionNamespace(
      [...reviewedRows, { signature: "public.grainline_email_unreviewed(text)" }],
      release,
    ),
    /runtime function namespace drifted/u,
  );
});
