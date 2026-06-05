import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  caseEscalationAvailable,
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
    assert.equal(isResolvableCaseStatus("CLOSED"), false);
  });

  it("limits escalation to discussion states before pending-close or review", () => {
    assert.equal(isEscalatableCaseStatus("OPEN"), true);
    assert.equal(isEscalatableCaseStatus("IN_DISCUSSION"), true);
    assert.equal(isEscalatableCaseStatus("PENDING_CLOSE"), false);
    assert.equal(isEscalatableCaseStatus("UNDER_REVIEW"), false);
    assert.equal(isEscalatableCaseStatus("CLOSED"), false);
  });

  it("matches case escalation availability to timer or unavailable-counterparty policy", () => {
    const now = new Date("2026-06-05T12:00:00.000Z");
    const past = new Date("2026-06-05T11:59:59.000Z");
    const future = new Date("2026-06-05T12:01:00.000Z");

    assert.equal(caseEscalationAvailable("IN_DISCUSSION", past, now), true);
    assert.equal(caseEscalationAvailable("IN_DISCUSSION", now, now), true);
    assert.equal(caseEscalationAvailable("IN_DISCUSSION", future, now), false);
    assert.equal(caseEscalationAvailable("IN_DISCUSSION", future, now, true), true);
    assert.equal(caseEscalationAvailable("OPEN", null, now, true), true);
    assert.equal(caseEscalationAvailable("OPEN", null, now, false), false);
    assert.equal(caseEscalationAvailable("PENDING_CLOSE", past, now, true), false);
  });

  it("uses stable user-facing messages from the resulting status", () => {
    assert.equal(caseResolutionMessage("RESOLVED"), "Case resolved by mutual agreement.");
    assert.equal(caseResolutionMessage("PENDING_CLOSE"), "Waiting for other party to confirm resolution.");
  });
});
