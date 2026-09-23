import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const sql = fs.readFileSync(
  "docs/rls-drafts/order-seller-refund-preflight-authority.sql",
  "utf8",
);
const helper = fs.readFileSync(
  "src/lib/orderSellerRefundPreflightAuthority.ts",
  "utf8",
);
const route = fs.readFileSync(
  "src/app/api/orders/[id]/refund/route.ts",
  "utf8",
);

describe("Order seller-refund preflight authority", () => {
  it("binds actor, durable seller and Order before stale-lock cleanup", () => {
    const actor = sql.indexOf('FROM public."User" AS actor');
    const seller = sql.indexOf('FROM public."SellerProfile" AS seller');
    const order = sql.indexOf('FROM public."Order" AS source_order');
    const cleanup = sql.indexOf('UPDATE public."Order" AS source_order');
    assert.ok(actor >= 0 && actor < seller && seller < order && order < cleanup);
    assert.match(sql, /locked_order\."sellerProfileId" IS DISTINCT FROM locked_seller\.id/);
    assert.match(sql, /"caseResolutionClaimId" IS NULL/);
    assert.match(sql, /"refundClaimId" IS NULL/);
    assert.match(sql, /interval '15 minutes'/);
  });

  it("classifies the closed product states without returning Order data", () => {
    for (const decision of [
      "READY",
      "FORBIDDEN",
      "NOT_FOUND",
      "OPEN_DISPUTE",
      "PROCESSING",
      "AMBIGUOUS",
      "RECORDED",
      "LABEL_BLOCKED",
      "NO_PAYMENT",
      "STATE_CHANGED",
    ]) {
      assert.match(sql, new RegExp(`RETURN '${decision}'`));
      assert.match(helper, new RegExp(`"${decision}"`));
    }
    assert.match(sql, /RETURNS text/);
    assert.doesNotMatch(sql, /RETURNS TABLE|RETURNS jsonb/);
  });

  it("keeps the function fixed and the application off direct Order access", () => {
    assert.match(sql, /VOLATILE[\s\S]*PARALLEL UNSAFE[\s\S]*SECURITY DEFINER/);
    assert.match(sql, /SET search_path = pg_catalog/);
    assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, grainline_app_runtime/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_app_runtime/);
    assert.doesNotMatch(
      sql,
      /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|CREATE POLICY|GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)/,
    );
    assert.match(route, /sellerRefundPreflight\(\{/);
    assert.match(route, /claimSellerOrderRefund\(\{/);
    assert.doesNotMatch(route, /\bprisma\.order\b|\btx\.order\b/);
    assert.doesNotMatch(route, /releaseStaleRefundLocks/);
    assert.doesNotMatch(route, /SELLER_CLAIM_DRIFT/);
  });
});
