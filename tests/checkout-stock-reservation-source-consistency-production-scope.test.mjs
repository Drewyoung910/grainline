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
  assertReservationSourceConsistencyProductionScope,
  parseReservationSourceConsistencyScopeEnvironment,
  readReservationSourceConsistencyMigrationCatalog,
  verifyReservationSourceConsistencyProductionScope,
} from "../scripts/verify-checkout-stock-reservation-source-consistency-production-scope.mjs";

const URL = "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const catalog = readReservationSourceConsistencyMigrationCatalog();
const sourceConsistency = catalog.at(-1);

const applied = (migrationName, checksum) => ({
  migration_name: migrationName,
  checksum,
  finished_at: new Date("2026-08-14T06:00:00.000Z"),
  rolled_back_at: null,
  applied_steps_count: 1,
});
const rolledBack = (migrationName, checksum) => ({
  migration_name: migrationName,
  checksum,
  finished_at: null,
  rolled_back_at: new Date("2026-08-14T06:00:00.000Z"),
  applied_steps_count: 0,
});

function reviewedAuthorityRows() {
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

const predecessor = reviewedAuthorityRows();
const accepted = [
  ...predecessor,
  applied(sourceConsistency.migration_name, sourceConsistency.checksum),
];

test("source-consistency scope parser accepts only manual main and the direct owner", () => {
  const env = {
    DIRECT_URL: URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_SCOPE_STAGE: "after",
  };
  assert.equal(
    parseReservationSourceConsistencyScopeEnvironment(env).identity.username,
    "neondb_owner",
  );
  for (const drift of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/feature" },
    { DIRECT_URL: URL.replace("neondb_owner", "grainline_app_runtime") },
    { DIRECT_URL: URL.replace(".westus3", "-pooler.westus3") },
    { CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_SCOPE_STAGE: "during" },
  ]) {
    assert.throws(() => parseReservationSourceConsistencyScopeEnvironment({
      ...env,
      ...drift,
    }));
  }
});

test("scope accepts only the reviewed authority predecessor and exact source migration", async () => {
  assert.deepEqual(
    assertReservationSourceConsistencyProductionScope(
      predecessor,
      "before",
      catalog,
    ),
    {
      reservationAuthorityApplied: true,
      sourceConsistencyApplied: false,
      reservationActivationRows: 0,
      reservationForceRows: 0,
      reviewedMigrationCount: catalog.length,
      historicalLedgerExceptionCount: 3,
      state: "authority-prepared",
      productionChangedByProof: false,
    },
  );
  assert.deepEqual(
    assertReservationSourceConsistencyProductionScope(
      accepted,
      "after",
      catalog,
    ),
    {
      reservationAuthorityApplied: true,
      sourceConsistencyApplied: true,
      reservationActivationRows: 0,
      reservationForceRows: 0,
      reviewedMigrationCount: catalog.length,
      historicalLedgerExceptionCount: 3,
      state: "source-consistent",
      productionChangedByProof: false,
    },
  );
  assert.equal(
    assertReservationSourceConsistencyProductionScope(
      predecessor,
      "restart",
      catalog,
    ).state,
    "authority-prepared",
  );
  assert.equal(
    assertReservationSourceConsistencyProductionScope(
      accepted,
      "restart",
      catalog,
    ).state,
    "source-consistent",
  );

  const verified = await verifyReservationSourceConsistencyProductionScope(
    { directUrl: URL, stage: "after" },
    {
      readRows: async (url) => (assert.equal(url, URL), accepted),
      readCatalog: () => catalog,
    },
  );
  assert.equal(verified.sourceConsistencyApplied, true);
});

test("scope rejects partial, duplicate, drifting, unknown, and out-of-stage rows", () => {
  const sourceRow = accepted.at(-1);
  for (const rows of [
    [],
    predecessor.slice(1),
    [...predecessor, { ...sourceRow, checksum: "f".repeat(64) }],
    [...predecessor, { ...sourceRow, finished_at: null }],
    [...predecessor, { ...sourceRow, rolled_back_at: new Date() }],
    [...predecessor, { ...sourceRow, applied_steps_count: 0 }],
    [...accepted, sourceRow],
    [...accepted, applied("20260814053001_unreviewed", "e".repeat(64))],
  ]) {
    assert.throws(() => assertReservationSourceConsistencyProductionScope(
      rows,
      "after",
      catalog,
    ));
  }
  assert.throws(() => assertReservationSourceConsistencyProductionScope(
    accepted,
    "before",
    catalog,
  ));
  assert.throws(() => assertReservationSourceConsistencyProductionScope(
    predecessor,
    "after",
    catalog,
  ));
  assert.throws(() => assertReservationSourceConsistencyProductionScope(
    accepted,
    "during",
    catalog,
  ));
});

test("scope catalog seals the authority prefix plus one exact additive migration", () => {
  assert.ok(catalog.length > 190);
  assert.equal(
    catalog.at(-2)?.migration_name,
    "20260810190000_prepare_checkout_stock_reservation_authority",
  );
  assert.equal(
    sourceConsistency.migration_name,
    "20260814053000_prepare_checkout_stock_reservation_source_consistency",
  );
  assert.match(sourceConsistency.checksum, /^[0-9a-f]{64}$/u);
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
