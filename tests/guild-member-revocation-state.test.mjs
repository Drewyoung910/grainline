import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  guildMemberRevocationCaseWhere,
  guildMemberRevocationSellerWhere,
} = await import("../src/lib/guildMemberRevocationState.ts");

describe("guild member revocation state", () => {
  it("rechecks the unresolved-case condition in the seller update guard", () => {
    const cutoff = new Date("2026-01-01T00:00:00.000Z");
    const guard = { kind: "unresolved_case", caseCreatedBefore: cutoff };

    assert.deepEqual(guildMemberRevocationCaseWhere("user_1", guard), {
      sellerId: "user_1",
      status: { in: ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE"] },
      createdAt: { lt: cutoff },
    });
    assert.deepEqual(guildMemberRevocationSellerWhere("seller_1", "user_1", guard), {
      id: "seller_1",
      guildLevel: "GUILD_MEMBER",
      user: {
        casesAsSeller: {
          some: {
            sellerId: "user_1",
            status: { in: ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE"] },
            createdAt: { lt: cutoff },
          },
        },
      },
    });
  });

  it("rechecks the listing-threshold timestamp before revoking", () => {
    const cutoff = new Date("2026-02-01T00:00:00.000Z");

    assert.deepEqual(
      guildMemberRevocationSellerWhere("seller_1", "user_1", {
        kind: "listing_threshold",
        listingsBelowThresholdBefore: cutoff,
      }),
      {
        id: "seller_1",
        guildLevel: "GUILD_MEMBER",
        listingsBelowThresholdSince: { lt: cutoff },
      },
    );
  });
});
