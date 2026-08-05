import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  parseOrderPaymentShippingCompatiblePostflightProofConfig,
} from "../scripts/order-payment-shipping-compatible-postflight-postgres-proof.mjs";

const LOOPBACK_URL =
  "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable";

describe("Order/payment/shipping compatible postflight PostgreSQL proof", () => {
  it("accepts only the disposable loopback owner database", () => {
    assert.equal(
      parseOrderPaymentShippingCompatiblePostflightProofConfig({
        ORDER_PAYMENT_SHIPPING_COMPATIBLE_POSTFLIGHT_PROOF_DATABASE_URL:
          LOOPBACK_URL,
      }).databaseUrl,
      LOOPBACK_URL,
    );
    for (const databaseUrl of [
      LOOPBACK_URL.replace("127.0.0.1", "example.com"),
      LOOPBACK_URL.replace("grainline_ci", "production"),
      LOOPBACK_URL.replace("ci:ci@", "grainline_app_runtime:runtime@"),
    ]) {
      assert.throws(() =>
        parseOrderPaymentShippingCompatiblePostflightProofConfig({
          ORDER_PAYMENT_SHIPPING_COMPATIBLE_POSTFLIGHT_PROOF_DATABASE_URL:
            databaseUrl,
        })
      );
    }
  });

  it("temporarily authenticates runtime and always removes the proof password", () => {
    const source = fs.readFileSync(
      "scripts/order-payment-shipping-compatible-postflight-postgres-proof.mjs",
      "utf8",
    );
    assert.match(
      source,
      /ALTER ROLE grainline_app_runtime\s+PASSWORD 'order-payment-shipping-compatible-proof'/,
    );
    assert.match(
      source,
      /finally \{[\s\S]*ALTER ROLE grainline_app_runtime PASSWORD NULL/,
    );
    assert.match(source, /runOrderPaymentShippingCompatiblePostflight/);
    const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
    assert.match(
      workflow,
      /Prove Order\/payment\/shipping compatible postflight under the runtime role[\s\S]{0,300}ORDER_PAYMENT_SHIPPING_COMPATIBLE_POSTFLIGHT_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/,
    );
  });
});
