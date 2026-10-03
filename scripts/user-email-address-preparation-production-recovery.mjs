#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  assertProductionMigrationDatabaseState,
  assertProductionMigrationGitState,
  parseProductionMigrationEnvironment,
  readProductionMigrationDatabaseState,
  readProductionMigrationGitState,
} from "./guard-production-migration-runner.mjs";
import {
  runUserEmailAddressInspection,
  writeUserEmailAddressInspectionEvidence,
} from "./user-email-address-production-inspect.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const { Client } = pg;

export const USER_EMAIL_ADDRESS_PREPARATION_FAILED_RUN_ID = "37109191878";
export const USER_EMAIL_ADDRESS_PREPARATION_FAILED_HEAD =
  "70c92a620a3c2d6443dc94794f8533d69662a0a6";
export const USER_EMAIL_ADDRESS_PREPARATION_RECOVERY_CONFIRMATION =
  "recover-user-email-address-preparation-exact";
export const FAILED_USER_EMAIL_ADDRESS_INDEX_SHA256 =
  "a28a86aeec3084e4a41341d415fd1fd98446d32939f0fe55d0e53d5e27d8dece";

export const USER_EMAIL_ADDRESS_PREPARATION_MIGRATIONS = Object.freeze([
  Object.freeze({
    name: "20261002160000_add_user_email_suppression_key_index",
    sha256: "3f2e6061e1de1a6f6c92645979a686ec4d3ee36409dc4499c2c62c90dafe1cf8",
  }),
  Object.freeze({
    name: "20261002161000_add_user_email_address_suppression_key_index",
    sha256: "a4b247ce83e871f657ee8228873c3113bdc5cf58adb7292a2e90206c147f67a8",
  }),
  Object.freeze({
    name: "20261002162000_add_user_email_address_current_unique_index",
    sha256: "02ccc97c9e4d1e48320b58bd7ccc23aa023b7330d0add6fcf76802cc266f567c",
  }),
  Object.freeze({
    name: "20261002170000_prepare_user_email_address_authority",
    sha256: "4b058ca847eac24428f8bd4733ed81fed26c6aa138437740e18c58da80bb2933",
  }),
  Object.freeze({
    name: "20261003010000_repair_user_email_address_current_history",
    sha256: "b64751439f75fce70850ab43446c35ce6df45301b2a03970b560306898df1f2e",
  }),
]);

const MODES = Object.freeze(["inspect", "resolved", "prepared"]);
const RUN_ID_PATTERN = /^[1-9][0-9]{0,19}$/u;

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

function parseMode(argv) {
  if (argv.length !== 1 || !argv[0].startsWith("--")) {
    throw new Error("UserEmailAddress recovery requires one exact mode");
  }
  const mode = argv[0].slice(2);
  if (!MODES.includes(mode)) {
    throw new Error("UserEmailAddress recovery mode is invalid");
  }
  return mode;
}

