import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/case-correctness-production.yml",
  "utf8",
);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("workflow binds one protected exact-main Case correction", () => {
  assert.match(workflow, /^name: Case Correctness Production Compatibility$/m);
  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.match(workflow, /github\.repository == 'Drewyoung910\/grainline'/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /group: production-database-migrations/u);
  assert.match(workflow, /apply-reviewed-case-correctness/u);
  assert.match(workflow, /run\.name !== 'CI'/u);
  assert.match(workflow, /run\.event !== 'push'/u);
  assert.match(workflow, /run\.head_sha !== releaseCommit/u);
  assert.match(workflow, /run\.conclusion !== 'success'/u);
});

test("workflow requires the complete Order prefix and applies only Case", () => {
  assert.match(
    workflow,
    /latest[\s\S]*20260901160000_correct_case_order_invariants/u,
  );
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.match(workflow, /\["order-compatible", "case-corrected"\]/u);
  assert.match(workflow, /value\.orderMigrationCount !== 17/u);
  assert.match(workflow, /value\.caseRlsForced !== true/u);
  assert.match(workflow, /value\.directRuntimeCrud !== false/u);
  assert.match(workflow, /steps\.scope\.outputs\.state == 'order-compatible'/u);
  assert.match(workflow, /CASE_CORRECTNESS_PRODUCTION_SCOPE_STAGE: restart/u);
  assert.match(workflow, /CASE_CORRECTNESS_PRODUCTION_SCOPE_STAGE: after/u);
  assert.match(workflow, /npm run audit:db-grants -- --require-direct-url/u);
  assert.doesNotMatch(workflow, /vercel|stripe|shippo|cloudflare/iu);
});

test("package exposes only the read-only Case scope verifier", () => {
  assert.equal(
    pkg.scripts["audit:case-correctness-production-scope"],
    "node scripts/verify-case-correctness-production-scope.mjs",
  );
});
