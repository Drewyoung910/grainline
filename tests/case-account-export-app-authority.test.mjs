import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  validateCaseAccountExportPage,
} from "../src/lib/caseAccountExportResult.ts";

const CASE_TIME = new Date("2026-07-29T12:00:00.000Z");

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
    sellerRespondBy: new Date("2026-07-31T12:00:00.000Z"),
    resolvedAt: null,
    createdAt: CASE_TIME,
    updatedAt: CASE_TIME,
    ...overrides,
  };
}

describe("Case account-export application authority", () => {
  it("validates the exact participant page and rejects authority drift", () => {
    const participantExpectation = {
      actorUserId: "buyer-1",
      cursor: null,
    };
    assert.deepEqual(
      validateCaseAccountExportPage([caseRow()], {
        actorUserId: "buyer-1",
        cursor: null,
      }),
      [caseRow()],
    );
    for (const [value, pattern, expected = participantExpectation] of [
      [[caseRow({ leakedEmail: "private@example.invalid" })], /shape/],
      [[caseRow({ buyerId: "other-1" })], /participant identity/],
      [[caseRow({ sellerId: "buyer-1" })], /participant identity/],
      [[caseRow({ description: "x".repeat(5001) })], /description/],
      [[caseRow({ status: "DELETED" })], /status/],
      [[caseRow({ refundAmountCents: -1 })], /refund amount/],
      [[caseRow({ createdAt: CASE_TIME.toISOString() })], /creation time/],
      [[caseRow(), caseRow()], /duplicated/],
      [[
        caseRow({ id: "case-1", createdAt: new Date(CASE_TIME.getTime() - 1) }),
        caseRow({ id: "case-2", createdAt: CASE_TIME }),
      ], /order/],
      [[caseRow()], /cursor did not advance/, {
        actorUserId: "buyer-1",
        cursor: { createdAt: CASE_TIME, id: "case-1" },
      }],
    ]) {
      assert.throws(
        () => validateCaseAccountExportPage(value, expected),
        pattern,
      );
    }
    assert.throws(
      () => validateCaseAccountExportPage(
        Array.from({ length: 26 }, (_, index) => caseRow({
          id: `case-${index}`,
          createdAt: new Date(CASE_TIME.getTime() - index),
        })),
        { actorUserId: "buyer-1", cursor: null },
      ),
      /page size/,
    );
  });

  it("uses bounded Case and message pages while preserving export order", () => {
    const authority = fs.readFileSync(
      "src/lib/caseAccountExportAuthority.ts",
      "utf8",
    );
    assert.match(authority, /CASE_EXPORT_PAGE_SIZE = 25/);
    assert.match(authority, /MESSAGE_EXPORT_PAGE_SIZE = 51/);
    assert.match(authority, /grainline_case_export_page/);
    assert.match(authority, /listCaseMessagePage/);
    assert.match(authority, /messages\.sort\(compareAscending\)/);
    assert.match(authority, /Case account-export page repeated an id/);
    assert.match(authority, /Case account-export message page repeated an id/);
    assert.doesNotMatch(
      authority,
      /prisma\.(?:case|caseMessage)|\\$transaction|\\$queryRawUnsafe/,
    );
  });

  it("removes all direct Case-family access from both application routes", () => {
    const accountExport = fs.readFileSync(
      "src/app/api/account/export/route.ts",
      "utf8",
    );
    const evidenceRead = fs.readFileSync(
      "src/app/api/cases/[id]/attachments/[attachmentId]/route.ts",
      "utf8",
    );
    assert.match(accountExport, /exportParticipantCases\(user\.id\)/);
    assert.doesNotMatch(
      accountExport,
      /prisma\.(?:case|caseMessage)|messages:\s*\{|attachments:\s*\{/,
    );
    assert.match(evidenceRead, /getVisibleCaseById/);
    assert.match(
      evidenceRead,
      /if \(caseRecord\.actsAsStaff\)[\s\S]*requireStaffAdminPinForApi[\s\S]*readDirectUploadCaseAttachment/,
    );
    assert.doesNotMatch(evidenceRead, /prisma\.case|isParty|isStaff/);
  });
});
