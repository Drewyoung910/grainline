import assert from "node:assert/strict";
import { existsSync } from "node:fs";

function requiredTestSourcePath(environmentName, livePath, description) {
  const candidate = process.env[environmentName]?.trim() || livePath;
  assert.ok(existsSync(candidate), `missing ${description} test source`);
  return candidate;
}

export function databaseFullChainPostgresTestPath() {
  return requiredTestSourcePath(
    "DATABASE_FULL_CHAIN_POSTGRES_TEST_PATH",
    "tests/database-full-chain-postgres.test.mjs",
    "database full-chain PostgreSQL",
  );
}

export function dbGrantInventoryTestPath() {
  return requiredTestSourcePath(
    "DB_GRANT_INVENTORY_TEST_PATH",
    "tests/db-grant-inventory.test.mjs",
    "database grant inventory",
  );
}
