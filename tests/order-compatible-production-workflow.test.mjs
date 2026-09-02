import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/order-compatible-production.yml",
  "utf8",
);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("workflow binds one protected exact-main compatibility operation", () => {
  assert.match(workflow, /^name: Order Compatible Production Preparation$/m);
  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.match(workflow, /release_commit:[\s\S]*main_ci_run_id:[\s\S]*confirmation:/u);
  assert.match(workflow, /github\.repository == 'Drewyoung910\/grainline'/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /group: production-database-migrations/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /apply-reviewed-order-compatible-authority/u);
  assert.match(workflow, /run\.name !== 'CI'/u);
  assert.match(workflow, /run\.event !== 'push'/u);
  assert.match(workflow, /run\.head_sha !== releaseCommit/u);
  assert.match(workflow, /run\.conclusion !== 'success'/u);
});

test("workflow isolates Case and deploys only the exact Order prefix", () => {
  assert.match(
    workflow,
    /latest[\s\S]*20260901160000_correct_case_order_invariants/u,
  );
  const isolate = workflow.indexOf("Isolate unapplied Case correctness successor");
  const inspect = workflow.indexOf("Inspect exact restart scope read-only");
  const deploy = workflow.indexOf("- name: Apply compatible Order authority stack");
  const restore = workflow.indexOf(
    "Restore the still-unapplied Case successor in the runner tree",
  );
  assert.ok(isolate > 0 && isolate < inspect && inspect < deploy && deploy < restore);
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.match(workflow, /migrationPrefixLength < 0/u);
  assert.match(workflow, /migrationPrefixLength > 18/u);
  assert.match(workflow, /steps\.scope\.outputs\.prefix != '18'/u);
  assert.match(workflow, /ORDER_COMPATIBLE_PRODUCTION_SCOPE_STAGE: restart/u);
  assert.match(workflow, /ORDER_COMPATIBLE_PRODUCTION_SCOPE_STAGE: after/u);
  assert.match(workflow, /npm run audit:db-grants -- --require-direct-url/u);
  assert.doesNotMatch(workflow, /vercel|stripe|shippo|cloudflare/iu);
});

test("package exposes only the read-only scope verifier", () => {
  assert.equal(
    pkg.scripts["audit:order-compatible-production-scope"],
    "node scripts/verify-order-compatible-production-scope.mjs",
  );
});
