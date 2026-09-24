import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { assertOrderProductionInvocationContext } from "../scripts/order-zero-direct-production-invocation.mjs";
import { executeOrderZeroDirectProductionInvocationFromRunner } from "../scripts/order-zero-direct-production-execute-invocation.mjs";

const commit = "a".repeat(40), ownerUrl = "postgresql://fixture.invalid/never-connect";
const ownerUrlSha256 = createHash("sha256").update(ownerUrl).digest("hex");
const reviewed = { releaseCommit: commit, sourceCatalogSha256: "b".repeat(64) };
const ci = { ciRunId: "789", ciRunAttempt: "1" };
const env = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "Drewyoung910/grainline", GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: commit, GITHUB_WORKFLOW_REF:
    "Drewyoung910/grainline/.github/workflows/order-zero-direct-execute.yml@refs/heads/main",
  GITHUB_JOB: "execute_order_zero_direct", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2",
  RUNNER_NAME: "Hosted Runner" };
const input = { env, directory: "/fixture/checkout", reviewed, ci,
  githubToken: "fixture-token", ownerUrl, ownerUrlSha256 };

test("execution workflow has the shared lock, main-only reviewer and fixed caller", () => {
  const workflow = fs.readFileSync(".github/workflows/order-zero-direct-execute.yml", "utf8");
  assert.match(workflow, /^  group: production-database-migrations$/mu);
  assert.match(workflow, /^  cancel-in-progress: false$/mu);
  assert.match(workflow, /^    environment: Production$/mu);
  assert.match(workflow, /^    if: \$\{\{ github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && inputs\.confirmation == 'apply-reviewed-order-zero-direct-prefix-from-main' \}\}$/mu);
  assert.match(workflow, /run: node scripts\/order-zero-direct-production-execute-runner\.mjs/u);
  assert.doesNotMatch(workflow, /(?:migrate deploy|prisma migrate|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY)/u);
  const preflight = workflow.indexOf("run: node scripts/order-zero-direct-toolchain-preflight.mjs");
  const execute = workflow.indexOf("run: node scripts/order-zero-direct-production-execute-runner.mjs");
  assert.ok(preflight > 0 && execute > preflight);
  assert.doesNotMatch(workflow.slice(preflight, execute), /secrets\.|PRODUCTION_MIGRATION_DIRECT_URL:/u);
});

test("read-only or historical job context cannot enter production execution", async () => {
  let discovered = 0, started = 0;
  const args = { ...input, discoverJobId: async () => { discovered++; return "456"; },
    workerFactory: async () => { started++; throw new Error("not admitted"); } };
  for (const drift of [
    { GITHUB_WORKFLOW_REF: "Drewyoung910/grainline/.github/workflows/order-zero-direct-production.yml@refs/heads/main" },
    { GITHUB_JOB: "inspect_order_zero_direct" },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_SHA: "c".repeat(40) },
  ]) await assert.rejects(executeOrderZeroDirectProductionInvocationFromRunner({ ...args,
    env: { ...env, ...drift } }), /unavailable; preserve release records/u);
  assert.equal(discovered, 0); assert.equal(started, 0);
  assert.throws(() => assertOrderProductionInvocationContext({ ...input,
    admission: { runId: "123", runAttempt: "2", jobId: "456" } }));
});

test("exact execution job starts execute-mode worker and returns bounded result", async () => {
  const calls = []; let closed = 0;
  const workerFactory = async args => {
    assert.equal(args.mode, "execute"); calls.push("start");
    return { prepare: async () => { calls.push("prepare"); return { productionExecutionAuthorized: false }; },
      load: async () => { calls.push("load"); return { productionExecutionAuthorized: false }; },
      executePrefix: async payload => { calls.push("execute-prefix");
        assert.deepEqual(payload.admission, { runId: "123", runAttempt: "2", jobId: "456" });
        return { productionExecutionAuthorized: false, execution: { status: "passed",
          initialPrefix: 0, finalPrefix: 17, appliedMemberCount: 17,
          migrationStatusVerified: true, globalAuthorityVerified: true,
          finalReadOnlyScopeVerified: true } }; },
      close: async () => { calls.push("close"); closed++; } };
  };
  const result = await executeOrderZeroDirectProductionInvocationFromRunner({ ...input,
    discoverJobId: async request => { calls.push("discover"); assert.equal(request.mode, "execute"); return "456"; },
    workerFactory });
  assert.deepEqual(calls, ["discover", "start", "prepare", "load", "execute-prefix", "close"]);
  assert.equal(closed, 1); assert.equal(result.initialPrefix, 0);
  assert.equal(result.appliedMemberCount, 17);
  assert.ok(!JSON.stringify(result).includes(ownerUrl));
  assert.ok(!JSON.stringify(result).includes("fixture-token"));
});

test("execution failure closes worker and suppresses private error text", async () => {
  let closed = 0;
  const workerFactory = async () => ({
    prepare: async () => ({ productionExecutionAuthorized: false }),
    load: async () => ({ productionExecutionAuthorized: false }),
    executePrefix: async () => { throw new Error(`provider body ${ownerUrl}`); },
    close: async () => { closed++; },
  });
  await assert.rejects(executeOrderZeroDirectProductionInvocationFromRunner({ ...input,
    discoverJobId: async () => "456", workerFactory }),
  error => error.message === "Order production prefix invocation unavailable; preserve release records");
  assert.equal(closed, 1);
});
