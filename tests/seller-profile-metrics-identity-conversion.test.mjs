import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20261020070000_prepare_seller_profile_metrics_identity/migration.sql";
const sellerMetricsPreparationPath =
  "prisma/migrations/20261102030000_prepare_seller_metrics_authorities/migration.sql";

test("seller metrics database operation reads its purpose-bound identity authority", () => {
  assert.equal(existsSync(migrationPath), true);
  assert.equal(existsSync(sellerMetricsPreparationPath), true);
  const migration = readFileSync(migrationPath, "utf8");
  const preparation = readFileSync(sellerMetricsPreparationPath, "utf8");
  const metrics = readFileSync("src/lib/metrics.ts", "utf8");

  assert.match(migration, /grainline_seller_service_metrics_identity\(text\)/u);
  assert.match(preparation, /grainline_seller_service_metrics_identity/u);
  assert.match(metrics, /grainline_seller_metrics_owner_state/u);
  assert.doesNotMatch(metrics, /grainline_seller_metrics_guild_refresh/u);
  assert.match(
    readFileSync("src/app/api/cron/guild-metrics/route.ts", "utf8"),
    /calculateSellerMetrics\(seller\.userId/u,
  );
  assert.doesNotMatch(metrics, /grainline_seller_service_metrics_identity/u);
  assert.doesNotMatch(metrics, /sellerProfile\.findUnique/u);
});
