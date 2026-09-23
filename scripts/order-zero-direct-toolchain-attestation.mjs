// Credential-free hosted-runner evidence for the dormant Order inspection job.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  npmCliFromNodeExecPath,
  preflightOrderZeroDirectToolchain,
} from "./order-zero-direct-toolchain-preflight.mjs";

const FAILURE = "Order toolchain attestation unavailable; no execution admission";

export function attestOrderZeroDirectToolchain({
  env = process.env,
  execPath = process.execPath,
  nodeVersion = process.version,
  platform = process.platform,
  arch = process.arch,
  candidates = JSON.parse(fs.readFileSync(
    new URL("../docs/order-toolchain-variable-candidates-20260923.json", import.meta.url),
    "utf8",
  )),
} = {}) {
  try {
    assert.equal(platform, "linux");
    assert.equal(arch, "x64");
    assert.equal(env.RUNNER_OS, "Linux");
    assert.equal(env.RUNNER_ARCH, "X64");
    assert.equal(candidates.schema, "grainline-order-toolchain-variable-candidates-v1");
    assert.equal(candidates.actualRunnerPlacementVerified, false);
    assert.equal(candidates.productionExecutionAuthorized, false);
    const candidate = candidates.variables;
    assert.deepEqual(Object.keys(candidate).sort(), [
      "ORDER_ZERO_DIRECT_NODE_SHA256",
      "ORDER_ZERO_DIRECT_NODE_VERSION",
      "ORDER_ZERO_DIRECT_NPM_CLI_SHA256",
      "ORDER_ZERO_DIRECT_NPM_VERSION",
    ]);
    // The preflight rejects a protected owner URL, GitHub token, or an npm CLI
    // path override before it checks the exact regular-file bytes and version.
    preflightOrderZeroDirectToolchain({
      env: {
        ...env,
        ORDER_NODE_VERSION: candidate.ORDER_ZERO_DIRECT_NODE_VERSION,
        ORDER_NODE_SHA256: candidate.ORDER_ZERO_DIRECT_NODE_SHA256,
        ORDER_NPM_CLI_SHA256: candidate.ORDER_ZERO_DIRECT_NPM_CLI_SHA256,
        ORDER_NPM_VERSION: candidate.ORDER_ZERO_DIRECT_NPM_VERSION,
      },
      execPath, nodeVersion,
    });
    return Object.freeze({
      verified: true,
      runnerOs: env.RUNNER_OS,
      runnerArch: env.RUNNER_ARCH,
      nodePath: execPath,
      npmCliPath: npmCliFromNodeExecPath(execPath),
      nodeVersion,
      nodeSha256: candidate.ORDER_ZERO_DIRECT_NODE_SHA256,
      npmCliSha256: candidate.ORDER_ZERO_DIRECT_NPM_CLI_SHA256,
      npmVersion: candidate.ORDER_ZERO_DIRECT_NPM_VERSION,
    });
  } catch { throw new Error(FAILURE); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(attestOrderZeroDirectToolchain())}\n`); }
  catch { process.stderr.write(`${FAILURE}\n`); process.exitCode = 1; }
}
