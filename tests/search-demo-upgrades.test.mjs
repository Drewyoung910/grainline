import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { parseSmartSearch, highlightParts, isSearchShortcut } = await import("../src/lib/smartSearch.ts");
const { loadRecentSearches, rememberRecentSearch, clearRecentSearches, MAX_RECENT_SEARCHES } = await import(
  "../src/lib/recentSearches.ts"
);
const { clearSignedOutLocalAccountState } = await import("../src/lib/localAccountState.ts");
const { parseSearchSuggestionDetail, buildSearchSuggestionItems } = await import(
  "../src/lib/searchSuggestionResults.ts"
);

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

function params(href) {
  const url = new URL(href, "https://example.test");
  assert.equal(url.pathname, "/browse");
  return Object.fromEntries(url.searchParams.entries());
}

describe("smart search", () => {
  it("turns words into the real Browse parameters", () => {
    const smart = parseSmartSearch("walnut desk under 900");
    assert.deepEqual([...smart.chips], ["Walnut", "Furniture", "Under $900"]);
    assert.deepEqual(params(smart.href), { category: "FURNITURE", max: "900", q: "walnut desk" });
    assert.equal(smart.explicitFilter, true);
  });

  it("handles availability and comma prices", () => {
    const smart = parseSmartSearch("cutting board ready to ship under $1,200");
    assert.deepEqual(params(smart.href), { category: "KITCHEN", max: "1200", type: "IN_STOCK", q: "cutting board" });
    assert.equal(smart.explicitFilter, true);
  });

  it("keeps a wood and a piece as an offer, not an automatic filter", () => {
    const smart = parseSmartSearch("walnut desk");
    assert.equal(smart.explicitFilter, false);
    assert.deepEqual(params(smart.href), { category: "FURNITURE", q: "walnut desk" });
  });

  it("stays out of the way for ordinary searches", () => {
    for (const term of ["", "walnut", "live edge", "Litter Shack", "dj table", "under 900"]) {
      assert.equal(parseSmartSearch(term), null, term);
    }
  });

  it("does not match inside other words", () => {
    assert.equal(parseSmartSearch("ashley table"), null);
    assert.equal(parseSmartSearch("tablet pinewood"), null);
  });

  it("does not turn a size or a count into a hidden price limit on Enter", () => {
    for (const term of [
      "dining table up to 10 people",
      "table under 24x36",
      "bench up to 6 seats",
      "walnut bookcase less than 5 shelves",
      "oak sign under 20 characters",
      "ash table under 30 by 60",
      "cedar bench under 48w",
    ]) {
      const smart = parseSmartSearch(term);
      if (smart === null) continue;
      assert.equal(smart.explicitFilter, false, term);
      assert.equal(new URL(smart.enterHref, "https://example.test").searchParams.has("max"), false, term);
    }
  });

  it("keeps real budgets on Enter, with or without a dollar sign", () => {
    for (const [term, max] of [
      ["walnut desk under 900", "900"],
      ["walnut desk under $900 for an office", "900"],
      ["oak table up to 500 dollars", "500"],
      ["cherry shelf less than 200, ready to ship", "200"],
    ]) {
      const smart = parseSmartSearch(term);
      assert.equal(smart.explicitFilter, true, term);
      assert.equal(new URL(smart.enterHref, "https://example.test").searchParams.get("max"), max, term);
    }
  });

  it("ignores prices it cannot honor", () => {
    const smart = parseSmartSearch("walnut table under 99999999");
    assert.equal(new URL(smart.href, "https://example.test").searchParams.has("max"), false);
    assert.equal(smart.explicitFilter, false);
    assert.equal(parseSmartSearch("oak under 0"), null);
  });

  it("encodes every value into the URL safely", () => {
    const smart = parseSmartSearch(`walnut desk "><script> under 900`);
    assert.equal(params(smart.href).q, `walnut desk "><script>`);
    assert.doesNotMatch(smart.href, /<script>/);
  });
});

