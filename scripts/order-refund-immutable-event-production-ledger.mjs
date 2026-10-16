export const SCHEMA_NUMERIC_GUARDS_MIGRATION =
  "20260523223000_schema_numeric_guards_and_indexes";
export const SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256 =
  "faf1ac4063a888e0405981aba57c177c4bbb33b184a8b315ace52152d21dc274";
export const SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256 =
  "0ae1197e6d8fd936e201ac793f810a42c1358bbea70f66cabffb7415f960aad6";

function isSuccessful(row) {
  return row?.finished_at !== null
    && row?.finished_at !== undefined
    && row?.rolled_back_at === null
    && Number(row?.applied_steps_count) === 1;
}

function isTerminalZeroStepRollback(row) {
  return row?.finished_at === null
    && row?.rolled_back_at !== null
    && row?.rolled_back_at !== undefined
    && Number(row?.applied_steps_count) === 0;
}

export function assertReviewedPeerMigrationLedger({
  migrationName,
  repositoryChecksum,
  rows,
}) {
  if (
    typeof migrationName !== "string"
    || !/^[0-9]{14}_[a-z0-9_]+$/u.test(migrationName)
    || typeof repositoryChecksum !== "string"
    || !/^[0-9a-f]{64}$/u.test(repositoryChecksum)
    || !Array.isArray(rows)
  ) {
    throw new Error("peer migration ledger input is invalid");
  }

  let expectedAppliedChecksum = repositoryChecksum;
  if (migrationName === SCHEMA_NUMERIC_GUARDS_MIGRATION) {
    if (repositoryChecksum !== SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256) {
      throw new Error("numeric-guard repository bytes drifted");
    }
    expectedAppliedChecksum = SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256;
  }

  const successful = rows.filter(isSuccessful);
  if (
    successful.length !== 1
    || successful[0]?.checksum !== expectedAppliedChecksum
  ) {
    throw new Error(`peer successful ledger row drifted: ${migrationName}`);
  }

  const otherRows = rows.filter((row) => row !== successful[0]);
  if (!otherRows.every(isTerminalZeroStepRollback)) {
    throw new Error(`peer failed-attempt ledger rows drifted: ${migrationName}`);
  }

  return Object.freeze({
    migrationName,
    appliedChecksum: expectedAppliedChecksum,
    rollbackAttemptCount: otherRows.length,
    historicalChecksumException:
      migrationName === SCHEMA_NUMERIC_GUARDS_MIGRATION,
  });
}
