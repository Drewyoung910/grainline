import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { runOrderZeroDirectProductionExecuteRunner } from "../scripts/order-zero-direct-production-execute-runner.mjs";

const commit = "a".repeat(40), ownerUrl = "postgresql://fixture.invalid/never-connect";
const env = { GITHUB_ACTIONS: "true", GITHUB_SHA: commit, GITHUB_RUN_ID: "123",
  GITHUB_RUN_ATTEMPT: "2", ORDER_RELEASE_COMMIT: commit,
  ORDER_CONFIRMATION: "apply-reviewed-order-zero-direct-prefix-from-main",
  ORDER_SOURCE_CATALOG_SHA256: "b".repeat(64), ORDER_SOURCE_FENCE_SHA256: "c".repeat(64),
  ORDER_NODE_SHA256: "d".repeat(64), ORDER_NPM_CLI_SHA256: "e".repeat(64),
  ORDER_NODE_VERSION: "v22.23.2", ORDER_NPM_VERSION: "10.9.2",
  ORDER_MAIN_CI_RUN_ID: "789", ORDER_MAIN_CI_RUN_ATTEMPT: "1",
  GITHUB_TOKEN: "fixture-private-token", PRODUCTION_MIGRATION_DIRECT_URL: ownerUrl,
  PRODUCTION_MIGRATION_DIRECT_URL_SHA256: createHash("sha256").update(ownerUrl).digest("hex") };

test("execute runner rejects read-only confirmation before constructing an invocation", async () => {
  let called = 0;
  await assert.rejects(runOrderZeroDirectProductionExecuteRunner({
    env: { ...env, ORDER_CONFIRMATION: "inspect-reviewed-order-zero-direct-from-main" },
    directory: "/fixture/checkout", execute: async () => { called++; }, emitDiagnostic: () => {},
  }), /unavailable; preserve release records/u);
  assert.equal(called, 0);
});

test("execute runner emits only bounded completion fields and sanitizes failures", async () => {
  const result = await runOrderZeroDirectProductionExecuteRunner({ env,
    directory: "/fixture/checkout", execute: async parsed => {
      assert.equal(parsed.ownerUrl, ownerUrl);
      return { releaseCommit: commit, runId: "123", runAttempt: "2", jobId: "456",
        ciRunId: "789", ciRunAttempt: "1", initialPrefix: 0, finalPrefix: 17,
        appliedMemberCount: 17, migrationStatusVerified: true,
        globalAuthorityVerified: true, finalReadOnlyScopeVerified: true,
        completeProductionScope: false, productionExecutionAuthorized: false,
        secret: "never-return-this" };
    } });
  assert.equal(result.appliedMemberCount, 17);
  assert.ok(!JSON.stringify(result).includes("never-return-this"));
  assert.ok(!JSON.stringify(result).includes(ownerUrl));
  const diagnostic = [];
  await assert.rejects(runOrderZeroDirectProductionExecuteRunner({ env,
    directory: "/fixture/checkout", emitDiagnostic: value => diagnostic.push(value),
    execute: async ({ reportStage }) => { reportStage("prefix-execute");
      throw new Error(`provider body ${ownerUrl}`); },
  }), error => error.message === "Order prefix runner unavailable; preserve release records");
  assert.deepEqual(diagnostic, ["Order prefix stop stage: prefix-execute\n"]);
});
