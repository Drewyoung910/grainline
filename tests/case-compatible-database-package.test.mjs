import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationRoot = "prisma/migrations";
const packageDoc = fs.readFileSync(
  "docs/case-compatible-database-preparation-release.md",
  "utf8",
);
const productionWorkflow = fs.readFileSync(
  ".github/workflows/production-migrations.yml",
  "utf8",
);

const casePreparationMigrations = [
  "20260729024500_prepare_case_resolution_claim_schema",
  "20260729043000_prepare_case_stripe_dispute_authority",
  "20260729044000_prepare_case_seller_refund_authority",
  "20260729045000_prepare_case_staff_resolution_authority",
  "20260729050000_prepare_case_participant_resolution_authority",
  "20260729051000_prepare_case_open_authority",
  "20260729052000_prepare_case_reply_authority",
  "20260729053000_prepare_case_message_preflight_authority",
  "20260729054000_prepare_case_message_page_authority",
  "20260729055000_prepare_case_recipient_read_authority",
  "20260729056000_prepare_case_staff_queue_authority",
  "20260729057000_prepare_case_order_active_authority",
  "20260729058000_prepare_case_seller_aggregate_authority",
  "20260729059000_prepare_case_account_export_authority",
  "20260729060000_prepare_case_escalation_cron_authority",
  "20260729061000_prepare_case_account_deletion_authority",
];

test("Case database package contains exactly the reviewed compatible sequence", () => {
  const actual = fs
    .readdirSync(migrationRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        /^20260729.*(?:case|Case)/i.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(actual, [...casePreparationMigrations].sort());
  for (const migration of casePreparationMigrations) {
    assert.equal(
      fs.existsSync(path.join(migrationRoot, migration, "migration.sql")),
      true,
      `${migration} is missing its SQL artifact`,
    );
  }
});

test("compatible migrations do not activate or revoke direct Case-family access", () => {
  for (const migration of casePreparationMigrations) {
    const sql = fs.readFileSync(
      path.join(migrationRoot, migration, "migration.sql"),
      "utf8",
    );
    assert.doesNotMatch(
      sql,
      /ALTER TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)" (?:ENABLE|FORCE) ROW LEVEL SECURITY/,
      `${migration} must not activate Case-family RLS`,
    );
    assert.doesNotMatch(
      sql,
      /CREATE POLICY .* ON public\."(?:Case|CaseMessage|CaseMessageAttachment)"/i,
      `${migration} must not create Case-family policies`,
    );
    assert.doesNotMatch(
      sql,
      /(?:GRANT|REVOKE).* ON TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)"/,
      `${migration} must retain predecessor Case-family table grants`,
    );
  }
});

test("read mode is promoted while activation artifacts remain drafts", () => {
  for (const draft of [
    "case-case-message-read-mode.sql",
    "case-case-message-activation.sql",
    "case-case-message-activation-rollback.sql",
    "case-case-message-force.sql",
    "case-case-message-force-rollback.sql",
  ]) {
    assert.equal(fs.existsSync(path.join("docs/rls-drafts", draft)), true);
  }

  assert.match(
    productionWorkflow,
    /SAVED_SEARCH_RLS_DEPLOY_PHASE:\s*case-read-mode-reviewed/,
  );
  assert.match(
    productionWorkflow,
    /Verify exact Case read-mode migration tree/,
  );
  assert.doesNotMatch(
    productionWorkflow,
    /case-(?:activation|force)-reviewed/,
  );
  assert.match(
    packageDoc,
    /4728f673fdf0a11d38aaac384f3d9afe2cf86117/,
  );
  assert.match(
    packageDoc,
    /f2f6861b177a47d22ed304714372584b79a0a0b0/,
  );
  assert.match(packageDoc, /Case-family RLS:\s+off/);
});
