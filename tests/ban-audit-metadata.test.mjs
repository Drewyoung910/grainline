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
          addedReviewNote: true,
        },
      ],
    });

    assert.deepEqual(metadata, {
      appliedBannedAt: null,
      externalSyncVersion: 1,
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
          previousReviewNoteHash: null,
          previousReviewNoteLength: 0,
          addedReviewNote: true,
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
          addedReviewNote: true,
        },
        { id: "order_2", buyerId: 123, previousReviewNeeded: false, previousReviewNote: null },
      ],
    });

    assert.deepEqual(metadata, {
      appliedBannedAt: null,
      externalSyncVersion: null,
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
          previousReviewNoteHash: "018c721c15e35e4408b533754eb1ad743d20aef6e3a748dfffc5213fa4df5edb",
          previousReviewNoteLength: 15,
          addedReviewNote: true,
        },
      ],
    });
  });

  it("stores only a hash and length for admin-written review notes", () => {
    const metadata = buildBanAuditMetadata({
      sellerProfile: null,
      commissionRequests: [],
      openOrders: [
        {
          id: "order_1",
          buyerId: "buyer_1",
          previousReviewNeeded: true,
          previousReviewNote: "Buyer phone 512-555-1000",
        },
      ],
    });

    assert.equal(metadata.flaggedOpenOrders[0].previousReviewNoteLength, 24);
    assert.match(metadata.flaggedOpenOrders[0].previousReviewNoteHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(metadata).includes("512-555-1000"), false);
  });

  it("falls back to empty metadata for legacy audit rows", () => {
    assert.deepEqual(readBanAuditMetadata(null), {
      appliedBannedAt: null,
      externalSyncVersion: null,
      previousSellerProfile: null,
      previousCommissionRequests: [],
      flaggedOpenOrders: [],
    });
    assert.deepEqual(readBanAuditMetadata({ previousSellerProfile: { id: "seller_123" } }), {
      appliedBannedAt: null,
      externalSyncVersion: null,
      previousSellerProfile: null,
      previousCommissionRequests: [],
      flaggedOpenOrders: [],
    });
  });
});
