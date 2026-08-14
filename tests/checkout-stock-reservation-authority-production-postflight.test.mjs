import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RESERVATION_SOURCE_CONSISTENCY_POSTFLIGHT_CONFIRMATION,
  assertReservationSourceConsistencyPostflightGitState,
  parseReservationSourceConsistencyPostflightConfig,
  writeReservationSourceConsistencyPostflightEvidence,
} from "../scripts/checkout-stock-reservation-authority-production-postflight.mjs";
import {
  checkoutStockReservationFunctionSources,
  checkoutStockReservationSourceConsistentFunctionSourceSha256,
  checkoutStockReservationSourceConsistentFunctionSources,
} from "../scripts/checkout-stock-reservation-function-source-catalog.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_BASE_AUTHORITY_FUNCTIONS,
  CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENT_FUNCTIONS,
} from "../scripts/checkout-stock-reservation-authority-catalog.mjs";

const RELEASE_COMMIT = "a".repeat(40);
const RUNTIME_URL =
  "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function environment(directory, overrides = {}) {
  return {
    DATABASE_URL: RUNTIME_URL,
    CHECKOUT_STOCK_RESERVATION_SOURCE_POSTFLIGHT_CONFIRM:
      RESERVATION_SOURCE_CONSISTENCY_POSTFLIGHT_CONFIRMATION,
    CHECKOUT_STOCK_RESERVATION_SOURCE_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `checkout-stock-reservation-source-consistency-production-postflight-${RELEASE_COMMIT}.json`,
    ),
    CHECKOUT_STOCK_RESERVATION_SOURCE_POSTFLIGHT_MAIN_CI_RUN_ID: "31820000001",
    CHECKOUT_STOCK_RESERVATION_SOURCE_POSTFLIGHT_MIGRATION_MAIN_CI_RUN_ID:
      "31813433933",
    CHECKOUT_STOCK_RESERVATION_SOURCE_POSTFLIGHT_MIGRATION_RUN_ID: "31814032227",
    CHECKOUT_STOCK_RESERVATION_SOURCE_POSTFLIGHT_RELEASE_COMMIT: RELEASE_COMMIT,
    ...overrides,
  };
}

