import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  DEFAULT_FALLBACK_SHIPPING_CENTS,
  MAX_FALLBACK_SHIPPING_CENTS,
  MAX_PROVIDER_SHIPPING_CENTS,
  MIN_FALLBACK_SHIPPING_CENTS,
  carrierMatchesPreference,
  filterShippoRatesForCheckout,
  isQuoteOnlyRateObjectId,
  quoteOnlyRateObjectId,
  safeFallbackShippingCents,
  safeProviderShippingCents,
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

  it("drops malformed or extreme provider shipping amounts before signing", () => {
    assert.equal(safeProviderShippingCents("12.345"), 1235);
    assert.equal(safeProviderShippingCents(0), 0);
    assert.equal(safeProviderShippingCents("0"), 0);
    assert.equal(safeProviderShippingCents("-1"), null);
    assert.equal(safeProviderShippingCents("NaN"), null);
    assert.equal(safeProviderShippingCents(Infinity), null);
    assert.equal(safeProviderShippingCents((MAX_PROVIDER_SHIPPING_CENTS / 100) + 0.01), null);
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
    assert.equal(isQuoteOnlyRateObjectId("quote-only:rate_123"), true);
    assert.equal(isQuoteOnlyRateObjectId("rate_123"), false);
    assert.equal(isQuoteOnlyRateObjectId(" pickup "), false);
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
    assert.match(route, /const amountCents = safeProviderShippingCents\(r\.amount\)/);
    assert.match(route, /if \(amountCents === null\) return \[\]/);
    assert.match(route, /preferredCarriers: sellerPreferredCarriers/);
    assert.match(route, /if \(filtered\.blockedByCarrierPreference\) \{/);
    assert.match(route, /if \(sellerAllowsPickup\) \{\s*return pickupOnlyResponse/s);
    assert.match(route, /No shipping rates matched this maker's carrier preferences\./);
    assert.match(route, /if \(out\.length === 0 && !sellerAllowsPickup\) \{/);
    assert.match(route, /out\.unshift\(pickupRate\(\{ currency, contextId, buyerId: me\.id, buyerPostal: shipTo\.postal \}\)\)/);
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
    const selector = readFileSync("src/components/ShippingRateSelector.tsx", "utf8");

    assert.match(route, /quoteOnlyRateObjectId/);
    assert.doesNotMatch(route, /toName|toLine1|toLine2/);
    assert.match(route, /street1: "Rate quote only"/);
    const addressToBlock = route.match(/address_to:\s*\{([\s\S]*?)\n\s*\},\n\s*parcels:/)?.[1] ?? "";
    assert.match(addressToBlock, /city: shipTo\.city/);
    assert.match(addressToBlock, /state: shipTo\.state/);
    assert.match(addressToBlock, /zip: shipTo\.postal/);
    assert.match(addressToBlock, /country: shipTo\.country/);
    assert.doesNotMatch(addressToBlock, /\bname:/);
    assert.doesNotMatch(addressToBlock, /\bstreet2:/);
    assert.match(route, /const objectId = quoteOnlyRateObjectId\(r\.object_id \?\? null\)/);
    assert.match(route, /objectId: objectId \|\| null/);

    assert.doesNotMatch(selector, /toName|toLine1|toLine2/);
    assert.doesNotMatch(selector, /address\.line1|address\.line2|address\.name/);
  });

  it("forces seller label purchase to re-quote quote-only rates with full order recipient data", () => {
    const labelRoute = readFileSync("src/app/api/orders/[id]/label/route.ts", "utf8");

    assert.match(labelRoute, /isPickupRateObjectId,[\s\S]*isQuoteOnlyRateObjectId,[\s\S]*from "@\/lib\/shippingQuoteState"/);
    assert.match(labelRoute, /!isQuoteOnlyRateObjectId\(rateObjectId\)/);
    assert.match(labelRoute, /const storedRateUsable =\s*isPurchasableRateObjectId\(order\.shippoRateObjectId\)/);
    assert.match(labelRoute, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(labelRoute, /name: order\.buyerName \?\? order\.quotedToName \?\? undefined/);
  });
});
