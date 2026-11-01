import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  privateTableRlsActivation,
  privateTableRlsActivationReleaseIds,
  verifyPrivateTableRlsActivationSource,
} from "../scripts/private-table-rls-activation-catalog.mjs";
import {
  isReviewedSuccessfulMigration,
  REVIEWED_MANUALLY_APPLIED_MIGRATIONS,
} from "../scripts/reviewed-manually-applied-migrations.mjs";

const releaseIds = ["block_v1", "user_report_v1", "seller_faq_v1"];

test("Block, UserReport, and SellerFaq use one reviewed policyless activation batch", () => {
  assert.deepEqual(
    privateTableRlsActivationReleaseIds("block_report_seller_faq_v1"),
    releaseIds,
  );
  assert.deepEqual(
    releaseIds.map((releaseId) => privateTableRlsActivation(releaseId).table),
    ["Block", "UserReport", "SellerFaq"],
  );
});

for (const releaseId of releaseIds) {
  test(`${releaseId} activation is byte sealed and preserves the rollback boundary`, () => {
    const verified = verifyPrivateTableRlsActivationSource(releaseId);
    const { release } = verified;
    const activation = readFileSync(verified.migrationPath, "utf8");
    const rollback = readFileSync(verified.rollbackPath, "utf8");

    assert.equal(release.mode, "policyless_combined_enable_force");
    assert.deepEqual(release.policies, []);
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
      finished_at: new Date("2026-11-01T00:00:00Z"),
      rolled_back_at: null,
      applied_steps_count: 0,
    }), true);
    assert.match(activation, /SET LOCAL lock_timeout = '5s'/u);
    assert.match(activation, /SET LOCAL statement_timeout = '60s'/u);
    assert.match(activation, /ENABLE ROW LEVEL SECURITY/u);
    assert.match(activation, /FORCE ROW LEVEL SECURITY/u);
    assert.match(activation, /REVOKE ALL PRIVILEGES/u);
    assert.doesNotMatch(activation, /CREATE\s+POLICY/iu);
    assert.doesNotMatch(activation, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
    assert.match(rollback, /GRANT SELECT, INSERT, UPDATE, DELETE/u);
    assert.match(rollback, /NO FORCE ROW LEVEL SECURITY/u);
    assert.match(rollback, /DISABLE ROW LEVEL SECURITY/u);
    assert.match(rollback, /pg_catalog\.pg_attribute/u);
    assert.match(rollback, /pg_catalog\.aclexplode\(attribute\.attacl\)/u);
    assert.doesNotMatch(rollback, /CREATE\s+POLICY/iu);
    assert.doesNotMatch(rollback, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
  });
}
