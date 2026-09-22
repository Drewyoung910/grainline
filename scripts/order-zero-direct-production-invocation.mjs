// Read-only composition for a future, separately reviewed Order workflow.
// There is no CLI or workflow caller. In particular, this module cannot reach
// the worker's private admitted executor or issue a migration command.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startOrderZeroDirectWorker } from "./order-zero-direct-release-worker.mjs";

const REPOSITORY = "Drewyoung910/grainline";
const WORKFLOW = ".github/workflows/order-zero-direct-production.yml";
const WORKFLOW_REF = `${REPOSITORY}/${WORKFLOW}@refs/heads/main`;
const JOB = "inspect_order_zero_direct";
const FINAL_STEPS = Object.freeze([
  "reinspect-exact-complete-prefix", "converge-reviewed-runtime-grants",
  "migration-status", "global-grant-and-RLS-audit", "final-read-only-prefix-scope",
]);

function numeric(value) {
  return typeof value === "string" && /^[1-9][0-9]{0,15}$/u.test(value)
    && Number.isSafeInteger(Number(value));
}

export function assertOrderProductionInvocationContext({ env, reviewed, admission, ci,
  ownerUrl, ownerUrlSha256 }) {
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
  assert.equal(env.GITHUB_WORKFLOW_REF, WORKFLOW_REF);
  assert.equal(env.GITHUB_JOB, JOB);
  assert.equal(env.GITHUB_RUN_ID, admission.runId);
  assert.equal(env.GITHUB_RUN_ATTEMPT, admission.runAttempt);
  assert.equal(typeof ownerUrl, "string");
  assert.match(ownerUrlSha256, /^[a-f0-9]{64}$/u);
  assert.equal(createHash("sha256").update(ownerUrl, "utf8").digest("hex"), ownerUrlSha256);
  return Object.freeze({ workflow: WORKFLOW, releaseCommit: reviewed.releaseCommit,
    runId: admission.runId, runAttempt: admission.runAttempt, jobId: admission.jobId,
    ciRunId: ci.ciRunId, ciRunAttempt: ci.ciRunAttempt,
    completeProductionScope: false, productionExecutionAuthorized: false });
}

export async function observeOrderZeroDirectProductionInvocation({ env, directory, reviewed,
  admission, ci, githubToken, ownerUrl, ownerUrlSha256,
  workerFactory = startOrderZeroDirectWorker }) {
  let worker;
  try {
    const context = assertOrderProductionInvocationContext({ env, reviewed, admission, ci,
      ownerUrl, ownerUrlSha256 });
    assert.ok(typeof githubToken === "string" && githubToken.length > 0);
    worker = await workerFactory({ directory, reviewed });
    const prepared = await worker.prepare();
    assert.equal(prepared.productionExecutionAuthorized, false);
    const loaded = await worker.load({ ci, githubToken });
    assert.equal(loaded.productionExecutionAuthorized, false);
    const payload = { admission, ci, githubToken, ownerUrl, ownerUrlSha256 };
    const inspected = await worker.inspect(payload);
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
