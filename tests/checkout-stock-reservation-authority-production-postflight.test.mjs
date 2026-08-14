import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RESERVATION_AUTHORITY_POSTFLIGHT_CONFIRMATION,
  assertReservationAuthorityPostflightGitState,
  parseReservationAuthorityPostflightConfig,
  writeReservationAuthorityPostflightEvidence,
} from "../scripts/checkout-stock-reservation-authority-production-postflight.mjs";
import {
  checkoutStockReservationCandidateFunctionSources,
  checkoutStockReservationFunctionSources,
} from "../scripts/checkout-stock-reservation-function-source-catalog.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS,
  CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS,
} from "../scripts/checkout-stock-reservation-authority-catalog.mjs";

const RELEASE_COMMIT = "a".repeat(40);
const RUNTIME_URL =
  "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function environment(directory, overrides = {}) {
  return {
    DATABASE_URL: RUNTIME_URL,
    CHECKOUT_STOCK_RESERVATION_AUTHORITY_POSTFLIGHT_CONFIRM:
      RESERVATION_AUTHORITY_POSTFLIGHT_CONFIRMATION,
    CHECKOUT_STOCK_RESERVATION_AUTHORITY_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `checkout-stock-reservation-authority-production-postflight-${RELEASE_COMMIT}.json`,
    ),
    CHECKOUT_STOCK_RESERVATION_AUTHORITY_POSTFLIGHT_INSPECTION_RUN_ID: "31740000001",
    CHECKOUT_STOCK_RESERVATION_AUTHORITY_POSTFLIGHT_MAIN_CI_RUN_ID: "31740000002",
    CHECKOUT_STOCK_RESERVATION_AUTHORITY_POSTFLIGHT_MIGRATION_RUN_ID: "31740000003",
    CHECKOUT_STOCK_RESERVATION_AUTHORITY_POSTFLIGHT_RELEASE_COMMIT: RELEASE_COMMIT,
    ...overrides,
  };
}

test("compatible postflight accepts only pooled runtime and exact bindings", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "reservation-authority-postflight-"));
  try {
    const parsed = parseReservationAuthorityPostflightConfig(environment(directory));
    assert.equal(parsed.releaseCommit, RELEASE_COMMIT);
    assert.equal(parsed.runtimeIdentity.runtimeRole, "grainline_app_runtime");
    assert.equal(parsed.inspectionRunId, 31740000001);
    for (const drift of [
      { CHECKOUT_STOCK_RESERVATION_AUTHORITY_POSTFLIGHT_CONFIRM: "yes" },
      { CHECKOUT_STOCK_RESERVATION_AUTHORITY_POSTFLIGHT_RELEASE_COMMIT: "short" },
      { CHECKOUT_STOCK_RESERVATION_AUTHORITY_POSTFLIGHT_INSPECTION_RUN_ID: "0" },
      { CHECKOUT_STOCK_RESERVATION_AUTHORITY_POSTFLIGHT_MAIN_CI_RUN_ID: "bad" },
      { DATABASE_URL: RUNTIME_URL.replace("grainline_app_runtime", "neondb_owner") },
      { DATABASE_URL: RUNTIME_URL.replace("-pooler", "") },
      { DIRECT_URL: "present" },
      { OTHER_DATABASE_URL: RUNTIME_URL },
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      { PGOPTIONS: "-c row_security=off" },
      { CHECKOUT_STOCK_RESERVATION_AUTHORITY_POSTFLIGHT_EVIDENCE_PATH: "/tmp/wrong.json" },
    ]) {
      assert.throws(() => parseReservationAuthorityPostflightConfig(
        environment(directory, drift),
      ));
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("compatible postflight binds exact clean source and writes evidence once", () => {
  assert.deepEqual(
    assertReservationAuthorityPostflightGitState(
      { head: RELEASE_COMMIT, status: "" },
      RELEASE_COMMIT,
    ),
    { clean: true, head: RELEASE_COMMIT },
  );
  assert.throws(() => assertReservationAuthorityPostflightGitState(
    { head: RELEASE_COMMIT, status: "?? residue" },
    RELEASE_COMMIT,
  ));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "reservation-authority-evidence-"));
  try {
    const pathname = path.join(directory, "evidence.json");
    writeReservationAuthorityPostflightEvidence(pathname, {
      status: "passed",
      productionChangedByPostflight: false,
    });
    assert.equal(fs.statSync(pathname).mode & 0o777, 0o600);
    assert.throws(() => writeReservationAuthorityPostflightEvidence(pathname, {}), {
      code: "EEXIST",
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("function source catalog extracts every applied compatible body", () => {
  assert.equal(
    Object.keys(checkoutStockReservationFunctionSources()).length,
    CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS.length,
  );
});

test("candidate source catalog adds only the five reviewed draft bodies", () => {
  assert.equal(
    Object.keys(checkoutStockReservationCandidateFunctionSources()).length,
    CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS.length,
  );
  assert.equal(
    CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS.length
      - CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS.length,
    5,
  );
});

test("postflight proves compatible catalog and behavior in one read-only snapshot", () => {
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
  assert.match(source, /checkoutStockReservationFunctionSourceSha256/);
  assert.match(source, /actual_function_count/);
  assert.match(source, /pg_get_constraintdef/);
  assert.match(source, /FROM pg_catalog\.pg_attribute/);
  assert.doesNotMatch(source, /information_schema\.columns/);
  assert.match(source, /private helper execution/);
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
    pkg.scripts["ops:checkout-stock-reservation-authority-postflight"],
    "node scripts/checkout-stock-reservation-authority-production-postflight.mjs",
  );
});
