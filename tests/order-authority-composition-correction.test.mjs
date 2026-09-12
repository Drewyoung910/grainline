import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migrationPath =
  "prisma/migrations/20260905170000_correct_order_authority_composition/migration.sql";
const migration = readFileSync(migrationPath, "utf8");
const draft = readFileSync(
  "docs/rls-drafts/order-authority-composition-correction.sql",
  "utf8",
);
const stage = readFileSync(
  "scripts/stage-order-zero-direct-compatible-prefix.mjs",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

function functionDefinition(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const endMarker = `$${name}$;`;
  const end = migration.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing ${name}`);
  return migration.slice(start, end + endMarker.length);
}

describe("Order authority composition correction", () => {
  it("is byte-identical to its reviewed draft and pinned in the complete suffix", () => {
    const digest = createHash("sha256").update(migration).digest("hex");
    assert.equal(digest, "00e13c339320584780164cdf0b234f2005d698e8df0fd567480f53d2f8b23cff");
    assert.equal(migration, draft);
    assert.match(stage, new RegExp(digest, "u"));
    assert.equal(
      (ci.match(/20260905170000_correct_order_authority_composition/gu) ?? []).length,
      2,
    );
  });

  it("excludes conversion-dispute-blocked Orders only from money, trust and review facts", () => {
    const review = functionDefinition("grainline_order_review_eligibility_lock");
    const verification = functionDefinition("grainline_order_seller_verification_sales");
    const metrics = functionDefinition("grainline_order_seller_metrics_facts");
    for (const source of [review, verification]) {
      assert.match(source, /paymentRefundBlocked" = false[\s\S]*paymentConversionDisputeBlocked" = false/u);
    }
    assert.equal(
      (migration.match(/paymentConversionDisputeBlocked" = false/gu) ?? []).length,
      10,
    );
    const completed = metrics.slice(0, metrics.indexOf("shipping_summary AS"));
    const shipping = metrics.slice(metrics.indexOf("shipping_summary AS"));
    assert.match(completed, /paymentConversionDisputeBlocked" = false/u);
    assert.doesNotMatch(shipping, /paymentConversionDisputeBlocked/u);
    assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.grainline_listing_order_archive_blocked/u);
  });

  it("rechecks fulfillment and label state before blocked-checkout claim and record", () => {
    const claim = functionDefinition("grainline_blocked_checkout_refund_claim");
    const record = functionDefinition("grainline_blocked_checkout_refund_record_core");
    for (const source of [claim, record]) {
      assert.match(source, /fulfillmentStatus"::text IS DISTINCT FROM 'PENDING'/u);
      assert.match(source, /labelStatus"::text IS NOT DISTINCT FROM 'PURCHASED'/u);
      assert.match(source, /labelClaimStatus"[\s\S]*PROVIDER_PENDING[\s\S]*PROVIDER_AMBIGUOUS[\s\S]*PROVIDER_RECORDED/u);
    }
    assert.match(migration, /Order_provider_claim_mutual_exclusion_check/u);
  });

  it("replaces only exact predecessor bodies without widening authority", () => {
    assert.equal(
      (migration.match(/CREATE OR REPLACE FUNCTION public\./gu) ?? []).length,
      10,
    );
    assert.match(migration, /428d3ac57643261d600c7fe5015aa798/u);
    assert.match(migration, /687ec7b3100828bb21748adda74a8848/u);
    assert.match(migration, /bfd9386e3bb872ba6cc78cc6d1e4acd2/u);
    assert.match(migration, /57afbb69975aabeff64b8a069f9088cf/u);
    assert.doesNotMatch(
      migration,
      /ALTER TABLE|CREATE POLICY|DROP POLICY|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|\bGRANT\b|\bREVOKE\b/iu,
    );
  });
});
