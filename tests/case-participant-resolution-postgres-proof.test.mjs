import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseParticipantResolutionProofConfig,
} from "../scripts/case-participant-resolution-postgres-proof.mjs";

const proof = readFileSync(
  "scripts/case-participant-resolution-postgres-proof.mjs",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

describe("Case participant-resolution PostgreSQL proof", () => {
  it("refuses persistent and non-disposable database targets", () => {
    assert.throws(
      () => parseParticipantResolutionProofConfig({}),
      /CASE_PARTICIPANT_RESOLUTION_PROOF_DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        parseParticipantResolutionProofConfig({
          CASE_PARTICIPANT_RESOLUTION_PROOF_DATABASE_URL:
            "postgresql://ci:ci@database.example/grainline_ci",
        }),
      /refuses a non-loopback database/,
    );
    assert.throws(
      () =>
        parseParticipantResolutionProofConfig({
          CASE_PARTICIPANT_RESOLUTION_PROOF_DATABASE_URL:
            "postgresql://ci:ci@127.0.0.1/production",
        }),
      /requires the grainline_ci database/,
    );
    assert.deepEqual(
      parseParticipantResolutionProofConfig({
        CASE_PARTICIPANT_RESOLUTION_PROOF_DATABASE_URL:
          "postgresql://ci:ci@127.0.0.1/grainline_ci",
      }),
      {
        databaseUrl: "postgresql://ci:ci@127.0.0.1/grainline_ci",
      },
    );
  });

  it("proves authority, stable replay, leases, real lock waits, and rollback", () => {
    for (const check of [
      "foreign_participant_resolution_mark",
      "refund_lease_blocks_resolution_mark",
      "staff_claim_blocks_resolution_mark",
      "proveNullableLegacyParticipant",
      "missing_replay_status_rejected",
      "buyerReplay",
      "sellerReplay",
      "proveRepeatedResolutionCycle",
      "Staff follow-up must not invalidate the active resolution source",
      "secondReplay",
      "secondMark.auditLogId, firstMark.auditLogId",
      "waitForLock",
      "wait_event_type, \"Lock\"",
      "proveRollback",
      "audit_count: 0",
      "checks: 13",
    ]) {
      assert.match(proof, new RegExp(check), check);
    }
    assert.match(proof, /SET LOCAL ROLE grainline_app_runtime/);
    assert.match(proof, /grainline_case_staff_resolution_prepare/);
    assert.match(proof, /grainline_case_staff_resolution_finalize/);
    assert.match(proof, /persistentStagingChanged: false/);
    assert.match(proof, /productionChanged: false/);
    assert.doesNotMatch(proof, /process\.env\.DATABASE_URL/);
  });

  it("cleans every fixture and runs after migration/grant convergence in CI", () => {
    assert.match(proof, /async function cleanupFixtures/);
    assert.match(proof, /await cleanupFixtures\(observer\)/);
    assert.match(
      proof,
      /async function seedFixtures\(client\) \{\s+await client\.query\("BEGIN"\);\s+try \{\s+await seedFixturesBody\(client\);\s+await client\.query\("COMMIT"\)/,
    );
    assert.equal(
      packageJson.scripts["audit:rls-case-participant-resolution"],
      "node scripts/case-participant-resolution-postgres-proof.mjs",
    );
    assert.match(
      workflow,
      /Apply migrations to CI Postgres[\s\S]*Converge production-style runtime grants after migrations[\s\S]*Prove participant Case resolution authority in ephemeral PostgreSQL/,
    );
    assert.match(
      workflow,
      /CASE_PARTICIPANT_RESOLUTION_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/,
    );
  });
});
