import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rollback = readFileSync(
  "docs/rls-drafts/admin-audit-log-preparation-rollback.sql",
  "utf8",
);

const NEW_FUNCTIONS = Object.freeze([
  "grainline_admin_audit_redact_deleted_references",
  "grainline_admin_audit_insert_write_fence",
  "grainline_admin_audit_append",
  "grainline_admin_audit_staff_count",
  "grainline_admin_audit_staff_page",
  "grainline_admin_audit_staff_undo_source",
  "grainline_admin_audit_undo_claim",
  "grainline_admin_audit_account_deletion_write_fence",
  "grainline_admin_audit_account_deletion_candidates",
  "grainline_admin_audit_account_deletion_redaction_plans_enqueue",
  "grainline_admin_audit_account_deletion_redaction_apply",
  "grainline_admin_audit_account_deletion_legacy_redaction_apply",
  "grainline_admin_audit_staff_ban_rows",
  "grainline_admin_audit_ban_repair_candidates",
  "grainline_admin_audit_ban_repair_state",
  "grainline_admin_audit_ban_repair_append",
]);

test("AdminAuditLog preparation rollback is app-first and atomic", () => {
  assert.match(rollback, /^-- Emergency app-first rollback/u);
  assert.match(rollback, /Deploy the reviewed predecessor application before/u);
  assert.equal((rollback.match(/^BEGIN;$/gmu) ?? []).length, 1);
  assert.equal((rollback.match(/^COMMIT;$/gmu) ?? []).length, 1);
  assert.match(rollback, /SET LOCAL lock_timeout = '5s'/u);
  assert.match(rollback, /LOCK TABLE public\."AdminAuditLog" IN ACCESS EXCLUSIVE MODE/u);
  assert.match(rollback, /Keep the successfully applied Prisma ledger row intact/u);
  assert.match(rollback, /new reviewed[\s\S]*forward migration with a new name/u);
  assert.doesNotMatch(rollback, /migrate resolve --rolled-back/u);
  assert.doesNotMatch(rollback, /\bCASCADE\b/u);
  assert.doesNotMatch(rollback, /\b(?:DROP|TRUNCATE)\s+TABLE\b/u);
  assert.doesNotMatch(rollback, /\b(?:ADD|DROP)\s+COLUMN\b/u);
  assert.doesNotMatch(rollback, /(?:ENABLE|DISABLE|FORCE|NO FORCE) ROW LEVEL SECURITY/u);
  assert.doesNotMatch(rollback, /\b(?:GRANT|REVOKE)\b[^\n]*\bON TABLE\b/iu);
});

test("AdminAuditLog preparation rollback removes only the additive objects", () => {
  assert.match(
    rollback,
    /DROP TRIGGER "AdminAuditLog_insert_write_fence"\s+ON public\."AdminAuditLog"/u,
  );
  assert.match(
    rollback,
    /DROP INDEX[\s\S]*AdminAuditLog_action_createdAt_id_idx[\s\S]*AdminAuditLog_createdAt_id_idx/u,
  );
  for (const name of NEW_FUNCTIONS) {
    assert.match(rollback, new RegExp(`public\\.${name}\\(`, "u"), name);
  }
  assert.equal(
    new Set(
      [...[...rollback.matchAll(/DROP FUNCTION([\s\S]*?);/gu)][0][1]
        .matchAll(/public\.(grainline_[a-z0-9_]+)\(/gu)]
        .map((match) => match[1]),
    ).size,
    NEW_FUNCTIONS.length,
  );
  assert.match(rollback, /changed retained functions/u);
  assert.match(rollback, /<> 23/u);
});
