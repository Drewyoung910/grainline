import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseOrderPaymentEventAggregateAuthorityCiScopeEnvironment,
} from "../scripts/order-payment-event-aggregate-authority-ci-scope-proof.mjs";

const validEnvironment = Object.freeze({
  GITHUB_ACTIONS: "true",
  GITHUB_WORKFLOW: "CI",
  GITHUB_EVENT_NAME: "pull_request",
  DIRECT_URL:
    "postgresql://ci:owner@localhost:5432/grainline_ci?sslmode=disable",
});

test("aggregate-authority CI scope accepts only the disposable CI database", () => {
  assert.equal(
    parseOrderPaymentEventAggregateAuthorityCiScopeEnvironment(validEnvironment)
      .directUrl,
    validEnvironment.DIRECT_URL,
  );
  assert.throws(() => parseOrderPaymentEventAggregateAuthorityCiScopeEnvironment({
    ...validEnvironment,
    DIRECT_URL: validEnvironment.DIRECT_URL.replace("localhost", "db.example.com"),
  }));
  assert.throws(() => parseOrderPaymentEventAggregateAuthorityCiScopeEnvironment({
    ...validEnvironment,
    DIRECT_URL: validEnvironment.DIRECT_URL.replace("ci:owner", "neondb_owner:owner"),
  }));
  assert.throws(() => parseOrderPaymentEventAggregateAuthorityCiScopeEnvironment({
    ...validEnvironment,
    GITHUB_ACTIONS: "false",
  }));
});

test("aggregate-authority CI scope is engine-read-only and calls exact scope", () => {
  const source = readFileSync(
    "scripts/order-payment-event-aggregate-authority-ci-scope-proof.mjs",
    "utf8",
  );
  assert.match(source, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(source, /transaction_read_only/u);
  assert.match(source, /readOrderPaymentEventAggregateAuthorityProductionSnapshotFromClient/u);
  assert.match(source, /assertOrderPaymentEventAggregateAuthorityProductionScope/u);
  assert.doesNotMatch(source, /INSERT INTO|UPDATE public|DELETE FROM|ALTER TABLE/u);
});
