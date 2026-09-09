import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { paidCheckoutAuthorityResultFromRows } from "../src/lib/orderPaidCheckoutState.ts";

const sql = fs.readFileSync(
  "docs/rls-drafts/order-paid-checkout-authority.sql",
  "utf8",
);
const wrapper = fs.readFileSync("src/lib/orderPaidCheckoutAuthority.ts", "utf8");

describe("Order paid-checkout authority contract", () => {
  it("binds the write to an active signed-event generation and retained source", () => {
    assert.match(sql, /source_event\."claimGeneration" IS DISTINCT FROM p_claim_generation/);
    assert.match(sql, /source_event\."sourceObjectId" IS DISTINCT FROM p_session_id/);
    assert.match(sql, /source_reservation\."sourceSnapshot" IS NULL/);
    assert.match(sql, /source_item#>>'\{listing,sellerId\}' IS DISTINCT FROM source_seller_id/);
    assert.match(sql, /Paid checkout retained source keys are invalid/);
    assert.match(sql, /listing,currency[\s\S]*p_provider->>'currency'/);
    assert.match(sql, /count\(DISTINCT selected_id\)/);
  });

  it("uses one fixed definer operation without exposing direct table authority", () => {
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /SET search_path = pg_catalog/);
    assert.doesNotMatch(sql, /\bEXECUTE\s+FORMAT\b|\bEXECUTE\s+IMMEDIATE\b/i);
    assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_app_runtime/);
    assert.match(wrapper, /grainline_stripe_checkout_order_create/);
    assert.match(wrapper, /AT TIME ZONE 'UTC'/);
    assert.match(wrapper, /JSON\.stringify\(input\.provider\)/);
  });

  it("derives protected order/item state and retains complete checkout history", () => {
    for (const token of [
      '"buyerId"', '"sellerProfileId"', '"fulfillmentStatus"',
      '"listingSnapshot"', '"selectedVariants"', '"quotedToLine1"',
      '"quotedToLine2"', '"stripeTransferId"',
    ]) assert.match(sql, new RegExp(token));
    assert.match(sql, /source_processing_deadline := p_paid_at/);
    assert.match(sql, /CASE WHEN source_mode = 'single' THEN 1 ELSE 3 END/);
    assert.match(sql, /Paid checkout fulfillment projection is invalid/);
    assert.match(sql, /pg_catalog\.left\(source_review_note, 10000\)/);
    assert.match(sql, /pg_catalog\.left\(NULLIF\(source_invalid_reason, ''\), 1000\)/);
  });

  it("rejects malformed or inconsistent application results", () => {
    const valid = {
      outcome: "created",
      order_id: "order-1",
      invalid_reason: null,
      invalid_seller_user_ids: [],
      listing_visibility_changed: false,
    };
    assert.deepEqual(paidCheckoutAuthorityResultFromRows([valid]), {
      outcome: "created",
      orderId: "order-1",
      invalidReason: null,
      invalidSellerUserIds: [],
      listingVisibilityChanged: false,
    });
    assert.throws(() => paidCheckoutAuthorityResultFromRows([]), /cardinality/);
    assert.throws(() => paidCheckoutAuthorityResultFromRows([{ ...valid, outcome: "other" }]), /outcome/);
    assert.throws(() => paidCheckoutAuthorityResultFromRows([{ ...valid, order_id: "" }]), /order id/);
    assert.throws(() => paidCheckoutAuthorityResultFromRows([{
      ...valid,
      outcome: "replayed",
      invalid_reason: "drift",
    }]), /inconsistent/);
    assert.throws(() => paidCheckoutAuthorityResultFromRows([{
      ...valid,
      invalid_seller_user_ids: ["seller-user"],
    }]), /inconsistent/);
  });
});
