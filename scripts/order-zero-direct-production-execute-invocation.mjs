// Separate production mutation composition. Only the exact reviewed execution
// workflow/job can construct this worker mode; the read-only workflow retains
// its original inspect-only worker and cannot call executePrefix.
import assert from "node:assert/strict";
import { startOrderZeroDirectWorker } from "./order-zero-direct-release-worker.mjs";
import { discoverOrderReleaseJobId } from "./order-zero-direct-release-admission.mjs";
import { assertOrderProductionInvocationContext } from "./order-zero-direct-production-invocation.mjs";

const FAILURE = "Order production prefix invocation unavailable; preserve release records";
const numeric = value => typeof value === "string" && /^[1-9][0-9]{0,15}$/u.test(value)
  && Number.isSafeInteger(Number(value));

export async function executeOrderZeroDirectProductionInvocationFromRunner({ env, directory,
  reviewed, ci, githubToken, ownerUrl, ownerUrlSha256,
  workerFactory = startOrderZeroDirectWorker,
  discoverJobId = discoverOrderReleaseJobId, reportStage = () => {} }) {
  let worker;
  try {
    assert.ok(env && numeric(env.GITHUB_RUN_ID) && numeric(env.GITHUB_RUN_ATTEMPT));
    assert.ok(typeof env.RUNNER_NAME === "string" && env.RUNNER_NAME.length > 0);
    assert.ok(typeof githubToken === "string" && githubToken.length > 0);
    const provisional = { runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, jobId: "1" };
    const context = assertOrderProductionInvocationContext({ env, reviewed, admission: provisional,
      ci, ownerUrl, ownerUrlSha256, reportStage, mode: "execute" });
    reportStage("job-discovery");
    const jobId = await discoverJobId({ releaseCommit: reviewed.releaseCommit,
      runId: provisional.runId, runAttempt: provisional.runAttempt,
      runnerName: env.RUNNER_NAME, githubToken, mode: "execute" });
    assert.ok(numeric(jobId));
    const admission = { ...provisional, jobId };
    assertOrderProductionInvocationContext({ env, reviewed, admission,
      ci, ownerUrl, ownerUrlSha256, reportStage, mode: "execute" });
    reportStage("worker-start");
    worker = await workerFactory({ directory, reviewed, mode: "execute" });
    reportStage("worker-prepare");
    const prepared = await worker.prepare();
    assert.equal(prepared.productionExecutionAuthorized, false);
    reportStage("worker-load");
    const loaded = await worker.load({ ci, githubToken });
    assert.equal(loaded.productionExecutionAuthorized, false);
    reportStage("prefix-execute");
    const result = await worker.executePrefix({ admission, ci, githubToken, ownerUrl, ownerUrlSha256 });
    assert.equal(result.productionExecutionAuthorized, false);
    assert.ok(result.execution && result.execution.status === "passed");
    const execution = result.execution;
    assert.ok(Number.isInteger(execution.initialPrefix) && execution.initialPrefix >= 0
      && execution.initialPrefix <= 17 && execution.finalPrefix === 17
      && execution.appliedMemberCount === 17 - execution.initialPrefix);
    for (const key of ["migrationStatusVerified", "globalAuthorityVerified", "finalReadOnlyScopeVerified"]) {
      assert.equal(execution[key], true);
    }
    return Object.freeze({ ...context, jobId, initialPrefix: execution.initialPrefix,
      finalPrefix: 17, appliedMemberCount: execution.appliedMemberCount,
      migrationStatusVerified: true, globalAuthorityVerified: true,
      finalReadOnlyScopeVerified: true, completeProductionScope: false,
      productionExecutionAuthorized: false });
  } catch { throw new Error(FAILURE); }
  finally {
    try { await worker?.close(); }
    catch { throw new Error(FAILURE); }
  }
}
