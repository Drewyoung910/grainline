import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertOrderCorePostflightGitState,
  parseOrderCorePostflightConfig,
  writeOrderCorePostflightEvidence,
} from "../scripts/order-core-rls-production-postflight.mjs";

const commit = "a".repeat(40);
const databaseUrl = "postgresql://grainline_app_runtime:synthetic@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const evidencePath = path.join(tmpdir(), `order-core-rls-enable-postflight-${commit}.json`);
const env = Object.freeze({
  ORDER_CORE_RLS_POSTFLIGHT_CONFIRM: "verify-production-order-core-rls-runtime-read-only",
  ORDER_CORE_RLS_POSTFLIGHT_PHASE: "enable",
  ORDER_CORE_RLS_POSTFLIGHT_RELEASE_COMMIT: commit,
  ORDER_CORE_RLS_POSTFLIGHT_EVIDENCE_PATH: evidencePath,
  ORDER_CORE_RLS_POSTFLIGHT_MAIN_CI_RUN_ID: "123",
  ORDER_CORE_RLS_POSTFLIGHT_MIGRATION_RUN_ID: "456",
  DATABASE_URL: databaseUrl,
});

test("Core postflight accepts only a bound pooled runtime release", () => {
  const config = parseOrderCorePostflightConfig(env);
  assert.equal(config.phase, "enable");
  assert.equal(config.runtimeIdentity.runtimeRole, "grainline_app_runtime");
  assert.equal(config.runtimeIdentity.endpointId, "ep-plain-river-aaqg8gj4");
  assert.equal(config.mainCiRunId, 123);
  assert.deepEqual(assertOrderCorePostflightGitState({ head: commit, status: "" }, commit), {
    head: commit, clean: true,
  });
  assert.throws(() => assertOrderCorePostflightGitState({ head: commit, status: " M file" }, commit), /exact clean/);
  assert.throws(() => parseOrderCorePostflightConfig({ ...env, DIRECT_URL: databaseUrl }), /privileged database keys/);
  assert.throws(() => parseOrderCorePostflightConfig({ ...env, ORDER_CORE_RLS_POSTFLIGHT_PHASE: "other" }), /phase/);
  assert.throws(() => parseOrderCorePostflightConfig({ ...env, DATABASE_URL: databaseUrl.replace("-pooler", "") }), /pooled/);
});

test("Core postflight evidence is exclusive, private, and contains no credentials", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "order-core-postflight-test-"));
  const file = path.join(dir, "result.json");
  const evidence = { status: "passed", productionChangedByPostflight: false };
  writeOrderCorePostflightEvidence(file, evidence);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), evidence);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.throws(() => writeOrderCorePostflightEvidence(file, evidence), /EEXIST/);
  assert.throws(() => writeOrderCorePostflightEvidence(path.join(dir, "bad.json"), { databaseUrl }), /forbidden data/);
});
