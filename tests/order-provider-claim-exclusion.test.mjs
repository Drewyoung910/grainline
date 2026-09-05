import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(
  "docs/rls-drafts/order-provider-claim-exclusion.sql",
  "utf8",
);
const refundRoute = readFileSync(
  "src/app/api/orders/[id]/refund/route.ts",
  "utf8",
);
const refundState = readFileSync("src/lib/refundRouteState.ts", "utf8");
const refundPreflight = readFileSync(
  "docs/rls-drafts/order-seller-refund-preflight-authority.sql",
  "utf8",
);

describe("Order provider-claim exclusion", () => {
  it("adds only an additive, validated data invariant", () => {
    assert.match(
      migration,
      /ADD CONSTRAINT "Order_provider_claim_mutual_exclusion_check"/,
    );
    assert.match(
      migration,
      /VALIDATE CONSTRAINT "Order_provider_claim_mutual_exclusion_check"/,
    );
    assert.match(
      migration,
      /LOCK TABLE public\."Order" IN SHARE ROW EXCLUSIVE MODE/,
    );
    assert.match(
      migration,
      /found overlapping label\/refund state/,
    );
    assert.doesNotMatch(
      migration,
      /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|CREATE POLICY|GRANT|REVOKE/,
    );
  });

  it("covers completed labels and every provider-active label claim", () => {
    assert.match(migration, /"labelStatus"::text = 'PURCHASED'/);
    for (const status of [
      "PROVIDER_PENDING",
      "PROVIDER_AMBIGUOUS",
      "PROVIDER_RECORDED",
    ]) {
      assert.match(migration, new RegExp(`'${status}'`));
    }
    assert.match(migration, /"sellerRefundId" IS NOT NULL/);
    assert.match(migration, /"refundClaimId" IS NOT NULL/);
  });

  it("keeps the route guard friendly and the database race rejection fail-closed", () => {
    assert.match(refundPreflight, /locked_order\."labelStatus"::text = 'PURCHASED'/);
    assert.match(refundPreflight, /locked_order\."labelClaimStatus" IN/);
    assert.match(
      refundState,
      /Cannot refund while a shipping label purchase is active or completed/,
    );
    assert.match(
      refundRoute,
      /getPrismaRawSqlState\(error\) !== "23514"/,
    );
    assert.match(
      refundRoute,
      /freshDecision !== "LABEL_BLOCKED"/,
    );
    assert.match(refundRoute, /throw error;/);
  });
});
