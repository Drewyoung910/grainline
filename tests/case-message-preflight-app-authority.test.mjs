import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  validateCaseMessagePreflight,
} from "../src/lib/caseMessagePreflightResult.ts";

const CASE_ID = "case-1";
const ACTOR_ID = "buyer-1";

function validResult(overrides = {}) {
  return {
    caseId: CASE_ID,
    orderId: "order-1",
    buyerUserId: ACTOR_ID,
    sellerUserId: "seller-1",
    status: "OPEN",
    authorKind: "BUYER",
    actsAsStaff: false,
    canCreateMessage: true,
    recipientUnavailableReason: null,
    ...overrides,
  };
}

describe("Case-message preflight application authority", () => {
  it("calls one exact fixed projection and validates its result", () => {
    const authority = readFileSync(
      "src/lib/caseMessagePreflightAuthority.ts",
      "utf8",
    );
    assert.match(
      authority,
      /FROM public\.grainline_case_message_preflight\([\s\S]*\$\{input\.actorUserId\}::text,[\s\S]*\$\{input\.caseId\}::text/,
    );
    assert.match(authority, /if \(rows\.length === 0\) return null/);
    assert.match(authority, /if \(rows\.length !== 1\)/);
    assert.match(authority, /validateCaseMessagePreflight\(rows\[0\], input\)/);
  });

  it("accepts coherent buyer, seller and staff authority", () => {
    assert.equal(
      validateCaseMessagePreflight(validResult(), {
        actorUserId: ACTOR_ID,
        caseId: CASE_ID,
      }).authorKind,
      "BUYER",
    );
    assert.equal(
      validateCaseMessagePreflight(
        validResult({
          authorKind: "SELLER",
          buyerUserId: "buyer-1",
          sellerUserId: "seller-1",
        }),
        { actorUserId: "seller-1", caseId: CASE_ID },
      ).authorKind,
      "SELLER",
    );
    assert.equal(
      validateCaseMessagePreflight(
        validResult({
          authorKind: "STAFF",
          actsAsStaff: true,
          status: "UNDER_REVIEW",
          recipientUnavailableReason: null,
        }),
        { actorUserId: "staff-1", caseId: CASE_ID },
      ).canCreateMessage,
      true,
    );
  });

  it("rejects shape, identity, role, recipient and status drift", () => {
    const invalid = [
      [{ ...validResult(), extra: true }, ACTOR_ID, /invalid shape/],
      [validResult({ caseId: "case-2" }), ACTOR_ID, /identity drifted/],
      [validResult({ sellerUserId: ACTOR_ID }), ACTOR_ID, /identity drifted/],
      [validResult({ authorKind: "STAFF" }), ACTOR_ID, /authority identity drifted/],
      [validResult({ actsAsStaff: true }), ACTOR_ID, /authority identity drifted/],
      [validResult({ status: "forged" }), ACTOR_ID, /status is invalid/],
      [validResult({ canCreateMessage: false }), ACTOR_ID, /messageable state drifted/],
      [validResult({ recipientUnavailableReason: "forged" }), ACTOR_ID, /recipient state is invalid/],
    ];
    for (const [value, actorUserId, pattern] of invalid) {
      assert.throws(
        () =>
          validateCaseMessagePreflight(value, {
            actorUserId,
            caseId: CASE_ID,
          }),
        pattern,
      );
    }

    assert.throws(
      () =>
        validateCaseMessagePreflight(
          validResult({
            authorKind: "STAFF",
            actsAsStaff: true,
            recipientUnavailableReason: "missing",
          }),
          { actorUserId: "staff-1", caseId: CASE_ID },
        ),
      /authority identity drifted/,
    );
    assert.throws(
      () =>
        validateCaseMessagePreflight(
          validResult({
            status: "UNDER_REVIEW",
            canCreateMessage: true,
          }),
          { actorUserId: ACTOR_ID, caseId: CASE_ID },
        ),
      /messageable state drifted/,
    );
  });
});
