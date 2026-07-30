import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  validateCaseStaffQueueResult,
} from "../src/lib/caseStaffQueueResult.ts";

const CREATED_AT = "2026-07-29T05:00:00.000Z";

function queueRow(overrides = {}) {
  return {
    id: "case-1",
    orderId: "order-1",
    buyerLabel: "Buyer One",
    buyerSecondaryEmail: "buyer@example.invalid",
    sellerLabel: "Seller One",
    reason: "DAMAGED",
    status: "OPEN",
    messageCount: 2,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

describe("Case staff queue application authority", () => {
  it("normalizes the exact bounded queue projection", () => {
    assert.deepEqual(
      validateCaseStaffQueueResult(
        {
          totalCount: 1n,
          safePage: 1,
          cases: [queueRow()],
        },
        {
          requestedPage: 1,
          pageSize: 25,
          statusFilter: null,
        },
      ),
      {
        totalCount: 1,
        safePage: 1,
        cases: [
          {
            ...queueRow(),
            createdAt: new Date(CREATED_AT),
          },
        ],
      },
    );
  });

  it("accepts an exact empty filtered result and clamped final page", () => {
    assert.deepEqual(
      validateCaseStaffQueueResult(
        { totalCount: 0n, safePage: 1, cases: [] },
        {
          requestedPage: 1000,
          pageSize: 25,
          statusFilter: "CLOSED",
        },
      ),
      { totalCount: 0, safePage: 1, cases: [] },
    );
    assert.equal(
      validateCaseStaffQueueResult(
        {
          totalCount: 26n,
          safePage: 2,
          cases: [queueRow({ id: "case-26", status: "RESOLVED" })],
        },
        {
          requestedPage: 1000,
          pageSize: 25,
          statusFilter: "RESOLVED",
        },
      ).safePage,
      2,
    );
  });

  it("rejects result, pagination, identity, contact, enum, count, and timestamp drift", () => {
    for (const [value, expected, pattern] of [
      [
        { totalCount: 1n, safePage: 1, cases: [queueRow()], leaked: true },
        { requestedPage: 1, pageSize: 25, statusFilter: null },
        /result.*shape/,
      ],
      [
        { totalCount: 1n, safePage: 2, cases: [queueRow()] },
        { requestedPage: 2, pageSize: 25, statusFilter: null },
        /pagination/,
      ],
      [
        { totalCount: 26n, safePage: 1, cases: [queueRow()] },
        { requestedPage: 1, pageSize: 25, statusFilter: null },
        /page size/,
      ],
      [
        {
          totalCount: 2n,
          safePage: 1,
          cases: [queueRow(), queueRow()],
        },
        { requestedPage: 1, pageSize: 25, statusFilter: null },
        /duplicate/,
      ],
      [
        {
          totalCount: 1n,
          safePage: 1,
          cases: [queueRow({ leakedEmail: "private@example.invalid" })],
        },
        { requestedPage: 1, pageSize: 25, statusFilter: null },
        /row.*shape/,
      ],
      [
        {
          totalCount: 1n,
          safePage: 1,
          cases: [queueRow({ buyerLabel: "x".repeat(255) })],
        },
        { requestedPage: 1, pageSize: 25, statusFilter: null },
        /buyer label/,
      ],
      [
        {
          totalCount: 1n,
          safePage: 1,
          cases: [queueRow({ buyerLabel: "" })],
        },
        { requestedPage: 1, pageSize: 25, statusFilter: null },
        /buyer label/,
      ],
      [
        {
          totalCount: 1n,
          safePage: 1,
          cases: [queueRow({ status: "OPEN" })],
        },
        { requestedPage: 1, pageSize: 25, statusFilter: "RESOLVED" },
        /status filter/,
      ],
      [
        {
          totalCount: 1n,
          safePage: 1,
          cases: [queueRow({ messageCount: -1 })],
        },
        { requestedPage: 1, pageSize: 25, statusFilter: null },
        /message count/,
      ],
      [
        {
          totalCount: 1n,
          safePage: 1,
          cases: [queueRow({ createdAt: "2026-07-29T05:00:00.000" })],
        },
        { requestedPage: 1, pageSize: 25, statusFilter: null },
        /UTC offset/,
      ],
    ]) {
      assert.throws(
        () => validateCaseStaffQueueResult(value, expected),
        pattern,
      );
    }
  });

  it("uses one exact fixed authority wrapper", () => {
    const authority = fs.readFileSync(
      "src/lib/caseStaffQueueAuthority.ts",
      "utf8",
    );
    assert.match(authority, /normalizeDbUserContextUserId/);
    assert.match(authority, /grainline_case_staff_queue\(/);
    assert.match(authority, /validateCaseStaffQueueResult/);
    assert.doesNotMatch(
      authority,
      /prisma\.(?:case|caseMessage|user)|\$transaction|\$queryRawUnsafe/,
    );
  });

  it("routes the PIN-gated staff page through the fixed queue", () => {
    const page = fs.readFileSync("src/app/admin/cases/page.tsx", "utf8");
    assert.match(page, /requireAdminPageAccess/);
    assert.match(page, /getStaffCaseQueue/);
    assert.match(page, /buyerSecondaryEmail/);
    assert.match(page, /messageCount/);
    assert.doesNotMatch(page, /prisma\.(?:case|caseMessage|user)/);
    assert.doesNotMatch(page, /\b(?:clerkId|stripeRefundId|description)\b/);
  });
});
