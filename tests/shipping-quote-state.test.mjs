import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  DEFAULT_FALLBACK_SHIPPING_CENTS,
  MAX_FALLBACK_SHIPPING_CENTS,
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
    assert.equal(safeFallbackShippingCents(5001), MAX_FALLBACK_SHIPPING_CENTS);
    assert.equal(safeFallbackShippingCents(99999999), MAX_FALLBACK_SHIPPING_CENTS);
  });

  it("keeps the singleton SiteConfig seed migration in place", () => {
    const migration = readFileSync(
      "prisma/migrations/20260521161000_seed_site_config_and_fallback_cap/migration.sql",
      "utf8",
    );

    assert.match(migration, /INSERT INTO "SiteConfig" \("id", "fallbackShippingCents"\)/);
    assert.match(migration, /VALUES \(1, 1500\)/);
    assert.match(migration, /ON CONFLICT \("id"\) DO NOTHING/);
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

  it("keeps the quote route fallback and pickup paths behind shared quote helpers", () => {
    const route = readFileSync("src/app/api/shipping/quote/route.ts", "utf8");

    assert.match(route, /fallbackRate\(\{\s*amountCents: safeFallbackShippingCents\(fallbackShippingCents\)/s);
    assert.match(route, /const filtered = filterShippoRatesForCheckout\(\{/);
    assert.match(route, /preferredCarriers: sellerPreferredCarriers/);
    assert.match(route, /if \(filtered\.blockedByCarrierPreference\) \{/);
    assert.match(route, /if \(sellerAllowsPickup\) \{\s*return pickupOnlyResponse/s);
    assert.match(route, /No shipping rates matched this maker's carrier preferences\./);
    assert.match(route, /if \(out\.length === 0 && !sellerAllowsPickup\) \{/);
    assert.match(route, /out\.unshift\(pickupRate\(\{ contextId, buyerId: me\.id, buyerPostal: shipTo\.postal \}\)\)/);
  });
});
