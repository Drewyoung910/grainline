import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DIRECT_UPLOAD_RETIREMENT_RELEASE,
  DISPOSABLE_DIRECT_UPLOAD_RETIREMENT_SHA256,
  verifyDirectUploadRetirementRelease,
} from "../scripts/verify-direct-upload-retirement-release.mjs";

function fixtureRoot() {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "direct-upload-retirement-release-"),
  );
  const migrations = path.join(root, "prisma", "migrations");
  mkdirSync(migrations, { recursive: true });
  return { root, migrations };
}

function releaseSource() {
  return readFileSync(
    `prisma/migrations/${DIRECT_UPLOAD_RETIREMENT_RELEASE.migrationName}/migration.sql`,
    "utf8",
  );
}

describe("DirectUpload compatibility-key retirement release", () => {
  it("pins promoted bytes and the disposable-proof-equivalent body", () => {
    const source = releaseSource();
    const { root, migrations } = fixtureRoot();
    const directory = path.join(
      migrations,
      DIRECT_UPLOAD_RETIREMENT_RELEASE.migrationName,
    );
    mkdirSync(directory);
    writeFileSync(path.join(directory, "migration.sql"), source);

    assert.deepEqual(verifyDirectUploadRetirementRelease(root), {
      status: "passed",
      migrationName: "20260801175000_retire_direct_upload_compatibility_key",
      migrationSha256:
        "42622759fdf9fcfda418e674ab43c9d013c0f0c536eda93c0aaa9495da826754",
      disposableProofSha256:
        "63e8db0888e7ba5fb805707bb0ba855d6050c8e6ac573b37eafe4a2678e2dcce",
      executableBodyMatchesDisposableProof: true,
      followsReviewedProductionHistory: true,
      validatedConstraintCount: 6,
      dropsCompatibilityObjectKey: true,
      rlsChanged: false,
      tableGrantsChanged: false,
    });
    assert.equal(
      DISPOSABLE_DIRECT_UPLOAD_RETIREMENT_SHA256,
      "63e8db0888e7ba5fb805707bb0ba855d6050c8e6ac573b37eafe4a2678e2dcce",
    );
    assert.match(source, /^-- Promoted reviewed DirectUpload/);
    assert.doesNotMatch(source, /Do not apply outside the loopback/);
    assert.ok(
      DIRECT_UPLOAD_RETIREMENT_RELEASE.migrationName.localeCompare(
        "20260730020000_converge_case_read_modes",
      ) > 0,
    );
  });

  it("fails closed on byte drift or a symlinked migration", () => {
    const source = releaseSource();

    {
      const { root, migrations } = fixtureRoot();
      const directory = path.join(
        migrations,
        DIRECT_UPLOAD_RETIREMENT_RELEASE.migrationName,
      );
      mkdirSync(directory);
      writeFileSync(path.join(directory, "migration.sql"), `${source}\n-- drift\n`);
      assert.throws(
        () => verifyDirectUploadRetirementRelease(root),
        /bytes drifted/,
      );
    }

    {
      const { root, migrations } = fixtureRoot();
      const directory = path.join(
        migrations,
        DIRECT_UPLOAD_RETIREMENT_RELEASE.migrationName,
      );
      mkdirSync(directory);
      const target = path.join(root, "target.sql");
      writeFileSync(target, source);
      symlinkSync(target, path.join(directory, "migration.sql"));
      assert.throws(
        () => verifyDirectUploadRetirementRelease(root),
        /regular non-symlink/,
      );
    }
  });

  it("rejects the disposable proof name in production migration history", () => {
    const source = releaseSource();
    const { root, migrations } = fixtureRoot();
    for (const migrationName of [
      DIRECT_UPLOAD_RETIREMENT_RELEASE.migrationName,
      "20260726190000_retire_direct_upload_compatibility_key",
    ]) {
      const directory = path.join(migrations, migrationName);
      mkdirSync(directory);
      writeFileSync(path.join(directory, "migration.sql"), source);
    }

    assert.throws(
      () => verifyDirectUploadRetirementRelease(root),
      /disposable DirectUpload retirement migration must not enter production history/,
    );
  });

  it("gates CI and production migrations before Prisma deploy", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    assert.equal(
      packageJson.scripts["audit:rls-direct-upload-retirement-release"],
      "node scripts/verify-direct-upload-retirement-release.mjs",
    );

    for (const workflowPath of [
      ".github/workflows/ci.yml",
      ".github/workflows/production-migrations.yml",
    ]) {
      const workflow = readFileSync(workflowPath, "utf8");
      const verifier = workflow.indexOf(
        "npm run audit:rls-direct-upload-retirement-release",
      );
      const deploy = workflow.indexOf("npx prisma migrate deploy");
      assert.ok(verifier >= 0, `${workflowPath} omits retirement verifier`);
      assert.ok(deploy >= 0, `${workflowPath} omits Prisma deploy`);
      assert.ok(verifier < deploy, `${workflowPath} verifies retirement too late`);
    }
  });
});
