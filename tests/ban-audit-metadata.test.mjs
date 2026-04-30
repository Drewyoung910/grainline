import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { buildBanAuditMetadata, readBanAuditMetadata } = await import("../src/lib/banAuditMetadata.ts");

describe("ban audit metadata", () => {
  it("captures seller and commission state before ban mutations", () => {
    const metadata = buildBanAuditMetadata({
      sellerProfile: {
        id: "seller_123",
        chargesEnabled: true,
        vacationMode: false,
      },
      commissionRequests: [
        { id: "commission_1", status: "OPEN" },
        { id: "commission_2", status: "IN_PROGRESS" },
      ],
      openOrders: [
        {
          id: "order_1",
          buyerId: "buyer_1",
          previousReviewNeeded: false,
          previousReviewNote: null,
        },
      ],
    });

    assert.deepEqual(metadata, {
      previousSellerProfile: {
        id: "seller_123",
        chargesEnabled: true,
        vacationMode: false,
      },
      previousCommissionRequests: [
        { id: "commission_1", status: "OPEN" },
        { id: "commission_2", status: "IN_PROGRESS" },
      ],
      flaggedOpenOrders: [
        {
          id: "order_1",
          buyerId: "buyer_1",
          previousReviewNeeded: false,
          previousReviewNote: null,
        },
      ],
    });
  });

  it("reads only valid ban metadata from audit JSON", () => {
    const metadata = readBanAuditMetadata({
      previousSellerProfile: {
        id: "seller_123",
        chargesEnabled: false,
        vacationMode: true,
      },
      previousCommissionRequests: [
        { id: "commission_1", status: "OPEN" },
        { id: "commission_2", status: "NOT_A_STATUS" },
        { id: 123, status: "CLOSED" },
      ],
      flaggedOpenOrders: [
        {
          id: "order_1",
          buyerId: null,
          previousReviewNeeded: true,
          previousReviewNote: "Already flagged",
        },
        { id: "order_2", buyerId: 123, previousReviewNeeded: false, previousReviewNote: null },
      ],
    });

    assert.deepEqual(metadata, {
      previousSellerProfile: {
        id: "seller_123",
        chargesEnabled: false,
        vacationMode: true,
      },
      previousCommissionRequests: [{ id: "commission_1", status: "OPEN" }],
      flaggedOpenOrders: [
        {
          id: "order_1",
          buyerId: null,
          previousReviewNeeded: true,
          previousReviewNote: "Already flagged",
        },
      ],
    });
  });

  it("falls back to empty metadata for legacy audit rows", () => {
    assert.deepEqual(readBanAuditMetadata(null), {
      previousSellerProfile: null,
      previousCommissionRequests: [],
      flaggedOpenOrders: [],
    });
    assert.deepEqual(readBanAuditMetadata({ previousSellerProfile: { id: "seller_123" } }), {
      previousSellerProfile: null,
      previousCommissionRequests: [],
      flaggedOpenOrders: [],
    });
  });
});
