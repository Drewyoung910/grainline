import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  normalizeShippoRateCurrency,
  normalizeShippoShipmentRates,
} = await import("../src/lib/shippo.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Shippo label money guardrails", () => {
  it("normalizes provider shipment rates before label re-quote persistence", () => {
    assert.equal(normalizeShippoRateCurrency(" USD "), "usd");
    assert.equal(normalizeShippoRateCurrency(null), "usd");
    assert.equal(normalizeShippoRateCurrency("US"), null);

    assert.deepEqual(
      normalizeShippoShipmentRates([
        { object_id: "rate_valid", provider: "UPS", servicelevel: { name: "Ground" }, amount: "8.50", currency: "USD", est_days: 3 },
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

    assert.match(labelRoute, /const expectedLabelCurrency = normalizeCurrencyCode\(order\.currency\)\.toLowerCase\(\)/);
    assert.match(labelRoute, /rateSetIncludes\(quoteSet\.rates, bodyRateObjectId, expectedLabelCurrency\)/);
    assert.match(labelRoute, /rateCurrency !== expectedLabelCurrency/);
    assert.match(labelRoute, /safeProviderShippingCents\(txn\.rate\?\.amount\)/);
    assert.match(labelRoute, /txnRateCurrency === expectedLabelCurrency/);
    assert.match(labelRoute, /labelClawbackStatus: invalidLabelCost \? "MANUAL_REVIEW" : undefined/);
    assert.match(labelRoute, /labelCostCents != null && labelCostCents > 0/);
    assert.doesNotMatch(labelRoute, /Math\.round\(Number\(txn\.rate\?\.amount/);
  });
});
