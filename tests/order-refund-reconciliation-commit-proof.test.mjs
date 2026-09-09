import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const sql = fs.readFileSync(
  "docs/rls-drafts/order-refund-reconciliation-commit-proof.sql",
  "utf8",
);
const authority = fs.readFileSync(
  "src/lib/orderRefundReconciliationAuthority.ts",
  "utf8",
);
const action = fs.readFileSync(
  "src/app/admin/orders/[id]/refundReconciliationActions.ts",
  "utf8",
);

describe("Order refund-reconciliation commit proof", () => {
  it("binds success to the exact immutable decision and finalized generation", () => {
    assert.match(sql, /JOIN public\."Order" AS source_order/);
    assert.match(sql, /reconciliation\."orderId" = p_order_id/);
    assert.match(sql, /reconciliation\."claimId" = p_claim_id/);
    assert.match(sql, /reconciliation\."claimGeneration" = p_claim_generation/);
    assert.match(sql, /'RETRY_EXISTING_SCOPE'[\s\S]*'CONFIRMED_PROVIDER_EFFECT'/);
    assert.doesNotMatch(sql, /'CONFIRMED_NO_PROVIDER_EFFECT'/);
    assert.match(sql, /source_order\."refundClaimGeneration" = p_claim_generation/);
    assert.match(sql, /source_order\."refundClaimId" IS NULL/);
    assert.match(sql, /source_order\."sellerRefundId" ~ '\^re_/);
  });

  it("keeps the projection fixed, boolean-only and runtime-only", () => {
    assert.match(sql, /RETURNS boolean/);
    assert.match(sql, /STABLE[\s\S]*PARALLEL SAFE[\s\S]*SECURITY DEFINER/);
    assert.match(sql, /SET search_path = pg_catalog/);
    assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, grainline_app_runtime/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_app_runtime/);
    assert.doesNotMatch(sql, /CREATE POLICY|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/);
  });

  it("removes the broad fallback Order read and validates the scalar result", () => {
    assert.match(authority, /orderRefundReconciliationCommitted/);
    assert.match(authority, /rows\.length !== 1 \|\| typeof rows\[0\]\?\.committed !== "boolean"/);
    assert.match(action, /orderRefundReconciliationCommitted\(\{/);
    assert.match(action, /claimId: preparedClaim\.claimId/);
    assert.match(action, /claimGeneration: preparedClaim\.claimGeneration/);
    assert.doesNotMatch(action, /prisma\.order\.(?:findFirst|findUnique)/);
    assert.doesNotMatch(action, /startsWith: "re_"/);
  });
});
