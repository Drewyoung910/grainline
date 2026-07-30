import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  validateCaseEscalationResult,
} from "../src/lib/caseEscalationResult.ts";

function auditId(caseId, actorUserId) {
  const material =
    `${Buffer.byteLength(caseId, "utf8")}:${caseId}:`
    + `${Buffer.byteLength(actorUserId, "utf8")}:${actorUserId}`;
  return `case_escalation_${createHash("sha256")
    .update(material, "utf8")
    .digest("hex")}`;
}

function result(overrides = {}) {
  const caseId = "case_1";
  const actorUserId = "buyer_1";
  return {
    caseId,
    orderId: "order_1",
    actorUserId,
    buyerUserId: actorUserId,
    sellerUserId: "seller_1",
    previousStatus: "IN_DISCUSSION",
    status: "UNDER_REVIEW",
    auditLogId: auditId(caseId, actorUserId),
    actorKind: "user",
    action: "updated",
    ...overrides,
  };
}

describe("Case-escalation result validation", () => {
  it("accepts an exact participant result and a distinct staff result", () => {
    assert.equal(
      validateCaseEscalationResult(
        result(),
        { actorUserId: "buyer_1", caseId: "case_1" },
      ).status,
      "UNDER_REVIEW",
    );
    const staff = result({
      actorUserId: "staff_1",
      buyerUserId: "buyer_1",
      actorKind: "staff",
      auditLogId: auditId("case_1", "staff_1"),
      action: "replay",
    });
    assert.equal(
      validateCaseEscalationResult(
        staff,
        { actorUserId: "staff_1", caseId: "case_1" },
      ).actorKind,
      "staff",
    );
  });

  it("rejects extra fields, target drift, role drift, and audit drift", () => {
    for (const invalid of [
      result({ extra: true }),
      result({ caseId: "case_2" }),
      result({ actorKind: "staff" }),
      result({ auditLogId: "case_escalation_wrong" }),
      result({ previousStatus: "RESOLVED" }),
    ]) {
      assert.throws(
        () => validateCaseEscalationResult(
          invalid,
          { actorUserId: "buyer_1", caseId: "case_1" },
        ),
        /Case-escalation/,
      );
    }
  });
});