describe("match highlighting", () => {
  it("marks each typed word case-insensitively", () => {
    assert.deepEqual(highlightParts("Walnut Dining Table", "table walnut"), [
      { text: "Walnut", match: true },
      { text: " Dining ", match: false },
      { text: "Table", match: true },
    ]);
  });

  it("treats typed punctuation as plain text", () => {
    assert.deepEqual(highlightParts("Bowl (large)", "(large)"), [
      { text: "Bowl ", match: false },
      { text: "(large)", match: true },
    ]);
    assert.deepEqual(highlightParts("A.B", ".*"), [{ text: "A.B", match: false }]);
  });

  it("returns the text unchanged without a usable query", () => {
    assert.deepEqual(highlightParts("Walnut", ""), [{ text: "Walnut", match: false }]);
    assert.deepEqual(highlightParts("Walnut", "w"), [{ text: "Walnut", match: false }]);
  });

  it("preserves every character of the label", () => {
    for (const label of ["🪵 Walnut bowl 🪵", "Ünïcode wälnut", "walnut walnut"]) {
      assert.equal(highlightParts(label, "walnut").map((part) => part.text).join(""), label);
    }
  });
});

describe("search shortcut", () => {
  const press = (over = {}) => ({
    key: "/",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    defaultPrevented: false,
    target: { tagName: "BODY", isContentEditable: false },
    ...over,
  });

  it("fires from the page", () => {
    assert.equal(isSearchShortcut(press()), true);
    assert.equal(isSearchShortcut(press({ target: null })), true);
  });

  it("leaves typing and browser shortcuts alone", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) {
      assert.equal(isSearchShortcut(press({ target: { tagName } })), false, tagName);
    }
    assert.equal(isSearchShortcut(press({ target: { tagName: "DIV", isContentEditable: true } })), false);
    assert.equal(isSearchShortcut(press({ metaKey: true })), false);
    assert.equal(isSearchShortcut(press({ ctrlKey: true })), false);
    assert.equal(isSearchShortcut(press({ altKey: true })), false);
    assert.equal(isSearchShortcut(press({ defaultPrevented: true })), false);
    assert.equal(isSearchShortcut(press({ key: "?" })), false);
  });
});

describe("recent searches", () => {
  it("keeps the newest five, without duplicates", () => {
    const storage = memoryStorage();
    for (const term of ["oak", "maple", "OAK", "ash", "pine", "teak", "elm"]) {
      rememberRecentSearch(term, storage);
    }
    const list = loadRecentSearches(storage);
    assert.equal(list.length, MAX_RECENT_SEARCHES);
    assert.deepEqual(list, ["elm", "teak", "pine", "ash", "OAK"]);
  });

  it("survives corrupt or hostile stored data", () => {
    const key = "grainline:recent-searches";
    assert.deepEqual(loadRecentSearches(memoryStorage({ [key]: "{not json" })), []);
    assert.deepEqual(loadRecentSearches(memoryStorage({ [key]: '{"a":1}' })), []);
    assert.deepEqual(loadRecentSearches(memoryStorage({ [key]: '[1,null,"  ok  ",{"x":1}]' })), ["ok"]);
    assert.equal(loadRecentSearches(memoryStorage({ [key]: JSON.stringify(["x".repeat(500)]) }))[0].length, 80);
  });

  it("works when storage throws", () => {
    const broken = {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
      removeItem() { throw new Error("denied"); },
    };
    assert.deepEqual(loadRecentSearches(broken), []);
    assert.deepEqual(rememberRecentSearch("oak", broken), ["oak"]);
    clearRecentSearches(broken);
    assert.deepEqual(loadRecentSearches(null), []);
  });

  it("is cleared with the rest of this person's local state on sign-out", () => {
    const storage = memoryStorage();
    rememberRecentSearch("private search", storage);
    clearSignedOutLocalAccountState({
      anonymousCartStorage: null,
      cartSessionStorage: null,
      recentSearchStorage: storage,
    });
    assert.deepEqual(loadRecentSearches(storage), []);
  });
});

