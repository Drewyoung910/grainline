import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("case route observability follow-ups", () => {
  it("captures case message email side-effect failures without blocking the main mutation", () => {
    const route = source("src/app/api/cases/[id]/messages/route.ts");

    assert.match(route, /source: "case_staff_message_email"/);
    assert.match(route, /source: "case_party_message_email"/);
    assert.doesNotMatch(route, /catch\s*\{\s*\/\* non-fatal \*\/\s*\}/);
  });

  it("serializes duplicate case message submits before notification side effects", () => {
    const route = source("src/app/api/cases/[id]/messages/route.ts");
    const transactionStart = route.indexOf("const messageResult = await prisma.$transaction");
    const notificationStart = route.indexOf("// Notify the appropriate party/parties");

    assert.match(route, /CASE_MESSAGE_DEDUP_WINDOW_MS = 30_000/);
    assert.match(route, /pg_advisory_xact_lock\(hashtext/);
    assert.match(route, /caseMessage\.findFirst\(\{\s*where: \{\s*caseId: id,\s*authorId: me\.id,\s*body: messageBody,\s*createdAt: \{ gte: duplicateCutoff \}/s);
    assert.match(route, /if \(messageResult\.duplicate\) \{\s*return NextResponse\.json\(messageResult\.message, \{ status: 200 \}\)/s);
    assert.ok(transactionStart !== -1 && notificationStart !== -1 && transactionStart < notificationStart);
  });

  it("captures case resolve email, audit, and refund-remediation failures", () => {
    const route = source("src/app/api/cases/[id]/resolve/route.ts");

    assert.match(route, /source: "case_resolved_email"/);
    assert.match(route, /source: "case_resolve_audit_log"/);
    assert.match(route, /source: "case_refund_orphaned_review_update_failed"/);
    assert.match(route, /source: "case_refund_lock_release_failed"/);
    assert.doesNotMatch(route, /catch\s*\{\s*\/\* non-fatal \*\/\s*\}/);
    assert.doesNotMatch(route, /\.catch\(\(\) => \{\}\)/);
  });
});
