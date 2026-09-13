import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  caseMessageStatusTransition,
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

  it("allows party messages only before staff review starts", () => {
    assert.equal(canCreateCaseMessageForStatus("OPEN"), true);
    assert.equal(canCreateCaseMessageForStatus("IN_DISCUSSION"), true);
    assert.equal(canCreateCaseMessageForStatus("PENDING_CLOSE"), true);
    assert.equal(canCreateCaseMessageForStatus("UNDER_REVIEW"), false);
    assert.equal(canCreateCaseMessageForStatus("RESOLVED"), false);
    assert.equal(canCreateCaseMessageForStatus("CLOSED"), false);
  });

  it("lets staff message cases under review", () => {
    assert.equal(canCreateCaseMessageForStatus("UNDER_REVIEW", { isStaff: true }), true);
    assert.equal(canCreateCaseMessageForStatus("RESOLVED", { isStaff: true }), false);
    assert.equal(canCreateCaseMessageForStatus("CLOSED", { isStaff: true }), false);
  });

  it("reopens pending-close cases when a party continues the discussion", () => {
    assert.equal(
      caseMessageStatusTransition({
        status: "PENDING_CLOSE",
        actorId: "buyer",
        buyerId: "buyer",
        sellerId: "seller",
      }),
      "party_reopened_pending_close",
    );
    assert.equal(
      caseMessageStatusTransition({
        status: "PENDING_CLOSE",
        actorId: "staff",
        buyerId: "buyer",
        sellerId: "seller",
        isStaff: true,
      }),
      "none",
    );
  });

  it("keeps the seller first-reply transition distinct from reopen semantics", () => {
    assert.equal(
      caseMessageStatusTransition({
        status: "OPEN",
        actorId: "seller",
        buyerId: "buyer",
        sellerId: "seller",
      }),
      "seller_started_discussion",
    );
    assert.equal(
      caseMessageStatusTransition({
        status: "OPEN",
        actorId: "buyer",
        buyerId: "buyer",
        sellerId: "seller",
      }),
      "none",
    );
  });
});
