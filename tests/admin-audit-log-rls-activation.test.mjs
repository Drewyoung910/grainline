import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  privateTableRlsActivation,
  verifyPrivateTableRlsActivationSource,
} from "../scripts/private-table-rls-activation-catalog.mjs";

const releaseId = "admin_audit_log_v1";

test("AdminAuditLog activation is policyless and removes all direct authority", () => {
  const release = privateTableRlsActivation(releaseId);
  const verified = verifyPrivateTableRlsActivationSource(releaseId);
  const migration = readFileSync(verified.migrationPath, "utf8");

  assert.equal(release.table, "AdminAuditLog");
  assert.equal(release.mode, "policyless_combined_enable_force");
  assert.deepEqual(release.policies, []);
  assert.deepEqual(release.predecessorRuntimePrivileges, [
    "SELECT", "INSERT", "UPDATE", "DELETE",
  ]);
  assert.deepEqual(release.activatedRuntimePrivileges, []);
  assert.deepEqual(release.activatedStaffPrivileges, []);
  assert.deepEqual(release.activatedAccountDeletionPrivileges, []);
  assert.deepEqual(release.activatedPublicPrivileges, []);
  assert.equal(release.preparation.functions.length, 16);
  assert.equal(release.preparation.retainedFunctions.length, 23);
  assert.equal(verified.migrationDigest, release.migrationSha256);
  assert.equal(verified.rollbackDigest, release.rollbackSha256);
  assert.match(migration, /LOCK TABLE public\."AdminAuditLog" IN ACCESS EXCLUSIVE MODE/u);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/u);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/u);
  assert.match(
    migration,
    /FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime,\s+grainline_account_deletion_runtime/u,
  );
  assert.equal((migration.match(/\bCREATE POLICY\b/gu) ?? []).length, 0);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});

test("AdminAuditLog activation seals the table, trigger, and every function", () => {
  const verified = verifyPrivateTableRlsActivationSource(releaseId);
  const migration = readFileSync(verified.migrationPath, "utf8");

  for (const marker of [
    "AdminAuditLog columns drifted",
    "AdminAuditLog constraints drifted",
    "AdminAuditLog indexes drifted",
    "AdminAuditLog trigger inventory drifted",
    "AdminAuditLog has an unreviewed function reader or writer",
  ]) {
    assert.match(migration, new RegExp(marker, "u"));
  }
  for (const entry of [
    ...verified.preparation.release.functions,
    ...verified.preparation.release.retainedFunctions,
  ]) {
    assert.match(migration, new RegExp(`public\\.${entry.name}\\(`, "u"));
  }
});

test("AdminAuditLog rollback restores predecessor CRUD before disabling RLS", () => {
  const verified = verifyPrivateTableRlsActivationSource(releaseId);
  const rollback = readFileSync(verified.rollbackPath, "utf8");
  const grant = rollback.indexOf(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."AdminAuditLog"',
  );
  const noForce = rollback.indexOf(
    'ALTER TABLE public."AdminAuditLog" NO FORCE ROW LEVEL SECURITY',
  );
  const disable = rollback.indexOf(
    'ALTER TABLE public."AdminAuditLog" DISABLE ROW LEVEL SECURITY',
  );

  assert.equal(grant >= 0, true);
  assert.equal(grant < noForce, true);
  assert.equal(noForce < disable, true);
  assert.doesNotMatch(rollback, /migrate resolve --rolled-back/u);
  assert.match(rollback, /new reviewed forward migration with a new name/u);
  assert.doesNotMatch(rollback, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});

test("runtime provisioning recognizes only predecessor or exact activation", () => {
  const provisioning = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");
  assert.match(
    provisioning,
    /AdminAuditLog RLS is partially or unexpectedly configured; refusing runtime-role provisioning/u,
  );
  assert.match(
    provisioning,
    /REVOKE ALL ON TABLE public\."AdminAuditLog" FROM PUBLIC, :"runtime_role"/u,
  );
  for (const name of [
    "grainline_admin_audit_append",
    "grainline_admin_audit_undo_claim",
    "grainline_admin_audit_account_deletion_write_fence",
    "grainline_admin_audit_account_deletion_candidates",
    "grainline_admin_audit_account_deletion_redaction_plans_enqueue",
  ]) {
    assert.match(provisioning, new RegExp(`public\."${name}"\\(`, "u"));
  }
});
