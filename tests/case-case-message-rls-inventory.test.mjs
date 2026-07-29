import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  collectCaseCaseMessageAccess,
  summarizeCaseCaseMessageAccess,
} from "../scripts/case-case-message-rls-inventory.mjs";

const EXPECTED_BASELINE = {
  "src/app/api/cases/[id]/escalate/route.ts": {
    "Case.findUnique": 1,
    "Case.updateMany": 1,
    "Case.raw-sql-reference": 1,
  },
  "src/app/api/cases/[id]/resolve/route.ts": {
    "Case.findUnique": 2,
    "CaseMessage.relation-reference": 1,
  },
  "src/app/api/cron/case-auto-close/route.ts": {
    "Case.updateMany": 3,
    "Case.findMany": 3,
  },
  "src/lib/accountDeletion.ts": {
    "CaseMessage.update": 1,
    "Case.update": 1,
    "Case.count": 1,
    "CaseMessage.updateMany": 1,
    "Case.updateMany": 1,
    "CaseMessage.raw-sql-reference": 2,
    "Case.raw-sql-reference": 4,
  },
  "src/lib/caseLifecycleLocks.ts": {
    "Case.raw-sql-reference": 1,
  },
};

describe("Case and CaseMessage RLS inventory", () => {
  const inventory = collectCaseCaseMessageAccess();

  it("pins every current direct, relation, and raw SQL access path", () => {
    assert.equal(inventory.ormCalls.length, 15);
    assert.equal(inventory.relationReferences.length, 1);
    assert.equal(inventory.rawSqlReferences.length, 8);
    assert.deepEqual(
      summarizeCaseCaseMessageAccess(inventory),
      EXPECTED_BASELINE,
    );
  });

  it("records the behavior and authority gate before policy SQL", () => {
    const audit = fs.readFileSync(
      "docs/case-case-message-pre-rls-audit.md",
      "utf8",
    );
    const plan = fs.readFileSync(
      "docs/rls-case-case-message-plan.md",
      "utf8",
    );
    assert.match(audit, /69 total protected references across 25 source files/);
    assert.match(
      audit,
      /80 total protected references\s+across 29 source files/,
    );
    assert.match(audit, /durable source-derived author kind/);
    assert.match(audit, /same Order lock before (?:their|its) conflict\s+predicates/);
    assert.match(audit, /bounded `\(createdAt,id\)` keyset history/);
    assert.match(audit, /scheduled transition must use the expired `sellerRespondBy` boundary/);
    assert.match(audit, /Include a private-object-backed `CaseMessageAttachment` image model/);
    assert.match(audit, /persist an opaque object key rather than a public URL/);
    assert.match(audit, /PDF evidence remains prohibited/);
    assert.match(
      audit,
      /exact 80-reference conversion baseline, 24-reference current countdown\s+and fifty-six-reference converted ledger are pinned by tests/,
    );
    assert.match(
      audit,
      /machine-readable authority catalog maps every source to a\s+fixed operation/,
    );
    assert.match(plan, /Switch back to Extra High before Phase 1B/);
    assert.match(plan, /Convert every protected reference/);
    assert.match(
      plan,
      /Case, CaseMessage and CaseMessageAttachment must activate together/,
    );
    assert.match(plan, /FORCE-only migration that changes no row, policy, grant/);

    const feasibilityPlan = fs.readFileSync(
      "docs/rls-feasibility-plan.md",
      "utf8",
    );
    assert.match(feasibilityPlan, /original prototype ordering, not the current rollout queue/);
    assert.match(feasibilityPlan, /audit Case\/CaseMessage next as a separate narrow boundary/);
  });
});
