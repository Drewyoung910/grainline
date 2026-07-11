import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildEvidencePayload,
  parseConfig,
} from "../scripts/shipping-currency-drift-proof.mjs";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("shipping currency drift proof harness", () => {
  it("is wired as an explicit confirm-gated launch evidence command", () => {
    const pkg = JSON.parse(source("package.json"));
    const script = source("scripts/shipping-currency-drift-proof.mjs");

    assert.equal(pkg.scripts["audit:shipping-currency"], "node scripts/shipping-currency-drift-proof.mjs");
    assert.match(script, /const CONFIRMATION_VALUE = "read-only"/);
    assert.match(script, /SHIPPING_CURRENCY_PROOF_CONFIRM=\$\{CONFIRMATION_VALUE\} is required/);
    assert.match(script, /SHIPPING_CURRENCY_PROOF_EVIDENCE_PATH/);
    assert.match(script, /DATABASE_URL/);
    assert.match(script, /DEFAULT_ALLOWED_CURRENCIES = \["usd"\]/);
    assert.match(script, /PrismaPg/);
    assert.match(script, /new PrismaClient\(\{ adapter \}\)/);
  });

  it("requires read-only confirmation, DATABASE_URL, valid currencies, and in-repo evidence paths", () => {
    assert.throws(
      () => parseConfig({ DATABASE_URL: "postgres://user:pass@example/db", SHIPPING_CURRENCY_PROOF_EVIDENCE_PATH: "shipping.json" }),
      /SHIPPING_CURRENCY_PROOF_CONFIRM=read-only is required/,
    );
    assert.throws(
      () =>
        parseConfig({
          SHIPPING_CURRENCY_PROOF_CONFIRM: "read-only",
          SHIPPING_CURRENCY_PROOF_EVIDENCE_PATH: "shipping.json",
        }),
      /DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        parseConfig({
          SHIPPING_CURRENCY_PROOF_CONFIRM: "read-only",
          SHIPPING_CURRENCY_PROOF_EVIDENCE_PATH: "../shipping.json",
          DATABASE_URL: "postgres://user:pass@example/db",
        }),
      /must stay inside the repository/,
    );
    assert.throws(
      () =>
        parseConfig({
          SHIPPING_CURRENCY_PROOF_CONFIRM: "read-only",
          SHIPPING_CURRENCY_PROOF_EVIDENCE_PATH: "shipping.json",
          DATABASE_URL: "postgres://user:pass@example/db",
          SHIPPING_CURRENCY_PROOF_ALLOWED_CURRENCIES: "usd,12",
        }),
      /ISO currency codes/,
    );

    const config = parseConfig({
      SHIPPING_CURRENCY_PROOF_CONFIRM: "read-only",
      SHIPPING_CURRENCY_PROOF_EVIDENCE_PATH: "shipping.json",
      DATABASE_URL: "postgres://user:pass@example/db",
      SHIPPING_CURRENCY_PROOF_ALLOWED_CURRENCIES: "USD, cad,usd",
      SHIPPING_CURRENCY_PROOF_SAMPLE_LIMIT: "7",
    });

    assert.deepEqual(config.allowedCurrencies, ["cad", "usd"]);
    assert.equal(config.sampleLimit, 7);
    assert.ok(config.evidencePath.endsWith("/grainline/shipping.json"));
    assert.equal(typeof config.databaseHostHash, "string");
  });

  it("scans the historical drift surfaces that source review cannot close", () => {
    const script = source("scripts/shipping-currency-drift-proof.mjs");

    for (const token of [
      "prisma.listing.groupBy",
      "prisma.order.groupBy",
      "shippingFlatRateCents",
      "freeShippingOverCents",
      "nonAllowedListingCurrencies",
      "nonAllowedOrderCurrencies",
      "currencylessShippingWithNonAllowedListings",
      "currencylessShippingWithMixedListingCurrencies",
      "nonAllowedPaidShippingOrders",
      "nonAllowedLabelCostOrders",
      "quoteRateCurrencyMismatches",
      "OrderShippingRateQuote",
      "jsonb_array_elements",
      "LOWER(COALESCE(rate->>'currency'",
    ]) {
      assert.match(script, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("keeps retained evidence sanitized and identifier-bounded", () => {
    const script = source("scripts/shipping-currency-drift-proof.mjs");
    const payload = buildEvidencePayload({
      config: {
        allowedCurrencies: ["usd"],
        databaseHostHash: "db-host-hash",
      },
      status: "failed",
      startedAt: "2026-07-10T00:00:00.000Z",
      completedAt: "2026-07-10T00:00:01.000Z",
      findings: {
        nonAllowedListingCurrencies: {
          count: 1,
          samples: [{ listingIdHash: "hash", sellerIdHash: "hash2", currency: "eur" }],
        },
      },
      actionableCount: 1,
      issues: [
        'DATABASE_URL="postgres://user:secret@example/db"',
        "Authorization: Bearer secret-token-value",
      ],
    });
    const serialized = JSON.stringify(payload);

    assert.match(script, /hashValue\(row\.id\)/);
    assert.match(script, /sellerIdHash: hashValue/);
    assert.match(script, /orderIdHash: hashValue/);
    assert.match(script, /quoteIdHash: hashValue/);
    assert.doesNotMatch(script, /listingId: row\.id/);
    assert.match(serialized, /\[redacted-shipping-currency-proof-env\]/);
    assert.match(serialized, /Bearer \[redacted-token\]/);
    assert.doesNotMatch(serialized, /postgres:\/\/user:secret/);
    assert.doesNotMatch(serialized, /secret-token-value/);
  });

  it("keeps launch docs tied to the retained proof artifact", () => {
    const launch = source("docs/launch-checklist.md");
    const runbook = source("docs/runbook.md");
    const backlog = source("docs/deferred-launch-backlog.md");
    const claude = source("CLAUDE.md");

    assert.match(launch, /npm run audit:shipping-currency/);
    assert.match(runbook, /npm run audit:shipping-currency/);
    assert.match(backlog, /`npm run audit:shipping-currency`/);
    assert.match(claude, /Do not close historical shipping-rate currency drift from source review alone/);
  });
});
