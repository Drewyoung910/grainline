import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  DEFAULT_FALLBACK_SHIPPING_CENTS,
  MAX_FALLBACK_SHIPPING_CENTS,
  MAX_PROVIDER_SHIPPING_CENTS,
  MIN_FALLBACK_SHIPPING_CENTS,
  SELLER_FLAT_RATE_OBJECT_ID,
  SELLER_FREE_RATE_OBJECT_ID,
  carrierMatchesPreference,
  filterShippoRatesForCheckout,
  isQuoteOnlyRateObjectId,
  normalizeShippoRatesForCheckout,
  preferredAutomaticShippingRate,
  quoteOnlyRateObjectId,
  resolveSellerCheckoutShippingPolicy,
  safeFallbackShippingCents,
  safeProviderShippingCents,
  safeShippingEstimatedDays,
} = await import("../src/lib/shippingQuoteState.ts");
const { SHIPPING_ESTIMATED_DAYS_MAX } = await import("../src/lib/shippingRateBounds.ts");

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

  it("drops malformed or extreme provider shipping amounts before signing", () => {
    assert.equal(safeProviderShippingCents("12.345"), 1235);
    assert.equal(safeProviderShippingCents(0), 0);
    assert.equal(safeProviderShippingCents("0"), 0);
    assert.equal(safeProviderShippingCents("-1"), null);
    assert.equal(safeProviderShippingCents("NaN"), null);
    assert.equal(safeProviderShippingCents(Infinity), null);
    assert.equal(safeProviderShippingCents((MAX_PROVIDER_SHIPPING_CENTS / 100) + 0.01), null);
  });

  it("honors seller flat and free-shipping settings without breaking legacy calculated shops", () => {
    assert.deepEqual(resolveSellerCheckoutShippingPolicy({
      useCalculatedShipping: false,
      flatRateCents: 1200,
      freeShippingOverCents: 5000,
      itemsSubtotalCents: 4900,
    }), {
      useCalculatedShipping: false,
      configuredRate: {
        objectId: SELLER_FLAT_RATE_OBJECT_ID,
        amountCents: 1200,
        label: "Flat shipping",
        carrier: "seller-flat",
        service: "flat",
      },
      ignoredStandaloneFreeThreshold: false,
    });

    assert.equal(resolveSellerCheckoutShippingPolicy({
      useCalculatedShipping: false,
      flatRateCents: 1200,
      freeShippingOverCents: 5000,
      itemsSubtotalCents: 5000,
    }).configuredRate?.objectId, SELLER_FREE_RATE_OBJECT_ID);
    assert.equal(resolveSellerCheckoutShippingPolicy({
      useCalculatedShipping: true,
      flatRateCents: 1200,
      freeShippingOverCents: 5000,
      itemsSubtotalCents: 5000,
    }).useCalculatedShipping, true);

    const legacyDefault = resolveSellerCheckoutShippingPolicy({
      useCalculatedShipping: false,
      flatRateCents: null,
      freeShippingOverCents: null,
      itemsSubtotalCents: 5000,
    });
    assert.equal(legacyDefault.useCalculatedShipping, true);
    assert.equal(legacyDefault.configuredRate, null);
  });

  it("does not treat a standalone free threshold or malformed seller money as a shipping mode", () => {
    const standaloneFree = resolveSellerCheckoutShippingPolicy({
      useCalculatedShipping: false,
      flatRateCents: null,
      freeShippingOverCents: 5000,
      itemsSubtotalCents: 9000,
    });
    assert.equal(standaloneFree.useCalculatedShipping, true);
    assert.equal(standaloneFree.configuredRate, null);
    assert.equal(standaloneFree.ignoredStandaloneFreeThreshold, true);

    for (const invalid of [-1, 1.5, MAX_PROVIDER_SHIPPING_CENTS + 1, Number.NaN]) {
      assert.equal(resolveSellerCheckoutShippingPolicy({
        useCalculatedShipping: false,
        flatRateCents: invalid,
        freeShippingOverCents: null,
        itemsSubtotalCents: 1000,
      }).configuredRate, null);
    }
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

  it("marks Shippo checkout quotes as quote-only instead of purchasable label rates", () => {
    assert.equal(quoteOnlyRateObjectId(" rate_123 "), "quote-only:rate_123");
    assert.equal(quoteOnlyRateObjectId(""), "");
    assert.equal(quoteOnlyRateObjectId(null), "");
    assert.equal(quoteOnlyRateObjectId("rate id"), "");
    assert.equal(quoteOnlyRateObjectId("x".repeat(256)), "");
    assert.equal(isQuoteOnlyRateObjectId("quote-only:rate_123"), true);
    assert.equal(isQuoteOnlyRateObjectId("rate_123"), false);
    assert.equal(isQuoteOnlyRateObjectId(" pickup "), false);
  });

  it("normalizes only provider rates that checkout can actually accept", () => {
    const rates = normalizeShippoRatesForCheckout([
      {
        object_id: "rate_1",
        amount: "12.34",
        currency: "USD",
        provider: "UPS",
        servicelevel: { name: "Ground" },
        estimated_days: 4,
      },
      {
        object_id: "rate_1",
        amount: "13.00",
        currency: "USD",
        provider: "UPS",
        servicelevel: { name: "Duplicate" },
        estimated_days: 3,
      },
      { object_id: null, amount: "8.00", currency: "USD", provider: "USPS", service: "Ground" },
      { object_id: "rate_2", amount: "8.00", currency: "USD", provider: "", service: "Ground" },
    ]);

    assert.deepEqual(rates, [{
      objectId: "quote-only:rate_1",
      amountCents: 1234,
      carrier: "UPS",
      service: "Ground",
      estDays: 4,
      label: "UPS Ground (4d)",
    }]);
  });

  it("normalizes malformed or out-of-contract delivery estimates to unknown", () => {
    assert.equal(safeShippingEstimatedDays(1), 1);
    assert.equal(safeShippingEstimatedDays(SHIPPING_ESTIMATED_DAYS_MAX), SHIPPING_ESTIMATED_DAYS_MAX);
    assert.equal(safeShippingEstimatedDays(0), null);
    assert.equal(safeShippingEstimatedDays(SHIPPING_ESTIMATED_DAYS_MAX + 1), null);
    assert.equal(safeShippingEstimatedDays(2.5), null);
    assert.equal(safeShippingEstimatedDays(null), null);
  });

  it("defaults to a shippable rate rather than silently selecting local pickup", () => {
    const pickup = { objectId: "pickup", amountCents: 0 };
    const ground = { objectId: "quote-only:ground", amountCents: 900 };
    const priority = { objectId: "quote-only:priority", amountCents: 1400 };

    assert.equal(preferredAutomaticShippingRate([pickup, priority, ground]), ground);
    assert.equal(preferredAutomaticShippingRate([pickup]), pickup);
    assert.equal(preferredAutomaticShippingRate([]), null);
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
    assert.match(route, /normalizeShippoRatesForCheckout\(filtered\.rates\)/);
    assert.match(route, /resolveSellerCheckoutShippingPolicy\(\{/);
    assert.match(route, /if \(!sellerShippingPolicy\.useCalculatedShipping\) \{/);
    assert.match(route, /sellerConfiguredRate\(\{/);
    assert.match(route, /if \(out\.length === 0\) \{\s*if \(sellerShippingPolicy\.configuredRate\) \{\s*out\.push\(\.\.\.configuredAndPickupRates\(\)\)/s);
    assert.match(route, /!out\.some\(\(rate\) => rate\.objectId === PICKUP_RATE_OBJECT_ID\)/);
    assert.match(route, /shippingFlatRateCents: true/);
    assert.match(route, /freeShippingOverCents: true/);
    assert.match(route, /useCalculatedShipping: true/);
    assert.match(route, /preferredCarriers: sellerPreferredCarriers/);
    assert.match(route, /if \(filtered\.blockedByCarrierPreference\) \{/);
    assert.match(route, /if \(sellerAllowsPickup\) \{\s*return pickupOnlyResponse/s);
    assert.match(route, /No shipping rates matched this maker's carrier preferences\./);
    assert.match(route, /if \(out\.length === 0\) \{/);
    assert.match(route, /out\.unshift\(pickupRate\(\{ currency, contextId, buyerId: me\.id, subjectHash, \.\.\.signedDestination \}\)\)/);
  });

  it("keeps shipping quote provider fallback failures observable without raw console errors", () => {
    const route = readFileSync("src/app/api/shipping/quote/route.ts", "utf8");

    assert.match(route, /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/);
    assert.match(route, /source: "shipping_quote_shippo_fallback"/);
    assert.match(route, /source: "shipping_quote_fallback_config"/);
    assert.match(route, /source: "shipping_quote_empty_rates_fallback_config"/);
    assert.match(route, /source: "shipping_quote_route"/);
    assert.match(route, /extra: \{ mode, sellerId, contextId \}/);
    assert.doesNotMatch(route, /console\.error\("Shippo quote failed; returning signed fallback rate:", err\)/);
    assert.doesNotMatch(route, /console\.error\("Site config fallback shipping lookup failed:", siteConfigError\)/);
    assert.doesNotMatch(route, /console\.error\("POST \/api\/shipping\/quote error:", err\)/);
  });

  it("minimizes Shippo quote destination payloads and keeps returned rate ids quote-only", () => {
    const route = readFileSync("src/app/api/shipping/quote/route.ts", "utf8");
    const provider = readFileSync("src/lib/shippingQuoteProvider.ts", "utf8");
    const selector = readFileSync("src/components/ShippingRateSelector.tsx", "utf8");

    assert.match(route, /normalizeShippoRatesForCheckout/);
    assert.doesNotMatch(route, /toName|toLine1|toLine2/);
    assert.match(route, /buildShippoCheckoutQuoteShipment/);
    assert.match(provider, /street1: "Rate quote only"/);
    const addressToBlock = provider.match(/address_to:\s*\{([\s\S]*?)\n\s*\},\n\s*parcels:/)?.[1] ?? "";
    assert.match(addressToBlock, /city: input\.to\.city/);
    assert.match(addressToBlock, /state: input\.to\.state/);
    assert.match(addressToBlock, /zip: input\.to\.postal/);
    assert.match(addressToBlock, /country: input\.to\.country/);
    assert.doesNotMatch(addressToBlock, /\bname:/);
    assert.doesNotMatch(addressToBlock, /\bstreet2:/);
    assert.match(route, /normalizeShippoRatesForCheckout/);
    assert.doesNotMatch(route, /objectId: objectId \|\| null/);

    assert.doesNotMatch(selector, /toName|toLine1|toLine2/);
    assert.doesNotMatch(selector, /address\.line1|address\.line2|address\.name/);
    assert.doesNotMatch(selector, /`\$\{r\.carrier\}-\$\{r\.service\}-\$\{index\}`/);
    assert.match(selector, /preferredAutomaticShippingRate\(mapped\)/);
    assert.match(selector, />\s*Retry\s*</);
  });

  it("forces seller label purchase to re-quote quote-only rates with full order recipient data", () => {
    const labelRoute = readFileSync("src/app/api/orders/[id]/label/route.ts", "utf8");

    assert.match(labelRoute, /isPickupRateObjectId,[\s\S]*isQuoteOnlyRateObjectId,[\s\S]*from "@\/lib\/shippingQuoteState"/);
    assert.match(labelRoute, /!isQuoteOnlyRateObjectId\(value\)/);
    assert.match(labelRoute, /!selectedRateId && !preflight\.storedRateUsable/);
    assert.match(labelRoute, /replaceSellerLabelQuote\(\{/);
    assert.match(labelRoute, /to: \{[\s\S]*\.\.\.preflight\.shipTo/);
  });
});
