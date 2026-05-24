import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function modelBlock(schema, modelName) {
  const match = schema.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Missing model ${modelName}`);
  return match[0];
}

describe("schema numeric and index guardrails", () => {
  const migrationPath = "prisma/migrations/20260523223000_schema_numeric_guards_and_indexes/migration.sql";
  const variantMigrationPath = "prisma/migrations/20260524090000_listing_variant_price_adjust_guard/migration.sql";

  it("adds and validates database numeric guardrails for money, scores, dates, and ranges", () => {
    const migration = source(migrationPath);
    const variantMigration = source(variantMigrationPath);
    const numericMigrations = `${migration}\n${variantMigration}`;

    for (const constraint of [
      "Order_itemsSubtotalCents_non_negative_chk",
      "Order_shippingAmountCents_non_negative_chk",
      "Order_taxAmountCents_non_negative_chk",
      "Order_giftWrappingPriceCents_non_negative_chk",
      "Order_quotedShippingAmountCents_non_negative_chk",
      "Order_labelCostCents_non_negative_chk",
      "Order_sellerRefundAmountCents_non_negative_chk",
      "Order_taxReversalAmountCents_non_negative_chk",
      "Case_refundAmountCents_non_negative_chk",
      "CommissionRequest_budget_valid_chk",
      "Listing_processing_days_valid_chk",
      "Listing_in_stock_quantity_required_chk",
      "SellerProfile_shipping_money_non_negative_chk",
      "SellerProfile_default_pkg_non_negative_chk",
      "Listing_analytics_non_negative_chk",
      "Listing_scores_range_chk",
      "ListingVariantOption_price_adjust_range_chk",
      "SellerProfile_founding_maker_number_range_chk",
      "SellerProfile_radiusMeters_range_chk",
      "CommissionRequest_radiusMeters_range_chk",
      "Metro_radiusMiles_range_chk",
      "Review_ratingX2_range_chk",
    ]) {
      assert.match(numericMigrations, new RegExp(`ADD CONSTRAINT "${constraint}"`));
      assert.match(numericMigrations, new RegExp(`VALIDATE CONSTRAINT "${constraint}"`));
    }

    assert.match(migration, /SET "stockQuantity" = 0[\s\S]*"listingType" = 'IN_STOCK'[\s\S]*"stockQuantity" IS NULL/);
    assert.match(migration, /"budgetMinCents" <= "budgetMaxCents"/);
    assert.match(migration, /SET[\s\S]*"processingTimeMinDays" = CASE[\s\S]*"processingTimeMinDays" < 1 THEN 1[\s\S]*"processingTimeMaxDays" > 365 THEN 365/);
    assert.match(migration, /SET "processingTimeMaxDays" = "processingTimeMinDays"[\s\S]*"processingTimeMinDays" > "processingTimeMaxDays"/);
    assert.match(migration, /"processingTimeMinDays" <= "processingTimeMaxDays"/);
    assert.match(migration, /"qualityScore" <= 1\.2/);
    assert.match(migration, /"aiReviewScore" >= 0 AND "aiReviewScore" <= 1/);
    assert.match(variantMigration, /"priceAdjustCents" >= -10000000 AND "priceAdjustCents" <= 10000000/);
    assert.match(migration, /"ratingX2" >= 2 AND "ratingX2" <= 10/);
  });

  it("does not require an Order platformFeeCents constraint when no such column is persisted", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source(migrationPath);

    assert.doesNotMatch(modelBlock(schema, "Order"), /platformFeeCents/);
    assert.doesNotMatch(migration, /Order_platformFeeCents/);
  });

  it("keeps verified hot-path indexes visible in schema and migration history", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source(migrationPath);

    const expected = [
      ["SellerProfile", "@@index([metroId])", "SellerProfile_metroId_idx"],
      ["SellerProfile", "@@index([cityMetroId])", "SellerProfile_cityMetroId_idx"],
      ["Listing", "@@index([metroId])", "Listing_metroId_idx"],
      ["Listing", "@@index([cityMetroId])", "Listing_cityMetroId_idx"],
      ["CommissionRequest", "@@index([metroId])", "CommissionRequest_metroId_idx"],
      ["CommissionRequest", "@@index([cityMetroId])", "CommissionRequest_cityMetroId_idx"],
      ["Case", "@@index([sellerId])", "Case_sellerId_idx"],
      ["Message", "@@index([senderId])", "Message_senderId_idx"],
      ["CaseMessage", "@@index([authorId])", "CaseMessage_authorId_idx"],
      ["BlogComment", "@@index([authorId])", "BlogComment_authorId_idx"],
      ["Favorite", "@@index([listingId])", "Favorite_listingId_idx"],
      ["CartItem", "@@index([listingId])", "CartItem_listingId_idx"],
    ];

    for (const [model, schemaIndex, sqlIndex] of expected) {
      assert.match(modelBlock(schema, model), new RegExp(schemaIndex.replace(/[()[\]]/g, "\\$&")));
      assert.match(migration, new RegExp(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${sqlIndex}"`));
    }
  });

  it("does not misclassify stripeSessionId as the partial-unique drift case", () => {
    const schema = source("prisma/schema.prisma");
    const sessionMigration = source("prisma/migrations/20251001005603_add_stripe_session_id/migration.sql");
    const paymentIntentMigration = source("prisma/migrations/20260424_add_performance_indexes_v2/migration.sql");
    const chargeMigration = source("prisma/migrations/20260424194500_webhook_idempotency_retention_constraints/migration.sql");

    assert.match(schema, /stripeSessionId\s+String\?\s+@unique\s+@db\.VarChar\(255\)/);
    assert.match(sessionMigration, /CREATE UNIQUE INDEX "Order_stripeSessionId_key"[\s\S]*\("stripeSessionId"\)/);
    assert.match(paymentIntentMigration, /"Order_stripePaymentIntentId_idx"[\s\S]*WHERE "stripePaymentIntentId" IS NOT NULL/);
    assert.match(chargeMigration, /"Order_stripeChargeId_idx"[\s\S]*WHERE "stripeChargeId" IS NOT NULL/);
  });
});
