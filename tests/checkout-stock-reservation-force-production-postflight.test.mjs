import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_CONFIRMATION,
  assertCheckoutStockReservationForcePostflightGitState,
  parseCheckoutStockReservationForcePostflightConfig,
  writeCheckoutStockReservationForcePostflightEvidence,
} from "../scripts/checkout-stock-reservation-force-production-postflight.mjs";

const RELEASE_COMMIT = "f".repeat(40);
const RUNTIME_URL =
  "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function environment(directory, overrides = {}) {
  return {
    DATABASE_URL: RUNTIME_URL,
    CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_CONFIRM:
      CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_CONFIRMATION,
    CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `checkout-stock-reservation-force-production-postflight-${RELEASE_COMMIT}.json`,
    ),
    CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_MAIN_CI_RUN_ID:
      "31910000001",
    CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_MIGRATION_RUN_ID:
      "31910000002",
    CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_RELEASE_COMMIT:
      RELEASE_COMMIT,
    ...overrides,
  };
}

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("reservation FORCE postflight accepts only exact pooled-runtime bindings", () => {
  const directory = temporaryDirectory("reservation-force-postflight-");
  try {
    const parsed = parseCheckoutStockReservationForcePostflightConfig(
      environment(directory),
    );
    assert.equal(parsed.releaseCommit, RELEASE_COMMIT);
    assert.equal(parsed.mainCiRunId, 31910000001);
    assert.equal(parsed.migrationRunId, 31910000002);
    assert.equal(parsed.runtimeIdentity.runtimeRole, "grainline_app_runtime");
    assert.equal(parsed.runtimeIdentity.endpointId, "ep-plain-river-aaqg8gj4");
    assert.equal(parsed.runtimeIdentity.region, "westus3.azure");
    assert.equal(parsed.runtimeIdentity.databaseName, "neondb");
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test("reservation FORCE postflight fails closed on alias, role and binding drift", () => {
  const driftCases = [
    { CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_CONFIRM: "yes" },
    { CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_RELEASE_COMMIT: "short" },
    { CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_MAIN_CI_RUN_ID: "0" },
    { CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_MIGRATION_RUN_ID: "1.5" },
    { DATABASE_URL: RUNTIME_URL.replace("-pooler", "") },
    {
      DATABASE_URL: RUNTIME_URL.replace(
        "grainline_app_runtime",
        "neondb_owner",
      ),
    },
    { DIRECT_URL: RUNTIME_URL },
    { OTHER_DATABASE_URL: RUNTIME_URL },
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    { PGOPTIONS: "-c row_security=off" },
    {
      CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_EVIDENCE_PATH:
        "/tmp/wrong.json",
    },
    {
      CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_CONFIRM: undefined,
      CHECKOUT_STOCK_RESERVATION_ACTIVATION_POSTFLIGHT_CONFIRM:
        "verify-production-checkout-stock-reservation-activation-runtime-read-only",
    },
  ];
  for (const drift of driftCases) {
    const directory = temporaryDirectory("reservation-force-drift-");
    try {
      assert.throws(() =>
        parseCheckoutStockReservationForcePostflightConfig(
          environment(directory, drift),
        )
      );
    } finally {
      fs.rmSync(directory, { force: true, recursive: true });
    }
  }
});

test("reservation FORCE postflight binds a clean commit and fresh 0600 evidence", () => {
  assert.deepEqual(
    assertCheckoutStockReservationForcePostflightGitState(
      { head: RELEASE_COMMIT, status: "" },
      RELEASE_COMMIT,
    ),
    { clean: true, head: RELEASE_COMMIT },
  );
  assert.throws(
    () => assertCheckoutStockReservationForcePostflightGitState(
      { head: RELEASE_COMMIT, status: "?? residue" },
      RELEASE_COMMIT,
    ),
    /exact clean release commit/,
  );
  assert.throws(
    () => assertCheckoutStockReservationForcePostflightGitState(
      { head: "e".repeat(40), status: "" },
      RELEASE_COMMIT,
    ),
    /exact clean release commit/,
  );

  const directory = temporaryDirectory("reservation-force-evidence-");
  try {
    const pathname = path.join(directory, "evidence.json");
    writeCheckoutStockReservationForcePostflightEvidence(pathname, {
      status: "passed",
      productionChangedByPostflight: false,
    });
    assert.equal(fs.statSync(pathname).mode & 0o777, 0o600);
    assert.throws(
      () => writeCheckoutStockReservationForcePostflightEvidence(pathname, {}),
      /EEXIST/,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test("reservation FORCE postflight is read-only, FORCE-exact and sanitized", () => {
  const script = fs.readFileSync(
    "scripts/checkout-stock-reservation-force-production-postflight.mjs",
    "utf8",
  );
  assert.match(script, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(script, /current_setting\('transaction_isolation'\)/);
  assert.match(script, /current_setting\('transaction_read_only'\)/);
  assert.match(
    script,
    /verifyCheckoutStockReservationActivatedCatalog\(\s*client,\s*"neondb_owner",\s*true,/,
  );
  assert.match(script, /direct table read/);
  assert.match(script, /private helper execution/);
  assert.match(script, /fixed write read-only fence/);
  assert.match(script, /"42501"/);
  assert.match(script, /"25006"/);
  assert.match(script, /await client\.query\("ROLLBACK"\)/);
  assert.doesNotMatch(script, /SET\s+(?:LOCAL\s+)?ROLE/i);
  assert.doesNotMatch(
    script,
    /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|FROM|public\.)/i,
  );
  assert.match(script, /databaseUrlSha256/);
  assert.doesNotMatch(
    script,
    /target:\s*Object\.freeze\(\{[\s\S]*databaseUrl,/,
  );
  assert.match(script, /rlsEnabled: true/);
  assert.match(script, /rlsForced: true/);
  assert.match(script, /productionChangedByPostflight: false/);

  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts?.["ops:checkout-stock-reservation-force-postflight"],
    "node scripts/checkout-stock-reservation-force-production-postflight.mjs",
  );
});

test("reservation FORCE postflight is durably linked from operator records", () => {
  const runbook = fs.readFileSync("docs/runbook.md", "utf8");
  const launchChecklist = fs.readFileSync("docs/launch-checklist.md", "utf8");
  const wiring = fs.readFileSync(
    "docs/checkout-stock-reservation-force-production-wiring.md",
    "utf8",
  );
  for (const document of [runbook, launchChecklist, wiring]) {
    assert.match(document, /ops:checkout-stock-reservation-force-postflight/);
    assert.match(
      document,
      /verify-production-checkout-stock-reservation-force-runtime-read-only/,
    );
  }
});
