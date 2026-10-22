import assert from "node:assert/strict";
import test from "node:test";

const { canDeliverSellerBroadcast } = await import(
  "../src/lib/sellerBroadcastDeliveryState.ts"
);

const activeSeller = {
  sellerProfileId: "seller_123",
  chargesEnabled: true,
  vacationMode: false,
};

test("broadcast delivery requires a fresh active owner for the exact seller", () => {
  assert.equal(
    canDeliverSellerBroadcast("seller_123", activeSeller),
    true,
  );
  assert.equal(
    canDeliverSellerBroadcast("seller_other", activeSeller),
    false,
  );
  assert.equal(canDeliverSellerBroadcast("seller_123", null), false);
});

test("broadcast delivery stops for disabled or vacationing sellers", () => {
  assert.equal(
    canDeliverSellerBroadcast("seller_123", {
      ...activeSeller,
      chargesEnabled: false,
    }),
    false,
  );
  assert.equal(
    canDeliverSellerBroadcast("seller_123", {
      ...activeSeller,
      vacationMode: true,
    }),
    false,
  );
});
