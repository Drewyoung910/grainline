// Read-only composition for the protected Order workflow. This module cannot
// reach the worker's private admitted executor or issue a migration command.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startOrderZeroDirectWorker } from "./order-zero-direct-release-worker.mjs";
import { discoverOrderReleaseJobId } from "./order-zero-direct-release-admission.mjs";

const REPOSITORY = "Drewyoung910/grainline";
const WORKFLOW = ".github/workflows/order-zero-direct-production.yml";
const WORKFLOW_REF = `${REPOSITORY}/${WORKFLOW}@refs/heads/main`;
const JOB = "inspect_order_zero_direct";
const EXECUTE_WORKFLOW_REF = `${REPOSITORY}/.github/workflows/order-zero-direct-execute.yml@refs/heads/main`;
const EXECUTE_JOB = "execute_order_zero_direct";
const FINAL_STEPS = Object.freeze([
  "reinspect-exact-complete-prefix", "converge-reviewed-runtime-grants",
  "migration-status", "global-grant-and-RLS-audit", "final-read-only-prefix-scope",
]);

function numeric(value) {
  return typeof value === "string" && /^[1-9][0-9]{0,15}$/u.test(value)
    && Number.isSafeInteger(Number(value));
}

export function assertOrderProductionInvocationContext({ env, reviewed, admission, ci,
  ownerUrl, ownerUrlSha256, reportStage = () => {}, mode = "inspect" }) {
  assert.ok(env && reviewed && admission && ci);
  assert.deepEqual(Object.keys(admission).sort(), ["jobId", "runAttempt", "runId"]);
  assert.deepEqual(Object.keys(ci).sort(), ["ciRunAttempt", "ciRunId"]);
  assert.match(reviewed.releaseCommit, /^[a-f0-9]{40}$/u);
  assert.match(reviewed.sourceCatalogSha256, /^[a-f0-9]{64}$/u);
  assert.ok(Object.values(admission).every(numeric) && Object.values(ci).every(numeric));
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(env.GITHUB_REPOSITORY, REPOSITORY);
  assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.equal(env.GITHUB_SHA, reviewed.releaseCommit);
  assert.ok(mode === "inspect" || mode === "execute");
  assert.equal(env.GITHUB_WORKFLOW_REF, mode === "inspect" ? WORKFLOW_REF : EXECUTE_WORKFLOW_REF);
  assert.equal(env.GITHUB_JOB, mode === "inspect" ? JOB : EXECUTE_JOB);
  assert.equal(env.GITHUB_RUN_ID, admission.runId);
  assert.equal(env.GITHUB_RUN_ATTEMPT, admission.runAttempt);
  reportStage("owner-digest");
  assert.equal(typeof ownerUrl, "string");
  assert.match(ownerUrlSha256, /^[a-f0-9]{64}$/u);
  assert.equal(createHash("sha256").update(ownerUrl, "utf8").digest("hex"), ownerUrlSha256);
  return Object.freeze({ workflow: mode === "inspect" ? WORKFLOW : ".github/workflows/order-zero-direct-execute.yml",
    releaseCommit: reviewed.releaseCommit,
    runId: admission.runId, runAttempt: admission.runAttempt, jobId: admission.jobId,
    ciRunId: ci.ciRunId, ciRunAttempt: ci.ciRunAttempt,
    completeProductionScope: false, productionExecutionAuthorized: false });
}

export async function observeOrderZeroDirectProductionInvocation({ env, directory, reviewed,
  admission, ci, githubToken, ownerUrl, ownerUrlSha256,
  workerFactory = startOrderZeroDirectWorker, reportStage = () => {} }) {
  let worker;
  try {
    const context = assertOrderProductionInvocationContext({ env, reviewed, admission, ci,
      ownerUrl, ownerUrlSha256, reportStage });
    assert.ok(typeof githubToken === "string" && githubToken.length > 0);
    reportStage("worker-start");
    worker = await workerFactory({ directory, reviewed });
    reportStage("worker-prepare");
    const prepared = await worker.prepare();
    assert.equal(prepared.productionExecutionAuthorized, false);
    reportStage("worker-load");
    const loaded = await worker.load({ ci, githubToken });
    assert.equal(loaded.productionExecutionAuthorized, false);
    const payload = { admission, ci, githubToken, ownerUrl, ownerUrlSha256 };
    reportStage("scope-inspect");
    const inspected = await worker.inspect(payload);
    reportStage("scope-revalidate");
    const revalidated = await worker.revalidate(payload);
    assert.equal(inspected.productionExecutionAuthorized, false);
    assert.equal(revalidated.productionExecutionAuthorized, false);
    assert.equal(inspected.freshDatabaseScopeObserved, true);
    assert.equal(revalidated.freshDatabaseScopeObserved, true);
    assert.ok(Number.isInteger(inspected.prefixLength) && inspected.prefixLength >= 0 && inspected.prefixLength <= 17);
    assert.equal(revalidated.prefixLength, inspected.prefixLength);
    assert.equal(inspected.remainingMemberCount, 17 - inspected.prefixLength);
    assert.deepEqual(inspected.steps, [
      ...(inspected.prefixLength < 17 ? ["apply-only-remaining-prefix"] : []), ...FINAL_STEPS,
    ]);
    return Object.freeze({ ...context, prefixLength: inspected.prefixLength,
      remainingMemberCount: inspected.remainingMemberCount, steps: Object.freeze([...inspected.steps]),
      freshDatabaseScopeObserved: true });
  } catch {
    // Never relay credentials, URLs, raw provider responses or worker errors.
    throw new Error("Order production invocation unavailable; no execution admission");
  } finally {
    try { await worker?.close(); }
    catch { throw new Error("Order production invocation unavailable; no execution admission"); }
  }
}

// Workflow adapter. The numeric job ID is observed from GitHub after
// this run attempt has started, never guessed or accepted as a dispatch input.
// The job and current run are checked again inside the worker's read-only
// admission observer before any database connection can be opened.
export async function observeOrderZeroDirectProductionInvocationFromRunner({ env, directory,
  reviewed, ci, githubToken, ownerUrl, ownerUrlSha256,
  workerFactory = startOrderZeroDirectWorker,
  discoverJobId = discoverOrderReleaseJobId, reportStage = () => {} }) {
  try {
    assert.ok(env && numeric(env.GITHUB_RUN_ID) && numeric(env.GITHUB_RUN_ATTEMPT));
    assert.ok(typeof env.RUNNER_NAME === "string" && env.RUNNER_NAME.length > 0);
    assert.ok(typeof githubToken === "string" && githubToken.length > 0);
    // Cheap context/digest checks precede the GitHub lookup and worker start.
    const provisional = { runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
      jobId: "1" };
    assertOrderProductionInvocationContext({ env, reviewed, admission: provisional,
      ci, ownerUrl, ownerUrlSha256, reportStage });
    reportStage("job-discovery");
    const jobId = await discoverJobId({ releaseCommit: reviewed.releaseCommit,
      runId: provisional.runId, runAttempt: provisional.runAttempt,
      runnerName: env.RUNNER_NAME, githubToken });
    assert.ok(numeric(jobId));
    return await observeOrderZeroDirectProductionInvocation({ env, directory, reviewed,
      admission: { ...provisional, jobId }, ci, githubToken, ownerUrl, ownerUrlSha256,
      workerFactory, reportStage });
  } catch { throw new Error("Order production invocation unavailable; no execution admission"); }
}
