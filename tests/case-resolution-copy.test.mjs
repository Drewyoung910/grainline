import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { caseResolutionCopy } = await import("../src/lib/caseResolutionCopy.ts");

describe("case resolution copy", () => {
  it("uses distinct buyer-facing copy for full refunds", () => {
    const copy = caseResolutionCopy("REFUND_FULL", 12_345, "usd");

    assert.equal(copy.notificationTitle, "Full refund issued");
    assert.equal(copy.body, "A full refund has been issued to your original payment method.");
    assert.equal(copy.emailSubject, "Full refund issued for your case");
    assert.equal(copy.refunding, true);
  });

  it("includes the partial refund amount and currency", () => {
    const copy = caseResolutionCopy("REFUND_PARTIAL", 12_345, "usd");

    assert.equal(copy.notificationTitle, "Partial refund issued");
    assert.equal(copy.body, "A partial refund of $123.45 has been issued to your original payment method.");
    assert.equal(copy.emailSubject, "Partial refund issued for your case");
    assert.equal(copy.refunding, true);
  });

  it("does not imply a refund for dismissed cases", () => {
    const copy = caseResolutionCopy("DISMISSED", null, "usd");

    assert.equal(copy.notificationTitle, "Case dismissed");
    assert.equal(copy.body, "The case has been reviewed and dismissed.");
    assert.equal(copy.emailSubject, "Your case was dismissed");
    assert.equal(copy.refunding, false);
  });
});
