import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  sellerDeauthorizationResultFromRows,
} from "../src/lib/orderSellerDeauthorizationState.ts";

const webhook = fs.readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
const authority = fs.readFileSync("src/lib/orderSellerDeauthorizationAuthority.ts", "utf8");

describe("Order seller deauthorization application authority", () => {
  it("parses only complete and internally consistent database results", () => {
    assert.deepEqual(sellerDeauthorizationResultFromRows([{
      outcome: "applied",
      seller_profile_id: "seller-1",
      public_visibility_changed: true,
      affected_order_count: 2n,
    }]), {
      outcome: "applied",
      sellerProfileId: "seller-1",
      publicVisibilityChanged: true,
      affectedOrderCount: 2,
    });
    assert.deepEqual(sellerDeauthorizationResultFromRows([{
      outcome: "absent",
      seller_profile_id: null,
      public_visibility_changed: false,
      affected_order_count: 0,
    }]), {
      outcome: "absent",
      sellerProfileId: null,
      publicVisibilityChanged: false,
      affectedOrderCount: 0,
    });
    for (const malformed of [
      [],
      [{ outcome: "forged", seller_profile_id: "seller-1", public_visibility_changed: true, affected_order_count: 1 }],
      [{ outcome: "applied", seller_profile_id: null, public_visibility_changed: true, affected_order_count: 1 }],
      [{ outcome: "absent", seller_profile_id: "seller-1", public_visibility_changed: false, affected_order_count: 0 }],
      [{ outcome: "absent", seller_profile_id: null, public_visibility_changed: true, affected_order_count: 0 }],
      [{ outcome: "absent", seller_profile_id: null, public_visibility_changed: false, affected_order_count: -1 }],
    ]) {
      assert.throws(() => sellerDeauthorizationResultFromRows(malformed), /seller deauthorization authority/);
    }
  });

  it("replaces the split direct writes with one generation-bound operation", () => {
    const start = webhook.indexOf('if (event.type === "account.application.deauthorized")');
    const end = webhook.indexOf('// CHECKOUT SESSION EXPIRED', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const branch = webhook.slice(start, end);

    assert.match(branch, /applyStripeSellerDeauthorization\(\{[\s\S]*claimGeneration[\s\S]*eventCreatedAt: signedPaymentTime/);
    assert.match(branch, /deauthorization\.publicVisibilityChanged[\s\S]*revalidatePublicSellerVisibilityCaches/);
    assert.match(branch, /deauthorization\.sellerProfileId[\s\S]*expireOpenCheckoutSessionsForSeller/);
    assert.doesNotMatch(branch, /prisma\.(?:sellerProfile|order)\./);
    assert.doesNotMatch(branch, /DEAUTHORIZED_SELLER_REVIEW_NOTE|updateMany|findMany/);
  });

  it("normalizes the signed Stripe instant to a UTC database timestamp", () => {
    assert.match(authority, /eventCreatedAt\.toISOString\(\)/);
    assert.match(authority, /::timestamptz AT TIME ZONE 'UTC'/);
    assert.doesNotMatch(authority, /\$\{input\.eventCreatedAt\}::timestamp/);
  });
});
