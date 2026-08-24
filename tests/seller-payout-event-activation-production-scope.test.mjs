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
} from "../scripts/verify-seller-payout-event-authority-production-scope.mjs";
import {
  assertSellerPayoutEventActivationProductionScope,
  parseSellerPayoutEventActivationScopeEnvironment,
  readSellerPayoutEventActivationMigrationCatalog,
  verifySellerPayoutEventActivationProductionScope,
} from "../scripts/verify-seller-payout-event-activation-production-scope.mjs";

const catalog = readSellerPayoutEventActivationMigrationCatalog(
  process.cwd(),
  {
    allowReviewedForceSuccessor: true,
    allowReviewedRefundClaimSuccessor: true,
    allowReviewedRefundRecordSuccessor: true,
  },
);
const activation = catalog.at(-1);

const applied = (migration_name, checksum) => ({
  migration_name,
  checksum,
  finished_at: "2026-08-22T18:00:00.000Z",
  rolled_back_at: null,
  applied_steps_count: 1,
});

const rolledBack = (migration_name, checksum) => ({
  migration_name,
  checksum,
  finished_at: null,
  rolled_back_at: "2026-08-22T18:00:00.000Z",
  applied_steps_count: 0,
});

function reviewedPreparedRows() {
  const predecessorCatalog = catalog.slice(0, -1);
  const checksums = new Map(
    predecessorCatalog.map((entry) => [entry.migration_name, entry.checksum]),
  );
  const rows = predecessorCatalog.map((entry) => applied(
    entry.migration_name,
    entry.migration_name === SCHEMA_NUMERIC_GUARDS_MIGRATION
      ? SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256
      : entry.checksum,
  ));
  rows.push(rolledBack(
    LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
    checksums.get(LISTING_VARIANTS_REVIEWED_MIGRATION),
  ));
  rows.push(rolledBack(
    DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
    FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
  ));
  return rows;
}

const prepared = reviewedPreparedRows();
const activated = [
  ...prepared,
  applied(activation.migration_name, activation.checksum),
];

test("activation scope parser fails closed without the manual main contract", () => {
  assert.throws(
    () => parseSellerPayoutEventActivationScopeEnvironment({}),
    /is required/u,
  );
  assert.throws(
    () => parseSellerPayoutEventActivationScopeEnvironment({
      SELLER_PAYOUT_EVENT_ACTIVATION_SCOPE_STAGE: "during",
    }),
    /must be before, after, or restart/u,
  );
});

test("scope accepts only the exact prepared and activated restart states", async () => {
  assert.deepEqual(
    assertSellerPayoutEventActivationProductionScope(
      prepared,
      "before",
      catalog,
    ),
    {
      payoutAuthorityApplied: true,
      payoutActivationApplied: false,
      payoutRlsEnabled: false,
      payoutRlsForced: false,
      policyCount: 0,
      reviewedMigrationCount: catalog.length,
      historicalLedgerExceptionCount: 3,
      state: "prepared",
      productionChangedByProof: false,
    },
  );
  assert.equal(
    assertSellerPayoutEventActivationProductionScope(
      prepared,
      "restart",
      catalog,
    ).state,
    "prepared",
  );
  assert.equal(
    assertSellerPayoutEventActivationProductionScope(
      activated,
      "restart",
      catalog,
    ).state,
    "activated",
  );
  const result = await verifySellerPayoutEventActivationProductionScope(
    { directUrl: "injected-test-target", stage: "after" },
    {
      readSnapshot: async (target) => (
        assert.equal(target, "injected-test-target"),
        { ledgerRows: activated }
      ),
      readCatalog: () => catalog,
    },
  );
  assert.equal(result.payoutActivationApplied, true);
});

test("scope rejects partial, duplicate, drifting, unknown, and out-of-stage rows", () => {
  const activationRow = activated.at(-1);
  for (const rows of [
    [],
    prepared.slice(1),
    [...prepared, { ...activationRow, checksum: "f".repeat(64) }],
    [...prepared, { ...activationRow, finished_at: null }],
    [...prepared, { ...activationRow, rolled_back_at: new Date() }],
    [...prepared, { ...activationRow, applied_steps_count: 0 }],
    [...activated, activationRow],
    [...activated, applied("20260822180001_unreviewed", "e".repeat(64))],
  ]) {
    for (const stage of ["after", "restart"]) {
      assert.throws(() => assertSellerPayoutEventActivationProductionScope(
        rows,
        stage,
        catalog,
      ));
    }
  }
  assert.throws(() => assertSellerPayoutEventActivationProductionScope(
    activated,
    "before",
    catalog,
  ));
  assert.throws(() => assertSellerPayoutEventActivationProductionScope(
    prepared,
    "after",
    catalog,
  ));
});

test("scope catalog seals one exact successor and has a package entrypoint", () => {
  assert.equal(
    activation.migration_name,
    "20260822180000_enable_seller_payout_event_rls",
  );
  assert.equal(
    activation.checksum,
    "0347a8d930631b4fbed793eec4d119d1c56adcaa2802a89c61940ef6b62fb4bc",
  );
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts["audit:rls-seller-payout-event-activation-production-scope"],
    "node scripts/verify-seller-payout-event-activation-production-scope.mjs",
  );
});
