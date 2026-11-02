import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  privateTableRlsActivation,
  verifyPrivateTableRlsActivationSource,
} from "../scripts/private-table-rls-activation-catalog.mjs";

const releaseId = "seller_metrics_v1";

test("SellerMetrics activation is policyless and removes direct authority", () => {
  const release = privateTableRlsActivation(releaseId);
  const verified = verifyPrivateTableRlsActivationSource(releaseId);
  const migration = readFileSync(verified.migrationPath, "utf8");

  assert.equal(release.table, "SellerMetrics");
  assert.equal(release.mode, "policyless_combined_enable_force");
  assert.deepEqual(release.policies, []);
  assert.deepEqual(release.predecessorRuntimePrivileges, [
    "SELECT", "INSERT", "UPDATE", "DELETE",
  ]);
  assert.deepEqual(release.activatedRuntimePrivileges, []);
  assert.deepEqual(release.activatedStaffPrivileges, []);
  assert.deepEqual(release.activatedAccountDeletionPrivileges, []);
  assert.deepEqual(release.activatedPublicPrivileges, []);
  assert.equal(release.preparation.functions.length, 4);
  assert.equal(release.preparation.retainedFunctions.length, 5);
  assert.equal(verified.migrationDigest, release.migrationSha256);
  assert.equal(verified.rollbackDigest, release.rollbackSha256);
  assert.match(
    migration,
    /LOCK TABLE public\."SellerMetrics" IN ACCESS EXCLUSIVE MODE/u,
  );
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/u);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/u);
  assert.match(
    migration,
    /FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime,\s+grainline_account_deletion_runtime/u,
  );
  assert.equal((migration.match(/\bCREATE POLICY\b/gu) ?? []).length, 0);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});

test("SellerMetrics activation seals every FORCE-crossing authority", () => {
  const verified = verifyPrivateTableRlsActivationSource(releaseId);
  const migration = readFileSync(verified.migrationPath, "utf8");

  for (const marker of [
    "SellerMetrics columns drifted",
    "SellerMetrics constraints drifted",
    "SellerMetrics indexes drifted",
    "SellerMetrics inactive-owner cleanup trigger drifted",
    "SellerMetrics has an unreviewed function reader or writer",
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

test("SellerMetrics rollback restores predecessor CRUD before disabling RLS", () => {
  const verified = verifyPrivateTableRlsActivationSource(releaseId);
  const rollback = readFileSync(verified.rollbackPath, "utf8");
  const grant = rollback.indexOf(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."SellerMetrics"',
  );
  const noForce = rollback.indexOf(
    'ALTER TABLE public."SellerMetrics" NO FORCE ROW LEVEL SECURITY',
  );
  const disable = rollback.indexOf(
    'ALTER TABLE public."SellerMetrics" DISABLE ROW LEVEL SECURITY',
  );

  assert.equal(grant >= 0, true);
  assert.equal(grant < noForce, true);
  assert.equal(noForce < disable, true);
  assert.doesNotMatch(rollback, /migrate resolve --rolled-back/u);
  assert.match(rollback, /new reviewed forward migration with a new name/u);
  assert.match(
    rollback,
    /trigger_function\.oid = pg_catalog\.to_regprocedure\(\s*'public\.grainline_seller_metrics_inactive_owner_cleanup\(\)'\s*\)/u,
  );
  assert.doesNotMatch(rollback, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});

test("runtime provisioning converges only exact SellerMetrics postures", () => {
  const provisioning = readFileSync(
    "scripts/provision-runtime-db-role.sql",
    "utf8",
  );
  assert.match(
    provisioning,
    /SellerMetrics RLS is partially or unexpectedly configured; refusing runtime-role provisioning/u,
  );
  assert.match(
    provisioning,
    /REVOKE ALL ON TABLE public\."SellerMetrics" FROM PUBLIC, :"runtime_role"/u,
  );
  for (const name of [
    "grainline_seller_metrics_owner_state",
    "grainline_seller_metrics_account_deletion_clear",
  ]) {
    assert.match(provisioning, new RegExp(`public\\."${name}"\\(`, "u"));
  }
});
