import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseOrderPaymentEventActivationProofConfig,
} from "../scripts/order-payment-event-activation-postgres-proof.mjs";

const OWNER =
  "postgresql://ci:secret@localhost:5432/grainline_ci?sslmode=disable";
const RUNTIME =
  "postgresql://grainline_app_runtime:secret@localhost:5432/grainline_ci?sslmode=disable";

test("activation PostgreSQL proof accepts only separate loopback owner and runtime logins", () => {
  assert.deepEqual(parseOrderPaymentEventActivationProofConfig({
    ORDER_PAYMENT_EVENT_ACTIVATION_PROOF_DATABASE_URL: OWNER,
    ORDER_PAYMENT_EVENT_ACTIVATION_PROOF_RUNTIME_DATABASE_URL: RUNTIME,
  }), { ownerUrl: OWNER, runtimeUrl: RUNTIME });

  for (const [ownerUrl, runtimeUrl] of [
    [RUNTIME, RUNTIME],
    [OWNER, OWNER],
    [OWNER.replace("localhost", "example.invalid"), RUNTIME],
    [OWNER, RUNTIME.replace("grainline_ci", "grainline")],
    [OWNER, RUNTIME.replace("sslmode=disable", "sslmode=require")],
  ]) {
    assert.throws(() => parseOrderPaymentEventActivationProofConfig({
      ORDER_PAYMENT_EVENT_ACTIVATION_PROOF_DATABASE_URL: ownerUrl,
      ORDER_PAYMENT_EVENT_ACTIVATION_PROOF_RUNTIME_DATABASE_URL: runtimeUrl,
    }));
  }
});

test("activation PostgreSQL proof covers catalog, direct denial and retained projections", () => {
  const source = readFileSync(
    "scripts/order-payment-event-activation-postgres-proof.mjs",
    "utf8",
  );
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(source, /directTableOperationsDenied: 4/u);
  assert.match(source, /retiredFunctionExecutionsDenied: 2/u);
  assert.match(source, /grainline_order_payment_buyer_refund_outcomes/u);
  assert.match(source, /grainline_order_payment_seller_export_page/u);
  assert.match(source, /Staff payment timeline access denied/u);
});
