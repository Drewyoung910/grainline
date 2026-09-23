// Read-only adapter for the protected Order inspection job. No mutation command
// is exposed; the worker can only prepare, load, inspect and revalidate.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { observeOrderZeroDirectProductionInvocationFromRunner } from "./order-zero-direct-production-invocation.mjs";
import { npmCliFromNodeExecPath } from "./order-zero-direct-toolchain-preflight.mjs";

const FAILURE = "Order read-only runner unavailable; no execution admission";
const SHA256 = /^[a-f0-9]{64}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const ID = /^[1-9][0-9]{0,15}$/u;

export function parseOrderZeroDirectRunnerInputs(env, directory, execPath = process.execPath,
  expectedConfirmation = "inspect-reviewed-order-zero-direct-from-main") {
  try {
    assert.ok(env && path.isAbsolute(directory) && path.resolve(directory) === directory);
    assert.ok(!("ORDER_NPM_CLI" in env));
    assert.ok(["inspect-reviewed-order-zero-direct-from-main",
      "apply-reviewed-order-zero-direct-prefix-from-main"].includes(expectedConfirmation));
    assert.equal(env.ORDER_CONFIRMATION, expectedConfirmation);
    assert.match(env.ORDER_RELEASE_COMMIT, SHA);
    assert.equal(env.ORDER_RELEASE_COMMIT, env.GITHUB_SHA);
    for (const key of ["ORDER_SOURCE_CATALOG_SHA256", "ORDER_SOURCE_FENCE_SHA256",
      "ORDER_NODE_SHA256", "ORDER_NPM_CLI_SHA256", "PRODUCTION_MIGRATION_DIRECT_URL_SHA256"]) {
      assert.match(env[key], SHA256);
    }
    for (const key of ["ORDER_MAIN_CI_RUN_ID", "ORDER_MAIN_CI_RUN_ATTEMPT"]) {
      assert.match(env[key], ID);
      assert.ok(Number.isSafeInteger(Number(env[key])));
    }
    assert.match(env.ORDER_NODE_VERSION, /^v22\.\d+\.\d+$/u);
    assert.match(env.ORDER_NPM_VERSION, /^\d+\.\d+\.\d+$/u);
    const npmCli = npmCliFromNodeExecPath(execPath);
    assert.ok(typeof env.GITHUB_TOKEN === "string" && env.GITHUB_TOKEN.length > 0);
    assert.ok(typeof env.PRODUCTION_MIGRATION_DIRECT_URL === "string"
      && env.PRODUCTION_MIGRATION_DIRECT_URL.length > 0);
    return {
      env, directory,
      reviewed: { releaseCommit: env.ORDER_RELEASE_COMMIT,
        sourceCatalogSha256: env.ORDER_SOURCE_CATALOG_SHA256,
        sourceFenceSha256: env.ORDER_SOURCE_FENCE_SHA256,
        nodeSha256: env.ORDER_NODE_SHA256, nodeVersion: env.ORDER_NODE_VERSION,
        npmCli, npmCliSha256: env.ORDER_NPM_CLI_SHA256,
        npmVersion: env.ORDER_NPM_VERSION },
      ci: { ciRunId: env.ORDER_MAIN_CI_RUN_ID, ciRunAttempt: env.ORDER_MAIN_CI_RUN_ATTEMPT },
      githubToken: env.GITHUB_TOKEN, ownerUrl: env.PRODUCTION_MIGRATION_DIRECT_URL,
      ownerUrlSha256: env.PRODUCTION_MIGRATION_DIRECT_URL_SHA256,
    };
  } catch { throw new Error(FAILURE); }
}

export async function runOrderZeroDirectReadOnlyRunner({ env, directory,
  observe = observeOrderZeroDirectProductionInvocationFromRunner,
  emitDiagnostic = value => process.stderr.write(value) }) {
  // A fixed stage label helps diagnose a fail-closed production refusal without
  // logging credentials, URLs, GitHub responses, or worker errors.
  const stages = new Set(["inputs", "github-context", "owner-digest", "job-discovery",
    "worker-start", "worker-prepare", "worker-load", "scope-inspect",
    "scope-revalidate", "result"]);
  let stage = "inputs";
  const reportStage = value => { if (stages.has(value)) stage = value; };
  try {
    const input = parseOrderZeroDirectRunnerInputs(env, directory);
    reportStage("github-context");
    const result = await observe({ ...input, reportStage });
    reportStage("result");
    assert.ok(result && result.productionExecutionAuthorized === false
      && result.completeProductionScope === false
      && result.freshDatabaseScopeObserved === true
      && Number.isInteger(result.prefixLength) && result.prefixLength >= 0
      && result.prefixLength <= 17 && result.remainingMemberCount === 17 - result.prefixLength);
    assert.equal(result.releaseCommit, input.reviewed.releaseCommit);
    assert.equal(result.runId, env.GITHUB_RUN_ID);
    assert.equal(result.runAttempt, env.GITHUB_RUN_ATTEMPT);
    assert.match(result.jobId, ID);
    assert.ok(Number.isSafeInteger(Number(result.jobId)));
    assert.equal(result.ciRunId, input.ci.ciRunId);
    assert.equal(result.ciRunAttempt, input.ci.ciRunAttempt);
    return Object.freeze({ releaseCommit: result.releaseCommit, runId: result.runId,
      runAttempt: result.runAttempt, jobId: result.jobId,
      ciRunId: result.ciRunId, ciRunAttempt: result.ciRunAttempt,
      prefixLength: result.prefixLength, remainingMemberCount: result.remainingMemberCount,
      freshDatabaseScopeObserved: true, completeProductionScope: false,
      productionExecutionAuthorized: false });
  } catch {
    if (env?.GITHUB_ACTIONS === "true") emitDiagnostic(`Order read-only stop stage: ${stage}\n`);
    throw new Error(FAILURE);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runOrderZeroDirectReadOnlyRunner({ env: process.env, directory: process.cwd() });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(`${FAILURE}\n`);
    process.exitCode = 1;
  }
}
