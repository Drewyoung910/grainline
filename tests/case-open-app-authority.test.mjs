import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  validateCaseOpenResult,
} from "../src/lib/caseOpenResult.ts";

const route = readFileSync("src/app/api/cases/route.ts", "utf8");
const authority = readFileSync(
  "src/lib/caseOpenAuthority.ts",
  "utf8",
);

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";
const AUDIT_UUID = "33333333-3333-4333-8333-333333333333";

function validResult(overrides = {}) {
  return {
    caseId: CASE_ID,
    orderId: "order-1",
    buyerUserId: "buyer-1",
    sellerUserId: "seller-1",
    openingMessageId: MESSAGE_ID,
    auditLogId: `case-open-audit:${AUDIT_UUID}`,
    reason: "DAMAGED",
    status: "OPEN",
    action: "created",
    ...overrides,
  };
}

function assertOrdered(source, markers) {
  let prior = -1;
  for (const [label, marker] of markers) {
    const current = source.indexOf(marker);
    assert.ok(current >= 0, `${label} marker is absent`);
    assert.ok(current > prior, `${label} is out of order`);
    prior = current;
  }
}

describe("buyer Case-open application authority", () => {
  it("keeps origin, auth, rate limit, parsing, authority, notification, and response order", () => {
    assertOrdered(route, [
      ["origin guard", "getExplicitCrossOriginPostRejection(req)"],
      ["authentication", "await auth()"],
      ["rate limit", "await safeRateLimit(caseCreateRatelimit, userId)"],
      ["local actor", "await ensureUserByClerkId(userId)"],
      ["bounded body", "await readBoundedJson(req, CASE_CREATE_BODY_MAX_BYTES)"],
      ["sanitization", "sanitizeRichText(parsed.description.trim())"],
      ["fixed authority", "await openCaseWithFixedAuthority({"],
      ["replay stop", 'if (result.action === "replay")'],
      ["notification", "await createNotification({"],
      ["response", "id: result.caseId"],
    ]);
    assert.doesNotMatch(
      route,
      /(?:prisma|tx)\.(?:case|caseMessage)\./,
    );
    assert.doesNotMatch(route, /\b(?:INSERT|UPDATE)\s+"Case"/);
    assert.doesNotMatch(route, /lockOrderForCaseLifecycle/);
    assert.doesNotMatch(route, /logUserAuditActionOrThrow/);
  });

  it("uses only authority-derived identities after the fixed call", () => {
    for (const contract of [
      /userId: result\.sellerUserId/,
      /sourceId: result\.caseId/,
      /link: `\/dashboard\/sales\/\$\{result\.orderId\}`/,
      /relatedUserId: result\.buyerUserId/,
      /where: \{ id: result\.sellerUserId \}/,
      /orderId: result\.orderId/,
      /caseId: result\.caseId/,
      /sellerId: result\.sellerUserId/,
      /id: result\.caseId/,
      /buyerId: result\.buyerUserId/,
      /reason: result\.reason/,
      /status: result\.status/,
    ]) {
      assert.match(route, contract);
    }
  });

  it("maps only reviewed SQLSTATE families and blocks replay side effects", () => {
    assert.match(route, /getPrismaRawSqlState\(error\)/);
    for (const state of [
      "22023",
      "23503",
      "42501",
      "23505",
      "23514",
      "40001",
    ]) {
      assert.match(route, new RegExp(`"${state}"`));
    }
    assert.match(route, /if \(sqlState === null\) return null/);
    assertOrdered(route, [
      ["fixed authority", "await openCaseWithFixedAuthority({"],
      ["replay response", 'if (result.action === "replay")'],
      ["notification", "await createNotification({"],
      ["email preference", "await shouldSendEmail("],
    ]);
  });

  it("calls the exact function and accepts one coherent result", () => {
    assert.match(
      authority,
      /SELECT public\.grainline_case_open\(\s*\$\{input\.actorUserId\}::text,\s*\$\{input\.orderId\}::text,\s*\$\{input\.reason\}::text,\s*\$\{input\.description\}::text\s*\) AS result/s,
    );
    assert.match(authority, /if \(rows\.length !== 1\)/);
    const result = validateCaseOpenResult(
      validResult(),
      {
        actorUserId: "buyer-1",
        orderId: "order-1",
        reason: "DAMAGED",
      },
    );
    assert.equal(result.caseId, CASE_ID);
    assert.equal(result.action, "created");
  });

  it("rejects shape, identity, participant, reason, status, and id drift", () => {
    const expected = {
      actorUserId: "buyer-1",
      orderId: "order-1",
      reason: "DAMAGED",
    };
    const invalidResults = [
      { ...validResult(), extra: true },
      validResult({ caseId: "case-1" }),
      validResult({ openingMessageId: "message-1" }),
      validResult({ auditLogId: `other:${AUDIT_UUID}` }),
      validResult({ orderId: "order-2" }),
      validResult({ buyerUserId: "foreign-1" }),
      validResult({ sellerUserId: "buyer-1" }),
      validResult({ reason: "OTHER" }),
      validResult({ status: "RESOLVED" }),
      validResult({ action: "forged" }),
    ];
    const patterns = [
      /invalid shape/,
      /Case-open Case is invalid/,
      /opening message is invalid/,
      /identity drifted/,
      /identity drifted/,
      /identity drifted/,
      /identity drifted/,
      /identity drifted/,
      /Case-open status is invalid/,
      /Case-open action is invalid/,
    ];
    for (let index = 0; index < invalidResults.length; index += 1) {
      assert.throws(
        () => validateCaseOpenResult(invalidResults[index], expected),
        patterns[index],
      );
    }
  });
});
