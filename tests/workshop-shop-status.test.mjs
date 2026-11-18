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
  assert.equal(workshopShopStatus({ ...open, chargesEnabled: false }).label, "Payouts not connected");
});

test("the setup wizard alone does not close the shop", () => {
  // Publishing needs only Stripe; a maker who skipped the wizard is open.
  assert.deepEqual(workshopShopStatus({ ...open, onboardingComplete: false }), { label: "Shop open", open: true });
});

test("a failed read does not change the pill", () => {
  assert.equal(workshopShopStatus({ ...open, acceptingNewOrders: null, liveListingCount: null }).label, "Shop open");
});

test("the pill counts only public active listings, so drafts alone do not open the shop", async () => {
  const { loadWithStubs } = await import("./helpers/load-with-stubs.mjs");
  const data = loadWithStubs("src/lib/workshopData.ts", {
    react: { cache: (fn) => fn },
    "@prisma/client": {
      ListingStatus: { ACTIVE: "ACTIVE" },
      ListingType: { IN_STOCK: "IN_STOCK" },
    },
    "@/lib/listingOwnerAccess": {
      listingOwnerWorkshopSummary: async () => ({
        listingCount: 4,
        liveListingCount: 0,
        unpublishedCount: 4,
        statusCounts: { DRAFT: 4 },
        inStock: 0,
        underReviewTitle: null,
        lowStock: [],
      }),
      listingOwnerSummaryRows: async () => [],
    },
  });
  const attention = await data.readWorkshopListingAttention("seller-1");
  assert.equal(attention.listingCount, 4);
  assert.equal(attention.liveListingCount, 0);
  assert.equal(workshopShopStatus({ ...open, liveListingCount: attention.liveListingCount }).label, "No live listings");
});
