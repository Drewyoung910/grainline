import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/user-rls-force-production.yml", "utf8");
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

test("User FORCE is exact-main, CI-bound, ENABLE-bound, and restart-safe", () => {
  assert.match(workflow, /^name: User RLS FORCE Production$/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /inputs\.confirmation == 'force-reviewed-user-rls'/u);
  assert.match(workflow, /ci\.name !== 'CI'/u);
  assert.match(workflow, /ci\.run_attempt !== 1/u);
  assert.match(workflow, /enable\.name !== 'User RLS ENABLE Production'/u);
  assert.match(workflow, /enable\.run_attempt !== 1/u);
  assert.match(workflow, /compareCommitsWithBasehead/u);
  assert.match(workflow, /comparison\.merge_base_commit\.sha !== enable\.head_sha/u);
  assert.match(
    workflow,
    /d6e9e9afca641f527c4c120806c5af219d6b4f08936def91d16c348cff2480c3/u,
  );
  assert.match(workflow, /guard-production-migration-runner\.mjs/u);
  assert.match(workflow, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(workflow, /EXPECTED_USER_RLS_STATE: forced/u);
  assert.match(workflow, /if: steps\.ledger\.outputs\.state == 'enabled'/u);
  assert.equal((workflow.match(/run: npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.match(workflow, /npm run audit:db-grants -- --require-direct-url/u);
  assert.match(workflow, /retention-days: 30/u);
  assert.doesNotMatch(workflow, /vercel|deploy application/iu);
});

test("User FORCE inspects before and after its only mutation", () => {
  const source = workflow.indexOf("Verify exact policyless User FORCE release");
  const boundary = workflow.indexOf("Verify owner connection boundary");
  const preflight = workflow.indexOf("Capture exact read-only User preflight catalog");
  const status = workflow.indexOf("Require every predecessor applied");
  const deploy = workflow.indexOf("Apply only reviewed User FORCE");
  const postflight = workflow.indexOf("Capture exact read-only policyless zero-direct postflight");
  const audit = workflow.indexOf("Audit runtime grants after User FORCE");
  assert.ok(source >= 0 && source < boundary && boundary < preflight);
  assert.ok(preflight < status && status < deploy && deploy < postflight && postflight < audit);
  assert.equal(
    (workflow.match(/node scripts\/user-rls-enable-production-inspect\.mjs/gu) ?? [])
      .length,
    2,
  );
});

test("CI isolates User FORCE until the accepted ENABLE proof completes", () => {
  const isolate = ciWorkflow.indexOf("Isolate accumulated User access until its predecessors pass");
  const broad = ciWorkflow.indexOf("      - name: Tests\n");
  const restoreEnable = ciWorkflow.indexOf("Restore User policyless ENABLE source package");
  const applyEnable = ciWorkflow.indexOf("Apply User policyless ENABLE in disposable PostgreSQL");
  const restoreForce = ciWorkflow.indexOf("Restore User policyless FORCE source package");
  const applyForce = ciWorkflow.indexOf("Apply User policyless FORCE in disposable PostgreSQL");
  const forceAudit = ciWorkflow.indexOf("Audit runtime grants after User policyless FORCE");
  const build = ciWorkflow.indexOf("Production build");
  assert.ok(isolate >= 0 && isolate < broad);
  assert.ok(restoreEnable > broad && applyEnable > restoreEnable);
  assert.ok(restoreForce > applyEnable && applyForce > restoreForce);
  assert.ok(forceAudit > applyForce && forceAudit < build);
  assert.match(
    ciWorkflow,
    /Verify User policyless FORCE catalog[\s\S]*USER_RLS_INSPECTION_ALLOW_LOOPBACK_CI: "1"/u,
  );
  assert.doesNotMatch(workflow, /USER_RLS_INSPECTION_ALLOW_LOOPBACK_CI/u);
  assert.equal((ciWorkflow.match(/20261008020000_force_user_rls/gu) ?? []).length, 5);
  for (const file of [
    "tests/user-rls-force-postgres-proof.test.mjs",
    "tests/user-rls-force-production-workflow.test.mjs",
    "tests/user-rls-force-release.test.mjs",
  ]) {
    assert.equal(ciWorkflow.split(file).length - 1, 3, file);
  }
});
