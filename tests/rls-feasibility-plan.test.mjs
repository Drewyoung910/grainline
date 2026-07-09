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
    assert.match(plan, /server-resolved authenticated local `User\.id`/);
    assert.match(plan, /request body, query string, route param, or other client-supplied value/);
    assert.match(plan, /transaction-local/);
  });

  it("requires performance proof before widening interactive transaction wrappers", () => {
    const plan = source("docs/rls-feasibility-plan.md");
    const defense = source("docs/db-defense-in-depth-plan.md");

    assert.match(plan, /protected-read p95\/p99 latency/);
    assert.match(plan, /interactive-transaction\s+`timeout`\/`maxWait`/);
    assert.match(plan, /connection-hold time/);
    assert.match(plan, /pool saturation/);
    assert.match(plan, /ALTER TABLE \.\.\. DISABLE ROW LEVEL SECURITY/);
    assert.match(plan, /set_config` wrapper harmless/);
    assert.match(defense, /protected-read latency/);
    assert.match(defense, /connection-hold time/);
    assert.match(defense, /set_config` wrapper as a harmless no-op/);
  });

  it("defines concrete staging pass/fail criteria for pooled request context", () => {
    const defense = source("docs/db-defense-in-depth-plan.md");
    const runbook = source("docs/runbook.md");

    assert.match(defense, /Staging Pooling\/Context-Isolation Acceptance Spec/);
    assert.match(defense, /pooled runtime-role `DATABASE_URL`/);
    assert.match(defense, /current_setting\('app\.user_id', true\)/);
    assert.match(defense, /Explicitly empty `app\.user_id`/);
    assert.match(defense, /Concurrent transactions[\s\S]*distinct users[\s\S]*pooled `DATABASE_URL`/);
    assert.match(defense, /pooled connection turnover between users/);
    assert.match(defense, /`pg` pool\s+`maxUses`/);
    assert.match(defense, /Serializable retry tests force at least one retry/);
    assert.match(defense, /Promise\.all/);
    assert.match(defense, /prepared-statement, cached-plan, or transaction-pool protocol errors/);
    assert.match(defense, /prepared statement already exists/);
    assert.match(defense, /prepared statement\s+does not exist/);
    assert.match(defense, /p95 latency is more than 2x\s+baseline or increases by more than 100ms/);
    assert.match(defense, /p99 latency is more than 3x\s+baseline or increases by more than 250ms/);
    assert.match(defense, /Prisma interactive\s+transaction `timeout` or `maxWait`/);
    assert.match(defense, /P2028/);
    assert.match(defense, /connection acquisition wait is above 100ms at p95/);
    assert.match(defense, /p99 hold time exceeds 50%/);
    assert.match(defense, /two consecutive\s+runs on the same commit\/config/);
    assert.match(defense, /Post-rollout drift monitoring/);
    assert.match(defense, /sampled production invariant/);
    assert.match(defense, /synthetic canary/);
    assert.match(runbook, /RLS staging context proof/);
    assert.match(runbook, /pooling\/context-isolation acceptance spec/);
    assert.match(runbook, /autocommit baseline, transaction baseline, and wrapped p95\/p99/);
    assert.match(runbook, /connection turnover\/recycling method/);
    assert.match(runbook, /prepared-statement\/cached-plan\s+error scan result/);
    assert.match(runbook, /flaky repeated result as a stop signal/);
    assert.match(runbook, /After production RLS rollout, rerun the gate/);
  });

  it("keeps public discovery tables out of the first RLS pass", () => {
    const plan = source("docs/rls-feasibility-plan.md");

    assert.match(plan, /Do not enable RLS on public discovery tables/);
    assert.match(plan, /`Listing`/);
    assert.match(plan, /`SellerProfile`/);
    assert.match(plan, /`BlogPost`/);
    assert.match(plan, /`Review`/);
  });

  it("documents SavedBlogPost as direct-owner but wrapper-sensitive", () => {
    const plan = source("docs/rls-feasibility-plan.md");
    const defense = source("docs/db-defense-in-depth-plan.md");

    assert.match(plan, /SavedBlogPost Prototype Edge Cases/);
    assert.match(plan, /No public saved-post aggregate exists today/);
    assert.match(plan, /homepage blog cards/);
    assert.match(plan, /\/api\/account\/feed/);
    assert.match(plan, /parallel Prisma queries/);
    assert.match(defense, /blog index\/author\/detail saved-state reads/);
    assert.match(defense, /owner-only `SELECT` RLS/);
  });

  it("cross-links the RLS plan from the active audit docs", () => {
    const hardening = source("docs/security-hardening-plan.md");
    const auditLog = source("docs/security-audit-log.md");
    const claude = source("CLAUDE.md");

    assert.match(hardening, /docs\/rls-feasibility-plan\.md/);
    assert.match(auditLog, /docs\/rls-feasibility-plan\.md/);
    assert.match(claude, /docs\/rls-feasibility-plan\.md/);
  });
});
