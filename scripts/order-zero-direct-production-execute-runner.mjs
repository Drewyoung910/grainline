// Protected production adapter for the fixed compatible prefix. No CLI SQL,
// migration name, table or arbitrary command input is accepted.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseOrderZeroDirectRunnerInputs } from "./order-zero-direct-production-runner.mjs";
import { executeOrderZeroDirectProductionInvocationFromRunner } from "./order-zero-direct-production-execute-invocation.mjs";

const FAILURE = "Order prefix runner unavailable; preserve release records";

export async function runOrderZeroDirectProductionExecuteRunner({ env, directory,
  execute = executeOrderZeroDirectProductionInvocationFromRunner,
  emitDiagnostic = value => process.stderr.write(value) }) {
  const stages = new Set(["inputs", "owner-digest", "job-discovery", "worker-start",
    "worker-prepare", "worker-load", "prefix-execute", "result"]);
  let stage = "inputs";
  const reportStage = value => { if (stages.has(value)) stage = value; };
  try {
    const input = parseOrderZeroDirectRunnerInputs(env, directory, process.execPath,
      "apply-reviewed-order-zero-direct-prefix-from-main");
    const result = await execute({ ...input, reportStage });
    reportStage("result");
    assert.equal(result.releaseCommit, input.reviewed.releaseCommit);
    assert.equal(result.runId, env.GITHUB_RUN_ID);
    assert.equal(result.runAttempt, env.GITHUB_RUN_ATTEMPT);
    assert.equal(result.ciRunId, input.ci.ciRunId);
    assert.equal(result.ciRunAttempt, input.ci.ciRunAttempt);
    assert.match(result.jobId, /^[1-9][0-9]{0,15}$/u);
    assert.ok(Number.isInteger(result.initialPrefix) && result.initialPrefix >= 0
      && result.initialPrefix <= 17 && result.finalPrefix === 17
      && result.appliedMemberCount === 17 - result.initialPrefix);
    for (const key of ["migrationStatusVerified", "globalAuthorityVerified", "finalReadOnlyScopeVerified"]) {
      assert.equal(result[key], true);
    }
    assert.equal(result.completeProductionScope, false);
    assert.equal(result.productionExecutionAuthorized, false);
    return Object.freeze({ releaseCommit: result.releaseCommit,
      runId: result.runId, runAttempt: result.runAttempt, jobId: result.jobId,
      ciRunId: result.ciRunId, ciRunAttempt: result.ciRunAttempt,
      initialPrefix: result.initialPrefix, finalPrefix: 17,
      appliedMemberCount: result.appliedMemberCount,
      migrationStatusVerified: true, globalAuthorityVerified: true,
      finalReadOnlyScopeVerified: true, completeProductionScope: false,
      productionExecutionAuthorized: false });
  } catch {
    if (env?.GITHUB_ACTIONS === "true") emitDiagnostic(`Order prefix stop stage: ${stage}\n`);
    throw new Error(FAILURE);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runOrderZeroDirectProductionExecuteRunner({ env: process.env,
      directory: process.cwd() });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(`${FAILURE}\n`);
    process.exitCode = 1;
  }
}
