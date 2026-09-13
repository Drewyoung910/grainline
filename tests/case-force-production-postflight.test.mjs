import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CASE_FORCE_MIGRATION,
  CASE_FORCE_POSTFLIGHT_CONFIRMATION,
  parseCaseForcePostflightConfig,
  parseCasePostflightMode,
} from "../scripts/case-activation-production-postflight.mjs";

const RUNTIME_URL =
  "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const RELEASE_COMMIT = "b".repeat(40);

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "case-force-postflight-"));
}

function environment(directory, overrides = {}) {
  return {
    DATABASE_URL: RUNTIME_URL,
    CASE_FORCE_POSTFLIGHT_CONFIRM: CASE_FORCE_POSTFLIGHT_CONFIRMATION,
    CASE_FORCE_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `case-force-production-postflight-${RELEASE_COMMIT}.json`,
    ),
    CASE_FORCE_POSTFLIGHT_MAIN_CI_RUN_ID: "30947643851",
    CASE_FORCE_POSTFLIGHT_MIGRATION_RUN_ID: "30950000001",
    CASE_FORCE_POSTFLIGHT_RELEASE_COMMIT: RELEASE_COMMIT,
    ...overrides,
  };
}

describe("Case FORCE production postflight", () => {
  it("keeps FORCE mode explicit and rejects every other argument shape", () => {
    assert.equal(parseCasePostflightMode([]), false);
    assert.equal(parseCasePostflightMode(["--post-force"]), true);
    assert.throws(() => parseCasePostflightMode(["--force"]));
    assert.throws(() => parseCasePostflightMode(["--post-force", "extra"]));
  });

  it("accepts only distinct FORCE bindings and a fresh exact evidence path", () => {
    const directory = tempDirectory();
    try {
      const config = parseCaseForcePostflightConfig(environment(directory));
      assert.equal(config.forceExpected, true);
      assert.equal(config.migration, CASE_FORCE_MIGRATION);
      assert.equal(config.releaseCommit, RELEASE_COMMIT);
      assert.equal(config.mainCiRunId, 30947643851);
      assert.equal(config.migrationRunId, 30950000001);
      assert.equal(
        config.applicationName,
        "grainline-case-force-production-postflight",
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects activation aliases, privileged URLs, and FORCE binding drift", () => {
    const cases = [
      { CASE_FORCE_POSTFLIGHT_CONFIRM: "yes" },
      { CASE_FORCE_POSTFLIGHT_RELEASE_COMMIT: "short" },
      { CASE_FORCE_POSTFLIGHT_MAIN_CI_RUN_ID: "0" },
      { CASE_FORCE_POSTFLIGHT_MIGRATION_RUN_ID: "not-a-run" },
      { DATABASE_URL: RUNTIME_URL.replace("grainline_app_runtime", "neondb_owner") },
      { DIRECT_URL: "present" },
      { OTHER_DATABASE_URL: RUNTIME_URL },
      { CASE_FORCE_POSTFLIGHT_EVIDENCE_PATH: "/tmp/wrong.json" },
      {
        CASE_FORCE_POSTFLIGHT_CONFIRM: undefined,
        CASE_ACTIVATION_POSTFLIGHT_CONFIRM:
          "verify-production-case-policyless-activation-read-only",
      },
    ];
    for (const drift of cases) {
      const directory = tempDirectory();
      try {
        assert.throws(() =>
          parseCaseForcePostflightConfig(environment(directory, drift))
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it("requires FORCE while preserving the read-only denial proof", () => {
    const source = fs.readFileSync(
      "scripts/case-activation-production-postflight.mjs",
      "utf8",
    );
    assert.equal(CASE_FORCE_MIGRATION, "20260804191000_force_case_rls");
    assert.match(source, /rls_forced, forceExpected/);
    assert.match(source, /config\.forceExpected/);
    assert.match(source, /case_family_policyless_enable_with_force/);
    assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    assert.match(source, /"42501"/);
    assert.match(source, /productionChangedByPostflight: false/);
    assert.doesNotMatch(
      source,
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|FROM|public\.)/i,
    );
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    assert.equal(
      packageJson.scripts?.["ops:case-force-postflight"],
      "node scripts/case-activation-production-postflight.mjs --post-force",
    );
  });
});
