import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { parseSmartSearch } = await import("../src/lib/smartSearch.ts");
const { cleanBrowsePriceInput } = await import("../src/lib/browsePriceInput.ts");
const { formatSnippet } = await import("../src/lib/messageSnippet.ts");
const { orderRefundedAway, workshopAttentionRows } = await import("../src/lib/workshopQueue.ts");
const { workshopNavGroups } = await import("../src/lib/workspaceNav.ts");

const source = (path) => readFileSync(path, "utf8");

describe("smart search only reads real budgets", () => {
  for (const measurement of [
    "table under 30 inches",
    "desk less than 12 inches deep",
    "mirror up to 48 inches",
    "frame under 24 x 36",
    "bench under 60 in",
    "shelf below 36\" wide",
  ]) {
    it(`leaves "${measurement}" as a plain search`, () => {
      assert.notEqual(parseSmartSearch(measurement)?.explicitFilter, true);
    });
  }

  it("treats a small number after an age word as an age", () => {
    assert.notEqual(parseSmartSearch("toys for kids under 10")?.explicitFilter, true);
    assert.equal(parseSmartSearch("kids table under 200")?.explicitFilter, true);
    assert.equal(parseSmartSearch("toys for kids under $5")?.explicitFilter, true);
    assert.equal(parseSmartSearch("toys for kids under $10")?.explicitFilter, true);
  });

  it("never guesses a category on Enter, while the visible row may suggest one", () => {
    const kitchen = parseSmartSearch("kitchen table under 500");
    assert.equal(kitchen.enterHref, "/browse?max=500&q=kitchen+table");
    assert.equal(kitchen.href, "/browse?category=KITCHEN&max=500&q=kitchen+table");
    assert.equal(parseSmartSearch("walnut bed frame under 900").enterHref, "/browse?max=900&q=walnut+bed+frame");
    assert.equal(parseSmartSearch("office chair under 300").enterHref, "/browse?max=300&q=office+chair");
  });

  it("reads cents and thousands without stranding punctuation", () => {
    assert.equal(parseSmartSearch("table under $1,200.50").enterHref, "/browse?max=1201&q=table");
    assert.equal(parseSmartSearch("desk under 1,200, walnut").enterHref, "/browse?max=1200&q=desk+walnut");
  });
});

describe("browse price fields share one currency parser", () => {
  it("accepts common currency punctuation on desktop and mobile", () => {
    assert.equal(cleanBrowsePriceInput("$1,250"), "1250");
    assert.equal(cleanBrowsePriceInput(" 49.99 "), "49.99");
    assert.equal(cleanBrowsePriceInput(".50"), ".50");
    assert.equal(cleanBrowsePriceInput(""), "");
    assert.equal(cleanBrowsePriceInput("twelve"), null);
  });
});

describe("message snippets", () => {
  it("never shows a file message's stored JSON", () => {
    const body = JSON.stringify({ kind: "file", url: "https://retired.example/a.pdf", name: "a.pdf" });
    assert.equal(formatSnippet(body, "file"), "Attachment");
  });
});

