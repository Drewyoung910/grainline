// Dormant, read-only checkout boundary. Never imports release modules, loads
// credentials, contacts providers or executes application/migration commands.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPOSITORY = "Drewyoung910/grainline";
const SHA = /^[0-9a-f]{40}$/u;
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex");
const fail = () => new Error("Order release source mismatch; no execution admission");

export function createOrderZeroDirectSourceFence(directory, reviewedCommit) {
  assert.ok(typeof directory === "string" && path.isAbsolute(directory));
  assert.ok(typeof reviewedCommit === "string" && SHA.test(reviewedCommit));
  const handles = new WeakMap();
  const git = args => execFileSync("/usr/bin/git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: directory, encoding: "utf8", timeout: 10000, maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_NO_REPLACE_OBJECTS: "1", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });

  function identity() {
    assert.equal(path.resolve(directory), directory);
    assert.equal(fs.realpathSync(directory), directory);
    assert.equal(fs.realpathSync(git(["rev-parse", "--show-toplevel"]).trim()), directory);
    // Git status may run configured clean/process filters. Refuse their
    // definitions before invoking status; this boundary must not run repo code.
    assert.ok(!git(["config", "--name-only", "--list"]).split("\n").some(key => /^filter\./iu.test(key)));
    assert.equal(git(["rev-parse", "--show-object-format"]).trim(), "sha1");
    assert.equal(git(["rev-parse", "--verify", "HEAD"]).trim(), reviewedCommit);
    assert.ok([`https://github.com/${REPOSITORY}.git`, `git@github.com:${REPOSITORY}.git`].includes(git(["remote", "get-url", "origin"]).trim()));
    assert.ok(git(["ls-files", "-v", "-z"]).split("\0").filter(Boolean).every(row => row.startsWith("H ")));
    assert.equal(git(["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"]), "");
  }

  function observe() {
    identity();
    const records = git(["ls-tree", "-r", "-z", "--full-tree", reviewedCommit]).split("\0").filter(Boolean);
    assert.ok(records.length > 0 && records.length <= 10000);
    const catalog = [];
    let totalBytes = 0;
    for (const record of records) {
      const match = /^(100644|100755) blob ([0-9a-f]{40})\t([^\0]+)$/u.exec(record);
      assert.ok(match, "unsupported tracked entry");
      const [, mode, oid, relative] = match;
      assert.ok(!path.isAbsolute(relative) && relative.split("/").every(part => part !== "" && part !== "." && part !== ".."));
      const file = path.join(directory, relative);
      assert.equal(fs.realpathSync(path.dirname(file)), path.dirname(file));
      assert.ok(Number.isInteger(fs.constants.O_NOFOLLOW) && Number.isInteger(fs.constants.O_NONBLOCK));
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      try {
        const before = fs.fstatSync(fd, { bigint: true });
        assert.ok(before.isFile() && before.nlink === 1n && before.size <= 32n * 1024n * 1024n);
        assert.equal((before.mode & 0o111n) !== 0n, mode === "100755");
        totalBytes += Number(before.size);
        assert.ok(totalBytes <= 256 * 1024 * 1024);
        const bytes = fs.readFileSync(fd);
        const after = fs.fstatSync(fd, { bigint: true });
        const named = fs.lstatSync(file, { bigint: true });
        assert.ok(!named.isSymbolicLink());
        for (const key of ["dev", "ino", "size", "mode", "mtimeNs", "ctimeNs", "nlink"]) {
          assert.equal(before[key], after[key]); assert.equal(before[key], named[key]);
        }
        assert.equal(digest("sha1", Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])), oid);
        catalog.push([mode, relative, digest("sha256", bytes)]);
      } finally { fs.closeSync(fd); }
    }
    identity();
    return { fileCount: records.length, totalBytes, catalogSha256: digest("sha256", JSON.stringify(catalog)) };
  }

  function capture() {
    try {
      const observation = observe();
      const handle = Object.freeze({ directory, reviewedCommit, repository: REPOSITORY, ...observation,
        loadedSourceProven: false, installedToolchainProven: false, authenticatedCiProven: false,
        completeProductionScope: false, productionExecutionAuthorized: false });
      handles.set(handle, observation);
      return handle;
    } catch { throw fail(); }
  }
  function verify(handle) {
    try {
      const prior = handles.get(handle); assert.ok(prior);
      assert.deepEqual(observe(), prior);
      return handle;
    } catch { throw fail(); }
  }
  return Object.freeze({ capture, verify });
}
