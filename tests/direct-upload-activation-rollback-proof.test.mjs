import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  parseDirectUploadRollbackProofConfig,
} from "../scripts/direct-upload-activation-rollback-proof.mjs";

const proof = readFileSync(
  "scripts/direct-upload-activation-rollback-proof.mjs",
  "utf8",
);
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

describe("DirectUpload activation rollback proof", () => {
  it("refuses every non-loopback or non-disposable database target", () => {
    assert.throws(
      () => parseDirectUploadRollbackProofConfig({}),
      /DIRECT_UPLOAD_ACTIVATION_ROLLBACK_PROOF_DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        parseDirectUploadRollbackProofConfig({
          DIRECT_UPLOAD_ACTIVATION_ROLLBACK_PROOF_DATABASE_URL:
            "postgresql://ci:ci@database.example/grainline_ci",
        }),
      /refuses a non-loopback database/,
    );
    assert.throws(
      () =>
        parseDirectUploadRollbackProofConfig({
          DIRECT_UPLOAD_ACTIVATION_ROLLBACK_PROOF_DATABASE_URL:
            "postgresql://ci:ci@127.0.0.1/production",
        }),
      /requires grainline_ci/,
    );
  });

  it("rolls back database-first before restoring direct runtime grants", () => {
    const disable = proof.indexOf(
      'ALTER TABLE public."DirectUpload" DISABLE ROW LEVEL SECURITY',
    );
    const grant = proof.indexOf(
      "GRANT SELECT, INSERT, UPDATE, DELETE",
    );
    assert.ok(disable >= 0);
    assert.ok(grant > disable);
    assert.match(proof, /IN ACCESS EXCLUSIVE MODE/);
    assert.match(proof, /SET LOCAL lock_timeout = '10s'/);
    assert.match(proof, /grainline\.direct-upload\.rls\.activation/);
    assert.match(proof, /oldApplicationDirectCrudCompatible: true/);
  });

  it("restores both FORCE tables and the exact 17/3 function partition", () => {
    assert.match(proof, /oidvectortypes\(procedure\.proargtypes\)/);
    assert.match(
      proof,
      /ALTER TABLE public\."DirectUpload" ENABLE ROW LEVEL SECURITY/,
    );
    assert.match(
      proof,
      /ALTER TABLE public\."DirectUpload" FORCE ROW LEVEL SECURITY/,
    );
    assert.match(
      proof,
      /ALTER TABLE public\."DirectUploadReference" ENABLE ROW LEVEL SECURITY/,
    );
    assert.match(
      proof,
      /ALTER TABLE public\."DirectUploadReference" FORCE ROW LEVEL SECURITY/,
    );
    assert.match(proof, /functionAclStatements\(\{ rollback: false \}\)/);
    assert.match(proof, /exactFunctionPartitionRestored: true/);
    assert.match(proof, /exactForceActivationRestored: true/);
    assert.match(proof, /objectKeyRetirementPreserved: true/);
    assert.match(proof, /object_key_count: 0/);
  });

  it("has a best-effort exact-state restore and no production target", () => {
    assert.match(
      proof,
      /if \(compatibilityCommitted && !activationRestored\)/,
    );
    assert.match(proof, /await restoreActivation\(owner\)\.catch/);
    assert.match(proof, /productionChanged: false/);
    assert.match(proof, /persistentStagingChanged: false/);
    assert.doesNotMatch(proof, /process\.env\.DATABASE_URL/);
    assert.equal(
      packageJson.scripts["audit:rls-direct-upload-activation-rollback"],
      "node scripts/direct-upload-activation-rollback-proof.mjs",
    );
  });
});
