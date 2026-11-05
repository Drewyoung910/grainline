import assert from "node:assert/strict";
import test from "node:test";
import { workshopShopStatus } from "../src/lib/workshopQueue.ts";

const open = {
  vacationMode: false,
  chargesEnabled: true,
  onboardingComplete: true,
  acceptingNewOrders: true,
  liveListingCount: 3,
};

test("the Workshop pill says open only when buyers can actually order", () => {
  assert.deepEqual(workshopShopStatus(open), { label: "Shop open", open: true });
  assert.equal(workshopShopStatus({ ...open, acceptingNewOrders: false }).label, "Not taking orders");
  assert.equal(workshopShopStatus({ ...open, acceptingNewOrders: false }).open, false);
  assert.equal(workshopShopStatus({ ...open, liveListingCount: 0 }).label, "No live listings");
  assert.equal(workshopShopStatus({ ...open, vacationMode: true }).label, "On vacation");
  assert.equal(workshopShopStatus({ ...open, chargesEnabled: false }).label, "Not visible yet");
  assert.equal(workshopShopStatus({ ...open, onboardingComplete: false }).label, "Finish setup");
});

test("a failed read does not change the pill", () => {
  assert.equal(workshopShopStatus({ ...open, acceptingNewOrders: null, liveListingCount: null }).label, "Shop open");
});

test("the pill counts only public active listings, so drafts alone do not open the shop", async () => {
  const { loadWithStubs } = await import("./helpers/load-with-stubs.mjs");
  const counted = [];
  const data = loadWithStubs("src/lib/workshopData.ts", {
    "@/lib/db": {
      prisma: {
        listing: {
          count: async ({ where }) => {
            counted.push(where);
            return where.status === "ACTIVE" && where.isPrivate === false ? 0 : 4;
          },
          findFirst: async () => null,
          findMany: async () => [],
        },
      },
    },
  });
  const attention = await data.readWorkshopListingAttention("seller-1");
  assert.equal(attention.listingCount, 4);
  assert.equal(attention.liveListingCount, 0);
  assert.equal(workshopShopStatus({ ...open, liveListingCount: attention.liveListingCount }).label, "No live listings");
});
