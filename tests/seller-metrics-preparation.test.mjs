import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  privateTablePreparation,
} from "../scripts/private-table-preparation-catalog.mjs";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migrationPath =
  "prisma/migrations/20261102030000_prepare_seller_metrics_authorities/migration.sql";

describe("SellerMetrics compatible preparation", () => {
  it("binds the inactive-owner cleanup trigger to SellerProfile in the generic release catalog", () => {
    const release = privateTablePreparation("seller_metrics_v1");

    assert.equal(release.table, "SellerMetrics");
    assert.deepEqual(release.addedTriggers, [{
      name: "grainline_seller_metrics_inactive_owner_cleanup",
      function: "grainline_seller_metrics_inactive_owner_cleanup",
      table: "SellerProfile",
      enabled: "O",
      type: 17,
    }]);

    const inspector = source(
      "scripts/private-table-preparation-production-inspect.mjs",
    );
    assert.match(inspector, /entry\.table \?\? release\.table/u);
    assert.match(
      inspector,
      /expected\[index\]\.table !== undefined[\s\S]*table: expected\[index\]\.table/u,
    );
  });

  it("adds validated value invariants and purpose-bound operations without activating RLS", () => {
    const migration = source(migrationPath);

    for (const constraint of [
      "SellerMetrics_period_months_chk",
      "SellerMetrics_average_rating_chk",
      "SellerMetrics_review_count_chk",
      "SellerMetrics_on_time_shipping_rate_chk",
      "SellerMetrics_response_rate_chk",
      "SellerMetrics_total_sales_cents_chk",
      "SellerMetrics_completed_order_count_chk",
      "SellerMetrics_active_case_count_chk",
      "SellerMetrics_account_age_days_chk",
    ]) {
      assert.match(migration, new RegExp(`ADD CONSTRAINT "${constraint}"`));
      assert.match(migration, new RegExp(`VALIDATE CONSTRAINT "${constraint}"`));
    }

    for (const functionName of [
      "grainline_seller_metrics_refresh_prepared_impl",
      "grainline_seller_metrics_owner_state",
      "grainline_seller_metrics_account_deletion_clear",
      "grainline_seller_metrics_inactive_owner_cleanup",
    ]) {
      assert.match(
        migration,
        new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${functionName}`),
      );
    }

    assert.match(
      migration,
      /pg_advisory_xact_lock\(\s*913344,\s*pg_catalog\.hashtext\(p_seller_profile_id\)\s*\)/u,
    );
    assert.match(migration, /grainline_order_seller_metrics_facts/u);
    assert.match(migration, /grainline_case_seller_active_count/u);
    assert.match(migration, /grainline_seller_message_response_metrics/u);
    assert.match(
      migration,
      /listing\."sellerId" = p_seller_profile_id\s+AND review\."reviewerAccountActive" = true/u,
    );
    assert.match(migration, /effect\."claimGeneration" = p_claim_generation/u);
    assert.match(migration, /effect\."claimToken" = p_claim_token/u);
    assert.match(
      migration,
      /CREATE TRIGGER grainline_seller_metrics_inactive_owner_cleanup[\s\S]*AFTER UPDATE OF "ownerAccountActive"/u,
    );
    assert.match(migration, /seller\."ownerAccountActive" = true/u);
    assert.match(migration, /SellerMetrics contains invalid predecessor rows/u);
    assert.match(migration, /SellerMetrics compatible preparation changed RLS state/u);
    assert.doesNotMatch(migration, /ALTER TABLE public\."SellerMetrics"\s+(?:ENABLE|FORCE|DISABLE|NO FORCE) ROW LEVEL SECURITY/u);
    assert.doesNotMatch(migration, /REVOKE [^;]* ON TABLE public\."SellerMetrics"/su);
    assert.doesNotMatch(migration, /CREATE POLICY/u);
  });

  it("moves every reviewed direct operation behind the SellerMetrics access module", () => {
    const migration = source(migrationPath);
    const metrics = source("src/lib/metrics.ts");
    const analytics = source("src/app/api/seller/analytics/route.ts");
    const verification = source("src/app/dashboard/verification/page.tsx");
    const cron = source("src/app/api/cron/guild-metrics/route.ts");
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(metrics, /grainline_seller_metrics_owner_state/u);
    assert.match(metrics, /grainline_seller_metrics_account_deletion_clear/u);
    assert.match(metrics, /withDbUserContext\(actorUserId/u);
    assert.doesNotMatch(metrics, /\.sellerMetrics\.(?:findUnique|upsert|deleteMany)/u);
    assert.doesNotMatch(analytics, /\.sellerMetrics\.(?:findUnique|upsert|deleteMany)/u);
    assert.doesNotMatch(deletion, /\.sellerMetrics\.(?:findUnique|upsert|deleteMany)/u);
    assert.match(analytics, /getFreshSellerMetrics\(me\.id/u);
    assert.match(verification, /getFreshSellerMetrics\(me\.id/u);
    assert.match(verification, /calculateSellerMetrics\(s\.userId/u);
    assert.match(cron, /calculateSellerMetrics\(seller\.userId/u);
    assert.doesNotMatch(metrics, /grainline_seller_metrics_guild_refresh/u);
    assert.doesNotMatch(
      migration,
      /CREATE (?:OR REPLACE )?FUNCTION public\.grainline_seller_metrics_guild_refresh/u,
    );
    assert.doesNotMatch(
      migration,
      /GRANT EXECUTE ON FUNCTION public\.grainline_seller_metrics_guild_refresh/u,
    );
    assert.match(deletion, /clearSellerMetricsForAccountDeletion\(tx, \{/u);
  });
});