describe("Workshop overview", () => {
  const quiet = {
    ordersToShip: 0,
    ordersToShipCapped: false,
    orderNames: [],
    unreadMessages: 0,
    underReview: 0,
    underReviewTitle: null,
    rejected: 0,
    lowStock: [],
    listingCount: 3,
  };
  const paidOrder = {
    id: "o1",
    paidAt: new Date(),
    itemsSubtotalCents: 1000,
    shippingAmountCents: 0,
    taxAmountCents: 0,
    giftWrappingPriceCents: null,
    sellerRefundAmountCents: null,
    fulfillmentStatus: "PENDING",
  };

  it("says nothing is left only when it could see everything", () => {
    assert.deepEqual(workshopAttentionRows(quiet), []);
    const rows = workshopAttentionRows({ ...quiet, ordersToShipCapped: true });
    assert.deepEqual(rows.map((row) => row.key), ["older-orders"]);
    assert.equal(rows[0].href, "/dashboard/sales");
  });

  it("never says all caught up while a case is open on the maker's orders", () => {
    const rows = workshopAttentionRows({ ...quiet, ordersToShip: 1, orderNames: ["Maya"], openCases: 2 });
    assert.deepEqual(rows.map((row) => row.key), ["cases", "orders"]);
    assert.equal(rows[0].title, "2 open cases");
    assert.equal(rows[0].href, "/dashboard/sales");
    assert.deepEqual(workshopAttentionRows({ ...quiet, openCases: 0 }), []);
    assert.deepEqual(workshopAttentionRows({ ...quiet, openCases: null }), []);
  });

  it("tells a maker without payouts or live listings what to do next", () => {
    assert.deepEqual(
      workshopAttentionRows({ ...quiet, chargesEnabled: false }).map((row) => row.key),
      ["payouts"],
    );
    assert.equal(workshopAttentionRows({ ...quiet, chargesEnabled: false })[0].href, "/dashboard/seller");
    assert.deepEqual(
      workshopAttentionRows({ ...quiet, liveListingCount: 0 }).map((row) => row.key),
      ["nothing-live"],
    );
    // Listings waiting on review or sent back already have their own rows.
    assert.deepEqual(
      workshopAttentionRows({ ...quiet, liveListingCount: 0, underReview: 1 }).map((row) => row.key),
      ["review"],
    );
    assert.deepEqual(workshopAttentionRows({ ...quiet, chargesEnabled: true, liveListingCount: 2 }), []);
    assert.deepEqual(workshopAttentionRows({ ...quiet, liveListingCount: null }), []);
  });

  it("points an empty shop at its first listing, but not when the count is unknown", () => {
    assert.deepEqual(workshopAttentionRows({ ...quiet, listingCount: 0 }).map((row) => row.key), ["first-listing"]);
    assert.deepEqual(workshopAttentionRows({ ...quiet, listingCount: null }), []);
  });

  it("marks a fully refunded unshipped order the way the sales list does", () => {
    assert.equal(orderRefundedAway(paidOrder, null), false);
    assert.equal(orderRefundedAway({ ...paidOrder, sellerRefundAmountCents: 1000 }, null), true);
    assert.equal(orderRefundedAway({ ...paidOrder, sellerRefundAmountCents: 400 }, null), false);
    assert.equal(orderRefundedAway({ ...paidOrder, sellerRefundAmountCents: 1000, fulfillmentStatus: "DELIVERED" }, null), false);
  });

  it("keeps Notifications and its count reachable from the Workshop sidebar", () => {
    const items = workshopNavGroups({ counts: { notifications: 4 } }).flatMap((group) => group.items);
    const notifications = items.find((item) => item.href === "/dashboard/notifications");
    assert.equal(notifications?.count, 4);
  });

  it("can lose a read without losing the page", () => {
    const page = source("src/app/dashboard/page.tsx");
    assert.match(page, /readOptional\("order_queue"/);
    assert.match(page, /readOptional\("listing_attention"/);
    assert.match(page, /readOptional\("unread_messages"/);
    assert.match(page, /attentionIncomplete \? "Your shop" : "All caught up"/);
    assert.match(page, /\(onboardingComplete \|\| chargesEnabled \|\| \(orderQueue\?\.recent\.length \?\? 0\) > 0\) && <WorkshopStats \/>/);
  });
});

describe("guards behind the browser checks", () => {
  it("lets Space press a focused control inside a dialog", () => {
    const focus = source("src/lib/dialogFocus.ts");
    assert.match(focus, /event\.key === " " && target instanceof Element && target\.closest\(SPACE_ACTIVATED_SELECTOR\)/);
  });

  it("measures glides from layout, not from where a card is mid-flight", () => {
    const flip = source("src/components/FlipList.tsx");
    assert.match(flip, /x: item\.offsetLeft, y: item\.offsetTop/);
    assert.doesNotMatch(flip, /item\.getBoundingClientRect/);
    assert.match(flip, /list\.style\.overflowX = "clip"/);
  });

  it("keeps the flyer until the gallery's own photo has arrived", () => {
    const motion = source("src/lib/photoMotion.ts");
    assert.match(motion, /const LANDED_HOLD_MS = 5000/);
    assert.match(motion, /shown\?\.complete/);
    assert.match(motion, /const movedOn = \(\) =>/);
  });

  it("won't let a stepper press aim at a quantity the server must refuse", () => {
    const cart = source("src/app/cart/page.tsx");
    assert.match(cart, /Math\.min\(shownQuantity - 1, stockLimit\)/);
    assert.match(cart, /shownQuantity >= stockLimit/);
    assert.match(cart, /if \(cartBusy\) return;\s*setStep\("address"\)/);
  });

  it("can't discard a commission request that's already being sent", () => {
    const dialog = source("src/components/CommissionPostButton.tsx");
    const form = source("src/components/CommissionRequestForm.tsx");
    assert.match(dialog, /if \(submittingRef\.current\) return;/);
    assert.match(dialog, /event\.clientX < event\.currentTarget\.clientWidth/);
    assert.match(form, /onSubmittingChange\?\.\(true\);\s*setSubmitting\(true\)/);
    assert.match(form, /finally \{\s*onSubmittingChange\?\.\(false\);\s*setSubmitting\(false\)/);
    assert.match(form, /disabled=\{submitting \|\| uploading \|\|/);
    assert.match(form, /role="alert"/);
  });

  it("keeps a seller's listing page payload to what the stock control needs", () => {
    const page = source("src/app/dashboard/listings/page.tsx");
    assert.match(page, /listing=\{\{ id: l\.id, stockQuantity: l\.stockQuantity \}\}/);
    assert.match(source("src/app/dashboard/inventory/page.tsx"), /archivedAt: null/);
  });

  it("keeps existing map pins alive through source and viewport updates", () => {
    const map = source("src/components/AllSellersMap.tsx");
    assert.match(map, /const markers = new Map<string, maplibregl\.Marker>\(\)/);
    assert.match(map, /const existingMarker = markers\.get\(id\)/);
    assert.match(map, /existingMarker\.setLngLat\(coords\)/);
    assert.doesNotMatch(map, /markers\.forEach\([^\n]+\.remove\(\)\);\s*markers\.length = 0/);
  });

  it("closes dialogs before Buy Now success navigation", () => {
    const checkout = source("src/components/BuyNowCheckoutModal.tsx");
    assert.match(checkout, /completedRef\.current = true;\s*onCloseRef\.current\(\);\s*router\.replace/);
    assert.match(checkout, /sessionIdRef\.current = null;\s*onClose\(\);\s*\/\/[^\n]*\s*router\.replace/);
  });

  it("keeps small-screen controls stable while async work runs", () => {
    const notify = source("src/components/NotifyMeButton.tsx");
    const search = source("src/components/SearchBar.tsx");
    const mobileFilters = source("src/components/MobileFilterBar.tsx");
    assert.match(notify, /if \(loading\) return;/);
    assert.match(notify, /aria-busy=\{loading \|\| undefined\}/);
    assert.doesNotMatch(notify, /\{loading \? "…"/);
    assert.match(search, /onBlurCapture=\{\(event\) =>/);
    assert.match(mobileFilters, /onSubmit=\{handleFilterSubmit\}/);
    assert.match(mobileFilters, /router\.push\(query \? `\/browse\?\$\{query\}` : "\/browse", \{ scroll: false \}\)/);
  });
});
