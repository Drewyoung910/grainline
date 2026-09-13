import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  orderPaymentEventTransitionAuthorityCiScopeFailureCode,
  parseOrderPaymentEventTransitionAuthorityCiScopeEnvironment,
} from "../scripts/order-payment-event-transition-authority-ci-scope-proof.mjs";

const validEnvironment = Object.freeze({
  GITHUB_ACTIONS: "true",
  GITHUB_WORKFLOW: "CI",
  GITHUB_EVENT_NAME: "pull_request",
  DIRECT_URL:
    "postgresql://ci:owner@localhost:5432/grainline_ci?sslmode=disable",
});

test("transition-authority CI scope accepts only the disposable CI database", () => {
  assert.equal(
    parseOrderPaymentEventTransitionAuthorityCiScopeEnvironment(validEnvironment)
      .directUrl,
    validEnvironment.DIRECT_URL,
  );
  assert.throws(() => parseOrderPaymentEventTransitionAuthorityCiScopeEnvironment({
    ...validEnvironment,
    DIRECT_URL: validEnvironment.DIRECT_URL.replace("localhost", "db.example.com"),
  }));
  assert.throws(() => parseOrderPaymentEventTransitionAuthorityCiScopeEnvironment({
    ...validEnvironment,
    DIRECT_URL: validEnvironment.DIRECT_URL.replace("ci:owner", "neondb_owner:owner"),
  }));
  assert.throws(() => parseOrderPaymentEventTransitionAuthorityCiScopeEnvironment({
    ...validEnvironment,
    GITHUB_ACTIONS: "false",
  }));
});

test("transition-authority CI scope is engine-read-only and calls exact scope", () => {
  const source = readFileSync(
    "scripts/order-payment-event-transition-authority-ci-scope-proof.mjs",
    "utf8",
  );
  assert.match(source, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(source, /transaction_read_only/u);
  assert.match(source, /readOrderPaymentEventTransitionAuthorityProductionSnapshotFromClient/u);
  assert.match(source, /assertOrderPaymentEventTransitionAuthorityProductionScope/u);
  assert.doesNotMatch(source, /INSERT INTO|UPDATE public|DELETE FROM|ALTER TABLE/u);
});

test("transition-authority CI scope exposes only allowlisted failure categories", () => {
  assert.equal(
    orderPaymentEventTransitionAuthorityCiScopeFailureCode(
      new Error("Order open-dispute function catalog drifted"),
    ),
    "FUNCTION_CATALOG",
  );
  assert.equal(
    orderPaymentEventTransitionAuthorityCiScopeFailureCode(
      new Error("Order open-dispute guard trigger drifted"),
    ),
    "TRIGGER_GUARD",
  );
  assert.equal(
    orderPaymentEventTransitionAuthorityCiScopeFailureCode(
      Object.assign(new Error("syntax detail"), { code: "42P01" }),
    ),
    "42P01",
  );
  assert.equal(
    orderPaymentEventTransitionAuthorityCiScopeFailureCode(
      new Error("secret-bearing unexpected diagnostic"),
    ),
    "UNCLASSIFIED",
  );
});
