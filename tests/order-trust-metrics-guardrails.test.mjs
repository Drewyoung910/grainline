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
      "src/lib/quality-score.ts",
      "src/lib/site-metrics-snapshot.ts",
      "src/lib/publicSellerStats.ts",
      "src/lib/metrics.ts",
      "src/app/api/seller/analytics/route.ts",
      "src/app/dashboard/verification/page.tsx",
      "src/app/admin/verification/page.tsx",
      "src/app/api/verification/apply/route.ts",
    ];

    for (const path of paths) {
      const text = source(path);

      assert.match(text, /PAID_STRIPE_ORDER_SQL/, `${path} should use the shared raw SQL helper`);
      assert.doesNotMatch(text, /o\."paidAt" IS NOT NULL/, `${path} should not hand-roll paid checks`);
      assert.doesNotMatch(text, /o\."stripeSessionId" IS NOT NULL/, `${path} should not hand-roll Stripe refs`);
    }
  });

  it("requires Prisma marketplace trust metrics to count only Stripe-backed paid orders", () => {
    const paths = [
      "src/app/api/seller/analytics/recent-sales/route.ts",
      "src/app/api/reviews/route.ts",
      "src/app/account/page.tsx",
      "src/components/ReviewsSection.tsx",
    ];

    for (const path of paths) {
      const text = source(path);

      assert.match(text, /paidStripeOrderWhere/, `${path} should use the shared Prisma helper`);
      assert.doesNotMatch(text, /paidAt: \{ not: null \}/, `${path} should not hand-roll paid checks`);
      assert.doesNotMatch(text, /stripeSessionId: \{ not: null \}/, `${path} should not hand-roll Stripe refs`);
    }
  });

  it("documents that local dev order fixtures require VERCEL_ENV to be unset", () => {
    const envExample = source(".env.example");

    assert.match(envExample, /Leave VERCEL_ENV unset for local-only dev fixtures/);
    assert.match(envExample, /disposable local DB, never shared demo\/QA data/);
    assert.doesNotMatch(envExample, /^# VERCEL_ENV=development$/m);
  });
});
