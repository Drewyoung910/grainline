import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { attestOrderZeroDirectToolchain } from "../scripts/order-zero-direct-toolchain-attestation.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");

test("attestation proves exact runner bytes without a protected credential", () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "order-attestation-")));
  try {
    const bin = path.join(directory, "bin");
    const npm = path.join(directory, "lib", "node_modules", "npm");
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(path.join(npm, "bin"), { recursive: true });
    const nodePath = path.join(bin, "node");
    const npmCliPath = path.join(npm, "bin", "npm-cli.js");
    fs.writeFileSync(nodePath, "fixture-node");
    fs.writeFileSync(npmCliPath, "fixture-npm");
    fs.writeFileSync(path.join(npm, "package.json"), JSON.stringify({ name: "npm", version: "10.9.8" }));
    const candidates = {
      schema: "grainline-order-toolchain-variable-candidates-v1",
      actualRunnerPlacementVerified: false,
      productionExecutionAuthorized: false,
      variables: {
        ORDER_ZERO_DIRECT_NODE_VERSION: "v22.23.2",
        ORDER_ZERO_DIRECT_NODE_SHA256: digest("fixture-node"),
        ORDER_ZERO_DIRECT_NPM_CLI_SHA256: digest("fixture-npm"),
        ORDER_ZERO_DIRECT_NPM_VERSION: "10.9.8",
      },
    };
    const pins = { runner: { label: "ubuntu-24.04", platform: "linux", architecture: "x64" },
      toolchain: { nodeVersion: "v22.23.2", nodeSha256: digest("fixture-node"),
        npmCliSha256: digest("fixture-npm"), npmVersion: "10.9.8" } };
    const args = {
      env: { GITHUB_SHA: "a".repeat(40), RUNNER_OS: "Linux", RUNNER_ARCH: "X64" },
      execPath: nodePath, nodeVersion: "v22.23.2", platform: "linux", arch: "x64",
      candidates, pins,
    };
    const result = attestOrderZeroDirectToolchain(args);
    assert.equal(result.verified, true);
    assert.equal(result.nodePath, nodePath);
    assert.equal(result.npmCliPath, npmCliPath);
    assert.equal(result.nodeSha256, candidates.variables.ORDER_ZERO_DIRECT_NODE_SHA256);
    for (const bad of [
      { platform: "darwin" },
      { env: { ...args.env, PRODUCTION_MIGRATION_DIRECT_URL: "fixture-owner-url" } },
      { env: { ...args.env, GITHUB_TOKEN: "fixture-token" } },
      { env: { ...args.env, ORDER_NPM_CLI: "/unreviewed/npm-cli.js" } },
      { candidates: { ...candidates, variables: {
        ...candidates.variables, ORDER_ZERO_DIRECT_NODE_SHA256: "0".repeat(64) } } },
      { pins: { ...pins, toolchain: { ...pins.toolchain, npmCliSha256: "0".repeat(64) } } },
    ]) assert.throws(() => attestOrderZeroDirectToolchain({ ...args, ...bad }),
      /attestation unavailable; no execution admission/u);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("attestation job matches the dormant Order runner and has no protected environment", () => {
  const workflow = fs.readFileSync(".github/workflows/order-zero-direct-toolchain-attestation.yml", "utf8");
  const orderWorkflow = fs.readFileSync(".github/workflows/order-zero-direct-production.yml", "utf8");
  const pins = JSON.parse(fs.readFileSync("docs/order-handoff-toolchain-pins.json", "utf8"));
  for (const snippet of [
    "runs-on: ubuntu-24.04",
    `actions/checkout@${pins.actions.checkout.commit}`,
    `actions/setup-node@${pins.actions["setup-node"].commit}`,
    "node-version: '22.23.2'",
    "architecture: x64",
    "check-latest: false",
    "package-manager-cache: false",
    "token: ''",
  ]) assert.ok(workflow.includes(snippet) && orderWorkflow.includes(snippet), snippet);
  assert.match(workflow, /run: node scripts\/order-zero-direct-toolchain-attestation\.mjs/u);
  assert.doesNotMatch(workflow, /environment:|secrets\.|vars\.|PRODUCTION_MIGRATION_DIRECT_URL/u);
});
