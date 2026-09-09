import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOrderZeroDirectSourceFence } from "../scripts/order-zero-direct-release-source.mjs";
import { probeOrderZeroDirectFreshSource } from "../scripts/order-zero-direct-fresh-source-probe.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const nodeSha256 = hash(fs.readFileSync(process.execPath));
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "order-fresh-source-test-"));
  const git = args => execFileSync("/usr/bin/git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
  git(["init", "--quiet"]); git(["config", "user.name", "Fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
  git(["remote", "add", "origin", "https://github.com/Drewyoung910/grainline.git"]);
  fs.mkdirSync(path.join(directory, "scripts"));
  const file = path.join(directory, "scripts/order-zero-direct-release-source.mjs");
  fs.copyFileSync("scripts/order-zero-direct-release-source.mjs", file);
  git(["add", "."]); git(["commit", "--quiet", "-m", "fixture"]);
  const releaseCommit = git(["rev-parse", "HEAD"]);
  const source = createOrderZeroDirectSourceFence(directory, releaseCommit).capture();
  const reviewed = { releaseCommit, sourceCatalogSha256: source.catalogSha256,
    sourceFenceSha256: hash(fs.readFileSync(file)), nodeSha256, nodeVersion: process.version };
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, file, reviewed, probe: override => probeOrderZeroDirectFreshSource({ directory, reviewed, ...override }) };
}

test("real fresh child verifies reviewed source without inheriting credentials or preload settings", t => {
  const f = fixture(t);
  const extra = { NODE_OPTIONS: "--require=/nonexistent/preload.cjs", NODE_PATH: "/nonexistent/modules", DATABASE_URL: "secret-fixture", GH_TOKEN: "secret-fixture", HTTPS_PROXY: "http://invalid.example" };
  const before = Object.fromEntries(Object.keys(extra).map(key => [key, process.env[key]]));
  Object.assign(process.env, extra);
  try {
    const result = f.probe();
    assert.ok(result.freshSourceProbePassed && Object.isFrozen(result));
    assert.notEqual(result.childPid, process.pid);
    assert.notEqual(f.probe().childPid, result.childPid);
    assert.equal(result.trackedFileCount, 1);
    for (const key of ["loadedReleaseGraphProven", "installedToolchainProven", "completeProductionScope", "productionExecutionAuthorized"]) assert.equal(result[key], false);
    assert.ok(!JSON.stringify(result).includes("secret-fixture"));
  } finally { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test("incorrect runtime, source and catalog pins fail without execution admission", t => {
  const f = fixture(t);
  for (const key of ["nodeSha256", "sourceFenceSha256", "sourceCatalogSha256"]) {
    assert.throws(() => f.probe({ reviewed: { ...f.reviewed, [key]: "0".repeat(64) } }), /no execution admission/u);
  }
  assert.throws(() => f.probe({ reviewed: { ...f.reviewed, nodeVersion: "v22.0.0" } }));
  assert.throws(() => f.probe({ reviewed: { ...f.reviewed, releaseCommit: "0".repeat(40) } }));
  assert.throws(() => f.probe({ reviewed: { ...f.reviewed, extra: true } }));
});

test("changed fence bytes are rejected before the altered repository code is imported", t => {
  const f = fixture(t);
  const marker = path.join(f.directory, "executed");
  fs.writeFileSync(f.file, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'bad'); throw new Error('secret-error');`);
  assert.throws(() => f.probe(), error => /no execution admission/u.test(error.message) && !error.message.includes("secret-error"));
  assert.equal(fs.existsSync(marker), false);
});

test("untracked edits and aliased directories are not accepted by the child", t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.directory, "extra.mjs"), "");
  assert.throws(() => f.probe());
  assert.throws(() => f.probe({ directory: `${f.directory}/../${path.basename(f.directory)}` }));
});
