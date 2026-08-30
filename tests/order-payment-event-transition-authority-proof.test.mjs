import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseOrderPaymentEventTransitionProofConfig,
} from "../scripts/order-payment-event-transition-authority-postgres-proof.mjs";

const source = readFileSync(
  "scripts/order-payment-event-transition-authority-postgres-proof.mjs",
  "utf8",
);

describe("OrderPaymentEvent transition-authority real PostgreSQL proof", () => {
  it("accepts only separate loopback owner and runtime identities", () => {
    const config = parseOrderPaymentEventTransitionProofConfig({
      ORDER_PAYMENT_EVENT_TRANSITION_PROOF_DATABASE_URL:
        "postgresql://ci:owner@localhost:5432/grainline_ci?sslmode=disable",
      ORDER_PAYMENT_EVENT_TRANSITION_PROOF_RUNTIME_DATABASE_URL:
        "postgresql://grainline_app_runtime:runtime@127.0.0.1:5432/grainline_ci?sslmode=disable",
    });
    assert.match(config.ownerDatabaseUrl, /\/grainline_ci/u);
    assert.match(config.runtimeDatabaseUrl, /grainline_app_runtime/u);
    assert.throws(() => parseOrderPaymentEventTransitionProofConfig({
      ORDER_PAYMENT_EVENT_TRANSITION_PROOF_DATABASE_URL:
        "postgresql://ci:owner@example.com:5432/grainline_ci",
      ORDER_PAYMENT_EVENT_TRANSITION_PROOF_RUNTIME_DATABASE_URL:
        "postgresql://grainline_app_runtime:runtime@localhost:5432/grainline_ci",
    }));
    assert.throws(() => parseOrderPaymentEventTransitionProofConfig({
      ORDER_PAYMENT_EVENT_TRANSITION_PROOF_DATABASE_URL:
        "postgresql://ci:owner@localhost:5432/not_grainline_ci",
      ORDER_PAYMENT_EVENT_TRANSITION_PROOF_RUNTIME_DATABASE_URL:
        "postgresql://grainline_app_runtime:runtime@localhost:5432/grainline_ci",
    }));
  });

  it("uses a disposable schema and proves the transition race", () => {
    assert.match(source, /CREATE SCHEMA \$\{schema\} AUTHORIZATION ci/u);
    assert.match(source, /wait_event_type === "Lock"/u);
    assert.match(source, /sameSecondConflictFailsClosed: true/u);
    assert.match(source, /unknownStatusFailsClosed: true/u);
    assert.match(source, /directProjectionForgeryRejected: true/u);
    assert.match(source, /helperExecutionDenied: true/u);
    assert.match(source, /parentOrderRaceSerialized: true/u);
    assert.match(source, /DROP SCHEMA \$\{schema\} CASCADE/u);
    assert.doesNotMatch(source, /PRODUCTION_MIGRATION_DIRECT_URL/u);
    assert.doesNotMatch(source, /process\.env\.DATABASE_URL|env\.DATABASE_URL/u);
  });
});