describe("piece row facts", () => {
  const good = { priceCents: 75000, currency: "usd", photoUrl: "https://cdn.example/a.jpg", makerName: "Shop", location: "Austin, TX" };

  it("accepts well-formed facts", () => {
    assert.deepEqual(parseSearchSuggestionDetail(good), good);
  });

  it("drops malformed facts instead of rendering them", () => {
    for (const bad of [
      null,
      1,
      {},
      { ...good, priceCents: -1 },
      { ...good, priceCents: 1.5 },
      { ...good, priceCents: "9" },
      { ...good, currency: "" },
      { ...good, currency: "not-a-currency" },
    ]) {
      assert.equal(parseSearchSuggestionDetail(bad), undefined);
    }
  });

  it("refuses non-https photo addresses and overlong display metadata", () => {
    for (const photoUrl of ["javascript:alert(1)", "http://x/a.jpg", "//x/a.jpg", "", 7]) {
      assert.equal(parseSearchSuggestionDetail({ ...good, photoUrl }).photoUrl, null);
    }
    assert.equal(parseSearchSuggestionDetail({ ...good, makerName: "x".repeat(201) }).makerName, null);
    assert.equal(parseSearchSuggestionDetail({ ...good, location: "x".repeat(251) }).location, null);
  });

  it("carries facts through to listing rows only when present", () => {
    const items = buildSearchSuggestionItems({
      listingTitles: [{ id: "a", title: "Walnut Bowl", detail: good }, { id: "b", title: "Oak Bowl" }],
      tags: [],
      makers: [],
      fuzzyListingTitles: [],
    });
    assert.deepEqual(items[0].detail, good);
    assert.equal("detail" in items[1], false);
  });
});
describe("workspace sidebar", async () => {
  const {
    workspaceKindForPath,
    workshopNavGroups,
    accountNavGroups,
    currentWorkspaceHref,
    guildNavLabel,
  } = await import("../src/lib/workspaceNav.ts");

  it("gives each page the right frame", () => {
    for (const path of ["/dashboard", "/dashboard/listings", "/dashboard/sales", "/dashboard/sales/abc", "/dashboard/inventory", "/dashboard/analytics", "/dashboard/seller", "/dashboard/profile", "/dashboard/blog", "/dashboard/verification"]) {
      assert.equal(workspaceKindForPath(path), "workshop", path);
    }
    for (const path of ["/account", "/account/orders", "/account/saved", "/account/settings", "/dashboard/orders", "/dashboard/orders/abc", "/dashboard/notifications", "/dashboard/saved"]) {
      assert.equal(workspaceKindForPath(path), "account", path);
    }
  });

  it("leaves focused flows and public pages alone", () => {
    for (const path of ["/dashboard/onboarding", "/dashboard/listings/new", "/dashboard/listings/custom", "/dashboard/listings/abc/edit", "/dashboard/blog/new", "/dashboard/blog/abc/edit", "/account/deleted", "/", "/messages", "/dashboardish", "/accounting"]) {
      assert.equal(workspaceKindForPath(path), null, path);
    }
  });

  it("lights exactly one row, the most specific match", () => {
    const workshop = workshopNavGroups();
    assert.equal(currentWorkspaceHref("/dashboard", workshop), "/dashboard");
    assert.equal(currentWorkspaceHref("/dashboard/sales/abc", workshop), "/dashboard/sales");
    assert.equal(currentWorkspaceHref("/dashboard/inventory", workshop), "/dashboard/listings");
    // The settings page also holds shop updates, but only Settings lights up.
    assert.equal(currentWorkspaceHref("/dashboard/seller", workshop), "/dashboard/seller");
    const account = accountNavGroups();
    assert.equal(currentWorkspaceHref("/account", account), "/account");
    assert.equal(currentWorkspaceHref("/dashboard/orders/abc", account), "/account/orders");
    assert.equal(currentWorkspaceHref("/account/saved-searches", account), "/account/saved-searches");
    assert.equal(currentWorkspaceHref("/account/saved", account), "/account/saved");
  });

  it("keeps every page the old dashboard buttons reached", () => {
    const hrefs = (groups) => groups.flatMap((group) => group.items.map((item) => item.href));
    const workshop = hrefs(workshopNavGroups());
    for (const href of ["/dashboard/profile", "/dashboard/seller", "/dashboard/sales", "/dashboard/listings", "/dashboard/analytics", "/dashboard/blog", "/dashboard/verification", "/messages", "/account"]) {
      assert.ok(workshop.includes(href), href);
    }
    const account = hrefs(accountNavGroups({ hasSeller: true }));
    for (const href of ["/account/orders", "/messages", "/dashboard/notifications", "/account/saved", "/account/saved-searches", "/account/following", "/account/feed", "/account/reviews", "/account/commissions", "/account/settings", "/account/blocked", "/dashboard"]) {
      assert.ok(account.includes(href), href);
    }
  });

  it("offers selling only once it knows there is no shop", () => {
    const hrefs = (input) => accountNavGroups(input).flatMap((group) => group.items.map((item) => item.href));
    assert.equal(hrefs({ hasSeller: null }).includes("/become-a-maker"), false);
    assert.equal(hrefs({ hasSeller: null }).includes("/dashboard"), false);
    assert.equal(hrefs({ hasSeller: false }).includes("/become-a-maker"), true);
    assert.equal(hrefs({ hasSeller: true }).includes("/dashboard"), true);
  });

  it("names the Guild row by the seller's state", () => {
    assert.equal(guildNavLabel({ guildLevel: "GUILD_MASTER" }), "Guild Master");
    assert.equal(guildNavLabel({ guildLevel: "GUILD_MEMBER" }), "Guild Member");
    assert.equal(guildNavLabel({ guildLevel: "NONE", verificationStatus: "PENDING" }), "Guild Badge Pending");
    assert.equal(guildNavLabel({ guildLevel: "NONE" }), "Apply for Guild Badge");
  });

  it("carries badge counts and leaves zero or unknown blank", () => {
    const orders = (counts) => workshopNavGroups({ counts })[0].items.find((item) => item.href === "/dashboard/sales").count;
    assert.equal(orders({ ordersToShip: 3 }), 3);
    assert.equal(orders({ ordersToShip: null }), undefined);
  });
});

