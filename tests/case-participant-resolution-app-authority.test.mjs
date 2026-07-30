import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  validateParticipantResolutionResult,
} from "../src/lib/caseParticipantResolutionResult.ts";

const route = readFileSync(
  "src/app/api/cases/[id]/mark-resolved/route.ts",
  "utf8",
);
const authority = readFileSync(
  "src/lib/caseParticipantResolutionAuthority.ts",
  "utf8",
);

function auditId(caseId, actorUserId) {
  return `case_resolution_mark_${
    createHash("md5")
      .update(`${caseId}:${actorUserId}`, "utf8")
      .digest("hex")
  }`;
}

function validResult(overrides = {}) {
  const row = {
    caseId: "case-1",
    orderId: "order-1",
    actorUserId: "buyer-1",
    buyerUserId: "buyer-1",
    sellerUserId: "seller-1",
    status: "PENDING_CLOSE",
    buyerMarkedResolved: true,
    sellerMarkedResolved: false,
    auditLogId: auditId("case-1", "buyer-1"),
    action: "updated",
    ...overrides,
  };
  if (!("auditLogId" in overrides)) {
    row.auditLogId = auditId(row.caseId, row.actorUserId);
  }
  return row;
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

describe("Case participant-resolution application authority", () => {
  it("keeps the route on origin, auth, rate-limit, fixed-function, and notification order", () => {
    assertOrdered(route, [
      ["origin guard", "getExplicitCrossOriginPostRejection(req)"],
      ["authentication", "await auth()"],
      ["local actor", "await ensureUserByClerkId(userId)"],
      ["rate limit", "await safeRateLimit(caseActionRatelimit, me.id)"],
      ["fixed authority", "await markCaseParticipantResolved({"],
      ["notification", "await notifyCounterpartyOfResolutionMark({"],
      ["response", "id: result.caseId"],
    ]);
    assert.doesNotMatch(
      route,
      /(?:prisma|tx)\.(?:case|caseMessage)\./,
    );
    assert.doesNotMatch(route, /\bUPDATE\s+"Case"/);
    assert.doesNotMatch(route, /logAdminActionOrThrow/);
    assert.doesNotMatch(route, /lock(?:Order|Case)ForCaseLifecycle/);
  });

  it("uses only database-derived identities for notification and response", () => {
    for (const contract of [
      /caseId: result\.caseId/,
      /orderId: result\.orderId/,
      /buyerId: result\.buyerUserId/,
      /sellerId: result\.sellerUserId/,
      /status: result\.status/,
      /authoritySourceId: result\.auditLogId/,
      /id: result\.caseId/,
      /buyerMarkedResolved: result\.buyerMarkedResolved/,
      /sellerMarkedResolved: result\.sellerMarkedResolved/,
    ]) {
      assert.match(route, contract);
    }
    assert.match(
      route,
      /sourceType: NOTIFICATION_SOURCE_TYPES\.CASE_RESOLUTION_MARK/,
    );
    assert.match(route, /sourceId: authoritySourceId/);
  });

  it("maps only reviewed SQLSTATE families to bounded client responses", () => {
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
  });

  it("calls the exact function and accepts one coherent updated result", () => {
    assert.match(
      authority,
      /SELECT public\.grainline_case_mark_resolved\(\s*\$\{input\.actorUserId\}::text,\s*\$\{input\.caseId\}::text\s*\) AS result/s,
    );
    assert.match(authority, /if \(rows\.length !== 1\)/);
    const result = validateParticipantResolutionResult(
      validResult(),
      { actorUserId: "buyer-1", caseId: "case-1" },
    );
    assert.equal(result.status, "PENDING_CLOSE");
    assert.equal(result.action, "updated");
  });

  it("permits an older stable replay source after the Case later resolves", () => {
    const result = validateParticipantResolutionResult(
      validResult({
        action: "replay",
        buyerMarkedResolved: true,
        sellerMarkedResolved: true,
      }),
      { actorUserId: "buyer-1", caseId: "case-1" },
    );
    assert.equal(result.status, "PENDING_CLOSE");
    assert.equal(result.sellerMarkedResolved, true);
  });

  it("rejects shape, identity, audit, participant, and state drift", () => {
    const input = { actorUserId: "buyer-1", caseId: "case-1" };
    const invalidResults = [
      { ...validResult(), extra: true },
      validResult({ caseId: "case-2" }),
      validResult({ actorUserId: "foreign-1" }),
      validResult({ auditLogId: "case_resolution_mark_forged" }),
      validResult({
          buyerUserId: "buyer-1",
          sellerUserId: "buyer-1",
          actorUserId: "buyer-1",
          auditLogId: auditId("case-1", "buyer-1"),
      }),
      validResult({
          status: "RESOLVED",
          sellerMarkedResolved: false,
      }),
      validResult({
          buyerMarkedResolved: true,
          sellerMarkedResolved: true,
      }),
      validResult({
        action: "replay",
        buyerMarkedResolved: false,
      }),
      validResult({
        action: "replay",
        status: "RESOLVED",
        sellerMarkedResolved: false,
      }),
    ];

    const patterns = [
      /invalid shape/,
      /identity drifted/,
      /identity drifted/,
      /identity drifted/,
      /identity drifted/,
      /state drifted/,
      /state drifted/,
      /state drifted/,
      /state drifted/,
    ];
    for (let index = 0; index < invalidResults.length; index += 1) {
      assert.throws(
        () =>
          validateParticipantResolutionResult(
            invalidResults[index],
            input,
          ),
        patterns[index],
      );
    }
  });
});
