// RLS_CONTEXT_GATE_RUNNER_ONLY_TEST
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHECKOUT_RESERVATION_PROVIDER_FIXTURE_COUNT,
  checkoutReservationProviderFixture,
  parseCheckoutStockReservationProviderGateConfig,
} from "../src/lib/checkoutStockReservationProviderConfig.ts";

describe("CheckoutStockReservation provider gate config", () => {
  it("uses bounded checkout-specific concurrency and workload defaults", () => {
    assert.deepEqual(parseCheckoutStockReservationProviderGateConfig(1, {}), {
      burstConcurrency: 10,
      measuredRequests: 80,
      runSlot: 1,
      targetConcurrency: 8,
      warmupRequests: 10,
    });
    assert.throws(() => parseCheckoutStockReservationProviderGateConfig(1, {
      CHECKOUT_RESERVATION_PROVIDER_BURST_CONCURRENCY: "11",
    }), /outside the reviewed bound/);
    assert.throws(() => parseCheckoutStockReservationProviderGateConfig(1, {
      CHECKOUT_RESERVATION_PROVIDER_REQUESTS: "39",
    }), /outside the reviewed bound/);
    assert.throws(() => parseCheckoutStockReservationProviderGateConfig(1, {
      CHECKOUT_RESERVATION_PROVIDER_TARGET_CONCURRENCY: "9",
      CHECKOUT_RESERVATION_PROVIDER_BURST_CONCURRENCY: "8",
    }), /outside the reviewed bound/);
  });

  it("derives fixed, bounded fixtures without caller-controlled identities", () => {
    assert.equal(CHECKOUT_RESERVATION_PROVIDER_FIXTURE_COUNT, 20);
    assert.deepEqual(checkoutReservationProviderFixture(2, 3), {
      buyerId: "checkout-reservation-provider-buyer-2-3",
      listingId: "checkout-reservation-provider-listing-2-3",
      sellerProfileId: "checkout-reservation-provider-seller-2",
      sellerUserId: "checkout-reservation-provider-seller-user-2",
    });
    assert.throws(() => checkoutReservationProviderFixture(1, -1));
    assert.throws(() => checkoutReservationProviderFixture(1, 20));
  });
});
