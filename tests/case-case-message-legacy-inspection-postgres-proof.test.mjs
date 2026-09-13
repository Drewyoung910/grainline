import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseCaseLegacyInspectionProofConfig,
} from "../scripts/case-case-message-legacy-inspection-postgres-proof.mjs";

const proof = readFileSync(
  "scripts/case-case-message-legacy-inspection-postgres-proof.mjs",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

describe("Case and CaseMessage legacy inspection PostgreSQL proof", () => {
  it("refuses non-loopback and non-disposable database targets", () => {
    assert.throws(
      () => parseCaseLegacyInspectionProofConfig({}),
      /CASE_LEGACY_INSPECTION_PROOF_DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        parseCaseLegacyInspectionProofConfig({
          CASE_LEGACY_INSPECTION_PROOF_DATABASE_URL:
            "postgresql://ci:ci@database.example/grainline_ci",
        }),
      /refuses a non-loopback database/,
    );
    assert.throws(
      () =>
        parseCaseLegacyInspectionProofConfig({
          CASE_LEGACY_INSPECTION_PROOF_DATABASE_URL:
            "postgresql://ci:ci@127.0.0.1/production",
        }),
      /requires the grainline_ci database/,
    );
    assert.deepEqual(
      parseCaseLegacyInspectionProofConfig({
        CASE_LEGACY_INSPECTION_PROOF_DATABASE_URL:
          "postgresql://ci:ci@127.0.0.1/grainline_ci",
      }),
      {
        databaseUrl: "postgresql://ci:ci@127.0.0.1/grainline_ci",
      },
    );
  });

  it("executes the exact aggregate query in an engine-attested read-only transaction", () => {
    assert.match(proof, /CASE_LEGACY_COUNTS_SQL/);
    assert.match(
      proof,
      /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/,
    );
    assert.match(proof, /transaction_read_only/);
    assert.match(proof, /normalizeCaseLegacyResult/);
    assert.match(proof, /await client\.query\("ROLLBACK"\)/);
    assert.match(proof, /productionChanged: false/);
    assert.doesNotMatch(proof, /process\.env\.DATABASE_URL/);
  });

  it("runs after the full migration tree in PostgreSQL 16 CI", () => {
    assert.match(ci, /image: postgres:16/);
    assert.match(
      ci,
      /Apply migrations to CI Postgres[\s\S]*Prove Case and CaseMessage legacy inspection SQL in ephemeral PostgreSQL/,
    );
    assert.match(
      ci,
      /CASE_LEGACY_INSPECTION_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/,
    );
    assert.equal(
      packageJson.scripts["audit:rls-case-legacy-inspection"],
      "node scripts/case-case-message-legacy-inspection-postgres-proof.mjs",
    );
  });
});