test("source-consistency postflight accepts only pooled runtime and exact bindings", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "reservation-authority-postflight-"));
  try {
    const parsed = parseReservationSourceConsistencyPostflightConfig(
      environment(directory),
    );
    assert.equal(parsed.releaseCommit, RELEASE_COMMIT);
    assert.equal(parsed.runtimeIdentity.runtimeRole, "grainline_app_runtime");
    assert.equal(parsed.mainCiRunId, 31820000001);
    assert.equal(parsed.migrationMainCiRunId, 31813433933);
    assert.equal(parsed.migrationRunId, 31814032227);
    for (const drift of [
      { CHECKOUT_STOCK_RESERVATION_SOURCE_POSTFLIGHT_CONFIRM: "yes" },
      { CHECKOUT_STOCK_RESERVATION_SOURCE_POSTFLIGHT_RELEASE_COMMIT: "short" },
      { CHECKOUT_STOCK_RESERVATION_SOURCE_POSTFLIGHT_MAIN_CI_RUN_ID: "0" },
      {
        CHECKOUT_STOCK_RESERVATION_SOURCE_POSTFLIGHT_MIGRATION_MAIN_CI_RUN_ID:
          "bad",
      },
      { CHECKOUT_STOCK_RESERVATION_SOURCE_POSTFLIGHT_MIGRATION_RUN_ID: "0" },
      { DATABASE_URL: RUNTIME_URL.replace("grainline_app_runtime", "neondb_owner") },
      { DATABASE_URL: RUNTIME_URL.replace("-pooler", "") },
      { DIRECT_URL: "present" },
      { OTHER_DATABASE_URL: RUNTIME_URL },
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      { PGOPTIONS: "-c row_security=off" },
      { CHECKOUT_STOCK_RESERVATION_SOURCE_POSTFLIGHT_EVIDENCE_PATH: "/tmp/wrong.json" },
    ]) {
      assert.throws(() => parseReservationSourceConsistencyPostflightConfig(
        environment(directory, drift),
      ));
    }
    const unsafeDirectory = path.join(directory, "unsafe-evidence");
    fs.mkdirSync(unsafeDirectory, { mode: 0o755 });
    fs.chmodSync(unsafeDirectory, 0o755);
    assert.throws(() => parseReservationSourceConsistencyPostflightConfig(
      environment(directory, {
        CHECKOUT_STOCK_RESERVATION_SOURCE_POSTFLIGHT_EVIDENCE_PATH: path.join(
          unsafeDirectory,
          `checkout-stock-reservation-source-consistency-production-postflight-${RELEASE_COMMIT}.json`,
        ),
      }),
    ));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("source-consistency postflight binds exact clean source and writes evidence once", () => {
  assert.deepEqual(
    assertReservationSourceConsistencyPostflightGitState(
      { head: RELEASE_COMMIT, status: "" },
      RELEASE_COMMIT,
    ),
    { clean: true, head: RELEASE_COMMIT },
  );
  assert.throws(() => assertReservationSourceConsistencyPostflightGitState(
    { head: RELEASE_COMMIT, status: "?? residue" },
    RELEASE_COMMIT,
  ));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "reservation-authority-evidence-"));
  try {
    const pathname = path.join(directory, "evidence.json");
    writeReservationSourceConsistencyPostflightEvidence(pathname, {
      status: "passed",
      productionChangedByPostflight: false,
    });
    assert.equal(fs.statSync(pathname).mode & 0o777, 0o600);
    assert.throws(() => writeReservationSourceConsistencyPostflightEvidence(pathname, {}), {
      code: "EEXIST",
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("function source catalog extracts every applied compatible body", () => {
  assert.equal(
    Object.keys(checkoutStockReservationFunctionSources()).length,
    CHECKOUT_STOCK_RESERVATION_BASE_AUTHORITY_FUNCTIONS.length,
  );
});

test("source-consistent catalog adds only the five reviewed successor bodies", () => {
  assert.equal(
    Object.keys(checkoutStockReservationSourceConsistentFunctionSources()).length,
    CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENT_FUNCTIONS.length,
  );
  assert.equal(
    CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENT_FUNCTIONS.length
      - CHECKOUT_STOCK_RESERVATION_BASE_AUTHORITY_FUNCTIONS.length,
    5,
  );
  assert.equal(
    Object.keys(
      checkoutStockReservationSourceConsistentFunctionSourceSha256(),
    ).length,
    CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENT_FUNCTIONS.length,
  );
});

test("postflight proves source-consistent catalog and behavior in one read-only snapshot", () => {
  const source = fs.readFileSync(
    "scripts/checkout-stock-reservation-authority-production-postflight.mjs",
    "utf8",
  );
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(source, /transaction_read_only/);
  assert.match(source, /CURRENT_USER AS current_user_name/);
  assert.match(source, /SESSION_USER AS session_user_name/);
  assert.match(source, /expectedSessionRole = expected\.runtimeRole/);
  assert.match(source, /runtime_privileges: \["DELETE", "INSERT", "SELECT", "UPDATE"\]/);
  assert.match(source, /rls_enabled: false/);
  assert.match(source, /FROM unnest\(\$1::text\[\], \$2::text\[\]\)/);
  assert.match(source, /oidvectortypes\(procedure\.proargtypes\)/);
  assert.match(source, /actual_function_count/);
  assert.match(source, /pg_get_constraintdef/);
  assert.match(source, /FROM pg_catalog\.pg_attribute/);
  assert.doesNotMatch(source, /information_schema\.columns/);
  assert.match(source, /source-consistency private helper execution/);
  assert.match(source, /CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENT_FUNCTIONS/);
  assert.match(
    source,
    /checkoutStockReservationSourceConsistentFunctionSourceSha256/,
  );
  assert.match(source, /functionCount: 25/);
  assert.match(source, /migrationMainCiRunId/);
  assert.match(source, /fixed write read-only fence/);
  assert.match(source, /"25006"/);
  assert.doesNotMatch(source, /SET\s+(?:LOCAL\s+)?ROLE/i);
  assert.doesNotMatch(
    source,
    /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|FROM|public\.)/i,
  );
  assert.doesNotMatch(source, /target:\s*Object\.freeze\(\{[\s\S]*databaseUrl,/);
  assert.match(source, /productionChangedByPostflight: false/);
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts["ops:checkout-stock-reservation-source-consistency-postflight"],
    "node scripts/checkout-stock-reservation-authority-production-postflight.mjs",
  );
  assert.equal(pkg.scripts["ops:checkout-stock-reservation-authority-postflight"], undefined);

  const runbook = fs.readFileSync("docs/runbook.md", "utf8");
  assert.match(runbook, /ops:checkout-stock-reservation-source-consistency-postflight/u);
  assert.match(runbook, /CHECKOUT_STOCK_RESERVATION_SOURCE_POSTFLIGHT_CONFIRM/u);
  assert.match(runbook, /CHECKOUT_STOCK_RESERVATION_SOURCE_POSTFLIGHT_MIGRATION_MAIN_CI_RUN_ID=31813433933/u);
  assert.match(runbook, /CHECKOUT_STOCK_RESERVATION_SOURCE_POSTFLIGHT_MIGRATION_RUN_ID=31814032227/u);
  assert.match(runbook, /exact 25-function/u);
});
