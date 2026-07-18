import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SAVED_SEARCH_RLS_DEPLOY_PHASE_ENV =
  "SAVED_SEARCH_RLS_DEPLOY_PHASE";
export const SAVED_SEARCH_RPC_MIGRATION =
  "20260717024500_add_saved_search_owner_rpcs";
export const SAVED_SEARCH_RLS_MIGRATION =
  "20260717030000_enable_saved_search_rls";

const RELEASE_ZERO_PHASE = "release-0";
const REVIEWED_PHASE_A = "phase-a-reviewed";

function assertNoLaterMigration(migrationNames, reviewedLatestMigration, phase) {
  const laterMigrations = migrationNames
    .filter((name) => name.localeCompare(reviewedLatestMigration) > 0)
    .sort((a, b) => a.localeCompare(b));
  if (laterMigrations.length > 0) {
    throw new Error(
      `${phase} requires ${reviewedLatestMigration} to remain the latest migration; review or retire the temporary SavedSearch deploy guard before deploying ${laterMigrations.join(", ")}`,
    );
  }
}

export function validateSavedSearchRlsDeployShape({ phase, migrationNames }) {
  if (!Array.isArray(migrationNames)) {
    throw new TypeError("migrationNames must be an array");
  }

  const migrations = new Set(migrationNames);
  const hasRpcMigration = migrations.has(SAVED_SEARCH_RPC_MIGRATION);
  const hasRlsMigration = migrations.has(SAVED_SEARCH_RLS_MIGRATION);

  if (phase === RELEASE_ZERO_PHASE) {
    if (!hasRpcMigration || hasRlsMigration) {
      throw new Error(
        `${RELEASE_ZERO_PHASE} requires ${SAVED_SEARCH_RPC_MIGRATION} to exist and ${SAVED_SEARCH_RLS_MIGRATION} to be absent`,
      );
    }

    assertNoLaterMigration(migrationNames, SAVED_SEARCH_RPC_MIGRATION, phase);

    return { phase, hasRpcMigration, hasRlsMigration };
  }

  if (phase === REVIEWED_PHASE_A) {
    if (!hasRpcMigration || !hasRlsMigration) {
      throw new Error(
        `${REVIEWED_PHASE_A} requires both SavedSearch rollout migrations to exist`,
      );
    }

    assertNoLaterMigration(migrationNames, SAVED_SEARCH_RLS_MIGRATION, phase);

    return { phase, hasRpcMigration, hasRlsMigration };
  }

  const received = phase === undefined || phase === "" ? "missing" : phase;
  throw new Error(
    `${SAVED_SEARCH_RLS_DEPLOY_PHASE_ENV} is ${received}; expected ${RELEASE_ZERO_PHASE} or ${REVIEWED_PHASE_A}`,
  );
}

function runDeployGuard() {
  const migrationDirectory = path.resolve("prisma/migrations");
  const migrationNames = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const result = validateSavedSearchRlsDeployShape({
    phase: process.env[SAVED_SEARCH_RLS_DEPLOY_PHASE_ENV],
    migrationNames,
  });

  process.stdout.write(
    `SavedSearch RLS deploy guard passed for ${result.phase}.\n`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    runDeployGuard();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`SavedSearch RLS deploy guard failed: ${message}\n`);
    process.exitCode = 1;
  }
}
