import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseOrderPaymentEventAggregatePostflightProofConfig,
} from "../scripts/order-payment-event-aggregate-authority-postflight-postgres-proof.mjs";

const LOOPBACK =
  "postgresql://grainline_app_runtime:proof@localhost:5432/grainline_ci?sslmode=disable";

test("aggregate-authority postflight PostgreSQL proof accepts only runtime loopback", () => {
  assert.deepEqual(
    parseOrderPaymentEventAggregatePostflightProofConfig({
      ORDER_PAYMENT_EVENT_AGGREGATE_POSTFLIGHT_PROOF_DATABASE_URL: LOOPBACK,
    }),
    { databaseUrl: LOOPBACK },
  );
  for (const invalid of [
    LOOPBACK.replace("localhost", "production.example.com"),
    LOOPBACK.replace("grainline_app_runtime", "ci"),
    LOOPBACK.replace("grainline_ci", "neondb"),
    LOOPBACK.replace("sslmode=disable", "sslmode=require"),
  ]) {
    assert.throws(() => parseOrderPaymentEventAggregatePostflightProofConfig({
      ORDER_PAYMENT_EVENT_AGGREGATE_POSTFLIGHT_PROOF_DATABASE_URL: invalid,
    }));
  }
});

test("aggregate-authority postflight PostgreSQL proof uses the production readers", () => {
  const source = readFileSync(
    "scripts/order-payment-event-aggregate-authority-postflight-postgres-proof.mjs",
    "utf8",
  );
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(source, /transaction_read_only/u);
  assert.match(source, /readOrderPaymentEventAggregateAuthorityRuntimeSnapshot/u);
  assert.match(source, /assertOrderPaymentEventAggregateAuthorityRuntimeSnapshot/u);
  assert.match(source, /functionOwner: "ci"/u);
  assert.match(source, /proveOrderPaymentEventAggregatePrivateExecutionDenied/u);
  assert.doesNotMatch(source, /INSERT INTO|UPDATE public|DELETE FROM|ALTER TABLE/u);
});
