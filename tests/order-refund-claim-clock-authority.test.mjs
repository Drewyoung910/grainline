import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const sql = fs.readFileSync(
  "docs/rls-drafts/order-refund-claim-clock-authority.sql",
  "utf8",
);
const application = fs.readFileSync(
  "src/lib/orderRefundProviderReconciliation.ts",
  "utf8",
);

describe("Order refund claim provider-clock authority", () => {
  it("binds every claim identity field and returns only one timestamp", () => {
    for (const field of [
      '"sellerRefundId" = \'pending\'',
      '"refundClaimId" = p_claim_id',
      '"refundClaimGeneration" = p_claim_generation',
      '"refundClaimSource" = p_claim_source',
      '"refundClaimSourceId" = p_claim_source_id',
      '"refundClaimSourceGeneration"\n           IS NOT DISTINCT FROM p_claim_source_generation',
      '"refundClaimIdempotencyScope" = p_idempotency_scope',
      '"refundClaimProviderAuthorizedAt" IS NOT NULL',
    ]) {
      assert.ok(sql.includes(field), `missing exact claim binding: ${field}`);
    }
    assert.match(
      sql,
      /RETURNS TABLE\(provider_authorized_at timestamp\(3\) without time zone\)/,
    );
  });

  it("is a fixed SECURITY DEFINER projection with narrow execution", () => {
    assert.match(sql, /LANGUAGE plpgsql[\s\S]*STABLE[\s\S]*PARALLEL SAFE/);
    assert.match(sql, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/);
    assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, grainline_app_runtime/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_app_runtime/);
    assert.doesNotMatch(
      sql,
      /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|CREATE POLICY|GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)/,
    );
  });

  it("moves the application off direct Order access and validates cardinality", () => {
    assert.match(
      application,
      /FROM public\.grainline_order_refund_claim_provider_clock/,
    );
    assert.match(application, /rows\.length !== 1/);
    assert.match(application, /provider_authorized_at instanceof Date/);
    assert.doesNotMatch(application, /prisma\.order\./);
  });
});
