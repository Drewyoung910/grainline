import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { openCommissionBaseWhere, openCommissionMutationWhere } = await import("../src/lib/commissionState.ts");
const { openCommissionWhere } = await import("../src/lib/commissionExpiry.ts");

describe("commission mutation state", () => {
  it("centralizes the open commission predicate for reads and mutations", () => {
    const now = new Date("2026-05-06T12:00:00.000Z");
    assert.deepEqual(openCommissionBaseWhere(now), {
      status: "OPEN",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      buyerAccountActive: true,
    });
    assert.deepEqual(openCommissionWhere(undefined, now), openCommissionBaseWhere(now));
  });

  it("guards writes to currently open, non-expired requests with active buyers", () => {
    const now = new Date("2026-05-06T12:00:00.000Z");
    assert.deepEqual(openCommissionMutationWhere("commission_1", now), {
      AND: [
        {
          status: "OPEN",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          buyerAccountActive: true,
        },
        { id: "commission_1" },
        {},
      ],
    });
  });

  it("keeps caller ownership filters inside the same atomic predicate", () => {
    const where = openCommissionMutationWhere("commission_1", new Date("2026-05-06T12:00:00.000Z"), {
      buyerId: "buyer_1",
    });

    assert.equal(where.AND[2].buyerId, "buyer_1");
  });
});

describe("commission notices for requests that are no longer open", () => {
  it("names why a request is closed in plain words", async () => {
    const { closedCommissionLabel } = await import("../src/lib/commissionState.ts");
    const past = new Date(Date.now() - 1000);
    assert.equal(closedCommissionLabel({ status: "FULFILLED", expiresAt: null }), "fulfilled");
    assert.equal(closedCommissionLabel({ status: "EXPIRED", expiresAt: past }), "expired");
    assert.equal(closedCommissionLabel({ status: "IN_PROGRESS", expiresAt: null }), "in progress");
    assert.equal(closedCommissionLabel({ status: "OPEN", expiresAt: past }), "expired");
    assert.equal(closedCommissionLabel({ status: "OPEN", expiresAt: null }), "closed");
  });
});
