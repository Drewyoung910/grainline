import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("documentation archive guardrails", () => {
  it("keeps current operating rules in CLAUDE.md while moving closed audit logs to the archive", () => {
    const claude = source("CLAUDE.md");
    const archive = source("CLOSED_AUDIT_HISTORY.md");

    assert.match(claude, /Completed audit\/fix pass history lives in `CLOSED_AUDIT_HISTORY\.md`/);
    assert.match(claude, /Behavior changes future agents must preserve/);
    assert.match(claude, /pins `"2025-10-29\.clover"` explicitly/);
    assert.match(claude, /adaptive 60s\/5min\/15min\/stop polling/);
    assert.match(claude, /commissionState\.ts/);
    assert.match(claude, /open, non-expired, active-buyer guard/);

    assert.doesNotMatch(claude, /^## Audit Fix Pass — CI Build Gate and Pure Regression Tests/m);
    assert.match(archive, /^## Audit Fix Pass — CI Build Gate and Pure Regression Tests/m);
    assert.match(archive, /^## Comprehensive Audit Fix Pass/m);
  });
});
