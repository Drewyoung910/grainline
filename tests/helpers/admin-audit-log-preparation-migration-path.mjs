import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const LIVE_MIGRATION_PATH =
  "prisma/migrations/20261102010000_prepare_admin_audit_log_authorities/migration.sql";

export function adminAuditLogPreparationMigrationPath() {
  const isolatedPath = process.env.ADMIN_AUDIT_LOG_PREPARATION_MIGRATION_PATH;
  if (!isolatedPath) return LIVE_MIGRATION_PATH;
  assert.ok(
    existsSync(isolatedPath),
    "missing isolated AdminAuditLog preparation migration",
  );
  return isolatedPath;
}
