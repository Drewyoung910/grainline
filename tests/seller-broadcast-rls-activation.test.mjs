import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  privateTableRlsActivation,
  verifyPrivateTableRlsActivationSource,
} from "../scripts/private-table-rls-activation-catalog.mjs";
import {
  isReviewedSuccessfulMigration,
  REVIEWED_MANUALLY_APPLIED_MIGRATIONS,
} from "../scripts/reviewed-manually-applied-migrations.mjs";

const releaseId = "seller_broadcast_v1";
const release = privateTableRlsActivation(releaseId);
const verified = verifyPrivateTableRlsActivationSource(releaseId);

test("SellerBroadcast uses one byte-sealed policyless activation", () => {
  assert.equal(release.table, "SellerBroadcast");
  assert.equal(
    release.minimumCompatibleAppCommit,
    "125703575794479a6ef4dcb0d7aec92000c6af5f",
  );
  assert.equal(release.mode, "policyless_combined_enable_force");
  assert.deepEqual(release.policies, []);
  assert.deepEqual(release.predecessorRuntimePrivileges, [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
  ]);
  assert.deepEqual(release.activatedRuntimePrivileges, []);
  assert.deepEqual(release.activatedStaffPrivileges, []);
  assert.deepEqual(release.activatedPublicPrivileges, []);
  assert.equal(verified.migrationDigest, release.migrationSha256);
  assert.equal(verified.rollbackDigest, release.rollbackSha256);
  assert.equal(
    REVIEWED_MANUALLY_APPLIED_MIGRATIONS.get(release.migration),
    release.migrationSha256,
  );
  assert.equal(isReviewedSuccessfulMigration({
    migration_name: release.migration,
    checksum: release.migrationSha256,
    finished_at: new Date("2026-11-10T00:00:00Z"),
    rolled_back_at: null,
    applied_steps_count: 0,
  }), true);
});

test("activation binds every prepared operation and reaches zero-direct FORCE", () => {
  const activation = readFileSync(verified.migrationPath, "utf8");
  assert.equal(release.preparation.functions.length, 15);
  for (const entry of release.preparation.functions) {
    const signature = `public.${entry.name}(${entry.arguments.replace(/,\s+/gu, ",")})`;
    assert.ok(
      activation.includes(`'${signature}'`),
      `${signature} is absent from activation preflight`,
    );
  }
  assert.match(activation, /SET LOCAL lock_timeout = '5s'/u);
  assert.match(activation, /SET LOCAL statement_timeout = '60s'/u);
  assert.match(activation, /REVOKE ALL PRIVILEGES/u);
  assert.match(activation, /ENABLE ROW LEVEL SECURITY/u);
  assert.match(activation, /FORCE ROW LEVEL SECURITY/u);
  assert.match(activation, /owner_role\.rolsuper OR owner_role\.rolbypassrls/u);
  assert.doesNotMatch(activation, /CREATE\s+POLICY/iu);
  assert.doesNotMatch(activation, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});

test("rollback is database-first and restores only predecessor CRUD", () => {
  const rollback = readFileSync(verified.rollbackPath, "utf8");
  assert.match(rollback, /GRANT SELECT, INSERT, UPDATE, DELETE/u);
  assert.match(rollback, /NO FORCE ROW LEVEL SECURITY/u);
  assert.match(rollback, /DISABLE ROW LEVEL SECURITY/u);
  assert.match(rollback, /pg_catalog\.pg_attribute/u);
  assert.match(rollback, /pg_catalog\.aclexplode\(attribute\.attacl\)/u);
  assert.doesNotMatch(rollback, /CREATE\s+POLICY/iu);
  assert.doesNotMatch(rollback, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});

test("runtime role provisioning preserves zero direct authority after activation", () => {
  const provisioning = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");
  assert.match(
    provisioning,
    /class\.relname = 'SellerBroadcast'[\s\S]*relrowsecurity AND relforcerowsecurity AND policy_count = 0/u,
  );
  assert.match(
    provisioning,
    /\\if :seller_broadcast_rls_active[\s\S]*REVOKE ALL ON TABLE public\."SellerBroadcast"/u,
  );
});
