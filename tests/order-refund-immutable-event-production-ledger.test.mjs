import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReviewedPeerMigrationLedger,
  SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256,
  SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
  SCHEMA_NUMERIC_GUARDS_MIGRATION,
} from "../scripts/order-refund-immutable-event-production-ledger.mjs";

const checksum = "1".repeat(64);
const successful = (value) => ({
  checksum: value,
  finished_at: new Date("2026-01-01T00:00:00.000Z"),
  rolled_back_at: null,
  applied_steps_count: 1,
});
const rolledBack = (value = "2".repeat(64)) => ({
  checksum: value,
  finished_at: null,
  rolled_back_at: new Date("2026-01-01T00:00:01.000Z"),
  applied_steps_count: 0,
});

test("accepts one exact successful peer and terminal zero-step attempts", () => {
  assert.deepEqual(
    assertReviewedPeerMigrationLedger({
      migrationName: "20261001000000_example",
      repositoryChecksum: checksum,
      rows: [rolledBack(), successful(checksum), rolledBack("3".repeat(64))],
    }),
    {
      migrationName: "20261001000000_example",
      appliedChecksum: checksum,
      rollbackAttemptCount: 2,
      historicalChecksumException: false,
    },
  );
});

test("accepts only the pinned numeric-guard Production checksum exception", () => {
  assert.deepEqual(
    assertReviewedPeerMigrationLedger({
      migrationName: SCHEMA_NUMERIC_GUARDS_MIGRATION,
      repositoryChecksum: SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256,
      rows: [successful(SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256)],
    }),
    {
      migrationName: SCHEMA_NUMERIC_GUARDS_MIGRATION,
      appliedChecksum: SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
      rollbackAttemptCount: 0,
      historicalChecksumException: true,
    },
  );
  assert.throws(
    () => assertReviewedPeerMigrationLedger({
      migrationName: SCHEMA_NUMERIC_GUARDS_MIGRATION,
      repositoryChecksum: checksum,
      rows: [successful(SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256)],
    }),
    /repository bytes drifted/u,
  );
  assert.throws(
    () => assertReviewedPeerMigrationLedger({
      migrationName: SCHEMA_NUMERIC_GUARDS_MIGRATION,
      repositoryChecksum: SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256,
      rows: [successful(SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256)],
    }),
    /successful ledger row drifted/u,
  );
});

test("rejects duplicate success, unfinished attempts, and nonzero rollbacks", () => {
  for (const rows of [
    [successful(checksum), successful(checksum)],
    [successful(checksum), {
      checksum: "2".repeat(64),
      finished_at: null,
      rolled_back_at: null,
      applied_steps_count: 0,
    }],
    [successful(checksum), {
      checksum: "2".repeat(64),
      finished_at: null,
      rolled_back_at: new Date("2026-01-01T00:00:01.000Z"),
      applied_steps_count: 1,
    }],
  ]) {
    assert.throws(
      () => assertReviewedPeerMigrationLedger({
        migrationName: "20261001000000_example",
        repositoryChecksum: checksum,
        rows,
      }),
      /ledger row|ledger rows/u,
    );
  }
});
