import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { preflightOrderZeroDirectToolchain } from "../scripts/order-zero-direct-toolchain-preflight.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");

test("credential-free preflight accepts only matching reviewed Node/npm bytes and version", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "order-toolchain-preflight-"));
  const root = fs.realpathSync(temporary);
  try {
    const bin = path.join(root, "bin");
    const npmBin = path.join(root, "lib", "node_modules", "npm", "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(npmBin, { recursive: true });
    const execPath = path.join(bin, "node");
    const npmCli = path.join(npmBin, "npm-cli.js");
    const npmPackage = path.join(root, "lib", "node_modules", "npm", "package.json");
    const nodeBytes = Buffer.from("fixture-node-binary");
    const npmBytes = Buffer.from("fixture-npm-cli");
    fs.writeFileSync(execPath, nodeBytes);
    fs.writeFileSync(npmCli, npmBytes);
    fs.writeFileSync(npmPackage, JSON.stringify({ name: "npm", version: "10.9.8" }));
    const env = {
      GITHUB_SHA: "a".repeat(40), ORDER_NODE_VERSION: "v22.23.2",
      ORDER_NODE_SHA256: digest(nodeBytes), ORDER_NPM_CLI: npmCli,
      ORDER_NPM_CLI_SHA256: digest(npmBytes), ORDER_NPM_VERSION: "10.9.8",
    };
    const check = input => preflightOrderZeroDirectToolchain({
      env: { ...env, ...input }, execPath, nodeVersion: "v22.23.2",
    });
    assert.deepEqual(check({}), { verified: true });
    for (const change of [
      { ORDER_NODE_SHA256: "0".repeat(64) },
      { ORDER_NPM_CLI_SHA256: "0".repeat(64) },
      { ORDER_NPM_VERSION: "10.9.7" },
      { ORDER_NPM_CLI: "relative/npm-cli.js" },
      { GITHUB_TOKEN: "fixture-secret" },
      { PRODUCTION_MIGRATION_DIRECT_URL: "fixture-owner-url" },
    ]) assert.throws(() => check(change), /preflight unavailable; no execution admission/u);
    const alias = path.join(root, "node-alias");
    fs.symlinkSync(execPath, alias);
    assert.throws(() => preflightOrderZeroDirectToolchain({
      env, execPath: alias, nodeVersion: "v22.23.2",
    }), /preflight unavailable; no execution admission/u);
    fs.writeFileSync(npmPackage, JSON.stringify({ name: "not-npm", version: "10.9.8" }));
    assert.throws(() => check({}), /preflight unavailable; no execution admission/u);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
