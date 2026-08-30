import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_PHASE,
  verifyOrderPaymentEventAggregateAuthorityRelease,
} from "../scripts/verify-order-payment-event-aggregate-authority-release.mjs";

describe("OrderPaymentEvent aggregate-authority release", () => {
  it("pins the additive projection migration and keeps RLS/grants unchanged", () => {
    const result = verifyOrderPaymentEventAggregateAuthorityRelease();
    assert.equal(result.phase, ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_PHASE);
    assert.equal(result.projectionColumnCount, 2);
    assert.equal(result.functionCount, 3);
    assert.equal(result.triggerCount, 2);
    assert.equal(result.rlsChanged, false);
    assert.equal(result.runtimeTablePrivilegesChanged, false);
    assert.equal(result.productionTouched, false);
  });

  it("records the anti-forgery, race and separate activation boundary", () => {
    const decision = readFileSync(
      "docs/order-payment-event-aggregate-authority.md",
      "utf8",
    );
    assert.match(decision, /database-maintained projections/u);
    assert.match(decision, /`VOLATILE` is intentional/u);
    assert.match(decision, /revoke execution from `PUBLIC` and\s+`grainline_app_runtime`/u);
    assert.match(decision, /locks the qualifying parent\s+Order `FOR UPDATE`/u);
    assert.match(decision, /semantic inventory remains exactly 33 files/u);
    assert.match(decision, /policyless `ENABLE` and later `FORCE` RLS as separate releases/u);
    assert.match(decision, /does not authorize production migration/u);
  });
});
