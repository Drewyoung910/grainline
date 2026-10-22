import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20261020070000_prepare_seller_profile_metrics_identity/migration.sql";

test("seller metrics reads its purpose-bound identity through one database authority", () => {
  assert.equal(existsSync(migrationPath), true);
  const migration = readFileSync(migrationPath, "utf8");
  const metrics = readFileSync("src/lib/metrics.ts", "utf8");

  assert.match(migration, /grainline_seller_service_metrics_identity\(text\)/u);
  assert.match(metrics, /grainline_seller_service_metrics_identity/u);
  assert.doesNotMatch(metrics, /sellerProfile\.findUnique/u);
});
