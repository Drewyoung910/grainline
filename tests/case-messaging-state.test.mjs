import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  canCreateCaseMessageForStatus,
  unavailableCaseMessageRecipientReason,
  unavailableCaseRecipientMessage,
} = await import("../src/lib/caseMessagingState.ts");

describe("case messaging account-state guard", () => {
  const buyer = { id: "buyer", banned: false, deletedAt: null };
  const seller = { id: "seller", banned: false, deletedAt: null };

  it("allows party messages when the recipient account is active", () => {
    assert.equal(
      unavailableCaseMessageRecipientReason({ senderId: "buyer", buyer, seller, isStaff: false }),
      null,
    );
  });

  it("blocks party-to-party messages to suspended, deleted, or missing recipients", () => {
    assert.equal(
      unavailableCaseMessageRecipientReason({
        senderId: "buyer",
        buyer,
        seller: { ...seller, banned: true },
        isStaff: false,
      }),
      "suspended",
    );
    assert.equal(
      unavailableCaseMessageRecipientReason({
        senderId: "seller",
        buyer: { ...buyer, deletedAt: new Date("2026-01-01T00:00:00Z") },
        seller,
        isStaff: false,
      }),
      "deleted",
    );
    assert.equal(
      unavailableCaseMessageRecipientReason({ senderId: "seller", buyer: null, seller, isStaff: false }),
      "missing",
    );
  });

  it("allows staff to message cases even when a party account is unavailable", () => {
    assert.equal(
      unavailableCaseMessageRecipientReason({
        senderId: "staff",
        buyer,
        seller: { ...seller, banned: true },
        isStaff: true,
      }),
      null,
    );
  });

  it("keeps user-facing messages actionable", () => {
    assert.match(unavailableCaseRecipientMessage("suspended"), /Escalate this case/);
    assert.match(unavailableCaseRecipientMessage("deleted"), /Escalate this case/);
    assert.match(unavailableCaseRecipientMessage("missing"), /Escalate this case/);
  });

  it("allows messages only while the case is still open", () => {
    assert.equal(canCreateCaseMessageForStatus("OPEN"), true);
    assert.equal(canCreateCaseMessageForStatus("IN_DISCUSSION"), true);
    assert.equal(canCreateCaseMessageForStatus("PENDING_CLOSE"), true);
    assert.equal(canCreateCaseMessageForStatus("UNDER_REVIEW"), true);
    assert.equal(canCreateCaseMessageForStatus("RESOLVED"), false);
    assert.equal(canCreateCaseMessageForStatus("CLOSED"), false);
  });
});
