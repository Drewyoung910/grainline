import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
  LISTING_VARIANTS_REVIEWED_MIGRATION,
} from "../scripts/direct-upload-activation-failure-inspect.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_RELEASE,
  FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
} from "../scripts/verify-direct-upload-activation-release.mjs";
import {
  SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
  SCHEMA_NUMERIC_GUARDS_MIGRATION,
} from "../scripts/verify-checkout-stock-reservation-authority-production-scope.mjs";
import {
  assertReservationForceProductionScope,
  parseReservationForceScopeEnvironment,
  readReservationForceMigrationCatalog,
  verifyReservationForceProductionScope,
} from "../scripts/verify-checkout-stock-reservation-force-production-scope.mjs";

const URL = "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const catalog = readReservationForceMigrationCatalog();
const force = catalog.at(-1);

const applied = (migrationName, checksum) => ({
  migration_name: migrationName,
  checksum,
  finished_at: new Date("2026-08-15T20:00:00.000Z"),
  rolled_back_at: null,
  applied_steps_count: 1,
});
const rolledBack = (migrationName, checksum) => ({
  migration_name: migrationName,
  checksum,
  finished_at: null,
  rolled_back_at: new Date("2026-08-15T20:00:00.000Z"),
  applied_steps_count: 0,
});

function reviewedActivationRows() {
  const rows = catalog.slice(0, -1).map((entry) => applied(
    entry.migration_name,
    entry.migration_name === SCHEMA_NUMERIC_GUARDS_MIGRATION
      ? SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256
      : entry.checksum,
  ));
  const listingChecksum = catalog.find(
    (entry) => entry.migration_name === LISTING_VARIANTS_REVIEWED_MIGRATION,
  )?.checksum;
  rows.push(rolledBack(
    LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
    listingChecksum,
  ));
  rows.push(rolledBack(
    DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
    FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
  ));
  return rows;
}

const predecessor = reviewedActivationRows();
const accepted = [...predecessor, applied(force.migration_name, force.checksum)];

test("FORCE scope parser accepts only manual main and the direct owner", () => {
  const env = {
    DIRECT_URL: URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    CHECKOUT_STOCK_RESERVATION_FORCE_SCOPE_STAGE: "after",
  };
  assert.equal(
    parseReservationForceScopeEnvironment(env).identity.username,
    "neondb_owner",
  );
  for (const drift of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/feature" },
    { DIRECT_URL: URL.replace("neondb_owner", "grainline_app_runtime") },
    { DIRECT_URL: URL.replace(".westus3", "-pooler.westus3") },
    { CHECKOUT_STOCK_RESERVATION_FORCE_SCOPE_STAGE: "during" },
  ]) {
    assert.throws(() => parseReservationForceScopeEnvironment({
      ...env,
      ...drift,
    }));
  }
});

test("scope accepts only exact activated and force-hardened restart states", async () => {
  assert.deepEqual(
    assertReservationForceProductionScope(predecessor, "before", catalog),
    {
      reservationAuthorityApplied: true,
      sourceConsistencyApplied: true,
      reservationActivationApplied: true,
      reservationForceApplied: false,
      reviewedMigrationCount: catalog.length,
      historicalLedgerExceptionCount: 3,
      state: "activated",
      productionChangedByProof: false,
    },
  );
  assert.deepEqual(
    assertReservationForceProductionScope(accepted, "after", catalog),
    {
      reservationAuthorityApplied: true,
      sourceConsistencyApplied: true,
      reservationActivationApplied: true,
      reservationForceApplied: true,
      reviewedMigrationCount: catalog.length,
      historicalLedgerExceptionCount: 3,
      state: "force-hardened",
      productionChangedByProof: false,
    },
  );
  assert.equal(
    assertReservationForceProductionScope(predecessor, "restart", catalog).state,
    "activated",
  );
  assert.equal(
    assertReservationForceProductionScope(accepted, "restart", catalog).state,
    "force-hardened",
  );

  const verified = await verifyReservationForceProductionScope(
    { directUrl: URL, stage: "after" },
    {
      readRows: async (url) => (assert.equal(url, URL), accepted),
      readCatalog: () => catalog,
    },
  );
  assert.equal(verified.reservationForceApplied, true);
});

test("scope rejects partial, duplicate, drifting, unknown, and out-of-stage rows", () => {
  const forceRow = accepted.at(-1);
  for (const rows of [
    [],
    predecessor.slice(1),
    [...predecessor, { ...forceRow, checksum: "f".repeat(64) }],
    [...predecessor, { ...forceRow, finished_at: null }],
    [...predecessor, { ...forceRow, rolled_back_at: new Date() }],
    [...predecessor, { ...forceRow, applied_steps_count: 0 }],
    [...accepted, forceRow],
    [...accepted, applied("20260815060002_unreviewed", "e".repeat(64))],
  ]) {
    for (const stage of ["after", "restart"]) {
      assert.throws(() => assertReservationForceProductionScope(
        rows,
        stage,
        catalog,
      ));
    }
  }
  assert.throws(() => assertReservationForceProductionScope(
    accepted,
    "before",
    catalog,
  ));
  assert.throws(() => assertReservationForceProductionScope(
    predecessor,
    "after",
    catalog,
  ));
  assert.throws(() => assertReservationForceProductionScope(
    accepted,
    "during",
    catalog,
  ));
});

test("scope catalog seals activation plus one exact FORCE migration", () => {
  assert.ok(catalog.length > 190);
  assert.equal(
    catalog.at(-2)?.migration_name,
    "20260815060000_enable_checkout_stock_reservation_rls",
  );
  assert.equal(
    force.migration_name,
    "20260815060001_force_checkout_stock_reservation_rls",
  );
  assert.equal(
    force.checksum,
    "cfa05295bd469903aa967919a0178312dbbc855203c408db2395602589f5178d",
  );
});

test("FORCE scope reuses the engine-attested read-only ledger reader", () => {
  const source = fs.readFileSync(
    "scripts/verify-checkout-stock-reservation-authority-production-scope.mjs",
    "utf8",
  );
  assert.match(source, /BEGIN TRANSACTION READ ONLY/u);
  assert.match(source, /transaction_read_only/u);
  assert.match(source, /ROLLBACK/u);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu);
});

test("FORCE production scope has an explicit package entrypoint", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts["audit:rls-checkout-stock-reservation-force-production-scope"],
    "node scripts/verify-checkout-stock-reservation-force-production-scope.mjs",
  );
});
