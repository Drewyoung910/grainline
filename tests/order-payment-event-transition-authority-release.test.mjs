import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_PHASE,
  verifyOrderPaymentEventTransitionAuthorityRelease,
} from "../scripts/verify-order-payment-event-transition-authority-release.mjs";

describe("OrderPaymentEvent transition-authority release", () => {
  it("pins one additive projection while keeping RLS and grants unchanged", () => {
    const result = verifyOrderPaymentEventTransitionAuthorityRelease();
    assert.equal(result.phase, ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_PHASE);
    assert.equal(result.projectionColumnCount, 1);
    assert.equal(result.functionCount, 3);
    assert.equal(result.triggerCount, 2);
    assert.equal(result.rlsChanged, false);
    assert.equal(result.runtimeTablePrivilegesChanged, false);
    assert.equal(result.productionTouched, false);
  });

  it("records the source, race, anti-forgery and activation boundaries", () => {
    const decision = readFileSync(
      "docs/order-payment-event-transition-authority.md",
      "utf8",
    );
    const normalizedDecision = decision.replace(/\s+/gu, " ");
    assert.match(normalizedDecision, /database-maintained `Order` projection/u);
    assert.match(normalizedDecision, /same-provider-second conflicts fail closed/iu);
    assert.match(normalizedDecision, /parent `Order` row/u);
    assert.match(normalizedDecision, /ordinary runtime cannot execute/u);
    assert.match(normalizedDecision, /34-file semantic inventory/u);
    assert.match(normalizedDecision, /RLS and predecessor table grants remain unchanged/u);
    assert.match(normalizedDecision, /separate releases/u);
  });

  it("isolates the successor from generic production runs and applies it last in CI", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const production = readFileSync(
      ".github/workflows/production-migrations.yml",
      "utf8",
    );
    const transitionProduction = readFileSync(
      ".github/workflows/order-payment-event-transition-authority-production.yml",
      "utf8",
    );
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const isolate = ci.indexOf(
      "Isolate OrderPaymentEvent transition authority until aggregate authority passes",
    );
    const restore = ci.indexOf(
      "Restore OrderPaymentEvent transition-authority release",
    );
    const aggregateProof = ci.indexOf(
      "Prove OrderPaymentEvent aggregate postflight through the runtime login",
    );

    assert.ok(isolate > 0 && restore > aggregateProof && aggregateProof > isolate);
    assert.match(
      ci,
      /Apply OrderPaymentEvent transition authority[\s\S]*Prove OrderPaymentEvent transition locks through real logins/u,
    );
    assert.match(
      production,
      /Verify isolated OrderPaymentEvent transition-authority successor[\s\S]*Isolate unapplied OrderPaymentEvent transition-authority successor/u,
    );
    assert.match(
      transitionProduction,
      /^name: OrderPaymentEvent Transition Authority Production Compatibility$/mu,
    );
    assert.match(
      transitionProduction,
      /"transition-authority-predecessor",[\s\S]*"transition-authority-prepared"/u,
    );
    assert.match(
      transitionProduction,
      /if: steps\.scope\.outputs\.state == 'transition-authority-predecessor'[\s\S]*npx prisma migrate deploy/u,
    );
    assert.match(transitionProduction, /PGSSLROOTCERT: system/u);
    assert.equal(
      pkg.scripts?.["audit:order-payment-event-transition-authority-release"],
      "node scripts/verify-order-payment-event-transition-authority-release.mjs",
    );
    assert.equal(
      pkg.scripts?.["audit:order-payment-event-transition-authority-postgres"],
      "node scripts/order-payment-event-transition-authority-postgres-proof.mjs",
    );
    assert.equal(
      pkg.scripts?.[
        "audit:order-payment-event-transition-authority-production-scope"
      ],
      "node scripts/verify-order-payment-event-transition-authority-production-scope.mjs",
    );
    assert.equal(
      pkg.scripts?.["audit:order-payment-event-transition-authority-ci-scope"],
      "node scripts/order-payment-event-transition-authority-ci-scope-proof.mjs",
    );
    assert.match(
      ci,
      /Prove exact OrderPaymentEvent transition-authority production scope in CI[\s\S]*audit:order-payment-event-transition-authority-ci-scope/u,
    );
  });
});
