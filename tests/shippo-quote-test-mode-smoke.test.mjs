import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildShippoCheckoutQuoteShipment } from "../src/lib/shippingQuoteProvider.ts";
import {
  SHIPPO_QUOTE_SMOKE_CONFIRMATION,
  parseShippoQuoteSmokeConfig,
  summarizeShippoCheckoutQuoteResponse,
} from "../scripts/shippo-quote-test-mode-smoke.mjs";

describe("Shippo buyer quote test-mode smoke", () => {
  it("shares the exact minimized runtime payload without buyer street PII", () => {
    const payload = buildShippoCheckoutQuoteShipment({
      from: {
        name: "Maker",
        line1: "215 Clayton St",
        line2: null,
        city: "San Francisco",
        state: "CA",
        postal: "94117",
        country: "US",
      },
      to: {
        city: "San Francisco",
        state: "CA",
        postal: "94103",
        country: "US",
      },
      parcel: { lengthCm: 25, widthCm: 20, heightCm: 15, weightGrams: 900 },
    });

    assert.deepEqual(payload.address_to, {
      street1: "Rate quote only",
      city: "San Francisco",
      state: "CA",
      zip: "94103",
      country: "US",
    });
    assert.equal("name" in payload.address_to, false);
    assert.equal("street2" in payload.address_to, false);
    assert.deepEqual(payload.parcels, [{
      length: 25,
      width: 20,
      height: 15,
      distance_unit: "cm",
      weight: 900,
      mass_unit: "g",
    }]);
    assert.equal(payload.async, false);
  });

  it("refuses missing confirmation, live credentials, repo evidence and loose commit ids", () => {
    const base = {
      SHIPPO_API_KEY: "shippo_test_example",
      SHIPPO_QUOTE_SMOKE_CONFIRM: SHIPPO_QUOTE_SMOKE_CONFIRMATION,
      SHIPPO_QUOTE_SMOKE_EVIDENCE_PATH: "/private/tmp/grainline-shippo-quote.json",
      SHIPPO_QUOTE_SMOKE_EXPECTED_COMMIT: "a".repeat(40),
      SHIPPO_QUOTE_SMOKE_RUN_ID: "quote_20260901",
    };

    assert.throws(() => parseShippoQuoteSmokeConfig({ ...base, SHIPPO_QUOTE_SMOKE_CONFIRM: "" }));
    assert.throws(() => parseShippoQuoteSmokeConfig({ ...base, SHIPPO_API_KEY: "shippo_live_example" }));
    assert.throws(() => parseShippoQuoteSmokeConfig({
      ...base,
      SHIPPO_QUOTE_SMOKE_EVIDENCE_PATH: `${process.cwd()}/shippo-evidence.json`,
    }));
    assert.throws(() => parseShippoQuoteSmokeConfig({
      ...base,
      SHIPPO_QUOTE_SMOKE_EXPECTED_COMMIT: "main",
    }));
    assert.equal(parseShippoQuoteSmokeConfig(base).expectedCommit, "a".repeat(40));
  });

  it("requires explicit test-mode provider objects and checkout-usable rates", () => {
    const valid = {
      object_id: "shipment_1",
      test: true,
      rates: [
        {
          object_id: "rate_1",
          amount: "8.25",
          currency: "USD",
          provider: "USPS",
          servicelevel: { name: "Ground Advantage" },
          estimated_days: 4,
          test: true,
        },
      ],
    };
    assert.deepEqual(summarizeShippoCheckoutQuoteResponse(valid), {
      carrierCount: 1,
      currency: "usd",
      maximumAmountCents: 825,
      minimumAmountCents: 825,
      providerRateCount: 1,
      shipmentCreated: true,
      testMode: true,
      usableRateCount: 1,
    });
    assert.throws(() => summarizeShippoCheckoutQuoteResponse({ ...valid, test: false }));
    assert.throws(() => summarizeShippoCheckoutQuoteResponse({ ...valid, rates: [] }));
    assert.throws(() => summarizeShippoCheckoutQuoteResponse({
      ...valid,
      rates: [{ ...valid.rates[0], test: false }],
    }));
    assert.throws(() => summarizeShippoCheckoutQuoteResponse({
      ...valid,
      rates: [{ ...valid.rates[0], object_id: "missing space" }],
    }));
  });

  it("cannot purchase a label or retain provider identities in evidence", () => {
    const script = readFileSync("scripts/shippo-quote-test-mode-smoke.mjs", "utf8");

    assert.match(script, /shippoRequest\("\/shipments\/"/);
    assert.doesNotMatch(script, /shippoRequest\("\/transactions\/"/);
    assert.doesNotMatch(script, /transactionId|shipmentId|rateId/);
    assert.match(script, /labelPurchased: false/);
    assert.match(script, /transactionCreated: false/);
    assert.match(script, /openSync\(filePath, "wx", 0o600\)/);
  });

  it("keeps the production route bound to the same payload builder", () => {
    const route = readFileSync("src/app/api/shipping/quote/route.ts", "utf8");

    assert.match(route, /import \{ buildShippoCheckoutQuoteShipment \}/);
    assert.match(route, /shippoRequest<ShippoShipment>\("\/shipments\/"/);
    assert.match(route, /JSON\.stringify\(\s*buildShippoCheckoutQuoteShipment\(/s);
    assert.doesNotMatch(route, /street1: "Rate quote only"/);
  });
});
