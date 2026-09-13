import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CHECKOUT_STOCK_RESERVATION_ACTIVATION_POSTFLIGHT_CONFIRMATION,
  assertCheckoutStockReservationActivationPostflightGitState,
  parseCheckoutStockReservationActivationPostflightConfig,
  writeCheckoutStockReservationActivationPostflightEvidence,
} from "../scripts/checkout-stock-reservation-activation-production-postflight.mjs";

const RELEASE_COMMIT = "a".repeat(40);
const RUNTIME_URL =
  "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function environment(directory) {
  return {
    DATABASE_URL: RUNTIME_URL,
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_POSTFLIGHT_CONFIRM:
      CHECKOUT_STOCK_RESERVATION_ACTIVATION_POSTFLIGHT_CONFIRMATION,
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `checkout-stock-reservation-activation-production-postflight-${RELEASE_COMMIT}.json`,
    ),
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_POSTFLIGHT_MAIN_CI_RUN_ID:
      "31234567890",
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_POSTFLIGHT_MIGRATION_RUN_ID:
      "31234567891",
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_POSTFLIGHT_RELEASE_COMMIT:
      RELEASE_COMMIT,
  };
}

test("reservation postflight config accepts only the pooled production runtime", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "reservation-postflight-"),
  );
  const parsed = parseCheckoutStockReservationActivationPostflightConfig(
    environment(directory),
  );
  assert.equal(parsed.releaseCommit, RELEASE_COMMIT);
  assert.equal(parsed.runtimeIdentity.runtimeRole, "grainline_app_runtime");
  assert.equal(parsed.runtimeIdentity.endpointId, "ep-plain-river-aaqg8gj4");
  assert.equal(parsed.runtimeIdentity.region, "westus3.azure");
  assert.equal(parsed.runtimeIdentity.databaseName, "neondb");

  assert.throws(
    () => parseCheckoutStockReservationActivationPostflightConfig({
      ...environment(directory),
      DIRECT_URL: RUNTIME_URL.replace(
        "grainline_app_runtime",
        "neondb_owner",
      ),
    }),
    /privileged database keys/,
  );
  assert.throws(
    () => parseCheckoutStockReservationActivationPostflightConfig({
      ...environment(directory),
      OTHER_DATABASE_URL: RUNTIME_URL,
    }),
    /aliased PostgreSQL URLs/,
  );
  assert.throws(
    () => parseCheckoutStockReservationActivationPostflightConfig({
      ...environment(directory),
      DATABASE_URL: RUNTIME_URL.replace("-pooler", ""),
    }),
    /pooled Neon endpoint/,
  );
  assert.throws(
    () => parseCheckoutStockReservationActivationPostflightConfig({
      ...environment(directory),
      DATABASE_URL: RUNTIME_URL.replace(
        "ep-plain-river-aaqg8gj4",
        "ep-wrong",
      ),
    }),
    /does not match the reviewed runtime identity/,
  );
});

test("reservation postflight binds an exact commit and fresh 0600 evidence", () => {
  assert.deepEqual(
    assertCheckoutStockReservationActivationPostflightGitState(
      { head: RELEASE_COMMIT, status: "" },
      RELEASE_COMMIT,
    ),
    { clean: true, head: RELEASE_COMMIT },
  );
  assert.throws(
    () => assertCheckoutStockReservationActivationPostflightGitState(
      { head: RELEASE_COMMIT, status: "?? residue" },
      RELEASE_COMMIT,
    ),
    /exact clean release commit/,
  );

  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "reservation-evidence-"),
  );
  const pathname = path.join(directory, "evidence.json");
  writeCheckoutStockReservationActivationPostflightEvidence(pathname, {
    status: "passed",
    productionChangedByPostflight: false,
  });
  assert.equal(fs.statSync(pathname).mode & 0o777, 0o600);
  assert.throws(
    () => writeCheckoutStockReservationActivationPostflightEvidence(
      pathname,
      {},
    ),
    /EEXIST/,
  );
});

test("reservation postflight is read-only, actual-role, exact-catalog and sanitized", () => {
  const script = fs.readFileSync(
    "scripts/checkout-stock-reservation-activation-production-postflight.mjs",
    "utf8",
  );
  assert.match(script, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(script, /FROM unnest\(\$1::text\[\], \$2::text\[\]\)/);
  assert.match(
    script,
    /expected\.identity_arguments\s*=\s*pg_catalog\.oidvectortypes\(procedure\.proargtypes\)/,
  );
  assert.doesNotMatch(script, /procedure\.proname = ANY\(/);
  assert.match(script, /CURRENT_USER AS current_user_name/);
  assert.match(script, /SESSION_USER AS session_user_name/);
  assert.doesNotMatch(script, /SET\s+(?:LOCAL\s+)?ROLE/i);
  assert.match(script, /direct table read/);
  assert.match(script, /private helper execution/);
  assert.match(script, /fixed write read-only fence/);
  assert.match(script, /"25006"/);
  assert.match(script, /databaseUrlSha256/);
  assert.doesNotMatch(
    script,
    /target:\s*Object\.freeze\(\{[\s\S]*databaseUrl,/,
  );
  assert.match(script, /productionChangedByPostflight: false/);
});
