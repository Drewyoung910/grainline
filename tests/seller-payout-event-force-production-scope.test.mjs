import assert from "node:assert/strict";
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
  SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
  SELLER_PAYOUT_EVENT_FORCE_MIGRATION_SHA256,
} from "../scripts/stage-seller-payout-event-force-migration.mjs";
import {
  SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
  SCHEMA_NUMERIC_GUARDS_MIGRATION,
} from "../scripts/verify-seller-payout-event-authority-production-scope.mjs";
import {
  assertSellerPayoutEventForceProductionScope,
  parseSellerPayoutEventForceScopeEnvironment,
  readSellerPayoutEventForceMigrationCatalog,
} from "../scripts/verify-seller-payout-event-force-production-scope.mjs";
import { repositoryBeforeRefundReconciliation } from "./helpers/release-verifier-root.mjs";

const historicalRoot = repositoryBeforeRefundReconciliation();

function applied(migration_name, checksum) {
  return {
    migration_name,
    checksum,
    finished_at: new Date("2026-08-23T00:00:00.000Z"),
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

function rolledBack(migration_name, checksum) {
  return {
    migration_name,
    checksum,
    finished_at: null,
    rolled_back_at: new Date("2026-08-23T00:00:00.000Z"),
    applied_steps_count: 0,
  };
}

function reviewedActivatedRows(catalog) {
  const activationCatalog = catalog.slice(0, -1);
  const checksums = new Map(
    activationCatalog.map((entry) => [entry.migration_name, entry.checksum]),
  );
  const rows = activationCatalog.map((entry) => applied(
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

test("FORCE catalog appends exactly one byte-pinned migration", () => {
  const catalog = readSellerPayoutEventForceMigrationCatalog(historicalRoot);
  assert.equal(catalog.at(-1).migration_name, SELLER_PAYOUT_EVENT_FORCE_MIGRATION);
  assert.equal(catalog.at(-1).checksum, SELLER_PAYOUT_EVENT_FORCE_MIGRATION_SHA256);
  assert.equal(
    catalog.filter((entry) => entry.migration_name === SELLER_PAYOUT_EVENT_FORCE_MIGRATION).length,
    1,
  );
});

test("FORCE scope accepts only absent-before or exact applied-after state", () => {
  const catalog = readSellerPayoutEventForceMigrationCatalog(historicalRoot);
  const before = reviewedActivatedRows(catalog);
  const rows = [
    ...before,
    applied(SELLER_PAYOUT_EVENT_FORCE_MIGRATION, SELLER_PAYOUT_EVENT_FORCE_MIGRATION_SHA256),
  ];
  assert.equal(
    assertSellerPayoutEventForceProductionScope(before, "before", catalog).state,
    "activated",
  );
  assert.equal(
    assertSellerPayoutEventForceProductionScope(rows, "after", catalog).state,
    "force-hardened",
  );
  assert.equal(
    assertSellerPayoutEventForceProductionScope(before, "restart", catalog).state,
    "activated",
  );
  assert.equal(
    assertSellerPayoutEventForceProductionScope(rows, "restart", catalog).state,
    "force-hardened",
  );
  assert.throws(
    () => assertSellerPayoutEventForceProductionScope(rows, "before", catalog),
    /exact payout FORCE scope/u,
  );
  assert.throws(
    () => assertSellerPayoutEventForceProductionScope(before, "after", catalog),
    /exact payout FORCE scope/u,
  );
  const drifted = rows.map((row) => row.migration_name === SELLER_PAYOUT_EVENT_FORCE_MIGRATION
    ? { ...row, checksum: "0".repeat(64) }
    : row);
  assert.throws(
    () => assertSellerPayoutEventForceProductionScope(drifted, "after", catalog),
    /exact payout FORCE scope/u,
  );
});

test("FORCE scope environment is exact and fail closed", () => {
  assert.throws(() => parseSellerPayoutEventForceScopeEnvironment({}), /required/u);
  assert.throws(
    () => parseSellerPayoutEventForceScopeEnvironment({
      SELLER_PAYOUT_EVENT_FORCE_SCOPE_STAGE: "unexpected",
    }),
    /before, after, or restart/u,
  );
});
