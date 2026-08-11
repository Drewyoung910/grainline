import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_CONFIRMATION,
  parseCheckoutStockReservationForcePostflightConfig,
} from "../scripts/checkout-stock-reservation-force-production-postflight.mjs";

const RELEASE_COMMIT = "b".repeat(40);
const RUNTIME_URL =
  "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function environment(directory) {
  return {
    DATABASE_URL: RUNTIME_URL,
    CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_CONFIRM:
      CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_CONFIRMATION,
    CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `checkout-stock-reservation-force-production-postflight-${RELEASE_COMMIT}.json`,
    ),
    CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_MAIN_CI_RUN_ID: "31234567900",
    CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_MIGRATION_RUN_ID:
      "31234567901",
    CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_RELEASE_COMMIT: RELEASE_COMMIT,
  };
}

test("FORCE postflight accepts only the exact pooled runtime configuration", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "reservation-force-postflight-"),
  );
  const parsed = parseCheckoutStockReservationForcePostflightConfig(
    environment(directory),
  );
  assert.equal(parsed.releaseCommit, RELEASE_COMMIT);
  assert.equal(parsed.runtimeIdentity.runtimeRole, "grainline_app_runtime");
  assert.equal(parsed.runtimeIdentity.endpointId, "ep-plain-river-aaqg8gj4");
  assert.equal(parsed.runtimeIdentity.databaseName, "neondb");

  assert.throws(
    () => parseCheckoutStockReservationForcePostflightConfig({
      ...environment(directory),
      DIRECT_URL: RUNTIME_URL.replace("grainline_app_runtime", "neondb_owner"),
    }),
    /privileged database keys/,
  );
  assert.throws(
    () => parseCheckoutStockReservationForcePostflightConfig({
      ...environment(directory),
      DATABASE_URL: RUNTIME_URL.replace("-pooler", ""),
    }),
    /pooled Neon endpoint/,
  );
  assert.throws(
    () => parseCheckoutStockReservationForcePostflightConfig({
      ...environment(directory),
      CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_CONFIRM:
        "wrong-confirmation",
    }),
    /confirmation is invalid/,
  );
});

test("FORCE postflight delegates only expected FORCE through the strict read-only runner", () => {
  const forceScript = fs.readFileSync(
    "scripts/checkout-stock-reservation-force-production-postflight.mjs",
    "utf8",
  );
  const sharedScript = fs.readFileSync(
    "scripts/checkout-stock-reservation-activation-production-postflight.mjs",
    "utf8",
  );
  assert.match(forceScript, /expectedForced: true/);
  assert.match(
    forceScript,
    /checkout-stock-reservation-force-production-postflight/,
  );
  assert.doesNotMatch(forceScript, /SET\s+(?:LOCAL\s+)?ROLE/i);
  assert.match(
    sharedScript,
    /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/,
  );
  assert.match(sharedScript, /CURRENT_USER AS current_user_name/);
  assert.match(sharedScript, /SESSION_USER AS session_user_name/);
  assert.match(
    sharedScript,
    /verifyCheckoutStockReservationActivatedCatalog\([\s\S]*expectedForced/,
  );
  assert.match(sharedScript, /rlsForced: expectedForced/);
  assert.match(sharedScript, /fixed write read-only fence/);
  assert.match(sharedScript, /productionChangedByPostflight: false/);
  assert.doesNotMatch(
    sharedScript,
    /target:\s*Object\.freeze\(\{[\s\S]*databaseUrl,/,
  );
});
