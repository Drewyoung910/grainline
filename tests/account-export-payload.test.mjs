import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { buildAccountExportPayload } = await import("../src/lib/accountExportPayload.ts");

function user(overrides = {}) {
  return {
    id: "user_123",
    email: "buyer@example.com",
    name: "Buyer",
    imageUrl: "https://cdn.example.com/avatar.jpg",
    role: "USER",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    termsAcceptedAt: new Date("2026-01-02T00:00:00.000Z"),
    termsVersion: "2026-01",
    ageAttestedAt: new Date("2026-01-02T00:00:00.000Z"),
    shippingName: "Buyer Name",
    shippingLine1: "123 Main",
    shippingLine2: null,
    shippingCity: "Austin",
    shippingState: "TX",
    shippingPostalCode: "78701",
    shippingPhone: "555-0100",
    notificationPreferences: { EMAIL_NEW_MESSAGE: false },
    ...overrides,
  };
}

function collections(overrides = {}) {
  return {
    sellerProfile: null,
    listings: [],
    buyerOrders: [],
    sellerOrders: [],
    messagesSent: [],
    messagesReceived: [],
    caseRows: [],
    reviews: [],
    blogPosts: [],
    blogComments: [],
    cart: null,
    favorites: [],
    savedSearches: [],
    follows: [],
    savedBlogPosts: [],
    commissionRequests: [],
    commissionInterests: [],
    notifications: [],
    ...overrides,
  };
}

describe("account export payload", () => {
  it("builds a stable top-level export shape", () => {
    const payload = buildAccountExportPayload(
      user(),
      collections({
        buyerOrders: [{ id: "order_1" }],
        caseRows: [{ id: "case_1" }],
        notifications: [{ id: "notif_1" }],
      }),
      new Date("2026-04-28T12:00:00.000Z"),
    );

    assert.deepEqual(Object.keys(payload), [
      "generatedAt",
      "account",
      "sellerProfile",
      "listings",
      "buyerOrders",
      "sellerOrders",
      "messagesSent",
      "messagesReceived",
      "cases",
      "reviews",
      "blogPosts",
      "blogComments",
      "cart",
      "favorites",
      "savedSearches",
      "follows",
      "savedBlogPosts",
      "commissionRequests",
      "commissionInterests",
      "notifications",
    ]);
    assert.equal(payload.generatedAt, "2026-04-28T12:00:00.000Z");
    assert.deepEqual(payload.buyerOrders, [{ id: "order_1" }]);
    assert.deepEqual(payload.cases, [{ id: "case_1" }]);
    assert.deepEqual(payload.notifications, [{ id: "notif_1" }]);
  });

  it("includes only the intended account fields", () => {
    const payload = buildAccountExportPayload(
      user({ banned: true, deletedAt: new Date("2026-03-01T00:00:00.000Z") }),
      collections(),
      new Date("2026-04-28T12:00:00.000Z"),
    );

    assert.deepEqual(Object.keys(payload.account), [
      "id",
      "email",
      "name",
      "imageUrl",
      "role",
      "createdAt",
      "updatedAt",
      "termsAcceptedAt",
      "termsVersion",
      "ageAttestedAt",
      "shippingName",
      "shippingLine1",
      "shippingLine2",
      "shippingCity",
      "shippingState",
      "shippingPostalCode",
      "shippingPhone",
      "notificationPreferences",
    ]);
    assert.equal("banned" in payload.account, false);
    assert.equal("deletedAt" in payload.account, false);
  });

  it("keeps empty optional collections explicit", () => {
    const payload = buildAccountExportPayload(user(), collections(), new Date("2026-04-28T12:00:00.000Z"));

    assert.equal(payload.sellerProfile, null);
    assert.equal(payload.cart, null);
    assert.deepEqual(payload.listings, []);
    assert.deepEqual(payload.savedSearches, []);
  });
});
