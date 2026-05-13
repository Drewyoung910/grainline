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
