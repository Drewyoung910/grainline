import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { caseEstimatedDeliveryBlockMessage } = await import("../src/lib/caseCreateState.ts");
const route = readFileSync("src/app/api/cases/route.ts", "utf8");

describe("case create state", () => {
  it("includes the estimated delivery date in early case-block errors", () => {
    assert.equal(
      caseEstimatedDeliveryBlockMessage(new Date("2026-05-12T16:30:00.000Z")),
      "You can open a case after the estimated delivery date (May 12, 2026) if the order still has not arrived.",
    );
  });

  it("returns a friendly conflict for duplicate case creation races", () => {
    assert.match(route, /\(err as \{ code\?: string \}\)\.code === "P2002"/);
    assert.match(route, /A case is already open for this order\./);
    assert.match(route, /status: 409/);
  });
});
