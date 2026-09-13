import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  validateCaseMessagePageRows,
} from "../src/lib/caseMessagePageResult.ts";

const MESSAGE_TIME = new Date("2026-07-29T05:40:02.000Z");

function attachment(overrides = {}) {
  return {
    id: "attachment-1",
    contentType: "image/webp",
    byteSize: 2048,
    createdAt: "2026-07-29T05:40:00.000Z",
    ...overrides,
  };
}

function message(overrides = {}) {
  return {
    id: "message-2",
    authorId: "buyer-1",
    authorKind: "BUYER",
    body: "A bounded Case message.",
    createdAt: MESSAGE_TIME,
    attachments: [attachment()],
    ...overrides,
  };
}

describe("Case-message page application authority", () => {
  it("normalizes the exact bounded authority result", () => {
    assert.deepEqual(validateCaseMessagePageRows([message()]), [
      {
        ...message(),
        createdAt: MESSAGE_TIME,
        attachments: [
          {
            ...attachment(),
            createdAt: new Date(attachment().createdAt),
          },
        ],
      },
    ]);
  });

  it("accepts durable null author kind without consulting mutable User role", () => {
    assert.equal(
      validateCaseMessagePageRows([
        message({ authorKind: null }),
      ])[0].authorKind,
      null,
    );
  });

  it("rejects row count, shape, field, and ordering drift", () => {
    const older = message({
      id: "message-1",
      createdAt: new Date(MESSAGE_TIME.getTime() - 1000),
      attachments: [],
    });
    for (const [value, pattern] of [
      [Array.from({ length: 52 }, (_, index) => message({
        id: `message-${index}`,
        createdAt: new Date(MESSAGE_TIME.getTime() - index),
        attachments: [],
      })), /row count/],
      [[message({ leakedEmail: "private@example.invalid" })], /shape/],
      [[message({ authorKind: "ADMIN" })], /message fields/],
      [[message({ body: "x".repeat(5001) })], /message fields/],
      [[message({ createdAt: MESSAGE_TIME.toISOString() })], /timestamp/],
      [[message(), message()], /duplicated/],
      [[older, message({ attachments: [] })], /message order/],
      [[message({
        attachments: Array.from(
          { length: 5 },
          (_, index) => attachment({
            id: `attachment-${index}`,
            createdAt: `2026-07-29T05:40:00.00${index}Z`,
          }),
        ),
      })], /attachments/],
      [[message({ attachments: [
        attachment({ objectKey: "private/key.webp" }),
      ] })], /shape/],
      [[message({ attachments: [
        attachment({ createdAt: "2026-07-29T05:40:00.000" }),
      ] })], /timestamp/],
      [[message({ attachments: [
        attachment({ contentType: "application/pdf" }),
      ] })], /content type/],
      [[message({ attachments: [
        attachment({ byteSize: 8 * 1024 * 1024 + 1 }),
      ] })], /byte size/],
      [[message({ attachments: [
        attachment(),
        attachment(),
      ] })], /duplicated/],
      [[message({ attachments: [
        attachment({
          id: "attachment-2",
          createdAt: "2026-07-29T05:40:01.000Z",
        }),
        attachment(),
      ] })], /attachment order/],
    ]) {
      assert.throws(() => validateCaseMessagePageRows(value), pattern);
    }
  });

  it("uses only the fixed projection and preserves actor-aware callers", () => {
    const authority = fs.readFileSync(
      "src/lib/caseMessagePageAuthority.ts",
      "utf8",
    );
    const history = fs.readFileSync(
      "src/lib/caseMessageHistory.ts",
      "utf8",
    );
    assert.match(authority, /grainline_case_message_page/);
    assert.match(authority, /normalizeDbUserContextUserId/);
    assert.match(authority, /validateCaseMessagePageRows/);
    assert.match(
      history,
      /listCaseMessagePage\(\{[\s\S]*actorUserId,[\s\S]*caseId,[\s\S]*cursor,[\s\S]*limit: CASE_MESSAGE_PAGE_SIZE \+ 1/,
    );
    assert.doesNotMatch(history, /prisma\.caseMessage|author:\s*\{/);

    const pages = [
      [
        "src/app/admin/cases/[id]/page.tsx",
        /findCaseMessageHistoryPage\(\s*staff\.id,\s*caseRecord\.id/,
      ],
      [
        "src/app/dashboard/orders/[id]/page.tsx",
        /findCaseMessageHistoryPage\(me\.id, activeCase\.id/,
      ],
      [
        "src/app/dashboard/sales/[orderId]/page.tsx",
        /findCaseMessageHistoryPage\(me\.id, activeCase\.id/,
      ],
    ];
    for (const [path, contract] of pages) {
      assert.match(fs.readFileSync(path, "utf8"), contract);
    }

    const admin = fs.readFileSync(
      "src/app/admin/cases/[id]/page.tsx",
      "utf8",
    );
    assert.doesNotMatch(admin, /msg\.author\.(?:name|role)/);
    assert.match(admin, /authorId: msg\.authorId/);
  });
});
