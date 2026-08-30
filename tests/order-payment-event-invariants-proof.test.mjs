import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseOrderPaymentEventInvariantProofConfig,
} from "../scripts/order-payment-event-invariants-postgres-proof.mjs";

const source = readFileSync(
  "scripts/order-payment-event-invariants-postgres-proof.mjs",
  "utf8",
);

describe("OrderPaymentEvent real PostgreSQL invariant proof", () => {
  it("accepts only separate loopback owner and runtime identities", () => {
    const config = parseOrderPaymentEventInvariantProofConfig({
      ORDER_PAYMENT_EVENT_INVARIANTS_PROOF_DATABASE_URL:
        "postgresql://ci:owner@localhost:5432/grainline_ci?sslmode=disable",
      ORDER_PAYMENT_EVENT_INVARIANTS_PROOF_RUNTIME_DATABASE_URL:
        "postgresql://grainline_app_runtime:runtime@127.0.0.1:5432/grainline_ci?sslmode=disable",
    });
    assert.match(config.ownerDatabaseUrl, /\/grainline_ci/);
    assert.match(config.runtimeDatabaseUrl, /grainline_app_runtime/);
    assert.throws(() => parseOrderPaymentEventInvariantProofConfig({
      ORDER_PAYMENT_EVENT_INVARIANTS_PROOF_DATABASE_URL:
        "postgresql://ci:owner@example.com:5432/grainline_ci",
      ORDER_PAYMENT_EVENT_INVARIANTS_PROOF_RUNTIME_DATABASE_URL:
        "postgresql://grainline_app_runtime:runtime@localhost:5432/grainline_ci",
    }));
    assert.throws(() => parseOrderPaymentEventInvariantProofConfig({
      ORDER_PAYMENT_EVENT_INVARIANTS_PROOF_DATABASE_URL:
        "postgresql://ci:owner@localhost:5432/neondb",
      ORDER_PAYMENT_EVENT_INVARIANTS_PROOF_RUNTIME_DATABASE_URL:
        "postgresql://grainline_app_runtime:runtime@localhost:5432/grainline_ci",
    }));
  });

  it("uses an isolated disposable schema and proves the lock race", () => {
    assert.match(source, /CREATE SCHEMA \$\{schema\} AUTHORIZATION ci/);
    assert.match(source, /replaceAll\(/);
    assert.match(source, /"public\."/);
    assert.match(source, /`\$\{schema\}\.`/);
    assert.match(source, /wait_event_type === "Lock"/);
    assert.match(source, /currency update did not wait on the insert lock/);
    assert.match(source, /DROP SCHEMA \$\{schema\} CASCADE/);
    assert.doesNotMatch(source, /PRODUCTION_MIGRATION_DIRECT_URL/);
    assert.doesNotMatch(source, /process\.env\.DATABASE_URL|env\.DATABASE_URL/);
  });

  it("pins malformed, immutable and parent-currency rejection", () => {
    assert.match(source, /\$1::text, \$2::text, \$3::text, \$4::text/);
    assert.match(source, /500, \$5::text/);
    assert.match(source, /namespace\.nspname = \$1::text/);
    assert.match(source, /application_name = \$1::text/);
    assert.match(source, /crossCurrencyRejected: true/);
    assert.match(source, /malformedSourceRejected: true/);
    assert.match(source, /immutableDeleteRejected: true/);
    assert.match(source, /immutableUpdateRejected: true/);
    assert.match(source, /parentCurrencyRaceSerialized: true/);
    assert.match(source, /productionChanged: false/);
  });
});
