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

  it("has a restart-safe exact-main production runner", () => {
    const workflow = readFileSync(
      ".github/workflows/order-payment-event-aggregate-authority-production.yml",
      "utf8",
    );
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));

    assert.match(workflow, /^name: OrderPaymentEvent Aggregate Authority Production Compatibility$/mu);
    assert.match(workflow, /environment: Production/u);
    assert.match(workflow, /mainCi\.head_sha !== releaseCommit/u);
    assert.match(workflow, /inspection\.head_sha !== releaseCommit/u);
    assert.match(workflow, /Order Payment Shipping Legacy Inspection/u);
    assert.match(workflow, /guard-production-migration-runner\.mjs/u);
    assert.match(
      workflow,
      /latest[\s\S]*20260830010000_prepare_order_payment_event_aggregate_authority/u,
    );
    assert.match(
      workflow,
      /ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_SCOPE_STAGE: restart/u,
    );
    assert.match(
      workflow,
      /"aggregate-authority-predecessor",[\s\S]*"aggregate-authority-prepared"/u,
    );
    assert.match(
      workflow,
      /if: steps\.scope\.outputs\.state == 'aggregate-authority-predecessor'[\s\S]*npx prisma migrate deploy/u,
    );
    assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
    assert.match(
      workflow,
      /ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_SCOPE_STAGE: after/u,
    );
    assert.match(workflow, /audit:db-grants -- --require-direct-url/u);
    assert.doesNotMatch(
      workflow,
      /vercel deploy|stripe|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/iu,
    );
    assert.equal(
      pkg.scripts?.[
        "audit:order-payment-event-aggregate-authority-production-scope"
      ],
      "node scripts/verify-order-payment-event-aggregate-authority-production-scope.mjs",
    );
    assert.equal(
      pkg.scripts?.["audit:order-payment-event-aggregate-authority-ci-scope"],
      "node scripts/order-payment-event-aggregate-authority-ci-scope-proof.mjs",
    );
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    assert.match(
      ci,
      /Prove exact OrderPaymentEvent aggregate-authority scope in CI[\s\S]*?audit:order-payment-event-aggregate-authority-ci-scope/u,
    );
  });
});
