import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/user-rls-enable-production.yml",
  "utf8",
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

test("User ENABLE is exact-main, CI-bound, convergence-bound, and restart-safe", () => {
  assert.match(workflow, /^name: User RLS ENABLE Production$/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /inputs\.confirmation == 'enable-reviewed-user-rls'/u);
  assert.match(workflow, /ci\.name !== 'CI'/u);
  assert.match(workflow, /ci\.head_sha !== sha/u);
  assert.match(workflow, /ci\.conclusion !== 'success'/u);
  assert.match(
    workflow,
    /convergence\.name !== 'User Cross-Domain Convergence Production'/u,
  );
  assert.match(workflow, /compareCommitsWithBasehead/u);
  assert.match(workflow, /comparison\.merge_base_commit\.sha !== convergence\.head_sha/u);
  assert.match(
    workflow,
    /628f1cbb966cde1cb7f05f48ea0c5b890dce074d8f77536b3a67117c0141146f/u,
  );
  assert.match(workflow, /guard-production-migration-runner\.mjs/u);
  assert.match(workflow, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(workflow, /finished_at IS NULL AND rolled_back_at IS NULL/u);
  assert.match(workflow, /EXPECTED_USER_RLS_STATE: \$\{\{ steps\.ledger\.outputs\.state \}\}/u);
  assert.match(workflow, /EXPECTED_USER_RLS_STATE: enabled/u);
  assert.match(workflow, /if: steps\.ledger\.outputs\.state == 'predecessor'/u);
  assert.equal((workflow.match(/run: npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.match(workflow, /npm run audit:db-grants -- --require-direct-url/u);
  assert.match(workflow, /retention-days: 30/u);
  assert.doesNotMatch(workflow, /vercel|deploy application|FORCE ROW LEVEL SECURITY/iu);
});

test("User ENABLE inspects before and after its only mutation", () => {
  const source = workflow.indexOf("Verify exact policyless User ENABLE release");
  const boundary = workflow.indexOf("Verify owner connection boundary");
  const preflight = workflow.indexOf("Capture exact read-only User preflight catalog");
  const status = workflow.indexOf("Require every predecessor applied");
  const deploy = workflow.indexOf("Apply only reviewed User ENABLE");
  const reconverge = workflow.indexOf(
    "Re-converge runtime grants after User ENABLE",
  );
  const postflight = workflow.indexOf("Capture exact read-only policyless zero-direct postflight");
  const audit = workflow.indexOf("Audit runtime grants after User ENABLE");
  assert.ok(source >= 0 && source < boundary && boundary < preflight);
  assert.ok(
    preflight < status &&
      status < deploy &&
      deploy < reconverge &&
      reconverge < postflight &&
      postflight < audit,
  );
  assert.match(
    workflow,
    /--set=runtime_role=grainline_app_runtime[\s\S]*--set=migration_role=neondb_owner[\s\S]*--file=scripts\/provision-runtime-db-role\.sql/u,
  );
  assert.equal(
    (workflow.match(/node scripts\/user-rls-enable-production-inspect\.mjs/gu) ?? [])
      .length,
    2,
  );
});

test("CI isolates User ENABLE until all User authorities have replayed", () => {
  const isolate = ciWorkflow.indexOf(
    "Isolate accumulated User access until its predecessors pass",
  );
  const broad = ciWorkflow.indexOf("      - name: Tests\n");
  const restore = ciWorkflow.indexOf("Restore User policyless ENABLE source package");
  const reverify = ciWorkflow.indexOf("Re-verify User policyless ENABLE source package");
  const stageLedger = ciWorkflow.indexOf(
    "Stage exact User authority ledger for integrated ENABLE proof",
  );
  const apply = ciWorkflow.indexOf(
    "Apply User policyless ENABLE in disposable PostgreSQL",
  );
  const reconverge = ciWorkflow.indexOf(
    "Re-converge runtime grants after User policyless ENABLE",
  );
  const finalAudit = ciWorkflow.indexOf(
    "Audit runtime grants after User policyless ENABLE",
  );
  const build = ciWorkflow.indexOf("Production build");
  const staffAudit = ciWorkflow.indexOf(
    "Audit runtime grants after User staff admin-label authority",
  );
  assert.ok(isolate >= 0 && isolate < broad);
  assert.ok(staffAudit > broad && restore > staffAudit && reverify > restore);
  assert.ok(reverify < stageLedger && stageLedger < apply);
  assert.ok(apply < reconverge && reconverge < finalAudit && finalAudit < build);
  assert.match(
    ciWorkflow,
    /--set=runtime_role=grainline_app_runtime[\s\S]*--set=migration_role=ci[\s\S]*--file=scripts\/provision-runtime-db-role\.sql/u,
  );
  assert.equal(
    (ciWorkflow.match(/20261008010000_enable_user_rls/gu) ?? []).length,
    5,
  );
  for (const file of [
    "tests/user-rls-enable-postgres-proof.test.mjs",
    "tests/user-rls-enable-production-inspect.test.mjs",
    "tests/user-rls-enable-production-workflow.test.mjs",
    "tests/user-rls-enable-release.test.mjs",
  ]) {
    assert.equal(ciWorkflow.split(file).length - 1, 3, file);
  }
});
