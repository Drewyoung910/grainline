import assert from "node:assert/strict";
import test from "node:test";
import { observeOrderReleaseAdmission } from "../scripts/order-zero-direct-release-admission.mjs";

function fixture(t) {
  const releaseCommit = "a".repeat(40), admission = { runId: "123", runAttempt: "2", jobId: "456" };
  const run = { id: 123, run_attempt: 2, repository: { full_name: "Drewyoung910/grainline" },
    head_repository: { full_name: "Drewyoung910/grainline" }, head_sha: releaseCommit, head_branch: "main",
    event: "workflow_dispatch", path: ".github/workflows/production-migrations.yml", status: "in_progress", conclusion: null };
  const job = { id: 456, run_id: 123, run_attempt: 2, head_sha: releaseCommit, status: "in_progress", conclusion: null,
    name: "Guarded production migration", runner_id: 789 };
  let replies = [run, job, run, job]; const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => { calls.push({ url, options }); const value = replies.shift(); return value instanceof Response ? value : Response.json(value); });
  return { run, job, calls, set: values => { replies = values; },
    observe: () => observeOrderReleaseAdmission({ releaseCommit, admission, githubToken: "fixture-token" }) };
}

test("global migration admission observes actual running exact workflow and job twice", async t => {
  const f = fixture(t), result = await f.observe();
  assert.equal(result.group, "production-database-migrations"); assert.equal(result.cancelInProgress, false);
  assert.equal(result.productionExecutionAuthorized, false); assert.equal(f.calls.length, 4);
  for (const call of f.calls) { assert.equal(call.options.method, "GET"); assert.equal(call.options.redirect, "error"); }
});

test("wrong run identity, branch, event, workflow and inactive admissions fail", async t => {
  const f = fixture(t);
  for (const [key, value] of Object.entries({ id: 999, run_attempt: 3, head_sha: "b".repeat(40), head_branch: "branch", event: "push",
    path: ".github/workflows/ci.yml", status: "queued", conclusion: "cancelled", repository: { full_name: "other/repo" } })) {
    f.set([{ ...f.run, [key]: value }]); await assert.rejects(f.observe(), /admission lost/u);
  }
});

test("job from another attempt, worker, run or completed job cannot admit", async t => {
  const f = fixture(t);
  for (const [key, value] of Object.entries({ id: 999, run_id: 999, run_attempt: 3, head_sha: "b".repeat(40), runner_id: 0,
    name: "Other job", status: "completed", conclusion: "success" })) {
    f.set([f.run, { ...f.job, [key]: value }]); await assert.rejects(f.observe());
  }
});

test("lost admission between repeated observations and transport failures invalidate admission", async t => {
  const f = fixture(t);
  f.set([f.run, f.job, { ...f.run, status: "completed", conclusion: "cancelled" }]); await assert.rejects(f.observe());
  f.set([new Response("fixture-private-error", { status: 403 })]);
  await assert.rejects(f.observe(), error => !error.message.includes("fixture-private-error"));
});
