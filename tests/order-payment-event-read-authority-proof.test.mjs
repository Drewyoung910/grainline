import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseOrderPaymentEventReadProofConfig,
} from "../scripts/order-payment-event-read-authority-postgres-proof.mjs";

const source = readFileSync(
  "scripts/order-payment-event-read-authority-postgres-proof.mjs",
  "utf8",
);

describe("OrderPaymentEvent read-authority real PostgreSQL proof", () => {
  it("accepts only separate loopback owner and runtime identities", () => {
    const config = parseOrderPaymentEventReadProofConfig({
      ORDER_PAYMENT_EVENT_READ_PROOF_DATABASE_URL:
        "postgresql://ci:owner@localhost:5432/grainline_ci?sslmode=disable",
      ORDER_PAYMENT_EVENT_READ_PROOF_RUNTIME_DATABASE_URL:
        "postgresql://grainline_app_runtime:runtime@127.0.0.1:5432/grainline_ci?sslmode=disable",
    });
    assert.match(config.ownerDatabaseUrl, /\/grainline_ci/);
    assert.match(config.runtimeDatabaseUrl, /grainline_app_runtime/);
    assert.throws(() => parseOrderPaymentEventReadProofConfig({
      ORDER_PAYMENT_EVENT_READ_PROOF_DATABASE_URL:
        "postgresql://ci:owner@example.com:5432/grainline_ci",
      ORDER_PAYMENT_EVENT_READ_PROOF_RUNTIME_DATABASE_URL:
        "postgresql://grainline_app_runtime:runtime@localhost:5432/grainline_ci",
    }));
  });

  it("uses a disposable schema and proves the exact authority dimensions", () => {
    assert.match(source, /CREATE SCHEMA \$\{schema\} AUTHORIZATION ci/);
    assert.match(source, /buyerIsolationProven: true/);
    assert.match(source, /sellerIsolationProven: true/);
    assert.match(source, /staffBoundaryProven: true/);
    assert.match(source, /publicExecuteRevoked: true/);
    assert.match(source, /predecessorCrudRetained: true/);
    assert.match(source, /DROP SCHEMA \$\{schema\} CASCADE/);
    assert.doesNotMatch(source, /PRODUCTION_MIGRATION_DIRECT_URL/);
    assert.doesNotMatch(source, /process\.env\.DATABASE_URL|env\.DATABASE_URL/);
  });

  it("pins explicit PostgreSQL parameter types", () => {
    assert.match(source, /namespace\.nspname = \$1::text/);
    assert.match(source, /\$1::text, \$2::text\[\]/);
    assert.match(source, /\$1::text, \$2::text, 25/);
  });
});
