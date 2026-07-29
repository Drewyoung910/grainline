import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  validateCaseReadRow,
  validateCaseStaffActiveCount,
} from "../src/lib/caseReadResult.ts";

const CREATED_AT = new Date("2026-07-29T05:50:00.000Z");
const SELLER_RESPOND_BY = new Date("2026-07-31T05:50:00.000Z");

function caseRow(overrides = {}) {
  return {
    id: "case-1",
    orderId: "order-1",
    buyerId: "buyer-1",
    sellerId: "seller-1",
    reason: "DAMAGED",
    description: "The item arrived damaged.",
    status: "OPEN",
    resolution: null,
    refundAmountCents: null,
    sellerRespondBy: SELLER_RESPOND_BY,
    escalateUnlocksAt: null,
    buyerMarkedResolved: false,
    sellerMarkedResolved: false,
    resolvedAt: null,
    createdAt: CREATED_AT,
    actsAsStaff: false,
    ...overrides,
  };
}

describe("Case recipient-read application authority", () => {
  it("normalizes the exact participant and staff projections", () => {
    assert.deepEqual(
      validateCaseReadRow(caseRow(), {
        actorUserId: "buyer-1",
        caseId: "case-1",
      }),
      caseRow(),
    );
    assert.equal(
      validateCaseReadRow(
        caseRow({ buyerId: null, actsAsStaff: true }),
        {
          actorUserId: "staff-1",
          orderId: "order-1",
        },
      ).actsAsStaff,
      true,
    );
  });

  it("rejects shape, identity, authority, enum, field, and timestamp drift", () => {
    for (const [value, expected, pattern] of [
      [
        caseRow({ leakedEmail: "private@example.invalid" }),
        { actorUserId: "buyer-1", caseId: "case-1" },
        /shape/,
      ],
      [
        caseRow({ id: "case-2" }),
        { actorUserId: "buyer-1", caseId: "case-1" },
        /identity/,
      ],
      [
        caseRow({ orderId: "order-2" }),
        { actorUserId: "buyer-1", orderId: "order-1" },
        /identity/,
      ],
      [
        caseRow({ sellerId: "buyer-1" }),
        { actorUserId: "buyer-1", caseId: "case-1" },
        /identity/,
      ],
      [
        caseRow({ actsAsStaff: true }),
        { actorUserId: "buyer-1", caseId: "case-1" },
        /authority mode/,
      ],
      [
        caseRow(),
        { actorUserId: "foreign-1", caseId: "case-1" },
        /authority mode/,
      ],
      [
        caseRow({ reason: "PAYMENT" }),
        { actorUserId: "buyer-1", caseId: "case-1" },
        /reason/,
      ],
      [
        caseRow({ status: "DELETED" }),
        { actorUserId: "buyer-1", caseId: "case-1" },
        /status/,
      ],
      [
        caseRow({ resolution: "CREDIT" }),
        { actorUserId: "buyer-1", caseId: "case-1" },
        /resolution/,
      ],
      [
        caseRow({ description: "x".repeat(5001) }),
        { actorUserId: "buyer-1", caseId: "case-1" },
        /fields/,
      ],
      [
        caseRow({ refundAmountCents: 1.5 }),
        { actorUserId: "buyer-1", caseId: "case-1" },
        /refund amount/,
      ],
      [
        caseRow({ refundAmountCents: -1 }),
        { actorUserId: "buyer-1", caseId: "case-1" },
        /refund amount/,
      ],
      [
        caseRow({ sellerRespondBy: SELLER_RESPOND_BY.toISOString() }),
        { actorUserId: "buyer-1", caseId: "case-1" },
        /deadline/,
      ],
      [
        caseRow({ createdAt: new Date("invalid") }),
        { actorUserId: "buyer-1", caseId: "case-1" },
        /creation time/,
      ],
    ]) {
      assert.throws(() => validateCaseReadRow(value, expected), pattern);
    }
  });

  it("accepts only one exact safe integer staff count", () => {
    assert.equal(validateCaseStaffActiveCount({ activeCount: 4n }), 4);
    assert.equal(validateCaseStaffActiveCount({ activeCount: 4 }), 4);
    for (const value of [
      { activeCount: -1n },
      { activeCount: 1.5 },
      { activeCount: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
      { activeCount: 1n, leaked: true },
      { activeCount: "4" },
    ]) {
      assert.throws(
        () => validateCaseStaffActiveCount(value),
        /active count/,
      );
    }
  });

  it("uses only fixed one-statement authority wrappers", () => {
    const authority = fs.readFileSync(
      "src/lib/caseReadAuthority.ts",
      "utf8",
    );
    assert.match(authority, /normalizeDbUserContextUserId/);
    assert.match(authority, /grainline_case_get\(/);
    assert.match(authority, /grainline_case_get_by_order\(/);
    assert.match(authority, /grainline_case_staff_active_count\(/);
    assert.match(authority, /validateCaseReadRow/);
    assert.match(authority, /validateCaseStaffActiveCount/);
    assert.doesNotMatch(
      authority,
      /prisma\.(?:case|caseMessage)|\\$transaction|\\$queryRawUnsafe/,
    );
  });
});
