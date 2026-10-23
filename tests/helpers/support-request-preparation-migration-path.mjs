import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const LIVE_MIGRATION_PATH =
  "prisma/migrations/20261023010000_prepare_support_request_authorities/migration.sql";

export function supportRequestPreparationMigrationPath() {
  const isolatedPath = process.env.SUPPORT_REQUEST_PREPARATION_MIGRATION_PATH;
  if (!isolatedPath) return LIVE_MIGRATION_PATH;
  assert.ok(
    existsSync(isolatedPath),
    "missing isolated SupportRequest preparation migration",
  );
  return isolatedPath;
}
