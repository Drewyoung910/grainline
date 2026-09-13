import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const plan = readFileSync(
  "docs/order-authenticated-route-smoke-plan-20260902.md",
  "utf8",
);
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

describe("Order authenticated route smoke plan", () => {
  it("binds the smoke to the corrected exact application release", () => {
    assert.match(plan, /Buy Now quantity\s+correction/);
    assert.match(plan, /dirty or different Git commit/);
    assert.match(plan, /non-green exact-main CI run/);
    assert.match(plan, /deployment whose source, project, environment, aliases or READY state/);
    assert.match(plan, /Stripe or Shippo live-mode credentials/);
  });

  it("proves the quantity-two quote through checkout without charging", () => {
    assert.match(plan, /shipping\/quote[\s\S]*quantity\s+two/);
    assert.match(plan, /subject to equal the server-derived quantity-two/);
    assert.match(plan, /cart\/checkout\/single[\s\S]*quantity two/);
    assert.match(plan, /exact idempotent retry/);
    assert.match(plan, /No payment is completed/);
  });

  it("keeps label, fulfillment and buyer receipt as distinct actor proofs", () => {
    assert.match(plan, /Seller label re-quote and download/);
    assert.match(plan, /Seller notes and manual fulfillment/);
    assert.match(plan, /Buyer receipt/);
    assert.match(plan, /temporary hidden,[\s\S]*SellerProfile/);
    assert.match(plan, /retain that hidden temporary profile until final[\s\S]*cleanup/);
    assert.match(plan, /unrelated seller identity conveys[\s\S]*no authority/);
  });

  it("fails closed and makes cleanup part of acceptance", () => {
    assert.match(plan, /Cleanup is part of success/);
    assert.match(plan, /On failure, retain the[\s\S]*restart journal and stop/);
    assert.match(plan, /prove zero mutable marker-bound fixture residue across database, Redis and[\s\S]*Clerk/);
    assert.match(plan, /immutable processed Stripe[\s\S]*webhook lease/);
    assert.match(plan, /no connection strings, tokens,[\s\S]*personal data or row payloads/);
  });

  it("records failed-attempt cleanup without promoting it to smoke acceptance", () => {
    assert.match(plan, /9219201ec976f08597bf4a0ae75eae7a2dd5c9e5/);
    assert.match(plan, /33612678508/);
    assert.match(
      plan,
      /accb96c3c59c9cd1e9d0df8f12e6ef3161cf46f684ac5a4d422f07a97ead7239/,
    );
    assert.match(plan, /zero persistent mutable fixture residue/);
    assert.match(plan, /cleanup acceptance is not route-smoke[\s\S]*acceptance/i);
    assert.match(plan, /fresh corrected-fixture smoke pending/i);
  });

  it("preserves the separate Order activation sequence", () => {
    assert.match(plan, /convert the remaining pinned direct-Order/);
    assert.match(plan, /prove zero direct runtime access/);
    assert.match(plan, /enable policyless Order RLS, then FORCE it in a separate release/);
    assert.match(
      plan,
      /OrderItem[\s\S]*OrderShippingRateQuote[\s\S]*separate later activation\s+groups/,
    );
  });

  it("keeps one stable exact-main operator and cleanup entrypoint", () => {
    assert.equal(
      packageJson.scripts["ops:order-authenticated-route-smoke"],
      "node scripts/order-authenticated-route-smoke.mjs",
    );
    assert.match(plan, /ORDER_AUTH_ROUTE_SMOKE_OPERATOR_COMMIT=<exact-main-commit>/);
    assert.match(plan, /ORDER_AUTH_ROUTE_SMOKE_OPERATOR_CI_RUN_ID=<exact-green-main-ci-run-id>/);
    assert.match(plan, /ORDER_AUTH_ROUTE_SMOKE_CLEANUP_ONLY=1/);
    assert.match(plan, /Never delete or edit the journal by hand/);
  });
});