describe("workshop queue", async () => {
  const {
    ordersAwaitingFulfillment,
    workshopAttentionRows,
    parseWorkshopListingFilter,
    workshopListingFilterCounts,
    workshopListingFilterStatus,
  } = await import("../src/lib/workshopQueue.ts");

  const order = (over = {}) => ({
    id: "o1",
    paidAt: new Date(),
    itemsSubtotalCents: 10000,
    shippingAmountCents: 1000,
    taxAmountCents: 0,
    giftWrappingPriceCents: null,
    sellerRefundAmountCents: null,
    fulfillmentStatus: "PENDING",
    ...over,
  });

  it("counts only paid work that has not started", () => {
    const none = new Map();
    assert.equal(ordersAwaitingFulfillment([order()], none).length, 1);
    assert.equal(ordersAwaitingFulfillment([order({ fulfillmentStatus: null })], none).length, 1);
    for (const fulfillmentStatus of ["SHIPPED", "DELIVERED", "PICKED_UP", "READY_FOR_PICKUP"]) {
      assert.equal(ordersAwaitingFulfillment([order({ fulfillmentStatus })], none).length, 0, fulfillmentStatus);
    }
    assert.equal(ordersAwaitingFulfillment([order({ paidAt: null })], none).length, 0);
  });

  it("drops fully refunded orders but keeps partly refunded ones", () => {
    const none = new Map();
    assert.equal(ordersAwaitingFulfillment([order({ sellerRefundAmountCents: 11000 })], none).length, 0);
    assert.equal(ordersAwaitingFulfillment([order({ sellerRefundAmountCents: 500 })], none).length, 1);
    const provider = new Map([["o1", { amountCents: 11000, status: "succeeded" }]]);
    assert.equal(ordersAwaitingFulfillment([order()], provider).length, 0);
  });

  const empty = { ordersToShip: 0, ordersToShipCapped: false, orderNames: [], unreadMessages: 0, underReview: 0, underReviewTitle: null, rejected: 0, lowStock: [] };

  it("is empty when nothing needs doing", () => {
    assert.deepEqual(workshopAttentionRows(empty), []);
  });

  it("lists work most urgent first with working links", () => {
    const rows = workshopAttentionRows({
      ...empty,
      ordersToShip: 2,
      orderNames: ["Maya", "Jordan", "Ben", "Ana"],
      unreadMessages: 1,
      underReview: 1,
      underReviewTitle: "Corner Cabinet",
      rejected: 2,
      lowStock: [{ title: "Bowl", stockQuantity: 1 }],
    });
    assert.deepEqual(rows.map((row) => row.key), ["orders", "messages", "rejected", "review", "low-stock"]);
    assert.equal(rows[0].title, "2 orders to ship");
    assert.equal(rows[0].detail, "Maya · Jordan · Ben");
    assert.equal(rows[1].title, "1 unread message");
    assert.equal(rows[2].title, "2 listings sent back");
    assert.equal(rows[4].detail, "Bowl: 1 left");
    for (const row of rows) assert.match(row.href, /^\/(dashboard|messages)/);
  });

  it("does not claim an exact count when the window is full", () => {
    assert.equal(workshopAttentionRows({ ...empty, ordersToShip: 50, ordersToShipCapped: true })[0].title, "50+ orders to ship");
  });

  it("falls back to all for an unknown filter", () => {
    for (const raw of [undefined, "", "nope", ["active"], 7]) assert.equal(parseWorkshopListingFilter(raw), "all");
    assert.equal(parseWorkshopListingFilter("review"), "review");
    assert.equal(workshopListingFilterStatus("review"), "PENDING_REVIEW");
    assert.equal(workshopListingFilterStatus("all"), null);
    assert.equal(workshopListingFilterStatus("stock"), null);
  });

  it("adds up tab counts from status totals", () => {
    const counts = workshopListingFilterCounts({ ACTIVE: 3, DRAFT: 1, SOLD_OUT: 2 }, 4);
    assert.equal(counts.all, 6);
    assert.equal(counts.active, 3);
    assert.equal(counts.soldout, 2);
    assert.equal(counts.stock, 4);
    assert.equal(counts.hidden, 0);
  });
});

