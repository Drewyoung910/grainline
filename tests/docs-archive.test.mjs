import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("documentation archive guardrails", () => {
  it("keeps current operating rules in CLAUDE.md while moving closed audit logs to the archive", () => {
    const claude = source("CLAUDE.md");
    const history = source("CLOSED_AUDIT_HISTORY.md");
    const archive = source("CLOSED_AUDIT_ARCHIVE.md");

    assert.match(claude, /Completed audit\/fix pass history lives in `CLOSED_AUDIT_HISTORY\.md`/);
    assert.match(claude, /Behavior changes future agents must preserve/);
    assert.match(claude, /pins `"2025-10-29\.clover"` explicitly/);
    assert.match(claude, /adaptive 60s\/5min\/15min\/stop polling/);
    assert.match(claude, /commissionState\.ts/);
    assert.match(claude, /open, non-expired, active-buyer guard/);

    assert.doesNotMatch(claude, /^## Audit Fix Pass — CI Build Gate and Pure Regression Tests/m);
    assert.match(history, /Older completed audit-pass sections dated before the rolling 60-day window live in `CLOSED_AUDIT_ARCHIVE\.md`/);
    assert.match(archive, /^## Audit Fix Pass — CI Build Gate and Pure Regression Tests/m);
    assert.match(archive, /^## Comprehensive Audit Fix Pass/m);
  });

  it("keeps dated closed audit history inside the rolling 60-day window", () => {
    const history = source("CLOSED_AUDIT_HISTORY.md");
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const staleHeadings = [];
    const headingPattern = /^## .*\((\d{4}-\d{2}-\d{2})\)$/gm;
    let match;

    while ((match = headingPattern.exec(history)) !== null) {
      const headingDate = new Date(`${match[1]}T00:00:00.000Z`);
      if (headingDate < cutoff) staleHeadings.push(match[0]);
    }

    assert.deepEqual(staleHeadings, []);
  });

  it("keeps recommendation routing in existing operating docs", () => {
    const claude = source("CLAUDE.md");
    const maintainability = source("docs/maintainability-plan.md");

    assert.match(claude, /Recommendation-routing workflow/);
    assert.match(claude, /do not create a generic recommendations folder by default/);
    assert.match(maintainability, /Recommendation routing rule/);
    assert.match(maintainability, /source-backed fixes and guardrails in code\/tests plus `audit_closed\.md`/);
  });
});
