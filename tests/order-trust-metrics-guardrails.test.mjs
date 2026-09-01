import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("order trust metrics guardrails", () => {
  it("centralizes paid Stripe-backed order predicates for metric and trust surfaces", () => {
    const helper = source("src/lib/orderTrust.ts");

    assert.match(helper, /export const PAID_STRIPE_ORDER_SQL = Prisma\.sql`/);
    assert.match(helper, /o\."paidAt" IS NOT NULL/);
    assert.match(helper, /o\."stripeSessionId" IS NOT NULL/);
    assert.match(helper, /o\."stripePaymentIntentId" IS NOT NULL/);
    assert.match(helper, /o\."stripeChargeId" IS NOT NULL/);
    assert.match(helper, /export function paidStripeOrderWhere\(\): Prisma\.OrderWhereInput/);
    assert.match(helper, /paidAt: \{ not: null \}/);
    assert.match(helper, /stripeSessionId: \{ not: null \}/);
    assert.match(helper, /stripePaymentIntentId: \{ not: null \}/);
    assert.match(helper, /stripeChargeId: \{ not: null \}/);
  });

  it("requires raw-SQL marketplace trust metrics to count only Stripe-backed paid orders", () => {
    const paths = [
      "src/lib/metrics.ts",
      "src/app/api/seller/analytics/route.ts",
      "src/app/admin/verification/page.tsx",
    ];

    for (const path of paths) {
      const text = source(path);

      assert.match(text, /PAID_STRIPE_ORDER_SQL/, `${path} should use the shared raw SQL helper`);
      assert.doesNotMatch(text, /o\."paidAt" IS NOT NULL/, `${path} should not hand-roll paid checks`);
      assert.doesNotMatch(text, /o\."stripeSessionId" IS NOT NULL/, `${path} should not hand-roll Stripe refs`);
    }

    const eligibility = source(
      "prisma/migrations/20260901040000_prepare_order_eligibility_authority/migration.sql",
    );
    assert.match(eligibility, /source_order\."paidAt" IS NOT NULL/);
    assert.match(eligibility, /source_order\."stripeSessionId" IS NOT NULL/);
    const publicAggregates = source(
      "prisma/migrations/20260901050000_prepare_order_public_aggregate_authority/migration.sql",
    );
    assert.match(publicAggregates, /source_order\."paidAt" IS NOT NULL/);
    assert.match(publicAggregates, /source_order\."stripeSessionId" IS NOT NULL/);
  });

  it("requires Prisma marketplace trust metrics to count only Stripe-backed paid orders", () => {
    const paths = [
      "src/app/api/seller/analytics/recent-sales/route.ts",
      "src/app/account/page.tsx",
      "src/components/ReviewsSection.tsx",
    ];

    for (const path of paths) {
      const text = source(path);

      assert.match(text, /paidStripeOrderWhere/, `${path} should use the shared Prisma helper`);
      assert.doesNotMatch(text, /paidAt: \{ not: null \}/, `${path} should not hand-roll paid checks`);
      assert.doesNotMatch(text, /stripeSessionId: \{ not: null \}/, `${path} should not hand-roll Stripe refs`);
    }
    assert.match(source("src/lib/homepageStats.ts"), /getPublicFulfilledOrderCount/u);
  });

  it("documents that local dev order fixtures require VERCEL_ENV to be unset", () => {
    const envExample = source(".env.example");

    assert.match(envExample, /Leave VERCEL_ENV unset for local-only dev fixtures/);
    assert.match(envExample, /disposable local DB, never shared demo\/QA data/);
    assert.doesNotMatch(envExample, /^# VERCEL_ENV=development$/m);
  });
});
