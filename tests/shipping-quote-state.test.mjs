import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  DEFAULT_FALLBACK_SHIPPING_CENTS,
  MIN_FALLBACK_SHIPPING_CENTS,
  carrierMatchesPreference,
  filterShippoRatesForCheckout,
  safeFallbackShippingCents,
} = await import("../src/lib/shippingQuoteState.ts");

describe("shipping quote state helpers", () => {
  it("clamps configured fallback shipping to the minimum buyer-visible amount", () => {
    assert.equal(safeFallbackShippingCents(null), DEFAULT_FALLBACK_SHIPPING_CENTS);
    assert.equal(safeFallbackShippingCents(undefined), DEFAULT_FALLBACK_SHIPPING_CENTS);
    assert.equal(safeFallbackShippingCents(0), MIN_FALLBACK_SHIPPING_CENTS);
    assert.equal(safeFallbackShippingCents(499), MIN_FALLBACK_SHIPPING_CENTS);
    assert.equal(safeFallbackShippingCents(999.6), 1000);
  });

  it("matches preferred carriers exactly without substring false positives", () => {
    assert.equal(carrierMatchesPreference({ provider: "UPS" }, "ups"), true);
    assert.equal(carrierMatchesPreference({ provider: "UPS Ground" }, "UPS"), true);
    assert.equal(carrierMatchesPreference({ provider: "UPSERT Logistics" }, "UPS"), false);
    assert.equal(carrierMatchesPreference({ provider: "USPS" }, "UPS"), false);
  });

  it("reports when carrier preferences filtered out otherwise valid rates", () => {
    const result = filterShippoRatesForCheckout({
      currency: "usd",
      preferredCarriers: ["UPS"],
      rates: [
        { currency: "USD", provider: "USPS", amount: "8.50" },
        { currency: "CAD", provider: "UPS", amount: "10.00" },
      ],
    });

    assert.deepEqual(result, {
      rates: [],
      blockedByCarrierPreference: true,
    });
  });

  it("does not mark empty carrier matches when no same-currency rates exist", () => {
    const result = filterShippoRatesForCheckout({
      currency: "usd",
      preferredCarriers: ["UPS"],
      rates: [{ currency: "CAD", provider: "UPS", amount: "10.00" }],
    });

    assert.deepEqual(result, {
      rates: [],
      blockedByCarrierPreference: false,
    });
  });
});