describe("buyer order progress", async () => {
  const { orderProgressSteps, orderProgressFraction, orderIsPickup, activeOrder } = await import("../src/lib/orderProgress.ts");
  const states = (input) => orderProgressSteps(input).map((step) => `${step.label}:${step.state}`);

  it("follows a shipped order", () => {
    assert.deepEqual(states({ fulfillmentStatus: "PENDING" }), ["Ordered:done", "Being made:current", "Shipped:upcoming", "Delivered:upcoming"]);
    assert.deepEqual(states({ fulfillmentStatus: "SHIPPED" }), ["Ordered:done", "Being made:done", "Shipped:current", "Delivered:upcoming"]);
    assert.deepEqual(states({ fulfillmentStatus: "DELIVERED" }), ["Ordered:done", "Being made:done", "Shipped:done", "Delivered:current"]);
  });

  it("uses pickup wording for pickup orders, even before they are ready", () => {
    assert.equal(orderIsPickup({ shippingTitle: "Local Pickup (Free)", fulfillmentStatus: "PENDING" }), true);
    assert.deepEqual(states({ fulfillmentStatus: "READY_FOR_PICKUP" }), ["Ordered:done", "Being made:done", "Ready for pickup:current", "Picked up:upcoming"]);
    assert.equal(orderIsPickup({ shippingTitle: "UPS Ground", fulfillmentStatus: "PENDING" }), false);
  });

  it("treats a missing or unknown status as still being made", () => {
    assert.equal(states({})[1], "Being made:current");
    assert.equal(states({ fulfillmentStatus: "SOMETHING_NEW" })[1], "Being made:current");
  });

  it("fills the line to the current step", () => {
    assert.equal(orderProgressFraction(orderProgressSteps({ fulfillmentStatus: "PENDING" })), 1 / 3);
    assert.equal(orderProgressFraction(orderProgressSteps({ fulfillmentStatus: "SHIPPED" })), 2 / 3);
    assert.equal(orderProgressFraction(orderProgressSteps({ fulfillmentStatus: "DELIVERED" })), 1);
  });

  it("skips finished and refunded orders when choosing the one on its way", () => {
    const orders = [{ id: "a", fulfillmentStatus: "DELIVERED" }, { id: "b", fulfillmentStatus: "PENDING" }, { id: "c", fulfillmentStatus: "SHIPPED" }];
    assert.equal(activeOrder(orders, () => false).id, "b");
    assert.equal(activeOrder(orders, (order) => order.id === "b").id, "c");
    assert.equal(activeOrder(orders, () => true), null);
    assert.equal(activeOrder([], () => false), null);
  });
});

describe("conversation snippets", async () => {
  const { formatSnippet } = await import("../src/lib/messageSnippet.ts");
  it("names structured messages instead of showing their JSON", () => {
    assert.equal(formatSnippet("", null), "No messages yet");
    assert.equal(formatSnippet(null, null), "No messages yet");
    assert.equal(formatSnippet('{"x":1}', "custom_order_request"), "Custom order request");
    assert.equal(formatSnippet('{"x":1}', "custom_order_link"), "Custom listing ready");
    assert.equal(formatSnippet('{"x":1}', "commission_interest_card"), "Interested in your commission");
    assert.equal(formatSnippet("https://cdn.example/a.jpg", null), "Photo");
    assert.equal(formatSnippet("https://cdn.example/a.pdf", null), "PDF");
    assert.equal(formatSnippet("Hello there", null), "Hello there");
  });
});

describe("commission request dialog", () => {
  it("keeps the direct form fallback and describes nearby discovery honestly", () => {
    const button = readFileSync("src/components/CommissionPostButton.tsx", "utf8");
    const form = readFileSync("src/components/CommissionRequestForm.tsx", "utf8");
    const page = readFileSync("src/app/commission/new/page.tsx", "utf8");
    assert.match(button, /<Link href="\/commission\/new"/);
    assert.match(button, /createPortal/);
    assert.match(page, /<CommissionRequestForm/);
    assert.match(form, /Prioritize nearby makers/);
    assert.match(form, /Other makers may still see them/);
    assert.doesNotMatch(form, /Local makers only|within ~50 miles/);
  });
});
