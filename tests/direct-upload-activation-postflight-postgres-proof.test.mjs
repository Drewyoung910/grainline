import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  parseDirectUploadActivationPostflightProofConfig,
} from "../scripts/direct-upload-activation-postflight-postgres-proof.mjs";

const LOOPBACK =
  "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable";

describe("DirectUpload restricted-role activation postflight PostgreSQL proof", () => {
  it("accepts only the disposable ci database and refuses persistent targets", () => {
    assert.deepEqual(
      parseDirectUploadActivationPostflightProofConfig({
        DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL: LOOPBACK,
      }),
      { databaseUrl: LOOPBACK },
    );
    for (const databaseUrl of [
      undefined,
      "postgresql://ci:ci@db.example.com:5432/grainline_ci?sslmode=disable",
      "postgresql://ci:ci@127.0.0.1:5432/neondb?sslmode=disable",
      "postgresql://neondb_owner:ci@127.0.0.1:5432/grainline_ci?sslmode=disable",
    ]) {
      assert.throws(
        () => parseDirectUploadActivationPostflightProofConfig({
          DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL: databaseUrl,
        }),
      );
    }
  });

  it("mirrors and restores the production owner around exact restricted sessions", () => {
    const proof = readFileSync(
      "scripts/direct-upload-activation-postflight-postgres-proof.mjs",
      "utf8",
    );
    const workflow = readFileSync(
      ".github/workflows/direct-upload-activation-recovery-postgres-proof.yml",
      "utf8",
    );
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

    assert.match(proof, /const DATABASE_NAME = "grainline_ci"/u);
    assert.match(proof, /const FIXTURE_OWNER = "ci"/u);
    assert.match(proof, /const PRODUCTION_OWNER = "neondb_owner"/u);
    assert.match(
      proof,
      /changeFunctionOwners\(owner, FIXTURE_OWNER, PRODUCTION_OWNER\)[\s\S]*finally[\s\S]*changeFunctionOwners\(owner, PRODUCTION_OWNER, FIXTURE_OWNER\)/u,
    );
    assert.match(proof, /assertMigrationLedgerDenied/u);
    assert.match(proof, /caught\?\.code,[\s\S]*"42501"/u);
    assert.match(proof, /runDirectUploadActivationPostflight/u);
    assert.match(proof, /postflightReadOnly, true/u);
    assert.match(proof, /productionChangedByPostflight, false/u);
    assert.match(proof, /persistentEnvironmentChanged: false/u);
    assert.doesNotMatch(
      proof,
      /PRODUCTION_MIGRATION_DIRECT_URL|DIRECT_UPLOAD_CLEANUP_DATABASE_URL/u,
    );
    assert.match(
      workflow,
      /Converge activated runtime and cleanup grants[\s\S]*Prove both restricted-role activation postflights without ledger access[\s\S]*Verify recovered migration status/u,
    );
    assert.match(
      workflow,
      /DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/u,
    );
    assert.equal(
      packageJson.scripts?.["audit:rls-direct-upload-activation-postflight"],
      "node scripts/direct-upload-activation-postflight-postgres-proof.mjs",
    );
  });
});
