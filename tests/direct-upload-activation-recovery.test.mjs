import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildFailedDirectUploadActivationFixture,
  DIRECT_UPLOAD_ACTIVATION_RECOVERY_FIXTURE_ACK,
  parseDirectUploadActivationRecoveryFixtureConfig,
} from "../scripts/direct-upload-activation-recovery-fixture.mjs";
import {
  parseDirectUploadActivationRecoveryProofConfig,
} from "../scripts/direct-upload-activation-recovery-postgres-proof.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_RELEASE,
  FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
} from "../scripts/verify-direct-upload-activation-release.mjs";

const LOOPBACK =
  "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable";

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("DirectUpload failed-activation recovery proof", () => {
  it("reconstructs the exact failed bytes only from the corrected release", () => {
    const reviewed = readFileSync(
      `prisma/migrations/${DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName}/migration.sql`,
      "utf8",
    );
    const failed = buildFailedDirectUploadActivationFixture(reviewed);
    assert.equal(sha256(reviewed), DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256);
    assert.equal(sha256(failed), FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256);
    assert.match(
      failed,
      /retains inbound or outbound role membership/,
    );
    assert.doesNotMatch(failed, /grantor\.rolname = 'cloud_admin'/u);
    assert.throws(
      () => buildFailedDirectUploadActivationFixture(`${reviewed}\n-- drift`),
      /corrected reviewed bytes/,
    );
  });

  it("stages failed bytes only in acknowledged loopback GitHub CI", () => {
    const valid = {
      CI: "true",
      GITHUB_ACTIONS: "true",
      DIRECT_UPLOAD_ACTIVATION_RECOVERY_FIXTURE_ACK,
      DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROOF_DATABASE_URL: LOOPBACK,
    };
    assert.equal(
      parseDirectUploadActivationRecoveryFixtureConfig(valid, ["--write"])
        .migrationPath.endsWith(
          `/${DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName}/migration.sql`,
        ),
      true,
    );
    for (const env of [
      { ...valid, CI: "false" },
      { ...valid, GITHUB_ACTIONS: "false" },
      { ...valid, DIRECT_UPLOAD_ACTIVATION_RECOVERY_FIXTURE_ACK: "yes" },
      {
        ...valid,
        DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROOF_DATABASE_URL:
          "postgresql://ci:ci@database.example/production",
      },
    ]) {
      assert.throws(() =>
        parseDirectUploadActivationRecoveryFixtureConfig(env, ["--write"]));
    }
  });

  it("accepts only the three loopback proof modes", () => {
    for (const mode of ["failed", "resolved", "activated"]) {
      assert.deepEqual(
        parseDirectUploadActivationRecoveryProofConfig(
          { DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROOF_DATABASE_URL: LOOPBACK },
          [`--${mode}`],
        ),
        { databaseUrl: LOOPBACK, mode },
      );
    }
    assert.throws(() =>
      parseDirectUploadActivationRecoveryProofConfig(
        { DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROOF_DATABASE_URL: LOOPBACK },
        ["--production"],
      ));
  });

  it("pins the exact provider edge and recovery sequence in PostgreSQL 16", () => {
    const roleFixture = readFileSync(
      "scripts/prepare-direct-upload-activation-recovery-proof.sql",
      "utf8",
    );
    const proof = readFileSync(
      "scripts/direct-upload-activation-recovery-postgres-proof.mjs",
      "utf8",
    );
    const workflow = readFileSync(
      ".github/workflows/direct-upload-activation-recovery-postgres-proof.yml",
      "utf8",
    );
    assert.match(roleFixture, /current_database\(\) <> 'grainline_ci'/u);
    assert.match(
      roleFixture,
      /SET SESSION AUTHORIZATION cloud_admin;[\s\S]*WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;[\s\S]*RESET SESSION AUTHORIZATION;/u,
    );
    assert.match(proof, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
    assert.match(proof, /FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256/u);
    assert.match(proof, /DIRECT_UPLOAD_ACTIVATION_RELEASE\.sha256/u);
    assert.match(workflow, /image: postgres:16/u);
    assert.match(
      workflow,
      /Reproduce the exact zero-step activation failure[\s\S]*--failed[\s\S]*--rolled-back 20260801194000_enable_direct_upload_rls[\s\S]*--resolved[\s\S]*Apply only the corrected reviewed activation[\s\S]*--activated/u,
    );
    assert.doesNotMatch(workflow, /Production|PRODUCTION_MIGRATION_DIRECT_URL/u);
  });
});
