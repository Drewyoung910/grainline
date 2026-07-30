import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  CASE_INVARIANT_FUNCTIONS,
} from "../scripts/case-invariant-catalog.mjs";
import {
  CASE_INVARIANT_POSTFLIGHT_CONFIRMATION,
  parseCaseInvariantPostflightConfig,
} from "../scripts/case-invariant-production-postflight.mjs";

const runtimeUrl =
  "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function environment(overrides = {}) {
  return {
    CASE_INVARIANT_POSTFLIGHT_CONFIRM:
      CASE_INVARIANT_POSTFLIGHT_CONFIRMATION,
    DATABASE_URL: runtimeUrl,
    ...overrides,
  };
}

test("Case invariant postflight accepts only the pooled production runtime", () => {
  const config = parseCaseInvariantPostflightConfig(environment());
  assert.equal(config.runtimeGuard.runtimeRole, "grainline_app_runtime");
  assert.equal(config.runtimeGuard.endpointId, "ep-plain-river-aaqg8gj4");
  assert.equal(config.runtimeGuard.runtimeDatabaseVerified, true);
});

test("Case invariant postflight rejects privileged and ambiguous targets", () => {
  for (const override of [
    { CASE_INVARIANT_POSTFLIGHT_CONFIRM: "yes" },
    { DATABASE_URL: runtimeUrl.replace("grainline_app_runtime", "neondb_owner") },
    { DATABASE_URL: runtimeUrl.replace("-pooler", "") },
    { DATABASE_URL: runtimeUrl.replace("ep-plain-river-aaqg8gj4", "ep-other") },
    { DIRECT_URL: "present" },
    { PRODUCTION_MIGRATION_DIRECT_URL: "present" },
    {
      OWNER_CONNECTION: runtimeUrl
        .replace("grainline_app_runtime", "neondb_owner")
        .replace("-pooler", ""),
    },
    { PGOPTIONS: "-c role=neondb_owner" },
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
  ]) {
    assert.throws(
      () => parseCaseInvariantPostflightConfig(environment(override)),
    );
  }
});

test("Case invariant postflight is read-only and catalog-complete", () => {
  const source = fs.readFileSync(
    "scripts/case-invariant-production-postflight.mjs",
    "utf8",
  );
  assert.match(source, /BEGIN TRANSACTION READ ONLY/);
  assert.match(source, /transaction_read_only/);
  assert.match(source, /ROLLBACK/);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|public)/i);
  assert.equal(CASE_INVARIANT_FUNCTIONS.length, 8);
  assert.equal(
    CASE_INVARIANT_FUNCTIONS.filter((entry) => entry.securityDefiner).length,
    5,
  );
  assert.equal(
    CASE_INVARIANT_FUNCTIONS.filter((entry) => !entry.securityDefiner).length,
    3,
  );
  assert.match(source, /constraintNames\.length/);
  assert.match(source, /triggerNames\.length/);
  assert.match(source, /caught\?\.code, "42501"/);
  assert.match(source, /caseFamilyRlsEnabled: false/);
  assert.match(source, /productionChanged: false/);
  assert.doesNotMatch(source, /console\.log\(.*databaseUrl/);
});
