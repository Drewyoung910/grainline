import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const LIVE_MIGRATION_PATH =
  "prisma/migrations/20261102030000_prepare_seller_metrics_authorities/migration.sql";

export function sellerMetricsPreparationMigrationPath() {
  const isolatedPath = process.env.SELLER_METRICS_PREPARATION_MIGRATION_PATH?.trim();
  const path = isolatedPath || LIVE_MIGRATION_PATH;
  assert.ok(existsSync(path), "missing SellerMetrics preparation migration");
  return path;
}
