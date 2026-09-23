// Credential-free first step for the dormant production inspection job.
// The worker repeats these checks after its own checkout/source fence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FAILURE = "Order toolchain preflight unavailable; no execution admission";
const SHA256 = /^[a-f0-9]{64}$/u;

function digestRegularFile(file, limit) {
  assert.equal(fs.realpathSync(file), file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    assert.ok(before.isFile() && before.nlink === 1 && before.size > 0 && before.size <= limit);
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    assert.equal(after.ino, before.ino);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
    return { hash: createHash("sha256").update(bytes).digest("hex"), bytes };
  } finally { fs.closeSync(fd); }
}

export function preflightOrderZeroDirectToolchain({ env, execPath = process.execPath,
  nodeVersion = process.version }) {
  try {
    assert.ok(env && !("PRODUCTION_MIGRATION_DIRECT_URL" in env)
      && !("GITHUB_TOKEN" in env) && !("GH_TOKEN" in env));
    assert.match(env.GITHUB_SHA, /^[a-f0-9]{40}$/u);
    assert.match(env.ORDER_NODE_VERSION, /^v22\.\d+\.\d+$/u);
    assert.match(env.ORDER_NPM_VERSION, /^\d+\.\d+\.\d+$/u);
    assert.equal(nodeVersion, env.ORDER_NODE_VERSION);
    for (const key of ["ORDER_NODE_SHA256", "ORDER_NPM_CLI_SHA256"]) assert.match(env[key], SHA256);
    assert.ok(path.isAbsolute(execPath));
    assert.equal(digestRegularFile(execPath, 256 * 1024 * 1024).hash, env.ORDER_NODE_SHA256);
    const npmCli = env.ORDER_NPM_CLI;
    assert.ok(path.isAbsolute(npmCli) && path.basename(npmCli) === "npm-cli.js");
    assert.equal(digestRegularFile(npmCli, 1024 * 1024).hash, env.ORDER_NPM_CLI_SHA256);
    const npmPackage = path.join(path.dirname(path.dirname(npmCli)), "package.json");
    const npm = JSON.parse(digestRegularFile(npmPackage, 1024 * 1024).bytes.toString("utf8"));
    assert.equal(npm.name, "npm");
    assert.equal(npm.version, env.ORDER_NPM_VERSION);
    return Object.freeze({ verified: true });
  } catch { throw new Error(FAILURE); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { preflightOrderZeroDirectToolchain({ env: process.env }); }
  catch { process.stderr.write(`${FAILURE}\n`); process.exitCode = 1; }
}
