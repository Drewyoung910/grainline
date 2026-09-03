import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  classifyShippoTransactionStatus,
  normalizeShippoRateCurrency,
  normalizeShippoShipmentRates,
  shippoCredentialTestMode,
} = await import("../src/lib/shippo.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Shippo label money guardrails", () => {
  it("releases only terminal provider errors and fences every unknown status", () => {
    assert.equal(classifyShippoTransactionStatus("SUCCESS"), "SUCCESS");
    assert.equal(classifyShippoTransactionStatus("ERROR"), "REJECTED");
    assert.equal(classifyShippoTransactionStatus("WAITING"), "AMBIGUOUS");
    assert.equal(classifyShippoTransactionStatus("QUEUED"), "AMBIGUOUS");
    assert.equal(classifyShippoTransactionStatus(null), "AMBIGUOUS");
  });

  it("derives one explicit provider mode from the credential prefix", () => {
    assert.equal(shippoCredentialTestMode("shippo_test_example"), true);
    assert.equal(shippoCredentialTestMode("shippo_live_example"), false);
    assert.throws(
      () => shippoCredentialTestMode("legacy_example"),
      /does not declare a reviewed test\/live mode/,
    );
  });

  it("normalizes provider shipment rates before label re-quote persistence", () => {
    assert.equal(normalizeShippoRateCurrency(" USD "), "usd");
    assert.equal(normalizeShippoRateCurrency(null), "usd");
    assert.equal(normalizeShippoRateCurrency("US"), null);

    assert.deepEqual(
      normalizeShippoShipmentRates([
        { object_id: "rate_valid", provider: "UPS", servicelevel: { name: "Ground" }, amount: "8.50", currency: "USD", estimated_days: 3 },
        { object_id: "rate_legacy_field", provider: "UPS", servicelevel: { name: "Legacy field" }, amount: "9.00", currency: "USD", est_days: 4 },
        { object_id: "rate_zero", provider: "USPS", servicelevel: { name: "Promo" }, amount: "0", currency: "usd" },
        { object_id: "", provider: "UPS", servicelevel: { name: "Missing id" }, amount: "7.00", currency: "USD" },
        { object_id: "rate_nan", provider: "UPS", servicelevel: { name: "NaN" }, amount: "NaN", currency: "USD" },
        { object_id: "rate_negative", provider: "UPS", servicelevel: { name: "Negative" }, amount: "-1.00", currency: "USD" },
        { object_id: "rate_huge", provider: "UPS", servicelevel: { name: "Huge" }, amount: "5000.01", currency: "USD" },
        { object_id: "rate_bad_currency", provider: "UPS", servicelevel: { name: "Bad currency" }, amount: "8.50", currency: "US" },
      ]),
      [
        {
          objectId: "rate_valid",
          provider: "UPS",
          servicelevel_name: "Ground",
          amount: 850,
          currency: "usd",
          est_days: 3,
        },
        {
          objectId: "rate_legacy_field",
          provider: "UPS",
          servicelevel_name: "Legacy field",
          amount: 900,
          currency: "usd",
          est_days: null,
        },
        {
          objectId: "rate_zero",
          provider: "USPS",
          servicelevel_name: "Promo",
          amount: 0,
          currency: "usd",
          est_days: null,
        },
      ],
    );
  });

  it("keeps label purchase costs currency-scoped before Stripe reversal", () => {
    const labelRoute = source("src/app/api/orders/[id]/label/route.ts");
    const authority = source(
      "prisma/migrations/20260901140000_prepare_order_label_authority/migration.sql",
    );

    assert.match(labelRoute, /safeProviderShippingCents\(rate\.amount\)/);
    assert.match(labelRoute, /amountCents !== claim\.amountCents/);
    assert.match(labelRoute, /normalizedCurrency !== claim\.currency/);
    assert.match(labelRoute, /transaction\.test !== shippoCredentialTestMode\(\)/);
    assert.match(labelRoute, /source: "shippo_label_mode_mismatch"/);
    assert.match(labelRoute, /source: "shippo_label_nonterminal_status"/);
    assert.match(authority, /p_amount_cents IS DISTINCT FROM locked_order\."labelClaimExpectedAmountCents"/);
    assert.match(authority, /pg_catalog\.lower\(COALESCE\(p_currency, ''\)\) IS DISTINCT FROM locked_order\."labelClaimCurrency"/);
    assert.doesNotMatch(labelRoute, /Math\.round\(Number\(.*rate.*amount/);
  });
});
