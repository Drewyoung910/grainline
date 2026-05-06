import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { openCommissionMutationWhere } = await import("../src/lib/commissionState.ts");

describe("commission mutation state", () => {
  it("guards writes to currently open, non-expired requests with active buyers", () => {
    const now = new Date("2026-05-06T12:00:00.000Z");
    assert.deepEqual(openCommissionMutationWhere("commission_1", now), {
      AND: [
        {
          id: "commission_1",
          status: "OPEN",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          buyer: { banned: false, deletedAt: null },
        },
        {},
      ],
    });
  });

  it("keeps caller ownership filters inside the same atomic predicate", () => {
    const where = openCommissionMutationWhere("commission_1", new Date("2026-05-06T12:00:00.000Z"), {
      buyerId: "buyer_1",
    });

    assert.equal(where.AND[1].buyerId, "buyer_1");
  });
});
