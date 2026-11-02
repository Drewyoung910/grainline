import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const LIVE_MIGRATION_PATH =
  "prisma/migrations/20261101010000_prepare_seller_broadcast_authorities/migration.sql";

export function sellerBroadcastPreparationMigrationPath() {
  const isolatedPath = process.env.SELLER_BROADCAST_PREPARATION_MIGRATION_PATH;
  if (!isolatedPath) return LIVE_MIGRATION_PATH;
  assert.ok(
    existsSync(isolatedPath),
    "missing isolated SellerBroadcast preparation migration",
  );
  return isolatedPath;
}
