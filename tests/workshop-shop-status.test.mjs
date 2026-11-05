import assert from "node:assert/strict";
import test from "node:test";
import { workshopShopStatus } from "../src/lib/workshopQueue.ts";

const open = {
  vacationMode: false,
  chargesEnabled: true,
  onboardingComplete: true,
  acceptingNewOrders: true,
  listingCount: 3,
};

test("the Workshop pill says open only when buyers can actually order", () => {
  assert.deepEqual(workshopShopStatus(open), { label: "Shop open", open: true });
  assert.equal(workshopShopStatus({ ...open, acceptingNewOrders: false }).label, "Not taking orders");
  assert.equal(workshopShopStatus({ ...open, acceptingNewOrders: false }).open, false);
  assert.equal(workshopShopStatus({ ...open, listingCount: 0 }).label, "No listings yet");
  assert.equal(workshopShopStatus({ ...open, vacationMode: true }).label, "On vacation");
  assert.equal(workshopShopStatus({ ...open, chargesEnabled: false }).label, "Not visible yet");
  assert.equal(workshopShopStatus({ ...open, onboardingComplete: false }).label, "Finish setup");
});

test("a failed read does not change the pill", () => {
  assert.equal(workshopShopStatus({ ...open, acceptingNewOrders: null, listingCount: null }).label, "Shop open");
});
