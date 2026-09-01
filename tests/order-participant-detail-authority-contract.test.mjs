import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(
  "prisma/migrations/20260901010000_prepare_order_participant_detail_authority/migration.sql",
  "utf8",
);
const authority = readFileSync("src/lib/orderParticipantDetailAuthority.ts", "utf8");
const state = readFileSync("src/lib/orderParticipantDetailState.ts", "utf8");
const panel = readFileSync("src/components/SellerRefundPanel.tsx", "utf8");
const sellerPage = readFileSync("src/app/dashboard/sales/[orderId]/page.tsx", "utf8");
const record = readFileSync("docs/order-participant-detail-authority.md", "utf8");

describe("Order participant detail authority contract", () => {
  it("keeps two additive fixed actor-bound functions", () => {
    assert.match(migration, /CREATE FUNCTION public\.grainline_order_buyer_detail\(/);
    assert.match(migration, /CREATE FUNCTION public\.grainline_order_seller_detail\(/);
    assert.equal((migration.match(/^SECURITY DEFINER$/gm) ?? []).length, 2);
    assert.equal((migration.match(/^SET search_path = pg_catalog$/gm) ?? []).length, 2);
    assert.equal((migration.match(/GRANT EXECUTE ON FUNCTION/g) ?? []).length, 2);
    assert.equal((migration.match(/REVOKE ALL ON FUNCTION/g) ?? []).length, 2);
    assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY|DROP POLICY/i);
    assert.doesNotMatch(migration, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON/i);
  });

  it("binds buyer and durable seller before exposing fixed historical items", () => {
    assert.match(migration, /source_order\."buyerId" = p_actor_user_id/g);
    assert.match(migration, /seller\."userId" = p_actor_user_id/g);
    assert.match(migration, /seller\.id = source_order\."sellerProfileId"/g);
    assert.match(migration, /item_count > 100/g);
    assert.doesNotMatch(migration, /unexpectedSecret/);
    assert.match(migration, /'listingSnapshot'/);
    assert.match(migration, /'selectedVariants'/);
  });

  it("derives participant-safe state without returning provider or staff bodies", () => {
    assert.match(migration, /WHEN source_order\."sellerRefundId" IS NULL THEN 'NONE'/g);
    assert.match(migration, /THEN 'PROCESSING'/g);
    assert.match(migration, /THEN 'AMBIGUOUS'/g);
    assert.match(migration, /ELSE 'RECORDED'/g);
    const returnHeaders = [...migration.matchAll(/RETURNS TABLE\(([\s\S]*?)\)\nLANGUAGE/g)]
      .map((match) => match[1])
      .join("\n");
    assert.doesNotMatch(returnHeaders, /stripe|refund_id|review_note|shippo/i);
    assert.match(returnHeaders, /seller_refund_state text/);
    assert.match(returnHeaders, /deauthorized_review_hold boolean/);
  });

  it("validates every database result and uses only named functions", () => {
    assert.match(authority, /normalizeDbUserContextUserId/g);
    assert.match(authority, /grainline_order_buyer_detail/);
    assert.match(authority, /grainline_order_seller_detail/);
    assert.match(state, /exactlyOneOrNone/);
    assert.match(state, /participantOrderItemsFromValue/);
    assert.match(state, /sellerRefundAmountCents != null/);
  });

  it("removes provider refund identifiers from seller-facing UI", () => {
    assert.match(panel, /refundState: SellerRefundDisplayState/);
    assert.doesNotMatch(panel, /Stripe refund ID|alreadyRefundedId/);
    assert.match(sellerPage, /const sellerRefundState = order\.sellerRefundState/);
    assert.doesNotMatch(sellerPage, /alreadyRefundedId=|sellerRefundId/);
  });

  it("records the honest compatibility and residual boundaries", () => {
    assert.match(record, /has not been merged, applied,(?: or)?\s+deployed/);
    assert.match(record, /`Order` RLS remains off/);
    assert.match(record, /Application pages are not switched/);
    assert.match(record, /not an `Order` RLS readiness claim/);
    assert.match(record, /does not cryptographically authenticate a Clerk session/);
  });
});
