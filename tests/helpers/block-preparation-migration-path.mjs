import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const LIVE_MIGRATION_PATH =
  "prisma/migrations/20261030010000_prepare_block_authorities/migration.sql";

export function blockPreparationMigrationPath() {
  const isolatedPath = process.env.BLOCK_PREPARATION_MIGRATION_PATH;
  if (!isolatedPath) return LIVE_MIGRATION_PATH;
  assert.ok(
    existsSync(isolatedPath),
    "missing isolated Block preparation migration",
  );
  return statSync(isolatedPath).isDirectory()
    ? join(isolatedPath, "migration.sql")
    : isolatedPath;
}
