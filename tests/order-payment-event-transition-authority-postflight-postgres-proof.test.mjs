import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseOrderPaymentEventTransitionPostflightProofConfig,
} from "../scripts/order-payment-event-transition-authority-postflight-postgres-proof.mjs";

const LOOPBACK =
  "postgresql://grainline_app_runtime:secret@localhost:5432/grainline_ci?sslmode=disable";

test("transition postflight PostgreSQL proof accepts only the loopback runtime role", () => {
  assert.deepEqual(
    parseOrderPaymentEventTransitionPostflightProofConfig({
      ORDER_PAYMENT_EVENT_TRANSITION_POSTFLIGHT_PROOF_DATABASE_URL: LOOPBACK,
    }),
    { databaseUrl: LOOPBACK },
  );
  for (const invalid of [
    "postgresql://ci:secret@localhost:5432/grainline_ci?sslmode=disable",
    "postgresql://grainline_app_runtime:secret@example.com/grainline_ci?sslmode=disable",
    "postgresql://grainline_app_runtime:secret@localhost:5432/grainline?sslmode=disable",
    "postgresql://grainline_app_runtime:secret@localhost:5432/grainline_ci?sslmode=require",
  ]) {
    assert.throws(() => parseOrderPaymentEventTransitionPostflightProofConfig({
      ORDER_PAYMENT_EVENT_TRANSITION_POSTFLIGHT_PROOF_DATABASE_URL: invalid,
    }));
  }
});

test("transition postflight PostgreSQL proof pins runtime login and read-only scope", () => {
  const source = readFileSync(
    "scripts/order-payment-event-transition-authority-postflight-postgres-proof.mjs",
    "utf8",
  );
  assert.match(source, /grainline_app_runtime/u);
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(source, /transaction_read_only/u);
  assert.match(source, /proveOrderPaymentEventTransitionPrivateExecutionDenied/u);
  assert.doesNotMatch(source, /INSERT INTO|UPDATE public|DELETE FROM|ALTER TABLE/u);
});
