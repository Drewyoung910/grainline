import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDER_PAYMENT_EVENT_DIRECT_FUNCTION_IDENTITIES,
  orderPaymentEventActivationFunctionCatalog,
} from "../scripts/order-payment-event-activation-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
  ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION_SHA256,
} from "../scripts/order-payment-event-activation-identity.mjs";
import {
  ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
  ORDER_PAYMENT_EVENT_FORCE_MIGRATION_SHA256,
} from "../scripts/stage-order-payment-event-force-migration.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_RELEASE,
  FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
} from "../scripts/verify-direct-upload-activation-release.mjs";
import {
  LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
  LISTING_VARIANTS_REVIEWED_MIGRATION,
} from "../scripts/direct-upload-activation-failure-inspect.mjs";
import {
  SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
  SCHEMA_NUMERIC_GUARDS_MIGRATION,
} from "../scripts/verify-seller-payout-event-authority-production-scope.mjs";
import {
  ORDER_PAYMENT_EVENT_FORCE_LEDGER_QUERY,
  assertOrderPaymentEventForceProductionScope,
  parseOrderPaymentEventForceScopeEnvironment,
  readOrderPaymentEventForceMigrationCatalog,
} from "../scripts/verify-order-payment-event-force-production-scope.mjs";

function applied(migration_name, checksum) {
  return {
    migration_name,
    checksum,
    finished_at: new Date("2026-08-31T00:00:00.000Z"),
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

function rolledBack(migration_name, checksum) {
  return {
    migration_name,
    checksum,
    finished_at: null,
    rolled_back_at: new Date("2026-08-31T00:00:00.000Z"),
    applied_steps_count: 0,
  };
}

function reviewedRows(catalog) {
  const predecessor = catalog.slice(0, -1);
  const checksums = new Map(
    predecessor.map((entry) => [entry.migration_name, entry.checksum]),
  );
  const rows = predecessor.map((entry) => applied(
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

function orderPaymentEvent(force) {
  const functions = orderPaymentEventActivationFunctionCatalog().map(
    (entry) => ({
      identity: entry.identity,
      owner_name: "neondb_owner",
      function_kind: "f",
      language_name: entry.language,
      volatility: entry.volatility,
      parallel_safety: entry.parallelSafety,
      security_definer: entry.securityDefiner,
      leakproof: false,
      config: ["search_path=pg_catalog"],
      source_md5: entry.sourceMd5,
      runtime_can_execute: entry.runtimeAfter,
      public_can_execute: false,
      invalid_acl_count: 0,
    }),
  );
  return {
    ledgerRows: [applied(
      ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
      ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION_SHA256,
    )],
    table: {
      owner_name: "neondb_owner",
      rls_enabled: true,
      rls_forced: force,
      policy_count: 0,
      runtime_can_select: false,
      runtime_can_insert: false,
      runtime_can_update: false,
      runtime_can_delete: false,
      public_has_crud: false,
      invalid_table_acl_count: 0,
      column_acl_count: 0,
      validated_constraint_count: 6,
      required_index_count: 7,
      required_trigger_count: 7,
      order_payment_event_trigger_count: 4,
      invalid_row_count: 0,
    },
    functions,
    unexpectedNamedFunctionCount: 0,
    directFunctionCount: ORDER_PAYMENT_EVENT_DIRECT_FUNCTION_IDENTITIES.length,
    reviewedDirectFunctionCount:
      ORDER_PAYMENT_EVENT_DIRECT_FUNCTION_IDENTITIES.length,
  };
}

test("FORCE catalog appends exactly one byte-pinned posture migration", () => {
  const catalog = readOrderPaymentEventForceMigrationCatalog();
  assert.equal(catalog.at(-1).migration_name, ORDER_PAYMENT_EVENT_FORCE_MIGRATION);
  assert.equal(catalog.at(-1).checksum, ORDER_PAYMENT_EVENT_FORCE_MIGRATION_SHA256);
  assert.equal(
    catalog.filter(
      (entry) => entry.migration_name === ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
    ).length,
    1,
  );
});

test("FORCE scope accepts exact Phase A before and exact FORCE after", () => {
  const catalog = readOrderPaymentEventForceMigrationCatalog();
  const before = {
    ledgerRows: reviewedRows(catalog),
    orderPaymentEvent: orderPaymentEvent(false),
  };
  const after = {
    ledgerRows: [
      ...before.ledgerRows,
      applied(
        ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
        ORDER_PAYMENT_EVENT_FORCE_MIGRATION_SHA256,
      ),
    ],
    orderPaymentEvent: orderPaymentEvent(true),
  };
  assert.equal(
    assertOrderPaymentEventForceProductionScope(
      before,
      "before",
      { catalog },
    ).state,
    "phase-a-accepted",
  );
  assert.equal(
    assertOrderPaymentEventForceProductionScope(
      after,
      "after",
      { catalog },
    ).state,
    "force-hardened",
  );
  assert.equal(
    assertOrderPaymentEventForceProductionScope(
      after,
      "restart",
      { catalog },
    ).orderPaymentEventRlsForced,
    true,
  );
});

test("FORCE scope rejects checksum, posture, duplicate and predecessor drift", () => {
  const catalog = readOrderPaymentEventForceMigrationCatalog();
  const valid = {
    ledgerRows: [
      ...reviewedRows(catalog),
      applied(
        ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
        ORDER_PAYMENT_EVENT_FORCE_MIGRATION_SHA256,
      ),
    ],
    orderPaymentEvent: orderPaymentEvent(true),
  };
  const forceIndex = valid.ledgerRows.findIndex(
    (row) => row.migration_name === ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
  );
  const checksum = structuredClone(valid);
  checksum.ledgerRows[forceIndex].checksum = "0".repeat(64);
  const duplicate = structuredClone(valid);
  duplicate.ledgerRows.push(valid.ledgerRows[forceIndex]);
  const posture = structuredClone(valid);
  posture.orderPaymentEvent.table.rls_forced = false;
  const missing = structuredClone(valid);
  missing.ledgerRows = missing.ledgerRows.filter(
    (row) => row.migration_name !== ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
  );
  const unknownSuccessor = structuredClone(valid);
  unknownSuccessor.ledgerRows.push(applied(
    "99999999999999_unreviewed_successor",
    "f".repeat(64),
  ));
  for (const snapshot of [
    checksum,
    duplicate,
    posture,
    missing,
    unknownSuccessor,
  ]) {
    assert.throws(
      () => assertOrderPaymentEventForceProductionScope(
        snapshot,
        "after",
        { catalog },
      ),
    );
  }
});

test("FORCE production reader inspects the complete migration ledger", () => {
  assert.match(
    ORDER_PAYMENT_EVENT_FORCE_LEDGER_QUERY,
    /FROM public\._prisma_migrations[\s\S]*ORDER BY migration_name, started_at, id/u,
  );
  assert.doesNotMatch(
    ORDER_PAYMENT_EVENT_FORCE_LEDGER_QUERY,
    /\bWHERE\s+migration_name\b/iu,
  );
});

test("FORCE scope environment rejects missing and invalid stage before URLs", () => {
  assert.throws(() => parseOrderPaymentEventForceScopeEnvironment({}), /required/u);
  assert.throws(
    () => parseOrderPaymentEventForceScopeEnvironment({
      ORDER_PAYMENT_EVENT_FORCE_SCOPE_STAGE: "partial",
    }),
    /stage is invalid/u,
  );
});
