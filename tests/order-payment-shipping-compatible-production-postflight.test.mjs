import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ORDER_PAYMENT_SHIPPING_COMPATIBLE_POSTFLIGHT_CONFIRMATION,
  ORDER_PAYMENT_SHIPPING_PRIVATE_FUNCTIONS,
  ORDER_PAYMENT_SHIPPING_RUNTIME_FUNCTIONS,
  assertOrderPaymentShippingCompatibleGitState,
  parseOrderPaymentShippingCompatiblePostflightConfig,
  writeOrderPaymentShippingCompatiblePostflightEvidence,
} from "../scripts/order-payment-shipping-compatible-production-postflight.mjs";

const RUNTIME_URL =
  "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const RELEASE_COMMIT = "e".repeat(40);

function tempDirectory() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "order-payment-shipping-compatible-postflight-"),
  );
}

function environment(directory, overrides = {}) {
  return {
    DATABASE_URL: RUNTIME_URL,
    ORDER_PAYMENT_SHIPPING_COMPATIBLE_MAIN_CI_RUN_ID: "30970000001",
    ORDER_PAYMENT_SHIPPING_COMPATIBLE_MIGRATION_RUN_ID: "30970000002",
    ORDER_PAYMENT_SHIPPING_COMPATIBLE_POSTFLIGHT_CONFIRM:
      ORDER_PAYMENT_SHIPPING_COMPATIBLE_POSTFLIGHT_CONFIRMATION,
    ORDER_PAYMENT_SHIPPING_COMPATIBLE_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `order-payment-shipping-compatible-production-postflight-${RELEASE_COMMIT}.json`,
    ),
    ORDER_PAYMENT_SHIPPING_COMPATIBLE_RELEASE_COMMIT: RELEASE_COMMIT,
    ...overrides,
  };
}

describe("Order/payment/shipping compatible production postflight", () => {
  it("accepts only the reviewed pooled runtime identity and exact bindings", () => {
    const directory = tempDirectory();
    try {
      const config = parseOrderPaymentShippingCompatiblePostflightConfig(
        environment(directory),
      );
      assert.equal(config.runtimeGuard.runtimeRole, "grainline_app_runtime");
      assert.equal(config.runtimeGuard.endpointId, "ep-plain-river-aaqg8gj4");
      assert.equal(config.mainCiRunId, 30970000001);
      assert.equal(config.migrationRunId, 30970000002);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects confirmation, identity, credential, run, and evidence drift", () => {
    const cases = [
      { ORDER_PAYMENT_SHIPPING_COMPATIBLE_POSTFLIGHT_CONFIRM: "yes" },
      { ORDER_PAYMENT_SHIPPING_COMPATIBLE_RELEASE_COMMIT: "short" },
      { ORDER_PAYMENT_SHIPPING_COMPATIBLE_MAIN_CI_RUN_ID: "0" },
      { ORDER_PAYMENT_SHIPPING_COMPATIBLE_MIGRATION_RUN_ID: "bad" },
      { DATABASE_URL: RUNTIME_URL.replace("grainline_app_runtime", "neondb_owner") },
      { DATABASE_URL: RUNTIME_URL.replace("-pooler", "") },
      { DIRECT_URL: "present" },
      { OTHER_DATABASE_URL: RUNTIME_URL },
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      { PGOPTIONS: "-c row_security=off" },
      {
        ORDER_PAYMENT_SHIPPING_COMPATIBLE_POSTFLIGHT_EVIDENCE_PATH:
          "/tmp/wrong.json",
      },
    ];
    for (const drift of cases) {
      const directory = tempDirectory();
      try {
        assert.throws(() =>
          parseOrderPaymentShippingCompatiblePostflightConfig(
            environment(directory, drift),
          )
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it("requires an exact clean release checkout", () => {
    assert.deepEqual(
      assertOrderPaymentShippingCompatibleGitState(
        { head: RELEASE_COMMIT, status: "" },
        RELEASE_COMMIT,
      ),
      { clean: true, head: RELEASE_COMMIT },
    );
    assert.throws(() =>
      assertOrderPaymentShippingCompatibleGitState(
        { head: RELEASE_COMMIT, status: "?? unreviewed.sql" },
        RELEASE_COMMIT,
      )
    );
  });

  it("writes sanitized evidence once with owner-only permissions", () => {
    const directory = tempDirectory();
    try {
      const evidencePath = environment(directory)
        .ORDER_PAYMENT_SHIPPING_COMPATIBLE_POSTFLIGHT_EVIDENCE_PATH;
      writeOrderPaymentShippingCompatiblePostflightEvidence(evidencePath, {
        status: "passed",
        productionChangedByPostflight: false,
      });
      assert.equal(fs.statSync(evidencePath).mode & 0o777, 0o600);
      assert.throws(() =>
        writeOrderPaymentShippingCompatiblePostflightEvidence(evidencePath, {})
      , { code: "EEXIST" });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("pins the read-only catalog and least-privilege boundary", () => {
    const source = fs.readFileSync(
      "scripts/order-payment-shipping-compatible-production-postflight.mjs",
      "utf8",
    );
    assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    assert.match(source, /transaction_read_only/);
    assert.match(source, /transaction_isolation/);
    assert.match(source, /pg_has_role\(CURRENT_USER, \$1, 'MEMBER'\)/);
    assert.match(source, /oidvectortypes\(procedure\.proargtypes\)/);
    assert.match(source, /"42501"/);
    assert.doesNotMatch(
      source,
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|FROM|public\.)/i,
    );
    assert.equal(ORDER_PAYMENT_SHIPPING_PRIVATE_FUNCTIONS.length, 4);
    assert.equal(ORDER_PAYMENT_SHIPPING_RUNTIME_FUNCTIONS.length, 6);
    assert.match(source, /stripeWebhookEventFunctionSourceSha256/);
    assert.match(source, /runtime_grant_options/);
    assert.match(source, /public_privileges/);
    assert.match(source, /direct_column_privileges/);
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    assert.equal(
      packageJson.scripts?.[
        "ops:order-payment-shipping-compatible-postflight"
      ],
      "node scripts/order-payment-shipping-compatible-production-postflight.mjs",
    );
  });
});
