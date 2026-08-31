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
  SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS,
  assertSellerPayoutEventForceReviewedSuccessorScope,
  assertSellerPayoutEventForceProductionScope,
  parseSellerPayoutEventForceScopeEnvironment,
  readSellerPayoutEventForceMigrationCatalog,
  readSellerPayoutEventForceSealedPrefixCatalog,
  verifySellerPayoutEventForceProductionScope,
} from "../scripts/verify-seller-payout-event-force-production-scope.mjs";
import { repositoryBeforeRefundReconciliation } from "./helpers/release-verifier-root.mjs";

const historicalRoot = repositoryBeforeRefundReconciliation();
const URL = "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

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
  const env = {
    DIRECT_URL: URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    SELLER_PAYOUT_EVENT_FORCE_SCOPE_STAGE: "restart",
    SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSOR_STAGE:
      "before-order-payment-event-activation",
  };
  assert.equal(
    parseSellerPayoutEventForceScopeEnvironment(env).reviewedSuccessorStage,
    "before-order-payment-event-activation",
  );
  assert.throws(
    () => parseSellerPayoutEventForceScopeEnvironment({
      ...env,
      SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSOR_STAGE: "partial",
    }),
    /reviewed successor stage is invalid/u,
  );
});

test("reviewed successor catalog uses the fixed complete activation chain", () => {
  const forceCatalog = readSellerPayoutEventForceSealedPrefixCatalog();
  assert.equal(
    forceCatalog.at(-1).migration_name,
    SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
  );
  assert.equal(SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS.length, 14);
  assert.deepEqual(
    SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS.map(
      (entry) => entry.migration_name,
    ),
    [...SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS]
      .map((entry) => entry.migration_name)
      .sort(),
  );
  assert.match(
    SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS.at(-1).migration_name,
    /enable_order_payment_event_rls$/u,
  );
});

test("reviewed successor scope validates every exact row before and after activation", () => {
  const forceCatalog = readSellerPayoutEventForceSealedPrefixCatalog();
  const rows = [
    ...reviewedActivatedRows(forceCatalog),
    applied(
      SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
      SELLER_PAYOUT_EVENT_FORCE_MIGRATION_SHA256,
    ),
    ...SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS.slice(0, -1).map(
      (entry) => applied(entry.migration_name, entry.checksum),
    ),
  ];
  assert.equal(
    assertSellerPayoutEventForceReviewedSuccessorScope(
      rows,
      "before-order-payment-event-activation",
      { forceCatalog },
    ).orderPaymentEventActivationApplied,
    false,
  );
  const target = SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS.at(-1);
  const after = [...rows, applied(target.migration_name, target.checksum)];
  assert.equal(
    assertSellerPayoutEventForceReviewedSuccessorScope(
      after,
      "after-order-payment-event-activation",
      { forceCatalog },
    ).orderPaymentEventActivationApplied,
    true,
  );

  const required = SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS[4];
  const missing = after.filter(
    (row) => row.migration_name !== required.migration_name,
  );
  const drifted = after.map((row) =>
    row.migration_name === required.migration_name
      ? { ...row, checksum: "0".repeat(64) }
      : row
  );
  const rolledBackSuccessor = after.map((row) =>
    row.migration_name === required.migration_name
      ? { ...row, finished_at: null, rolled_back_at: new Date(), applied_steps_count: 0 }
      : row
  );
  const duplicate = [
    ...after,
    applied(required.migration_name, required.checksum),
  ];
  const unknown = [
    ...after,
    applied("20260830025000_unreviewed", "1".repeat(64)),
  ];
  for (const invalid of [missing, drifted, rolledBackSuccessor, duplicate, unknown]) {
    assert.throws(
      () => assertSellerPayoutEventForceReviewedSuccessorScope(
        invalid,
        "after-order-payment-event-activation",
        { forceCatalog },
      ),
    );
  }
  assert.throws(
    () => assertSellerPayoutEventForceReviewedSuccessorScope(
      after,
      "before-order-payment-event-activation",
      { forceCatalog },
    ),
    /successor drifted/u,
  );
  assert.throws(
    () => assertSellerPayoutEventForceReviewedSuccessorScope(
      after,
      "after-order-payment-event-activation",
      {
        forceCatalog,
        successors: [
          ...SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS.slice(1),
          SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS[0],
        ],
      },
    ),
    /exact reviewed successor scope|malformed reviewed successors/u,
  );
});

test("production verifier selects the exact fixed successor mode explicitly", async () => {
  const forceCatalog = readSellerPayoutEventForceSealedPrefixCatalog();
  const rows = [
    ...reviewedActivatedRows(forceCatalog),
    applied(
      SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
      SELLER_PAYOUT_EVENT_FORCE_MIGRATION_SHA256,
    ),
    ...SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS.slice(0, -1).map(
      (entry) => applied(entry.migration_name, entry.checksum),
    ),
  ];
  let legacyCatalogRead = false;
  const result = await verifySellerPayoutEventForceProductionScope(
    {
      directUrl: "unused",
      stage: "restart",
      reviewedSuccessorStage: "before-order-payment-event-activation",
    },
    {
      readSnapshot: async () => ({ ledgerRows: rows }),
      readCatalog: () => {
        legacyCatalogRead = true;
        throw new Error("legacy catalog must not be used");
      },
      readSealedPrefixCatalog: () => forceCatalog,
    },
  );
  assert.equal(legacyCatalogRead, false);
  assert.equal(result.reviewedSuccessorMigrationCount, 14);
  assert.equal(result.orderPaymentEventActivationApplied, false);
});
