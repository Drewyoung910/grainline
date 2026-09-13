import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  parseCaseCompatibleDatabasePostflightProofConfig,
} from "../scripts/case-compatible-database-postflight-postgres-proof.mjs";

const LOOPBACK_URL =
  "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable";

describe("Case compatible database postflight PostgreSQL proof", () => {
  it("accepts only the disposable loopback owner database", () => {
    assert.equal(
      parseCaseCompatibleDatabasePostflightProofConfig({
        CASE_COMPATIBLE_DB_POSTFLIGHT_PROOF_DATABASE_URL: LOOPBACK_URL,
      }).databaseUrl,
      LOOPBACK_URL,
    );
    for (const databaseUrl of [
      LOOPBACK_URL.replace("127.0.0.1", "example.com"),
      LOOPBACK_URL.replace("grainline_ci", "production"),
      LOOPBACK_URL.replace("ci:ci@", "grainline_app_runtime:runtime@"),
    ]) {
      assert.throws(
        () => parseCaseCompatibleDatabasePostflightProofConfig({
          CASE_COMPATIBLE_DB_POSTFLIGHT_PROOF_DATABASE_URL: databaseUrl,
        }),
      );
    }
  });

  it("temporarily authenticates the runtime role and always removes the proof password", () => {
    const source = fs.readFileSync(
      "scripts/case-compatible-database-postflight-postgres-proof.mjs",
      "utf8",
    );
    assert.match(source, /ALTER ROLE grainline_app_runtime\s+PASSWORD 'case-compatible-ci-proof'/);
    assert.match(
      source,
      /finally \{[\s\S]*ALTER ROLE grainline_app_runtime\s+PASSWORD NULL/,
    );
    assert.match(source, /runCaseCompatibleDatabasePostflight/);
    assert.match(source, /productionChangedByPostflight, false/);
    assert.match(source, /postflightReadOnly, true/);
    const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
    assert.match(
      workflow,
      /Prove compatible Case production postflight under the runtime role[\s\S]{0,260}CASE_COMPATIBLE_DB_POSTFLIGHT_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/,
    );
  });
});
