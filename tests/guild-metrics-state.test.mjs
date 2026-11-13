import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  sellerMetricsPreparationMigrationPath,
} from "./helpers/seller-metrics-preparation-migration-path.mjs";

const {
  GUILD_MASTER_REQUIREMENTS,
  floorMetric,
  meetsGuildMasterRequirements,
  metricsPeriodStart,
} = await import("../src/lib/metricsState.ts");

function metrics(overrides = {}) {
  return {
    sellerProfileId: "seller_1",
    calculatedAt: new Date("2026-05-23T12:00:00.000Z"),
    periodMonths: 3,
    averageRating: GUILD_MASTER_REQUIREMENTS.averageRating,
    reviewCount: GUILD_MASTER_REQUIREMENTS.reviewCount,
    onTimeShippingRate: GUILD_MASTER_REQUIREMENTS.onTimeShippingRate,
    responseRate: GUILD_MASTER_REQUIREMENTS.responseRate,
    totalSalesCents: GUILD_MASTER_REQUIREMENTS.totalSalesCents,
    completedOrderCount: 10,
    activeCaseCount: GUILD_MASTER_REQUIREMENTS.activeCaseCount,
    accountAgeDays: GUILD_MASTER_REQUIREMENTS.accountAgeDays,
    ...overrides,
  };
}

describe("Guild metrics state", () => {
  it("computes metrics periods by fixed day windows without calendar rollover", () => {
    const start = metricsPeriodStart(new Date("2026-05-31T12:00:00.000Z"), 3);

    assert.equal(start.toISOString(), "2026-03-02T12:00:00.000Z");
  });

  it("requires every Guild Master threshold and blocks active unresolved cases", () => {
    assert.deepEqual(meetsGuildMasterRequirements(metrics()).allMet, true);
    assert.equal(meetsGuildMasterRequirements(metrics({ averageRating: 4.49 })).ratingMet, false);
    assert.equal(meetsGuildMasterRequirements(metrics({ reviewCount: 24 })).reviewsMet, false);
    assert.equal(meetsGuildMasterRequirements(metrics({ onTimeShippingRate: 0.949 })).shippingMet, false);
    assert.equal(meetsGuildMasterRequirements(metrics({ responseRate: 0.899 })).responseMet, false);
    assert.equal(meetsGuildMasterRequirements(metrics({ accountAgeDays: 179 })).ageMet, false);
    assert.equal(meetsGuildMasterRequirements(metrics({ totalSalesCents: 99_999 })).salesMet, false);
    assert.equal(meetsGuildMasterRequirements(metrics({ activeCaseCount: 1 })).casesMet, false);
    assert.equal(meetsGuildMasterRequirements(metrics({ activeCaseCount: 1 })).allMet, false);
  });

  it("derives response rate from message history instead of the cached first-response timestamp", () => {
    const source = readFileSync(new URL("../src/lib/metrics.ts", import.meta.url), "utf8");
    const preparation = readFileSync(sellerMetricsPreparationMigrationPath(), "utf8");
    const authority = readFileSync(
      new URL("../src/lib/conversationMessageAuthority.ts", import.meta.url),
      "utf8",
    );
    const serviceSql = readFileSync(
      new URL("../docs/rls-drafts/conversation-message-service-authority.sql", import.meta.url),
      "utf8",
    );
    const metricFunction = serviceSql.slice(
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_seller_message_response_metrics"),
      serviceSql.indexOf("REVOKE ALL ON FUNCTION"),
    );

    assert.doesNotMatch(source, /firstResponseAt/);
    assert.match(source, /grainline_seller_metrics_owner_state/u);
    assert.match(
      preparation,
      /grainline_seller_message_response_metrics\(\s*source_seller_user_id,\s*period_start\s*\)/u,
    );
    assert.match(authority, /public\.grainline_seller_message_response_metrics/);
    assert.match(metricFunction, /WITH seller_conversation AS/);
    assert.match(metricFunction, /DISTINCT ON \(message\."conversationId"\)/);
    assert.match(metricFunction, /seller_response AS/);
    assert.match(metricFunction, /response\."senderId" = p_seller_user_id/);
    assert.match(metricFunction, /LEFT JOIN seller_response/);
  });

  it("stores cached total sales in a bigint column and normalizes cached reads for UI metrics", () => {
    const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
    const metricsSource = readFileSync(new URL("../src/lib/metrics.ts", import.meta.url), "utf8");
    const adminVerification = readFileSync(new URL("../src/app/admin/verification/page.tsx", import.meta.url), "utf8");
    const migration = readFileSync(
      new URL("../prisma/migrations/20260630143000_seller_metrics_sales_bigint/migration.sql", import.meta.url),
      "utf8",
    );

    assert.match(schema, /model SellerMetrics[\s\S]*totalSalesCents\s+BigInt\s+@default\(0\)/);
    assert.match(migration, /ALTER COLUMN "totalSalesCents" TYPE BIGINT/);
    assert.match(metricsSource, /totalSalesCents: Number\(row\.totalSalesCents\)/);
    assert.match(adminVerification, /totalSalesCents: number \| bigint/);
    assert.match(adminVerification, /totalSalesCents: Number\(metrics\.totalSalesCents\)/);
  });

  it("keeps private and custom verified purchases in Guild trust metrics by policy", () => {
    const metricsSource = readFileSync(new URL("../src/lib/metrics.ts", import.meta.url), "utf8");
    const metricsPreparation = readFileSync(
      sellerMetricsPreparationMigrationPath(),
      "utf8",
    );
    const orderAuthority = readFileSync(
      new URL("../prisma/migrations/20260901070000_prepare_order_seller_metrics_authority/migration.sql", import.meta.url),
      "utf8",
    );
    const verificationPage = readFileSync(new URL("../src/app/admin/verification/page.tsx", import.meta.url), "utf8");

    assert.match(metricsSource, /grainline_seller_metrics_owner_state/u);
    assert.match(metricsPreparation, /listing\."sellerId" = p_seller_profile_id\s+AND review\."reviewerAccountActive" = true/u);
    assert.match(
      metricsPreparation,
      /grainline_order_seller_metrics_facts\(\s*p_seller_profile_id,\s*pg_catalog\.floor\(\s*EXTRACT\(EPOCH FROM period_start\) \* 1000/u,
    );
    assert.match(orderAuthority, /source_order\."sellerProfileId" = p_seller_profile_id/);
    assert.match(orderAuthority, /source_item\."sellerProfileId" = p_seller_profile_id/);
    assert.doesNotMatch(orderAuthority, /"isPrivate"\s*=\s*false/);
    assert.doesNotMatch(orderAuthority, /JOIN public\."Listing"/);

    assert.match(verificationPage, /prisma\.listing\.count\(\{[\s\S]*sellerId: verification\.sellerProfileId[\s\S]*status: "ACTIVE"[\s\S]*isPrivate: false/);
  });
});

describe("failing Guild metrics are not rounded up to the threshold", () => {
  it("shows 94.6 percent as 94.6, not 95", () => {
    assert.equal(floorMetric(0.946 * 100), 94.6);
    assert.equal(floorMetric(0.96 * 100), 96);
    assert.equal(floorMetric(0.29 * 100), 29);
  });

  it("shows a 4.46 rating as 4.4, not 4.5", () => {
    assert.equal(floorMetric(4.46), 4.4);
    assert.equal(floorMetric(4.5), 4.5);
  });
});
