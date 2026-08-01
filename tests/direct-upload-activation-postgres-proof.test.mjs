import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  parseDirectUploadActivationProofConfig,
} from "../scripts/direct-upload-activation-postgres-proof.mjs";

const proof = readFileSync(
  "scripts/direct-upload-activation-postgres-proof.mjs",
  "utf8",
);
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const workflow = readFileSync(
  ".github/workflows/direct-upload-authority-postgres-proof.yml",
  "utf8",
);

describe("DirectUpload activated PostgreSQL proof harness", () => {
  it("refuses every non-loopback or non-disposable database target", () => {
    assert.throws(
      () => parseDirectUploadActivationProofConfig({}),
      /DIRECT_UPLOAD_ACTIVATION_PROOF_DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        parseDirectUploadActivationProofConfig({
          DIRECT_UPLOAD_ACTIVATION_PROOF_DATABASE_URL:
            "postgresql://ci:ci@database.example/grainline_ci",
        }),
      /refuses a non-loopback database/,
    );
    assert.throws(
      () =>
        parseDirectUploadActivationProofConfig({
          DIRECT_UPLOAD_ACTIVATION_PROOF_DATABASE_URL:
            "postgresql://ci:ci@127.0.0.1/production",
        }),
      /requires grainline_ci/,
    );
    assert.deepEqual(
      parseDirectUploadActivationProofConfig({
        DIRECT_UPLOAD_ACTIVATION_PROOF_DATABASE_URL:
          "postgresql://ci:ci@127.0.0.1/grainline_ci",
      }),
      {
        databaseUrl: "postgresql://ci:ci@127.0.0.1/grainline_ci",
      },
    );
  });

  it("proves exact activated catalog, source, identities and ACLs", () => {
    assert.match(proof, /functions\.rows\.length, 35/);
    assert.match(proof, /oidvectortypes\(procedure\.proargtypes\)/);
    assert.match(proof, /row\.identity_arguments, expected\.identityArguments/);
    assert.match(proof, /row\.prokind, "f"/);
    assert.match(proof, /owner_is_proof_role/);
    assert.match(proof, /source hash drifted/);
    assert.match(proof, /policy_count: 0/);
    assert.match(proof, /runtime_authority: false/);
    assert.match(proof, /cleanup_authority: false/);
    assert.match(proof, /attribute\.attname = 'objectKey'/);
  });

  it("proves both direct-denial sides and only fixed function authority", () => {
    assert.match(proof, /\[runtime, "runtime"\]/);
    assert.match(proof, /\[cleanup, "cleanup"\]/);
    assert.match(proof, /\$\{label\} DirectUpload SELECT/);
    assert.match(proof, /runtime cleanup lease/);
    assert.match(proof, /runtime unreleased private-message recorder/);
    assert.match(proof, /cleanup ordinary upload recorder/);
    assert.match(proof, /foreign Listing sync/);
    assert.match(
      proof,
      /\[ids\.stranger, ids\.case, ids\.caseAttachment\][\s\S]*?\.rows,[\s\S]*?\[\]/,
    );
    assert.match(proof, /retired_case_key/);
    assert.match(proof, /isolated_cleanup_lease_fence/);
    assert.match(proof, /wrong-lease/);
  });

  it("cleans every fixture and records no persistent environment change", () => {
    assert.match(proof, /async function cleanupFixtures/);
    assert.match(
      proof,
      /finally \{\s*try \{\s*await cleanupFixtures\(owner\);\s*\} finally \{/,
    );
    assert.doesNotMatch(
      proof,
      /cleanupFixtures\(owner\)\.catch\(\(\) => \{\}\)/,
    );
    assert.match(proof, /persistentStagingChanged: false/);
    assert.match(proof, /productionChanged: false/);
    assert.doesNotMatch(proof, /process\.env\.DATABASE_URL/);
    assert.equal(
      packageJson.scripts["audit:rls-direct-upload-activation"],
      "node scripts/direct-upload-activation-postgres-proof.mjs",
    );
  });

  it("runs retirement, activation, live authority and rollback in PG16", () => {
    assert.match(
      workflow,
      /agent\/direct-upload-activation-production-20260801/,
    );
    assert.match(workflow, /image: postgres:16/);
    assert.match(
      workflow,
      /Prove the retirement candidate before isolating its promoted migration[\s\S]*node --test tests\/direct-upload-retirement-candidate\.test\.mjs[\s\S]*Isolate the repair migration for exact SQL diagnostics/,
    );
    const postIsolationContracts = workflow.slice(
      workflow.indexOf("- name: Run pre-activation static proof contracts"),
      workflow.indexOf("- name: Prove both valid DirectUpload legacy repair shapes"),
    );
    assert.doesNotMatch(
      postIsolationContracts,
      /tests\/direct-upload-retirement-candidate\.test\.mjs/,
    );
    assert.match(
      workflow,
      /Isolate the repair migration for exact SQL diagnostics[\s\S]*20260801175000_retire_direct_upload_compatibility_key[\s\S]*20260801194000_enable_direct_upload_rls[\s\S]*Converge isolated DirectUpload cleanup-worker grants[\s\S]*Restore the exact promoted DirectUpload releases[\s\S]*Verify promoted DirectUpload release bytes and migration tree[\s\S]*Apply promoted retirement and activation through Prisma/,
    );
    assert.doesNotMatch(workflow, /Stage disposable DirectUpload/);
    assert.doesNotMatch(workflow, /prisma migrate resolve[\s\S]*20260726190/);
    assert.match(
      workflow,
      /Reconverge activated runtime grants[\s\S]*Reconverge activated cleanup-worker grants[\s\S]*Audit activated runtime grants and RLS catalog/,
    );
    assert.match(workflow, /npm run audit:rls-direct-upload-activation/);
    assert.match(
      workflow,
      /npm run audit:rls-direct-upload-activation-rollback/,
    );
  });
});
