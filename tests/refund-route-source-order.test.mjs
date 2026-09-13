import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("seller refund route source-order guardrails", () => {
  it("releases stale refund locks only inside durable seller authority", () => {
    const route = readFileSync("src/app/api/orders/[id]/refund/route.ts", "utf8");
    const authority = readFileSync(
      "docs/rls-drafts/order-seller-refund-preflight-authority.sql",
      "utf8",
    );
    const actorLock = authority.indexOf('FROM public."User" AS actor');
    const sellerLock = authority.indexOf('FROM public."SellerProfile" AS seller');
    const orderLock = authority.indexOf('FROM public."Order" AS source_order');
    const lockRelease = authority.indexOf('UPDATE public."Order" AS source_order');

    assert.match(route, /sellerRefundPreflight\(\{/);
    assert.doesNotMatch(route, /releaseStaleRefundLocks|\bprisma\.order\b/);
    assert.match(authority, /locked_order\."sellerProfileId" IS DISTINCT FROM locked_seller\.id/);
    assert.ok(
      actorLock >= 0 && actorLock < sellerLock && sellerLock < orderLock && orderLock < lockRelease,
      "refund lock cleanup must not run before durable Order ownership is verified",
    );
    assert.match(authority, /"caseResolutionClaimId" IS NULL/);
    assert.match(authority, /"refundClaimId" IS NULL/);
  });
});
