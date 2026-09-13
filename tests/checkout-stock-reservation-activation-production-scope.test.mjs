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
  assertReservationActivationProductionScope,
  parseReservationActivationScopeEnvironment,
  readReservationActivationMigrationCatalog,
  verifyReservationActivationProductionScope,
} from "../scripts/verify-checkout-stock-reservation-activation-production-scope.mjs";
import { repositoryBeforeRefundReconciliation } from "./helpers/release-verifier-root.mjs";

const URL = "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const catalog = readReservationActivationMigrationCatalog(
  repositoryBeforeRefundReconciliation(),
);
const activation = catalog.at(-1);

const applied = (migrationName, checksum) => ({
  migration_name: migrationName,
  checksum,
  finished_at: new Date("2026-08-15T06:00:00.000Z"),
  rolled_back_at: null,
  applied_steps_count: 1,
});
const rolledBack = (migrationName, checksum) => ({
  migration_name: migrationName,
  checksum,
  finished_at: null,
  rolled_back_at: new Date("2026-08-15T06:00:00.000Z"),
  applied_steps_count: 0,
});

function reviewedSourceConsistencyRows() {
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

const predecessor = reviewedSourceConsistencyRows();
const accepted = [
  ...predecessor,
  applied(activation.migration_name, activation.checksum),
];

test("activation scope parser accepts only manual main and the direct owner", () => {
  const env = {
    DIRECT_URL: URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_SCOPE_STAGE: "after",
  };
  assert.equal(
    parseReservationActivationScopeEnvironment(env).identity.username,
    "neondb_owner",
  );
  for (const drift of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/feature" },
    { DIRECT_URL: URL.replace("neondb_owner", "grainline_app_runtime") },
    { DIRECT_URL: URL.replace(".westus3", "-pooler.westus3") },
    { CHECKOUT_STOCK_RESERVATION_ACTIVATION_SCOPE_STAGE: "during" },
  ]) {
    assert.throws(() => parseReservationActivationScopeEnvironment({
      ...env,
      ...drift,
    }));
  }
});

test("scope accepts only the exact source-consistent predecessor and activation", async () => {
  assert.deepEqual(
    assertReservationActivationProductionScope(predecessor, "before", catalog),
    {
      reservationAuthorityApplied: true,
      sourceConsistencyApplied: true,
      reservationActivationApplied: false,
      reservationForceRows: 0,
      reviewedMigrationCount: catalog.length,
      historicalLedgerExceptionCount: 3,
      state: "source-consistent",
      productionChangedByProof: false,
    },
  );
  assert.deepEqual(
    assertReservationActivationProductionScope(accepted, "after", catalog),
    {
      reservationAuthorityApplied: true,
      sourceConsistencyApplied: true,
      reservationActivationApplied: true,
      reservationForceRows: 0,
      reviewedMigrationCount: catalog.length,
      historicalLedgerExceptionCount: 3,
      state: "activated",
      productionChangedByProof: false,
    },
  );
  assert.equal(
    assertReservationActivationProductionScope(
      predecessor,
      "restart",
      catalog,
    ).state,
    "source-consistent",
  );
  assert.equal(
    assertReservationActivationProductionScope(
      accepted,
      "restart",
      catalog,
    ).state,
    "activated",
  );

  const verified = await verifyReservationActivationProductionScope(
    { directUrl: URL, stage: "after" },
    {
      readRows: async (url) => (assert.equal(url, URL), accepted),
      readCatalog: () => catalog,
    },
  );
  assert.equal(verified.reservationActivationApplied, true);
});

test("scope rejects partial, duplicate, drifting, unknown, and out-of-stage rows", () => {
  const activationRow = accepted.at(-1);
  for (const rows of [
    [],
    predecessor.slice(1),
    [...predecessor, { ...activationRow, checksum: "f".repeat(64) }],
    [...predecessor, { ...activationRow, finished_at: null }],
    [...predecessor, { ...activationRow, rolled_back_at: new Date() }],
    [...predecessor, { ...activationRow, applied_steps_count: 0 }],
    [...accepted, activationRow],
    [...accepted, applied("20260815060001_unreviewed", "e".repeat(64))],
  ]) {
    for (const stage of ["after", "restart"]) {
      assert.throws(() => assertReservationActivationProductionScope(
        rows,
        stage,
        catalog,
      ));
    }
  }
  assert.throws(() => assertReservationActivationProductionScope(
    accepted,
    "before",
    catalog,
  ));
  assert.throws(() => assertReservationActivationProductionScope(
    predecessor,
    "after",
    catalog,
  ));
  assert.throws(() => assertReservationActivationProductionScope(
    accepted,
    "during",
    catalog,
  ));
});

test("scope catalog seals source consistency plus one exact activation", () => {
  assert.ok(catalog.length > 190);
  assert.equal(
    catalog.at(-2)?.migration_name,
    "20260814053000_prepare_checkout_stock_reservation_source_consistency",
  );
  assert.equal(
    activation.migration_name,
    "20260815060000_enable_checkout_stock_reservation_rls",
  );
  assert.equal(
    activation.checksum,
    "7940be1969c89c8bbf5818164a56afb7e8bf7925bd8a26231d8ac865fac7c519",
  );
});

test("scope reader remains engine-attested read-only", () => {
  const source = fs.readFileSync(
    "scripts/verify-checkout-stock-reservation-authority-production-scope.mjs",
    "utf8",
  );
  assert.match(source, /BEGIN TRANSACTION READ ONLY/u);
  assert.match(source, /transaction_read_only/u);
  assert.match(source, /ROLLBACK/u);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu);
});

test("activation production scope has an explicit package entrypoint", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts["audit:rls-checkout-stock-reservation-activation-production-scope"],
    "node scripts/verify-checkout-stock-reservation-activation-production-scope.mjs",
  );
});
