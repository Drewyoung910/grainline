import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { checkoutExistingResultFromRows } from "../src/lib/orderCheckoutExistingState.ts";

const sql = fs.readFileSync(
  "docs/rls-drafts/order-checkout-existing-authority.sql",
  "utf8",
);
const wrapper = fs.readFileSync(
  "src/lib/orderCheckoutExistingAuthority.ts",
  "utf8",
);
const route = fs.readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");

describe("Order checkout existing authority", () => {
  it("binds lookup and refund classification to the active event/session", () => {
    assert.match(sql, /source_event\."sourceObjectId" IS DISTINCT FROM p_session_id/);
    assert.match(sql, /source_event\."claimGeneration" IS DISTINCT FROM p_claim_generation/);
    assert.match(sql, /WHERE source\."stripeSessionId" = p_session_id/);
    assert.match(sql, /source_order\."refundClaimSourceId" = p_event_id/);
    assert.match(sql, /CURRENT_TIMESTAMP - INTERVAL '15 minutes'/);
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /SET search_path = pg_catalog/);
    assert.doesNotMatch(sql, /\bEXECUTE\s+FORMAT\b|\bEXECUTE\s+IMMEDIATE\b/i);
    assert.match(wrapper, /grainline_stripe_checkout_order_existing/);
  });

  it("uses the closed lookup instead of direct Order idempotency reads", () => {
    const branch = route.slice(
      route.indexOf("// Idempotency"),
      route.indexOf("// Retrieve with expansions"),
    );
    assert.match(branch, /readExistingCheckoutOrder\(\{/);
    assert.match(branch, /eventId: event\.id/);
    assert.match(branch, /claimGeneration/);
    assert.match(branch, /sessionId/);
    assert.doesNotMatch(branch, /prisma\.order\./);
    assert.match(branch, /existingOrder\.outcome === "retry"/);
    assert.match(branch, /existingOrder\.outcome === "processing"/);
  });

  it("strictly parses every closed outcome", () => {
    assert.deepEqual(checkoutExistingResultFromRows([{
      outcome: "absent", order_id: null, retry_reason: null, seller_user_ids: [],
    }]), {
      outcome: "absent", orderId: null, retryReason: null, sellerUserIds: [],
    });
    assert.deepEqual(checkoutExistingResultFromRows([{
      outcome: "retry",
      order_id: "order-1",
      retry_reason: "Seller is no longer eligible.",
      seller_user_ids: ["seller-user"],
    }]), {
      outcome: "retry",
      orderId: "order-1",
      retryReason: "Seller is no longer eligible.",
      sellerUserIds: ["seller-user"],
    });
    for (const outcome of ["complete", "processing"]) {
      assert.equal(checkoutExistingResultFromRows([{
        outcome, order_id: "order-1", retry_reason: null, seller_user_ids: [],
      }]).outcome, outcome);
    }
    assert.throws(() => checkoutExistingResultFromRows([]), /cardinality/);
    assert.throws(() => checkoutExistingResultFromRows([{
      outcome: "other", order_id: null, retry_reason: null, seller_user_ids: [],
    }]), /outcome/);
    assert.throws(() => checkoutExistingResultFromRows([{
      outcome: "absent", order_id: "order-1", retry_reason: null, seller_user_ids: [],
    }]), /inconsistent/);
    assert.throws(() => checkoutExistingResultFromRows([{
      outcome: "complete", order_id: "order-1", retry_reason: "reason", seller_user_ids: [],
    }]), /inconsistent/);
    assert.throws(() => checkoutExistingResultFromRows([{
      outcome: "retry", order_id: "order-1", retry_reason: null, seller_user_ids: [],
    }]), /inconsistent/);
  });
});
