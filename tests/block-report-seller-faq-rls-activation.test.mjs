import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
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

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [absolute] : [];
  });
}

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

test("application source has no direct Block, UserReport, or SellerFaq ORM access", () => {
  const directRelationAccess = /\.(?:block|userReport|sellerFaq)\s*\.\s*(?:aggregate|count|create|createMany|delete|deleteMany|findFirst|findMany|findUnique|groupBy|update|updateMany|upsert)\b/u;
  const offenders = sourceFiles("src").filter((file) => (
    directRelationAccess.test(readFileSync(file, "utf8"))
  ));
  assert.deepEqual(
    offenders,
    [],
    "policyless activation requires every application caller to use a reviewed fixed operation",
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

    if (releaseId === "block_v1") {
      for (const legacy of [
        "grainline_conversation_inbox",
        "grainline_message_unread_count",
      ]) {
        assert.match(
          activation,
          new RegExp(`REVOKE ALL ON FUNCTION public\\.${legacy}\\(`, "u"),
        );
        assert.match(
          rollback,
          new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${legacy}\\(`, "u"),
        );
      }
      assert.match(
        readFileSync("scripts/provision-runtime-db-role.sql", "utf8"),
        /class\.relname = 'Block'[\s\S]*class\.relrowsecurity[\s\S]*class\.relforcerowsecurity/u,
      );
    }
  });
}