function runId(env, key) {
  const value = required(env, key);
  if (!RUN_ID_PATTERN.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${key} must be one safe positive run id`);
  }
  return value;
}

export function parseUserEmailAddressPreparationRecoveryConfig(
  env = process.env,
  argv = process.argv.slice(2),
) {
  const mode = parseMode(argv);
  if (
    env.USER_EMAIL_ADDRESS_RECOVERY_CONFIRM !==
    USER_EMAIL_ADDRESS_PREPARATION_RECOVERY_CONFIRMATION
  ) {
    throw new Error("UserEmailAddress recovery confirmation is invalid");
  }
  const failedRunId = runId(env, "USER_EMAIL_ADDRESS_FAILED_RUN_ID");
  const mainCiRunId = runId(env, "USER_EMAIL_ADDRESS_RECOVERY_MAIN_CI_RUN_ID");
  const recoveryRunId = runId(env, "GITHUB_RUN_ID");
  if (
    failedRunId !== USER_EMAIL_ADDRESS_PREPARATION_FAILED_RUN_ID ||
    new Set([failedRunId, mainCiRunId, recoveryRunId]).size !== 3
  ) {
    throw new Error("UserEmailAddress recovery run bindings are invalid");
  }

  const owner = parseProductionMigrationEnvironment(env);
  const runnerTemp = path.resolve(required(env, "RUNNER_TEMP"));
  const evidencePath = path.resolve(
    required(env, "USER_EMAIL_ADDRESS_RECOVERY_EVIDENCE_PATH"),
  );
  const expectedPath = path.join(
    runnerTemp,
    `user-email-address-preparation-recovery-${owner.releaseCommit}-${mode}.json`,
  );
  if (evidencePath !== expectedPath || existsSync(evidencePath)) {
    throw new Error(
      "UserEmailAddress recovery evidence path is not fresh and exact",
    );
  }
  return Object.freeze({
    ...owner,
    evidencePath,
    failedRunId,
    mainCiRunId,
    mode,
    recoveryRunId,
  });
}

function isDate(value) {
  return value instanceof Date && !Number.isNaN(value.valueOf());
}

function exactApplied(row, migration) {
  return (
    row?.migration_name === migration.name &&
    row.checksum === migration.sha256 &&
    isDate(row.started_at) &&
    isDate(row.finished_at) &&
    row.rolled_back_at === null &&
    Number(row.applied_steps_count) === 1
  );
}

export function classifyUserEmailAddressPreparationRecoveryLedger(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("UserEmailAddress recovery ledger is invalid");
  }
  const firstName = USER_EMAIL_ADDRESS_PREPARATION_MIGRATIONS[0].name;
  const failedRows = rows.filter(
    (row) =>
      row.migration_name === firstName &&
      row.checksum === FAILED_USER_EMAIL_ADDRESS_INDEX_SHA256,
  );
  const correctedRows = rows.filter(
    (row) =>
      row.migration_name === firstName &&
      row.checksum === USER_EMAIL_ADDRESS_PREPARATION_MIGRATIONS[0].sha256,
  );
  if (
    failedRows.length !== 1 ||
    !isDate(failedRows[0].started_at) ||
    failedRows[0].finished_at !== null ||
    Number(failedRows[0].applied_steps_count) !== 0
  ) {
    throw new Error(
      "UserEmailAddress exact failed zero-step ledger row drifted",
    );
  }
  const failed = failedRows[0];
  const allowedCount =
    1 +
    correctedRows.length +
    USER_EMAIL_ADDRESS_PREPARATION_MIGRATIONS.slice(1).filter((migration) =>
      rows.some((row) => exactApplied(row, migration)),
    ).length;
  if (rows.length !== allowedCount) {
    throw new Error(
      "UserEmailAddress recovery contains unexpected ledger rows",
    );
  }
  if (failed.rolled_back_at === null) {
    if (rows.length !== 1) {
      throw new Error(
        "UserEmailAddress unresolved failure has successor ledger rows",
      );
    }
    return "failed";
  }
  if (!isDate(failed.rolled_back_at)) {
    throw new Error("UserEmailAddress rollback marker drifted");
  }
  if (rows.length === 1) return "resolved";
  if (
    correctedRows.length !== 1 ||
    !exactApplied(
      correctedRows[0],
      USER_EMAIL_ADDRESS_PREPARATION_MIGRATIONS[0],
    ) ||
    !USER_EMAIL_ADDRESS_PREPARATION_MIGRATIONS.slice(1).every(
      (migration) =>
        rows.filter((row) => exactApplied(row, migration)).length === 1,
    ) ||
    rows.length !== USER_EMAIL_ADDRESS_PREPARATION_MIGRATIONS.length + 1
  ) {
    throw new Error("UserEmailAddress corrected preparation ledger drifted");
  }
  return "prepared";
}

function assertCatalogForState(result, state) {
  // Gmail-family suppression keys are lookup keys, not account-identity keys.
  // Their supporting indexes are intentionally nonunique; cross-account
  // collisions are handled conservatively by the application authority path.
  if (
    result.rlsEnabled !== false ||
    result.rlsForced !== false ||
    result.policyCount !== 0 ||
    JSON.stringify(result.runtimeCrud) !==
      JSON.stringify({
        select: true,
        insert: true,
        update: true,
        delete: true,
      }) ||
    result.counts.duplicateCurrentUserGroups !== 0 ||
    result.counts.duplicateCurrentRowExcess !== 0 ||
    result.counts.currentRowsWithoutMatchingActiveUser !== 0
  ) {
    throw new Error("UserEmailAddress recovery table posture drifted");
  }
  if (state === "prepared") {
    if (
      !result.supportingIndexesPresent ||
      result.preparedAuthorityFunctionCount !== 4 ||
      result.currentHistoryDriftPresent
    ) {
      throw new Error("UserEmailAddress prepared catalog is incomplete");
    }
  } else if (
    result.supportingIndexesPresent ||
    result.preparedAuthorityFunctionCount !== 0
  ) {
    throw new Error(
      "UserEmailAddress pre-recovery catalog contains release artifacts",
    );
  }
}

async function readLedger(config) {
  const parsedUrl = new URL(config.directUrl);
  const client = new Client({
    connectionString: config.directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-user-email-address-preparation-recovery",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  await client.connect();
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const rows = (
      await client.query(
        `
      SELECT migration_name, checksum, started_at, finished_at, rolled_back_at,
             applied_steps_count
        FROM public._prisma_migrations
       WHERE migration_name = ANY($1::text[])
       ORDER BY started_at, id
    `,
        [USER_EMAIL_ADDRESS_PREPARATION_MIGRATIONS.map(({ name }) => name)],
      )
    ).rows;
    const incomplete = (
      await client.query(`
      SELECT migration_name, checksum, applied_steps_count
        FROM public._prisma_migrations
       WHERE finished_at IS NULL AND rolled_back_at IS NULL
       ORDER BY migration_name, started_at, id
    `)
    ).rows;
    await client.query("ROLLBACK");
    return { rows, incomplete };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export async function inspectUserEmailAddressPreparationRecovery(
  config,
  {
    readBaseState = readProductionMigrationDatabaseState,
    readGitState = readProductionMigrationGitState,
    readLedgerState = readLedger,
    readCatalog = runUserEmailAddressInspection,
  } = {},
) {
  const git = assertProductionMigrationGitState(
    readGitState(),
    config.releaseCommit,
  );
  const ledger = await readLedgerState(config);
  const state = classifyUserEmailAddressPreparationRecoveryLedger(ledger.rows);
  const expectedIncomplete =
    state === "failed"
      ? [
          {
            migration_name: USER_EMAIL_ADDRESS_PREPARATION_MIGRATIONS[0].name,
            checksum: FAILED_USER_EMAIL_ADDRESS_INDEX_SHA256,
            applied_steps_count: 0,
          },
        ]
      : [];
  if (
    JSON.stringify(ledger.incomplete) !== JSON.stringify(expectedIncomplete)
  ) {
    throw new Error(
      "UserEmailAddress recovery incomplete ledger scope drifted",
    );
  }
  if (config.mode !== "inspect" && config.mode !== state) {
    throw new Error(
      `UserEmailAddress recovery expected ${config.mode}, found ${state}`,
    );
  }

  const base = await readBaseState(config.directUrl);
  if (base.incompleteMigrationCount !== expectedIncomplete.length) {
    throw new Error(
      "UserEmailAddress recovery incomplete migration count drifted",
    );
  }
  const database = assertProductionMigrationDatabaseState({
    ...base,
    incompleteMigrationCount: 0,
  });
  const catalog = await readCatalog({
    mode: `production-recovery-${state}`,
    directUrl: config.directUrl,
    directUrlSha256: config.directUrlSha256,
    releaseCommit: config.releaseCommit,
  });
  assertCatalogForState(catalog.result, state);

  return Object.freeze({
    generatedAt: new Date().toISOString(),
    status: "passed",
    state,
    releaseCommit: config.releaseCommit,
    failedRunId: config.failedRunId,
    mainCiRunId: config.mainCiRunId,
    recoveryRunId: config.recoveryRunId,
    directUrlSha256: config.directUrlSha256,
    git,
    database,
    ledger: Object.freeze({
      reviewedRowCount: ledger.rows.length,
      incompleteCount: ledger.incomplete.length,
      failedZeroStepRowPresent: true,
      failedRowRolledBack: state !== "failed",
      correctedMigrationCount:
        state === "prepared"
          ? USER_EMAIL_ADDRESS_PREPARATION_MIGRATIONS.length
          : 0,
    }),
    catalog: catalog.result,
    productionChanged: false,
    retained: Object.freeze({
      aggregateCountsOnly: true,
      rawRows: false,
      identifiers: false,
      credentials: false,
      functionBodies: false,
    }),
  });
}

async function main() {
  try {
    const config = parseUserEmailAddressPreparationRecoveryConfig();
    const evidence = await inspectUserEmailAddressPreparationRecovery(config);
    writeUserEmailAddressInspectionEvidence(config.evidencePath, evidence);
    process.stdout.write(
      `${JSON.stringify({
        status: evidence.status,
        state: evidence.state,
        releaseCommit: evidence.releaseCommit,
        ledger: evidence.ledger,
        catalog: evidence.catalog,
        productionChanged: false,
        evidenceWritten: true,
      })}\n`,
    );
  } catch {
    process.stderr.write(
      "UserEmailAddress preparation recovery inspection failed closed.\n",
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
