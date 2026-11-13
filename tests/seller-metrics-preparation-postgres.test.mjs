import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(filePath) {
  return readFileSync(filePath, "utf8");
}

test("SellerMetrics complete-schema PostgreSQL proof is wired into the full-chain job", () => {
  const fullChain = source(
    process.env.DATABASE_FULL_CHAIN_POSTGRES_TEST_PATH?.trim()
      || "tests/database-full-chain-postgres.test.mjs",
  );
  assert.match(
    fullChain,
    /import \{[\s\S]*SELLER_METRICS_PREPARATION_MIGRATION,[\s\S]*SELLER_METRICS_RLS_MIGRATION,[\s\S]*proveSellerMetricsPreparedAuthorities,[\s\S]*proveSellerMetricsRlsAuthorities,[\s\S]*proveSellerMetricsRlsRollback,/u,
  );
  assert.match(fullChain, /artifact\.name === SELLER_METRICS_PREPARATION_MIGRATION/u);
  assert.match(fullChain, /artifact\.name === SELLER_METRICS_RLS_MIGRATION/u);
  assert.match(
    fullChain,
    /PRIVATE_TABLE_PREPARATION_RELEASE_ID: "seller_metrics_v1"/u,
  );
  assert.match(fullChain, /await proveSellerMetricsPreparedAuthorities\(\{/u);
  assert.match(fullChain, /await proveSellerMetricsRlsAuthorities\(\{/u);
  assert.match(fullChain, /await proveSellerMetricsRlsRollback\(\{/u);
  assert.match(fullChain, /connectionString: proofDatabaseUrl/u);

  const scenario = source(
    "tools/database-full-chain/scenarios/seller-metrics-authorities.mjs",
  );
  assert.match(scenario, /value\.username = "grainline_app_runtime"/u);
  assert.match(scenario, /current_user: "grainline_app_runtime"/u);
  assert.match(scenario, /session_user: "grainline_app_runtime"/u);
  assert.match(scenario, /a fresh cache read must not recalculate/u);
  assert.match(scenario, /owner-bound Guild refresh/u);
  assert.match(scenario, /"averageRating" = 6/u);
  assert.match(scenario, /grainline_seller_metrics_account_deletion_clear/u);
  assert.match(scenario, /async function proveRefreshWinsDeletionRace/u);
  assert.match(scenario, /async function proveDeletionWinsRefreshRace/u);
  assert.match(scenario, /await waitForLockWait\(/u);
  assert.match(scenario, /concurrent refreshes must leave one cache row/u);
  assert.match(scenario, /a refresh must not resurrect deleted metrics/u);
});
