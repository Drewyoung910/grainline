import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { caseEstimatedDeliveryBlockMessage } = await import("../src/lib/caseCreateState.ts");

describe("case create state", () => {
  it("includes the estimated delivery date in early case-block errors", () => {
    assert.equal(
      caseEstimatedDeliveryBlockMessage(new Date("2026-05-12T16:30:00.000Z")),
      "You can open a case after the estimated delivery date (May 12, 2026) if the order still has not arrived.",
    );
  });
});
