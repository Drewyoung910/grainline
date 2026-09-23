import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  parseOrderZeroDirectRunnerInputs,
  runOrderZeroDirectReadOnlyRunner,
} from "../scripts/order-zero-direct-production-runner.mjs";

const releaseCommit = "a".repeat(40);
const ownerUrl = "postgresql://fixture.invalid/never-connect";
const env = { GITHUB_SHA: releaseCommit, ORDER_RELEASE_COMMIT: releaseCommit,
  ORDER_CONFIRMATION: "inspect-reviewed-order-zero-direct-from-main",
  GITHUB_RUN_ID: "456", GITHUB_RUN_ATTEMPT: "2",
  ORDER_SOURCE_CATALOG_SHA256: "b".repeat(64), ORDER_SOURCE_FENCE_SHA256: "c".repeat(64),
  ORDER_NODE_SHA256: "d".repeat(64), ORDER_NPM_CLI_SHA256: "e".repeat(64),
  ORDER_NODE_VERSION: "v22.16.0", ORDER_NPM_VERSION: "10.9.2",
  ORDER_NPM_CLI: "/fixture/npm-cli.js", ORDER_MAIN_CI_RUN_ID: "123",
  ORDER_MAIN_CI_RUN_ATTEMPT: "1", GITHUB_TOKEN: "fixture-private-token",
  PRODUCTION_MIGRATION_DIRECT_URL: ownerUrl,
  PRODUCTION_MIGRATION_DIRECT_URL_SHA256: createHash("sha256").update(ownerUrl).digest("hex") };
const directory = "/fixture/clean-checkout";

test("production workflow wires the read-only runner behind an unreachable job", () => {
  const workflow = fs.readFileSync(".github/workflows/order-zero-direct-production.yml", "utf8");
  assert.match(workflow, /^    if: false$/mu);
  assert.match(workflow, /node scripts\/order-zero-direct-production-runner\.mjs/u);
  assert.match(workflow, /PRODUCTION_MIGRATION_DIRECT_URL: \$\{\{ secrets\.PRODUCTION_MIGRATION_DIRECT_URL \}\}/u);
  assert.doesNotMatch(workflow, /(?:migrate deploy|execute-admitted|order-zero-direct-execution-admitted)/u);
});

test("read-only runner maps only explicit reviewed source, toolchain, CI and owner inputs", () => {
  const parsed = parseOrderZeroDirectRunnerInputs(env, directory);
  assert.deepEqual(Object.keys(parsed.reviewed).sort(), ["nodeSha256", "nodeVersion",
    "npmCli", "npmCliSha256", "npmVersion", "releaseCommit", "sourceCatalogSha256",
    "sourceFenceSha256"]);
  assert.equal(parsed.reviewed.releaseCommit, releaseCommit);
  assert.equal(parsed.ci.ciRunId, "123");
  assert.equal(parsed.ownerUrl, ownerUrl);
  assert.equal(parsed.githubToken, "fixture-private-token");
});

test("missing or drifted reviewed inputs fail before the observer", async () => {
  let called = 0;
  const observe = () => { called++; throw new Error("should not run"); };
  for (const bad of [
    { ORDER_CONFIRMATION: "wrong" },
    { ORDER_RELEASE_COMMIT: "f".repeat(40) },
    { ORDER_SOURCE_CATALOG_SHA256: "wrong" },
    { ORDER_MAIN_CI_RUN_ID: "0" },
    { ORDER_NPM_CLI: "relative/npm-cli.js" },
    { GITHUB_TOKEN: "" },
    { PRODUCTION_MIGRATION_DIRECT_URL: "" },
  ]) await assert.rejects(runOrderZeroDirectReadOnlyRunner({ env: { ...env, ...bad },
    directory, observe }), /unavailable; no execution admission/u);
  assert.equal(called, 0);
});

test("read-only runner emits a bounded result and suppresses observer values and errors", async () => {
  const observe = async parsed => {
    assert.equal(parsed.ownerUrl, ownerUrl);
    return { releaseCommit, runId: "456", runAttempt: "2", jobId: "789",
      ciRunId: "123", ciRunAttempt: "1", prefixLength: 4, remainingMemberCount: 13,
      freshDatabaseScopeObserved: true, completeProductionScope: false,
      productionExecutionAuthorized: false, secret: "never-return-this" };
  };
  const result = await runOrderZeroDirectReadOnlyRunner({ env, directory, observe });
  assert.equal(result.prefixLength, 4);
  assert.equal(result.productionExecutionAuthorized, false);
  assert.ok(!JSON.stringify(result).includes("never-return-this"));
  assert.ok(!JSON.stringify(result).includes(ownerUrl));
  assert.ok(!JSON.stringify(result).includes(env.GITHUB_TOKEN));
  await assert.rejects(runOrderZeroDirectReadOnlyRunner({ env, directory,
    observe: async () => { throw new Error(`provider body ${ownerUrl}`); } }),
  error => error.message === "Order read-only runner unavailable; no execution admission");
  await assert.rejects(runOrderZeroDirectReadOnlyRunner({ env, directory,
    observe: async () => ({ ...result, productionExecutionAuthorized: true }) }),
  /unavailable; no execution admission/u);
});
