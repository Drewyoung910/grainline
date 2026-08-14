// RLS_CONTEXT_GATE_RUNNER_ONLY_TEST
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const setup = readFileSync("scripts/checkout-stock-reservation-provider-fixtures-setup.sql", "utf8");
const teardown = readFileSync("scripts/checkout-stock-reservation-provider-fixtures-teardown.sql", "utf8");
const preflight = readFileSync("scripts/checkout-stock-reservation-provider-local-preflight.ts", "utf8");

describe("CheckoutStockReservation provider fixtures", () => {
  it("uses exact prefixed, bounded source rows and no real provider identifiers", () => {
    assert.match(setup, /pg_catalog\.generate_series\(1, 2\)/);
    assert.match(setup, /pg_catalog\.generate_series\(0, 19\)/);
    assert.match(setup, /source_users <> 42/);
    assert.match(setup, /source_sellers <> 2/);
    assert.match(setup, /source_listings <> 40/);
    assert.match(setup, /acct_checkout_reservation_provider_/);
    assert.match(setup, /@example\.invalid/);
    assert.doesNotMatch(setup, /@gmail\.|@thegrainline\.|acct_(?:live|prod)/i);
  });

  it("fails on preexisting fixtures and tears down only the exact prefix", () => {
    assert.match(setup, /provider fixtures already exist/);
    assert.match(setup, /BEGIN;/);
    assert.match(setup, /COMMIT;/);
    assert.match(teardown, /DELETE FROM public\."CheckoutStockReservation"/);
    assert.match(teardown, /DELETE FROM public\."ListingVariantOption"/);
    assert.match(teardown, /DELETE FROM public\."ListingVariantGroup"/);
    assert.match(teardown, /DELETE FROM public\."Listing"/);
    assert.match(teardown, /DELETE FROM public\."SellerProfile"/);
    assert.match(teardown, /DELETE FROM public\."User"/);
    assert.doesNotMatch(teardown, /TRUNCATE|DROP\s+(?:TABLE|SCHEMA|DATABASE)/i);
    assert.match(teardown, /fixtures remained after teardown/);
  });

  it("keeps local failure output sanitized and staging-only", () => {
    assert.match(preflight, /RLS_CONTEXT_GATE_CONFIRM !== "staging-only"/);
    assert.match(preflight, /redacted connection-bearing error/);
    assert.doesNotMatch(preflight, /console\.(?:log|error)\(error/);
    assert.match(preflight, /CHECKOUT_RESERVATION_PROVIDER_RUN_SLOT must be 1 or 2/);
  });
});
