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
  FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
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
        "1bceed7a5076f15ae5c9c46a89bbaecdf583953f7a1ff80b26a8b0e7c21157c4",
      disposableProofSha256:
        "6600e6b96bf1d151befb860bab2fa268199d3847b4e4b7ccb3be647ca44c4a8b",
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
      "6600e6b96bf1d151befb860bab2fa268199d3847b4e4b7ccb3be647ca44c4a8b",
    );
    assert.equal(
      FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
      "41c2099157737e7457997d5ad71932671f5813dcbb436b699671b8af29458ffb",
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
      assert.match(workflow, /stripe-webhook-maintenance-authority-reviewed/);
    }
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    assert.match(
      ci,
      /Isolate the exact DirectUpload activation until external grants converge[\s\S]*Apply compatible migrations to CI Postgres[\s\S]*Converge pre-activation production-style runtime grants[\s\S]*Converge pre-activation DirectUpload cleanup-worker grants[\s\S]*Prove DirectUpload legacy repair in ephemeral PostgreSQL[\s\S]*Restore the exact DirectUpload activation release[\s\S]*Apply migrations to CI Postgres/,
    );
    assert.match(
      ci,
      /Apply migrations to CI Postgres[\s\S]*Converge production-style runtime grants after migrations[\s\S]*Converge activated DirectUpload cleanup-worker grants/,
    );
    assert.doesNotMatch(ci, /prisma migrate resolve/);
  });

  it("records the merged release, failed production attempt, credential gate, and postflight boundary", () => {
    const release = readFileSync(
      "docs/direct-upload-activation-release.md",
      "utf8",
    );
    const normalizedRelease = release.replace(/\s+/g, " ");
    assert.match(release, /PR `#131` merged the byte-pinned activation release/);
    assert.match(
      normalizedRelease,
      /Guarded production migration run `30729632410` later attempted the activation/,
    );
    assert.match(normalizedRelease, /There is no accepted production activation claim/);
    assert.match(normalizedRelease, /neither activation postflight was dispatched/);
    assert.match(release, new RegExp(DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256));
    assert.match(release, new RegExp(DISPOSABLE_DIRECT_UPLOAD_ACTIVATION_SHA256));
    assert.match(release, /exactly 17 validated fixed functions/);
    assert.match(release, /exactly three lease\/complete\/fail functions/);
    assert.match(release, /other 15 DirectUpload functions private/);
    assert.match(release, /SECURITY\s+DEFINER owner is a superuser or has BYPASSRLS/);
    assert.match(release, /dpl_2o2yBehsStAiVWUhoj1LQTmZ9HJe/);
    assert.match(release, /authenticated retired route returns 404/);
    assert.match(release, /rejected `v3` user token was absent/);
    assert.match(release, /credential gate is\s+accepted/);
    assert.match(release, /Activation-aware production postflight/);
    assert.match(release, /BEGIN TRANSACTION READ ONLY/);
    assert.match(release, /productionChangedByPostflight=false/);
    assert.match(release, /Case-evidence\s+enablement[\s\S]*separate releases/);
    assert.match(release, /30716441830/);
    assert.match(release, /91412674837/);
    assert.match(release, /30716761313/);
    assert.match(release, /91413525569/);
    assert.match(release, /does not relax or\s+change the byte-pinned production migration/);
  });
});
