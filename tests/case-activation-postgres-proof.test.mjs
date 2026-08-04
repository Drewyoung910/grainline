import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  parseCaseActivationProofConfig,
} from "../scripts/case-activation-postgres-proof.mjs";

const source = fs.readFileSync(
  "scripts/case-activation-postgres-proof.mjs",
  "utf8",
);
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("Case activation proof refuses persistent or remote databases", () => {
  assert.throws(
    () => parseCaseActivationProofConfig({}),
    /CASE_ACTIVATION_PROOF_DATABASE_URL is required/,
  );
  assert.throws(
    () => parseCaseActivationProofConfig({
      CASE_ACTIVATION_PROOF_DATABASE_URL:
        "postgresql://ci:ci@database.example/grainline_ci",
    }),
    /refuses a non-loopback database/,
  );
  assert.throws(
    () => parseCaseActivationProofConfig({
      CASE_ACTIVATION_PROOF_DATABASE_URL:
        "postgresql://ci:ci@127.0.0.1/production",
    }),
    /requires grainline_ci/,
  );
});

test("Case activation proof pins policyless ENABLE without FORCE or direct grants", () => {
  assert.match(source, /relrowsecurity: true/);
  assert.match(source, /relforcerowsecurity: forceExpected/);
  assert.match(source, /forceExpected = false/);
  assert.match(source, /policy_count: 0/);
  assert.match(source, /runtime_table_authority: false/);
  assert.match(source, /runtime_column_authority: false/);
  assert.match(source, /SET LOCAL ROLE grainline_app_runtime/);
  assert.match(source, /directOperationsDenied: TABLES\.length \* 4/);
  assert.match(source, /caught\.code, "42501"/);
});

test("Case activation proof always rolls back and records no persistent change", () => {
  assert.match(source, /await client\.query\("ROLLBACK"\)/);
  assert.match(
    source,
    /if \(began\) await client\.query\("ROLLBACK"\)\.catch\(\(\) => \{\}\)/,
  );
  assert.match(source, /persistentDatabaseChanged: false/);
  assert.match(source, /productionChanged: false/);
  assert.equal(
    packageJson.scripts["audit:rls-case-activation-postgres"],
    "node scripts/case-activation-postgres-proof.mjs",
  );
});
