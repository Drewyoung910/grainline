import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createOrderZeroDirectSourceFence } from "../scripts/order-zero-direct-release-source.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "order-source-fence-test-"));
  const directory = path.join(root, "source"); fs.mkdirSync(directory);
  const git = (...args) => execFileSync("/usr/bin/git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
  git("init", "--quiet"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  git("remote", "add", "origin", "https://github.com/Drewyoung910/grainline.git");
  fs.mkdirSync(path.join(directory, "scripts"));
  fs.writeFileSync(path.join(directory, "scripts", "entry.mjs"), "import './helper.mjs';\n");
  fs.writeFileSync(path.join(directory, "scripts", "helper.mjs"), "export const value = 1;\n");
  fs.writeFileSync(path.join(directory, ".gitignore"), "node_modules/\n");
  git("add", "."); git("commit", "--quiet", "-m", "fixture");
  const head = git("rev-parse", "HEAD");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { directory, root, git, head, file: path.join(directory, "scripts", "helper.mjs"),
    fence: createOrderZeroDirectSourceFence(directory, head) };
}

test("real Git checkout binds every tracked file without claiming loaded code, dependencies or CI", t => {
  const f = fixture(t); const handle = f.fence.capture();
  assert.equal(handle.fileCount, 3); assert.match(handle.catalogSha256, /^[a-f0-9]{64}$/u);
  assert.equal(f.fence.verify(handle), handle); assert.ok(Object.isFrozen(handle));
  for (const field of ["loadedSourceProven", "installedToolchainProven", "authenticatedCiProven", "completeProductionScope", "productionExecutionAuthorized"]) assert.equal(handle[field], false);
  fs.mkdirSync(path.join(f.directory, "node_modules"));
  fs.writeFileSync(path.join(f.directory, "node_modules", "ignored.js"), "not attested");
  assert.equal(f.fence.verify(handle), handle); // Explicitly outside this claim.
  assert.throws(() => f.fence.verify({ ...handle }));
  assert.throws(() => createOrderZeroDirectSourceFence(f.directory, f.head).verify(handle));
});

test("transitive source edits, staged edits and untracked files fail", t => {
  const f = fixture(t); const handle = f.fence.capture(); const bytes = fs.readFileSync(f.file);
  fs.appendFileSync(f.file, "// drift"); assert.throws(() => f.fence.verify(handle));
  f.git("add", "."); assert.throws(() => f.fence.capture());
  fs.writeFileSync(f.file, bytes); f.git("add", "."); assert.equal(f.fence.verify(handle), handle);
  fs.writeFileSync(path.join(f.directory, "unknown.mjs"), ""); assert.throws(() => f.fence.capture());
});

test("index-hidden changes and exact revision/origin drift fail", t => {
  const f = fixture(t);
  for (const flag of ["assume-unchanged", "skip-worktree"]) {
    f.git("update-index", `--${flag}`, "scripts/helper.mjs"); assert.throws(() => f.fence.capture());
    f.git("update-index", `--no-${flag}`, "scripts/helper.mjs");
  }
  assert.throws(() => createOrderZeroDirectSourceFence(f.directory, "0".repeat(40)).capture());
  f.git("remote", "set-url", "origin", "https://github.com/other/grainline.git"); assert.throws(() => f.fence.capture());
});

test("configured Git filters are rejected before status can execute repository commands", t => {
  const f = fixture(t);
  f.git("config", "filter.example.clean", "false");
  assert.throws(() => f.fence.capture());
  f.git("config", "--remove-section", "filter.example");
  assert.equal(f.fence.capture().fileCount, 3);
});

test("symlinks, hardlinks, path aliases and executable mode drift fail", t => {
  const f = fixture(t); const saved = path.join(f.root, "saved"); const handle = f.fence.capture();
  fs.renameSync(f.file, saved); fs.symlinkSync(saved, f.file); assert.throws(() => f.fence.verify(handle)); fs.unlinkSync(f.file);
  fs.linkSync(saved, f.file); assert.throws(() => f.fence.verify(handle)); fs.unlinkSync(f.file); fs.renameSync(saved, f.file);
  f.git("config", "core.filemode", "false"); fs.chmodSync(f.file, 0o755); assert.throws(() => f.fence.verify(handle)); fs.chmodSync(f.file, 0o644);
  const alias = path.join(f.root, "alias"); fs.symlinkSync(f.directory, alias);
  assert.throws(() => createOrderZeroDirectSourceFence(alias, f.head).capture());
  assert.equal(f.fence.verify(handle), handle);
});

test("clean committed symlinks and submodules are unsupported, not silently omitted", t => {
  const f = fixture(t); fs.symlinkSync("helper.mjs", path.join(f.directory, "scripts", "alias.mjs"));
  f.git("add", "."); f.git("commit", "--quiet", "-m", "symlink");
  assert.equal(f.git("status", "--porcelain"), "");
  assert.throws(() => createOrderZeroDirectSourceFence(f.directory, f.git("rev-parse", "HEAD")).capture());
  f.git("rm", "scripts/alias.mjs"); f.git("commit", "--quiet", "-m", "remove symlink");
  const nestedHead = f.git("rev-parse", "HEAD");
  f.git("clone", "--quiet", "--no-local", f.directory, path.join(f.directory, "nested"));
  f.git("update-index", "--add", "--cacheinfo", `160000,${nestedHead},nested`);
  f.git("commit", "--quiet", "-m", "gitlink");
  assert.equal(f.git("status", "--porcelain"), "");
  assert.throws(() => createOrderZeroDirectSourceFence(f.directory, f.git("rev-parse", "HEAD")).capture());
});
