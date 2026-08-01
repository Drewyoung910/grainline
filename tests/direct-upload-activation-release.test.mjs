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
  DIRECT_UPLOAD_ACTIVATION_RELEASE,
  DISPOSABLE_DIRECT_UPLOAD_ACTIVATION_SHA256,
  verifyDirectUploadActivationRelease,
} from "../scripts/verify-direct-upload-activation-release.mjs";

function fixtureRoot() {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "direct-upload-activation-release-"),
  );
  const migrations = path.join(root, "prisma", "migrations");
  mkdirSync(migrations, { recursive: true });
  return { root, migrations };
}

function releaseSource() {
  return readFileSync(
    `prisma/migrations/${DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName}/migration.sql`,
    "utf8",
  );
}

describe("DirectUpload service-only activation release", () => {
  it("pins promoted bytes and the disposable-proof-equivalent body", () => {
    const source = releaseSource();
    const { root, migrations } = fixtureRoot();
    const directory = path.join(
      migrations,
      DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
    );
    mkdirSync(directory);
    writeFileSync(path.join(directory, "migration.sql"), source);

    assert.deepEqual(verifyDirectUploadActivationRelease(root), {
      status: "passed",
      migrationName: "20260801194000_enable_direct_upload_rls",
      migrationSha256:
        "8afb997dde6c0feb605cf366ea30a5f3dfdde4a7505c2cf2b6f2c98a43ffe40d",
      disposableProofSha256:
        "e725b852945dde6ac8b4b40799da8fb209e6a246fe2969dffe5d5907cf05ff61",
      executableBodyMatchesDisposableProof: true,
      followsReviewedProductionHistory: true,
      functionCount: 35,
      runtimeFunctionCount: 17,
      cleanupFunctionCount: 3,
      rlsEnabled: true,
      rlsForced: true,
      policyCount: 0,
      runtimeTablePrivileges: [],
    });
    assert.equal(
      DISPOSABLE_DIRECT_UPLOAD_ACTIVATION_SHA256,
      "e725b852945dde6ac8b4b40799da8fb209e6a246fe2969dffe5d5907cf05ff61",
    );
    assert.match(source, /^-- Promoted reviewed DirectUpload/);
    assert.doesNotMatch(source, /Do not apply outside the loopback/);
    assert.ok(
      DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName.localeCompare(
        "20260801175000_retire_direct_upload_compatibility_key",
      ) > 0,
    );
  });

  it("fails closed on byte drift or a symlinked migration", () => {
    const source = releaseSource();
    {
      const { root, migrations } = fixtureRoot();
      const directory = path.join(
        migrations,
        DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
      );
      mkdirSync(directory);
      writeFileSync(path.join(directory, "migration.sql"), `${source}\n-- drift\n`);
      assert.throws(
        () => verifyDirectUploadActivationRelease(root),
        /bytes drifted/,
      );
    }
    {
      const { root, migrations } = fixtureRoot();
      const directory = path.join(
        migrations,
        DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
      );
      mkdirSync(directory);
      const target = path.join(root, "target.sql");
      writeFileSync(target, source);
      symlinkSync(target, path.join(directory, "migration.sql"));
      assert.throws(
        () => verifyDirectUploadActivationRelease(root),
        /regular non-symlink/,
      );
    }
  });

  it("rejects the disposable proof name in production history", () => {
    const source = releaseSource();
    const { root, migrations } = fixtureRoot();
    for (const name of [
      DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
      "20260726190500_enable_direct_upload_rls",
    ]) {
      const directory = path.join(migrations, name);
      mkdirSync(directory);
      writeFileSync(path.join(directory, "migration.sql"), source);
    }
    assert.throws(
      () => verifyDirectUploadActivationRelease(root),
      /disposable DirectUpload activation must not enter production history/,
    );
  });

  it("gates CI and production migrations before Prisma deploy", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    assert.equal(
      packageJson.scripts["audit:rls-direct-upload-activation-release"],
      "node scripts/verify-direct-upload-activation-release.mjs",
    );
    for (const workflowPath of [
      ".github/workflows/ci.yml",
      ".github/workflows/production-migrations.yml",
    ]) {
      const workflow = readFileSync(workflowPath, "utf8");
      const verifier = workflow.indexOf(
        "npm run audit:rls-direct-upload-activation-release",
      );
      const deploy = workflow.indexOf("npx prisma migrate deploy");
      assert.ok(verifier >= 0, `${workflowPath} omits activation verifier`);
      assert.ok(deploy >= 0, `${workflowPath} omits Prisma deploy`);
      assert.ok(verifier < deploy, `${workflowPath} verifies activation too late`);
      assert.match(workflow, /direct-upload-activation-reviewed/);
    }
  });

  it("records the exact prepared-only boundary and remaining credential gate", () => {
    const release = readFileSync(
      "docs/direct-upload-activation-release.md",
      "utf8",
    );
    assert.match(release, /prepared on an isolated branch only/);
    assert.match(release, /has\s+not been merged, dispatched, applied or deployed/);
    assert.match(release, new RegExp(DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256));
    assert.match(release, new RegExp(DISPOSABLE_DIRECT_UPLOAD_ACTIVATION_SHA256));
    assert.match(release, /exactly 17 validated fixed functions/);
    assert.match(release, /exactly three lease\/complete\/fail functions/);
    assert.match(release, /other 15 DirectUpload functions private/);
    assert.match(release, /confirm or revoke the\s+rejected Cloudflare `v3` R2 token/);
    assert.match(release, /Case-evidence enablement[\s\S]*separate releases/);
  });
});
