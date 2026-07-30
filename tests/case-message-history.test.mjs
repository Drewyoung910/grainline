import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  buildCaseMessageHistoryCursor,
  CASE_MESSAGE_PAGE_SIZE,
  parseCaseMessageHistoryCursor,
} from "../src/lib/caseMessageCursor.ts";

describe("CaseMessage history pagination", () => {
  it("round-trips a stable timestamp and id cursor", () => {
    const cursor = {
      createdAt: new Date("2026-07-26T16:30:00.123Z"),
      id: "cm_case_message_123",
    };
    const encoded = buildCaseMessageHistoryCursor(cursor);

    assert.deepEqual(parseCaseMessageHistoryCursor(encoded), cursor);
    assert.equal(encoded.includes("="), false);
  });

  it("rejects malformed, ambiguous, and oversized cursors", () => {
    assert.equal(parseCaseMessageHistoryCursor(undefined), null);
    assert.equal(parseCaseMessageHistoryCursor(["one", "two"]), null);
    assert.equal(parseCaseMessageHistoryCursor("x".repeat(513)), null);
    assert.equal(
      parseCaseMessageHistoryCursor(
        Buffer.from(JSON.stringify({ d: "invalid", i: "message" })).toString("base64url"),
      ),
      null,
    );
    assert.equal(
      parseCaseMessageHistoryCursor(
        Buffer.from(
          JSON.stringify({ d: "2026-07-26T16:30:00.123Z", i: "../message" }),
        ).toString("base64url"),
      ),
      null,
    );
  });

  it("keeps the database query bounded and tie-stable", () => {
    const source = fs.readFileSync("src/lib/caseMessageHistory.ts", "utf8");
    assert.equal(CASE_MESSAGE_PAGE_SIZE, 50);
    assert.match(source, /listCaseMessagePage\(\{/);
    assert.match(source, /cursor,/);
    assert.match(source, /limit: CASE_MESSAGE_PAGE_SIZE \+ 1/);
    assert.doesNotMatch(source, /prisma\.caseMessage/);
    assert.match(source, /messages: descendingPage\.reverse\(\)/);
  });

  it("requires returning to the latest page before reply or resolution actions", () => {
    for (const path of [
      "src/app/dashboard/orders/[id]/page.tsx",
      "src/app/dashboard/sales/[orderId]/page.tsx",
      "src/app/admin/cases/[id]/page.tsx",
    ]) {
      const page = fs.readFileSync(path, "utf8");
      assert.match(page, /!caseMessageHistory\.isHistoricalPage/);
      assert.match(page, /<CaseMessageHistoryNav/);
    }
  });
});
