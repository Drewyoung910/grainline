import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { validateCaseReplyResult } from "../src/lib/caseReplyResult.ts";

const route = readFileSync("src/app/api/cases/[id]/messages/route.ts", "utf8");
const authority = readFileSync("src/lib/caseReplyAuthority.ts", "utf8");

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";
const ATTACHMENT_ID = "33333333-3333-4333-8333-333333333333";
const CREATED_AT = "2026-07-29T12:34:56.789Z";

function validResult(overrides = {}) {
  return {
    caseId: CASE_ID,
    orderId: "order-1",
    buyerUserId: "buyer-1",
    sellerUserId: "seller-1",
    messageId: MESSAGE_ID,
    authorUserId: "buyer-1",
    authorKind: "BUYER",
    status: "OPEN",
    actsAsStaff: false,
    createdAt: CREATED_AT,
    attachments: [
      {
        id: ATTACHMENT_ID,
        contentType: "image/png",
        byteSize: 1234,
        createdAt: CREATED_AT,
      },
    ],
    action: "created",
    ...overrides,
  };
}

function expected(overrides = {}) {
  return {
    actorUserId: "buyer-1",
    caseId: CASE_ID,
    attachments: [{ contentType: "image/png", byteSize: 1234 }],
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

describe("Case-reply application authority", () => {
  it("keeps request and external-object checks before the fixed write, then stops replays before side effects", () => {
    assertOrdered(route, [
      ["origin guard", "getExplicitCrossOriginPostRejection(req)"],
      ["authentication", "await auth()"],
      ["rate limit", "await safeRateLimit("],
      ["local actor", "await ensureUserByClerkId(userId)"],
      ["bounded body", "await readBoundedJson(req, CASE_MESSAGE_BODY_MAX_BYTES)"],
      ["sanitization", "sanitizeRichText(parsed.body.trim())"],
      ["preflight", "await getCaseMessagePreflight({"],
      ["staff PIN", "await requireStaffAdminPinForApi(req, userId, sessionId)"],
      ["R2 verification", "await verifyPrivateCaseEvidenceForReply({"],
      ["fixed authority", "await replyToCaseWithFixedAuthority({"],
      ["replay stop", 'if (result.action === "replay")'],
      ["notification", "// Notify the appropriate party/parties"],
      ["created response", "return privateJson(message, { status: 201 })"],
    ]);
    assert.doesNotMatch(route, /prisma\.case\.findUnique/);
    assert.doesNotMatch(route, /prisma\.caseMessage|tx\.(?:case|caseMessage)/);
    assert.doesNotMatch(route, /prisma\.\$transaction|referenceDirectUploadCaseAttachment/);
  });

  it("uses database-returned security identities after the fixed call", () => {
    const afterAuthority = route.slice(
      route.indexOf("const message = caseMessageResponse(result, messageBody)"),
    );
    assert.doesNotMatch(afterAuthority, /\bme\.id\b|caseId: id\b/);
    for (const contract of [
      /result\.authorUserId === committedCaseRecord\.buyerId/,
      /relatedUserId: result\.authorUserId/,
      /caseId: result\.caseId/,
      /buyerId: result\.buyerUserId/,
      /sellerId: result\.sellerUserId/,
      /orderId: result\.orderId/,
    ]) {
      assert.match(route, contract);
    }
  });

  it("maps only reviewed SQLSTATE families", () => {
    assert.match(route, /getPrismaRawSqlState\(error\)/);
    for (const state of ["22023", "42501", "23503", "23505", "23514", "40001"]) {
      assert.match(route, new RegExp(`"${state}"`));
    }
    assert.match(route, /if \(sqlState === null\) return null/);
  });

  it("calls the exact fixed function with a typed upload array and accepts one coherent result", () => {
    assert.match(
      authority,
      /SELECT public\.grainline_case_reply\(\s*\$\{input\.actorUserId\}::text,\s*\$\{input\.caseId\}::text,\s*\$\{input\.body\}::text,\s*\$\{uploadIds\}\s*\) AS result/s,
    );
    assert.match(authority, /ARRAY\[\$\{Prisma\.join\(/);
    assert.match(authority, /ARRAY\[\]::text\[\]/);
    assert.match(authority, /if \(rows\.length !== 1\)/);

    const result = validateCaseReplyResult(validResult(), expected());
    assert.equal(result.messageId, MESSAGE_ID);
    assert.equal(result.attachments[0].id, ATTACHMENT_ID);
    assert.equal(result.createdAt.toISOString(), CREATED_AT);
  });

  it("rejects shape, identity, authority, timestamp, attachment, and action drift", () => {
    const invalid = [
      [{ ...validResult(), extra: true }, expected(), /invalid shape/],
      [validResult({ messageId: "message-1" }), expected(), /message is invalid/],
      [validResult({ caseId: "case-2" }), expected(), /identity drifted/],
      [validResult({ authorUserId: "foreign-1" }), expected(), /identity drifted/],
      [validResult({ sellerUserId: "buyer-1" }), expected(), /identity drifted/],
      [validResult({ authorKind: "SELLER" }), expected(), /authority identity drifted/],
      [validResult({ actsAsStaff: "false" }), expected(), /staff mode is invalid/],
      [validResult({ status: "UNDER_REVIEW" }), expected(), /authority identity drifted/],
      [validResult({ createdAt: "2026-07-29T12:34:56Z" }), expected(), /timestamp is invalid/],
      [
        validResult({
          attachments: [{ ...validResult().attachments[0], createdAt: "2026-07-29T12:34:56.790Z" }],
        }),
        expected(),
        /timestamp drifted/,
      ],
      [validResult(), expected({ attachments: [{ contentType: "image/png", byteSize: 999 }] }), /metadata drifted/],
      [validResult({ action: "forged" }), expected(), /action is invalid/],
    ];
    for (const [row, expectation, pattern] of invalid) {
      assert.throws(
        () => validateCaseReplyResult(row, expectation),
        pattern,
      );
    }

    const staff = validateCaseReplyResult(
      validResult({
        authorUserId: "staff-1",
        authorKind: "STAFF",
        actsAsStaff: true,
        status: "UNDER_REVIEW",
      }),
      expected({ actorUserId: "staff-1" }),
    );
    assert.equal(staff.actsAsStaff, true);
  });
});
