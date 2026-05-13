import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return fs.readFileSync(path, "utf8");
}

describe("RLS feasibility plan guardrails", () => {
  it("keeps RLS staged instead of enabling broad production policies before launch", () => {
    const plan = source("docs/rls-feasibility-plan.md");

    assert.match(plan, /Do not enable RLS directly on production tables before launch/);
    assert.match(plan, /staging prototype on low-blast-radius tables/);
    assert.match(plan, /Notification/);
    assert.match(plan, /SavedSearch/);
  });

  it("requires role separation and transaction-local request context", () => {
    const plan = source("docs/rls-feasibility-plan.md");

    assert.match(plan, /Runtime app role/);
    assert.match(plan, /must not own tables/i);
    assert.match(plan, /must not have `BYPASSRLS`/i);
    assert.match(plan, /set_config\('app\.user_id', \$userId, true\)/);
    assert.match(plan, /transaction-local/);
  });

  it("keeps public discovery tables out of the first RLS pass", () => {
    const plan = source("docs/rls-feasibility-plan.md");

    assert.match(plan, /Do not enable RLS on public discovery tables/);
    assert.match(plan, /`Listing`/);
    assert.match(plan, /`SellerProfile`/);
    assert.match(plan, /`BlogPost`/);
    assert.match(plan, /`Review`/);
  });

  it("cross-links the RLS plan from the active audit docs", () => {
    const hardening = source("docs/security-hardening-plan.md");
    const auditLog = source("docs/security-audit-log.md");
    const openFindings = source("audit_open_findings.md");
    const claude = source("CLAUDE.md");

    assert.match(hardening, /docs\/rls-feasibility-plan\.md/);
    assert.match(auditLog, /docs\/rls-feasibility-plan\.md/);
    assert.match(openFindings, /docs\/rls-feasibility-plan\.md/);
    assert.match(claude, /docs\/rls-feasibility-plan\.md/);
  });
});
