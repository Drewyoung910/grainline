import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  accountExportFilename,
  accountExportHeaders,
  accountExportJsonResponse,
} = await import("../src/lib/accountExportFormat.ts");

describe("account export download format", () => {
  it("uses a deterministic dated filename", () => {
    const now = new Date("2026-04-28T23:59:59.999Z");

    assert.equal(accountExportFilename("user_123", now), "grainline-account-export-user_123-2026-04-28.json");
  });

  it("sets JSON download headers and disables caching", () => {
    const headers = accountExportHeaders("user_123", new Date("2026-04-29T00:00:00.000Z"));

    assert.deepEqual(headers, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="grainline-account-export-user_123-2026-04-29.json"',
      "Cache-Control": "no-store",
    });
  });

  it("serializes account data as pretty JSON", async () => {
    const response = accountExportJsonResponse(
      { account: { id: "user_123" }, buyerOrders: [] },
      "user_123",
      new Date("2026-04-28T12:00:00.000Z"),
    );

    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(
      response.headers.get("content-disposition"),
      'attachment; filename="grainline-account-export-user_123-2026-04-28.json"',
    );
    assert.equal(
      await response.text(),
      '{\n  "account": {\n    "id": "user_123"\n  },\n  "buyerOrders": []\n}',
    );
  });
});
