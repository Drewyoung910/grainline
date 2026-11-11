import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

const livePath = path.resolve(
  "prisma/migrations/20261101080000_prepare_email_service_least_privilege/migration.sql",
);

export function emailServiceLeastPrivilegeMigrationPath() {
  if (existsSync(livePath)) return livePath;

  const isolatedPath =
    process.env.EMAIL_SERVICE_LEAST_PRIVILEGE_MIGRATION_PATH?.trim() ?? "";
  assert.ok(
    isolatedPath && path.isAbsolute(isolatedPath) && existsSync(isolatedPath),
    "missing email service least-privilege migration source",
  );
  return isolatedPath;
}
