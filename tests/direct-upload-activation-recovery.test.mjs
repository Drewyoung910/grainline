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
  extractDirectUploadActivationRolePreflight,
  parseDirectUploadActivationMembershipProofConfig,
} from "../scripts/direct-upload-activation-membership-preflight-postgres-proof.mjs";
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

  it("keeps the membership preflight proof loopback-only and byte-pinned", () => {
    const environment = {
      CI: "true",
      GITHUB_ACTIONS: "true",
      DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROVIDER_FIXTURE_URL:
        "postgresql://cloud_admin:ci@localhost:5432/grainline_ci?sslmode=disable",
    };
    assert.deepEqual(
      parseDirectUploadActivationMembershipProofConfig(environment),
      {
        databaseUrl:
          environment.DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROVIDER_FIXTURE_URL,
      },
    );
    for (const drift of [
      { CI: "false" },
      { GITHUB_ACTIONS: "false" },
      {
        DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROVIDER_FIXTURE_URL:
          "postgresql://cloud_admin:ci@database.example/production",
      },
      {
        DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROVIDER_FIXTURE_URL:
          "postgresql://neondb_owner:ci@localhost:5432/grainline_ci",
      },
    ]) {
      assert.throws(() =>
        parseDirectUploadActivationMembershipProofConfig({
          ...environment,
          ...drift,
        }));
    }
    const migration = readFileSync(
      `prisma/migrations/${DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName}/migration.sql`,
      "utf8",
    );
    assert.match(
      extractDirectUploadActivationRolePreflight(migration),
      /WITH RECURSIVE restricted_members/u,
    );
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
    const historicalAliasFixture = readFileSync(
      "scripts/stage-direct-upload-recovery-historical-alias-fixture.sql",
      "utf8",
    );
    const workflow = readFileSync(
      ".github/workflows/direct-upload-activation-recovery-postgres-proof.yml",
      "utf8",
    );
    const membershipProof = readFileSync(
      "scripts/direct-upload-activation-membership-preflight-postgres-proof.mjs",
      "utf8",
    );
    assert.match(roleFixture, /current_database\(\) <> 'grainline_ci'/u);
    assert.match(roleFixture, /current_user <> 'cloud_admin'/u);
    assert.match(
      roleFixture,
      /CREATE ROLE ci[\s\S]*LOGIN SUPERUSER[\s\S]*PASSWORD 'ci'/u,
    );
    assert.match(
      roleFixture,
      /CREATE ROLE neondb_owner[\s\S]*LOGIN SUPERUSER[\s\S]*BYPASSRLS PASSWORD 'ci'/u,
    );
    assert.match(
      roleFixture,
      /CREATE ROLE grainline_app_runtime[\s\S]*LOGIN NOSUPERUSER[\s\S]*NOINHERIT/u,
    );
    assert.match(
      roleFixture,
      /GRANT grainline_app_runtime TO neondb_owner[\s\S]*WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;/u,
    );
    assert.match(
      roleFixture,
      /GRANT grainline_direct_upload_cleanup_v2 TO neondb_owner[\s\S]*WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;/u,
    );
    assert.match(roleFixture, /matching_edges <> 2 OR touching_edges <> 2/u);
    for (const marker of [
      "exactBootstrapEdgesAccepted",
      "noBootstrapEdgesAccepted",
      "unexpectedDirectMemberRejected",
      "restrictedRoleParentRejected",
      "transitiveMemberRejected",
      "optionDriftRejected",
      "residue: 0",
    ]) {
      assert.match(membershipProof, new RegExp(marker, "u"));
    }
    assert.match(proof, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
    assert.match(proof, /FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256/u);
    assert.match(proof, /DIRECT_UPLOAD_ACTIVATION_RELEASE\.sha256/u);
    assert.match(proof, /assertListingVariantsLedgerAlias/u);
    assert.match(
      historicalAliasFixture,
      /current_database\(\) <> 'grainline_ci' OR current_user <> 'ci'/u,
    );
    assert.match(
      historicalAliasFixture,
      /20260423_add_listing_variants[\s\S]*applied_steps_count = 1/u,
    );
    assert.match(
      historicalAliasFixture,
      /20260423000000_add_listing_variants[\s\S]*rolled_back_at[\s\S]*applied_steps_count[\s\S]*0/u,
    );
    assert.doesNotMatch(historicalAliasFixture, /20260801194000/u);
    assert.match(workflow, /image: postgres:16/u);
    assert.match(workflow, /POSTGRES_USER: cloud_admin/u);
    assert.match(
      workflow,
      /tests\/direct-upload-activation-production-recovery\.test\.mjs/u,
    );
    assert.match(
      workflow,
      /agent\/direct-upload-activation-runtime-bootstrap-preflight-20260803[\s\S]*scripts\/direct-upload-activation-membership-preflight-postgres-proof\.mjs/u,
    );
    assert.match(
      workflow,
      /DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROVIDER_FIXTURE_URL: postgresql:\/\/cloud_admin:ci@localhost:5432\/grainline_ci\?sslmode=disable/u,
    );
    assert.match(
      workflow,
      /DIRECT_UPLOAD_ACTIVATION_RECOVERY_OWNER_FIXTURE_URL: postgresql:\/\/neondb_owner:ci@localhost:5432\/grainline_ci\?sslmode=disable/u,
    );
    assert.match(
      workflow,
      /psql "\$DIRECT_UPLOAD_ACTIVATION_RECOVERY_OWNER_FIXTURE_URL" -v cleanup_role=grainline_direct_upload_cleanup_v2 -v runtime_role=grainline_app_runtime -v migration_role=neondb_owner/u,
    );
    assert.match(
      workflow,
      /Apply the compatible baseline migration tree[\s\S]*Stage the exact zero-step rolled-back historical alias[\s\S]*Prove exact bootstrap edges and reject membership drift[\s\S]*Stage the exact failed activation bytes[\s\S]*Reproduce the exact zero-step activation failure[\s\S]*--failed[\s\S]*--rolled-back 20260801194000_enable_direct_upload_rls[\s\S]*--resolved[\s\S]*Apply only the corrected reviewed activation[\s\S]*--activated/u,
    );
    assert.doesNotMatch(workflow, /Production|PRODUCTION_MIGRATION_DIRECT_URL/u);
  });
});
