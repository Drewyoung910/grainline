import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  caseResolutionMessage,
  isEscalatableCaseStatus,
  isResolvableCaseStatus,
} = await import("../src/lib/caseActionState.ts");

describe("case action state", () => {
  it("limits mark-resolved to active case states", () => {
    assert.equal(isResolvableCaseStatus("OPEN"), true);
    assert.equal(isResolvableCaseStatus("IN_DISCUSSION"), true);
    assert.equal(isResolvableCaseStatus("PENDING_CLOSE"), true);
    assert.equal(isResolvableCaseStatus("UNDER_REVIEW"), false);
    assert.equal(isResolvableCaseStatus("RESOLVED"), false);
  });

  it("limits escalation to discussion states before pending-close or review", () => {
    assert.equal(isEscalatableCaseStatus("OPEN"), true);
    assert.equal(isEscalatableCaseStatus("IN_DISCUSSION"), true);
    assert.equal(isEscalatableCaseStatus("PENDING_CLOSE"), false);
    assert.equal(isEscalatableCaseStatus("UNDER_REVIEW"), false);
  });

  it("uses stable user-facing messages from the resulting status", () => {
    assert.equal(caseResolutionMessage("RESOLVED"), "Case resolved by mutual agreement.");
    assert.equal(caseResolutionMessage("PENDING_CLOSE"), "Waiting for other party to confirm resolution.");
  });
});
