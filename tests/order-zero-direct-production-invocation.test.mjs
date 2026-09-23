import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  assertOrderProductionInvocationContext,
  observeOrderZeroDirectProductionInvocation,
  observeOrderZeroDirectProductionInvocationFromRunner,
} from "../scripts/order-zero-direct-production-invocation.mjs";

const commit = "a".repeat(40), sourceCatalogSha256 = "b".repeat(64);
const ownerUrl = "postgresql://fixture.invalid/never-connect";
const ownerUrlSha256 = createHash("sha256").update(ownerUrl).digest("hex");
const reviewed = { releaseCommit: commit, sourceCatalogSha256 };
const admission = { runId: "123", runAttempt: "2", jobId: "456" };
const ci = { ciRunId: "789", ciRunAttempt: "1" };
const env = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "Drewyoung910/grainline", GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: commit, GITHUB_WORKFLOW_REF:
    "Drewyoung910/grainline/.github/workflows/order-zero-direct-production.yml@refs/heads/main",
  GITHUB_JOB: "inspect_order_zero_direct", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2",
  RUNNER_NAME: "Hosted Runner" };
const input = { env, directory: "/fixture/checkout", reviewed, admission, ci,
  githubToken: "fixture-token", ownerUrl, ownerUrlSha256 };
const steps = ["apply-only-remaining-prefix", "reinspect-exact-complete-prefix",
  "converge-reviewed-runtime-grants", "migration-status", "global-grant-and-RLS-audit",
  "final-read-only-prefix-scope"];

test("historical migration workflow cannot admit an Order invocation", () => {
  assert.throws(() => assertOrderProductionInvocationContext({ ...input,
    env: { ...env, GITHUB_WORKFLOW_REF:
      "Drewyoung910/grainline/.github/workflows/production-migrations.yml@refs/heads/main" } }));
  const source = fs.readFileSync(".github/workflows/order-zero-direct-production.yml", "utf8");
  assert.match(source, /^  group: production-database-migrations$/mu);
  assert.match(source, /^  cancel-in-progress: false$/mu);
  assert.match(source, /^    if: false$/mu);
  assert.doesNotMatch(source, /(?:migrate deploy|execute-admitted|DIRECT_URL|PRODUCTION_MIGRATION_DIRECT_URL)/u);
});

test("invocation binds exact main, job attempt and protected credential digest before worker creation", async () => {
  let created = 0;
  const workerFactory = () => { created++; throw new Error("worker must not start"); };
  const drifts = [
    { env: { ...env, GITHUB_REF: "refs/heads/feature" } },
    { env: { ...env, GITHUB_SHA: "c".repeat(40) } },
    { env: { ...env, GITHUB_RUN_ATTEMPT: "1" } },
    { env: { ...env, GITHUB_JOB: "migrate" } },
    { admission: { ...admission, jobId: "0" } },
    { ownerUrlSha256: "0".repeat(64) },
  ];
  for (const drift of drifts) await assert.rejects(observeOrderZeroDirectProductionInvocation({
    ...input, ...drift, workerFactory,
  }), /unavailable; no execution admission/u);
  assert.equal(created, 0);
});

test("read-only worker lifecycle revalidates the same scope and returns only bounded fields", async () => {
  const calls = []; let closed = 0;
  const workerFactory = async () => {
    calls.push("start");
    return { prepare: async () => { calls.push("prepare"); return { productionExecutionAuthorized: false }; },
      load: async () => { calls.push("load"); return { productionExecutionAuthorized: false }; },
      inspect: async payload => { calls.push("inspect"); assert.equal(payload.ownerUrl, ownerUrl);
        return { productionExecutionAuthorized: false, freshDatabaseScopeObserved: true,
          prefixLength: 4, remainingMemberCount: 13, steps }; },
      revalidate: async payload => { calls.push("revalidate"); assert.equal(payload.admission, admission);
        return { productionExecutionAuthorized: false, freshDatabaseScopeObserved: true, prefixLength: 4 }; },
      close: async () => { calls.push("close"); closed++; }, };
  };
  const result = await observeOrderZeroDirectProductionInvocation({ ...input, workerFactory });
  assert.deepEqual(calls, ["start", "prepare", "load", "inspect", "revalidate", "close"]);
  assert.equal(closed, 1);
  assert.equal(result.prefixLength, 4);
  assert.equal(result.remainingMemberCount, 13);
  assert.equal(result.productionExecutionAuthorized, false);
  assert.equal(result.completeProductionScope, false);
  assert.ok(!JSON.stringify(result).includes(ownerUrl));
  assert.ok(!JSON.stringify(result).includes("fixture-token"));
});

test("late scope drift fails closed and always closes the worker", async () => {
  let closed = 0;
  const workerFactory = async () => ({
    prepare: async () => ({ productionExecutionAuthorized: false }),
    load: async () => ({ productionExecutionAuthorized: false }),
    inspect: async () => ({ productionExecutionAuthorized: false,
      freshDatabaseScopeObserved: true, prefixLength: 4, remainingMemberCount: 13, steps }),
    revalidate: async () => ({ productionExecutionAuthorized: false,
      freshDatabaseScopeObserved: true, prefixLength: 5 }),
    close: async () => { closed++; },
  });
  await assert.rejects(observeOrderZeroDirectProductionInvocation({ ...input, workerFactory }),
    /unavailable; no execution admission/u);
  assert.equal(closed, 1);
});

test("runner discovers its numeric job before starting the read-only worker", async () => {
  const calls = [];
  const discoverJobId = async request => {
    calls.push("discover");
    assert.deepEqual(request, { releaseCommit: commit, runId: "123", runAttempt: "2",
      runnerName: "Hosted Runner", githubToken: "fixture-token" });
    return "456";
  };
  const workerFactory = async () => {
    calls.push("start");
    return { prepare: async () => ({ productionExecutionAuthorized: false }),
      load: async () => ({ productionExecutionAuthorized: false }),
      inspect: async payload => {
        assert.equal(payload.admission.jobId, "456");
        return { productionExecutionAuthorized: false, freshDatabaseScopeObserved: true,
          prefixLength: 4, remainingMemberCount: 13, steps };
      },
      revalidate: async () => ({ productionExecutionAuthorized: false,
        freshDatabaseScopeObserved: true, prefixLength: 4 }),
      close: async () => { calls.push("close"); } };
  };
  const args = { ...input, discoverJobId, workerFactory };
  assert.equal((await observeOrderZeroDirectProductionInvocationFromRunner(args)).jobId, "456");
  assert.deepEqual(calls, ["discover", "start", "close"]);
  calls.length = 0;
  await assert.rejects(observeOrderZeroDirectProductionInvocationFromRunner({ ...args,
    env: { ...env, GITHUB_SHA: "c".repeat(40) } }), /unavailable; no execution admission/u);
  assert.deepEqual(calls, []);
  await assert.rejects(observeOrderZeroDirectProductionInvocationFromRunner({ ...args,
    discoverJobId: async () => "not-an-id" }), /unavailable; no execution admission/u);
  assert.deepEqual(calls, []);
});
