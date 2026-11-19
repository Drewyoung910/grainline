import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const LIVE_MIGRATION_PATH =
  "prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql";

export function listingDomainPreparationMigrationPath() {
  const isolatedPath = process.env.LISTING_DOMAIN_PREPARATION_MIGRATION_PATH;
  if (!isolatedPath) return LIVE_MIGRATION_PATH;
  assert.ok(
    existsSync(isolatedPath),
    "missing isolated Listing domain preparation migration",
  );
  return isolatedPath;
}
