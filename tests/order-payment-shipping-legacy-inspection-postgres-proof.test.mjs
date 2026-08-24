import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parseOrderPaymentShippingLegacyInspectionProofConfig } from "../scripts/order-payment-shipping-legacy-inspection-postgres-proof.mjs";

const proof = readFileSync(
  "scripts/order-payment-shipping-legacy-inspection-postgres-proof.mjs",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

describe("Order/payment/shipping legacy inspection PostgreSQL proof", () => {
  it("refuses non-loopback and non-disposable database targets", () => {
    assert.throws(
      () => parseOrderPaymentShippingLegacyInspectionProofConfig({}),
      /ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_PROOF_DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        parseOrderPaymentShippingLegacyInspectionProofConfig({
          ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_PROOF_DATABASE_URL:
            "postgresql://ci:ci@database.example/grainline_ci",
        }),
      /refuses a non-loopback database/,
    );
    assert.throws(
      () =>
        parseOrderPaymentShippingLegacyInspectionProofConfig({
          ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_PROOF_DATABASE_URL:
            "postgresql://ci:ci@127.0.0.1/production",
        }),
      /requires the grainline_ci database/,
    );
    assert.deepEqual(
      parseOrderPaymentShippingLegacyInspectionProofConfig({
        ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_PROOF_DATABASE_URL:
          "postgresql://ci:ci@127.0.0.1/grainline_ci",
      }),
      {
        databaseUrl: "postgresql://ci:ci@127.0.0.1/grainline_ci",
      },
    );
  });

  it("executes the exact aggregate query in an engine-attested read-only transaction", () => {
    assert.match(proof, /ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL/);
    assert.match(
      proof,
      /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/,
    );
    assert.match(proof, /transaction_read_only/);
    assert.match(proof, /normalizeOrderPaymentShippingLegacyCounts/);
    assert.match(proof, /ORDER_FULFILLMENT_TIMESTAMP_INVALID_PREDICATE/);
    assert.match(proof, /ORDER_PAYMENT_EVENT_SIGNED_SOURCE_INVALID_PREDICATE/);
    assert.match(proof, /ORDER_PAYMENT_EVENT_LOCAL_SOURCE_INVALID_PREDICATE/);
    assert.match(proof, /ORDER_PAYMENT_EVENT_REFUND_SOURCE_INVALID_PREDICATE/);
    assert.match(proof, /ORDER_PAYMENT_EVENT_DISPUTE_SOURCE_INVALID_PREDICATE/);
    assert.match(proof, /ORDER_PICKUP_STATE_INVALID_PREDICATE/);
    assert.match(proof, /STRIPE_WEBHOOK_STATE_INVALID_PREDICATE/);
    assert.match(proof, /valid_signed_rejected: 0/);
    assert.match(proof, /invalid_signed_rejected: 2/);
    assert.match(proof, /valid_local_rejected: 0/);
    assert.match(proof, /invalid_local_rejected: 2/);
    assert.match(proof, /valid_dispute_rejected: 0/);
    assert.match(proof, /invalid_dispute_rejected: 1/);
    assert.match(proof, /cross_order_object_detected: 1/);
    assert.match(proof, /same_second_dispute_conflict_detected: 1/);
    assert.match(proof, /paymentEventSemanticsAccepted: true/);
    assert.match(proof, /timestampSemanticsAccepted: true/);
    assert.match(proof, /await client\.query\("ROLLBACK"\)/);
    assert.match(proof, /productionChanged: false/);
    assert.doesNotMatch(proof, /process\.env\.DATABASE_URL/);
  });

  it("runs after the compatible migration tree in PostgreSQL 16 CI", () => {
    assert.match(ci, /image: postgres:16/);
    assert.match(
      ci,
      /Apply migrations to CI Postgres[\s\S]*Prove Order\/payment\/shipping legacy inspection SQL in ephemeral PostgreSQL/,
    );
    assert.match(
      ci,
      /ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/,
    );
    assert.equal(
      packageJson.scripts[
        "audit:rls-order-payment-shipping-legacy-inspection-postgres"
      ],
      "node scripts/order-payment-shipping-legacy-inspection-postgres-proof.mjs",
    );
  });
});
